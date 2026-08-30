/**
 * Experiment lifecycle (P0-4): create records, run experiments and
 * reproduce historical runs by experiment id.
 */

import { randomUUID } from 'node:crypto';
import type { Bar } from '../core/types.js';
import { EngineError } from '../core/errors.js';
import { runBacktest, type BacktestResult } from '../engine/backtest-engine.js';
import type { BacktestStrategy } from '../engine/strategy.js';
import { canonicalJson, hashJson } from './canonical.js';
import { captureEnvironment } from './environment.js';
import { fingerprintDataset, fingerprintResult } from './fingerprint.js';
import type {
  ExperimentRecord,
  ExperimentRun,
  ExperimentSpec,
  JsonValue,
  ReproductionResult,
} from './types.js';

/**
 * Build the immutable record for one experiment (without running it).
 *
 * Validates that strategy parameters are JSON-safe and that the dataset is
 * fingerprintable, so failures surface before any computation.
 *
 * @param spec - Experiment inputs.
 * @returns The experiment record (result fingerprint left empty).
 * @throws {@link EngineError} with code `invalid_input` when the strategy
 * id is empty. @throws {@link TypeError} when params or data are not
 * JSON-safe.
 */
export function buildExperimentRecord(spec: ExperimentSpec): ExperimentRecord {
  if (spec.strategy.id.trim() === '') {
    throw new EngineError('invalid_input', 'strategy id must be a non-empty string');
  }
  // Fail fast on non-JSON parameters — the snapshot must be serializable.
  canonicalJson(spec.strategyParams);

  const dataFingerprints: Record<string, string> = {};
  for (const [symbol, bars] of Object.entries(spec.bars)) {
    dataFingerprints[symbol] = fingerprintDataset({ [symbol]: bars });
  }
  const dataVersion = fingerprintDataset(spec.bars);
  const configSnapshot: ExperimentRecord['configSnapshot'] = {
    initialCash: spec.config.initialCash,
    cost: spec.config.cost,
    risk: spec.config.risk,
    execution: spec.config.execution,
  };
  const inputHash = hashJson({
    strategyId: spec.strategy.id,
    strategyParams: spec.strategyParams,
    dataVersion,
    configSnapshot,
  });

  return {
    experimentId: `exp-${randomUUID()}`,
    createdAt: new Date().toISOString(),
    inputHash,
    dataVersion,
    dataFingerprints,
    strategySnapshot: { id: spec.strategy.id, params: spec.strategyParams },
    configSnapshot,
    environment: captureEnvironment(),
    resultFingerprint: '',
    label: spec.label,
  };
}

/**
 * Run one experiment: snapshot the inputs, execute the backtest and
 * fingerprint the result.
 *
 * @param spec - Experiment inputs (strategy instance + params snapshot).
 * @returns The run: record (with result fingerprint), result and digest.
 */
export function runExperiment(spec: ExperimentSpec): ExperimentRun {
  const base = buildExperimentRecord(spec);
  const result: BacktestResult = runBacktest(
    { strategy: spec.strategy, bars: spec.bars },
    spec.config,
  );
  const resultFingerprint = fingerprintResult(result);
  const record: ExperimentRecord = { ...base, resultFingerprint };
  return { record, result, resultFingerprint };
}

/**
 * Reproduce a historical experiment by its record.
 *
 * Verifies the supplied dataset against `record.dataVersion` (aborting on
 * data drift), rebuilds the strategy from the parameter snapshot, re-runs
 * the backtest with the snapshotted configuration and compares result
 * fingerprints. Equal fingerprints mean the reproduction is faithful.
 *
 * @param record - Historical experiment record (e.g. from a store).
 * @param bars - Dataset believed to be the one used originally.
 * @param strategyFactory - Rebuilds a strategy from snapshotted params.
 * @returns The reproduction verdict and the rerun result.
 * @throws {@link EngineError} with code `invalid_input` when the record has
 * no result fingerprint, the dataset fingerprint drifts, or the rebuilt
 * strategy id does not match the snapshot.
 */
export function reproduceExperiment(
  record: ExperimentRecord,
  bars: Readonly<Record<string, readonly Bar[]>>,
  strategyFactory: (params: JsonValue) => BacktestStrategy,
): ReproductionResult {
  if (record.resultFingerprint === '') {
    throw new EngineError(
      'invalid_input',
      `experiment ${record.experimentId} has no result fingerprint; run it first`,
    );
  }
  const dataVersion = fingerprintDataset(bars);
  if (dataVersion !== record.dataVersion) {
    throw new EngineError(
      'invalid_input',
      `dataset version mismatch for ${record.experimentId}: expected ${record.dataVersion}, got ${dataVersion}`,
    );
  }
  const strategy = strategyFactory(record.strategySnapshot.params);
  if (strategy.id !== record.strategySnapshot.id) {
    throw new EngineError(
      'invalid_input',
      `strategy id mismatch for ${record.experimentId}: expected ${record.strategySnapshot.id}, got ${strategy.id}`,
    );
  }
  const result = runBacktest({ strategy, bars }, record.configSnapshot);
  const actualFingerprint = fingerprintResult(result);
  return {
    experimentId: record.experimentId,
    dataMatches: true,
    resultMatches: actualFingerprint === record.resultFingerprint,
    result,
    expectedFingerprint: record.resultFingerprint,
    actualFingerprint,
  };
}
