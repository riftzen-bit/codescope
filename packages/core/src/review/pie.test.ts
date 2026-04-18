import { describe, it, expect } from 'vitest';
import { toSeverityPieSVG } from './pie.js';
import type { Finding } from './types.js';

const f = (over: Partial<Finding>): Finding => ({
  id: 'x', severity: 'info', category: 'other',
  title: 't', description: 'd', suggestion: 's',
  ...over,
});

describe('toSeverityPieSVG', () => {
  it('empty returns valid SVG with title', () => {
    const svg = toSeverityPieSVG([]);
    expect(svg).toMatch(/^<svg/);
    expect(svg).toContain('</svg>');
    expect(svg).toContain('0 findings');
  });

  it('single severity renders full circle', () => {
    const svg = toSeverityPieSVG([f({ severity: 'critical' })]);
    expect(svg).toContain('#b91c1c');
    expect(svg).toContain('<circle');
  });

  it('multi-severity renders one path per severity', () => {
    const svg = toSeverityPieSVG([
      f({ severity: 'critical' }),
      f({ severity: 'warning' }),
      f({ severity: 'info' }),
    ]);
    const pathCount = (svg.match(/<path /g) ?? []).length;
    expect(pathCount).toBe(3);
  });

  it('honours size option', () => {
    const svg = toSeverityPieSVG([f({ severity: 'error' })], { size: 128 });
    expect(svg).toContain('width="128"');
    expect(svg).toContain('height="128"');
  });

  it('donut mode includes inner ring carve-out', () => {
    const svg = toSeverityPieSVG([f({ severity: 'error' })], { innerRatio: 0.6 });
    expect(svg).toContain('<circle');
    expect(svg).toContain('fill="#ffffff"');
  });

  it('accessibility title lists severities', () => {
    const svg = toSeverityPieSVG([
      f({ severity: 'critical' }),
      f({ severity: 'critical' }),
      f({ severity: 'info' }),
    ]);
    expect(svg).toContain('critical: 2');
    expect(svg).toContain('info: 1');
  });

  it('accessible=false drops the summary title', () => {
    const svg = toSeverityPieSVG([f({ severity: 'error' })], { accessible: false });
    // There may still be per-slice <title> on a path; the top-level summary goes away.
    expect(svg).not.toContain('1 findings');
  });

  it('produces deterministic output for equal input', () => {
    const a = toSeverityPieSVG([f({ severity: 'critical' }), f({ severity: 'warning' })]);
    const b = toSeverityPieSVG([f({ severity: 'critical' }), f({ severity: 'warning' })]);
    expect(a).toBe(b);
  });
});
