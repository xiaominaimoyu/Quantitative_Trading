import { describe, expect, it } from 'vitest';
import {
  PaperBroker,
  type Fill,
  type OrderRequest,
} from '../src/index.js';

const T1 = 1_700_000_000_000;

function request(partial: Partial<OrderRequest> = {}): OrderRequest {
  return {
    orderId: 'o-1',
    symbol: 'X',
    side: 'buy',
    type: 'market',
    quantity: 100,
    timestamp: T1,
    ...partial,
  };
}

function fillOf(symbol: string, side: 'buy' | 'sell', qty: number, price: number): Fill {
  return {
    orderId: 'x',
    symbol,
    side,
    quantity: qty,
    price,
    notional: qty * price,
    commission: 0,
    slippageCost: 0,
    filledAt: T1,
  };
}

describe('PaperBroker — market order lifecycle', () => {
  it('walks created -> submitted -> filled on the next price event', () => {
    const broker = new PaperBroker({ initialCash: 20_000 });
    broker.createOrder(request());
    expect(broker.getOrder('o-1')?.state).toBe('created');

    expect(broker.submitOrder('o-1', T1)).toBe(true);
    expect(broker.getOrder('o-1')?.state).toBe('submitted');

    const fills = broker.onPrice('X', 100, T1 + 1);
    expect(fills).toHaveLength(1);
    expect(fills[0]).toMatchObject({ quantity: 100, price: 100, filledAt: T1 + 1 });

    const record = broker.getOrder('o-1')!;
    expect(record.state).toBe('filled');
    expect(record.filledQuantity).toBe(100);
    expect(record.averageFillPrice).toBe(100);
    expect(record.transitions.map((t) => t.to)).toEqual([
      'created',
      'submitted',
      'filled',
    ]);
    expect(broker.portfolio.cash).toBe(10_000);
    expect(broker.portfolio.position('X')).toMatchObject({ quantity: 100, avgPrice: 100 });
  });

  it('rejects unknown and repeated submissions', () => {
    const broker = new PaperBroker({ initialCash: 20_000 });
    expect(broker.submitOrder('ghost', T1)).toBe(false);
    broker.createOrder(request());
    expect(broker.submitOrder('o-1', T1)).toBe(true);
    expect(broker.submitOrder('o-1', T1)).toBe(false);
  });
});

describe('PaperBroker — partial fills', () => {
  it('splits fills across price events and tracks the average price', () => {
    const broker = new PaperBroker({
      initialCash: 20_000,
      maxFillQuantityPerEvent: 60,
    });
    broker.createOrder(request());
    broker.submitOrder('o-1', T1);

    expect(broker.onPrice('X', 100, T1 + 1)).toHaveLength(1);
    const afterFirst = broker.getOrder('o-1')!;
    expect(afterFirst.state).toBe('partially_filled');
    expect(afterFirst.filledQuantity).toBe(60);

    expect(broker.onPrice('X', 101, T1 + 2)).toHaveLength(1);
    const record = broker.getOrder('o-1')!;
    expect(record.state).toBe('filled');
    expect(record.filledQuantity).toBe(100);
    expect(record.averageFillPrice).toBeCloseTo(100.4, 10);
    expect(record.transitions.map((t) => t.to)).toEqual([
      'created',
      'submitted',
      'partially_filled',
      'filled',
    ]);
    expect(broker.portfolio.cash).toBeCloseTo(20_000 - 6_000 - 4_040, 8);
  });

  it('charges the minimum fee per partial fill', () => {
    const broker = new PaperBroker({
      initialCash: 20_000,
      cost: { commission: { rate: 0.001, minFee: 5 } },
      maxFillQuantityPerEvent: 10,
    });
    broker.createOrder(request({ quantity: 20 }));
    broker.submitOrder('o-1', T1);
    broker.onPrice('X', 100, T1 + 1);
    broker.onPrice('X', 100, T1 + 2);

    const record = broker.getOrder('o-1')!;
    expect(record.commissionPaid).toBeCloseTo(5 + 5, 10);
    expect(broker.portfolio.cash).toBeCloseTo(20_000 - 2_000 - 10, 8);
  });

  it('floors chunks to the lot size and may strand the remainder', () => {
    const broker = new PaperBroker({
      initialCash: 1_000_000,
      execution: { lotSize: 100 },
      maxFillQuantityPerEvent: 150,
    });
    broker.createOrder(request({ quantity: 250 }));
    broker.submitOrder('o-1', T1);

    broker.onPrice('X', 10, T1 + 1);
    expect(broker.getOrder('o-1')?.state).toBe('partially_filled');

    broker.onPrice('X', 10, T1 + 2);
    const record = broker.getOrder('o-1')!;
    expect(record.filledQuantity).toBe(200);
    expect(record.state).toBe('partially_filled');
  });
});

