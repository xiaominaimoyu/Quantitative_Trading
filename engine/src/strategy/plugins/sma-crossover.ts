/**
 * Example strategy plugin: SMA crossover (P2-8 template).
 *
 * The canonical double moving-average strategy:
 * - golden cross (fast crosses above slow) -> buy a fixed quantity;
 * - death cross (fast crosses below slow) -> liquidate the held position.
 *
 * It demonstrates the full plugin lifecycle (parameter validation, factory
 * with per-instance closure state, per-bar signals, teardown) and doubles
 * as a copy-paste starting point for new strategies.
 */

import type { Order } from '../../core/types.js';
import { defineStrategy } from '../registry.js';
import type { StrategyPlugin } from '../types.js';

/** Parameters of the SMA crossover template. */
export type SmaCrossoverParams = {
  /** Symbol to trade. */
  symbol: string;
  /** Fast SMA length (bars). Must be < slowPeriod. */
  fastPeriod: number;
  /** Slow SMA length (bars). */
  slowPeriod: number;
  /** Buy quantity on golden cross. */
  quantity: number;
};

/** Default parameters (all overridable, all validated). */
export const SMA_CROSSOVER_DEFAULTS: SmaCrossoverParams = {
  symbol: 'TEST',
  fastPeriod: 5,
  slowPeriod: 20,
  quantity: 100,
};

/**
 * Validate merged parameters.
 *
 * @param params - Merged parameters.
 * @returns Error messages (empty when valid).
 */
export function validateSmaCrossoverParams(params: SmaCrossoverParams): string[] {
  const errors: string[] = [];
  if (params.symbol.trim() === '') {
    errors.push('symbol must be a non-empty string');
  }
  if (!Number.isInteger(params.fastPeriod) || params.fastPeriod < 1) {
    errors.push('fastPeriod must be an integer >= 1');
  }
  if (!Number.isInteger(params.slowPeriod) || params.slowPeriod < 1) {
    errors.push('slowPeriod must be an integer >= 1');
  }
  if (params.fastPeriod >= params.slowPeriod) {
    errors.push('fastPeriod must be smaller than slowPeriod');
  }
  if (!Number.isFinite(params.quantity) || params.quantity <= 0) {
    errors.push('quantity must be a positive number');
  }
  return errors;
}

/**
 * The SMA crossover plugin (example template).
 *
 * Every `create` call produces an independent instance with its own price
 * history, so the same plugin can safely run in multiple experiments.
 */
export const smaCrossoverPlugin: StrategyPlugin<SmaCrossoverParams> =
  defineStrategy<SmaCrossoverParams>({
    id: 'sma-crossover',
    description:
      'Double moving-average crossover: buy on golden cross, liquidate on death cross',
    defaultParams: SMA_CROSSOVER_DEFAULTS,
    validateParams: validateSmaCrossoverParams,

    create: ({ params }) => {
      let initialized = false;
      let closes: number[] = [];
      let prevFast: number | null = null;
      let prevSlow: number | null = null;

      return {
        init(): void {
          initialized = true;
        },

        onBar(ctx): Order[] {
          if (!initialized) {
            return [];
          }
          if (ctx.symbol !== params.symbol) {
            return [];
          }
          closes.push(ctx.bar.close);
          if (closes.length < params.slowPeriod) {
            return [];
          }

          const fast = sma(closes, params.fastPeriod);
          const slow = sma(closes, params.slowPeriod);
          const signal = crossSignal(prevFast, prevSlow, fast, slow);
          prevFast = fast;
          prevSlow = slow;

          const held = ctx.portfolio.positions.find(
            (position) => position.symbol === params.symbol,
          );
          if (signal === 'golden' && (!held || held.quantity === 0)) {
            return [marketOrder(params.symbol, 'buy', params.quantity, ctx.bar.timestamp)];
          }
          if (signal === 'death' && held && held.quantity > 0) {
            return [marketOrder(params.symbol, 'sell', held.quantity, ctx.bar.timestamp)];
          }
          return [];
        },

        teardown(): void {
          // Flush per-instance state; real integrations would reconcile
          // open positions or notify downstream systems here.
          closes = [];
          prevFast = null;
          prevSlow = null;
        },
      };
    },
  });

/**
 * Simple moving average over the last `period` closes.
 *
 * @param closes - Close price history (chronological).
 * @param period - SMA length (<= closes.length).
 * @returns The SMA value.
 */
function sma(closes: readonly number[], period: number): number {
  const window = closes.slice(-period);
  return window.reduce((sum, close) => sum + close, 0) / window.length;
}

/**
 * Classify a cross between the two SMAs.
 *
 * @param prevFast - Previous fast SMA (null when unavailable).
 * @param prevSlow - Previous slow SMA (null when unavailable).
 * @param fast - Current fast SMA.
 * @param slow - Current slow SMA.
 * @returns `'golden'`, `'death'` or `null`.
 */
function crossSignal(
  prevFast: number | null,
  prevSlow: number | null,
  fast: number,
  slow: number,
): 'golden' | 'death' | null {
  if (prevFast === null || prevSlow === null) {
    return null;
  }
  if (prevFast <= prevSlow && fast > slow) {
    return 'golden';
  }
  if (prevFast >= prevSlow && fast < slow) {
    return 'death';
  }
  return null;
}

/**
 * Build a market order with a deterministic id.
 *
 * @param symbol - Symbol.
 * @param side - Direction.
 * @param quantity - Quantity.
 * @param timestamp - Bar timestamp.
 * @returns The order.
 */
function marketOrder(
  symbol: string,
  side: 'buy' | 'sell',
  quantity: number,
  timestamp: number,
): Order {
  return {
    id: `sma-crossover-${side}-${symbol}-${timestamp}`,
    symbol,
    side,
    type: 'market',
    quantity,
  };
}
