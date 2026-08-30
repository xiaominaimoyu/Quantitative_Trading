/**
 * Strategy plugin SDK contracts (P2-8).
 *
 * A plugin is a reusable, parameterized strategy FACTORY with an explicit
 * instance lifecycle: `init` (once, optional) -> `onBar` (per bar: data
 * push + signal generation) -> `teardown` (once, optional, guaranteed via
 * try/finally). `create` receives the merged parameters and returns a
 * fresh instance whose state lives in the closure — multiple instances of
 * the same plugin never share state.
 *
 * Plugins are plain objects — no base classes, no globals — so they can be
 * shipped as ordinary ES modules and loaded dynamically.
 */

import type { BarContext } from '../engine/strategy.js';
import type { Order } from '../core/types.js';
import type { JsonValue } from '../experiment/types.js';

/** A runnable strategy instance created by a plugin factory. */
export interface StrategyInstance {
  /**
   * Lifecycle hook: called once before the first bar (optional).
   */
  init?(): void;

  /**
   * Lifecycle hook: data push + signal generation, once per bar.
   *
   * @param ctx - Bar, previous-close equity and portfolio snapshot.
   * @returns Orders to submit through risk and execution.
   */
  onBar(ctx: BarContext): Order[];

  /**
   * Lifecycle hook: called exactly once after the last bar — also when the
   * run fails — for cleanup and position reconciliation (optional).
   */
  teardown?(): void;
}

/**
 * Standardized strategy plugin interface.
 *
 * @typeParam TParams - Plugin parameter shape; must stay JSON-serializable
 * so experiments (P0-4) can snapshot and replay it.
 */
export interface StrategyPlugin<TParams extends object = Record<string, JsonValue>> {
  /** Unique plugin id used for registration and lookups. */
  readonly id: string;
  /** One-line human description (shown in listings). */
  readonly description?: string;
  /** Defaults merged under user-supplied params. */
  readonly defaultParams: TParams;
  /**
   * Validate merged parameters.
   *
   * @param params - Merged parameters.
   * @returns Human-readable error messages; empty list means valid.
   */
  validateParams?(params: TParams): readonly string[];

  /**
   * Plugin factory: build a fresh instance with the merged parameters.
   *
   * @param ctx - Validated merged parameters.
   * @returns A runnable instance.
   */
  create(ctx: { readonly params: TParams }): StrategyInstance;
}

/**
 * A plugin bound to concrete validated parameters, ready for the engine.
 */
export interface LoadedStrategy {
  readonly pluginId: string;
  /** Merged parameters actually in effect. */
  readonly params: JsonValue;
  /** Engine-facing strategy view (id === pluginId). */
  readonly strategy: {
    readonly id: string;
    onBar(ctx: BarContext): Order[];
  };
  /** Tear down the instance (safe to call at most once; runs teardown if defined). */
  teardown(): void;
}
