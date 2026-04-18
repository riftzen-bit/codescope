import { describe, it, expect } from 'vitest';
import { toCSV, toHTML, toJUnitXML, toGithubAnnotations, toDiffHTML } from './exporters.js';
import { diffFindings } from './diff.js';
import type { Finding, ReviewResult } from './types.js';

const sample: ReviewResult = {
  summary: 'Some issues found.',
  score: 75,
  language: 'typescript',
  provider: 'anthropic',
  model: 'claude-sonnet-4-6',
  findings: [
    {
      id: 'f1',
      severity: 'critical',
      category: 'security',
      line: 42,
      title: 'SQL injection risk',
      description: 'Raw user input, concatenated.',
      suggestion: 'Use parameterized queries',
    },
    {
      id: 'f2',
      severity: 'warning',
      category: 'style',
      title: 'Unused, quoted "variable"',
      description: 'Remove it',
      suggestion: '',
    },
    {
      id: 'f3',
      severity: 'info',
      category: 'other',
      title: 'Advisory',
      description: 'nit',
      suggestion: 'none',
    },
  ],
};

describe('toCSV', () => {
  it('emits header + one row per finding', () => {
    const csv = toCSV(sample, 'src/db.ts');
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('id,severity,category,line,title,description,suggestion,file');
    expect(lines).toHaveLength(4);
    expect(lines[1]).toContain('f1');
    expect(lines[1]).toContain('42');
    expect(lines[1]).toContain('src/db.ts');
  });

  it('quotes cells containing comma/quote/newline', () => {
    const csv = toCSV(sample);
    // row 2 has an embedded double-quote in the title
    expect(csv).toContain('"Unused, quoted ""variable"""');
  });

  it('leaves empty findings array as header-only output', () => {
    const csv = toCSV({ ...sample, findings: [] });
    expect(csv).toBe('id,severity,category,line,title,description,suggestion,file');
  });
});

describe('toHTML', () => {
  it('escapes title/description to prevent injection', () => {
    const evil: ReviewResult = {
      ...sample,
      findings: [{ ...sample.findings[0]!, title: '<script>x</script>' }],
    };
    const html = toHTML(evil, 'f.ts');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>x</script>');
  });

  it('is a complete html document', () => {
    const html = toHTML(sample, 'f.ts');
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toContain('</html>');
    expect(html).toContain('75/100');
  });

  it('shows no-issues placeholder when findings empty', () => {
    const html = toHTML({ ...sample, findings: [] });
    expect(html).toContain('No issues detected');
  });

  it('escapes every user-controllable field against XSS injection', () => {
    const payload = '<script>alert(1)</script>';
    const hostile: ReviewResult = {
      summary: payload,
      score: 42,
      language: payload,
      provider: payload,
      model: payload,
      findings: [
        {
          id: payload,
          severity: payload as unknown as 'critical',
          category: payload as unknown as 'security',
          line: payload as unknown as number,
          title: payload,
          description: payload,
          suggestion: payload,
        },
      ],
    };
    const html = toHTML(hostile, payload);
    // Literal script tag must not appear anywhere in output
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('</script>');
    // Escaped form must appear
    expect(html).toContain('&lt;script&gt;');
  });

  it('survives non-Severity severity value without injection', () => {
    const hostile: ReviewResult = {
      ...sample,
      findings: [{
        ...sample.findings[0]!,
        severity: 'red; background:url(javascript:alert(1))' as unknown as 'critical',
      }],
    };
    const html = toHTML(hostile);
    expect(html).not.toContain('javascript:');
    expect(html).toContain('border-left:4px solid #');
  });
});

