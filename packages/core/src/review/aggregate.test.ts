import { describe, it, expect } from 'vitest';
import {
  summarizeFindings,
  sortFindingsBySeverity,
  groupFindingsByCategory,
  mergeResults,
  formatTokens,
} from './aggregate.js';
import type { Finding, ReviewResult } from './types.js';

const f = (over: Partial<Finding>): Finding => ({
  id: 'x', severity: 'info', category: 'other',
  title: 't', description: 'd', suggestion: 's',
  ...over,
});

describe('summarizeFindings', () => {
  it('counts by severity and category', () => {
    const summary = summarizeFindings([
      f({ severity: 'critical', category: 'security' }),
      f({ severity: 'critical', category: 'security' }),
      f({ severity: 'warning', category: 'style' }),
      f({ severity: 'info', category: 'other' }),
    ]);
    expect(summary.total).toBe(4);
    expect(summary.bySeverity.critical).toBe(2);
    expect(summary.bySeverity.warning).toBe(1);
    expect(summary.bySeverity.info).toBe(1);
    expect(summary.bySeverity.error).toBe(0);
    expect(summary.byCategory.security).toBe(2);
    expect(summary.byCategory.style).toBe(1);
  });

  it('handles empty array', () => {
    const s = summarizeFindings([]);
    expect(s.total).toBe(0);
  });
});

describe('sortFindingsBySeverity', () => {
  it('orders critical > error > warning > info, then by line', () => {
    const input = [
      f({ id: 'a', severity: 'info' }),
      f({ id: 'b', severity: 'critical', line: 10 }),
      f({ id: 'c', severity: 'warning' }),
      f({ id: 'd', severity: 'critical', line: 2 }),
      f({ id: 'e', severity: 'error' }),
    ];
    const sorted = sortFindingsBySeverity(input);
    expect(sorted.map((x) => x.id)).toEqual(['d', 'b', 'e', 'c', 'a']);
  });

  it('does not mutate input', () => {
    const input = [f({ id: 'a', severity: 'info' }), f({ id: 'b', severity: 'critical' })];
    sortFindingsBySeverity(input);
    expect(input[0]?.id).toBe('a');
  });
});

describe('groupFindingsByCategory', () => {
  it('groups into all 6 buckets', () => {
    const grouped = groupFindingsByCategory([
      f({ id: 'a', category: 'security' }),
      f({ id: 'b', category: 'security' }),
      f({ id: 'c', category: 'performance' }),
    ]);
    expect(grouped.security).toHaveLength(2);
    expect(grouped.performance).toHaveLength(1);
    expect(grouped.style).toEqual([]);
    expect(grouped.other).toEqual([]);
  });
});

const r = (over: Partial<ReviewResult>): ReviewResult => ({
  summary: 's', score: 80, findings: [], language: 'typescript',
  provider: 'anthropic', model: 'claude-sonnet-4-6',
  ...over,
});

describe('mergeResults', () => {
  it('returns a blank default on empty input', () => {
    const merged = mergeResults([]);
    expect(merged.findings).toEqual([]);
    expect(merged.score).toBe(100);
    expect(merged.language).toBe('unknown');
  });

  it('returns the single input as-is when length 1', () => {
    const only = r({ score: 42 });
    expect(mergeResults([only])).toBe(only);
  });

  it('renumbers finding ids f1..fN across the merge', () => {
    const merged = mergeResults([
      r({ findings: [f({ id: 'dup', title: 'A' }), f({ id: 'dup', title: 'B' })] }),
      r({ findings: [f({ id: 'dup', title: 'C' })] }),
    ]);
    expect(merged.findings.map((x) => x.id)).toEqual(['f1', 'f2', 'f3']);
    expect(merged.findings.map((x) => x.title)).toEqual(['A', 'B', 'C']);
  });

  it('averages scores and sums tokens when all present', () => {
    const merged = mergeResults([
      r({ score: 80, tokensUsed: { input: 100, output: 50 } }),
      r({ score: 60, tokensUsed: { input: 200, output: 75 } }),
    ]);
    expect(merged.score).toBe(70);
    expect(merged.tokensUsed).toEqual({ input: 300, output: 125 });
  });

  it('omits tokensUsed if any result is missing it', () => {
    const merged = mergeResults([
      r({ tokensUsed: { input: 10, output: 5 } }),
      r({}),
    ]);
    expect(merged.tokensUsed).toBeUndefined();
  });

  it('sets language="mixed" when results disagree', () => {
    const merged = mergeResults([
      r({ language: 'typescript' }),
      r({ language: 'python' }),
    ]);
    expect(merged.language).toBe('mixed');
  });

  it('keeps a single language when all agree', () => {
    const merged = mergeResults([
      r({ language: 'rust' }),
      r({ language: 'rust' }),
    ]);
    expect(merged.language).toBe('rust');
  });

  it('joins summaries in order with (N) prefixes', () => {
    const merged = mergeResults([
      r({ summary: 'first issue' }),
      r({ summary: 'second issue' }),
    ]);
    expect(merged.summary).toBe('(1) first issue (2) second issue');
  });

  it('respects provider/model overrides', () => {
    const merged = mergeResults(
      [r({ provider: 'anthropic' }), r({ provider: 'openai' })],
      { provider: 'custom', model: 'm1' },
    );
    expect(merged.provider).toBe('custom');
    expect(merged.model).toBe('m1');
  });
});

describe('formatTokens', () => {
  it('shows raw number under 1000', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(42)).toBe('42');
    expect(formatTokens(999)).toBe('999');
  });

  it('abbreviates thousands with k', () => {
    expect(formatTokens(1000)).toBe('1k');
    expect(formatTokens(1234)).toBe('1.2k');
    expect(formatTokens(12_500)).toBe('12.5k');
  });

  it('abbreviates millions with M', () => {
    expect(formatTokens(1_000_000)).toBe('1M');
    expect(formatTokens(1_500_000)).toBe('1.5M');
  });

  it('returns "0" for invalid or negative input', () => {
    expect(formatTokens(NaN)).toBe('0');
    expect(formatTokens(-10)).toBe('0');
    expect(formatTokens(Infinity)).toBe('0');
  });
});
