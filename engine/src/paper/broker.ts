/**
 * Paper broker (P1-7): a deterministic simulated exchange.
 *
 * Orders are driven by price events (`onPrice`): every call replays one
 * market tick/bar close against the open orders in submission order.
 * Market orders fill on the first event for their symbol; limit orders
 * fill only while the (post-slippage) price does not breach the limit.
 * Liquidity can be capped per event to exercise partial fills.
 *
 * The broker owns a {@link Portfolio}: every fill is applied to cash and
 * positions exactly as in the backtest core, so paper results are directly
 * comparable with backtest results.
 */

import { EngineError } from '../core/errors.js';
import { floorToLot, roundTo } from '../core/money.js';
import type { Fill } from '../core/types.js';
import { createCostModel, type CostModel } from '../cost/index.js';
import { Portfolio } from '../execution/portfolio.js';
import {
  TERMINAL_STATES,
  type OrderRecord,
  type OrderRequest,
  type OrderState,
  type OrderTransition,
  type PaperBrokerConfig,
  type PaperOrder,
} from './types.js';

/** Legal transitions of the order state machine (targets per source). */
const LEGAL_TRANSITIONS: Record<OrderState, readonly OrderState[]> = {
  created: ['submitted', 'cancelled', 'rejected'],
  submitted: ['partially_filled', 'filled', 'cancelled', 'rejected'],
  partially_filled: ['partially_filled', 'filled', 'cancelled', 'rejected'],
  filled: [],
  cancelled: [],
  rejected: [],
};

/** Internal mutable state for one order. */
interface MutableOrderState {
  readonly order: PaperOrder;
  state: OrderState;
  filledQuantity: number;
  commissionPaid: number;
  costBasis: number;
  readonly transitions: OrderTransition[];
  readonly fills: Fill[];
  rejectReason?: string;
}

/**
 * Deterministic paper trading executor with an audited order state
 * machine.
 */
export class PaperBroker {
  private readonly costModel: CostModel;
  private readonly lotSize: number;
  private readonly maxFillPerEvent: number;
  private readonly portfolioRef: Portfolio;
  private readonly orderStates: Map<string, MutableOrderState> = new Map();
  private readonly eventLog: OrderTransition[] = [];

  /**
   * @param config - Initial cash, cost model, lot size and liquidity cap.
   * @throws {@link EngineError} with code `invalid_portfolio_state` for a
   * bad initial cash (delegated from Portfolio).
   */
  constructor(config: PaperBrokerConfig) {
    this.costModel = createCostModel(config.cost ?? {});
    this.lotSize = config.execution?.lotSize ?? 1;
    this.maxFillPerEvent = config.maxFillQuantityPerEvent ?? Number.POSITIVE_INFINITY;
    this.portfolioRef = new Portfolio(config.initialCash);
  }

  /** Current paper account ledger. */
  public get portfolio(): Portfolio {
    return this.portfolioRef;
  }

  /**
   * Register a new order in the `created` state.
   *
   * @param request - Order request.
   * @returns The stored order.
   * @throws {@link EngineError} with code `invalid_order` for a duplicate
   * id, empty symbol, non-positive quantity, or a limit order without a
   * positive limit price.
   */
  public createOrder(request: OrderRequest): PaperOrder {
    if (this.orderStates.has(request.orderId)) {
      throw new EngineError('invalid_order', `duplicate order id ${request.orderId}`);
    }
    if (request.symbol.trim() === '') {
      throw new EngineError('invalid_order', 'symbol must be a non-empty string');
    }
    if (!Number.isFinite(request.quantity) || request.quantity <= 0) {
      throw new EngineError('invalid_order', `quantity must be > 0, got ${request.quantity}`);
    }
    if (
      request.type === 'limit' &&
      (!Number.isFinite(request.limitPrice ?? Number.NaN) || (request.limitPrice ?? 0) <= 0)
    ) {
      throw new EngineError('invalid_order', 'limit orders require a positive limitPrice');
    }

    const order: PaperOrder = {
      orderId: request.orderId,
      symbol: request.symbol,
      side: request.side,
      type: request.type,
      quantity: request.quantity,
      limitPrice: request.type === 'limit' ? request.limitPrice : undefined,
      createdAt: request.timestamp,
    };
    const state: MutableOrderState = {
      order,
      state: 'created',
      filledQuantity: 0,
      commissionPaid: 0,
      costBasis: 0,
      transitions: [],
      fills: [],
    };
    this.appendTransition(state, null, 'created', request.timestamp);
    this.orderStates.set(request.orderId, state);
    return order;
  }

