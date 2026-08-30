/**
 * Strategy plugin loading and registry (P2-8).
 *
 * Three loading paths are supported:
 * - direct registration of a plugin object (`register`);
 * - parameterized instantiation from the registry (`create`);
 * - dynamic import of an ES module file (`loadStrategyModule`) exporting
 *   the plugin as a `strategy` named export or as the default export.
 */

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { EngineError } from '../core/errors.js';
import type { JsonValue } from '../experiment/types.js';
import type { LoadedStrategy, StrategyPlugin, StrategyInstance } from './types.js';

/**
 * Structural validation for dynamically loaded plugins.
 *
 * @param candidate - Unknown value claimed to be a plugin.
 * @returns The same value, typed.
 * @throws {@link EngineError} with code `invalid_input` when the shape is
 * not a valid plugin (missing id/defaultParams/create).
 */
export function assertPluginShape(candidate: unknown): StrategyPlugin {
  const fail = (detail: string): never => {
    throw new EngineError('invalid_input', `strategy plugin shape invalid: ${detail}`);
  };
  if (typeof candidate !== 'object' || candidate === null) {
    return fail('expected an object');
  }
  const plugin = candidate as Partial<StrategyPlugin>;
  if (typeof plugin.id !== 'string' || plugin.id.trim() === '') {
    return fail('id must be a non-empty string');
  }
  if (typeof plugin.defaultParams !== 'object' || plugin.defaultParams === null) {
    return fail('defaultParams must be an object');
  }
  if (typeof plugin.create !== 'function') {
    return fail('create must be a function');
  }
  return plugin as StrategyPlugin;
}

/**
 * Instantiate a plugin with merged and validated parameters.
 *
 * Lifecycle: params merged (user over defaults) -> validated -> instance
 * created -> `init` invoked. The returned wrapper delegates `onBar` and
 * exposes a one-shot `teardown` so runners can guarantee cleanup.
 *
 * @typeParam TParams - Plugin parameter shape.
 * @param plugin - Plugin to instantiate.
 * @param params - User parameters overriding defaults (shallow merge).
 * @returns The loaded strategy.
 * @throws {@link EngineError} with code `invalid_input` when parameter
 * validation reports errors.
 */
export function instantiatePlugin<TParams extends object>(
  plugin: StrategyPlugin<TParams>,
  params: Partial<TParams> = {},
): LoadedStrategy {
  const merged = { ...plugin.defaultParams, ...params } as TParams;
  if (plugin.validateParams) {
    const errors = plugin.validateParams(merged);
    if (errors.length > 0) {
      throw new EngineError(
        'invalid_input',
        `strategy ${plugin.id} parameter validation failed: ${errors.join('; ')}`,
      );
    }
  }

  const instance: StrategyInstance = plugin.create({ params: merged });
  if (typeof instance.init === 'function') {
    instance.init();
  }

  let tornDown = false;
  return {
    pluginId: plugin.id,
    params: merged as JsonValue,
    strategy: {
      id: plugin.id,
      onBar: (ctx) => instance.onBar(ctx),
    },
    teardown: () => {
      if (tornDown || typeof instance.teardown !== 'function') {
        tornDown = true;
        return;
      }
      tornDown = true;
      instance.teardown();
    },
  };
}

/**
 * Registry of available plugins (the in-process plugin loader).
 */
export class StrategyRegistry {
  private readonly plugins: Map<string, StrategyPlugin> = new Map();

  /**
   * Register a plugin.
   *
   * @param plugin - Plugin to register.
   * @throws {@link EngineError} with code `invalid_input` for a duplicate
   * id or an invalid plugin shape.
   */
  public register(plugin: StrategyPlugin): void {
    assertPluginShape(plugin);
    if (this.plugins.has(plugin.id)) {
      throw new EngineError('invalid_input', `strategy plugin id already registered: ${plugin.id}`);
    }
    this.plugins.set(plugin.id, plugin);
  }

  /**
   * Look up a plugin by id.
   *
   * @param id - Plugin id.
   * @returns The plugin, or undefined when unknown.
   */
  public get(id: string): StrategyPlugin | undefined {
    return this.plugins.get(id);
  }

  /** All registered plugins in registration order. */
  public list(): StrategyPlugin[] {
    return [...this.plugins.values()];
  }

  /**
   * Instantiate a registered plugin by id.
   *
   * @param id - Plugin id.
   * @param params - User parameters.
   * @returns The loaded strategy (see {@link instantiatePlugin}).
   * @throws {@link EngineError} with code `invalid_input` for an unknown id.
   */
  public create(id: string, params: Partial<Record<string, JsonValue>> = {}): LoadedStrategy {
    const plugin = this.plugins.get(id);
    if (!plugin) {
      throw new EngineError(
        'invalid_input',
        `unknown strategy plugin id: ${id} (registered: ${[...this.plugins.keys()].join(', ') || 'none'})`,
      );
    }
    return instantiatePlugin(plugin, params as never);
  }
}

/**
 * Create a registry pre-populated with plugins.
 *
 * @param plugins - Plugins to register in order.
 * @returns The configured registry.
 */
export function createRegistry(plugins: readonly StrategyPlugin[] = []): StrategyRegistry {
  const registry = new StrategyRegistry();
  for (const plugin of plugins) {
    registry.register(plugin);
  }
  return registry;
}

/**
 * Type-safe identity helper for authoring plugins (gives full inference).
 *
 * @typeParam TParams - Plugin parameter shape.
 * @param plugin - Plugin definition.
 * @returns The same plugin, typed.
 */
export function defineStrategy<TParams extends object>(
  plugin: StrategyPlugin<TParams>,
): StrategyPlugin<TParams> {
  return plugin;
}

/**
 * Dynamically load a plugin from an ES module file.
 *
 * The module must export the plugin either as a `strategy` named export or
 * as its default export.
 *
 * @param filePath - Absolute or relative path to a `.js`/`.mjs` module.
 * @returns The loaded plugin (shape-validated).
 * @throws {@link EngineError} with code `invalid_input` when the module
 * exports no valid plugin.
 */
export async function loadStrategyModule(filePath: string): Promise<StrategyPlugin> {
  const mod = (await import(pathToFileURL(resolve(filePath)).href)) as {
    strategy?: unknown;
    default?: unknown;
  };
  const candidate = mod.strategy ?? mod.default;
  if (candidate === undefined) {
    throw new EngineError(
      'invalid_input',
      `module ${filePath} exports no strategy plugin (expected a 'strategy' named export or a default export)`,
    );
  }
  return assertPluginShape(candidate);
}
