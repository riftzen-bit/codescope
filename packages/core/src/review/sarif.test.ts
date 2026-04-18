import { describe, it, expect } from 'vitest';
import { toSARIF, toJSON } from './sarif.js';
import type { ReviewResult } from './types.js';

const sample: ReviewResult = {
  summary: 'ok',
  score: 80,
  language: 'typescript',
  provider: 'anthropic',
  model: 'claude-sonnet-4-6',
  tokensUsed: { input: 100, output: 200 },
  findings: [
    {
      id: 'f1',
      severity: 'critical',
      category: 'security',
      title: 'SQL injection',
      description: 'Raw input concatenated into query',
      suggestion: 'Use parameterized queries',
      line: 42,
    },
    {
      id: 'f2',
      severity: 'warning',
      category: 'style',
      title: 'Unused import',
      description: 'Remove unused import',
      suggestion: '',
    },
  ],
};

describe('toSARIF', () => {
  it('produces SARIF 2.1.0 with findings mapped to rules + results', () => {
    const out = JSON.parse(toSARIF(sample, { filename: 'src/db.ts' }));
    expect(out.version).toBe('2.1.0');
    expect(out.runs).toHaveLength(1);
    const run = out.runs[0];
    expect(run.tool.driver.name).toBe('CodeScope');
    expect(run.tool.driver.rules).toHaveLength(2);
    expect(run.results).toHaveLength(2);

    const firstResult = run.results[0];
    expect(firstResult.ruleId).toBe('security/f1');
    expect(firstResult.level).toBe('error');
    expect(firstResult.locations[0].physicalLocation.region.startLine).toBe(42);
    expect(firstResult.locations[0].physicalLocation.artifactLocation.uri).toBe('src/db.ts');

    const secondResult = run.results[1];
    expect(secondResult.level).toBe('warning');
    expect(secondResult.locations[0].physicalLocation.region).toBeUndefined();
  });

  it('falls back to "input" when no filename', () => {
    const out = JSON.parse(toSARIF(sample));
    expect(out.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri).toBe('input');
  });

  it('passes tool version through', () => {
    const out = JSON.parse(toSARIF(sample, { toolVersion: '9.9.9' }));
    expect(out.runs[0].tool.driver.version).toBe('9.9.9');
  });

  it('includes summary + score in run properties', () => {
    const out = JSON.parse(toSARIF(sample));
    expect(out.runs[0].properties.summary).toBe('ok');
    expect(out.runs[0].properties.score).toBe(80);
  });

  it('emits codeScope/v1 partialFingerprints on every result', () => {
    const out = JSON.parse(toSARIF(sample));
    for (const r of out.runs[0].results) {
      expect(typeof r.partialFingerprints['codeScope/v1']).toBe('string');
      expect(r.partialFingerprints['codeScope/v1'].length).toBeGreaterThan(0);
    }
    // Stable across runs
    const out2 = JSON.parse(toSARIF(sample));
    expect(out.runs[0].results[0].partialFingerprints['codeScope/v1']).toBe(
      out2.runs[0].results[0].partialFingerprints['codeScope/v1'],
    );
    // Distinct per finding
    expect(out.runs[0].results[0].partialFingerprints['codeScope/v1']).not.toBe(
      out.runs[0].results[1].partialFingerprints['codeScope/v1'],
    );
  });

  it('handles a review with no findings', () => {
    const empty: ReviewResult = { ...sample, findings: [] };
    const out = JSON.parse(toSARIF(empty));
    expect(out.runs[0].results).toEqual([]);
    expect(out.runs[0].tool.driver.rules).toEqual([]);
  });
});

describe('toJSON', () => {
  it('round-trips', () => {
    const out = JSON.parse(toJSON(sample));
    expect(out.summary).toBe(sample.summary);
    expect(out.findings).toHaveLength(2);
  });
});
