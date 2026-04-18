import { describe, it, expect } from 'vitest';
import { diffFindings } from './diff.js';
import type { Finding, ReviewResult } from './types.js';

const f = (over: Partial<Finding>): Finding => ({
  id: 'x', severity: 'info', category: 'other',
  title: 't', description: 'd', suggestion: 's',
  ...over,
});

const result = (findings: Finding[], score = 70): ReviewResult => ({
  summary: '', score, findings, language: 'ts', provider: 'p', model: 'm',
});

describe('diffFindings', () => {
  it('separates added/removed/unchanged by fingerprint', () => {
    const before = result([
      f({ id: 'a', title: 'SQL injection', category: 'security', line: 10 }),
      f({ id: 'b', title: 'Unused var',    category: 'style',    line: 20 }),
    ]);
    const after = result([
      // renumbered id, same fingerprint
      f({ id: 'q1', title: 'SQL injection', category: 'security', line: 10 }),
      f({ id: 'q2', title: 'Missing await', category: 'correctness', line: 30 }),
    ]);
    const diff = diffFindings(before, after);
    expect(diff.unchanged.map((x) => x.title)).toEqual(['SQL injection']);
    expect(diff.added.map((x) => x.title)).toEqual(['Missing await']);
    expect(diff.removed.map((x) => x.title)).toEqual(['Unused var']);
  });

  it('scoreDelta reflects change', () => {
    const diff = diffFindings(result([], 60), result([], 80));
    expect(diff.scoreDelta).toBe(20);
  });

  it('empty before is all additions', () => {
    const diff = diffFindings(result([]), result([f({ id: 'a', title: 'x' })]));
    expect(diff.added).toHaveLength(1);
    expect(diff.removed).toHaveLength(0);
  });

  it('empty after is all removals', () => {
    const diff = diffFindings(result([f({ id: 'a', title: 'x' })]), result([]));
    expect(diff.removed).toHaveLength(1);
    expect(diff.added).toHaveLength(0);
  });

  it('treats title case/whitespace differences as same fingerprint', () => {
    const before = result([f({ title: 'SQL injection', category: 'security', line: 10 })]);
    const after = result([f({ title: '  sql INJECTION  ', category: 'security', line: 10 })]);
    const diff = diffFindings(before, after);
    expect(diff.unchanged).toHaveLength(1);
    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
  });

  it('ignores line-number and identifier drift in description', () => {
    const before = result([f({
      title: 'Unsafe cast',
      category: 'correctness',
      line: 10,
      description: 'Cast at line 42 in `foo.ts` may drop precision.',
    })]);
    const after = result([f({
      title: 'Unsafe cast',
      category: 'correctness',
      line: 10,
      description: 'Cast at line 53 in `bar.ts` may drop precision.',
    })]);
    const diff = diffFindings(before, after);
    expect(diff.unchanged).toHaveLength(1);
    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
  });
});
