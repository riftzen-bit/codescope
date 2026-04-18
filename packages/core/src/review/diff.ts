import type { Finding, ReviewResult } from './types.js';
import { findingCodeScopeFingerprint as fingerprint } from './fingerprint.js';

export interface FindingsDiff {
  added: Finding[];
  removed: Finding[];
  unchanged: Finding[];
  scoreDelta: number;
}

/**
 * Compare a "before" and "after" review. Returns findings that appear only in
 * `after` (added), only in `before` (removed, i.e. fixed), and findings in
 * both runs (unchanged). Findings are matched by content fingerprint, not by
 * id, so reruns that renumber ids still diff cleanly.
 */
export function diffFindings(
  before: ReviewResult | { findings: Finding[]; score?: number },
  after: ReviewResult | { findings: Finding[]; score?: number },
): FindingsDiff {
  const beforePrint = new Map<string, Finding>();
  for (const f of before.findings) beforePrint.set(fingerprint(f), f);

  const added: Finding[] = [];
  const unchanged: Finding[] = [];
  const seen = new Set<string>();

  for (const f of after.findings) {
    const key = fingerprint(f);
    if (beforePrint.has(key)) {
      unchanged.push(f);
      seen.add(key);
    } else {
      added.push(f);
    }
  }

  const removed: Finding[] = [];
  for (const [key, f] of beforePrint) {
    if (!seen.has(key)) removed.push(f);
  }

  const beforeScore = 'score' in before && typeof before.score === 'number' ? before.score : 0;
  const afterScore = 'score' in after && typeof after.score === 'number' ? after.score : 0;

  return { added, removed, unchanged, scoreDelta: afterScore - beforeScore };
}
