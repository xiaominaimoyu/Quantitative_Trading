/**
 * Unified risk manager (P0-2).
 *
 * Stateless with respect to strategies, stateful only in limit bookkeeping
 * (day-start equity, peak equity, halt latches). Deterministic: identical
 * event sequences produce identical decisions.
 */

import { ConfigError } from '../core/errors.js';
import { floorToLot } from '../core/money.js';
import type { Order } from '../core/types.js';
import type { Portfolio } from '../execution/portfolio.js';
import type {
  ExitDirective,
  LimitDirectives,
  OrderRiskContext,
  OrderRiskDecision,
  RiskEvent,
  RiskLimits,
} from './types.js';

/** Percentage limits bookkeeping requires once provided. */
type EnforcedLimits = {
  stopLossPct?: number;
  maxPositionPct?: number;
  maxDailyLossPct?: number;
  maxDrawdownPct?: number;
};

/**
 * Validate a fraction limit.
 *
 * @param name - Limit key (for error messages).
 * @param value - Configured value.
 * @throws {@link ConfigError} when the value is not in `(0, 1]`.
 */
function assertPctLimit(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0 || value > 1) {
    throw new ConfigError(
      `risk limit ${name} must be a fraction in (0, 1], got ${value}`,
      'invalid_risk_config',
    );
  }
}

/**
 * Central risk checkpoint between strategy signals and order execution.
 *
 * Supported guards (all optional, all configurable via {@link RiskLimits}):
 * - stop loss — forced position liquidation on adverse close;
 * - max position ratio — buys are reduced or rejected to cap exposure;
 * - daily loss limit — circuit breaker halting order submission for the
 *   remainder of the trading day;
 * - drawdown protection — kill switch liquidating everything and halting
 *   the run when equity falls below a peak-to-trough threshold.
 */
export class RiskManager {
  private readonly limits: EnforcedLimits;
  private dayStartEquity = 0;
  private peakEquity = 0;
  private haltedForDay = false;
  private haltedPersistent = false;

  /**
   * @param limits - Risk limits; an empty object yields a pass-through
   * manager that records nothing and blocks nothing.
   * @throws {@link ConfigError} if any provided limit is outside `(0, 1]`.
   */
  constructor(limits: RiskLimits = {}) {
    const enforced: EnforcedLimits = {};
    if (limits.stopLossPct !== undefined) {
      assertPctLimit('stopLossPct', limits.stopLossPct);
      enforced.stopLossPct = limits.stopLossPct;
    }
    if (limits.maxPositionPct !== undefined) {
      assertPctLimit('maxPositionPct', limits.maxPositionPct);
      enforced.maxPositionPct = limits.maxPositionPct;
    }
    if (limits.maxDailyLossPct !== undefined) {
      assertPctLimit('maxDailyLossPct', limits.maxDailyLossPct);
      enforced.maxDailyLossPct = limits.maxDailyLossPct;
    }
    if (limits.maxDrawdownPct !== undefined) {
      assertPctLimit('maxDrawdownPct', limits.maxDrawdownPct);
      enforced.maxDrawdownPct = limits.maxDrawdownPct;
    }
    this.limits = enforced;
  }

  /**
   * Called by the engine when a new trading day starts (UTC date change).
   *
   * Resets the daily circuit breaker and records the day-start equity
   * reference for the daily-loss limit.
   *
   * @param equity - Equity marked at the previous close (or initial cash).
   */
  public onDayStart(equity: number): void {
    this.dayStartEquity = equity;
    this.haltedForDay = false;
  }

  /**
   * Called by the engine after every close to track the equity peak.
   *
   * @param equity - Equity marked at the current close.
   */
  public onEquity(equity: number): void {
    this.peakEquity = Math.max(this.peakEquity, equity);
  }

  /**
   * Whether order submission is currently halted (daily or persistent).
   */
  public isHalted(): boolean {
    return this.haltedForDay || this.haltedPersistent;
  }

