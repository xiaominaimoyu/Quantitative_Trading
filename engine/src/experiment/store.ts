/**
 * Experiment storage (P0-4).
 *
 * The store keeps full runs (record + result) keyed by experiment id so a
 * historical run can be loaded and reproduced. `serializeRun` /
 * `deserializeRun` make any store trivially persistable to JSON files or
 * a database blob without bespoke schemas.
 */

import type { ExperimentRecord, ExperimentRun } from './types.js';

/** Storage contract for experiment runs. */
export interface ExperimentStore {
  /**
   * Persist one completed run.
   *
   * @param run - Run to store.
   */
  save(run: ExperimentRun): void;

  /**
   * Load a run by experiment id.
   *
   * @param experimentId - Id returned at run time.
   * @returns The stored run, or `undefined` when unknown.
   */
  load(experimentId: string): ExperimentRun | undefined;

  /**
   * All stored records in insertion order.
   *
   * @returns Experiment records (without results).
   */
  list(): ExperimentRecord[];
}

/** In-memory {@link ExperimentStore}; the default for tests and tooling. */
export class InMemoryExperimentStore implements ExperimentStore {
  private readonly runs: Map<string, ExperimentRun> = new Map();

  /** @inheritdoc */
  public save(run: ExperimentRun): void {
    this.runs.set(run.record.experimentId, run);
  }

  /** @inheritdoc */
  public load(experimentId: string): ExperimentRun | undefined {
    return this.runs.get(experimentId);
  }

  /** @inheritdoc */
  public list(): ExperimentRecord[] {
    return [...this.runs.values()].map((run) => run.record);
  }
}

/**
 * Serialize a run to a JSON string (for file/database persistence).
 *
 * @param run - Run to serialize.
 * @returns JSON text.
 */
export function serializeRun(run: ExperimentRun): string {
  return JSON.stringify({ record: run.record, result: run.result, resultFingerprint: run.resultFingerprint });
}

/**
 * Deserialize a run produced by {@link serializeRun}.
 *
 * @param json - JSON text from {@link serializeRun}.
 * @returns The reconstructed run.
 */
export function deserializeRun(json: string): ExperimentRun {
  const parsed = JSON.parse(json) as ExperimentRun;
  return parsed;
}
