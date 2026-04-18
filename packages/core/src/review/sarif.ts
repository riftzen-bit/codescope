import type { ReviewResult, Finding, Severity } from './types.js';
import {
  findingCodeScopeFingerprint,
  FINGERPRINT_SCHEME_VERSION,
} from './fingerprint.js';

/**
 * Convert a ReviewResult into a SARIF 2.1.0 log string.
 *
 * SARIF (Static Analysis Results Interchange Format) is the OASIS standard
 * consumed by GitHub code scanning, Azure DevOps, and many IDEs.
 * Spec: https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html
 */

const SEVERITY_TO_LEVEL: Record<Severity, 'error' | 'warning' | 'note' | 'none'> = {
  critical: 'error',
  error: 'error',
  warning: 'warning',
  info: 'note',
};

const SEVERITY_TO_RANK: Record<Severity, number> = {
  critical: 95,
  error: 80,
  warning: 50,
  info: 20,
};

interface SarifRule {
  id: string;
  name: string;
  shortDescription: { text: string };
  defaultConfiguration: { level: 'error' | 'warning' | 'note' | 'none'; rank: number };
  properties: { category: string; severity: Severity };
}

interface SarifLocation {
  physicalLocation: {
    artifactLocation: { uri: string };
    region?: { startLine: number };
  };
}

interface SarifResult {
  ruleId: string;
  level: 'error' | 'warning' | 'note' | 'none';
  message: { text: string };
  locations: SarifLocation[];
  partialFingerprints: Record<string, string>;
  properties: { severity: Severity; category: string; suggestion: string };
}

function ruleIdFor(f: Finding): string {
  return `${f.category}/${f.id}`;
}

function buildRules(findings: Finding[]): SarifRule[] {
  const seen = new Map<string, SarifRule>();
  for (const f of findings) {
    const id = ruleIdFor(f);
    if (seen.has(id)) continue;
    seen.set(id, {
      id,
      name: f.title,
      shortDescription: { text: f.title },
      defaultConfiguration: {
        level: SEVERITY_TO_LEVEL[f.severity],
        rank: SEVERITY_TO_RANK[f.severity],
      },
      properties: { category: f.category, severity: f.severity },
    });
  }
  return Array.from(seen.values());
}

function buildResults(findings: Finding[], uri: string): SarifResult[] {
  return findings.map((f) => {
    const loc: SarifLocation = {
      physicalLocation: {
        artifactLocation: { uri },
        ...(f.line !== undefined ? { region: { startLine: f.line } } : {}),
      },
    };
    return {
      ruleId: ruleIdFor(f),
      level: SEVERITY_TO_LEVEL[f.severity],
      message: { text: f.description || f.title },
      locations: [loc],
      partialFingerprints: {
        [FINGERPRINT_SCHEME_VERSION]: findingCodeScopeFingerprint(f),
      },
      properties: {
        severity: f.severity,
        category: f.category,
        suggestion: f.suggestion,
      },
    };
  });
}

export interface SarifOptions {
  filename?: string;
  toolVersion?: string;
}

export function toSARIF(result: ReviewResult, options: SarifOptions = {}): string {
  const uri = options.filename && options.filename.trim().length > 0
    ? options.filename
    : 'input';
  const toolVersion = options.toolVersion ?? '1.0.0';

  const sarif = {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'CodeScope',
            version: toolVersion,
            informationUri: 'https://github.com/riftzen-bit/codescope',
            rules: buildRules(result.findings),
            properties: {
              provider: result.provider,
              model: result.model,
              score: result.score,
            },
          },
        },
        results: buildResults(result.findings, uri),
        properties: {
          summary: result.summary,
          score: result.score,
          language: result.language,
          ...(result.tokensUsed ? { tokensUsed: result.tokensUsed } : {}),
        },
      },
    ],
  };

  return JSON.stringify(sarif, null, 2);
}

export function toJSON(result: ReviewResult): string {
  return JSON.stringify(result, null, 2);
}
