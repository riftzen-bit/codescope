import type { Finding, ReviewResult, Severity } from './types.js';
import type { FindingsDiff } from './diff.js';

/** CSV-escape a single cell per RFC 4180: wrap in quotes if it contains
 *  comma, quote, CR, or LF; double any embedded quotes. */
function csvCell(v: unknown): string {
  const s = v === undefined || v === null ? '' : String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCSV(result: ReviewResult, filename?: string): string {
  const header = ['id', 'severity', 'category', 'line', 'title', 'description', 'suggestion', 'file'];
  const rows: string[] = [header.join(',')];
  for (const f of result.findings) {
    rows.push([
      csvCell(f.id),
      csvCell(f.severity),
      csvCell(f.category),
      csvCell(f.line ?? ''),
      csvCell(f.title),
      csvCell(f.description),
      csvCell(f.suggestion),
      csvCell(filename ?? ''),
    ].join(','));
  }
  return rows.join('\r\n');
}

/**
 * Single HTML-escape helper. Every interpolation in toHTML / toDiffHTML MUST
 * go through this, even values we believe are numbers — at runtime an input
 * from the model or a malformed ReviewResult can still contain strings.
 */
function esc(v: unknown): string {
  const s = v === undefined || v === null ? '' : String(v);
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;'
    : c === '<' ? '&lt;'
    : c === '>' ? '&gt;'
    : c === '"' ? '&quot;'
    : '&#39;',
  );
}

const SEVERITY_COLORS: Record<Severity, string> = {
  critical: '#b91c1c',
  error:    '#dc2626',
  warning:  '#d97706',
  info:     '#2563eb',
};

const DEFAULT_SEVERITY_COLOR = '#6b7280';

function severityColor(sev: Severity | string): string {
  return (SEVERITY_COLORS as Record<string, string>)[sev] ?? DEFAULT_SEVERITY_COLOR;
}

