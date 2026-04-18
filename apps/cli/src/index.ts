import { readFileSync } from 'node:fs';
import { readFile as readFileFs } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  computeCodeMetrics,
  redactSecrets,
  summarizeRedactions,
  toSeverityPieSVG,
  summarizeFindings,
  sortFindingsBySeverity,
  type Finding,
} from '@code-review/core';

export interface CliIO {
  readFile: (path: string) => Promise<string>;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

const DEFAULT_IO: CliIO = {
  readFile: (p) => readFileFs(p, 'utf8'),
  stdout: (t) => process.stdout.write(t),
  stderr: (t) => process.stderr.write(t),
};

// Stamp the version from package.json so `codescope --version` can never drift
// from what the release actually shipped. Works both after tsup bundling
// (dist/index.js → ../package.json) and from source under vitest
// (src/index.ts → ../package.json).
//
// When resolution fails (missing/malformed package.json in a broken bundle),
// we fall back to `0.0.0-unknown` and emit the reason on stderr ONCE at
// module load. Without the warning, releases that drop package.json ship
// silently, and the only external signal is a surprising version string.
const VERSION: string = (() => {
  let fallbackReason: string | null = null;
  try {
    const pkgUrl = new URL('../package.json', import.meta.url);
    const raw = readFileSync(fileURLToPath(pkgUrl), 'utf8');
    const pkg = JSON.parse(raw) as { version?: unknown };
    if (typeof pkg.version === 'string' && pkg.version.length > 0) return pkg.version;
    fallbackReason = 'package.json parsed but `version` field missing or empty';
  } catch (err) {
    fallbackReason = err instanceof Error ? err.message : String(err);
  }
  try {
    process.stderr.write(`codescope: could not resolve version from package.json (${fallbackReason}); using 0.0.0-unknown\n`);
  } catch {
    // stderr unavailable — nothing we can do
  }
  return '0.0.0-unknown';
})();

const HELP = `codescope — static helpers from @code-review/core

Usage:
  codescope metrics <file>              Print code metrics as JSON
  codescope redact  <file> [--stats]    Print redacted code, or only hit summary
  codescope pie     <findings.json>     Print an SVG severity-breakdown pie
  codescope summary <findings.json>     Print a FindingsSummary as JSON
  codescope help | --help | -h          Show this message
  codescope version | --version | -v    Show version

<findings.json> may be either:
  - a JSON array of Finding objects, or
  - a JSON object with a \`findings\` array (e.g. a ReviewResult).
`;

// Kept in sync with packages/core/src/review/types.ts. A mismatch is caught
// by cli.test.ts which imports the same core types.
const VALID_SEVERITIES: ReadonlySet<string> = new Set(['critical', 'error', 'warning', 'info']);
const VALID_CATEGORIES: ReadonlySet<string> = new Set([
  'security', 'performance', 'correctness', 'maintainability', 'style', 'other',
]);

/**
 * Narrow an unknown JSON value to a Finding. Returns the offending field
 * name (or a structural problem) when the value is rejected, so the caller
 * can point at the exact reason in the error message. Returns null when
 * the value passes every check.
 *
 * Enum fields are checked against the core package's closed sets — a
 * plain `typeof === 'string'` accepted nonsense values like
 * `severity: "BLOCKER"` and let them leak into toSeverityPieSVG /
 * summarizeFindings, where they produced empty-slice SVGs and wrong
 * bucket counts instead of a user-visible error.
 */
function findingValidationError(x: unknown): string | null {
  if (typeof x !== 'object' || x === null) return 'not a JSON object';
  const o = x as Record<string, unknown>;
  if (typeof o.id !== 'string') return 'id must be a string';
  if (typeof o.severity !== 'string') return 'severity must be a string';
  if (!VALID_SEVERITIES.has(o.severity)) {
    return `severity must be one of ${[...VALID_SEVERITIES].join('|')} (got ${JSON.stringify(o.severity)})`;
  }
  if (typeof o.category !== 'string') return 'category must be a string';
  if (!VALID_CATEGORIES.has(o.category)) {
    return `category must be one of ${[...VALID_CATEGORIES].join('|')} (got ${JSON.stringify(o.category)})`;
  }
  if (typeof o.title !== 'string') return 'title must be a string';
  if (typeof o.description !== 'string') return 'description must be a string';
  if (typeof o.suggestion !== 'string') return 'suggestion must be a string';
  if (o.line !== undefined && (typeof o.line !== 'number' || !Number.isFinite(o.line))) {
    return 'line must be a finite number when present';
  }
  return null;
}

function parseFindings(json: string): Finding[] {
  const parsed: unknown = JSON.parse(json);
  const arr = Array.isArray(parsed)
    ? parsed
    : (typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as { findings?: unknown }).findings))
      ? (parsed as { findings: unknown[] }).findings
      : null;
  if (arr === null) {
    throw new Error('Expected a JSON array of findings or an object with a `findings` array');
  }
  const findings: Finding[] = [];
  for (let i = 0; i < arr.length; i++) {
    const f = arr[i];
    const reason = findingValidationError(f);
    if (reason !== null) {
      throw new Error(`Invalid finding at index ${i}: ${reason}`);
    }
    findings.push(f as Finding);
  }
  return findings;
}

