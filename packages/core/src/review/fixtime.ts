import type { Finding, Severity, Category } from './types.js';

/** Rough minutes-to-fix by severity, halved/doubled by category. Purely an
 *  order-of-magnitude estimate to let teams triage. */
const BASE_MINUTES: Record<Severity, number> = {
  critical: 60,
  error:    30,
  warning:  15,
  info:     5,
};

const CATEGORY_MULT: Record<Category, number> = {
  security:        1.5,
  correctness:     1.2,
  performance:     1.0,
  maintainability: 0.8,
  style:           0.4,
  other:           1.0,
};

export function estimateFixTime(finding: Finding): number {
  const base = BASE_MINUTES[finding.severity];
  const mult = CATEGORY_MULT[finding.category];
  return Math.round(base * mult);
}

export interface FixTimeSummary {
  totalMinutes: number;
  byCategory: Partial<Record<Category, number>>;
  bySeverity: Partial<Record<Severity, number>>;
}

export function estimateTotalFixTime(findings: Finding[]): FixTimeSummary {
  let total = 0;
  const byCategory: Partial<Record<Category, number>> = {};
  const bySeverity: Partial<Record<Severity, number>> = {};
  for (const f of findings) {
    const m = estimateFixTime(f);
    total += m;
    byCategory[f.category] = (byCategory[f.category] ?? 0) + m;
    bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + m;
  }
  return { totalMinutes: total, byCategory, bySeverity };
}

/** Humanise a minutes count: 45 → "45m", 90 → "1h 30m", 480 → "1d" (8h/day). */
export function formatDuration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return '0m';
  const m = Math.round(minutes);
  if (m < 60) return `${m}m`;
  const hoursTotal = m / 60;
  if (hoursTotal < 8) {
    const h = Math.floor(hoursTotal);
    const rem = m - h * 60;
    return rem === 0 ? `${h}h` : `${h}h ${rem}m`;
  }
  const days = hoursTotal / 8;
  const d = Math.floor(days);
  const remHours = Math.round(hoursTotal - d * 8);
  return remHours === 0 ? `${d}d` : `${d}d ${remHours}h`;
}
