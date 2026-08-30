import { describe, expect, it } from 'vitest';
import {
  createCostModel,
  ExecutionService,
  Portfolio,
} from '../src/index.js';
import type { Bar, Fill, Order } from '../src/index.js';

const BAR: Bar = {
  timestamp: 1_700_000_000_000,
  open: 100,
  high: 101,
  low: 99,
  close: 100,
  volume: 10_000,
};

function makeOrder(partial: Partial<Order> = {}): Order {
  return { id: 'o-1', symbol: 'AAPL', side: 'buy', type: 'market', quantity: 100, ...partial };
}

function apply(portfolio: Portfolio, result: ReturnType<ExecutionService['execute']>): Fill {
  if (result.status !== 'filled') {
    throw new Error(`expected fill, got ${result.status}: ${result.reason}`);
  }
  portfolio.applyFill(result.fill);
  return result.fill;
}

describe('ExecutionService', () => {
  it('fills at bar close with slippage and commission applied', () => {
    const cost = createCostModel({
      commission: { rate: 0.001 },
      slippage: { mode: 'fixed', value: 0.02 },
    });
    const executor = new ExecutionService(cost);
    const portfolio = new Portfolio(20_000);

    const result = executor.execute(makeOrder(), BAR, portfolio);

    expect(result.status).toBe('filled');
    if (result.status !== 'filled') return;
    expect(result.fill.price).toBe(100.02);
    expect(result.fill.notional).toBe(10_002);
    expect(result.fill.commission).toBe(10);
    expect(result.fill.slippageCost).toBe(2);
    expect(result.fill.quantity).toBe(100);
    expect(result.fill.filledAt).toBe(BAR.timestamp);
    expect(result.fill.orderId).toBe('o-1');
  });

  it('buys debit notional plus commission from cash', () => {
    const executor = new ExecutionService(
      createCostModel({ commission: { rate: 0.001 }, slippage: { mode: 'fixed', value: 0.02 } }),
    );
    const portfolio = new Portfolio(20_000);

    apply(portfolio, executor.execute(makeOrder(), BAR, portfolio));

    expect(portfolio.cash).toBeCloseTo(20_000 - 10_002 - 10, 8);
    const pos = portfolio.position('AAPL');
    expect(pos?.quantity).toBe(100);
    expect(pos?.avgPrice).toBeCloseTo(100.02, 10);
  });

  it('rejects buys that cannot be afforded and leaves the ledger untouched', () => {
    const executor = new ExecutionService(
      createCostModel({ commission: { rate: 0.001 }, slippage: { mode: 'fixed', value: 0.02 } }),
    );
    const portfolio = new Portfolio(5_000);

    const result = executor.execute(makeOrder(), BAR, portfolio);

    expect(result).toMatchObject({ status: 'rejected', code: 'insufficient_cash' });
    expect(portfolio.cash).toBe(5_000);
    expect(portfolio.positions).toHaveLength(0);
  });

  it('rejects sells without an open position', () => {
    const executor = new ExecutionService(createCostModel());
    const portfolio = new Portfolio(20_000);

    const result = executor.execute(makeOrder({ side: 'sell' }), BAR, portfolio);

    expect(result).toMatchObject({ status: 'rejected', code: 'insufficient_position' });
  });

  it('sells credit notional minus commission and reduce the position', () => {
    const executor = new ExecutionService(
      createCostModel({ commission: { rate: 0.001 }, slippage: { mode: 'fixed', value: 0.02 } }),
    );
    const portfolio = new Portfolio(20_000);
    apply(portfolio, executor.execute(makeOrder(), BAR, portfolio));

    const result = executor.execute(makeOrder({ side: 'sell', quantity: 60 }), BAR, portfolio);

    expect(result.status).toBe('filled');
    if (result.status !== 'filled') return;
    // Sell executes at 100 - 0.02 = 99.98.
    expect(result.fill.price).toBeCloseTo(99.98, 10);
    expect(result.fill.notional).toBeCloseTo(5_998.8, 8);
    expect(result.fill.commission).toBe(6);
    expect(result.fill.slippageCost).toBeCloseTo(1.2, 10);

    portfolio.applyFill(result.fill);
    expect(portfolio.cash).toBeCloseTo(15_980.8, 6);
    expect(portfolio.position('AAPL')?.quantity).toBe(40);
    expect(portfolio.position('AAPL')?.avgPrice).toBeCloseTo(100.02, 10);
  });

  it('floors quantity to the configured lot size', () => {
    const executor = new ExecutionService(createCostModel(), { lotSize: 100 });
    const portfolio = new Portfolio(1_000_000);

    const partial = executor.execute(makeOrder({ quantity: 250 }), BAR, portfolio);
    expect(partial.status).toBe('filled');
    if (partial.status === 'filled') {
      expect(partial.fill.quantity).toBe(200);
    }

    const tooSmall = executor.execute(makeOrder({ id: 'o-2', quantity: 50 }), BAR, portfolio);
    expect(tooSmall).toMatchObject({ status: 'rejected', code: 'invalid_order' });
  });

  it('rejects structurally invalid orders', () => {
    const executor = new ExecutionService(createCostModel());
    const portfolio = new Portfolio(20_000);

    expect(executor.execute(makeOrder({ quantity: 0 }), BAR, portfolio)).toMatchObject({
      status: 'rejected',
      code: 'invalid_order',
    });
    expect(executor.execute(makeOrder({ quantity: -5 }), BAR, portfolio)).toMatchObject({
      status: 'rejected',
      code: 'invalid_order',
    });
    expect(executor.execute(makeOrder({ quantity: Number.NaN }), BAR, portfolio)).toMatchObject({
      status: 'rejected',
      code: 'invalid_order',
    });
    expect(executor.execute(makeOrder({ symbol: '  ' }), BAR, portfolio)).toMatchObject({
      status: 'rejected',
      code: 'invalid_order',
    });
  });

  it('uses a zero-cost model by default and fills exactly at close', () => {
    const executor = new ExecutionService(createCostModel());
    const portfolio = new Portfolio(20_000);

    const result = executor.execute(makeOrder(), BAR, portfolio);

    expect(result.status).toBe('filled');
    if (result.status !== 'filled') return;
    expect(result.fill.price).toBe(100);
    expect(result.fill.notional).toBe(10_000);
    expect(result.fill.commission).toBe(0);
    expect(result.fill.slippageCost).toBe(0);
  });
});
