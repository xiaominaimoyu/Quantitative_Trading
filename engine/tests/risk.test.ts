import { describe, expect, it } from 'vitest';
import { Portfolio, RiskManager } from '../src/index.js';
import type { RiskLimits } from '../src/index.js';

const T = 1_700_000_000_000;

function buyPosition(
  portfolio: Portfolio,
  symbol: string,
  quantity: number,
  price: number,
): void {
  portfolio.applyFill({
    orderId: `seed-${symbol}`,
    symbol,
    side: 'buy',
    quantity,
    price,
    notional: quantity * price,
    commission: 0,
    slippageCost: 0,
    filledAt: T,
  });
}

describe('RiskManager config validation', () => {
  const invalid: Array<[keyof RiskLimits, number]> = [
    ['stopLossPct', 0],
    ['stopLossPct', -0.1],
    ['stopLossPct', 1.5],
    ['maxPositionPct', 0],
    ['maxPositionPct', Number.NaN],
    ['maxDailyLossPct', 1.0001],
    ['maxDrawdownPct', Number.POSITIVE_INFINITY],
  ];

  for (const [key, value] of invalid) {
    it(`rejects ${String(key)} = ${value}`, () => {
      expect(() => new RiskManager({ [key]: value })).toThrow(
        expect.objectContaining({ code: 'invalid_risk_config' }),
      );
    });
  }

  it('accepts boundary value 1', () => {
    expect(() => new RiskManager({ stopLossPct: 1, maxDrawdownPct: 1 })).not.toThrow();
  });
});

describe('RiskManager pass-through (no limits)', () => {
  const risk = new RiskManager();
  const portfolio = new Portfolio(100_000);

  it('allows any order', () => {
    const decision = risk.checkOrder(
      { id: 'o1', symbol: 'X', side: 'buy', type: 'market', quantity: 1_000 },
      { timestamp: T, price: 10, equity: 100_000, portfolio, lotSize: 1 },
    );
    expect(decision).toEqual({ allowed: true });
  });

  it('produces no exits and no halts', () => {
    buyPosition(portfolio, 'X', 100, 10);
    expect(risk.evaluateExits({ X: 1 }, portfolio, T)).toEqual([]);
    const limits = risk.evaluateLimits(1, portfolio, T);
    expect(limits).toMatchObject({ haltForDay: false, haltPersistent: false });
    expect(limits.events).toEqual([]);
    expect(risk.isHalted()).toBe(false);
  });
});

describe('stop loss exits', () => {
  const risk = new RiskManager({ stopLossPct: 0.1 });
  const portfolio = new Portfolio(100_000);
  buyPosition(portfolio, 'AAPL', 100, 100);

  it('liquidates when close breaches the stop price', () => {
    const directives = risk.evaluateExits({ AAPL: 89 }, portfolio, T);
    expect(directives).toHaveLength(1);
    expect(directives[0]).toMatchObject({
      symbol: 'AAPL',
      quantity: 100,
      event: { code: 'stop_loss', action: 'liquidation' },
    });
  });

  it('triggers exactly at the stop price (close <= stop)', () => {
    expect(risk.evaluateExits({ AAPL: 90 }, portfolio, T)).toHaveLength(1);
    expect(risk.evaluateExits({ AAPL: 90.01 }, portfolio, T)).toHaveLength(0);
  });

  it('skips symbols without a price', () => {
    expect(risk.evaluateExits({}, portfolio, T)).toHaveLength(0);
  });
});

describe('max position ratio', () => {
  const risk = new RiskManager({ maxPositionPct: 0.5 });
  const empty = new Portfolio(100_000);

  it('reduces oversized buys to the largest allowed lot quantity', () => {
    const decision = risk.checkOrder(
      { id: 'o1', symbol: 'X', side: 'buy', type: 'market', quantity: 6_000 },
      { timestamp: T, price: 10, equity: 100_000, portfolio: empty, lotSize: 100 },
    );
    expect(decision.allowed).toBe(true);
    if (!decision.allowed) return;
    expect(decision.quantity).toBe(5_000);
    expect(decision.event).toMatchObject({ code: 'max_position', action: 'position_reduced' });
  });

  it('allows buys within the cap without events', () => {
    const decision = risk.checkOrder(
      { id: 'o2', symbol: 'X', side: 'buy', type: 'market', quantity: 4_000 },
      { timestamp: T, price: 10, equity: 100_000, portfolio: empty, lotSize: 100 },
    );
    expect(decision).toEqual({ allowed: true });
  });

  it('rejects buys when the cap is fully used', () => {
    const portfolio = new Portfolio(100_000);
    buyPosition(portfolio, 'X', 5_000, 10);
    const decision = risk.checkOrder(
      { id: 'o3', symbol: 'X', side: 'buy', type: 'market', quantity: 100 },
      { timestamp: T, price: 10, equity: 100_000, portfolio, lotSize: 100 },
    );
    expect(decision).toMatchObject({
      allowed: false,
      event: { code: 'max_position', action: 'order_rejected' },
    });
  });

  it('rejects buys when the remaining room buys less than one lot', () => {
    const decision = risk.checkOrder(
      { id: 'o4', symbol: 'X', side: 'buy', type: 'market', quantity: 1 },
      { timestamp: T, price: 100, equity: 100, portfolio: empty, lotSize: 100 },
    );
    expect(decision).toMatchObject({
      allowed: false,
      event: { code: 'max_position', action: 'order_rejected' },
    });
  });

  it('never restricts sells', () => {
    const portfolio = new Portfolio(100_000);
    buyPosition(portfolio, 'X', 500, 100);
    const decision = risk.checkOrder(
      { id: 'o5', symbol: 'X', side: 'sell', type: 'market', quantity: 500 },
      { timestamp: T, price: 100, equity: 100_000, portfolio, lotSize: 100 },
    );
    expect(decision).toEqual({ allowed: true });
  });
});

