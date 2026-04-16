import type { Finding, ReviewResult, Severity, Category } from './types.js';

const LANGUAGE_MAP: Record<string, string[]> = {
  typescript: ['.ts', '.tsx'],
  javascript: ['.js', '.jsx', '.mjs', '.cjs'],
  python: ['.py', '.pyw'],
  rust: ['.rs'],
  go: ['.go'],
  java: ['.java'],
  cpp: ['.cpp', '.cc', '.cxx', '.c++', '.h', '.hpp'],
  c: ['.c'],
  csharp: ['.cs'],
  ruby: ['.rb'],
  php: ['.php'],
  swift: ['.swift'],
  kotlin: ['.kt', '.kts'],
  html: ['.html', '.htm'],
  css: ['.css', '.scss', '.sass', '.less'],
  json: ['.json'],
  yaml: ['.yml', '.yaml'],
  shell: ['.sh', '.bash', '.zsh'],
  sql: ['.sql'],
  plaintext: ['.txt'],
};

const SHEBANG_MAP: Record<string, string> = {
  python: 'python',
  python3: 'python',
  node: 'javascript',
  ruby: 'ruby',
  bash: 'shell',
  sh: 'shell',
  zsh: 'shell',
};

export function detectLanguage(code: string, filename?: string): string {
  if (filename) {
    const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase();
    for (const [lang, exts] of Object.entries(LANGUAGE_MAP)) {
      if (exts.includes(ext)) return lang;
    }
  }

  const firstLine = code.split('\n')[0] ?? '';
  if (firstLine.startsWith('#!')) {
    const bin = firstLine.split('/').pop()?.split(' ')[0] ?? '';
    if (bin in SHEBANG_MAP) return SHEBANG_MAP[bin] ?? 'unknown';
  }

  return 'unknown';
}

const VALID_SEVERITIES = new Set<string>(['critical', 'error', 'warning', 'info']);
const VALID_CATEGORIES = new Set<string>([
  'security', 'performance', 'correctness', 'maintainability', 'style', 'other',
]);

export function sanitizeFinding(raw: unknown, index: number): Finding {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`Finding at index ${index} is not an object`);
  }
  const f = raw as Record<string, unknown>;

  const severity = VALID_SEVERITIES.has(String(f['severity'] ?? ''))
    ? (f['severity'] as Severity)
    : 'info';

  const category = VALID_CATEGORIES.has(String(f['category'] ?? ''))
    ? (f['category'] as Category)
    : 'other';

  const line = typeof f['line'] === 'number' ? f['line'] : undefined;

  return {
    id: String(f['id'] ?? `f${index + 1}`),
    severity,
    category,
    ...(line !== undefined ? { line } : {}),
    title: String(f['title'] ?? 'Untitled finding'),
    description: String(f['description'] ?? ''),
    suggestion: String(f['suggestion'] ?? ''),
  };
}

function extractJson(text: string): string {
  const trimmed = text.trim();

  // Strip markdown code fences if present
  const fenceMatch = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  if (fenceMatch?.[1]) return fenceMatch[1].trim();

  // Find the outermost JSON object
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    return trimmed.slice(start, end + 1);
  }

  return trimmed;
}

export function parseReviewResponse(
  text: string,
  provider: string,
  model: string,
  language: string,
  tokensUsed?: { input: number; output: number },
): ReviewResult {
  const jsonStr = extractJson(text);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (err) {
    throw new Error(`Failed to parse review response as JSON: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Review response JSON is not an object');
  }

  const obj = parsed as Record<string, unknown>;

  const summary = typeof obj['summary'] === 'string' ? obj['summary'] : 'No summary provided';
  const score = typeof obj['score'] === 'number'
    ? Math.min(100, Math.max(0, Math.round(obj['score'])))
    : 50;

  const rawFindings = Array.isArray(obj['findings']) ? obj['findings'] : [];
  const findings: Finding[] = rawFindings.map((f, i) => sanitizeFinding(f, i));

  return {
    summary,
    score,
    findings,
    language,
    provider,
    model,
    ...(tokensUsed !== undefined ? { tokensUsed } : {}),
  };
}
