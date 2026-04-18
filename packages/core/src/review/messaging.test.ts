import { describe, it, expect } from 'vitest';
import { toSlack, toEmail, toStatusLine, toMarkdownTable } from './messaging.js';
import type { Finding, ReviewResult } from './types.js';

const f = (over: Partial<Finding>): Finding => ({
  id: 'x', severity: 'info', category: 'other',
  title: 't', description: 'd', suggestion: 's',
  ...over,
});

const sample: ReviewResult = {
  summary: 'Two issues.',
  score: 80,
  language: 'typescript',
  provider: 'anthropic',
  model: 'm1',
  findings: [
    f({ id: 'f1', severity: 'critical', category: 'security', line: 10, title: 'SQLi' }),
    f({ id: 'f2', severity: 'info', category: 'style', title: 'Nit' }),
  ],
};

describe('toSlack', () => {
  it('includes score, provider, and top findings', () => {
    const s = toSlack(sample, { filename: 'db.ts' });
    expect(s).toContain('80/100');
    expect(s).toContain('db.ts');
    expect(s).toContain('SQLi');
    expect(s).toContain(':rotating_light:');
  });

  it('shows "no issues" placeholder when empty', () => {
    const s = toSlack({ ...sample, findings: [] });
    expect(s).toContain('No issues detected');
  });

  it('respects limit', () => {
    const many = { ...sample, findings: Array.from({ length: 12 }, (_, i) => f({ id: `f${i}`, title: `t${i}` })) };
    const s = toSlack(many, { limit: 3 });
    expect(s).toContain('…and 9 more');
  });

  it('escapes <>& in titles', () => {
    const bad = { ...sample, findings: [f({ title: '<script>&go' })] };
    const s = toSlack(bad);
    expect(s).toContain('&lt;script&gt;&amp;go');
  });
});

describe('toEmail', () => {
  it('produces header + sections', () => {
    const s = toEmail(sample, 'db.ts');
    expect(s).toContain('CODE REVIEW');
    expect(s).toContain('File:     db.ts');
    expect(s).toContain('Score:    80/100');
    expect(s).toContain('SUMMARY');
    expect(s).toContain('FINDINGS (2)');
    expect(s).toContain('SQLi');
  });

  it('handles empty findings cleanly', () => {
    const s = toEmail({ ...sample, findings: [] });
    expect(s).toContain('No issues detected');
    expect(s).not.toContain('FINDINGS');
  });
});

describe('toStatusLine', () => {
  it('counts by severity and shows score', () => {
    const s = toStatusLine(sample);
    expect(s).toContain('80/100');
    expect(s).toContain('1C');
    expect(s).toContain('1i');
  });

  it('marks clean when no findings', () => {
    expect(toStatusLine({ ...sample, findings: [] })).toContain('clean');
  });
});

describe('toMarkdownTable', () => {
  it('renders a table with escaped pipes', () => {
    const md = toMarkdownTable([f({ title: 'has | pipe' })]);
    expect(md).toContain('has \\| pipe');
    expect(md).toContain('| Severity |');
  });

  it('returns placeholder for empty', () => {
    expect(toMarkdownTable([])).toContain('No findings');
  });
});
