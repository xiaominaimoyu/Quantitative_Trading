/**
 * Data quality pipeline contracts (P0-3).
 *
 * Raw bar records enter the pipeline exactly as they come from a data
 * vendor (mixed time formats, duplicates, outliers) and leave as
 * normalized {@link Bar} series plus an auditable diagnostic report.
 */

/** A raw bar record as provided by a data source (pre-validation). */
export interface RawBar {
  /**
   * Raw timestamp: epoch milliseconds, or an ISO-8601 string with an
   * explicit offset (`Z`, `+08:00`), or a naive string interpreted via
   * `naiveTimeOffsetMinutes`.
   */
  readonly time: string | number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
}

/** Duplicate resolution policy for repeated timestamps. */
export type DuplicatePolicy = 'keep_first' | 'keep_last' | 'error';

/** Configuration for the data quality pipeline (all knobs explicit). */
export interface DataQualityConfig {
  /**
   * Expected interval between consecutive bars, e.g. `86_400_000` for
   * daily data. Enables gap detection when provided.
   */
  expectedIntervalMs?: number;
  /**
   * A gap is reported when the observed interval exceeds
   * `gapToleranceFactor * expectedIntervalMs`. Default 1.5.
   */
  gapToleranceFactor?: number;
  /**
   * Expected session timestamps (e.g. from a trading calendar). Any
   * expected timestamp missing from the data is reported as an error.
   */
  expectedTimestamps?: readonly number[];
  /** Duplicate resolution policy. Default `keep_first`. */
  duplicatePolicy?: DuplicatePolicy;
  /**
   * Flag a warning when `|close_t / close_{t-1} - 1|` exceeds this
   * fraction. Default 0.25 (25%). Outliers are marked, never removed.
   */
  maxPriceChangePct?: number;
  /**
   * Fixed offset in minutes applied to naive time strings (no explicit
   * offset), e.g. `480` for UTC+8. Default 0 (UTC).
   */
  naiveTimeOffsetMinutes?: number;
}

/** Machine-readable issue codes produced by the pipeline. */
export type QualityIssueCode =
  | 'invalid_record'
  | 'unparseable_time'
  | 'duplicate_timestamp'
  | 'missing_timestamp'
  | 'gap'
  | 'ohlc_violation'
  | 'zero_volume'
  | 'price_jump';

/** Severity of a quality issue. `error` fails the check, `warning` does not. */
export type IssueSeverity = 'error' | 'warning';

/** One diagnostic finding. */
export interface QualityIssue {
  readonly code: QualityIssueCode;
  readonly severity: IssueSeverity;
  /** Symbol the issue belongs to. */
  readonly symbol: string;
  /** Affected bar timestamp (raw time string when unparseable). */
  readonly timestamp?: number | string;
  /** Human-readable explanation. */
  readonly detail: string;
}

/** Overall pipeline verdict for a symbol (or the whole dataset). */
export type QualityStatus = 'passed' | 'passed_with_warnings' | 'failed';

/** Diagnostic report for one symbol series. */
export interface DataQualityReport {
  readonly symbol: string;
  readonly status: QualityStatus;
  readonly inputCount: number;
  readonly outputCount: number;
  /** Rows dropped (invalid records, OHLC violations, dedup). */
  readonly removedCount: number;
  /** How naive times were interpreted. */
  readonly naiveTimeOffsetMinutes: number;
  readonly issues: QualityIssue[];
}
