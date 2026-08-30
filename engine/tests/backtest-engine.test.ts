import { describe, expect, it } from 'vitest';
import {
  EngineError,
  runBacktest,
  type BacktestStrategy,
  type Bar,
  type BarContext,
  type Order,
} from '../src/index.js';

const DAY = 86_400_000;
const T1 = 1_700_000_000_000;

/** Build daily-style bars from [timestamp, close] pairs (OHLC all = close). */
function bars(points: Array<[number, number]>): Bar[] {
  return points.map(([timestamp, close]) => ({
    timestamp,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1_000,
  }));
}

/** A strategy that replays a script of orders keyed by bar timestamp. */
function scripted(script: Record<number, Order[]>): BacktestStrategy & { contexts: BarContext[] } {
  const contexts: BarContext[] = [];
  return {
    id: 'scripted',
    contexts,
    onBar(ctx) {
      contexts.push(ctx);
      return script[ctx.bar.timestamp] ?? [];
    },
  };
}

function order(partial: Partial<Order> & { id: string }): Order {
  return { symbol: 'TEST', side: 'buy', type: 'market', quantity: 100, ...partial };
}

describe('runBacktest — buy/sell round trip with commissions', () => {
  const strategy = scripted({
    [T1]: [order({ id: 'b1' })],
    [T1 + DAY]: [order({ id: 's1', side: 'sell' })],
  });
  const result = runBacktest(
    {
      strategy,
      bars: { TEST: bars([[T1, 100], [T1 + DAY, 110]]) },
    },
    { initialCash: 20_000, cost: { commission: { rate: 0.001 } } },
  );

  it('buys on day one, paying commission from cash', () => {
    expect(result.fills).toHaveLength(2);
    expect(result.fills[0]).toMatchObject({
      orderId: 'b1',
      side: 'buy',
      quantity: 100,
      notional: 10_000,
      commission: 10,
    });
    expect(result.equityCurve[0]).toEqual({ timestamp: T1, equity: 19_990, cash: 9_990 });
  });

  it('sells on day two and realizes the net profit', () => {
    expect(result.fills[1]).toMatchObject({ orderId: 's1', side: 'sell', notional: 11_000, commission: 11 });
    expect(result.equityCurve[1]).toEqual({ timestamp: T1 + DAY, equity: 20_979, cash: 20_979 });
    expect(result.finalPortfolio.positions).toHaveLength(0);
    expect(result.orderLog.every((e) => e.outcome === 'filled')).toBe(true);
    expect(result.riskEvents).toHaveLength(0);
  });

  it('hands the strategy a previous-close snapshot without lookahead', () => {
    expect(strategy.contexts[1]?.equity).toBe(19_990);
    expect(strategy.contexts[1]?.portfolio.cash).toBe(9_990);
    expect(strategy.contexts[1]?.portfolio.positions).toEqual([
      { symbol: 'TEST', quantity: 100, avgPrice: 100 },
    ]);
  });
});

describe('runBacktest — stop loss forced exit', () => {
  const result = runBacktest(
    {
      strategy: scripted({ [T1]: [order({ id: 'b1' })] }),
      bars: { TEST: bars([[T1, 100], [T1 + DAY, 85]]) },
    },
    { initialCash: 20_000, risk: { stopLossPct: 0.1 } },
  );

  it('liquidates the position at the breaching close', () => {
    expect(result.fills).toHaveLength(2);
    expect(result.fills[1]).toMatchObject({
      orderId: `risk-stop-TEST-${T1 + DAY}`,
      side: 'sell',
      quantity: 100,
      price: 85,
    });
    expect(result.riskEvents).toHaveLength(1);
    expect(result.riskEvents[0]).toMatchObject({
      code: 'stop_loss',
      action: 'liquidation',
      symbol: 'TEST',
    });
    expect(result.equityCurve[1]).toEqual({ timestamp: T1 + DAY, equity: 18_500, cash: 18_500 });
    expect(result.finalPortfolio.positions).toHaveLength(0);
  });
});

describe('runBacktest — max position cap', () => {
  const result = runBacktest(
    {
      strategy: scripted({
        [T1]: [order({ id: 'big', quantity: 10_000 }), order({ id: 'more', quantity: 5_000 })],
      }),
      bars: { TEST: bars([[T1, 10]]) },
    },
    { initialCash: 100_000, risk: { maxPositionPct: 0.5 } },
  );

  it('reduces the oversized buy to the cap', () => {
    expect(result.fills).toHaveLength(1);
    expect(result.fills[0]).toMatchObject({ orderId: 'big', quantity: 5_000, notional: 50_000 });
    expect(result.orderLog[0]).toMatchObject({
      orderId: 'big',
      outcome: 'filled',
      submittedQuantity: 5_000,
    });
  });

  it('rejects the follow-up buy that would exceed the cap', () => {
    expect(result.orderLog[1]).toMatchObject({ orderId: 'more', outcome: 'risk_rejected' });
    expect(result.riskEvents).toHaveLength(2);
    expect(result.riskEvents[0]).toMatchObject({ code: 'max_position', action: 'position_reduced' });
    expect(result.riskEvents[1]).toMatchObject({ code: 'max_position', action: 'order_rejected' });
    expect(result.finalPortfolio).toMatchObject({ cash: 50_000 });
    expect(result.finalPortfolio.positions).toEqual([
      { symbol: 'TEST', quantity: 5_000, avgPrice: 10 },
    ]);
  });
});

