import type { Finding, Severity } from './types.js';

const SEV_COLOR: Record<Severity, string> = {
  critical: '#b91c1c',
  error:    '#dc2626',
  warning:  '#d97706',
  info:     '#2563eb',
};

const SEV_ORDER: Severity[] = ['critical', 'error', 'warning', 'info'];

export interface PieSVGOptions {
  /** SVG box size in pixels. Square. Default 64. */
  size?: number;
  /** Donut hole radius as fraction of outer radius (0 = pie, 0.6 = donut). Default 0. */
  innerRatio?: number;
  /** Include a `<title>` for accessibility. Default true. */
  accessible?: boolean;
}

function polar(cx: number, cy: number, r: number, angle: number): { x: number; y: number } {
  // angle in radians, 0 = up, increasing clockwise
  return { x: cx + r * Math.sin(angle), y: cy - r * Math.cos(angle) };
}

function slicePath(cx: number, cy: number, rOuter: number, rInner: number, a0: number, a1: number): string {
  const p0 = polar(cx, cy, rOuter, a0);
  const p1 = polar(cx, cy, rOuter, a1);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  if (rInner <= 0) {
    return `M${cx},${cy} L${p0.x},${p0.y} A${rOuter},${rOuter} 0 ${large} 1 ${p1.x},${p1.y} Z`;
  }
  const p2 = polar(cx, cy, rInner, a1);
  const p3 = polar(cx, cy, rInner, a0);
  return `M${p0.x},${p0.y} A${rOuter},${rOuter} 0 ${large} 1 ${p1.x},${p1.y} L${p2.x},${p2.y} A${rInner},${rInner} 0 ${large} 0 ${p3.x},${p3.y} Z`;
}

/**
 * Render a severity-breakdown pie chart as an inline SVG string. Intended for
 * embedding into HTML/markdown/email exports where a small at-a-glance graphic
 * is useful. No external CSS/JS required.
 *
 * Single-severity and empty inputs degrade gracefully to a ring or an empty
 * circle with a title.
 */
export function toSeverityPieSVG(findings: readonly Finding[], options: PieSVGOptions = {}): string {
  const size = options.size ?? 64;
  const innerRatio = Math.max(0, Math.min(0.95, options.innerRatio ?? 0));
  const accessible = options.accessible ?? true;
  const cx = size / 2;
  const cy = size / 2;
  const rOuter = size / 2 - 1;
  const rInner = rOuter * innerRatio;

  const counts: Record<Severity, number> = { critical: 0, error: 0, warning: 0, info: 0 };
  for (const f of findings) counts[f.severity]++;
  const total = SEV_ORDER.reduce((a, s) => a + counts[s], 0);

  const accessibleTitle = accessible
    ? `<title>${total} findings — ${SEV_ORDER.map((s) => `${s}: ${counts[s]}`).join(', ')}</title>`
    : '';

  if (total === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img">${accessibleTitle}<circle cx="${cx}" cy="${cy}" r="${rOuter}" fill="none" stroke="#d4d4d8" stroke-width="1"/></svg>`;
  }

  // Special case: a single non-zero slice renders as a full ring/circle
  const nonZero = SEV_ORDER.filter((s) => counts[s] > 0);
  if (nonZero.length === 1) {
    const sev = nonZero[0]!;
    const fill = SEV_COLOR[sev];
    if (rInner > 0) {
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img">${accessibleTitle}<circle cx="${cx}" cy="${cy}" r="${rOuter}" fill="${fill}"/><circle cx="${cx}" cy="${cy}" r="${rInner}" fill="#ffffff"/></svg>`;
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img">${accessibleTitle}<circle cx="${cx}" cy="${cy}" r="${rOuter}" fill="${fill}"/></svg>`;
  }

  let angle = 0;
  const slices: string[] = [];
  for (const sev of SEV_ORDER) {
    const n = counts[sev];
    if (n === 0) continue;
    const sweep = (n / total) * 2 * Math.PI;
    const a1 = angle + sweep;
    slices.push(`<path d="${slicePath(cx, cy, rOuter, rInner, angle, a1)}" fill="${SEV_COLOR[sev]}"><title>${sev}: ${n}</title></path>`);
    angle = a1;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img">${accessibleTitle}${slices.join('')}</svg>`;
}
