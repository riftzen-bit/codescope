import { describe, it, expect } from 'vitest';
import { estimateFixTime, estimateTotalFixTime, formatDuration } from './fixtime.js';
import type { Finding } from './types.js';

const f = (over: Partial<Finding>): Finding => ({
  id: 'x', severity: 'info', category: 'other',
  title: 't', description: 'd', suggestion: 's',
  ...over,
});

describe('estimateFixTime', () => {
  it('scales by severity base', () => {
    const crit = estimateFixTime(f({ severity: 'critical', category: 'other' }));
    const info = estimateFixTime(f({ severity: 'info', category: 'other' }));
    expect(crit).toBeGreaterThan(info);
  });

  it('amplifies for security category, discounts for style', () => {
    const sec = estimateFixTime(f({ severity: 'warning', category: 'security' }));
    const style = estimateFixTime(f({ severity: 'warning', category: 'style' }));
    expect(sec).toBeGreaterThan(style);
  });

  it('returns integer minutes', () => {
    expect(Number.isInteger(estimateFixTime(f({ severity: 'warning', category: 'style' })))).toBe(true);
  });
});

describe('estimateTotalFixTime', () => {
  it('sums total and groups by category/severity', () => {
    const summary = estimateTotalFixTime([
      f({ severity: 'critical', category: 'security' }),
      f({ severity: 'info', category: 'style' }),
    ]);
    expect(summary.totalMinutes).toBe(
      estimateFixTime(f({ severity: 'critical', category: 'security' })) +
      estimateFixTime(f({ severity: 'info', category: 'style' })),
    );
    expect(summary.bySeverity.critical).toBeGreaterThan(0);
    expect(summary.byCategory.security).toBeGreaterThan(0);
  });

  it('empty input → zero', () => {
    expect(estimateTotalFixTime([]).totalMinutes).toBe(0);
  });
});

describe('formatDuration', () => {
  it('minutes under an hour', () => {
    expect(formatDuration(45)).toBe('45m');
    expect(formatDuration(1)).toBe('1m');
  });

  it('hours under a day', () => {
    expect(formatDuration(60)).toBe('1h');
    expect(formatDuration(90)).toBe('1h 30m');
    expect(formatDuration(7 * 60)).toBe('7h');
  });

  it('days', () => {
    expect(formatDuration(8 * 60)).toBe('1d');
    expect(formatDuration(10 * 60)).toBe('1d 2h');
  });

  it('bad input → 0m', () => {
    expect(formatDuration(0)).toBe('0m');
    expect(formatDuration(-5)).toBe('0m');
    expect(formatDuration(NaN)).toBe('0m');
  });
});
