const TICKS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

/**
 * Render a numeric series as a unicode block sparkline. Min→lowest tick,
 * max→highest tick. Returns empty string for empty input. NaN/Infinity
 * values are dropped.
 */
export function sparkline(values: readonly number[]): string {
  const clean = values.filter((v) => Number.isFinite(v));
  if (clean.length === 0) return '';

  const min = Math.min(...clean);
  const max = Math.max(...clean);
  const range = max - min;

  if (range === 0) {
    // All equal → middle tick
    const mid = TICKS[Math.floor(TICKS.length / 2)]!;
    return mid.repeat(clean.length);
  }

  const out: string[] = [];
  for (const v of clean) {
    const norm = (v - min) / range;
    const idx = Math.min(TICKS.length - 1, Math.max(0, Math.round(norm * (TICKS.length - 1))));
    out.push(TICKS[idx]!);
  }
  return out.join('');
}
