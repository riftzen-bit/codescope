import { describe, it, expect } from 'vitest';
import { ReviewCache, reviewCacheKey, djb2, contentKey } from './cache.js';
import type { ReviewResult } from './types.js';

const r = (summary: string): ReviewResult => ({
  summary, score: 50, findings: [], language: 'ts', provider: 'p', model: 'm',
});

describe('djb2', () => {
  it('is deterministic', () => {
    expect(djb2('hello')).toBe(djb2('hello'));
  });

  it('differs for different input', () => {
    expect(djb2('foo')).not.toBe(djb2('bar'));
  });

  it('returns hex', () => {
    expect(djb2('x')).toMatch(/^[0-9a-f]+$/);
  });
});

describe('contentKey', () => {
  it('is deterministic', () => {
    expect(contentKey('hello')).toBe(contentKey('hello'));
  });

  it('differs for different input of same length', () => {
    expect(contentKey('abcd')).not.toBe(contentKey('bcda'));
  });

  it('embeds length', () => {
    // Zero-length input still produces a well-formed key.
    expect(contentKey('')).toMatch(/^0\./);
  });

  it('differs between similar inputs that would djb2-collide easily', () => {
    // Two different strings that share a djb2 prefix/suffix behavior — the
    // composite includes length + independent-salt djb2 so drift shows up.
    const a = 'x'.repeat(100);
    const b = 'x'.repeat(99) + 'y';
    expect(contentKey(a)).not.toBe(contentKey(b));
  });
});

describe('reviewCacheKey', () => {
  it('differs by provider / model / code', () => {
    const a = reviewCacheKey({ code: 'x' }, 'p1', 'm1');
    const b = reviewCacheKey({ code: 'x' }, 'p2', 'm1');
    const c = reviewCacheKey({ code: 'x' }, 'p1', 'm2');
    const d = reviewCacheKey({ code: 'y' }, 'p1', 'm1');
    expect(new Set([a, b, c, d]).size).toBe(4);
  });

  it('is stable under rule reordering', () => {
    const a = reviewCacheKey({ code: 'x', rules: ['a', 'b'] }, 'p', 'm');
    const b = reviewCacheKey({ code: 'x', rules: ['b', 'a'] }, 'p', 'm');
    expect(a).toBe(b);
  });

  it('changes when filename changes', () => {
    const a = reviewCacheKey({ code: 'x', filename: 'a.ts' }, 'p', 'm');
    const b = reviewCacheKey({ code: 'x', filename: 'b.ts' }, 'p', 'm');
    expect(a).not.toBe(b);
  });
});

describe('ReviewCache', () => {
  it('stores and retrieves', () => {
    const cache = new ReviewCache(3);
    cache.set('k1', r('a'));
    expect(cache.get('k1')?.summary).toBe('a');
  });

  it('evicts oldest at capacity', () => {
    const cache = new ReviewCache(2);
    cache.set('k1', r('a'));
    cache.set('k2', r('b'));
    cache.set('k3', r('c'));
    expect(cache.size).toBe(2);
    expect(cache.get('k1')).toBeUndefined();
    expect(cache.get('k2')?.summary).toBe('b');
    expect(cache.get('k3')?.summary).toBe('c');
  });

  it('touches entries on get so LRU preserves recent', () => {
    const cache = new ReviewCache(2);
    cache.set('k1', r('a'));
    cache.set('k2', r('b'));
    cache.get('k1'); // touch k1
    cache.set('k3', r('c')); // should evict k2, not k1
    expect(cache.get('k1')?.summary).toBe('a');
    expect(cache.get('k2')).toBeUndefined();
    expect(cache.get('k3')?.summary).toBe('c');
  });

  it('clear drops all entries', () => {
    const cache = new ReviewCache(5);
    cache.set('k1', r('a'));
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it('rejects capacity < 1', () => {
    expect(() => new ReviewCache(0)).toThrow();
  });
});
