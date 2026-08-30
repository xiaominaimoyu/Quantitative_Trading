import { describe, expect, it } from 'vitest';
import { floorToLot, roundTo } from '../src/index.js';

describe('roundTo', () => {
  it('rounds to 2 decimals by default', () => {
    expect(roundTo(1.234)).toBe(1.23);
    expect(roundTo(1.236)).toBe(1.24);
  });

  it('neutralizes binary float drift (0.1 + 0.2)', () => {
    expect(roundTo(0.1 + 0.2, 2)).toBe(0.3);
  });

  it('supports other decimal places', () => {
    expect(roundTo(1.23456789, 0)).toBe(1);
    expect(roundTo(1.23456789, 4)).toBe(1.2346);
    expect(roundTo(1.23456789, 8)).toBe(1.23456789);
  });

  it('clamps decimals into [0, 8]', () => {
    expect(roundTo(1.234567891234, 100)).toBe(1.23456789);
    expect(roundTo(1.6, -3)).toBe(2);
  });

  it('rounds negatives away from zero', () => {
    expect(roundTo(-1.234, 2)).toBe(-1.23);
    expect(roundTo(-1.236, 2)).toBe(-1.24);
  });

  it('passes through non-finite values', () => {
    expect(roundTo(Number.NaN)).toBeNaN();
    expect(roundTo(Number.POSITIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY);
    expect(roundTo(Number.NEGATIVE_INFINITY)).toBe(Number.NEGATIVE_INFINITY);
  });
});

describe('floorToLot', () => {
  it('floors to the nearest lot multiple', () => {
    expect(floorToLot(650, 100)).toBe(600);
    expect(floorToLot(250, 100)).toBe(200);
    expect(floorToLot(99, 100)).toBe(0);
  });

  it('keeps quantity with lot size 1', () => {
    expect(floorToLot(150, 1)).toBe(150);
    expect(floorToLot(1, 1)).toBe(1);
  });

  it('accepts exact multiples', () => {
    expect(floorToLot(100, 100)).toBe(100);
  });

  it('rejects invalid lot sizes', () => {
    expect(() => floorToLot(100, 0)).toThrow(RangeError);
    expect(() => floorToLot(100, -1)).toThrow(RangeError);
    expect(() => floorToLot(100, 2.5)).toThrow(RangeError);
  });
});