async function cmdMetrics(args: string[], io: CliIO): Promise<number> {
  const file = args[0];
  if (!file) { io.stderr('metrics: missing <file> argument\n'); return 2; }
  const code = await io.readFile(file);
  io.stdout(JSON.stringify(computeCodeMetrics(code), null, 2) + '\n');
  return 0;
}

async function cmdRedact(args: string[], io: CliIO): Promise<number> {
  const file = args.find((a) => !a.startsWith('--'));
  if (!file) { io.stderr('redact: missing <file> argument\n'); return 2; }
  const statsOnly = args.includes('--stats');
  const code = await io.readFile(file);
  const r = redactSecrets(code);
  if (statsOnly) {
    io.stdout(JSON.stringify({
      hitCount: r.hits.length,
      summary: summarizeRedactions(r.hits),
      hits: r.hits,
    }, null, 2) + '\n');
  } else {
    io.stdout(r.code);
    if (!r.code.endsWith('\n')) io.stdout('\n');
    io.stderr(`${r.hits.length} secret${r.hits.length === 1 ? '' : 's'} redacted: ${summarizeRedactions(r.hits)}\n`);
  }
  return 0;
}

async function cmdPie(args: string[], io: CliIO): Promise<number> {
  const file = args[0];
  if (!file) { io.stderr('pie: missing <findings.json> argument\n'); return 2; }
  const json = await io.readFile(file);
  const findings = parseFindings(json);
  io.stdout(toSeverityPieSVG(findings, { size: 128, innerRatio: 0.55 }) + '\n');
  return 0;
}

async function cmdSummary(args: string[], io: CliIO): Promise<number> {
  const file = args[0];
  if (!file) { io.stderr('summary: missing <findings.json> argument\n'); return 2; }
  const json = await io.readFile(file);
  const findings = parseFindings(json);
  const summary = summarizeFindings(findings);
  const top = sortFindingsBySeverity(findings)
    .slice(0, 5)
    .map((f) => ({ severity: f.severity, category: f.category, title: f.title, line: f.line ?? null }));
  io.stdout(JSON.stringify({ ...summary, top }, null, 2) + '\n');
  return 0;
}

export async function runCli(argv: readonly string[], io: CliIO = DEFAULT_IO): Promise<number> {
  const [cmd, ...rest] = argv;

  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    io.stdout(HELP);
    return cmd ? 0 : 1;
  }
  if (cmd === 'version' || cmd === '--version' || cmd === '-v') {
    io.stdout(`${VERSION}\n`);
    return 0;
  }

  try {
    switch (cmd) {
      case 'metrics': return await cmdMetrics(rest, io);
      case 'redact':  return await cmdRedact(rest, io);
      case 'pie':     return await cmdPie(rest, io);
      case 'summary': return await cmdSummary(rest, io);
      default:
        io.stderr(`Unknown command: ${cmd}\n\n${HELP}`);
        return 2;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    io.stderr(`${cmd}: ${msg}\n`);
    return 1;
  }
}

const entryPath = process.argv[1];
const entryUrl = entryPath ? pathToFileURL(entryPath).href : '';
if (import.meta.url === entryUrl) {
  runCli(process.argv.slice(2)).then((code) => { process.exit(code); });
}