  /**
   * Move a created order into the matching queue.
   *
   * @param orderId - Order to submit.
   * @param timestamp - Event time.
   * @returns True when the transition happened; false when the order is
   * unknown or not in the `created` state.
   */
  public submitOrder(orderId: string, timestamp: number): boolean {
    const state = this.orderStates.get(orderId);
    if (!state || state.state !== 'created') {
      return false;
    }
    this.record(state, 'submitted', timestamp);
    return true;
  }

  /**
   * Cancel an order. Fills already executed remain in the ledger.
   *
   * @param orderId - Order to cancel.
   * @param timestamp - Event time.
   * @param reason - Optional explanation recorded in the audit log.
   * @returns True when cancelled; false when unknown or already terminal.
   */
  public cancelOrder(orderId: string, timestamp: number, reason?: string): boolean {
    const state = this.orderStates.get(orderId);
    if (!state || TERMINAL_STATES.has(state.state)) {
      return false;
    }
    this.record(state, 'cancelled', timestamp, reason);
    return true;
  }

  /**
   * Replay one price event for a symbol against all open orders.
   *
   * Open orders (submission order) may receive a fill chunk
   * `min(remaining, maxFillQuantityPerEvent)` floored to the lot size when
   * the price qualifies. Insufficient cash or position at fill time
   * rejects the remainder of the order (terminal `rejected`).
   *
   * @param symbol - Symbol the price belongs to.
   * @param price - Market price for this event (e.g. bar close).
   * @param timestamp - Event time.
   * @returns Fills executed during this event (in submission order).
   */
  public onPrice(symbol: string, price: number, timestamp: number): Fill[] {
    if (!Number.isFinite(price) || price < 0) {
      throw new EngineError('invalid_input', `price must be finite >= 0, got ${price}`);
    }
    const fills: Fill[] = [];
    for (const state of this.orderStates.values()) {
      if (state.order.symbol !== symbol) {
        continue;
      }
      if (state.state !== 'submitted' && state.state !== 'partially_filled') {
        continue;
      }
      const fill = this.tryFill(state, price, timestamp);
      if (fill) {
        fills.push(fill);
      }
    }
    return fills;
  }

  /**
   * Look up one order's full record.
   *
   * @param orderId - Order id.
   * @returns The record, or undefined when unknown.
   */
  public getOrder(orderId: string): OrderRecord | undefined {
    const state = this.orderStates.get(orderId);
    return state ? snapshot(state) : undefined;
  }

  /** All order records in creation order. */
  public orders(): OrderRecord[] {
    return [...this.orderStates.values()].map(snapshot);
  }

  /** Global chronological transition log (audit trail). */
  public events(): OrderTransition[] {
    return [...this.eventLog];
  }

