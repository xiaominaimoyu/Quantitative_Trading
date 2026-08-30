/**
 * Multi-strategy comparison (P1-6).
 *
 * Runs every contender over the same bar dataset with the same engine
 * configuration, computes a performance report per contender and produces
 * a unified comparison table plus a ranking. A deterministic Markdown
 * renderer is included for human-readable reports.
 */

import { EngineError } from '../core/errors.js';
import { runBacktest, type BacktestConfig } from '../engine/backtest-engine.js';
import type { Bar } from '../core/types.js';
import { computePerformance } from '../metrics/index.js';
import {
  LOWER_IS_BETTER,
  type ComparisonMetric,
  type ComparisonReport,
  type Contender,
  type ContenderReport,
} from './types.js';

/** Configuration for a comparison run (shared by all contenders). */
export interface ComparisonConfig extends BacktestConfig {
  /** Metric used to rank contenders. Default `totalReturnPct`. */
  readonly rankBy?: ComparisonMetric;
  /** Forwarded to every `computePerformance` call. */
  readonly performance?: import('../metrics/types.js').PerformanceConfig;
}

/** Metrics emitted in the unified table, in display order. */
const TABLE_METRICS: readonly ComparisonMetric[] = [
  'totalReturnPct',
  'annualizedReturnPct',
  'maxDrawdownPct',
  'sharpeRatio',
  'calmarRatio',
  'winRate',
  'profitLossRatio',
];

/** Human-readable metric names used by the Markdown renderer. */
const METRIC_LABELS: Record<ComparisonMetric, string> = {
  totalReturnPct: 'Total Return',
  annualizedReturnPct: 'Annualized Return',
  maxDrawdownPct: 'Max Drawdown',
  sharpeRatio: 'Sharpe Ratio',
  calmarRatio: 'Calmar Ratio',
  winRate: 'Win Rate',
  profitLossRatio: 'Profit/Loss Ratio',
};

/** Metrics rendered as percentages by the Markdown renderer. */
const PERCENT_METRICS: ReadonlySet<ComparisonMetric> = new Set([
  'totalReturnPct',
  'annualizedReturnPct',
  'maxDrawdownPct',
  'winRate',
]);

/**
 * Compare multiple strategies over the same data and configuration.
 *
 * @param contenders - Two or more contenders with unique labels.
 * @param bars - Shared bar dataset (identical for every run).
 * @param config - Shared engine configuration plus ranking options.
 * @returns The unified comparison report.
 * @throws {@link EngineError} with code `invalid_input` for fewer than two
 * contenders or duplicate labels.
 */
export function compareStrategies(
  contenders: readonly Contender[],
  bars: Readonly<Record<string, readonly Bar[]>>,
  config: ComparisonConfig,
): ComparisonReport {
  if (contenders.length < 2) {
    throw new EngineError('invalid_input', 'comparison requires at least two contenders');
  }
  const labels = contenders.map((c) => c.label);
  if (new Set(labels).size !== labels.length) {
    throw new EngineError('invalid_input', `contender labels must be unique, got ${labels.join(', ')}`);
  }

  const rankBy = config.rankBy ?? 'totalReturnPct';
  const contenderReports: ContenderReport[] = contenders.map((contender) => {
    const run = runBacktest(
      { strategy: contender.strategy, bars },
      {
        initialCash: config.initialCash,
        cost: config.cost,
        risk: config.risk,
        execution: config.execution,
      },
    );
    return {
      label: contender.label,
      strategyId: contender.strategy.id,
      strategyParams: contender.strategyParams,
      run,
      performance: computePerformance(run, {
        // Contenders must share the same starting line: default the return
        // baseline to the common initial cash, not the first close.
        ...config.performance,
        initialCapital: config.performance?.initialCapital ?? config.initialCash,
      }),
    };
  });

  const values = TABLE_METRICS.map((metric) =>
    contenderReports.map((report) => report.performance[metric]),
  );

  const metricIndex = TABLE_METRICS.indexOf(rankBy);
  const rankingValues = values[metricIndex >= 0 ? metricIndex : 0]!;
  const ranking = labels
    .map((label, i) => ({ label, value: rankingValues[i]! }))
    .sort((a, b) =>
      LOWER_IS_BETTER.has(rankBy) ? a.value - b.value : b.value - a.value,
    );

  return {
    period: computePeriod(bars),
    contenders: contenderReports,
    labels,
    metrics: TABLE_METRICS,
    values,
    ranking,
    rankBy,
  };
}

/**
 * Render a comparison report as deterministic Markdown.
 *
 * @param report - Report from {@link compareStrategies}.
 * @returns Markdown text (table + ranking).
 */
export function renderComparisonMarkdown(report: ComparisonReport): string {
  const lines: string[] = [];
  lines.push('# Strategy Comparison');
  lines.push('');
  lines.push(`Rank by: ${report.rankBy}`);
  if (report.period) {
    lines.push(`Period: ${report.period.start} -> ${report.period.end}`);
  }
  lines.push('');
  lines.push(`| Metric | ${report.labels.join(' | ')} |`);
  lines.push(`|---|${report.labels.map(() => '---:').join('|')}|`);
  for (const metric of report.metrics) {
    const rowIndex = report.metrics.indexOf(metric);
    const cells = report.labels.map(
      (_, col) => formatMetric(metric, report.values[rowIndex]![col]!),
    );
    lines.push(`| ${METRIC_LABELS[metric]} | ${cells.join(' | ')} |`);
  }
  lines.push('');
  lines.push(`Ranking (${report.rankBy}):`);
  report.ranking.forEach((entry, i) => {
    lines.push(`${i + 1}. ${entry.label} (${formatMetric(report.rankBy, entry.value)})`);
  });
  return lines.join('\n');
}

/**
 * Compute the shared time interval of a dataset.
 *
 * @param bars - Bars per symbol.
 * @returns Min/max timestamp, or `null` for an empty dataset.
 */
function computePeriod(
  bars: Readonly<Record<string, readonly Bar[]>>,
): { start: number; end: number } | null {
  let start = Number.POSITIVE_INFINITY;
  let end = Number.NEGATIVE_INFINITY;
  for (const series of Object.values(bars)) {
    for (const bar of series) {
      start = Math.min(start, bar.timestamp);
      end = Math.max(end, bar.timestamp);
    }
  }
  return Number.isFinite(start) && Number.isFinite(end) ? { start, end } : null;
}

/**
 * Format one metric cell.
 *
 * @param metric - Metric key (drives percent vs. ratio formatting).
 * @param value - Metric value.
 * @returns Display string.
 */
function formatMetric(metric: ComparisonMetric, value: number): string {
  if (!Number.isFinite(value)) {
    return value > 0 ? 'Infinity' : '-Infinity';
  }
  if (PERCENT_METRICS.has(metric)) {
    return `${(value * 100).toFixed(2)}%`;
  }
  return value.toFixed(2);
}
