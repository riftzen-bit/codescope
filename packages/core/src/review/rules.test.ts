import { describe, it, expect } from 'vitest';
import { RULE_PRESETS, getPresetRules } from './rules.js';

describe('RULE_PRESETS', () => {
  it('has all expected ids', () => {
    expect(Object.keys(RULE_PRESETS).sort()).toEqual(
      ['all', 'correctness', 'none', 'performance', 'security', 'style'].sort(),
    );
  });

  it('ALL preset has empty rules (no filtering)', () => {
    expect(RULE_PRESETS.all.rules).toEqual([]);
  });

  it('security preset mentions the category', () => {
    expect(RULE_PRESETS.security.rules.join(' ').toLowerCase()).toContain('security');
  });

  it('getPresetRules returns the preset rules', () => {
    expect(getPresetRules('security')).toEqual(RULE_PRESETS.security.rules);
  });
});
