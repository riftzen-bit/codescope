import { describe, it, expect } from 'vitest';
import { SYSTEM_PROMPT, buildUserMessage } from './prompts.js';

describe('SYSTEM_PROMPT', () => {
  it('documents the JSON schema', () => {
    expect(SYSTEM_PROMPT).toContain('"summary"');
    expect(SYSTEM_PROMPT).toContain('"score"');
    expect(SYSTEM_PROMPT).toContain('"findings"');
  });

  it('lists all severities', () => {
    for (const s of ['critical', 'error', 'warning', 'info']) {
      expect(SYSTEM_PROMPT).toContain(`"${s}"`);
    }
  });

  it('lists all categories', () => {
    for (const c of ['security', 'performance', 'correctness', 'maintainability', 'style', 'other']) {
      expect(SYSTEM_PROMPT).toContain(`"${c}"`);
    }
  });
});

describe('buildUserMessage', () => {
  it('emits language + fenced code', () => {
    const out = buildUserMessage('const x = 1;', 'typescript');
    expect(out).toContain('Language: typescript');
    expect(out).toContain('```typescript');
    expect(out).toContain('const x = 1;');
    expect(out).toContain('```');
  });

  it('adds filename when provided', () => {
    const out = buildUserMessage('x', 'ts', 'foo.ts');
    expect(out).toContain('File: foo.ts');
  });

  it('omits rules block when empty', () => {
    const out = buildUserMessage('x', 'ts');
    expect(out).not.toContain('Focus on these rules');
  });

  it('adds rules block as bullets', () => {
    const out = buildUserMessage('x', 'ts', undefined, ['rule A', 'rule B']);
    expect(out).toContain('Focus on these rules');
    expect(out).toContain('- rule A');
    expect(out).toContain('- rule B');
  });
});
