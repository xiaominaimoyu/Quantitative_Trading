import { describe, expect, it } from 'vitest';
import {
  ConfigError,
  parseTimestamp,
  validateDataset,
  validateSeries,
  type RawBar,
} from '../src/index.js';

const DAY = 86_400_000;
const D1 = Date.UTC(2024, 0, 1);
const D2 = Date.UTC(2024, 0, 2);
const D3 = Date.UTC(2024, 0, 3);
const D4 = Date.UTC(2024, 0, 4);

function raw(time: string | number, close: number, partial: Partial<RawBar> = {}): RawBar {
  return { time, open: close, high: close, low: close, close, volume: 1_000, ...partial };
}

describe('parseTimestamp', () => {
  it('passes epoch milliseconds through', () => {
    expect(parseTimestamp(1_700_000_000_000)).toBe(1_700_000_000_000);
  });

  it('rejects non-finite numbers', () => {
    expect(parseTimestamp(Number.NaN)).toBeNull();
    expect(parseTimestamp(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('parses UTC ISO strings (Z)', () => {
    expect(parseTimestamp('2024-01-01T09:30:00Z')).toBe(Date.UTC(2024, 0, 1, 9, 30));
  });

  it('parses explicit positive offsets (+08:00)', () => {
    expect(parseTimestamp('2024-01-01T09:30:00+08:00')).toBe(Date.UTC(2024, 0, 1, 1, 30));
  });

  it('parses explicit negative offsets (-05:00) and compact form (+0800)', () => {
    expect(parseTimestamp('2024-01-01T09:30:00-05:00')).toBe(Date.UTC(2024, 0, 1, 14, 30));
    expect(parseTimestamp('2024-01-01T09:30:00+0800')).toBe(Date.UTC(2024, 0, 1, 1, 30));
  });

  it('parses fractional seconds', () => {
    expect(parseTimestamp('2024-01-01T00:00:00.500Z')).toBe(Date.UTC(2024, 0, 1) + 500);
  });

  it('treats naive strings as UTC by default', () => {
    expect(parseTimestamp('2024-01-01 09:30:00')).toBe(Date.UTC(2024, 0, 1, 9, 30));
  });

  it('applies naiveTimeOffsetMinutes to naive strings', () => {
    expect(parseTimestamp('2024-01-01T09:30:00', 480)).toBe(Date.UTC(2024, 0, 1, 1, 30));
  });

  it('rejects unparseable strings', () => {
    expect(parseTimestamp('not-a-time')).toBeNull();
    expect(parseTimestamp('')).toBeNull();
  });

  it('rejects out-of-range calendar components instead of rolling over', () => {
    expect(parseTimestamp('2024-13-01T00:00:00Z')).toBeNull();
    expect(parseTimestamp('2024-01-01T25:00:00Z')).toBeNull();
    expect(parseTimestamp('2024-01-01T00:60:00Z')).toBeNull();
    expect(parseTimestamp('2024-00-10T00:00:00Z')).toBeNull();
  });
});

describe('validateSeries — normalization and happy path', () => {
  it('normalizes mixed time formats into a sorted UTC series', () => {
    const { bars, report } = validateSeries('X', [
      raw('2024-01-02T00:00:00+08:00', 102),
      raw(D1, 101),
    ]);
    expect(bars.map((b) => b.timestamp)).toEqual([D1, D2 - 8 * 3_600_000]);
    expect(report.status).toBe('passed');
    expect(report.inputCount).toBe(2);
    expect(report.outputCount).toBe(2);
    expect(report.issues).toEqual([]);
  });

  it('sorts unsorted input deterministically', () => {
    const { bars } = validateSeries('X', [raw(D3, 3), raw(D1, 1), raw(D2, 2)]);
    expect(bars.map((b) => b.close)).toEqual([1, 2, 3]);
  });
});

describe('validateSeries — schema and OHLC validation', () => {
  it('drops non-finite fields as errors', () => {
    const { report } = validateSeries('X', [raw(D1, Number.NaN)]);
    expect(report.status).toBe('failed');
    expect(report.issues[0]).toMatchObject({ code: 'invalid_record', severity: 'error' });
    expect(report.outputCount).toBe(0);
  });

  it('drops non-positive prices and negative volumes as errors', () => {
    const { report } = validateSeries('X', [
      raw(D1, 0),
      raw(D2, 10, { volume: -1 }),
      raw(D3, 10),
    ]);
    expect(report.status).toBe('failed');
    expect(report.issues).toHaveLength(2);
    expect(report.issues.every((i) => i.code === 'invalid_record')).toBe(true);
    expect(report.outputCount).toBe(1);
    expect(report.removedCount).toBe(2);
  });

  it('drops OHLC violations as errors', () => {
    const { report } = validateSeries('X', [
      raw(D1, 10, { high: 9 }),
      raw(D2, 10, { low: 11 }),
      raw(D3, 10, { high: 10.5, low: 9.5 }),
    ]);
    expect(report.issues.every((i) => i.code === 'ohlc_violation')).toBe(true);
    expect(report.status).toBe('failed');
    expect(report.outputCount).toBe(1);
  });
});

describe('validateSeries — duplicate timestamps', () => {
  const duplicated = [raw(D1, 100, { volume: 1 }), raw(D1, 200, { volume: 2 }), raw(D2, 300)];

  it('keeps the first duplicate by default and warns', () => {
    const { bars, report } = validateSeries('X', duplicated);
    expect(bars).toHaveLength(2);
    expect(bars[0]?.close).toBe(100);
    expect(report.status).toBe('passed_with_warnings');
    expect(report.issues[0]).toMatchObject({
      code: 'duplicate_timestamp',
      severity: 'warning',
    });
  });

  it('keeps the last duplicate under keep_last', () => {
    const { bars } = validateSeries('X', duplicated, { duplicatePolicy: 'keep_last' });
    expect(bars[0]?.close).toBe(200);
  });

  it('fails under the error policy', () => {
    const { report } = validateSeries('X', duplicated, { duplicatePolicy: 'error' });
    expect(report.status).toBe('failed');
    expect(report.issues[0]).toMatchObject({ code: 'duplicate_timestamp', severity: 'error' });
  });
});

describe('validateSeries — missing and gap detection', () => {
  it('reports missing expected session timestamps as errors', () => {
    const { report } = validateSeries('X', [raw(D1, 1), raw(D3, 3)], {
      expectedTimestamps: [D1, D2, D3],
    });
    expect(report.status).toBe('failed');
    expect(report.issues[0]).toMatchObject({ code: 'missing_timestamp', timestamp: D2 });
  });

  it('reports calendar gaps as warnings', () => {
    const { report } = validateSeries('X', [raw(D1, 1), raw(D4, 4)], {
      expectedIntervalMs: DAY,
    });
    expect(report.status).toBe('passed_with_warnings');
    expect(report.issues[0]).toMatchObject({
      code: 'gap',
      severity: 'warning',
      detail: expect.stringContaining('2 bar(s)'),
    });
  });

  it('stays quiet when the observed interval is within tolerance', () => {
    const { report } = validateSeries('X', [raw(D1, 100), raw(D2 + 3_600_000, 101)], {
      expectedIntervalMs: DAY,
      gapToleranceFactor: 1.5,
    });
    expect(report.status).toBe('passed');
  });

  it('rejects invalid config', () => {
    expect(() => validateSeries('X', [], { expectedIntervalMs: 0 })).toThrow(
      expect.objectContaining({ code: 'invalid_data_config' }),
    );
    expect(() => validateSeries('X', [], { maxPriceChangePct: -1 })).toThrow(ConfigError);
    expect(() => validateSeries('X', [], { gapToleranceFactor: 0 })).toThrow(ConfigError);
    expect(() => validateSeries('X', [], { naiveTimeOffsetMinutes: Number.NaN })).toThrow(
      ConfigError,
    );
  });
});

describe('validateSeries — outlier flagging', () => {
  it('flags zero volume as a warning and keeps the row', () => {
    const { bars, report } = validateSeries('X', [raw(D1, 100, { volume: 0 }), raw(D2, 101)]);
    expect(report.status).toBe('passed_with_warnings');
    expect(report.issues[0]).toMatchObject({ code: 'zero_volume', severity: 'warning' });
    expect(bars).toHaveLength(2);
  });

  it('flags abnormal price jumps as warnings and keeps the row', () => {
    const { bars, report } = validateSeries('X', [raw(D1, 100), raw(D2, 200), raw(D3, 201)]);
    expect(report.status).toBe('passed_with_warnings');
    expect(report.issues.map((i) => i.code)).toEqual(['price_jump']);
    expect(bars.map((b) => b.close)).toEqual([100, 200, 201]);
  });

  it('respects a custom maxPriceChangePct', () => {
    const { report } = validateSeries('X', [raw(D1, 100), raw(D2, 200)], {
      maxPriceChangePct: 1.5,
    });
    expect(report.status).toBe('passed');
  });
});

describe('validateDataset — multi-symbol combination', () => {
  const dataset: Record<string, RawBar[]> = {
    OK: [raw(D1, 10), raw(D2, 11)],
    WARN: [raw(D1, 100), raw(D2, 300)],
    BAD: [raw(D1, 10), { time: 'garbage', open: 1, high: 1, low: 1, close: 1, volume: 1 }],
  };

  it('combines per-symbol statuses into the worst outcome', () => {
    const result = validateDataset(dataset);
    expect(result.status).toBe('failed');
    expect(result.reports.OK?.status).toBe('passed');
    expect(result.reports.WARN?.status).toBe('passed_with_warnings');
    expect(result.reports.BAD?.status).toBe('failed');
    expect(result.cleaned.OK).toHaveLength(2);
    expect(result.cleaned.BAD).toHaveLength(1);
  });

  it('passes when all symbols are clean', () => {
    const result = validateDataset({ A: [raw(D1, 1)], B: [raw(D1, 2), raw(D2, 2)] });
    expect(result.status).toBe('passed');
  });
});

describe('validateSeries — determinism', () => {
  it('produces identical output for identical input', () => {
    const input = [raw('2024-01-02T00:00:00+08:00', 102), raw(D1, 101), raw(D1, 103)];
    const a = validateSeries('X', input);
    const b = validateSeries('X', input);
    expect(a).toEqual(b);
  });
});
