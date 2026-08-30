/**
 * Risk control contracts (P0-2).
 *
 * The risk layer sits between strategy signals and the execution layer.
 * It never sees strategy internals and never mutates the portfolio: it
 * returns decisions and directives, and the backtest loop enforces them.
 * Every trigger is reported as a {@link RiskEvent} so the audit trail
 * explains exactly why an order was blocked, reduced, or liquidated.
 */

import type { Portfolio } from '../execution/portfolio.js';

/**
 * Configurable risk limits. Every value is a fraction in `(0, 1]`
 * (e.g. `0.1` = 10%). Omitted limits are disabled. All thresholds are
 * configuration — nothing is hard-coded.
 */
export interface RiskLimits {
  /**
   * Per-position stop loss: force-liquidate a position at close when
   * `close <= avgPrice * (1 - stopLossPct)`.
   */
  stopLossPct?: number;
  /**
   * Maximum single-position exposure: buys are reduced (or rejected) so
   * that `position notional <= maxPositionPct * equity`.
   */
  maxPositionPct?: number;
  /**
   * Daily loss circuit breaker: when equity falls more than this fraction
   * below the day-start equity, order submission is halted until the next
   * trading day (UTC date of the bar timestamp).
   */
  maxDailyLossPct?: number;
  /**
   * Maximum drawdown kill switch: when equity falls more than this
   * fraction below its historical peak, all positions are liquidated and
   * trading is halted for the rest of the run.
   */
  maxDrawdownPct?: number;
}

/** Machine-readable reason codes for risk events. */
export type RiskEventCode =
  | 'stop_loss'
  | 'max_position'
  | 'daily_loss_limit'
  | 'drawdown_limit'
  | 'trading_halted';

/** Action the risk layer took (or requested the engine to take). */
export type RiskAction = 'order_rejected' | 'position_reduced' | 'liquidation' | 'halt';

/** One auditable risk trigger. */
export interface RiskEvent {
  /** Epoch milliseconds (UTC) when the trigger was detected. */
  readonly timestamp: number;
  readonly code: RiskEventCode;
  readonly action: RiskAction;
  /** Affected symbol, when the event is position-specific. */
  readonly symbol?: string;
  /** Human-readable explanation for logs and reports. */
  readonly detail: string;
}

/** Context the risk layer needs to evaluate a would-be order. */
export interface OrderRiskContext {
  /** Bar timestamp at which the order would be submitted. */
  readonly timestamp: number;
  /** Current market price of the order symbol (bar close). */
  readonly price: number;
  /** Equity marked at the previous close (no lookahead). */
  readonly equity: number;
  /** Ledger for position lookups (read-only usage). */
  readonly portfolio: Portfolio;
  /** Lot size used to floor reduced quantities. */
  readonly lotSize: number;
}

/** Risk decision for one order. */
export type OrderRiskDecision =
  | { allowed: true; /** Possibly reduced quantity to submit. */ quantity?: number; event?: RiskEvent }
  | { allowed: false; event: RiskEvent };

/** A forced exit the risk layer asks the engine to execute. */
export interface ExitDirective {
  readonly symbol: string;
  readonly quantity: number;
  readonly event: RiskEvent;
}

/** Directives produced by end-of-bar limit evaluation. */
export interface LimitDirectives {
  /** Halt order submission until the next trading day. */
  readonly haltForDay: boolean;
  /** Halt order submission for the rest of the run (kill switch). */
  readonly haltPersistent: boolean;
  /** Symbols the engine must liquidate immediately. */
  readonly liquidateSymbols: readonly string[];
  readonly events: readonly RiskEvent[];
}