  /**
   * Pre-trade check for one order: halt gate plus max-position cap.
   *
   * Buys exceeding `maxPositionPct * equity` of total position notional are
   * reduced down to the largest allowed lot quantity, or rejected when no
   * quantity would fit. Sells pass through untouched.
   *
   * @param order - Order about to be submitted.
   * @param ctx - Market/portfolio context for the check.
   * @returns An allow (possibly with a reduced quantity) or a rejection
   * carrying the auditable event.
   */
  public checkOrder(order: Order, ctx: OrderRiskContext): OrderRiskDecision {
    if (this.isHalted()) {
      return {
        allowed: false,
        event: {
          timestamp: ctx.timestamp,
          code: 'trading_halted',
          action: 'order_rejected',
          symbol: order.symbol,
          detail: 'order blocked: risk halt is active (daily loss or drawdown)',
        },
      };
    }

    const maxPct = this.limits.maxPositionPct;
    if (order.side !== 'buy' || maxPct === undefined) {
      return { allowed: true };
    }

    const held = ctx.portfolio.position(order.symbol)?.quantity ?? 0;
    const room = maxPct * ctx.equity - held * ctx.price;
    if (room <= 0) {
      return {
        allowed: false,
        event: {
          timestamp: ctx.timestamp,
          code: 'max_position',
          action: 'order_rejected',
          symbol: order.symbol,
          detail: `buy rejected: position notional cap ${maxPct * ctx.equity} reached (held ${held} @ ${ctx.price})`,
        },
      };
    }

    const maxQuantity = floorToLot(room / ctx.price, ctx.lotSize);
    if (maxQuantity <= 0) {
      return {
        allowed: false,
        event: {
          timestamp: ctx.timestamp,
          code: 'max_position',
          action: 'order_rejected',
          symbol: order.symbol,
          detail: `buy rejected: allowed notional ${room} buys fewer than one lot of ${ctx.lotSize}`,
        },
      };
    }

    if (order.quantity <= maxQuantity) {
      return { allowed: true };
    }

    return {
      allowed: true,
      quantity: maxQuantity,
      event: {
        timestamp: ctx.timestamp,
        code: 'max_position',
        action: 'position_reduced',
        symbol: order.symbol,
        detail: `buy reduced from ${order.quantity} to ${maxQuantity} to respect ${maxPct * ctx.equity} notional cap`,
      },
    };
  }

  /**
   * End-of-bar stop-loss scan: returns liquidation directives for positions
   * whose latest close breached `avgPrice * (1 - stopLossPct)`.
   *
   * @param prices - Latest close per symbol.
   * @param portfolio - Ledger to scan for open positions.
   * @param timestamp - Bar timestamp for event stamping.
   * @returns One directive per triggered position (empty when the limit is
   * disabled or no position breached).
   */
  public evaluateExits(
    prices: Readonly<Record<string, number>>,
    portfolio: Pick<Portfolio, 'positions'>,
    timestamp: number,
  ): ExitDirective[] {
    const stopPct = this.limits.stopLossPct;
    if (stopPct === undefined) {
      return [];
    }
    const directives: ExitDirective[] = [];
    for (const position of portfolio.positions) {
      const price = prices[position.symbol];
      if (price === undefined) {
        continue;
      }
      const stopPrice = position.avgPrice * (1 - stopPct);
      if (price <= stopPrice) {
        directives.push({
          symbol: position.symbol,
          quantity: position.quantity,
          event: {
            timestamp,
            code: 'stop_loss',
            action: 'liquidation',
            symbol: position.symbol,
            detail: `stop loss: close ${price} <= stop ${stopPrice} (avg ${position.avgPrice}, -${stopPct * 100}%)`,
          },
        });
      }
    }
    return directives;
  }

  /**
   * End-of-bar circuit breakers: daily loss limit and drawdown kill switch.
   *
   * Each breaker latches on first breach (no duplicate events) and — for the
   * drawdown kill switch — requests liquidation of every open position.
   *
   * @param equity - Equity marked at the current close.
   * @param portfolio - Ledger to scan for liquidation targets.
   * @param timestamp - Bar timestamp for event stamping.
   * @returns Halt flags, liquidation targets and audited events.
   */
  public evaluateLimits(
    equity: number,
    portfolio: Pick<Portfolio, 'positions'>,
    timestamp: number,
  ): LimitDirectives {
    const events: RiskEvent[] = [];
    let haltForDay = false;
    let haltPersistent = false;
    const liquidateSymbols: string[] = [];

    const dailyPct = this.limits.maxDailyLossPct;
    if (
      dailyPct !== undefined &&
      !this.haltedForDay &&
      this.dayStartEquity > 0 &&
      equity < this.dayStartEquity * (1 - dailyPct)
    ) {
      haltForDay = true;
      this.haltedForDay = true;
      events.push({
        timestamp,
        code: 'daily_loss_limit',
        action: 'halt',
        detail: `daily loss limit: equity ${equity} below day-start ${this.dayStartEquity} by more than ${dailyPct * 100}%`,
      });
    }

    const drawdownPct = this.limits.maxDrawdownPct;
    if (
      drawdownPct !== undefined &&
      !this.haltedPersistent &&
      this.peakEquity > 0 &&
      equity < this.peakEquity * (1 - drawdownPct)
    ) {
      haltPersistent = true;
      this.haltedPersistent = true;
      for (const position of portfolio.positions) {
        liquidateSymbols.push(position.symbol);
      }
      events.push({
        timestamp,
        code: 'drawdown_limit',
        action: 'halt',
        detail: `drawdown kill switch: equity ${equity} below peak ${this.peakEquity} by more than ${drawdownPct * 100}%; liquidating ${liquidateSymbols.length} position(s)`,
      });
      events.push({
        timestamp,
        code: 'drawdown_limit',
        action: 'liquidation',
        detail: `liquidating all open positions: ${liquidateSymbols.join(', ') || 'none'}`,
      });
    }

    return { haltForDay, haltPersistent, liquidateSymbols, events };
  }
}
