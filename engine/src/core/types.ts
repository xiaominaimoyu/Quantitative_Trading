/**
 * Core domain primitives shared by every engine module.
 *
 * Conventions:
 * - All timestamps are epoch milliseconds (UTC). The engine core is
 *   timezone-free; exchange-local time normalization belongs to the data
 *   quality pipeline (`src/data`, P0-3).
 * - All monetary values are plain floats expressed in the quote currency.
 *   Deterministic rounding is applied at fill boundaries via `roundTo`.
 * - Quantities are share counts; lot constraints are applied by the
 *   execution layer, not by strategies.
 */

/** Direction of a trade. */
export type Side = 'buy' | 'sell';

/** Supported order types in the backtest core. */
export type OrderType = 'market';

/**
 * A single OHLCV candle.
 *
 * Prices and volume are plain floats in exchange units. The engine never
 * mutates bars; treat them as immutable inputs.
 */
export interface Bar {
  /** Epoch milliseconds (UTC) of the bar open time. */
  readonly timestamp: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
}

/**
 * An order as produced by a strategy (before risk checks).
 *
 * Risk evaluation and execution consume this shape; the execution layer is
 * free to reject it or to adjust quantity down to lot constraints.
 */
export interface Order {
  /** Unique order id assigned by the caller (engine or strategy). */
  readonly id: string;
  readonly symbol: string;
  readonly side: Side;
  readonly type: OrderType;
  /** Requested quantity in shares; must be a finite number > 0. */
  readonly quantity: number;
}

/**
 * An executed trade with full cost attribution.
 *
 * `price` already includes slippage; `slippageCost` records the absolute
 * cash impact of slippage versus the untouched market price, and
 * `commission` records the fee charged for the fill.
 */
export interface Fill {
  readonly orderId: string;
  readonly symbol: string;
  readonly side: Side;
  readonly quantity: number;
  /** Executed price after slippage. */
  readonly price: number;
  /** `price * quantity`, rounded to 2 decimals. */
  readonly notional: number;
  /** Commission charged for this fill (already rounded). */
  readonly commission: number;
  /** Absolute slippage cost in quote currency (already rounded). */
  readonly slippageCost: number;
  /** Epoch milliseconds (UTC) of execution. */
  readonly filledAt: number;
}

/** Net position of a single symbol. */
export interface Position {
  readonly symbol: string;
  /** Positive for long. Negative positions are not supported in the core. */
  readonly quantity: number;
  /** Volume-weighted average entry price (excluding fees). */
  readonly avgPrice: number;
}
