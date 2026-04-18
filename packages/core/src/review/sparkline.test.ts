import { describe, it, expect } from 'vitest';
import { sparkline } from './sparkline.js';

describe('sparkline', () => {
  it('empty input → empty string', () => {
    expect(sparkline([])).toBe('');
  });

  it('constant input → mid ticks', () => {
    const s = sparkline([50, 50, 50]);
    expect(s).toHaveLength(3);
    expect(s[0]).toBe(s[1]);
    expect(s[1]).toBe(s[2]);
  });

  it('ascending series uses full range of ticks', () => {
    const s = sparkline([0, 25, 50, 75, 100]);
    expect(s).toHaveLength(5);
    expect(s[0]).toBe('▁');
    expect(s[s.length - 1]).toBe('█');
  });

  it('drops NaN and Infinity', () => {
    const s = sparkline([1, NaN, 2, Infinity, 3]);
    expect(s).toHaveLength(3);
  });

  it('handles single value', () => {
    expect(sparkline([42])).toHaveLength(1);
  });
});
