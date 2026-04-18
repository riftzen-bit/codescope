import type { Finding } from './types.js';

/**
 * Stable, content-based identifier for a finding. Two reviews that surface
 * "the same issue" will produce the same fingerprint even if the AI renumbers
 * ids or changes wording slightly (first 80 chars of description).
 */
export function findingFingerprint(f: Finding): string {
  const desc = (f.description || '').slice(0, 80).toLowerCase().trim();
  const title = f.title.toLowerCase().trim();
  return `${f.category}|${f.severity}|${f.line ?? ''}|${title}|${desc}`;
}

function safeCompile(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern, 'i');
  } catch {
    return null;
  }
}

/** Hard cap on the compiled-regex cache. Patterns are user-authored and
 *  usually few, but unbounded growth is still a memory bug. LRU via
 *  insertion-order eviction on Map. */
const REGEX_CACHE_CAP = 256;

/**
 * Ignore-list: set of fingerprints the user has dismissed plus an optional
 * set of regex patterns matched against title/description. The fingerprint
 * store is a plain Set so callers can persist it however they want
 * (localStorage, Electron settings, JSON file, etc.).
 *
 * Regex patterns are stored as their source strings and compiled lazily
 * with a bounded LRU cache; invalid regex strings are skipped silently so a
 * bad pattern cannot crash filtering.
 */
export class IgnoreList {
  private readonly store: Set<string>;
  private readonly patterns: Set<string>;
  private readonly regexCache = new Map<string, RegExp | null>();

  constructor(initial: Iterable<string> = [], patterns: Iterable<string> = []) {
    this.store = new Set(initial);
    this.patterns = new Set(patterns);
  }

  private getCompiled(p: string): RegExp | null {
    if (this.regexCache.has(p)) {
      const rx = this.regexCache.get(p) ?? null;
      // touch: re-insert so it's the most-recently-used entry
      this.regexCache.delete(p);
      this.regexCache.set(p, rx);
      return rx;
    }
    const rx = safeCompile(p);
    if (this.regexCache.size >= REGEX_CACHE_CAP) {
      const oldest = this.regexCache.keys().next().value;
      if (oldest !== undefined) this.regexCache.delete(oldest);
    }
    this.regexCache.set(p, rx);
    return rx;
  }

  has(f: Finding): boolean {
    if (this.store.has(findingFingerprint(f))) return true;
    if (this.patterns.size === 0) return false;
    const hay = `${f.title}\n${f.description}`;
    for (const p of this.patterns) {
      const rx = this.getCompiled(p);
      if (rx && rx.test(hay)) return true;
    }
    return false;
  }

  add(f: Finding): void {
    this.store.add(findingFingerprint(f));
  }

  remove(f: Finding): void {
    this.store.delete(findingFingerprint(f));
  }

  addPattern(pattern: string): boolean {
    const trimmed = pattern.trim();
    if (!trimmed) return false;
    if (!safeCompile(trimmed)) return false;
    this.patterns.add(trimmed);
    return true;
  }

  removePattern(pattern: string): void {
    this.patterns.delete(pattern);
    this.regexCache.delete(pattern);
  }

  patternList(): string[] {
    return [...this.patterns];
  }

  clear(): void {
    this.store.clear();
    this.patterns.clear();
    this.regexCache.clear();
  }

  size(): number {
    return this.store.size;
  }

  toArray(): string[] {
    return [...this.store];
  }

  filter(findings: Finding[]): Finding[] {
    return findings.filter((f) => !this.has(f));
  }
}
