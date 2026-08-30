/**
 * Backtest main loop (P0-2).
 *
 * Wiring per (timestamp, symbol) bar, in deterministic order:
 *
 *   strategy.onBar -> risk.checkOrder -> execution.execute -> portfolio
 *   then at each close: mark equity -> risk exits (stop loss)
 *   -> risk limits (daily loss / drawdown) -> equity curve point.
 *
 * Determinism rules: bars are iterated in ascending timestamp order and
 * input symbol order; all costs and quantities are rounded through
 * `core/money`; no wall-clock or randomness participates in the loop.
 */

import { EngineError } from '../core/errors.js';
import type { Bar, Fill, Order, Side } from '../core/types.js';
import { createCostModel, type CostConfig } from '../cost/index.js';
import {
  DEFAULT_EXECUTION_CONFIG,
  ExecutionService,
  Portfolio,
  type ExecutionConfig,
} from '../execution/index.js';
import { RiskManager, type RiskEvent, type RiskLimits } from '../risk/index.js';
import type { BacktestStrategy, BarContext, PortfolioSnapshot } from './strategy.js';

/** Milliseconds per UTC day, used to detect trading-day boundaries. */
const MS_PER_DAY = 86_400_000;

/** Backtest inputs: strategy plus per-symbol bar series. */
export interface BacktestInput {
  readonly strategy: BacktestStrategy;
  /** Bars per symbol, each series sorted by ascending timestamp. */
  readonly bars: Readonly<Record<string, readonly Bar[]>>;
}

/** Backtest configuration (every knob explicit, none hard-coded). */
export interface BacktestConfig {
  readonly initialCash: number;
  /** Cost model configuration (commission + slippage). */
  readonly cost?: CostConfig;
  /** Risk limits applied between signals and execution. */
  readonly risk?: RiskLimits;
  /** Execution layer configuration (fill policy, lot size). */
  readonly execution?: Partial<ExecutionConfig>;
}

/** One point of the equity curve, marked at each close. */
export interface EquityPoint {
  readonly timestamp: number;
  readonly equity: number;
  readonly cash: number;
}

/** Audit entry for every order the engine processed. */
export interface OrderLogEntry {
  readonly timestamp: number;
  readonly orderId: string;
  readonly symbol: string;
  readonly side: Side;
  readonly requestedQuantity: number;
  /** Quantity actually submitted after risk reduction, if any. */
  readonly submittedQuantity?: number;
  readonly outcome: 'filled' | 'rejected' | 'risk_rejected' | 'halted';
  /** Rejection explanation when the outcome is not `filled`. */
  readonly reason?: string;
}

/** Complete, auditable result of one backtest run. */
export interface BacktestResult {
  /** Equity curve, one point per processed close. */
  readonly equityCurve: EquityPoint[];
  readonly fills: Fill[];
  readonly riskEvents: RiskEvent[];
  readonly orderLog: OrderLogEntry[];
  /** Final ledger snapshot (cash + open positions). */
  readonly finalPortfolio: PortfolioSnapshot;
}

/**
 * Run a strategy over historical bars under cost and risk policies.
 *
 * @param input - Strategy and bar data.
 * @param config - Initial cash, cost, risk and execution configuration.
 * @returns The full audit trail: equity curve, fills, risk events, order log.
 * @throws {@link EngineError} with code `invalid_input` when bars are
 * missing, unsorted, or contain duplicate timestamps per symbol.
 */
