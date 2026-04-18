import type { Finding, Severity, Category } from './types.js';

export interface FindingFilter {
  severities?: ReadonlySet<Severity> | readonly Severity[];
  categories?: ReadonlySet<Category> | readonly Category[];
  query?: string;
  minLine?: number;
  maxLine?: number;
}

function toSet<T>(v: ReadonlySet<T> | readonly T[] | undefined): ReadonlySet<T> | undefined {
  if (v === undefined) return undefined;
  return v instanceof Set ? v : new Set(v);
}

export function filterFindings(findings: Finding[], filter: FindingFilter): Finding[] {
  const sevs = toSet(filter.severities);
  const cats = toSet(filter.categories);
  const q = filter.query?.trim().toLowerCase() ?? '';
  const hasQuery = q.length > 0;
  const { minLine, maxLine } = filter;

  return findings.filter((f) => {
    if (sevs && !sevs.has(f.severity)) return false;
    if (cats && !cats.has(f.category)) return false;
    if (minLine !== undefined && (f.line === undefined || f.line < minLine)) return false;
    if (maxLine !== undefined && (f.line === undefined || f.line > maxLine)) return false;
    if (hasQuery) {
      const hay = `${f.title}\n${f.description}\n${f.suggestion}\n${f.id}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}