describe('runBacktest — daily loss circuit breaker (intraday bars)', () => {
  // Place T1 at a UTC midnight so the three intraday bars share one UTC day.
  const T1 = 1_700_064_000_000;
  const T0B = T1 + 3_600_000;
  const T0C = T1 + 7_200_000;
  const T2 = T1 + DAY;
  const result = runBacktest(
    {
      strategy: scripted({
        [T1]: [order({ id: 'buy-all', quantity: 1_000 })],
        [T0B]: [order({ id: 'unaffordable', quantity: 10 })],
        [T0C]: [order({ id: 'blocked', quantity: 10 })],
        [T2]: [order({ id: 'next-day', quantity: 10 })],
      }),
      bars: {
        TEST: bars([
          [T1, 100],
          [T0B, 90],
          [T0C, 90],
          [T2, 90],
        ]),
      },
    },
    { initialCash: 100_000, risk: { maxDailyLossPct: 0.05 } },
  );

  it('blocks orders for the rest of the day after the breach', () => {
    const outcomes = result.orderLog.map((e) => e.outcome);
    expect(outcomes).toEqual(['filled', 'rejected', 'halted', 'rejected']);
    expect(result.orderLog[2]).toMatchObject({ orderId: 'blocked', outcome: 'halted' });
    expect(result.riskEvents.map((e) => e.code)).toEqual(['daily_loss_limit', 'trading_halted']);
  });

  it('resumes trading (execution-level checks only) on the next day', () => {
    expect(result.orderLog[3]).toMatchObject({ orderId: 'next-day', outcome: 'rejected' });
    expect(result.orderLog[3]?.reason).toContain('cash is 0');
  });

  it('marks the equity curve at every close', () => {
    expect(result.equityCurve.map((p) => p.equity)).toEqual([100_000, 90_000, 90_000, 90_000]);
  });
});

describe('runBacktest — drawdown kill switch', () => {
  const T2 = T1 + DAY;
  const T3 = T1 + 2 * DAY;
  const T4 = T1 + 3 * DAY;
  const result = runBacktest(
    {
      strategy: scripted({
        [T1]: [order({ id: 'buy-all', quantity: 1_000 })],
        [T4]: [order({ id: 'after-kill', quantity: 10 })],
      }),
      bars: {
        TEST: bars([
          [T1, 100],
          [T2, 130],
          [T3, 110],
          [T4, 110],
        ]),
      },
    },
    { initialCash: 100_000, risk: { maxDrawdownPct: 0.1 } },
  );

  it('liquidates everything and halts permanently at the kill switch', () => {
    expect(result.riskEvents.map((e) => e.action)).toEqual([
      'halt',
      'liquidation',
      'order_rejected',
    ]);
    expect(result.fills[1]).toMatchObject({
      orderId: `risk-liquidate-TEST-${T3}`,
      side: 'sell',
      quantity: 1_000,
      price: 110,
    });
    expect(result.orderLog[1]).toMatchObject({
      orderId: `risk-liquidate-TEST-${T3}`,
      outcome: 'filled',
    });
    expect(result.orderLog[2]).toMatchObject({ orderId: 'after-kill', outcome: 'halted' });
    expect(result.finalPortfolio.positions).toHaveLength(0);
    expect(result.equityCurve.map((p) => p.equity)).toEqual([100_000, 130_000, 110_000, 110_000]);
  });
});

describe('runBacktest — multi-symbol determinism', () => {
  it('iterates symbols in input order for each timestamp', () => {
    const strategy = scripted({});
    runBacktest(
      {
        strategy,
        bars: {
          AAA: bars([[T1, 10], [T1 + DAY, 11]]),
          BBB: bars([[T1, 20], [T1 + DAY, 21]]),
        },
      },
      { initialCash: 10_000 },
    );
    const seen = strategy.contexts.map((c) => `${c.bar.timestamp}:${c.bar.open}`);
    expect(seen).toEqual([`${T1}:10`, `${T1}:20`, `${T1 + DAY}:11`, `${T1 + DAY}:21`]);
  });
});

describe('runBacktest — input validation', () => {
  it('rejects empty bar sets', () => {
    expect(() =>
      runBacktest({ strategy: scripted({}), bars: {} }, { initialCash: 1_000 }),
    ).toThrow(expect.objectContaining({ code: 'invalid_input' }));
  });

  it('rejects symbols without bars', () => {
    expect(() =>
      runBacktest(
        { strategy: scripted({}), bars: { TEST: [] } },
        { initialCash: 1_000 },
      ),
    ).toThrow(expect.objectContaining({ code: 'invalid_input' }));
  });

  it('rejects unsorted or duplicate timestamps', () => {
    expect(() =>
      runBacktest(
        { strategy: scripted({}), bars: { TEST: bars([[T1 + DAY, 10], [T1, 10]]) } },
        { initialCash: 1_000 },
      ),
    ).toThrow(EngineError);
    expect(() =>
      runBacktest(
        { strategy: scripted({}), bars: { TEST: bars([[T1, 10], [T1, 10]]) } },
        { initialCash: 1_000 },
      ),
    ).toThrow(EngineError);
  });
});
