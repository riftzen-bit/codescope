export interface RedactionHit {
  kind: string;
  line: number;
  start: number;
  length: number;
}

export interface RedactionResult {
  code: string;
  hits: RedactionHit[];
}

interface Rule {
  kind: string;
  regex: RegExp;
}

// Rule order matters: earlier rules win when two patterns match the exact
// same starting offset. Anthropic precedes OpenAI because `sk-ant-...` is
// also a legal match for the broader OpenAI pattern. The Azure connection
// string precedes the bare AccountKey rule so we redact the whole string
// (endpoint + account name + key) rather than just the key portion.
const RULES: readonly Rule[] = [
  { kind: 'anthropic-key',         regex: /\bsk-ant-[A-Za-z0-9_-]{20,200}\b/g },
  { kind: 'openai-api-key',        regex: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,200}\b/g },
  { kind: 'aws-access-key',        regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { kind: 'github-token',          regex: /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/g },
  { kind: 'google-api-key',        regex: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { kind: 'slack-token',           regex: /\bxox[baprs]-[A-Za-z0-9-]{10,200}\b/g },
  { kind: 'stripe-live-key',       regex: /\b(?:sk|rk|pk)_live_[A-Za-z0-9]{20,100}\b/g },
  { kind: 'npm-token',             regex: /\bnpm_[A-Za-z0-9]{36}\b/g },
  { kind: 'azure-storage-connstr', regex: /DefaultEndpointsProtocol=https?;[^\n\r"']*AccountKey=[A-Za-z0-9+/]{64,}={0,2}[^\n\r"']*/g },
  { kind: 'azure-storage-key',     regex: /AccountKey=[A-Za-z0-9+/]{64,}={0,2}/g },
  { kind: 'gcp-service-account',   regex: /"type"\s*:\s*"service_account"[\s\S]*?"private_key_id"\s*:\s*"[A-Za-z0-9]+"/g },
  { kind: 'db-connection-uri',     regex: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|rediss?|amqps?):\/\/[^\s:/@"']+:[^\s@"']+@[^\s"'<>]+/gi },
  { kind: 'bearer-token',          regex: /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/g },
  { kind: 'jwt',                   regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { kind: 'private-key-block',     regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g },
];

function lineOf(code: string, offset: number): number {
  let line = 1;
  const end = Math.min(offset, code.length);
  for (let i = 0; i < end; i++) {
    if (code.charCodeAt(i) === 10) line++;
  }
  return line;
}

/**
 * Replace obvious credentials in `code` with `[REDACTED:<kind>]` placeholders.
 *
 * Intended as a best-effort guardrail before shipping code to a third-party
 * AI: it won't catch every secret (regex is not a substitute for a real
 * secret scanner), but it catches the common high-signal cases (cloud keys,
 * JWTs, PEM private keys). Overlapping matches are resolved by taking the
 * first rule listed at that position.
 */
export function redactSecrets(code: string): RedactionResult {
  const raw: RedactionHit[] = [];

  for (const rule of RULES) {
    const rx = new RegExp(rule.regex.source, rule.regex.flags.includes('g') ? rule.regex.flags : rule.regex.flags + 'g');
    let m: RegExpExecArray | null;
    while ((m = rx.exec(code)) !== null) {
      raw.push({
        kind: rule.kind,
        line: lineOf(code, m.index),
        start: m.index,
        length: m[0].length,
      });
      if (m[0].length === 0) rx.lastIndex++;
    }
  }

  raw.sort((a, b) => a.start - b.start);

  const kept: RedactionHit[] = [];
  let lastEnd = -1;
  for (const h of raw) {
    if (h.start < lastEnd) continue;
    kept.push(h);
    lastEnd = h.start + h.length;
  }

  let out = '';
  let cursor = 0;
  for (const h of kept) {
    out += code.slice(cursor, h.start);
    out += `[REDACTED:${h.kind}]`;
    cursor = h.start + h.length;
  }
  out += code.slice(cursor);

  return { code: out, hits: kept };
}

/** Short human summary of which kinds were found. */
export function summarizeRedactions(hits: readonly RedactionHit[]): string {
  if (hits.length === 0) return 'No secrets detected';
  const byKind = new Map<string, number>();
  for (const h of hits) byKind.set(h.kind, (byKind.get(h.kind) ?? 0) + 1);
  const parts: string[] = [];
  for (const [kind, n] of byKind) parts.push(`${kind}: ${n}`);
  return parts.join(', ');
}
