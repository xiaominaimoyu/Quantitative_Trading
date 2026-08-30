/**
 * Minimal strategy seam for the backtest core (P0-2).
 *
 * The full plugin SDK (lifecycle hooks, loader, template) lands in P2-8;
 * for now the engine needs exactly one contract: react to a bar, return
 * orders. Risk checks and cost application happen downstream — strategies
 * only express intent.
 */

import type { Bar, Order } from '../core/types.js';

/** Read-only portfolio snapshot handed to strategies (no mutation path). */
export interface PortfolioSnapshot {
  readonly cash: number;
  readonly positions: readonly {
    readonly symbol: string;
    readonly quantity: number;
    readonly avgPrice: number;
  }[];
}

/** Context passed to the strategy for every bar. */
export interface BarContext {
  readonly bar: Bar;
  /** Equity marked at the previous close (or initial cash on day one). */
  readonly equity: number;
  /** Read-only ledger snapshot as of the previous close. */
  readonly portfolio: PortfolioSnapshot;
}

/**
 * Strategy contract consumed by the backtest engine.
 *
 * Implementations must be deterministic: the same context sequence must
 * produce the same orders, or experiments are not reproducible (P0-4).
 */
export interface BacktestStrategy {
  /** Stable strategy identifier used in logs and reports. */
  readonly id: string;
  /**
   * Called once per (timestamp, symbol) bar in deterministic order.
   *
   * @param ctx - Bar, previous-close equity and portfolio snapshot.
   * @returns Orders to submit through the risk layer (possibly empty).
   */
  onBar(ctx: BarContext): Order[];
}
