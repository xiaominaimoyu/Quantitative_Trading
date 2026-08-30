/**
 * Experiment reproducibility contracts (P0-4).
 *
 * Every backtest run is captured as an {@link ExperimentRecord}: strategy
 * parameters, engine configuration, dataset fingerprints and the runtime
 * environment are snapshotted, and results carry a fingerprint. A run can
 * be replayed later and byte-identical result fingerprints prove that the
 * reproduction is faithful.
 */

import type { Bar } from '../core/types.js';
import type { BacktestConfig, BacktestResult } from '../engine/backtest-engine.js';
import type { BacktestStrategy } from '../engine/strategy.js';

/** JSON-safe value; strategy parameters must be expressible in this form. */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** Runtime environment snapshot captured with every experiment. */
export interface EnvironmentInfo {
  /** Always `'node'`; the engine core targets Node >= 20. */
  readonly runtime: 'node';
  /** `process.version`, e.g. `v24.14.1`. */
  readonly nodeVersion: string;
  /** `process.platform`, e.g. `win32`. */
  readonly platform: string;
  /** `process.arch`, e.g. `x64`. */
  readonly arch: string;
  /** Engine package version (constant in source, bumped per release). */
  readonly engineVersion: string;
  /** Timezone convention used by all engine computations. */
  readonly timezone: 'UTC';
}

/** Inputs needed to run (and later re-run) one experiment. */
export interface ExperimentSpec {
  /** Strategy instance to execute (its id is snapshotted). */
  readonly strategy: BacktestStrategy;
  /** JSON-serializable strategy parameters snapshot. */
  readonly strategyParams: JsonValue;
  /** Bar data per symbol; fingerprints become the dataset version. */
  readonly bars: Readonly<Record<string, readonly Bar[]>>;
  /** Full backtest configuration (cost / risk / execution / cash). */
  readonly config: BacktestConfig;
  /** Optional human label for the experiment. */
  readonly label?: string;
}

/**
 * Immutable snapshot describing one experiment run.
 *
 * Everything except `experimentId`/`createdAt` is content-addressed via
 * `inputHash`; the dataset itself is referenced by fingerprints, not
 * embedded (bars can be large).
 */
export interface ExperimentRecord {
  /** Unique run id (`exp-<uuid>`), the lookup key for reproduction. */
  readonly experimentId: string;
  /** ISO-8601 UTC creation timestamp. */
  readonly createdAt: string;
  /** SHA-256 over {strategyId, params, dataVersion, config}. */
  readonly inputHash: string;
  /** Combined dataset fingerprint; reproductions verify against it. */
  readonly dataVersion: string;
  /** Per-symbol bar series fingerprints. */
  readonly dataFingerprints: Record<string, string>;
  readonly strategySnapshot: {
    readonly id: string;
    readonly params: JsonValue;
  };
  /** Full engine configuration snapshot. */
  readonly configSnapshot: BacktestConfig;
  readonly environment: EnvironmentInfo;
  /** SHA-256 of the canonical result; set after a successful run. */
  readonly resultFingerprint: string;
  readonly label?: string;
}

/** One completed experiment: record plus its result. */
export interface ExperimentRun {
  readonly record: ExperimentRecord;
  readonly result: BacktestResult;
  readonly resultFingerprint: string;
}

/** Outcome of a reproduction attempt. */
export interface ReproductionResult {
  readonly experimentId: string;
  /** True when the supplied dataset matches `record.dataVersion`. */
  readonly dataMatches: true;
  /** True when the rerun fingerprint equals the stored fingerprint. */
  readonly resultMatches: boolean;
  /** The rerun result. */
  readonly result: BacktestResult;
  readonly expectedFingerprint: string;
  readonly actualFingerprint: string;
}
