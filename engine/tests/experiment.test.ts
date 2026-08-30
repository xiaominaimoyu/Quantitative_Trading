import { describe, expect, it } from 'vitest';
import {
  ENGINE_VERSION,
  InMemoryExperimentStore,
  canonicalJson,
  captureEnvironment,
  deserializeRun,
  fingerprintBars,
  fingerprintDataset,
  fingerprintResult,
  hashJson,
  reproduceExperiment,
  runExperiment,
  serializeRun,
  sha256Hex,
  type BacktestStrategy,
  type Bar,
  type ExperimentRun,
  type JsonValue,
} from '../src/index.js';

const D1 = Date.UTC(2024, 0, 1);
const D2 = Date.UTC(2024, 0, 2);
const D3 = Date.UTC(2024, 0, 3);

function bars(points: Array<[number, number]>): Bar[] {
  return points.map(([timestamp, close]) => ({
    timestamp,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1_000,
  }));
}

interface TradeParams {
  buyTimestamp: number;
  sellTimestamp: number;
  quantity: number;
}

function paramsDrivenStrategy(params: JsonValue): BacktestStrategy {
  const p = params as unknown as TradeParams;
  return {
    id: 'params-driven',
    onBar(ctx) {
      if (ctx.bar.timestamp === p.buyTimestamp) {
        return [
          {
            id: `buy-${ctx.symbol}-${ctx.bar.timestamp}`,
            symbol: ctx.symbol,
            side: 'buy',
            type: 'market',
            quantity: p.quantity,
          },
        ];
      }
      if (ctx.bar.timestamp === p.sellTimestamp) {
        return [
          {
            id: `sell-${ctx.symbol}-${ctx.bar.timestamp}`,
            symbol: ctx.symbol,
            side: 'sell',
            type: 'market',
            quantity: p.quantity,
          },
        ];
      }
      return [];
    },
  };
}

const PARAMS: TradeParams = { buyTimestamp: D1, sellTimestamp: D3, quantity: 100 };
const DATASET = { TEST: bars([[D1, 100], [D2, 110], [D3, 105]]) };
const CONFIG = { initialCash: 20_000, cost: { commission: { rate: 0.001 } } } as const;

function makeSpec(label?: string) {
  return {
    strategy: paramsDrivenStrategy(PARAMS as unknown as JsonValue),
    strategyParams: PARAMS as unknown as JsonValue,
    bars: DATASET,
    config: CONFIG,
    label,
  };
}

describe('canonicalJson', () => {
  it('sorts object keys recursively', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalJson({ z: [1, { c: 3, a: 2 }] })).toBe('{"z":[1,{"a":2,"c":3}]}');
  });

  it('serializes strings, numbers, booleans and null', () => {
    expect(canonicalJson('a"b')).toBe('"a\\"b"');
    expect(canonicalJson(1.5)).toBe('1.5');
    expect(canonicalJson(true)).toBe('true');
    expect(canonicalJson(null)).toBe('null');
    expect(canonicalJson({})).toBe('{}');
    expect(canonicalJson([])).toBe('[]');
  });

  it('rejects non-JSON values', () => {
    expect(() => canonicalJson(Number.NaN)).toThrow(TypeError);
    expect(() => canonicalJson(Number.POSITIVE_INFINITY)).toThrow(TypeError);
    expect(() => canonicalJson(undefined)).toThrow(TypeError);
    expect(() => canonicalJson([undefined])).toThrow(TypeError);
    expect(() => canonicalJson({ fn: () => 1 })).toThrow(TypeError);
  });

  it('drops object keys with undefined values (JSON semantics)', () => {
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
  });
});

