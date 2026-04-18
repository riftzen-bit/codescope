/**
 * Pre-built focus rules sent to the model as part of the review prompt.
 * The user picks one preset; its rules are merged with any custom
 * style-profile guidance before being joined into the user message.
 */

export type RulePresetId = 'all' | 'security' | 'performance' | 'correctness' | 'style' | 'none';

export interface RulePreset {
  id: RulePresetId;
  label: string;
  description: string;
  rules: string[];
}

export const RULE_PRESETS: Record<RulePresetId, RulePreset> = {
  all: {
    id: 'all',
    label: 'All issues',
    description: 'Report every category of finding.',
    rules: [],
  },
  security: {
    id: 'security',
    label: 'Security only',
    description: 'Focus on vulnerabilities and unsafe patterns.',
    rules: [
      'Only report findings in the security category (SQLi, XSS, SSRF, command injection, path traversal, auth/authorization flaws, unsafe deserialization, hard-coded secrets, insecure crypto).',
      'Skip style, maintainability, and performance findings unless they cause a concrete security risk.',
    ],
  },
  performance: {
    id: 'performance',
    label: 'Performance only',
    description: 'Focus on hot paths, complexity, and wasted work.',
    rules: [
      'Only report findings in the performance category (quadratic loops, redundant work, N+1 queries, synchronous I/O on hot paths, large allocations, missing memoization).',
      'Skip style, security, and correctness findings unless they produce a concrete performance regression.',
    ],
  },
  correctness: {
    id: 'correctness',
    label: 'Correctness only',
    description: 'Focus on bugs, logic errors, and edge cases.',
    rules: [
      'Only report findings in the correctness category (off-by-one, null/undefined handling, race conditions, missed edge cases, incorrect control flow, type confusion, incorrect error propagation).',
      'Skip style and cosmetic findings.',
    ],
  },
  style: {
    id: 'style',
    label: 'Style & maintainability',
    description: 'Focus on readability, naming, and structure.',
    rules: [
      'Only report findings in the style or maintainability categories (naming, dead code, complexity, duplication, missing types, documentation).',
      'Skip security, performance, and correctness unless the smell is egregious.',
    ],
  },
  none: {
    id: 'none',
    label: 'No preset',
    description: 'Use only user-supplied style guidance.',
    rules: [],
  },
};

export function getPresetRules(id: RulePresetId): string[] {
  return RULE_PRESETS[id]?.rules ?? [];
}
