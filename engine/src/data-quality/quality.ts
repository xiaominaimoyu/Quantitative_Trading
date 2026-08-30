/**
 * Data quality pipeline (P0-3): missing detection, timezone
 * normalization, deduplication and outlier flagging with a diagnostic
 * report.
 *
 * The pipeline never silently "fixes" market data beyond normalization
 * and duplicate resolution: structurally broken rows are dropped and
 * reported as errors; suspicious-but-plausible rows (price jumps, zero
 * volume) are kept and flagged as warnings. Callers decide whether a
 * `failed` status blocks their workflow.
 */

import { ConfigError } from '../core/errors.js';
import type { Bar } from '../core/types.js';
import { parseTimestamp } from './time.js';
import type {
  DataQualityConfig,
  DataQualityReport,
  QualityIssue,
  QualityIssueCode,
  QualityStatus,
  RawBar,
} from './types.js';

/** Absolute tolerance for OHLC consistency checks (float guard). */
const OHLC_EPSILON = 1e-9;

/** Internal record after timestamp parsing, before dedup. */
interface ParsedRecord {
  readonly timestamp: number;
  readonly bar: Bar;
  /** Original index, used as a stable tiebreaker for determinism. */
  readonly index: number;
}

/**
 * Validate the pipeline configuration.
 *
 * @param config - Configuration to validate.
 * @returns The same config (typed, for chaining).
 * @throws {@link ConfigError} with code `invalid_data_config` on bad values.
 */
function assertConfig(config: DataQualityConfig): DataQualityConfig {
  const fail = (detail: string): never => {
    throw new ConfigError(`data quality config: ${detail}`, 'invalid_data_config');
  };
  if (
    config.expectedIntervalMs !== undefined &&
    (!Number.isFinite(config.expectedIntervalMs) || config.expectedIntervalMs <= 0)
  ) {
    return fail(`expectedIntervalMs must be > 0, got ${config.expectedIntervalMs}`);
  }
  if (
    config.gapToleranceFactor !== undefined &&
    (!Number.isFinite(config.gapToleranceFactor) || config.gapToleranceFactor <= 0)
  ) {
    return fail(`gapToleranceFactor must be > 0, got ${config.gapToleranceFactor}`);
  }
  if (
    config.maxPriceChangePct !== undefined &&
    (!Number.isFinite(config.maxPriceChangePct) || config.maxPriceChangePct <= 0)
  ) {
    return fail(`maxPriceChangePct must be > 0, got ${config.maxPriceChangePct}`);
  }
  if (
    config.naiveTimeOffsetMinutes !== undefined &&
    !Number.isFinite(config.naiveTimeOffsetMinutes)
  ) {
    return fail(
      `naiveTimeOffsetMinutes must be finite, got ${config.naiveTimeOffsetMinutes}`,
    );
  }
  return config;
}

/**
 * Compose the overall status from the issue list.
 *
 * @param issues - All issues found for the series.
 * @returns `failed` when any error exists, `passed_with_warnings` when
 * only warnings exist, `passed` when clean.
 */
function statusOf(issues: readonly QualityIssue[]): QualityStatus {
  if (issues.some((issue) => issue.severity === 'error')) {
    return 'failed';
  }
  return issues.length > 0 ? 'passed_with_warnings' : 'passed';
}

/**
 * Build a quality issue.
 *
 * @param symbol - Symbol under validation.
 * @param code - Issue code.
 * @param severity - Severity.
 * @param timestamp - Affected timestamp (optional).
 * @param detail - Explanation.
 * @returns The issue record.
 */
function issue(
  symbol: string,
  code: QualityIssueCode,
  severity: 'error' | 'warning',
  timestamp: number | string | undefined,
  detail: string,
): QualityIssue {
  return { code, severity, symbol, timestamp, detail };
}

/**
 * Validate one raw OHLCV record.
 *
 * @param symbol - Symbol under validation.
 * @param raw - Raw record.
 * @param index - Original index (for diagnostics).
 * @param naiveOffsetMinutes - Offset for naive time strings.
 * @param issues - Issue sink.
 * @returns A parsed record, or `null` when the row must be dropped.
 */