describe('toJUnitXML', () => {
  it('produces well-formed XML with per-category testsuites', () => {
    const xml = toJUnitXML(sample, 'src/db.ts');
    expect(xml).toMatch(/^<\?xml version="1\.0"/);
    expect(xml).toContain('<testsuites');
    expect(xml).toContain('name="security"');
    expect(xml).toContain('name="style"');
    expect(xml).toContain('tests="3"');
  });

  it('emits <skipped> for info findings and <failure> otherwise', () => {
    const xml = toJUnitXML(sample);
    expect(xml).toContain('<skipped message="Advisory"');
    expect(xml).toContain('<failure type="critical"');
    expect(xml).toContain('<failure type="warning"');
  });

  it('escapes xml-hostile chars', () => {
    const xml = toJUnitXML(sample);
    expect(xml).toContain('&quot;variable&quot;');
  });

  it('empty findings produces valid empty suite set', () => {
    const xml = toJUnitXML({ ...sample, findings: [] });
    expect(xml).toContain('tests="0"');
    expect(xml).toContain('</testsuites>');
  });
});

describe('toGithubAnnotations', () => {
  it('maps severity to error/warning/notice', () => {
    const out = toGithubAnnotations(sample, 'src/db.ts');
    const lines = out.split('\n');
    expect(lines[0]).toMatch(/^::error /);
    expect(lines[1]).toMatch(/^::warning /);
    expect(lines[2]).toMatch(/^::notice /);
  });

  it('includes file and line', () => {
    const out = toGithubAnnotations(sample, 'src/db.ts');
    expect(out).toContain('file=src/db.ts');
    expect(out).toContain('line=42');
  });

  it('encodes newlines in message body', () => {
    const out = toGithubAnnotations(sample, 'x.ts');
    // sample[0] has a suggestion, so description+suggestion joined with blank line
    expect(out).toContain('%0A');
  });

  it('normalises backslashes in filename', () => {
    const out = toGithubAnnotations(sample, 'src\\db.ts');
    expect(out).toContain('file=src/db.ts');
  });
});

describe('toDiffHTML', () => {
  const mk = (id: string, over: Partial<Finding> = {}): Finding => ({
    id, severity: 'warning', category: 'style',
    title: 't-' + id, description: 'd-' + id, suggestion: '',
    ...over,
  });
  const before: ReviewResult = {
    ...sample, score: 60,
    findings: [mk('a', { title: 'keep me', severity: 'error', category: 'security' }),
               mk('b', { title: 'fix me',  severity: 'warning' })],
  };
  const after: ReviewResult = {
    ...sample, score: 80,
    findings: [mk('a', { title: 'keep me', severity: 'error', category: 'security' }),
               mk('c', { title: 'new bug', severity: 'critical', category: 'security' })],
  };

  it('renders sections for added/fixed/unchanged', () => {
    const diff = diffFindings(before, after);
    const html = toDiffHTML(diff, { filename: 'x.ts' });
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toContain('Added (1)');
    expect(html).toContain('Fixed (1)');
    expect(html).toContain('Unchanged (1)');
    expect(html).toContain('new bug');
    expect(html).toContain('fix me');
    expect(html).toContain('keep me');
  });

  it('shows score delta with up arrow when improving', () => {
    const diff = diffFindings(before, after);
    const html = toDiffHTML(diff);
    expect(html).toContain('↑');
    expect(html).toContain('20');
  });

  it('shows down arrow when regressing', () => {
    const diff = diffFindings(after, before);
    const html = toDiffHTML(diff);
    expect(html).toContain('↓');
  });

  it('empty-state placeholders when no changes', () => {
    const diff = diffFindings(before, before);
    const html = toDiffHTML(diff);
    expect(html).toContain('No new findings');
    expect(html).toContain('No findings were fixed');
  });

  it('escapes html in titles', () => {
    const malBefore: ReviewResult = { ...before, findings: [] };
    const malAfter: ReviewResult = {
      ...after,
      findings: [mk('x', { title: '<script>x</script>' })],
    };
    const html = toDiffHTML(diffFindings(malBefore, malAfter));
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>x</script>');
  });
});
