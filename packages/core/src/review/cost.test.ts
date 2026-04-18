import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { estimateCost, formatCost, getTokenCost, _resetCostWarnings } from './cost.js';

describe('getTokenCost', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    _resetCostWarnings();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('returns model-specific cost when known without warning', () => {
    const c = getTokenCost('anthropic', 'claude-opus-4-7');
    expect(c.inputPerMTokens).toBeGreaterThan(0);
    expect(c.outputPerMTokens).toBeGreaterThan(c.inputPerMTokens);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('falls back to provider default for unknown models and warns once', () => {
    const c1 = getTokenCost('anthropic', 'claude-future-9-9');
    const c2 = getTokenCost('anthropic', 'claude-future-9-9');
    expect(c1.inputPerMTokens).toBeGreaterThan(0);
    expect(c2.inputPerMTokens).toBe(c1.inputPerMTokens);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const msg = String(warnSpy.mock.calls[0]?.[0] ?? '');
    expect(msg).toContain('unknown model');
    expect(msg).toContain('claude-future-9-9');
  });

  it('returns zero cost for local providers with no warning', () => {
    expect(getTokenCost('ollama', 'llama3.2').inputPerMTokens).toBe(0);
    expect(getTokenCost('claude-code', 'claude-sonnet-4-6').inputPerMTokens).toBe(0);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('returns non-zero fallback and warns once for unknown provider', () => {
    const c = getTokenCost('unknown', 'anything');
    expect(c.inputPerMTokens).toBeGreaterThan(0);
    expect(c.outputPerMTokens).toBeGreaterThan(0);
    getTokenCost('unknown', 'anything');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0]?.[0] ?? '')).toContain('unknown provider');
  });
});

describe('estimateCost', () => {
  beforeEach(() => {
    _resetCostWarnings();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('computes input + output cost', () => {
    const usd = estimateCost('anthropic', 'claude-sonnet-4-6', { input: 1_000_000, output: 1_000_000 });
    // 3 + 15 = 18 per 1M pair
    expect(usd).toBeCloseTo(18, 5);
  });

  it('returns zero for local providers', () => {
    expect(estimateCost('ollama', 'llama3.2', { input: 1_000_000, output: 1_000_000 })).toBe(0);
  });
});

describe('formatCost', () => {
  it('formats free', () => {
    expect(formatCost(0)).toBe('free');
    expect(formatCost(-1)).toBe('free');
  });

  it('formats tiny cost', () => {
    expect(formatCost(0.002)).toBe('<$0.01');
  });

  it('formats small cost', () => {
    expect(formatCost(0.25)).toBe('$0.25');
  });

  it('formats larger cost', () => {
    expect(formatCost(2.7)).toBe('$2.70');
    expect(formatCost(42.7)).toBe('$42.7');
  });
});
