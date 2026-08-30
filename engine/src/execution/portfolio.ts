/**
 * Portfolio ledger: cash and position accounting.
 *
 * The ledger is intentionally dumb — it applies fills and answers
 * valuation queries. Decision logic (affordability checks, risk rules)
 * lives in the execution/risk layers so that accounting and policy are
 * independently testable.
 */

import type { Fill, Position } from '../core/types.js';
import { EngineError } from '../core/errors.js';

/**
 * Cash + positions ledger used by the backtest core (and, later, by the
 * paper trading executor).
 */
export class Portfolio {
  private _cash: number;
  private readonly _positions: Map<string, Position> = new Map();

  /**
   * @param initialCash - Starting cash in quote currency; must be finite and >= 0.
   * @throws {@link EngineError} with code `invalid_portfolio_state` on bad input.
   */
  constructor(initialCash: number) {
    if (!Number.isFinite(initialCash) || initialCash < 0) {
      throw new EngineError(
        'invalid_portfolio_state',
        `initialCash must be a finite number >= 0, got ${initialCash}`,
      );
    }
    this._cash = initialCash;
  }

  /** Current cash balance in quote currency. */
  public get cash(): number {
    return this._cash;
  }

  /** Snapshot of all open positions (order not specified). */
  public get positions(): Position[] {
    return [...this._positions.values()];
  }

  /**
   * Look up the position of a symbol.
   *
   * @param symbol - Instrument symbol.
   * @returns The open position, or `undefined` when flat.
   */
  public position(symbol: string): Position | undefined {
    return this._positions.get(symbol);
  }

  /**
   * Apply a fill to the ledger: cash moves by signed notional minus
   * commission, and the position quantity/average price is updated.
   *
   * Buys debit `notional + commission`; sells credit `notional - commission`.
   * Fees are expensed to cash and are not capitalized into `avgPrice`.
   *
   * @param fill - Fill previously validated by the execution layer.
   * @throws {@link EngineError} with code `invalid_portfolio_state` if a sell
   * would exceed the open position (indicates a caller bug, not a policy
   * rejection — policy rejections happen before fills exist).
   */
  public applyFill(fill: Fill): void {
    const cashDelta =
      fill.side === 'buy' ? -(fill.notional + fill.commission) : fill.notional - fill.commission;
    this._cash += cashDelta;

    const existing = this._positions.get(fill.symbol);
    if (fill.side === 'buy') {
      const newQuantity = (existing?.quantity ?? 0) + fill.quantity;
      const cost = (existing?.quantity ?? 0) * (existing?.avgPrice ?? 0) + fill.notional;
      this._positions.set(fill.symbol, {
        symbol: fill.symbol,
        quantity: newQuantity,
        avgPrice: cost / newQuantity,
      });
      return;
    }

    // Sell path.
    const held = existing?.quantity ?? 0;
    if (fill.quantity > held + 1e-9) {
      throw new EngineError(
        'invalid_portfolio_state',
        `sell of ${fill.quantity} ${fill.symbol} exceeds open position ${held}`,
      );
    }
    const remaining = held - fill.quantity;
    if (remaining <= 1e-9) {
      this._positions.delete(fill.symbol);
      return;
    }
    this._positions.set(fill.symbol, {
      symbol: fill.symbol,
      quantity: remaining,
      avgPrice: existing?.avgPrice ?? 0,
    });
  }

  /**
   * Mark-to-market equity: cash plus the market value of all positions.
   *
   * Symbols without a price in `prices` are conservatively valued at their
   * average entry cost so the curve never silently drops to zero.
   *
   * @param prices - Latest price per symbol.
   * @returns Total equity in quote currency.
   */
  public equity(prices: Readonly<Record<string, number>>): number {
    let equity = this._cash;
    for (const p of this._positions.values()) {
      const price = prices[p.symbol];
      equity += p.quantity * (typeof price === 'number' ? price : p.avgPrice);
    }
    return equity;
  }
}
