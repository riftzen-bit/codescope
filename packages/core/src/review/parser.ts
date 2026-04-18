import type { Finding, ReviewResult, Severity, Category } from './types.js';

const LANGUAGE_MAP: Record<string, string[]> = {
  typescript: ['.ts', '.tsx', '.mts', '.cts'],
  javascript: ['.js', '.jsx', '.mjs', '.cjs'],
  python: ['.py', '.pyw', '.pyi'],
  rust: ['.rs'],
  go: ['.go'],
  java: ['.java'],
  cpp: ['.cpp', '.cc', '.cxx', '.c++', '.hpp', '.hh', '.hxx'],
  c: ['.c', '.h'],
  csharp: ['.cs'],
  ruby: ['.rb', '.rake'],
  php: ['.php', '.phtml'],
  swift: ['.swift'],
  kotlin: ['.kt', '.kts'],
  scala: ['.scala', '.sc'],
  haskell: ['.hs', '.lhs'],
  elixir: ['.ex', '.exs'],
  erlang: ['.erl', '.hrl'],
  lua: ['.lua'],
  dart: ['.dart'],
  r: ['.r', '.rmd'],
  perl: ['.pl', '.pm'],
  zig: ['.zig'],
  nim: ['.nim'],
  ocaml: ['.ml', '.mli'],
  fsharp: ['.fs', '.fsi', '.fsx'],
  clojure: ['.clj', '.cljs', '.cljc', '.edn'],
  vue: ['.vue'],
  svelte: ['.svelte'],
  html: ['.html', '.htm'],
  css: ['.css', '.scss', '.sass', '.less'],
  json: ['.json', '.jsonc'],
  yaml: ['.yml', '.yaml'],
  toml: ['.toml'],
  shell: ['.sh', '.bash', '.zsh', '.fish'],
  powershell: ['.ps1', '.psm1'],
  dockerfile: ['.dockerfile'],
  sql: ['.sql'],
  xml: ['.xml'],
  markdown: ['.md', '.markdown'],
  plaintext: ['.txt'],
};

const SHEBANG_MAP: Record<string, string> = {
  python: 'python',
  python3: 'python',
  node: 'javascript',
  deno: 'typescript',
  ruby: 'ruby',
  bash: 'shell',
  sh: 'shell',
  zsh: 'shell',
  fish: 'shell',
  perl: 'perl',
  lua: 'lua',
  pwsh: 'powershell',
  powershell: 'powershell',
};

/**
 * Filenames without extension that uniquely identify a language. Matched by
 * basename, case-insensitively.
 */
const FILENAME_MAP: Record<string, string> = {
  'dockerfile': 'dockerfile',
  'makefile': 'shell',
  'gnumakefile': 'shell',
  'rakefile': 'ruby',
  'gemfile': 'ruby',
  'cmakelists.txt': 'cmake',
};

export function detectLanguage(code: string, filename?: string): string {
  if (filename) {
    // Strip directory; basename-only lookups for extension-less files.
    const base = filename.slice(Math.max(filename.lastIndexOf('/'), filename.lastIndexOf('\\')) + 1)
      .toLowerCase();
    if (base in FILENAME_MAP) return FILENAME_MAP[base] ?? 'unknown';

    const dot = filename.lastIndexOf('.');
    if (dot >= 0) {
      const ext = filename.slice(dot).toLowerCase();
      for (const [lang, exts] of Object.entries(LANGUAGE_MAP)) {
        if (exts.includes(ext)) return lang;
      }
    }
  }

  const firstLine = code.split('\n')[0] ?? '';
  if (firstLine.startsWith('#!')) {
    // Parse both direct shebangs (`#!/bin/bash`) and env-wrapped
    // shebangs (`#!/usr/bin/env python3`): strip the path, then if the
    // leading token is `env`, read the next word.
    const tail = firstLine.slice(2).trim();
    const tokens = tail.split(/\s+/);
    let binPath = tokens[0] ?? '';
    let bin = binPath.split('/').pop() ?? '';
    if (bin === 'env' && tokens.length > 1) {
      bin = tokens[1] ?? '';
    }
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