/** Self-contained HTML report. No external CSS/JS, safe to email or share. */
export function toHTML(result: ReviewResult, filename?: string): string {
  const title = filename ? `Code Review — ${filename}` : 'Code Review';
  const findingBlocks = result.findings.map((f) => {
    const color = severityColor(f.severity);
    const line = f.line !== undefined ? ` · line ${esc(f.line)}` : '';
    const sevText = typeof f.severity === 'string' ? f.severity.toUpperCase() : String(f.severity);
    return `
    <article class="finding" style="border-left:4px solid ${color};">
      <header>
        <span class="sev" style="background:${color};">${esc(sevText)}</span>
        <span class="cat">${esc(f.category)}${line}</span>
        <h3>${esc(f.title)}</h3>
      </header>
      <p>${esc(f.description)}</p>
      ${f.suggestion ? `<p class="sugg"><strong>Suggestion:</strong> ${esc(f.suggestion)}</p>` : ''}
    </article>`;
  }).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
         max-width: 860px; margin: 2rem auto; padding: 0 1rem; line-height: 1.5; }
  h1 { margin-bottom: 0.25rem; }
  .meta { color: #666; font-size: 0.9rem; margin-bottom: 1.5rem; }
  .score { font-size: 2rem; font-weight: 600; }
  .summary { background: #f5f5f5; padding: 1rem; border-radius: 6px; margin: 1rem 0 2rem; }
  .finding { background: #fafafa; padding: 0.75rem 1rem; margin: 0.75rem 0; border-radius: 4px; }
  .finding header { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
  .finding h3 { margin: 0.25rem 0 0.5rem; width: 100%; font-size: 1.05rem; }
  .sev { color: white; padding: 2px 8px; border-radius: 3px; font-size: 0.7rem; font-weight: 700; letter-spacing: 0.04em; }
  .cat { color: #555; font-size: 0.85rem; }
  .sugg { background: #eef2ff; padding: 0.5rem 0.75rem; border-radius: 4px; margin-top: 0.5rem; }
  @media (prefers-color-scheme: dark) {
    body { background: #111; color: #eee; }
    .summary, .finding { background: #1a1a1a; }
    .sugg { background: #1e293b; }
    .meta, .cat { color: #aaa; }
  }
</style>
</head>
<body>
<h1>${esc(title)}</h1>
<div class="meta">
  ${esc(result.provider)} · ${esc(result.model)} · ${esc(result.language)}
  ${result.tokensUsed ? ` · ${esc(result.tokensUsed.input)}↑ ${esc(result.tokensUsed.output)}↓ tokens` : ''}
</div>
<div class="summary">
  <div class="score">${esc(result.score)}/100</div>
  <p>${esc(result.summary)}</p>
</div>
<h2>Findings (${esc(result.findings.length)})</h2>
${result.findings.length === 0 ? '<p><em>No issues detected.</em></p>' : findingBlocks}
</body>
</html>`;
}

const SEVERITY_TO_JUNIT: Record<Severity, 'failure' | 'error'> = {
  critical: 'failure',
  error:    'failure',
  warning:  'failure',
  info:     'failure',
};

function xmlEscape(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;'
    : c === '<' ? '&lt;'
    : c === '>' ? '&gt;'
    : c === '"' ? '&quot;'
    : '&apos;',
  );
}

/**
 * JUnit XML: one testsuite per category, one testcase per finding. Non-critical
 * findings are reported as `<failure>`; info-level as `<skipped>` so CI can
 * surface gradations without failing on advisories. CI tools that consume
 * JUnit (GitLab, Jenkins, CircleCI, GitHub Actions via junit-action) will
 * render these inline on the commit.
 */
export function toJUnitXML(result: ReviewResult, filename?: string): string {
  const classBase = filename ? filename.replace(/[\\/]/g, '.').replace(/\.[^.]+$/, '') : 'review';
  const byCat = new Map<string, Finding[]>();
  for (const f of result.findings) {
    const list = byCat.get(f.category) ?? [];
    list.push(f);
    byCat.set(f.category, list);
  }

  const suiteParts: string[] = [];
  let totalFailures = 0;
  let totalSkipped = 0;

  for (const [category, findings] of byCat) {
    const failures = findings.filter((f) => f.severity !== 'info').length;
    const skipped = findings.filter((f) => f.severity === 'info').length;
    totalFailures += failures;
    totalSkipped += skipped;

    const cases = findings.map((f) => {
      const classname = xmlEscape(`${classBase}.${category}`);
      const name = xmlEscape(`${f.id}: ${f.title}${f.line !== undefined ? ` (line ${f.line})` : ''}`);
      if (f.severity === 'info') {
        return `    <testcase classname="${classname}" name="${name}">
      <skipped message="${xmlEscape(f.title)}"/>
    </testcase>`;
      }
      const tag = SEVERITY_TO_JUNIT[f.severity];
      const msg = xmlEscape(f.title);
      const body = xmlEscape(`${f.description}${f.suggestion ? `\n\nSuggestion: ${f.suggestion}` : ''}`);
      return `    <testcase classname="${classname}" name="${name}">
      <${tag} type="${xmlEscape(f.severity)}" message="${msg}">${body}</${tag}>
    </testcase>`;
    }).join('\n');

    suiteParts.push(
      `  <testsuite name="${xmlEscape(category)}" tests="${findings.length}" failures="${failures}" skipped="${skipped}">
${cases}
  </testsuite>`,
    );
  }

  const totalTests = result.findings.length;
  return `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="CodeScope" tests="${totalTests}" failures="${totalFailures}" skipped="${totalSkipped}">
${suiteParts.join('\n')}
</testsuites>
`;
}

const SEVERITY_TO_GH: Record<Severity, 'error' | 'warning' | 'notice'> = {
  critical: 'error',
  error:    'error',
  warning:  'warning',
  info:     'notice',
};

/**
 * GitHub Actions workflow-command annotations. When emitted to stdout from a
 * workflow step (e.g. `node -e 'process.stdout.write(...)'`), GitHub attaches
 * them to the PR/diff inline.
 *
 * Format docs: https://docs.github.com/en/actions/using-workflows/workflow-commands-for-github-actions
 */
export function toGithubAnnotations(result: ReviewResult, filename?: string): string {
  const file = filename ? filename.replace(/\\/g, '/') : undefined;
  const lines: string[] = [];
  for (const f of result.findings) {
    const kind = SEVERITY_TO_GH[f.severity];
    const params: string[] = [];
    if (file) params.push(`file=${file.replace(/,/g, '%2C')}`);
    if (f.line !== undefined) params.push(`line=${f.line}`);
    params.push(`title=${ghEscapeParam(`[${f.severity}] ${f.title}`)}`);
    const msg = ghEscapeMessage(f.suggestion ? `${f.description}\n\nSuggestion: ${f.suggestion}` : f.description);
    lines.push(`::${kind} ${params.join(',')}::${msg}`);
  }
  return lines.join('\n');
}

function ghEscapeParam(s: string): string {
  return s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A').replace(/:/g, '%3A').replace(/,/g, '%2C');
}

function ghEscapeMessage(s: string): string {
  return s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

function diffFindingBlock(f: Finding, kind: 'added' | 'removed' | 'unchanged'): string {
  const color = severityColor(f.severity);
  const line = f.line !== undefined ? ` · line ${esc(f.line)}` : '';
  const marker = kind === 'added' ? '+' : kind === 'removed' ? '−' : '=';
  const sevText = typeof f.severity === 'string' ? f.severity.toUpperCase() : String(f.severity);
  return `
    <article class="diff-finding diff-${kind}" style="border-left:4px solid ${color};">
      <header>
        <span class="marker">${marker}</span>
        <span class="sev" style="background:${color};">${esc(sevText)}</span>
        <span class="cat">${esc(f.category)}${line}</span>
        <h3>${esc(f.title)}</h3>
      </header>
      <p>${esc(f.description)}</p>
    </article>`;
}

/**
 * Self-contained HTML page rendering added / fixed / unchanged findings
 * between two reviews. Good for PR comments, stakeholder emails, or archiving
 * a before/after comparison. No external assets.
 */
export function toDiffHTML(
  diff: FindingsDiff,
  opts: { filename?: string; beforeLabel?: string; afterLabel?: string } = {},
): string {
  const title = opts.filename ? `Review Diff — ${opts.filename}` : 'Review Diff';
  const beforeLabel = opts.beforeLabel ?? 'before';
  const afterLabel = opts.afterLabel ?? 'after';
  const scoreArrow = diff.scoreDelta > 0 ? '↑' : diff.scoreDelta < 0 ? '↓' : '→';
  const scoreClass = diff.scoreDelta > 0 ? 'pos' : diff.scoreDelta < 0 ? 'neg' : 'neu';

  const added = diff.added.map((f) => diffFindingBlock(f, 'added')).join('\n');
  const removed = diff.removed.map((f) => diffFindingBlock(f, 'removed')).join('\n');
  const unchanged = diff.unchanged.map((f) => diffFindingBlock(f, 'unchanged')).join('\n');

  const section = (label: string, count: number, body: string, empty: string) => `
<section>
  <h2>${esc(label)} (${esc(count)})</h2>
  ${count === 0 ? `<p class="empty"><em>${esc(empty)}</em></p>` : body}
</section>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
         max-width: 960px; margin: 2rem auto; padding: 0 1rem; line-height: 1.5; }
  h1 { margin-bottom: 0.25rem; }
  .meta { color: #666; font-size: 0.9rem; margin-bottom: 1.5rem; }
  .score-line { font-size: 1.1rem; margin-bottom: 1.5rem; }
  .score-line .pos { color: #16a34a; font-weight: 600; }
  .score-line .neg { color: #dc2626; font-weight: 600; }
  .score-line .neu { color: #666; font-weight: 600; }
  section { margin-bottom: 2rem; }
  .diff-finding { background: #fafafa; padding: 0.6rem 0.9rem; margin: 0.5rem 0; border-radius: 4px; }
  .diff-added   { background: #ecfdf5; }
  .diff-removed { background: #fef2f2; }
  .diff-finding header { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
  .diff-finding h3 { margin: 0.25rem 0 0.5rem; width: 100%; font-size: 1.0rem; }
  .marker { font-family: ui-monospace, monospace; font-weight: 700; width: 1rem; }
  .sev { color: white; padding: 2px 8px; border-radius: 3px; font-size: 0.7rem; font-weight: 700; letter-spacing: 0.04em; }
  .cat { color: #555; font-size: 0.85rem; }
  .empty { color: #888; }
  @media (prefers-color-scheme: dark) {
    body { background: #111; color: #eee; }
    .diff-finding { background: #1a1a1a; }
    .diff-added   { background: #052e1d; }
    .diff-removed { background: #2b0d0d; }
    .meta, .cat, .empty { color: #aaa; }
  }
</style>
</head>
<body>
<h1>${esc(title)}</h1>
<div class="meta">${esc(beforeLabel)} → ${esc(afterLabel)}</div>
<div class="score-line">Score change: <span class="${scoreClass}">${scoreArrow} ${esc(Math.abs(diff.scoreDelta))}</span></div>
${section('Added', diff.added.length, added, 'No new findings.')}
${section('Fixed', diff.removed.length, removed, 'No findings were fixed.')}
${section('Unchanged', diff.unchanged.length, unchanged, 'No unchanged findings.')}
</body>
</html>`;
}
