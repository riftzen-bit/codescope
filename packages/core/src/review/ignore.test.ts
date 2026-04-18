import { describe, it, expect } from 'vitest';
import { IgnoreList, findingFingerprint } from './ignore.js';
import type { Finding } from './types.js';

const f = (over: Partial<Finding>): Finding => ({
  id: 'x', severity: 'info', category: 'other',
  title: 't', description: 'd', suggestion: 's',
  ...over,
});

describe('findingFingerprint', () => {
  it('ignores id field (stable across reruns)', () => {
    const a = f({ id: 'f1', title: 'Bug' });
    const b = f({ id: 'f99', title: 'Bug' });
    expect(findingFingerprint(a)).toBe(findingFingerprint(b));
  });

  it('differs by title', () => {
    expect(findingFingerprint(f({ title: 'A' })))
      .not.toBe(findingFingerprint(f({ title: 'B' })));
  });

  it('is case-insensitive for title/description', () => {
    const a = findingFingerprint(f({ title: 'FOO', description: 'BAR' }));
    const b = findingFingerprint(f({ title: 'foo', description: 'bar' }));
    expect(a).toBe(b);
  });
});

describe('IgnoreList', () => {
  it('add/has/remove/clear', () => {
    const ig = new IgnoreList();
    const x = f({ title: 'Issue A' });
    expect(ig.has(x)).toBe(false);
    ig.add(x);
    expect(ig.has(x)).toBe(true);
    expect(ig.size()).toBe(1);
    ig.remove(x);
    expect(ig.has(x)).toBe(false);
    ig.add(x);
    ig.clear();
    expect(ig.size()).toBe(0);
  });

  it('filter() drops dismissed findings', () => {
    const ig = new IgnoreList();
    const keep = f({ title: 'keep' });
    const drop = f({ title: 'drop' });
    ig.add(drop);
    expect(ig.filter([keep, drop])).toEqual([keep]);
  });

  it('accepts initial iterable', () => {
    const x = f({ title: 'old' });
    const ig = new IgnoreList([findingFingerprint(x)]);
    expect(ig.has(x)).toBe(true);
  });

  it('toArray returns all fingerprints', () => {
    const ig = new IgnoreList();
    ig.add(f({ title: 'a' }));
    ig.add(f({ title: 'b' }));
    expect(ig.toArray()).toHaveLength(2);
  });
});

describe('IgnoreList regex patterns', () => {
  it('addPattern accepts valid regex', () => {
    const ig = new IgnoreList();
    expect(ig.addPattern('typo\\s+in')).toBe(true);
    expect(ig.patternList()).toContain('typo\\s+in');
  });

  it('addPattern rejects empty / invalid', () => {
    const ig = new IgnoreList();
    expect(ig.addPattern('')).toBe(false);
    expect(ig.addPattern('   ')).toBe(false);
    expect(ig.addPattern('(unclosed')).toBe(false);
    expect(ig.patternList()).toHaveLength(0);
  });

  it('matches against title (case-insensitive)', () => {
    const ig = new IgnoreList();
    ig.addPattern('TYPO');
    expect(ig.has(f({ title: 'Small typo in comment' }))).toBe(true);
  });

  it('matches against description', () => {
    const ig = new IgnoreList();
    ig.addPattern('magic number');
    expect(ig.has(f({ title: 'Bad', description: 'Contains a magic number here' }))).toBe(true);
  });

  it('does not match unrelated finding', () => {
    const ig = new IgnoreList();
    ig.addPattern('typo');
    expect(ig.has(f({ title: 'Security bug', description: 'SQL injection' }))).toBe(false);
  });

  it('initial patterns accepted via constructor', () => {
    const ig = new IgnoreList([], ['nitpick']);
    expect(ig.has(f({ title: 'Nitpick about naming' }))).toBe(true);
  });

  it('removePattern drops rule', () => {
    const ig = new IgnoreList();
    ig.addPattern('typo');
    ig.removePattern('typo');
    expect(ig.has(f({ title: 'typo everywhere' }))).toBe(false);
  });

  it('clear() wipes patterns too', () => {
    const ig = new IgnoreList();
    ig.addPattern('typo');
    ig.clear();
    expect(ig.patternList()).toHaveLength(0);
  });

  it('filter() drops regex-matched findings', () => {
    const ig = new IgnoreList();
    ig.addPattern('^nit:');
    const keep = f({ title: 'Real bug' });
    const drop = f({ title: 'nit: name this better' });
    expect(ig.filter([keep, drop])).toEqual([keep]);
  });
});