export function runBacktest(input: BacktestInput, config: BacktestConfig): BacktestResult {
  const symbols = Object.keys(input.bars);
  if (symbols.length === 0) {
    throw new EngineError('invalid_input', 'bars must contain at least one symbol');
  }
  const barsBySymbol = new Map<string, Map<number, Bar>>();
  const timestampSet = new Set<number>();
  for (const symbol of symbols) {
    const series = input.bars[symbol];
    if (!series || series.length === 0) {
      throw new EngineError('invalid_input', `symbol ${symbol} has no bars`);
    }
    const map = new Map<number, Bar>();
    let previous = Number.NEGATIVE_INFINITY;
    for (const bar of series) {
      if (bar.timestamp <= previous) {
        throw new EngineError(
          'invalid_input',
          `symbol ${symbol} bars must be strictly ascending with unique timestamps (got ${bar.timestamp} after ${previous})`,
        );
      }
      map.set(bar.timestamp, bar);
      timestampSet.add(bar.timestamp);
      previous = bar.timestamp;
    }
    barsBySymbol.set(symbol, map);
  }

  const executionConfig: ExecutionConfig = { ...DEFAULT_EXECUTION_CONFIG, ...config.execution };
  const portfolio = new Portfolio(config.initialCash);
  const executor = new ExecutionService(createCostModel(config.cost ?? {}), executionConfig);
  const risk = new RiskManager(config.risk ?? {});

  const equityCurve: EquityPoint[] = [];
  const fills: Fill[] = [];
  const riskEvents: RiskEvent[] = [];
  const orderLog: OrderLogEntry[] = [];
  const latestPrices: Record<string, number> = {};

  const timestamps = [...timestampSet].sort((a, b) => a - b);
  let lastEquity = config.initialCash;
  let lastDay = Number.NaN;

  for (const timestamp of timestamps) {
    const day = Math.floor(timestamp / MS_PER_DAY);
    if (day !== lastDay) {
      risk.onDayStart(lastEquity);
      lastDay = day;
    }

    for (const symbol of symbols) {
      const bar = barsBySymbol.get(symbol)?.get(timestamp);
      if (!bar) {
        continue;
      }

      const orders = input.strategy.onBar(snapshotContext(symbol, bar, lastEquity, portfolio));
      for (const order of orders) {
        processOrder(order, bar, timestamp, {
          equity: lastEquity,
          portfolio,
          executor,
          risk,
          lotSize: executionConfig.lotSize,
          fills,
          riskEvents,
          orderLog,
        });
      }

      latestPrices[symbol] = bar.close;
    }

    let equity = portfolio.equity(latestPrices);
    risk.onEquity(equity);

    // Risk-triggered exits: stop loss per position.
    for (const directive of risk.evaluateExits(latestPrices, portfolio, timestamp)) {
      executeForcedSell(
        `risk-stop-${directive.symbol}-${timestamp}`,
        directive.symbol,
        directive.quantity,
        barAt(barsBySymbol, directive.symbol, timestamp),
        portfolio,
        executor,
        fills,
        orderLog,
        timestamp,
      );
      riskEvents.push(directive.event);
    }

    equity = portfolio.equity(latestPrices);

    // Circuit breakers: daily loss limit and drawdown kill switch.
    const limitDirectives = risk.evaluateLimits(equity, portfolio, timestamp);
    riskEvents.push(...limitDirectives.events);
    for (const symbol of limitDirectives.liquidateSymbols) {
      const position = portfolio.position(symbol);
      if (!position) {
        continue;
      }
      executeForcedSell(
        `risk-liquidate-${symbol}-${timestamp}`,
        symbol,
        position.quantity,
        barAt(barsBySymbol, symbol, timestamp),
        portfolio,
        executor,
        fills,
        orderLog,
        timestamp,
      );
    }

    equityCurve.push({ timestamp, equity, cash: portfolio.cash });
    lastEquity = equity;
  }

  return {
    equityCurve,
    fills,
    riskEvents,
    orderLog,
    finalPortfolio: { cash: portfolio.cash, positions: portfolio.positions },
  };
}

/**
 * Run one strategy order through halt gate, risk check, execution, ledger.
 *
 * @param order - Strategy order to process.
 * @param bar - Bar at which the order is submitted.
 * @param timestamp - Same as `bar.timestamp` (explicit for log entries).
 * @param ctx - Previous-close equity, collaborators and audit sinks.
 */
function processOrder(
  order: Order,
  bar: Bar,
  timestamp: number,
  ctx: {
    equity: number;
    portfolio: Portfolio;
    executor: ExecutionService;
    risk: RiskManager;
    lotSize: number;
    fills: Fill[];
    riskEvents: RiskEvent[];
    orderLog: OrderLogEntry[];
  },
): void {
  const base = {
    timestamp,
    orderId: order.id,
    symbol: order.symbol,
    side: order.side,
    requestedQuantity: order.quantity,
  };

  if (ctx.risk.isHalted()) {
    ctx.orderLog.push({
      ...base,
      outcome: 'halted',
      reason: 'risk halt is active (daily loss or drawdown)',
    });
    ctx.riskEvents.push(haltEvent(timestamp, order.symbol));
    return;
  }

  const decision = ctx.risk.checkOrder(order, {
    timestamp,
    price: bar.close,
    equity: ctx.equity,
    portfolio: ctx.portfolio,
    lotSize: ctx.lotSize,
  });
  if (!decision.allowed) {
    ctx.orderLog.push({
      ...base,
      outcome: 'risk_rejected',
      reason: decision.event.detail,
    });
    ctx.riskEvents.push(decision.event);
    return;
  }

  const submittedQuantity = decision.quantity ?? order.quantity;
  const entry: Omit<OrderLogEntry, 'outcome'> = {
    ...base,
    submittedQuantity: decision.quantity !== undefined ? decision.quantity : undefined,
  };
  if (decision.event) {
    ctx.riskEvents.push(decision.event);
  }

  const result = ctx.executor.execute(
    { ...order, quantity: submittedQuantity },
    bar,
    ctx.portfolio,
  );
  if (result.status === 'filled') {
    ctx.portfolio.applyFill(result.fill);
    ctx.fills.push(result.fill);
    ctx.orderLog.push({ ...entry, outcome: 'filled' });
    return;
  }
  ctx.orderLog.push({ ...entry, outcome: 'rejected', reason: result.reason });
}

