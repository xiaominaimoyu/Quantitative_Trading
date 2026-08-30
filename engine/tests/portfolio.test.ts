import { describe, expect, it } from 'vitest';
import { EngineError, Portfolio } from '../src/index.js';
import type { Fill } from '../src/index.js';

function makeFill(partial: Partial<Fill> = {}): Fill {
  return {
    orderId: 'o-1',
    symbol: 'AAPL',
    side: 'buy',
    quantity: 10,
    price: 50,
    notional: 500,
    commission: 5,
    slippageCost: 0,
    filledAt: 1_700_000_000_000,
    ...partial,
  };
}

describe('Portfolio', () => {
  it('rejects a non-finite or negative initial cash', () => {
    expect(() => new Portfolio(-1)).toThrow(EngineError);
    expect(() => new Portfolio(-1)).toThrow(
      expect.objectContaining({ code: 'invalid_portfolio_state' }),
    );
    expect(() => new Portfolio(Number.NaN)).toThrow(EngineError);
    expect(() => new Portfolio(Number.POSITIVE_INFINITY)).toThrow(EngineError);
    expect(new Portfolio(0).cash).toBe(0);
  });

  it('starts flat with the initial cash', () => {
    const portfolio = new Portfolio(1_000);
    expect(portfolio.cash).toBe(1_000);
    expect(portfolio.positions).toHaveLength(0);
    expect(portfolio.position('AAPL')).toBeUndefined();
  });

  it('applies a buy fill: cash down, position up', () => {
    const portfolio = new Portfolio(1_000);
    portfolio.applyFill(makeFill());

    expect(portfolio.cash).toBe(495);
    expect(portfolio.position('AAPL')).toEqual({
      symbol: 'AAPL',
      quantity: 10,
      avgPrice: 50,
    });
  });

  it('applies a sell fill: cash up, position down', () => {
    const portfolio = new Portfolio(1_000);
    portfolio.applyFill(makeFill());
    portfolio.applyFill(makeFill({ side: 'sell', quantity: 4, notional: 200, commission: 2 }));

    expect(portfolio.cash).toBe(495 + 198);
    expect(portfolio.position('AAPL')).toMatchObject({ quantity: 6, avgPrice: 50 });
  });

  it('computes the volume-weighted average price across stacked buys', () => {
    const portfolio = new Portfolio(10_000);
    portfolio.applyFill(makeFill({ notional: 500 })); // 10 @ 50
    portfolio.applyFill(makeFill({ notional: 600, commission: 6 })); // 10 @ 60

    expect(portfolio.position('AAPL')).toMatchObject({ quantity: 20, avgPrice: 55 });
  });

  it('removes the position when fully sold', () => {
    const portfolio = new Portfolio(10_000);
    portfolio.applyFill(makeFill());
    portfolio.applyFill(makeFill({ side: 'sell', quantity: 10, notional: 500, commission: 5 }));

    expect(portfolio.position('AAPL')).toBeUndefined();
    expect(portfolio.positions).toHaveLength(0);
  });

  it('throws when a sell exceeds the open position', () => {
    const portfolio = new Portfolio(10_000);
    portfolio.applyFill(makeFill());

    expect(() =>
      portfolio.applyFill(makeFill({ side: 'sell', quantity: 11, notional: 550, commission: 5 })),
    ).toThrow(expect.objectContaining({ code: 'invalid_portfolio_state' }));
  });

  it('values equity at market prices when available', () => {
    const portfolio = new Portfolio(10_000);
    portfolio.applyFill(makeFill({ quantity: 20, notional: 1_100, price: 55 }));

    expect(portfolio.equity({ AAPL: 60 })).toBeCloseTo(10_000 - 1_105 + 1_200, 8);
  });

  it('falls back to average cost when no market price is provided', () => {
    const portfolio = new Portfolio(10_000);
    portfolio.applyFill(makeFill({ quantity: 20, notional: 1_100, price: 55 }));

    expect(portfolio.equity({})).toBeCloseTo(10_000 - 1_105 + 1_100, 8);
  });

  it('returns a snapshot copy from positions', () => {
    const portfolio = new Portfolio(10_000);
    portfolio.applyFill(makeFill());
    const snapshot = portfolio.positions;
    snapshot.pop();
    expect(portfolio.positions).toHaveLength(1);
  });
});
