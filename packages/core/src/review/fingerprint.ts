import type { Finding } from './types.js';

/**
 * Normalize prose so rerun-to-rerun prose drift (line numbers, backticked
 * identifiers, rephrased wording) doesn't fork the fingerprint.
 */
function normalizeProse(s: string): string {
  return s
    .toLowerCase()
    .replace(/`[^`]*`/g, ' id ')
    .replace(/\b(?:line|lines|l)\s*\d+(?:\s*[-:]\s*\d+)?\b/g, ' line ')
    .replace(/\b\d+\b/g, ' n ')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Content-addressable fingerprint so "same finding" survives id renumbering
 * between reviews. Stable across id-renumbering and minor prose drift.
 * Versioned so consumers can distinguish this scheme from future ones.
 */
export function findingCodeScopeFingerprint(f: Finding): string {
  const title = normalizeProse(f.title);
  const desc = normalizeProse(f.description || '').slice(0, 80);
  return `${f.category}|${f.severity}|${f.line ?? ''}|${title}|${desc}`;
}

export const FINGERPRINT_SCHEME_VERSION = 'codeScope/v1';