/**
 * Build the strategy context with a read-only portfolio snapshot.
 *
 * @param symbol - Symbol the bar belongs to.
 * @param bar - Current bar.
 * @param equity - Previous-close equity.
 * @param portfolio - Ledger to snapshot.
 * @returns Frozen-ish context for the strategy.
 */
function snapshotContext(
  symbol: string,
  bar: Bar,
  equity: number,
  portfolio: Portfolio,
): BarContext {
  return {
    symbol,
    bar,
    equity,
    portfolio: {
      cash: portfolio.cash,
      positions: portfolio.positions.map((p) => ({ ...p })),
    },
  };
}

/**
 * Execute a risk-mandated sell (stop loss / kill-switch liquidation).
 *
 * Forced sells bypass risk order checks (the risk layer itself mandated
 * them) but still flow through the execution layer for costs and lot rules.
 *
 * @param orderId - Synthetic order id for the audit trail.
 * @param symbol - Symbol to liquidate.
 * @param quantity - Position quantity to sell.
 * @param bar - Bar on which the sell executes (may be undefined when the
 * symbol has no bar at this timestamp; the sell is then skipped).
 * @param portfolio - Ledger.
 * @param executor - Execution service.
 * @param fills - Fill sink.
 * @param orderLog - Order log sink.
 * @param timestamp - Log timestamp.
 */
function executeForcedSell(
  orderId: string,
  symbol: string,
  quantity: number,
  bar: Bar | undefined,
  portfolio: Portfolio,
  executor: ExecutionService,
  fills: Fill[],
  orderLog: OrderLogEntry[],
  timestamp: number,
): void {
  if (!bar) {
    orderLog.push({
      timestamp,
      orderId,
      symbol,
      side: 'sell',
      requestedQuantity: quantity,
      outcome: 'rejected',
      reason: 'no bar available at this timestamp for forced sell',
    });
    return;
  }
  const result = executor.execute(
    { id: orderId, symbol, side: 'sell', type: 'market', quantity },
    bar,
    portfolio,
  );
  if (result.status === 'filled') {
    portfolio.applyFill(result.fill);
    fills.push(result.fill);
    orderLog.push({
      timestamp,
      orderId,
      symbol,
      side: 'sell',
      requestedQuantity: quantity,
      outcome: 'filled',
    });
    return;
  }
  orderLog.push({
    timestamp,
    orderId,
    symbol,
    side: 'sell',
    requestedQuantity: quantity,
    outcome: 'rejected',
    reason: result.reason,
  });
}

/**
 * Look up a symbol's bar at a timestamp.
 *
 * @param barsBySymbol - Prebuilt per-symbol timestamp maps.
 * @param symbol - Symbol to look up.
 * @param timestamp - Timestamp to look up.
 * @returns The bar, or undefined when absent.
 */
function barAt(
  barsBySymbol: Map<string, Map<number, Bar>>,
  symbol: string,
  timestamp: number,
): Bar | undefined {
  return barsBySymbol.get(symbol)?.get(timestamp);
}

/**
 * Synthetic halt event for the halted-order fast path.
 *
 * @param timestamp - Detection time.
 * @param symbol - Blocked order symbol.
 * @returns A `trading_halted` risk event.
 */
function haltEvent(timestamp: number, symbol: string): RiskEvent {
  return {
    timestamp,
    code: 'trading_halted',
    action: 'order_rejected',
    symbol,
    detail: 'order blocked: risk halt is active (daily loss or drawdown)',
  };
}
