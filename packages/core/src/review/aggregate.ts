import type { Finding, Severity, Category, ReviewResult } from './types.js';

export interface SeverityCounts {
  critical: number;
  error: number;
  warning: number;
  info: number;
}

export interface CategoryCounts {
  security: number;
  performance: number;
  correctness: number;
  maintainability: number;
  style: number;
  other: number;
}

export interface FindingsSummary {
  total: number;
  bySeverity: SeverityCounts;
  byCategory: CategoryCounts;
}

export function summarizeFindings(findings: Finding[]): FindingsSummary {
  const bySeverity: SeverityCounts = { critical: 0, error: 0, warning: 0, info: 0 };
  const byCategory: CategoryCounts = {
    security: 0, performance: 0, correctness: 0,
    maintainability: 0, style: 0, other: 0,
  };
  for (const f of findings) {
    bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;
    byCategory[f.category] = (byCategory[f.category] ?? 0) + 1;
  }
  return { total: findings.length, bySeverity, byCategory };
}

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0, error: 1, warning: 2, info: 3,
};

export function sortFindingsBySeverity(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    const rank = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (rank !== 0) return rank;
    const la = a.line ?? Number.MAX_SAFE_INTEGER;
    const lb = b.line ?? Number.MAX_SAFE_INTEGER;
    return la - lb;
  });
}

export function groupFindingsByCategory(findings: Finding[]): Record<Category, Finding[]> {
  const out: Record<Category, Finding[]> = {
    security: [], performance: [], correctness: [],
    maintainability: [], style: [], other: [],
  };
  for (const f of findings) out[f.category].push(f);
  return out;
}

/**
 * Combine many ReviewResults (e.g. one per file) into a single aggregate.
 * Finding ids are re-numbered to stay unique across the merge. Token counts
 * are summed when present; score is averaged (weighted by finding count if
 * you pass a weight function, otherwise equal weight per result). Provider
 * and model come from the first result; language "mixed" when they differ.
 */
export function mergeResults(
  results: ReviewResult[],
  options: { provider?: string; model?: string } = {},
): ReviewResult {
  if (results.length === 0) {
    return {
      summary: '', score: 100, findings: [], language: 'unknown',
      provider: options.provider ?? '', model: options.model ?? '',
    };
  }
  if (results.length === 1) return results[0]!;

  const findings: Finding[] = [];
  let idCounter = 1;
  for (const r of results) {
    for (const f of r.findings) {
      findings.push({ ...f, id: `f${idCounter++}` });
    }
  }

  const avgScore = Math.round(
    results.reduce((s, r) => s + r.score, 0) / results.length,
  );

  const languages = new Set(results.map((r) => r.language));
  const language = languages.size === 1 ? [...languages][0]! : 'mixed';

  const hasTokens = results.every((r) => r.tokensUsed !== undefined);
  const tokensUsed = hasTokens
    ? results.reduce(
        (acc, r) => ({
          input: acc.input + (r.tokensUsed?.input ?? 0),
          output: acc.output + (r.tokensUsed?.output ?? 0),
        }),
        { input: 0, output: 0 },
      )
    : undefined;

  const first = results[0]!;
  const summaries = results.map((r, i) => `(${i + 1}) ${r.summary}`).filter((s) => s.trim().length > 3);

  return {
    summary: summaries.join(' '),
    score: avgScore,
    findings,
    language,
    provider: options.provider ?? first.provider,
    model: options.model ?? first.model,
    ...(tokensUsed ? { tokensUsed } : {}),
  };
}

/** Human-readable token count: 1234 → "1.2k", 1_500_000 → "1.5M". */
export function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(Math.round(n));
}
