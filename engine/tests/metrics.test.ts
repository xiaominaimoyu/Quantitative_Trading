import { describe, expect, it } from 'vitest';
import {
  computeDrawdownSeries,
  computePerformance,
  pairFillsIntoTrades,
  runBacktest,
  type BacktestResult,
  type Bar,
  type Fill,
} from '../src/index.js';

const T1 = 1_700_000_000_000;
const STEP = 86_400_000;

function fill(partial: Partial<Fill> & { id: string; side: 'buy' | 'sell' }): Fill {
  const { id, ...rest } = partial;
  return {
    symbol: 'X',
    quantity: 1,
    price: 100,
    notional: 100,
    commission: 0,
    slippageCost: 0,
    filledAt: T1,
    ...rest,
    orderId: id,
  } as Fill;
}

function result(partial: Partial<BacktestResult> = {}): BacktestResult {
  return {
    equityCurve: [],
    fills: [],
    riskEvents: [],
    orderLog: [],
    finalPortfolio: { cash: 0, positions: [] },
    ...partial,
  };
}

describe('computeDrawdownSeries', () => {
  it('tracks the running peak', () => {
    const curve = [100_000, 110_000, 99_000, 105_000, 108_000].map((equity, i) => ({
      timestamp: T1 + i * STEP,
      equity,
      cash: equity,
    }));
    const series = computeDrawdownSeries(curve);
    expect(series.map((d) => d.drawdownPct).map((d) => Math.round(d * 1e6) / 1e6)).toEqual([
      0, 0, 0.1, 0.045455, 0.018182,
    ]);
  });

  it('returns an empty series for an empty curve', () => {
    expect(computeDrawdownSeries([])).toEqual([]);
  });
});

describe('pairFillsIntoTrades', () => {
  it('pairs a simple round trip with fees', () => {
    const trades = pairFillsIntoTrades([
      fill({ id: 'b1', side: 'buy', quantity: 100, price: 100, commission: 10 }),
      fill({ id: 's1', side: 'sell', quantity: 100, price: 110, commission: 11, filledAt: T1 + STEP }),
    ]);
    expect(trades).toHaveLength(1);
    expect(trades[0]).toMatchObject({
      symbol: 'X',
      quantity: 100,
      entryAvgPrice: 100,
      exitAvgPrice: 110,
      grossPnl: 1_000,
      fees: 21,
      netPnl: 979,
    });
  });

  it('matches FIFO across partial lots and allocates fees per share', () => {
    const trades = pairFillsIntoTrades([
      fill({ id: 'b1', side: 'buy', quantity: 100, price: 100, commission: 10 }),
      fill({ id: 'b2', side: 'buy', quantity: 100, price: 90, commission: 5, filledAt: T1 + STEP }),
      fill({ id: 's1', side: 'sell', quantity: 150, price: 105, commission: 12, filledAt: T1 + 2 * STEP }),
    ]);
    expect(trades).toHaveLength(1);
    const trade = trades[0]!;
    expect(trade.quantity).toBe(150);
    expect(trade.entryAvgPrice).toBeCloseTo(14_500 / 150, 10);
    expect(trade.grossPnl).toBeCloseTo(1_250, 8);
    expect(trade.fees).toBeCloseTo(12.5 + 12, 8);
    expect(trade.netPnl).toBeCloseTo(1_225.5, 8);
  });

  it('keeps symbols independent and skips unmatched sells', () => {
    const trades = pairFillsIntoTrades([
      fill({ id: 'a1', side: 'buy', symbol: 'AAA', quantity: 10, price: 10 }),
      fill({ id: 'b1', side: 'buy', symbol: 'BBB', quantity: 10, price: 20 }),
      fill({ id: 'a2', side: 'sell', symbol: 'AAA', quantity: 10, price: 11, filledAt: T1 + STEP }),
      fill({ id: 'b2', side: 'sell', symbol: 'BBB', quantity: 10, price: 19, filledAt: T1 + STEP }),
    ]);
    expect(trades).toHaveLength(2);
    expect(trades.map((t) => t.netPnl)).toEqual([10, -10]);
  });

  it('produces no trades for buy-only sequences', () => {
    expect(pairFillsIntoTrades([fill({ id: 'b1', side: 'buy', quantity: 10 })])).toEqual([]);
  });
});