  /**
   * Attempt to fill one open order against a price event.
   *
   * @param state - Mutable order state.
   * @param price - Event price.
   * @param timestamp - Event time.
   * @returns The fill, or null when the price does not qualify or the
   * order was rejected.
   */
  private tryFill(state: MutableOrderState, price: number, timestamp: number): Fill | null {
    const { order } = state;
    const execPrice = this.costModel.applySlippage(order.side, price);

    if (!this.priceQualifies(order, execPrice)) {
      return null;
    }

    const remaining = order.quantity - state.filledQuantity;
    const chunk = floorToLot(Math.min(remaining, this.maxFillPerEvent), this.lotSize);
    if (chunk <= 0) {
      return null;
    }

    const notional = roundTo(execPrice * chunk, 2);
    const commission = this.costModel.calcCommission(execPrice, chunk);

    if (order.side === 'buy') {
      const required = roundTo(notional + commission, 2);
      if (required > this.portfolioRef.cash + 1e-9) {
        this.record(
          state,
          'rejected',
          timestamp,
          `insufficient cash: need ${required}, have ${this.portfolioRef.cash}`,
        );
        return null;
      }
    } else {
      const held = this.portfolioRef.position(order.symbol)?.quantity ?? 0;
      if (chunk > held + 1e-9) {
        this.record(
          state,
          'rejected',
          timestamp,
          `insufficient position: sell ${chunk}, hold ${held}`,
        );
        return null;
      }
    }

    const fill: Fill = {
      orderId: order.orderId,
      symbol: order.symbol,
      side: order.side,
      quantity: chunk,
      price: execPrice,
      notional,
      commission,
      slippageCost: roundTo(Math.abs(execPrice - price) * chunk, 2),
      filledAt: timestamp,
    };
    this.portfolioRef.applyFill(fill);

    state.fills.push(fill);
    state.filledQuantity += chunk;
    state.commissionPaid += commission;
    state.costBasis += notional;

    const nextState: OrderState =
      state.filledQuantity >= order.quantity - 1e-9 ? 'filled' : 'partially_filled';
    this.record(state, nextState, timestamp);
    return fill;
  }

  /**
   * Whether a post-slippage price qualifies for this order.
   *
   * @param order - The open order.
   * @param execPrice - Post-slippage execution price.
   * @returns True for market orders always; for limit orders when the
   * execution price does not breach the limit.
   */
  private priceQualifies(order: PaperOrder, execPrice: number): boolean {
    if (order.type === 'market') {
      return true;
    }
    return order.side === 'buy' ? execPrice <= order.limitPrice! : execPrice >= order.limitPrice!;
  }

  /**
   * Record a state transition after validating legality.
   *
   * @param state - Mutable order state.
   * @param to - Target state.
   * @param timestamp - Event time.
   * @param reason - Optional explanation.
   * @throws {@link EngineError} with code `invalid_input` for an illegal
   * transition (defensive; internal call sites are exhaustive).
   */
  private record(
    state: MutableOrderState,
    to: OrderState,
    timestamp: number,
    reason?: string,
  ): void {
    if (!LEGAL_TRANSITIONS[state.state].includes(to)) {
      throw new EngineError(
        'invalid_input',
        `illegal transition ${state.state} -> ${to} for order ${state.order.orderId}`,
      );
    }
    this.appendTransition(state, state.state, to, timestamp, reason);
    state.state = to;
    if (to === 'rejected' && reason !== undefined) {
      state.rejectReason = reason;
    }
  }

  /**
   * Append a transition to both the order and the global audit log.
   *
   * @param state - Mutable order state.
   * @param from - Source state (null for creation).
   * @param to - Target state.
   * @param timestamp - Event time.
   * @param reason - Optional explanation.
   */
  private appendTransition(
    state: MutableOrderState,
    from: OrderState | null,
    to: OrderState,
    timestamp: number,
    reason?: string,
  ): void {
    const transition: OrderTransition = {
      from,
      to,
      timestamp,
      ...(reason !== undefined ? { reason } : {}),
    };
    state.transitions.push(transition);
    this.eventLog.push(transition);
  }
}

/**
 * Build an immutable snapshot of one order's state.
 *
 * @param state - Mutable order state.
 * @returns The public record.
 */
function snapshot(state: MutableOrderState): OrderRecord {
  return {
    order: state.order,
    state: state.state,
    filledQuantity: state.filledQuantity,
    averageFillPrice: state.filledQuantity > 0 ? state.costBasis / state.filledQuantity : 0,
    commissionPaid: state.commissionPaid,
    transitions: [...state.transitions],
    fills: [...state.fills],
    rejectReason: state.rejectReason,
  };
}