describe('PaperBroker — limit orders', () => {
  it('fills limit buys when the post-slippage price respects the limit', () => {
    const broker = new PaperBroker({
      initialCash: 20_000,
      cost: { slippage: { mode: 'fixed', value: 0.5 } },
    });
    broker.createOrder(request({ type: 'limit', limitPrice: 100 }));
    broker.submitOrder('o-1', T1);

    // 99 + 0.5 = 99.5 <= 100: fills.
    expect(broker.onPrice('X', 99, T1 + 1)).toHaveLength(1);
    expect(broker.getOrder('o-1')?.state).toBe('filled');
    expect(broker.getOrder('o-1')?.averageFillPrice).toBeCloseTo(99.5, 10);
  });

  it('skips events whose slippage-adjusted price exceeds the limit', () => {
    const broker = new PaperBroker({
      initialCash: 20_000,
      cost: { slippage: { mode: 'fixed', value: 0.5 } },
    });
    broker.createOrder(request({ type: 'limit', limitPrice: 100 }));
    broker.submitOrder('o-1', T1);

    expect(broker.onPrice('X', 100, T1 + 1)).toHaveLength(0); // 100.5 > 100
    expect(broker.getOrder('o-1')?.state).toBe('submitted');
    expect(broker.onPrice('X', 99.4, T1 + 2)).toHaveLength(1); // 99.9 <= 100
    expect(broker.getOrder('o-1')?.state).toBe('filled');
    expect(broker.getOrder('o-1')?.averageFillPrice).toBeCloseTo(99.9, 10);
  });

  it('fills limit sells only at or above the limit', () => {
    const broker = new PaperBroker({ initialCash: 20_000 });
    broker.portfolio.applyFill(fillOf('X', 'buy', 100, 90));

    broker.createOrder(request({ side: 'sell', type: 'limit', limitPrice: 100 }));
    broker.submitOrder('o-1', T1);

    expect(broker.onPrice('X', 95, T1 + 1)).toHaveLength(0);
    expect(broker.getOrder('o-1')?.state).toBe('submitted');
    expect(broker.onPrice('X', 100, T1 + 2)).toHaveLength(1);
    expect(broker.getOrder('o-1')?.state).toBe('filled');
  });
});

describe('PaperBroker — cancellation', () => {
  it('cancels created and submitted orders', () => {
    const broker = new PaperBroker({ initialCash: 20_000 });
    broker.createOrder(request({ orderId: 'a' }));
    broker.createOrder(request({ orderId: 'b' }));
    broker.submitOrder('b', T1);

    expect(broker.cancelOrder('a', T1 + 1, 'user')).toBe(true);
    expect(broker.cancelOrder('b', T1 + 1)).toBe(true);
    expect(broker.getOrder('a')?.state).toBe('cancelled');
    expect(broker.getOrder('b')?.state).toBe('cancelled');
    expect(broker.submitOrder('a', T1 + 2)).toBe(false);
    expect(broker.cancelOrder('a', T1 + 3)).toBe(false);
    expect(broker.cancelOrder('ghost', T1 + 3)).toBe(false);
  });

  it('keeps executed fills when cancelling a partially filled order', () => {
    const broker = new PaperBroker({
      initialCash: 20_000,
      maxFillQuantityPerEvent: 60,
    });
    broker.createOrder(request());
    broker.submitOrder('o-1', T1);
    broker.onPrice('X', 100, T1 + 1);

    expect(broker.cancelOrder('o-1', T1 + 2)).toBe(true);
    const record = broker.getOrder('o-1')!;
    expect(record.state).toBe('cancelled');
    expect(record.filledQuantity).toBe(60);
    expect(broker.onPrice('X', 100, T1 + 3)).toHaveLength(0);
    expect(record.transitions.map((t) => t.to)).toEqual([
      'created',
      'submitted',
      'partially_filled',
      'cancelled',
    ]);
  });

  it('refuses to cancel terminal orders', () => {
    const broker = new PaperBroker({ initialCash: 20_000 });
    broker.createOrder(request());
    broker.submitOrder('o-1', T1);
    broker.onPrice('X', 100, T1 + 1);
    expect(broker.cancelOrder('o-1', T1 + 2)).toBe(false);
  });
});

