/**
 * Content fingerprints for experiments (P0-4).
 *
 * Three content addresses matter for reproducibility:
 * - dataset version: per-symbol bar fingerprints + a combined version;
 * - input hash: strategy + params + dataset version + configuration;
 * - result fingerprint: the canonical hash of a full backtest result.
 */

import type { Bar } from '../core/types.js';
import type { BacktestResult } from '../engine/backtest-engine.js';
import { hashJson } from './canonical.js';

/**
 * Fingerprint one symbol's bar series (order-sensitive).
 *
 * @param bars - Bar series; must be JSON-safe (finite numbers).
 * @returns 64-character hex digest.
 */
export function fingerprintBars(bars: readonly Bar[]): string {
  return hashJson(bars);
}

/**
 * Compute the dataset version over all symbols.
 *
 * Symbol names are canonicalized (sorted), so the same data provided with
 * different key insertion order yields the same version.
 *
 * @param dataset - Bars per symbol.
 * @returns Combined 64-character hex digest.
 */
export function fingerprintDataset(dataset: Readonly<Record<string, readonly Bar[]>>): string {
  const entries = Object.keys(dataset)
    .sort()
    .map((symbol) => ({ symbol, fingerprint: fingerprintBars(dataset[symbol] ?? []) }));
  return hashJson(entries);
}

/**
 * Fingerprint a full backtest result.
 *
 * Covers the equity curve, fills, risk events, order log and the final
 * portfolio snapshot — everything a "same outcome" claim rests on.
 *
 * @param result - Backtest result to fingerprint.
 * @returns 64-character hex digest.
 */
export function fingerprintResult(result: BacktestResult): string {
  return hashJson({
    equityCurve: result.equityCurve,
    fills: result.fills,
    riskEvents: result.riskEvents,
    orderLog: result.orderLog,
    finalPortfolio: result.finalPortfolio,
  });
}
