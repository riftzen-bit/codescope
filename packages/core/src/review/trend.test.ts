import { describe, it, expect } from 'vitest';
import { movingAverage, detectTrend, percentileRank } from './trend.js';

describe('movingAverage', () => {
  it('returns empty for empty input', () => {
    expect(movingAverage([], 3)).toEqual([]);
  });

  it('returns copy for window <= 1', () => {
    expect(movingAverage([1, 2, 3], 1)).toEqual([1, 2, 3]);
    expect(movingAverage([1, 2, 3], 0)).toEqual([1, 2, 3]);
  });

  it('smooths with trailing window', () => {
    // window=3, values [1,2,3,4,5] -> [1, 1.5, 2, 3, 4]
    expect(movingAverage([1, 2, 3, 4, 5], 3)).toEqual([1, 1.5, 2, 3, 4]);
  });

  it('drops non-finite inputs', () => {
    expect(movingAverage([1, NaN, 3, Infinity, 5], 2)).toEqual([1, 2, 4]);
  });
});

describe('detectTrend', () => {
  it('unknown for empty', () => {
    const t = detectTrend([]);
    expect(t.direction).toBe('unknown');
    expect(Number.isNaN(t.mean)).toBe(true);
  });

  it('unknown for single', () => {
    const t = detectTrend([75]);
    expect(t.direction).toBe('unknown');
    expect(t.mean).toBe(75);
  });

  it('detects improving', () => {
    const t = detectTrend([50, 60, 70, 80, 90]);
    expect(t.direction).toBe('improving');
    expect(t.slope).toBeGreaterThan(0);
    expect(t.delta).toBe(40);
  });

  it('detects declining', () => {
    const t = detectTrend([90, 85, 80, 70, 60]);
    expect(t.direction).toBe('declining');
    expect(t.slope).toBeLessThan(0);
    expect(t.delta).toBe(-30);
  });

  it('detects stable', () => {
    const t = detectTrend([80, 80, 81, 79, 80]);
    expect(t.direction).toBe('stable');
  });

  it('respects threshold', () => {
    const t = detectTrend([50, 51, 52, 53], 5);
    expect(t.direction).toBe('stable');
  });

  it('returns unknown below minPoints default (4)', () => {
    // Clear upward slope but only 3 points — not enough signal.
    const t = detectTrend([40, 60, 80]);
    expect(t.direction).toBe('unknown');
    expect(t.slope).toBeGreaterThan(0);
    expect(t.delta).toBe(40);
  });

  it('minPoints override lets length-2 emit', () => {
    const t = detectTrend([50, 80], 0.5, 2);
    expect(t.direction).toBe('improving');
  });
});

describe('percentileRank', () => {
  it('returns 0 for empty series', () => {
    expect(percentileRank(50, [])).toBe(0);
  });

  it('middle of distribution', () => {
    expect(percentileRank(50, [10, 30, 50, 70, 90])).toBe(50);
  });

  it('max value ranks near 100', () => {
    expect(percentileRank(100, [10, 30, 50, 70, 90])).toBe(100);
  });

  it('min value ranks near 0', () => {
    expect(percentileRank(0, [10, 30, 50, 70, 90])).toBe(0);
  });

  it('handles duplicates', () => {
    // value=50 in [50,50,50,50] -> 0.5 * 4 / 4 = 50
    expect(percentileRank(50, [50, 50, 50, 50])).toBe(50);
  });

  it('rejects non-finite value', () => {
    expect(percentileRank(NaN, [10, 20])).toBe(0);
  });
});
