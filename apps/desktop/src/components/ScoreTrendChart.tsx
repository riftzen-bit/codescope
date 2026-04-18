import { useMemo } from 'react';
import { detectTrend } from '@code-review/core';

interface Props {
  points: readonly number[];
  width?: number;
  height?: number;
  threshold?: number;
}

function fmt(n: number): string {
  return Number.isFinite(n) ? n.toFixed(1).replace(/\.0$/, '') : '';
}

export function ScoreTrendChart({ points, width = 220, height = 56, threshold = 80 }: Props) {
  const { path, dots, trend, minY, maxY } = useMemo(() => {
    const clean = points.filter((p) => Number.isFinite(p));
    if (clean.length === 0) return { path: '', dots: [] as Array<{ x: number; y: number; v: number }>, trend: detectTrend([]), minY: 0, maxY: 100 };

    const pad = 6;
    const w = width;
    const h = height;
    const lo = Math.max(0, Math.min(...clean) - 5);
    const hi = Math.min(100, Math.max(...clean) + 5);
    const yRange = hi - lo || 1;

    const toX = (i: number) => {
      if (clean.length === 1) return w / 2;
      return pad + (i / (clean.length - 1)) * (w - 2 * pad);
    };
    const toY = (v: number) => h - pad - ((v - lo) / yRange) * (h - 2 * pad);

    const dotList = clean.map((v, i) => ({ x: toX(i), y: toY(v), v }));
    const pathStr = dotList.map((d, i) => (i === 0 ? `M${d.x},${d.y}` : `L${d.x},${d.y}`)).join(' ');

    return { path: pathStr, dots: dotList, trend: detectTrend(clean), minY: lo, maxY: hi };
  }, [points, width, height]);

  if (!path) return null;

  const thresholdY = (() => {
    if (threshold < minY || threshold > maxY) return null;
    const pad = 6;
    const yRange = maxY - minY || 1;
    return height - pad - ((threshold - minY) / yRange) * (height - 2 * pad);
  })();

  const stroke =
    trend.direction === 'improving' ? 'var(--success)'
    : trend.direction === 'declining' ? 'var(--error)'
    : 'var(--accent)';

  return (
    <svg
      className="score-trend-chart"
      role="img"
      aria-label={`Score trend: ${trend.direction}, latest ${fmt(dots[dots.length - 1]?.v ?? 0)}`}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
    >
      {thresholdY !== null && (
        <line
          x1={0}
          x2={width}
          y1={thresholdY}
          y2={thresholdY}
          stroke="currentColor"
          strokeOpacity={0.15}
          strokeDasharray="3,3"
        />
      )}
      <path d={path} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      {dots.map((d, i) => (
        <circle
          key={i}
          cx={d.x}
          cy={d.y}
          r={2.4}
          fill={stroke}
        >
          <title>{`#${i + 1}: ${d.v}/100`}</title>
        </circle>
      ))}
    </svg>
  );
}
