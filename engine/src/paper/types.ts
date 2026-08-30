/**
 * Paper trading contracts (P1-7).
 *
 * The paper broker simulates an exchange matching engine over price
 * events. Orders traverse an explicit, audited state machine:
 *
 *   created -> submitted -> partially_filled -> filled
 *                    |             |
 *                    +-> cancelled +-> cancelled
 *                    +-> rejected  +-> rejected
 *
 * `created` may also go straight to `cancelled`/`rejected` on submission
 * failure. Terminal states are `filled`, `cancelled`, `rejected`.
 */

import type { Fill, Side } from '../core/types.js';

/** States of the paper-trading order state machine. */
export type OrderState =
  | 'created'
  | 'submitted'
  | 'partially_filled'
  | 'filled'
  | 'cancelled'
  | 'rejected';

/** States from which no further transition is legal. */
export const TERMINAL_STATES: ReadonlySet<OrderState> = new Set([
  'filled',
  'cancelled',
  'rejected',
]);

/** Supported paper order types. */
export type PaperOrderType = 'market' | 'limit';

/** A single state transition recorded in the audit log. */
export interface OrderTransition {
  readonly from: OrderState | null;
  readonly to: OrderState;
  /** Caller-provided event time (epoch ms, UTC). */
  readonly timestamp: number;
  /** Explanation for rejections and other notable transitions. */
  readonly reason?: string;
}

/** Request accepted by `PaperBroker.createOrder`. */
export interface OrderRequest {
  /** Client-supplied unique order id. */
  readonly orderId: string;
  readonly symbol: string;
  readonly side: Side;
  readonly type: PaperOrderType;
  /** Requested quantity in shares; must be > 0. */
  readonly quantity: number;
  /** Required (and must be > 0) for limit orders. */
  readonly limitPrice?: number;
  /** Creation event time (epoch ms, UTC). */
  readonly timestamp: number;
}

/** An order as stored by the broker. */
export interface PaperOrder {
  readonly orderId: string;
  readonly symbol: string;
  readonly side: Side;
  readonly type: PaperOrderType;
  readonly quantity: number;
  readonly limitPrice?: number;
  readonly createdAt: number;
}

/** Full, auditable state of one order inside the broker. */
export interface OrderRecord {
  readonly order: PaperOrder;
  readonly state: OrderState;
  readonly filledQuantity: number;
  /** Volume-weighted average price across partial fills (post-slippage). */
  readonly averageFillPrice: number;
  readonly commissionPaid: number;
  readonly transitions: readonly OrderTransition[];
  readonly fills: readonly Fill[];
  /** Rejection explanation when state is `rejected`. */
  readonly rejectReason?: string;
}

/** Paper broker configuration (all knobs, no magic numbers). */
export interface PaperBrokerConfig {
  readonly initialCash: number;
  /** Cost model configuration (commission + slippage). */
  readonly cost?: import('../cost/types.js').CostConfig;
  /** Execution knobs; only `lotSize` is used by the paper broker. */
  readonly execution?: { readonly lotSize?: number };
  /**
   * Liquidity cap: maximum quantity fillable per price event. Partial
   * fills only occur when this is finite. Default Infinity.
   */
  readonly maxFillQuantityPerEvent?: number;
}
