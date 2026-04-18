import { describe, it, expect } from 'vitest';
import { detectLanguage, parseReviewResponse, sanitizeFinding } from './parser.js';

describe('detectLanguage', () => {
  it('detects by extension', () => {
    expect(detectLanguage('', 'foo.ts')).toBe('typescript');
    expect(detectLanguage('', 'foo.tsx')).toBe('typescript');
    expect(detectLanguage('', 'foo.py')).toBe('python');
    expect(detectLanguage('', 'foo.rs')).toBe('rust');
    expect(detectLanguage('', 'foo.go')).toBe('go');
    expect(detectLanguage('', 'x.YML')).toBe('yaml');
  });

  it('falls back to shebang when no filename', () => {
    expect(detectLanguage('#!/usr/bin/env python3\n...')).toBe('python');
    expect(detectLanguage('#!/bin/bash\n...')).toBe('shell');
    expect(detectLanguage('#!/usr/bin/env node\n...')).toBe('javascript');
  });

  it('returns unknown for no hints', () => {
    expect(detectLanguage('hello', 'foo.xyz')).toBe('unknown');
    expect(detectLanguage('hello world')).toBe('unknown');
  });

  it('returns unknown for unknown shebang binary', () => {
    expect(detectLanguage('#!/bin/weird-binary\nstuff')).toBe('unknown');
  });
});

describe('sanitizeFinding', () => {
  it('throws on non-object input', () => {
    expect(() => sanitizeFinding(null, 0)).toThrow();
    expect(() => sanitizeFinding('string', 0)).toThrow();
    expect(() => sanitizeFinding(42, 0)).toThrow();
  });

  it('coerces invalid severity to info', () => {
    const f = sanitizeFinding({ severity: 'catastrophic', title: 'x' }, 0);
    expect(f.severity).toBe('info');
  });

  it('coerces invalid category to other', () => {
    const f = sanitizeFinding({ category: 'magic', title: 'x' }, 0);
    expect(f.category).toBe('other');
  });

  it('drops non-numeric line', () => {
    const f = sanitizeFinding({ title: 'x', line: '12' }, 0);
    expect(f.line).toBeUndefined();
  });

  it('keeps numeric line', () => {
    const f = sanitizeFinding({ title: 'x', line: 42 }, 0);
    expect(f.line).toBe(42);
  });

  it('generates default id when missing', () => {
    const f = sanitizeFinding({ title: 'x' }, 3);
    expect(f.id).toBe('f4');
  });

  it('defaults title to Untitled finding', () => {
    const f = sanitizeFinding({}, 0);
    expect(f.title).toBe('Untitled finding');
  });

  it('stringifies non-string fields and coerces nullish to empty', () => {
    const f = sanitizeFinding({ title: 42, description: null, suggestion: undefined }, 0);
    expect(f.title).toBe('42');
    // null/undefined description/suggestion fall through `?? ''` before String().
    expect(f.description).toBe('');
    expect(f.suggestion).toBe('');
  });

  it('stringifies truthy non-string description/suggestion', () => {
    const f = sanitizeFinding({ title: 'x', description: 42, suggestion: true }, 0);
    expect(f.description).toBe('42');
    expect(f.suggestion).toBe('true');
  });
});

describe('parseReviewResponse', () => {
  const base = { summary: 's', score: 90, findings: [] };

  it('parses clean JSON', () => {
    const r = parseReviewResponse(JSON.stringify(base), 'p', 'm', 'ts');
    expect(r.summary).toBe('s');
    expect(r.score).toBe(90);
    expect(r.findings).toEqual([]);
    expect(r.provider).toBe('p');
    expect(r.model).toBe('m');
    expect(r.language).toBe('ts');
  });

  it('strips markdown fences', () => {
    const fenced = '```json\n' + JSON.stringify(base) + '\n```';
    const r = parseReviewResponse(fenced, 'p', 'm', 'ts');
    expect(r.summary).toBe('s');
  });

  it('tolerates prefix/suffix text', () => {
    const noisy = 'Here is the review: ' + JSON.stringify(base) + ' Thanks!';
    const r = parseReviewResponse(noisy, 'p', 'm', 'ts');
    expect(r.summary).toBe('s');
  });

  it('clamps score to 0..100', () => {
    const high = { ...base, score: 250 };
    expect(parseReviewResponse(JSON.stringify(high), 'p', 'm', 'ts').score).toBe(100);
    const low = { ...base, score: -40 };
    expect(parseReviewResponse(JSON.stringify(low), 'p', 'm', 'ts').score).toBe(0);
  });

  it('defaults score to 50 when missing', () => {
    const r = parseReviewResponse(JSON.stringify({ summary: 'x', findings: [] }), 'p', 'm', 'ts');
    expect(r.score).toBe(50);
  });

  it('sanitizes every finding', () => {
    const input = {
      summary: 'x',
      score: 50,
      findings: [
        { severity: 'bogus', category: 'fake', title: 'a' },
        { severity: 'critical', category: 'security', title: 'b', line: 10 },
      ],
    };
    const r = parseReviewResponse(JSON.stringify(input), 'p', 'm', 'ts');
    expect(r.findings).toHaveLength(2);
    expect(r.findings[0]?.severity).toBe('info');
    expect(r.findings[1]?.line).toBe(10);
  });

  it('throws on unparseable JSON', () => {
    expect(() => parseReviewResponse('not json at all', 'p', 'm', 'ts')).toThrow();
  });

  it('threads tokensUsed through when provided', () => {
    const r = parseReviewResponse(
      JSON.stringify(base), 'p', 'm', 'ts',
      { input: 100, output: 200 },
    );
    expect(r.tokensUsed).toEqual({ input: 100, output: 200 });
  });
});