describe('hashing', () => {
  it('matches the known SHA-256 vector', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('is invariant to key insertion order', () => {
    expect(hashJson({ a: 1, b: 2 })).toBe(hashJson({ b: 2, a: 1 }));
  });
});

describe('fingerprints', () => {
  it('changes when bar data changes or is reordered', () => {
    const a = fingerprintBars(bars([[D1, 100], [D2, 110]]));
    const reordered = fingerprintBars(bars([[D2, 110], [D1, 100]]));
    const tweaked = fingerprintBars(bars([[D1, 100], [D2, 111]]));
    expect(a).not.toBe(reordered);
    expect(a).not.toBe(tweaked);
  });

  it('is invariant to symbol key insertion order', () => {
    const one = fingerprintDataset({ A: bars([[D1, 1]]), B: bars([[D1, 2]]) });
    const two = fingerprintDataset({ B: bars([[D1, 2]]), A: bars([[D1, 1]]) });
    expect(one).toBe(two);
  });

  it('fingerprints results deterministically', () => {
    const run = runExperiment(makeSpec());
    expect(fingerprintResult(run.result)).toBe(run.resultFingerprint);
  });
});

describe('captureEnvironment', () => {
  it('captures a frozen Node environment snapshot', () => {
    const env = captureEnvironment();
    expect(env.runtime).toBe('node');
    expect(env.nodeVersion.startsWith('v')).toBe(true);
    expect(env.engineVersion).toBe(ENGINE_VERSION);
    expect(env.timezone).toBe('UTC');
    expect(typeof env.platform).toBe('string');
    expect(Object.isFrozen(env)).toBe(true);
  });
});

describe('runExperiment', () => {
  it('assigns unique ids but identical input hashes for identical specs', () => {
    const a = runExperiment(makeSpec());
    const b = runExperiment(makeSpec());
    expect(a.record.experimentId).not.toBe(b.record.experimentId);
    expect(a.record.experimentId.startsWith('exp-')).toBe(true);
    expect(a.record.inputHash).toBe(b.record.inputHash);
  });

  it('snapshots strategy params, dataset version and result fingerprint', () => {
    const run = runExperiment(makeSpec('my-label'));
    expect(run.record.strategySnapshot).toEqual({ id: 'params-driven', params: PARAMS });
    expect(run.record.dataVersion).toBe(fingerprintDataset(DATASET));
    expect(run.record.resultFingerprint).toBe(fingerprintResult(run.result));
    expect(run.record.label).toBe('my-label');
    expect(Number.isNaN(Date.parse(run.record.createdAt))).toBe(false);
    expect(run.record.environment.runtime).toBe('node');
  });

  it('executes the strategy faithfully (round trip through the engine)', () => {
    const run = runExperiment(makeSpec());
    expect(run.result.fills).toHaveLength(2);
    // Buy 100 @100 (fee 10), sell 100 @105 (fee 10.5) -> cash 20_479.5.
    expect(run.result.finalPortfolio.cash).toBeCloseTo(20_479.5, 6);
    expect(run.result.finalPortfolio.positions).toHaveLength(0);
  });

  it('rejects non-JSON strategy params early', () => {
    expect(() =>
      runExperiment({
        strategy: paramsDrivenStrategy({} as unknown as JsonValue),
        strategyParams: { quantity: () => 1 } as unknown as JsonValue,
        bars: DATASET,
        config: CONFIG,
      }),
    ).toThrow(TypeError);
  });
});

describe('ExperimentStore', () => {
  it('saves, loads and lists runs', () => {
    const store = new InMemoryExperimentStore();
    const a = runExperiment(makeSpec('first'));
    const b = runExperiment(makeSpec('second'));
    store.save(a);
    store.save(b);

    expect(store.load(a.record.experimentId)?.record.label).toBe('first');
    expect(store.load('exp-unknown')).toBeUndefined();
    expect(store.list().map((r) => r.label)).toEqual(['first', 'second']);
  });

  it('round-trips through JSON serialization', () => {
    const store = new InMemoryExperimentStore();
    const run = runExperiment(makeSpec());
    store.save(run);

    const restored = deserializeRun(serializeRun(run));
    expect(restored).toEqual(run);
    expect(restored.record.experimentId).toBe(run.record.experimentId);
    expect(restored.result.fills).toHaveLength(run.result.fills.length);
  });
});

describe('reproduceExperiment', () => {
  it('reproduces the stored result fingerprint exactly', () => {
    const run: ExperimentRun = runExperiment(makeSpec());
    const reproduction = reproduceExperiment(run.record, DATASET, paramsDrivenStrategy);

    expect(reproduction.dataMatches).toBe(true);
    expect(reproduction.resultMatches).toBe(true);
    expect(reproduction.expectedFingerprint).toBe(run.resultFingerprint);
    expect(reproduction.actualFingerprint).toBe(run.resultFingerprint);
    expect(reproduction.result).toEqual(run.result);
  });

  it('is stable across repeated reproductions', () => {
    const run = runExperiment(makeSpec());
    const a = reproduceExperiment(run.record, DATASET, paramsDrivenStrategy);
    const b = reproduceExperiment(run.record, DATASET, paramsDrivenStrategy);
    expect(a.actualFingerprint).toBe(b.actualFingerprint);
  });

  it('detects dataset drift', () => {
    const run = runExperiment(makeSpec());
    const drifted = { TEST: bars([[D1, 100], [D2, 110], [D3, 106]]) };
    expect(() => reproduceExperiment(run.record, drifted, paramsDrivenStrategy)).toThrow(
      expect.objectContaining({ code: 'invalid_input' }),
    );
  });

  it('rejects a strategy factory returning the wrong id', () => {
    const run = runExperiment(makeSpec());
    const wrong = (params: JsonValue): BacktestStrategy => ({
      ...paramsDrivenStrategy(params),
      id: 'other',
    });
    expect(() => reproduceExperiment(run.record, DATASET, wrong)).toThrow(
      expect.objectContaining({ code: 'invalid_input' }),
    );
  });

  it('reports a mismatch when parameters differ', () => {
    const run = runExperiment(makeSpec());
    const differentParams = (params: JsonValue): BacktestStrategy => {
      const p = { ...(params as unknown as TradeParams) };
      p.quantity = 50;
      return paramsDrivenStrategy(p as unknown as JsonValue);
    };
    const reproduction = reproduceExperiment(run.record, DATASET, differentParams);
    expect(reproduction.resultMatches).toBe(false);
    expect(reproduction.actualFingerprint).not.toBe(reproduction.expectedFingerprint);
  });

  it('refuses to reproduce a record without a result fingerprint', () => {
    const run = runExperiment(makeSpec());
    const empty = { ...run.record, resultFingerprint: '' };
    expect(() => reproduceExperiment(empty, DATASET, paramsDrivenStrategy)).toThrow(
      expect.objectContaining({ code: 'invalid_input' }),
    );
  });
});

describe('full-stack reproduction via store', () => {
  it('reproduces a run loaded from the store by experiment id', () => {
    const store = new InMemoryExperimentStore();
    const run = runExperiment(makeSpec());
    store.save(run);

    const loaded = store.load(run.record.experimentId);
    expect(loaded).toBeDefined();
    const reproduction = reproduceExperiment(
      loaded!.record,
      DATASET,
      paramsDrivenStrategy,
    );
    expect(reproduction.resultMatches).toBe(true);
  });
});
