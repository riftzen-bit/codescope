export type TrendDirection = 'improving' | 'declining' | 'stable' | 'unknown';

export interface TrendAnalysis {
  direction: TrendDirection;
  /** Slope of linear regression over the series (score units per step). */
  slope: number;
  /** Average of the series, or NaN for empty. */
  mean: number;
  /** Latest value minus oldest value, or 0 for empty/single. */
  delta: number;
  /** Smoothed tail using a window-N moving average, rounded to 1 decimal. */
  smoothed: number[];
}

function sanitize(values: readonly number[]): number[] {
  const out: number[] = [];
  for (const v of values) {
    if (typeof v === 'number' && Number.isFinite(v)) out.push(v);
  }
  return out;
}

/**
 * Simple trailing moving average. window <= 1 returns a copy.
 * Output length equals input length; positions before the window fills
 * use whatever points are available so far.
 */
export function movingAverage(values: readonly number[], window: number): number[] {
  const arr = sanitize(values);
  if (arr.length === 0) return [];
  const w = Math.max(1, Math.floor(window));
  if (w <= 1) return arr.slice();

  const out: number[] = [];
  let sum = 0;
  const buf: number[] = [];
  for (const v of arr) {
    buf.push(v);
    sum += v;
    if (buf.length > w) sum -= buf.shift() as number;
    out.push(sum / buf.length);
  }
  return out;
}

function linearSlope(values: readonly number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (let i = 0; i < n; i++) {
    const v = values[i];
    if (v === undefined) continue;
    sumX += i;
    sumY += v;
    sumXY += i * v;
    sumXX += i * i;
  }
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}

/**
 * Classify a numeric series as improving/declining/stable. For scores,
 * improving = slope > threshold (default 0.5 points per step).
 * Below minPoints (default 4), direction is 'unknown' — a slope from
 * 2 or 3 observations is statistical noise, not a trend.
 */
export function detectTrend(
  values: readonly number[],
  threshold = 0.5,
  minPoints = 4,
): TrendAnalysis {
  const arr = sanitize(values);
  if (arr.length === 0) {
    return { direction: 'unknown', slope: 0, mean: Number.NaN, delta: 0, smoothed: [] };
  }
  if (arr.length === 1) {
    const only = arr[0] as number;
    return { direction: 'unknown', slope: 0, mean: only, delta: 0, smoothed: [only] };
  }

  const slope = linearSlope(arr);
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const first = arr[0] as number;
  const last = arr[arr.length - 1] as number;
  const delta = last - first;

  if (arr.length < Math.max(2, Math.floor(minPoints))) {
    const w = Math.min(5, Math.max(2, Math.floor(arr.length / 2)));
    const smoothedShort = movingAverage(arr, w).map((v) => Math.round(v * 10) / 10);
    return { direction: 'unknown', slope, mean, delta, smoothed: smoothedShort };
  }

  let direction: TrendDirection;
  if (slope > threshold) direction = 'improving';
  else if (slope < -threshold) direction = 'declining';
  else direction = 'stable';

  const window = Math.min(5, Math.max(2, Math.floor(arr.length / 2)));
  const smoothed = movingAverage(arr, window).map((v) => Math.round(v * 10) / 10);

  return { direction, slope, mean, delta, smoothed };
}

/**
 * Returns the percentile rank (0..100) of `value` within `series`.
 * Uses strict-less-than count + 0.5 * equal count, standard definition.
 * Empty series returns 0.
 */
export function percentileRank(value: number, series: readonly number[]): number {
  const arr = sanitize(series);
  if (arr.length === 0) return 0;
  if (!Number.isFinite(value)) return 0;
  let less = 0;
  let equal = 0;
  for (const v of arr) {
    if (v < value) less++;
    else if (v === value) equal++;
  }
  return ((less + 0.5 * equal) / arr.length) * 100;
}