function parseRecord(
  symbol: string,
  raw: RawBar,
  index: number,
  naiveOffsetMinutes: number,
  issues: QualityIssue[],
): ParsedRecord | null {
  const drop = (
    code: QualityIssueCode,
    timestamp: number | string,
    detail: string,
  ): null => {
    issues.push(issue(symbol, code, 'error', timestamp, detail));
    return null;
  };

  const ts = parseTimestamp(raw.time, naiveOffsetMinutes);
  if (ts === null) {
    return drop('unparseable_time', raw.time, `cannot parse time ${JSON.stringify(raw.time)}`);
  }

  const { open, high, low, close, volume } = raw;
  const fields = [open, high, low, close, volume];
  if (fields.some((v) => !Number.isFinite(v))) {
    return drop('invalid_record', ts, `non-finite OHLCV field at index ${index}`);
  }
  if (open <= 0 || high <= 0 || low <= 0 || close <= 0) {
    return drop('invalid_record', ts, `non-positive price at index ${index}`);
  }
  if (volume < 0) {
    return drop('invalid_record', ts, `negative volume at index ${index}`);
  }
  if (high < low - OHLC_EPSILON) {
    return drop('ohlc_violation', ts, `high ${high} < low ${low} at index ${index}`);
  }
  if (high < Math.max(open, close) - OHLC_EPSILON) {
    return drop(
      'ohlc_violation',
      ts,
      `high ${high} below max(open, close) ${Math.max(open, close)} at index ${index}`,
    );
  }
  if (low > Math.min(open, close) + OHLC_EPSILON) {
    return drop(
      'ohlc_violation',
      ts,
      `low ${low} above min(open, close) ${Math.min(open, close)} at index ${index}`,
    );
  }

  return {
    timestamp: ts,
    bar: { timestamp: ts, open, high, low, close, volume },
    index,
  };
}

/**
 * Resolve duplicate timestamps according to the policy.
 *
 * @param symbol - Symbol under validation.
 * @param sorted - Parsed records sorted by timestamp (stable).
 * @param policy - Duplicate policy.
 * @param issues - Issue sink.
 * @returns Deduplicated records.
 */
function deduplicate(
  symbol: string,
  sorted: readonly ParsedRecord[],
  policy: 'keep_first' | 'keep_last' | 'error',
  issues: QualityIssue[],
): ParsedRecord[] {
  const result: ParsedRecord[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1]!.timestamp === sorted[i]!.timestamp) {
      j += 1;
    }
    if (j > i) {
      if (policy === 'error') {
        issues.push(
          issue(
            symbol,
            'duplicate_timestamp',
            'error',
            sorted[i]!.timestamp,
            `${j - i + 1} records share timestamp ${sorted[i]!.timestamp}; keeping the first`,
          ),
        );
      } else {
        issues.push(
          issue(
            symbol,
            'duplicate_timestamp',
            'warning',
            sorted[i]!.timestamp,
            `${j - i + 1} records share timestamp ${sorted[i]!.timestamp}; kept the ${policy === 'keep_first' ? 'first' : 'last'}`,
          ),
        );
      }
    }
    result.push(policy === 'keep_last' ? sorted[j]! : sorted[i]!);
    i = j + 1;
  }
  return result;
}

/**
 * Run the full quality pipeline on one symbol series.
 *
 * Steps: parse/normalize time -> validate fields -> stable sort ->
 * deduplicate -> missing/gap detection -> outlier flagging.
 *
 * @param symbol - Symbol under validation.
 * @param raw - Raw records in any order.
 * @param config - Pipeline configuration.
 * @returns Cleaned bars (sorted, normalized) plus the diagnostic report.
 * @throws {@link ConfigError} with code `invalid_data_config` on bad config.
 */
