/**
 * Plugin lifecycle runner (P2-8).
 *
 * Wires a plugin into the backtest engine while guaranteeing the
 * `teardown` lifecycle hook runs exactly once — including on errors.
 */

import type { Bar } from '../core/types.js';
import { runBacktest, type BacktestConfig, type BacktestResult } from '../engine/backtest-engine.js';
import type { JsonValue } from '../experiment/types.js';
import { instantiatePlugin } from './registry.js';
import type { StrategyPlugin } from './types.js';

/**
 * Run a plugin over historical bars with the full lifecycle.
 *
 * Sequence: instantiate (validate + init) -> backtest -> teardown. The
 * teardown hook runs even when the backtest throws.
 *
 * @typeParam TParams - Plugin parameter shape.
 * @param plugin - Plugin to run.
 * @param params - User parameters (merged over defaults).
 * @param bars - Bar dataset.
 * @param config - Backtest configuration.
 * @returns The backtest result plus the merged parameters in effect.
 * @throws {@link EngineError} when parameters are invalid (teardown has
 * not run yet because init never happened).
 */
export function runPluginBacktest<TParams extends object>(
  plugin: StrategyPlugin<TParams>,
  params: Partial<TParams>,
  bars: Readonly<Record<string, readonly Bar[]>>,
  config: BacktestConfig,
): { result: BacktestResult; params: JsonValue } {
  const loaded = instantiatePlugin(plugin, params);
  try {
    const result = runBacktest({ strategy: loaded.strategy, bars }, config);
    return { result, params: loaded.params };
  } finally {
    loaded.teardown();
  }
}
