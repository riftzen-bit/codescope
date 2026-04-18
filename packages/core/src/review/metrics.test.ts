import { describe, it, expect } from 'vitest';
import { computeCodeMetrics } from './metrics.js';

describe('computeCodeMetrics', () => {
  it('returns zeros on empty input', () => {
    const m = computeCodeMetrics('');
    expect(m.lines).toBe(0);
    expect(m.branches).toBe(0);
    expect(m.commentRatio).toBe(0);
  });

  it('counts lines, blank, comment (single-line)', () => {
    const code = [
      '// hello',
      '',
      'const x = 1;',
      '// another',
      'const y = 2;',
    ].join('\n');
    const m = computeCodeMetrics(code);
    expect(m.lines).toBe(5);
    expect(m.blankLines).toBe(1);
    expect(m.commentLines).toBe(2);
    expect(m.nonBlankLines).toBe(4);
  });

  it('handles block comments across multiple lines', () => {
    const code = [
      '/* start',
      ' still a comment',
      ' end */',
      'let z = 3;',
    ].join('\n');
    const m = computeCodeMetrics(code);
    expect(m.commentLines).toBe(3);
    expect(m.lines).toBe(4);
  });

  it('counts branch keywords in code', () => {
    const code = [
      'if (a) {',
      '  for (const x of arr) {',
      '    while (cond) {',
      '      switch (k) { case 1: break; }',
      '    }',
      '  }',
      '}',
    ].join('\n');
    const m = computeCodeMetrics(code);
    expect(m.branches).toBeGreaterThanOrEqual(5);
  });

  it('does not count branch keywords inside comments', () => {
    const code = '// if while for switch\nconst x = 1;';
    const m = computeCodeMetrics(code);
    expect(m.branches).toBe(0);
  });

  it('detects TODO/FIXME tokens', () => {
    const code = '// TODO: fix\n// FIXME later\nconst x = 1;';
    const m = computeCodeMetrics(code);
    expect(m.todoCount).toBe(2);
  });

  it('tracks max nesting by indentation delta', () => {
    const code = [
      'function f() {',
      '  if (a) {',
      '    if (b) {',
      '      doThing();',
      '    }',
      '  }',
      '}',
    ].join('\n');
    const m = computeCodeMetrics(code);
    expect(m.maxNesting).toBeGreaterThanOrEqual(6);
  });

  it('reports maxLineLength and avgLineLength', () => {
    const code = 'abc\nabcdefghij\nxy';
    const m = computeCodeMetrics(code);
    expect(m.maxLineLength).toBe(10);
    expect(m.avgLineLength).toBeCloseTo(5, 0);
  });
});
