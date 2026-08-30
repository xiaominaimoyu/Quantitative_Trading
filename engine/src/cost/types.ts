/**
 * Transaction cost model contracts (P0-1).
 *
 * The cost model is injected into the execution layer; strategies and the
 * backtest loop never hard-code fees. Every parameter is configuration,
 * never a magic constant inside the computation path.
 */

import type { Side } from '../core/types.js';

/**
 * Commission configuration.
 *
 * The effective commission of a fill is
 * `fixedPerTrade + max(rate * notional, minFee)` where every omitted term
 * is treated as zero. This single expression covers the requested modes:
 *
 * - Fixed fee only: set `fixedPerTrade`.
 * - Proportional fee only: set `rate`.
 * - Minimum-fee floor: set `rate` + `minFee` (typical broker schedule).
 * - Any combination of the above.
 */
export interface CommissionConfig {
  /** Fee as a fraction of fill notional, e.g. `0.0003` = 3 bps. Default 0. */
  rate?: number;
  /** Minimum fee per fill, applied when `rate * notional` is smaller. Default 0. */
  minFee?: number;
  /** Absolute fee charged on every fill, stacked on top of the rest. Default 0. */
  fixedPerTrade?: number;
}

/**
 * Slippage configuration.
 *
 * Slippage always moves against the trade direction: buys execute higher,
 * sells execute lower. The executed price never drops below zero.
 */
export interface SlippageConfig {
  /**
   * - `'none'`: no slippage.
   * - `'fixed'`: absolute price offset in quote currency.
   * - `'bps'`: offset proportional to price, `price * value / 10_000`.
   */
  mode: 'none' | 'fixed' | 'bps';
  /**
   * Offset magnitude. For `'fixed'` this is an absolute price amount; for
   * `'bps'` this is in basis points (e.g. `5` = 0.05%). Must be >= 0.
   */
  value: number;
}

/** Full cost configuration passed to the cost model factory. */
export interface CostConfig {
  /** Commission schedule. Omit for zero fees. */
  commission?: CommissionConfig;
  /** Slippage schedule. Omit for no slippage. */
  slippage?: SlippageConfig;
}

/**
 * Pluggable transaction cost interface consumed by the execution layer.
 *
 * Implementations must be deterministic and stateless: the same inputs
 * must always yield the same outputs so backtests are reproducible.
 */
export interface CostModel {
  /**
   * Apply slippage to a raw market price for the given side.
   *
   * @param side - Trade direction; buys slip up, sells slip down.
   * @param price - Raw market price (e.g. bar close).
   * @returns The simulated execution price (>= 0).
   * @throws {@link ConfigError} if `price` is not finite or negative.
   */
  applySlippage(side: Side, price: number): number;

  /**
   * Compute the commission for a would-be fill.
   *
   * @param fillPrice - Executed (post-slippage) price per share.
   * @param quantity - Executed quantity in shares.
   * @returns Commission in quote currency, rounded to 2 decimals.
   * @throws {@link ConfigError} if inputs are not finite or negative.
   */
  calcCommission(fillPrice: number, quantity: number): number;
}
