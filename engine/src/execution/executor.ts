/**
 * Execution layer: the seam where the cost model plugs into order flow (P0-1).
 *
 * `ExecutionService.execute` is the single place where a strategy order
 * becomes a cost-attributed fill in the backtest core. It never mutates the
 * portfolio; the caller applies the returned fill via
 * `Portfolio.applyFill`, keeping validation and accounting separate.
 *
 * Rejections carry a machine-readable `code` so the risk layer (P0-2) and
 * the audit log can record exactly why an order did not trade.
 */

import type { CostModel } from '../cost/types.js';
import { roundTo, floorToLot } from '../core/money.js';
import type { Bar, Fill, Order } from '../core/types.js';
import type { Portfolio } from './portfolio.js';

/** Machine-readable rejection codes produced by the execution layer. */
export type RejectionCode = 'invalid_order' | 'insufficient_cash' | 'insufficient_position';

/** Outcome of an execution attempt. */
export type ExecutionResult =
  | { readonly status: 'filled'; readonly fill: Fill }
  | { readonly status: 'rejected'; readonly code: RejectionCode; readonly reason: string };

/** Fill policy supported by the backtest core. */
export type FillPolicy = 'bar_close';

/** Execution layer configuration (all knobs, no magic numbers). */
export interface ExecutionConfig {
  /**
   * Which price inside a bar is used as the raw market price before
   * slippage. Currently only `'bar_close'` is supported.
   */
  fillPolicy: FillPolicy;
  /**
   * Quantity lot size, floored into. `1` allows any share count; set `100`
   * for A-share style board lots. Default `1`.
   */
  lotSize: number;
}

/** Default execution config: close-price fills, no lot constraint. */
export const DEFAULT_EXECUTION_CONFIG: ExecutionConfig = {
  fillPolicy: 'bar_close',
  lotSize: 1,
};

/** Tolerance used when comparing cash requirements against available cash. */
const CASH_TOLERANCE = 1e-9;

/**
 * Deterministic execution service for backtests.
 *
 * Pricing pipeline for a market order:
 * 1. raw price = per `fillPolicy` (currently bar close);
 * 2. executed price = cost model slippage applied against trade direction;
 * 3. quantity floored to the configured lot size;
 * 4. notional = executed price x quantity (2-decimal rounding);
 * 5. commission = cost model commission on the executed notional.
 */
export class ExecutionService {
  private readonly costModel: CostModel;
  private readonly config: ExecutionConfig;

  /**
   * @param costModel - Injected cost model (commission + slippage).
   * @param config - Execution knobs; missing fields fall back to
   * {@link DEFAULT_EXECUTION_CONFIG}.
   */
  constructor(costModel: CostModel, config: Partial<ExecutionConfig> = {}) {
    this.costModel = costModel;
    this.config = { ...DEFAULT_EXECUTION_CONFIG, ...config };
  }

  /**
   * Attempt to fill a market order on a bar.
   *
   * The portfolio is only read (cash / position checks); it is never
   * mutated here. Apply the returned fill with `Portfolio.applyFill`.
   *
   * @param order - Market order produced by the strategy (post risk checks).
   * @param bar - Bar on which the order is executed.
   * @param portfolio - Ledger used for affordability and position checks.
   * @returns A {@link Fill} on success, or a structured rejection.
   */
  public execute(order: Order, bar: Bar, portfolio: Portfolio): ExecutionResult {
    if (!Number.isFinite(order.quantity) || order.quantity <= 0) {
      return reject('invalid_order', `quantity must be > 0, got ${order.quantity}`);
    }
    if (order.symbol.trim() === '') {
      return reject('invalid_order', 'symbol must be a non-empty string');
    }

    const rawPrice = this.rawPrice(bar);
    const price = this.costModel.applySlippage(order.side, rawPrice);
    const quantity = floorToLot(order.quantity, this.config.lotSize);
    if (quantity <= 0) {
      return reject(
        'invalid_order',
        `quantity ${order.quantity} floors to 0 at lot size ${this.config.lotSize}`,
      );
    }

    const notional = roundTo(price * quantity, 2);
    const commission = this.costModel.calcCommission(price, quantity);
    const slippageCost = roundTo(Math.abs(price - rawPrice) * quantity, 2);

    if (order.side === 'buy') {
      const required = roundTo(notional + commission, 2);
      if (required > portfolio.cash + CASH_TOLERANCE) {
        return reject(
          'insufficient_cash',
          `requires ${required} (notional ${notional} + commission ${commission}) but cash is ${portfolio.cash}`,
        );
      }
    } else {
      const held = portfolio.position(order.symbol)?.quantity ?? 0;
      if (quantity > held + CASH_TOLERANCE) {
        return reject(
          'insufficient_position',
          `sell of ${quantity} exceeds open position ${held} of ${order.symbol}`,
        );
      }
    }

    return {
      status: 'filled',
      fill: {
        orderId: order.id,
        symbol: order.symbol,
        side: order.side,
        quantity,
        price,
        notional,
        commission,
        slippageCost,
        filledAt: bar.timestamp,
      },
    };
  }

  /**
   * Raw market price for a bar under the configured fill policy.
   *
   * @param bar - Bar to price from.
   * @returns The raw price before slippage.
   * @throws {@link Error} for unknown policies (defensive; the type system
   * already narrows this).
   */
  private rawPrice(bar: Bar): number {
    switch (this.config.fillPolicy) {
      case 'bar_close':
        return bar.close;
    }
  }
}

/**
 * Build a structured rejection.
 *
 * @param code - Machine-readable rejection code.
 * @param reason - Human-readable explanation for logs.
 * @returns A rejected {@link ExecutionResult}.
 */
function reject(code: RejectionCode, reason: string): ExecutionResult {
  return { status: 'rejected', code, reason };
}
