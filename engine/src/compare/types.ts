/**
 * Multi-strategy comparison contracts (P1-6).
 */

import type { BacktestResult } from '../engine/backtest-engine.js';
import type { BacktestStrategy } from '../engine/strategy.js';
import type { PerformanceReport } from '../metrics/types.js';

/** Metrics available for the comparison table and ranking. */
export type ComparisonMetric =
  | 'totalReturnPct'
  | 'annualizedReturnPct'
  | 'maxDrawdownPct'
  | 'sharpeRatio'
  | 'calmarRatio'
  | 'winRate'
  | 'profitLossRatio';

/** Metrics where a lower value is better (ranking direction). */
export const LOWER_IS_BETTER: ReadonlySet<ComparisonMetric> = new Set(['maxDrawdownPct']);

/** One contender in an A/B comparison. */
export interface Contender {
  /** Unique display label (e.g. `A`, `baseline-ma5`). */
  readonly label: string;
  readonly strategy: BacktestStrategy;
  /** Optional parameter snapshot echoed into the report. */
  readonly strategyParams?: unknown;
}

/** Per-contender section of the comparison report. */
export interface ContenderReport {
  readonly label: string;
  readonly strategyId: string;
  readonly strategyParams?: unknown;
  readonly run: BacktestResult;
  readonly performance: PerformanceReport;
}

/** Unified A/B comparison report. */
export interface ComparisonReport {
  /** Shared bar interval covered by every contender run. */
  readonly period: { readonly start: number; readonly end: number } | null;
  /** Contender sections in input order. */
  readonly contenders: readonly ContenderReport[];
  /** Contender labels in input order (table column order). */
  readonly labels: readonly string[];
  /** Metric row keys of `values`. */
  readonly metrics: readonly ComparisonMetric[];
  /** `values[i][j]` = `metrics[i]` of `labels[j]`. */
  readonly values: readonly (readonly number[])[];
  /** Ranking by `rankBy`, best first. */
  readonly ranking: readonly { readonly label: string; readonly value: number }[];
  readonly rankBy: ComparisonMetric;
}
