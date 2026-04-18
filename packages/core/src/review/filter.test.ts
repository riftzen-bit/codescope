import { describe, it, expect } from 'vitest';
import { filterFindings } from './filter.js';
import type { Finding } from './types.js';

const f = (over: Partial<Finding>): Finding => ({
  id: 'x', severity: 'info', category: 'other',
  title: 't', description: 'd', suggestion: 's',
  ...over,
});

describe('filterFindings', () => {
  const sample: Finding[] = [
    f({ id: '1', severity: 'critical', category: 'security', title: 'SQL injection', line: 10 }),
    f({ id: '2', severity: 'warning',  category: 'style',    title: 'Unused var',    line: 50 }),
    f({ id: '3', severity: 'info',     category: 'other',    title: 'Comment typo',  description: 'spelling issue' }),
    f({ id: '4', severity: 'error',    category: 'performance', title: 'N+1 query',  line: 120 }),
  ];

  it('returns all when filter empty', () => {
    expect(filterFindings(sample, {})).toHaveLength(4);
  });

  it('filters by severity set', () => {
    const out = filterFindings(sample, { severities: new Set(['critical', 'error']) });
    expect(out.map((x) => x.id)).toEqual(['1', '4']);
  });

  it('filters by severity array', () => {
    const out = filterFindings(sample, { severities: ['warning'] });
    expect(out.map((x) => x.id)).toEqual(['2']);
  });

  it('filters by category', () => {
    const out = filterFindings(sample, { categories: ['security', 'performance'] });
    expect(out.map((x) => x.id)).toEqual(['1', '4']);
  });

  it('query matches title/description/suggestion case-insensitively', () => {
    expect(filterFindings(sample, { query: 'SQL' }).map((x) => x.id)).toEqual(['1']);
    expect(filterFindings(sample, { query: 'spelling' }).map((x) => x.id)).toEqual(['3']);
    expect(filterFindings(sample, { query: 'SPELL' }).map((x) => x.id)).toEqual(['3']);
  });

  it('whitespace-only query is ignored', () => {
    expect(filterFindings(sample, { query: '   ' })).toHaveLength(4);
  });

  it('line range filter excludes findings without line when bounds set', () => {
    const out = filterFindings(sample, { minLine: 20, maxLine: 200 });
    expect(out.map((x) => x.id)).toEqual(['2', '4']);
  });

  it('combines filters with AND', () => {
    const out = filterFindings(sample, {
      severities: ['critical', 'warning', 'error'],
      query: 'query',
    });
    expect(out.map((x) => x.id)).toEqual(['4']);
  });
});
