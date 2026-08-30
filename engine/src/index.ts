/**
 * @quant-trading/engine — TypeScript backtesting core.
 *
 * Public surface. Modules are layered:
 * `core` (primitives) <- `cost` (P0-1), `execution` (P0-1)
 *                       <- `risk` (P0-2), `data` (P0-3), `experiment` (P0-4)
 *                       <- `metrics` / `compare` / `paper` (P1), `strategy` (P2).
 */

export * from './core/types.js';
export * from './core/money.js';
export * from './core/errors.js';
export * from './cost/index.js';
export * from './execution/index.js';
