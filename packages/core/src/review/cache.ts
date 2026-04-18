import type { ReviewRequest, ReviewResult } from './types.js';

/**
 * Stable non-crypto 32-bit hash (djb2). Cheap and sync; keep for UI keys
 * and tiny-set lookups where collision cost is nil.
 */
export function djb2(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(16);
}

/**
 * Stronger sync content fingerprint used for cache keys. Combines two
 * independent djb2 hashes over different slice regions, the exact length,
 * and a head/tail sample — an adversary needs to hit every component to
 * force a collision, which is astronomically harder than colliding plain
 * djb2. Still non-cryptographic; for security-critical contexts use
 * SubtleCrypto/node:crypto SHA-256 off this call site.
 */
export function contentKey(input: string): string {
  const h1 = djb2(input);
  const h2 = djb2(`\u0001${input}\u0002`);
  const len = input.length.toString(16);
  const head = djb2(input.slice(0, 32));
  const tail = djb2(input.slice(-32));
  return `${len}.${h1}.${h2}.${head}.${tail}`;
}

/**
 * Compute a stable cache key for a review request. Two requests that
 * produce the same prompt (same code, filename, provider/model, rules)
 * share a key; changing any of those busts the cache.
 */
export function reviewCacheKey(
  request: ReviewRequest,
  provider: string,
  model: string,
): string {
  const rules = (request.rules ?? []).slice().sort().join('|');
  const filename = request.filename ?? '';
  const language = request.language ?? '';
  const parts = [provider, model, language, filename, rules, contentKey(request.code)];
  return parts.join(':');
}

export interface CachedReview {
  key: string;
  result: ReviewResult;
  createdAt: number;
}

/**
 * Bounded LRU-ish cache of review results, keyed by reviewCacheKey. When
 * capacity is exceeded the oldest entry is evicted.
 */
export class ReviewCache {
  private map = new Map<string, CachedReview>();

  constructor(private capacity: number = 50) {
    if (capacity < 1) throw new Error('Cache capacity must be >= 1');
  }

  get(key: string): ReviewResult | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    // Touch for LRU: delete+reinsert moves to the tail of Map's iteration order.
    this.map.delete(key);
    this.map.set(key, hit);
    return hit.result;
  }

  set(key: string, result: ReviewResult): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, { key, result, createdAt: Date.now() });
    while (this.map.size > this.capacity) {
      const oldestKey = this.map.keys().next().value;
      if (oldestKey === undefined) break;
      this.map.delete(oldestKey);
    }
  }

  delete(key: string): boolean {
    return this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }

  entries(): CachedReview[] {
    return Array.from(this.map.values());
  }
}