describe('daily loss circuit breaker', () => {
  const risk = new RiskManager({ maxDailyLossPct: 0.05 });
  const portfolio = new Portfolio(100_000);

  it('stays quiet above the threshold', () => {
    risk.onDayStart(100_000);
    const limits = risk.evaluateLimits(95_000, portfolio, T);
    expect(limits.haltForDay).toBe(false);
    expect(risk.isHalted()).toBe(false);
  });

  it('halts below the threshold and latches until the next day', () => {
    const limits = risk.evaluateLimits(94_999, portfolio, T);
    expect(limits.haltForDay).toBe(true);
    expect(risk.isHalted()).toBe(true);
    expect(limits.events).toHaveLength(1);
    expect(limits.events[0]).toMatchObject({ code: 'daily_loss_limit', action: 'halt' });

    const again = risk.evaluateLimits(90_000, portfolio, T);
    expect(again.haltForDay).toBe(false);
    expect(again.events).toHaveLength(0);
  });

  it('blocks orders while halted', () => {
    const decision = risk.checkOrder(
      { id: 'o6', symbol: 'X', side: 'buy', type: 'market', quantity: 1 },
      { timestamp: T, price: 10, equity: 90_000, portfolio, lotSize: 1 },
    );
    expect(decision).toMatchObject({
      allowed: false,
      event: { code: 'trading_halted', action: 'order_rejected' },
    });
  });

  it('resets the daily halt on a new trading day', () => {
    risk.onDayStart(94_999);
    expect(risk.isHalted()).toBe(false);
  });
});

describe('drawdown kill switch', () => {
  const risk = new RiskManager({ maxDrawdownPct: 0.2 });
  const portfolio = new Portfolio(1_000_000);
  buyPosition(portfolio, 'AAPL', 100, 100);
  buyPosition(portfolio, 'MSFT', 100, 100);

  it('tracks the equity peak', () => {
    risk.onDayStart(1_000_000);
    risk.onEquity(1_200_000);
    expect(risk.isHalted()).toBe(false);
  });

  it('halts, liquidates everything and latches permanently on breach', () => {
    const limits = risk.evaluateLimits(950_000, portfolio, T);
    expect(limits.haltPersistent).toBe(true);
    expect(limits.haltForDay).toBe(false);
    expect(limits.liquidateSymbols).toEqual(['AAPL', 'MSFT']);
    expect(limits.events.map((e) => e.code)).toEqual(['drawdown_limit', 'drawdown_limit']);
    expect(limits.events.map((e) => e.action)).toEqual(['halt', 'liquidation']);

    expect(risk.isHalted()).toBe(true);
    const again = risk.evaluateLimits(1_000_000, portfolio, T);
    expect(again.events).toHaveLength(0);
    expect(again.liquidateSymbols).toEqual([]);
  });

  it('survives day boundaries (persistent halt is not reset)', () => {
    risk.onDayStart(1_000_000);
    expect(risk.isHalted()).toBe(true);
  });
});

describe('RiskManager determinism', () => {
  it('produces identical decisions for identical input sequences', () => {
    const build = () => {
      const risk = new RiskManager({ maxPositionPct: 0.5 });
      const portfolio = new Portfolio(100_000);
      const decision = risk.checkOrder(
        { id: 'o1', symbol: 'X', side: 'buy', type: 'market', quantity: 6_000 },
        { timestamp: T, price: 100, equity: 100_000, portfolio, lotSize: 100 },
      );
      return decision;
    };
    const a: unknown = build();
    const b: unknown = build();
    expect(a).toEqual(b);
  });
});