export function validateSeries(
  symbol: string,
  raw: readonly RawBar[],
  config: DataQualityConfig = {},
): { bars: Bar[]; report: DataQualityReport } {
  assertConfig(config);

  const naiveOffsetMinutes = config.naiveTimeOffsetMinutes ?? 0;
  const duplicatePolicy = config.duplicatePolicy ?? 'keep_first';
  const gapToleranceFactor = config.gapToleranceFactor ?? 1.5;
  const maxPriceChangePct = config.maxPriceChangePct ?? 0.25;

  const issues: QualityIssue[] = [];

  const parsed: ParsedRecord[] = [];
  raw.forEach((record, index) => {
    const parsedRecord = parseRecord(symbol, record, index, naiveOffsetMinutes, issues);
    if (parsedRecord) {
      parsed.push(parsedRecord);
    }
  });

  parsed.sort((a, b) => a.timestamp - b.timestamp || a.index - b.index);
  const deduped = deduplicate(symbol, parsed, duplicatePolicy, issues);

  // Missing session timestamps (opt-in, needs a calendar).
  if (config.expectedTimestamps) {
    const present = new Set(deduped.map((r) => r.timestamp));
    for (const expected of [...config.expectedTimestamps].sort((a, b) => a - b)) {
      if (!present.has(expected)) {
        issues.push(
          issue(
            symbol,
            'missing_timestamp',
            'error',
            expected,
            `expected session timestamp ${expected} is missing`,
          ),
        );
      }
    }
  }

  // Gap detection against the expected interval.
  if (config.expectedIntervalMs !== undefined && deduped.length >= 2) {
    for (let k = 1; k < deduped.length; k += 1) {
      const from = deduped[k - 1]!;
      const to = deduped[k]!;
      const delta = to.timestamp - from.timestamp;
      if (delta > gapToleranceFactor * config.expectedIntervalMs!) {
        const missingBars = Math.round(delta / config.expectedIntervalMs!) - 1;
        issues.push(
          issue(
            symbol,
            'gap',
            'warning',
            to.timestamp,
            `gap of ${missingBars} bar(s) between ${from.timestamp} and ${to.timestamp}`,
          ),
        );
      }
    }
  }

  // Outlier flagging on the cleaned series (rows are kept, never dropped).
  for (let k = 0; k < deduped.length; k += 1) {
    const record = deduped[k]!;
    if (record.bar.volume === 0) {
      issues.push(
        issue(symbol, 'zero_volume', 'warning', record.timestamp, `zero volume at ${record.timestamp}`),
      );
    }
    if (k > 0 && maxPriceChangePct > 0) {
      const previous = deduped[k - 1]!;
      const change = Math.abs(record.bar.close / previous.bar.close - 1);
      if (change > maxPriceChangePct) {
        issues.push(
          issue(
            symbol,
            'price_jump',
            'warning',
            record.timestamp,
            `close change ${(change * 100).toFixed(2)}% from ${previous.timestamp} exceeds ${(maxPriceChangePct * 100).toFixed(2)}%`,
          ),
        );
      }
    }
  }

  const bars = deduped.map((r) => r.bar);
  const report: DataQualityReport = {
    symbol,
    status: statusOf(issues),
    inputCount: raw.length,
    outputCount: bars.length,
    removedCount: raw.length - bars.length,
    naiveTimeOffsetMinutes: naiveOffsetMinutes,
    issues,
  };
  return { bars, report };
}

/** Result of validating a full dataset. */
export interface DatasetQualityResult {
  /** Worst per-symbol status. */
  readonly status: QualityStatus;
  /** Cleaned, normalized bars per symbol (ready for `runBacktest`). */
  readonly cleaned: Record<string, Bar[]>;
  /** Per-symbol diagnostic reports. */
  readonly reports: Record<string, DataQualityReport>;
}

const STATUS_ORDER: Record<QualityStatus, number> = {
  passed: 0,
  passed_with_warnings: 1,
  failed: 2,
};

/**
 * Validate a full dataset (multiple symbols) with one configuration.
 *
 * @param dataset - Raw records per symbol.
 * @param config - Pipeline configuration applied to every symbol.
 * @returns Combined status, cleaned bars and per-symbol reports.
 */
export function validateDataset(
  dataset: Readonly<Record<string, readonly RawBar[]>>,
  config: DataQualityConfig = {},
): DatasetQualityResult {
  const cleaned: Record<string, Bar[]> = {};
  const reports: Record<string, DataQualityReport> = {};
  let worst: QualityStatus = 'passed';

  for (const [symbol, series] of Object.entries(dataset)) {
    const result = validateSeries(symbol, series, config);
    cleaned[symbol] = result.bars;
    reports[symbol] = result.report;
    if (STATUS_ORDER[result.report.status] > STATUS_ORDER[worst]) {
      worst = result.report.status;
    }
  }

  return { status: worst, cleaned, reports };
}
