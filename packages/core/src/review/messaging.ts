import type { Finding, ReviewResult, Severity } from './types.js';

const SEV_EMOJI: Record<Severity, string> = {
  critical: ':rotating_light:',
  error:    ':red_circle:',
  warning:  ':warning:',
  info:     ':information_source:',
};

/**
 * Slack mrkdwn summary (Block Kit text). Compact: header, score, top N
 * findings. Intended for posting a digest to a channel, not full results.
 */
export function toSlack(result: ReviewResult, options: { filename?: string; limit?: number } = {}): string {
  const { filename, limit = 5 } = options;
  const lines: string[] = [];
  lines.push(`*Code Review*${filename ? ` — \`${filename}\`` : ''}`);
  lines.push(`*Score:* ${result.score}/100  |  *Provider:* ${result.provider}/${result.model}`);
  if (result.summary) {
    lines.push('');
    lines.push(`> ${result.summary.replace(/\n+/g, ' ')}`);
  }
  if (result.findings.length === 0) {
    lines.push('');
    lines.push('_No issues detected._');
    return lines.join('\n');
  }

  const rank: Record<Severity, number> = { critical: 0, error: 1, warning: 2, info: 3 };
  const top = [...result.findings]
    .sort((a, b) => rank[a.severity] - rank[b.severity])
    .slice(0, limit);

  lines.push('');
  lines.push(`*${result.findings.length} finding${result.findings.length === 1 ? '' : 's'}* (showing top ${top.length}):`);
  for (const f of top) {
    const at = f.line !== undefined ? ` _(line ${f.line})_` : '';
    lines.push(`• ${SEV_EMOJI[f.severity]} *${slackEscape(f.title)}*${at} — ${slackEscape(truncate(f.description, 140))}`);
  }
  if (result.findings.length > top.length) {
    lines.push(`_…and ${result.findings.length - top.length} more._`);
  }
  return lines.join('\n');
}

function slackEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n - 1).trimEnd()}…`;
}

/**
 * Plain-text email body: multi-line, section-separated, no markdown. Safe for
 * mail clients that strip markup.
 */
export function toEmail(result: ReviewResult, filename?: string): string {
  const lines: string[] = [];
  lines.push('CODE REVIEW');
  lines.push('==========='.padEnd(11, '='));
  if (filename) lines.push(`File:     ${filename}`);
  lines.push(`Score:    ${result.score}/100`);
  lines.push(`Provider: ${result.provider} (${result.model})`);
  lines.push(`Language: ${result.language}`);
  if (result.tokensUsed) {
    lines.push(`Tokens:   ${result.tokensUsed.input} in / ${result.tokensUsed.output} out`);
  }
  lines.push('');
  lines.push('SUMMARY');
  lines.push('-------');
  lines.push(result.summary || '(no summary)');
  lines.push('');

  if (result.findings.length === 0) {
    lines.push('No issues detected.');
    return lines.join('\n');
  }

  lines.push(`FINDINGS (${result.findings.length})`);
  lines.push('--------');
  result.findings.forEach((f, i) => {
    lines.push('');
    lines.push(`[${i + 1}] ${f.severity.toUpperCase()} · ${f.category}${f.line !== undefined ? ` · line ${f.line}` : ''}`);
    lines.push(`    ${f.title}`);
    if (f.description) lines.push(indentBlock(f.description, 4));
    if (f.suggestion) {
      lines.push('    Suggestion:');
      lines.push(indentBlock(f.suggestion, 6));
    }
  });
  return lines.join('\n');
}

function indentBlock(text: string, n: number): string {
  const pad = ' '.repeat(n);
  return text.split('\n').map((l) => `${pad}${l}`).join('\n');
}

/**
 * One-line digest for status bars / tray popups.
 */
export function toStatusLine(result: ReviewResult): string {
  const counts = result.findings.reduce<Record<Severity, number>>(
    (acc, f) => ({ ...acc, [f.severity]: (acc[f.severity] ?? 0) + 1 }),
    { critical: 0, error: 0, warning: 0, info: 0 },
  );
  const parts: string[] = [`${result.score}/100`];
  if (counts.critical) parts.push(`${counts.critical}C`);
  if (counts.error)    parts.push(`${counts.error}E`);
  if (counts.warning)  parts.push(`${counts.warning}W`);
  if (counts.info)     parts.push(`${counts.info}i`);
  if (result.findings.length === 0) parts.push('clean');
  return parts.join(' · ');
}

/** Given findings, return a markdown table. Useful for PR body summaries. */
export function toMarkdownTable(findings: readonly Finding[]): string {
  if (findings.length === 0) return '_No findings._';
  const header = '| Severity | Category | Line | Title |';
  const sep    = '| --- | --- | --- | --- |';
  const rows = findings.map((f) =>
    `| ${f.severity} | ${f.category} | ${f.line ?? ''} | ${mdEscape(f.title)} |`,
  );
  return [header, sep, ...rows].join('\n');
}

function mdEscape(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}