describe('computePerformance — headline metrics', () => {
  const fills: Fill[] = [
    fill({ id: 'b1', side: 'buy', quantity: 100, price: 100, commission: 10 }),
    fill({ id: 's1', side: 'sell', quantity: 100, price: 110, commission: 11, filledAt: T1 + STEP }),
    fill({ id: 'b2', side: 'buy', quantity: 50, price: 200, commission: 5, filledAt: T1 + 2 * STEP }),
    fill({ id: 's2', side: 'sell', quantity: 50, price: 180, commission: 4.5, filledAt: T1 + 3 * STEP }),
    fill({ id: 'b3', side: 'buy', quantity: 10, price: 50, commission: 1, filledAt: T1 + 4 * STEP }),
    fill({ id: 's3', side: 'sell', quantity: 10, price: 60, commission: 1, filledAt: T1 + 5 * STEP }),
  ];
  const equities = [100_000, 110_000, 99_000, 105_000];
  const testResult = result({
    fills,
    equityCurve: equities.map((equity, i) => ({
      timestamp: T1 + i * STEP,
      equity,
      cash: equity,
    })),
    finalPortfolio: { cash: 105_000, positions: [] },
  });
  const report = computePerformance(testResult, { initialCapital: 100_000 });

  it('computes total and annualized return', () => {
    expect(report.totalReturnPct).toBeCloseTo(0.05, 12);
    expect(report.annualizedReturnPct).toBeCloseTo(
      Math.pow(1.05, 252 / 3) - 1,
      10,
    );
  });

  it('computes max drawdown and the Calmar ratio', () => {
    expect(report.maxDrawdownPct).toBeCloseTo(0.1, 12);
    expect(report.calmarRatio).toBeCloseTo(
      (Math.pow(1.05, 252 / 3) - 1) / 0.1,
      10,
    );
  });

  it('computes the Sharpe ratio from per-period returns', () => {
    const returns = [110_000 / 100_000 - 1, 99_000 / 110_000 - 1, 105_000 / 99_000 - 1];
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const std = Math.sqrt(
      returns.reduce((a, r) => a + (r - mean) ** 2, 0) / returns.length,
    );
    expect(report.sharpeRatio).toBeCloseTo((mean / std) * Math.sqrt(252), 10);
  });

  it('computes win rate and profit/loss ratio from closed trades', () => {
    expect(report.trades).toEqual({ total: 3, wins: 2, losses: 1 });
    expect(report.winRate).toBeCloseTo(2 / 3, 12);
    expect(report.avgWin).toBeCloseTo((979 + 98) / 2, 10);
    expect(report.avgLoss).toBeCloseTo(1_009.5, 10);
    expect(report.profitLossRatio).toBeCloseTo(538.5 / 1_009.5, 10);
  });

  it('passes curve data through for plotting', () => {
    expect(report.equityCurve).toHaveLength(4);
    expect(report.drawdownCurve).toHaveLength(4);
  });
});

describe('computePerformance — edge cases', () => {
  it('returns zeros (never NaN) for an empty result', () => {
    const report = computePerformance(result());
    expect(report.totalReturnPct).toBe(0);
    expect(report.annualizedReturnPct).toBe(0);
    expect(report.maxDrawdownPct).toBe(0);
    expect(report.sharpeRatio).toBe(0);
    expect(report.calmarRatio).toBe(0);
    expect(report.winRate).toBe(0);
    expect(report.profitLossRatio).toBe(0);
    expect(report.trades).toEqual({ total: 0, wins: 0, losses: 0 });
  });

  it('yields Infinity profit/loss ratio when there are no losing trades', () => {
    const report = computePerformance(
      result({
        fills: [
          fill({ id: 'b1', side: 'buy', quantity: 10, price: 10, commission: 1 }),
          fill({ id: 's1', side: 'sell', quantity: 10, price: 11, commission: 1, filledAt: T1 + STEP }),
        ],
        equityCurve: [{ timestamp: T1, equity: 100, cash: 100 }],
      }),
    );
    expect(report.profitLossRatio).toBe(Number.POSITIVE_INFINITY);
    expect(report.winRate).toBe(1);
  });

  it('returns a zero Sharpe ratio for zero dispersion', () => {
    const report = computePerformance(
      result({
        equityCurve: [
          { timestamp: T1, equity: 100, cash: 100 },
          { timestamp: T1 + STEP, equity: 110, cash: 110 },
          { timestamp: T1 + 2 * STEP, equity: 121, cash: 121 },
        ],
      }),
    );
    expect(report.sharpeRatio).toBe(0);
  });

  it('respects the risk-free rate and custom annualization', () => {
    const report = computePerformance(
      result({
        equityCurve: [
          { timestamp: T1, equity: 100, cash: 100 },
          { timestamp: T1 + STEP, equity: 110, cash: 110 },
          { timestamp: T1 + 2 * STEP, equity: 99, cash: 99 },
        ],
      }),
      { periodsPerYear: 12, riskFreeRatePerPeriod: 0.01, initialCapital: 100 },
    );
    const returns = [0.1, 99 / 110 - 1];
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const std = Math.sqrt(returns.reduce((a, r) => a + (r - mean) ** 2, 0) / returns.length);
    expect(report.sharpeRatio).toBeCloseTo(((mean - 0.01) / std) * Math.sqrt(12), 10);
  });
});

describe('computePerformance — integration with the backtest engine', () => {
  const bar = (timestamp: number, close: number): Bar => ({
    timestamp,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1_000,
  });
  const strategy = {
    id: 'round-trip',
    onBar(ctx: { bar: Bar }) {
      if (ctx.bar.timestamp === T1) {
        return [{ id: 'b', symbol: 'TEST', side: 'buy' as const, type: 'market' as const, quantity: 100 }];
      }
      if (ctx.bar.timestamp === T1 + STEP) {
        return [{ id: 's', symbol: 'TEST', side: 'sell' as const, type: 'market' as const, quantity: 100 }];
      }
      return [];
    },
  };
  const engineResult = runBacktest(
    { strategy, bars: { TEST: [bar(T1, 100), bar(T1 + STEP, 110)] } },
    { initialCash: 20_000, cost: { commission: { rate: 0.001 } } },
  );
  const report = computePerformance(engineResult, { initialCapital: 20_000 });

  it('measures the round-trip profit net of fees', () => {
    expect(report.trades.total).toBe(1);
    expect(report.winRate).toBe(1);
    expect(report.avgWin).toBeCloseTo(979, 8);
    expect(report.totalReturnPct).toBeCloseTo(20_979 / 20_000 - 1, 10);
  });

  it('exposes the equity and drawdown curves', () => {
    expect(report.equityCurve.map((p) => p.equity)).toEqual([19_990, 20_979]);
    expect(report.drawdownCurve.map((d) => d.drawdownPct)).toEqual([0, 0]);
  });
});
