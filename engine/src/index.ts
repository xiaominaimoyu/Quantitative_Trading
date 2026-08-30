/**
 * @quant-trading/engine — TypeScript backtesting core.
 *
 * Public surface. Modules are layered:
 * `core` (primitives) <- `cost` (P0-1), `execution` (P0-1)
 *                       <- `risk` (P0-2), `engine` (P0-2),
 *                          `data` (P0-3), `experiment` (P0-4)
 *                       <- `metrics` / `compare` / `paper` (P1), `strategy` (P2).
 */

export * from './core/types.js';
export * from './core/money.js';
export * from './core/errors.js';
export * from './cost/index.js';
export * from './execution/index.js';
export * from './risk/index.js';
export * from './engine/index.js';
export * from './data-quality/index.js';
export * from './experiment/index.js';
export * from './metrics/index.js';
export * from './compare/index.js';
