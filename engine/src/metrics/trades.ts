/**
 * Trade reconstruction from fills (P1-5).
 *
 * Fills are paired FIFO per symbol: every sell closes one round-trip trade
 * that may span several entry lots. Commissions are allocated per share so
 * partial matches carry their fair share of fees. Buy fills without a
 * matching sell remain open lots and never become trades.
 */

import type { Fill } from '../core/types.js';
import type { ClosedTrade } from './types.js';

/** An open entry lot awaiting a matching sell. */
interface OpenLot {
  readonly timestamp: number;
  quantity: number;
  readonly price: number;
  /** Commission per share for this lot. */
  readonly feePerShare: number;
}

/**
 * Reconstruct closed round-trip trades from a fill sequence.
 *
 * @param fills - Fills in execution order (as produced by the engine).
 * @returns Closed trades in execution order.
 */
export function pairFillsIntoTrades(fills: readonly Fill[]): ClosedTrade[] {
  const lots = new Map<string, OpenLot[]>();
  const trades: ClosedTrade[] = [];

  for (const fill of fills) {
    if (fill.side === 'buy') {
      const queue = lots.get(fill.symbol) ?? [];
      queue.push({
        timestamp: fill.filledAt,
        quantity: fill.quantity,
        price: fill.price,
        feePerShare: fill.commission / fill.quantity,
      });
      lots.set(fill.symbol, queue);
      continue;
    }

    // Sell: match FIFO against open lots.
    const queue = lots.get(fill.symbol);
    if (!queue || queue.length === 0) {
      continue;
    }
    let remaining = fill.quantity;
    let matchedQty = 0;
    let entryCost = 0;
    let entryFees = 0;
    let openTimestamp = Number.POSITIVE_INFINITY;

    while (remaining > 0 && queue.length > 0) {
      const lot = queue[0]!;
      const matched = Math.min(lot.quantity, remaining);
      matchedQty += matched;
      entryCost += lot.price * matched;
      entryFees += lot.feePerShare * matched;
      if (lot.timestamp < openTimestamp) {
        openTimestamp = lot.timestamp;
      }
      lot.quantity -= matched;
      remaining -= matched;
      if (lot.quantity <= 1e-9) {
        queue.shift();
      }
    }

    if (matchedQty <= 0) {
      continue;
    }
    const exitFees = (fill.commission / fill.quantity) * matchedQty;
    const grossPnl = fill.price * matchedQty - entryCost;
    const fees = entryFees + exitFees;
    trades.push({
      symbol: fill.symbol,
      openTimestamp,
      closeTimestamp: fill.filledAt,
      quantity: matchedQty,
      entryAvgPrice: entryCost / matchedQty,
      exitAvgPrice: fill.price,
      grossPnl,
      fees,
      netPnl: grossPnl - fees,
    });
  }

  return trades;
}