describe('PaperBroker — rejections', () => {
  it('rejects buys that cannot be afforded at fill time', () => {
    const broker = new PaperBroker({ initialCash: 500 });
    broker.createOrder(request({ quantity: 100 }));
    broker.submitOrder('o-1', T1);

    expect(broker.onPrice('X', 10, T1 + 1)).toHaveLength(0);
    const record = broker.getOrder('o-1')!;
    expect(record.state).toBe('rejected');
    expect(record.rejectReason).toContain('insufficient cash');
    expect(record.transitions.at(-1)).toMatchObject({ from: 'submitted', to: 'rejected' });
    expect(broker.onPrice('X', 1, T1 + 2)).toHaveLength(0);
  });

  it('rejects sells without sufficient position', () => {
    const broker = new PaperBroker({ initialCash: 20_000 });
    broker.createOrder(request({ side: 'sell' }));
    broker.submitOrder('o-1', T1);

    expect(broker.onPrice('X', 100, T1 + 1)).toHaveLength(0);
    expect(broker.getOrder('o-1')?.state).toBe('rejected');
  });

  it('drains cash across orders submitted for the same event', () => {
    const broker = new PaperBroker({ initialCash: 15_000 });
    broker.createOrder(request({ orderId: 'a', quantity: 100 }));
    broker.createOrder(request({ orderId: 'b', quantity: 100 }));
    broker.submitOrder('a', T1);
    broker.submitOrder('b', T1);

    const fills = broker.onPrice('X', 100, T1 + 1);
    expect(fills).toHaveLength(1);
    expect(broker.getOrder('a')?.state).toBe('filled');
    expect(broker.getOrder('b')?.state).toBe('rejected');
  });
});

describe('PaperBroker — input guards', () => {
  it('rejects duplicate ids and structurally invalid requests', () => {
    const broker = new PaperBroker({ initialCash: 20_000 });
    broker.createOrder(request());
    expect(() => broker.createOrder(request())).toThrow(
      expect.objectContaining({ code: 'invalid_order' }),
    );
    expect(() => broker.createOrder(request({ orderId: 'o-2', quantity: 0 }))).toThrow(
      expect.objectContaining({ code: 'invalid_order' }),
    );
    expect(() =>
      broker.createOrder(request({ orderId: 'o-3', type: 'limit' })),
    ).toThrow(expect.objectContaining({ code: 'invalid_order' }));
    expect(() =>
      broker.createOrder(request({ orderId: 'o-4', symbol: ' ' })),
    ).toThrow(expect.objectContaining({ code: 'invalid_order' }));
    expect(broker.getOrder('ghost')).toBeUndefined();
  });

  it('rejects invalid prices', () => {
    const broker = new PaperBroker({ initialCash: 20_000 });
    expect(() => broker.onPrice('X', -1, T1)).toThrow(
      expect.objectContaining({ code: 'invalid_input' }),
    );
    expect(() => broker.onPrice('X', Number.NaN, T1)).toThrow(
      expect.objectContaining({ code: 'invalid_input' }),
    );
  });
});

describe('PaperBroker — audit trail and determinism', () => {
  it('keeps a chronological global event log with reasons', () => {
    const broker = new PaperBroker({ initialCash: 500 });
    broker.createOrder(request());
    broker.submitOrder('o-1', T1);
    broker.onPrice('X', 10, T1 + 1);

    const events = broker.events();
    expect(events.map((e) => e.to)).toEqual(['created', 'submitted', 'rejected']);
    expect(events.at(-1)?.reason).toContain('insufficient cash');
    expect(events.at(-1)?.timestamp).toBe(T1 + 1);
  });

  it('produces identical ledgers for identical sequences', () => {
    const run = (): number[] => {
      const broker = new PaperBroker({
        initialCash: 20_000,
        maxFillQuantityPerEvent: 40,
        cost: { commission: { rate: 0.001 } },
      });
      broker.createOrder(request({ orderId: 'a', quantity: 120 }));
      broker.createOrder(request({ orderId: 'b', side: 'sell', quantity: 120 }));
      broker.submitOrder('a', T1);
      broker.submitOrder('b', T1);
      broker.onPrice('X', 100, T1 + 1);
      broker.onPrice('X', 101, T1 + 2);
      broker.onPrice('X', 102, T1 + 3);
      return broker.orders().map((r) => [r.filledQuantity, r.averageFillPrice]).flat();
    };
    expect(run()).toEqual(run());
  });
});
