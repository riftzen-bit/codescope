import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useReview } from '../hooks/useReview';
import { useDragDrop } from '../hooks/useDragDrop';
import { useHistoryPanel } from '../hooks/useHistoryPanel';
import { useToasts } from '../hooks/useToasts';
import { FindingCard } from './FindingCard';
import { CodeEditor } from './CodeEditor';
import { ScoreTrendChart } from './ScoreTrendChart';
import { DashboardView } from './DashboardView';
import { PROVIDER_CONFIGS } from './settings/providers';
import type { AppSettings, Category, HistoryEntry, ProjectFile, ReviewResult, Severity } from '../types';
import {
  RULE_PRESETS,
  getPresetRules,
  toSARIF,
  toJSON,
  toCSV,
  toHTML,
  toJUnitXML,
  toGithubAnnotations,
  toDiffHTML,
  filterFindings,
  estimateCost,
  formatCost,
  contentKey,
  IgnoreList,
  findingFingerprint,
  diffFindings,
  computeCodeMetrics,
  sparkline,
  redactSecrets,
  summarizeRedactions,
  toSeverityPieSVG,
} from '@code-review/core';
import type { RulePresetId, Finding } from '@code-review/core';

const ALL_SEVERITIES: Severity[] = ['critical', 'error', 'warning', 'info'];
const ALL_CATEGORIES: Category[] = [
  'security', 'performance', 'correctness', 'maintainability', 'style', 'other',
];

const PROVIDERS = Object.keys(PROVIDER_CONFIGS) as Array<keyof typeof PROVIDER_CONFIGS>;

type ExportFormat = 'markdown' | 'sarif' | 'json' | 'csv' | 'html' | 'junit' | 'github' | 'diffhtml';

const EXPORT_EXTENSIONS: Record<ExportFormat, string> = {
  markdown: 'md',
  sarif: 'sarif.json',
  json: 'json',
  csv: 'csv',
  html: 'html',
  junit: 'junit.xml',
  github: 'txt',
  diffhtml: 'diff.html',
};

function ReviewMetadata({ result, scoreTrend }: { result: ReviewResult; scoreTrend?: number[] }) {
  const items: Array<{ label: string; value: string }> = [
    { label: 'Provider', value: result.provider },
    { label: 'Model', value: result.model },
    { label: 'Language', value: result.language },
  ];
  if (result.tokensUsed) {
    items.push({ label: 'Tokens', value: `${result.tokensUsed.input}↑ ${result.tokensUsed.output}↓` });
    const usd = estimateCost(result.provider, result.model, result.tokensUsed);
    items.push({ label: 'Est. cost', value: formatCost(usd) });
  }
  const trend = scoreTrend && scoreTrend.length > 1 ? sparkline(scoreTrend) : '';
  return (
    <dl className="review-metadata">
      {items.map((item) => (
        <div key={item.label} className="review-metadata-item">
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
      {trend && (
        <div className="review-metadata-item" title={`Score trend (last ${scoreTrend?.length} reviews of this file)`}>
          <dt>Trend</dt>
          <dd className="score-trend">{trend}</dd>
        </div>
      )}
      {scoreTrend && scoreTrend.length > 1 && (
        <div className="review-metadata-item review-metadata-chart">
          <dt>History</dt>
          <dd><ScoreTrendChart points={scoreTrend} /></dd>
        </div>
      )}
    </dl>
  );
}
type Provider = keyof typeof PROVIDER_CONFIGS;

// localStorage helpers for UI preferences. Never throw — storage can be full,
// disabled (private mode), or host a stale schema; fall back to defaults.
function loadStringPref(key: string, fallback: string): string {
  try {
    const v = localStorage.getItem(key);
    return v ?? fallback;
  } catch { return fallback; }
}
function loadArrayPref(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch { return []; }
}
function loadSetPref<T extends string>(key: string, all: readonly T[]): Set<T> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return new Set(all);
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set(all);
    const filtered = parsed.filter((x): x is T => typeof x === 'string' && (all as readonly string[]).includes(x));
    return filtered.length > 0 ? new Set(filtered) : new Set(all);
  } catch { return new Set(all); }
}
function savePref(key: string, value: string | string[]): void {
  try {
    if (typeof value === 'string') localStorage.setItem(key, value);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage full or disabled — non-fatal
  }
}

const MAX_REVIEW_CHARS = 200_000;

// Stable non-crypto hash used to dedupe history saves: two reviews with the
// same code + provider + model + filename should only be persisted once.
function dedupKey(code: string, provider: string, model: string, filename: string): string {
  return `${provider}:${model}:${filename}:${contentKey(code)}`;
}

const MIN_PANEL_WIDTH = 280;
const MAX_PANEL_WIDTH = 800;
const DEFAULT_PANEL_WIDTH = 380;

// Format review result as text for copying
function formatResultForCopy(result: ReviewResult, filename?: string): string {
  const lines: string[] = [];

  lines.push('# Code Review Analysis');
  if (filename) {
    lines.push(`**File:** ${filename}`);
  }
  lines.push('');
  lines.push(`**Provider:** ${result.provider}`);
  lines.push(`**Model:** ${result.model}`);
  if (result.language && result.language !== 'unknown') {
    lines.push(`**Language:** ${result.language}`);
  }
  lines.push(`**Quality Score:** ${result.score}/100`);
  lines.push('');
  lines.push('## Summary');
  lines.push(result.summary);
  lines.push('');

  if (result.findings.length === 0) {
    lines.push('## Findings');
    lines.push('No issues detected.');
  } else {
    lines.push(`## Findings (${result.findings.length})`);
    lines.push('');

    result.findings.forEach((f, i) => {
      lines.push(`### ${i + 1}. [${f.severity.toUpperCase()}] ${f.title}`);
      lines.push(`- **Category:** ${f.category}`);
      if (f.line !== undefined) {
        lines.push(`- **Line:** ${f.line}`);
      }
      lines.push('');
      lines.push('**Description:**');
      lines.push(f.description);
      lines.push('');
      if (f.suggestion) {
        lines.push('**Suggestion:**');
        lines.push(f.suggestion);
      }
      lines.push('');
    });
  }

  return lines.join('\n');
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;'
    : c === '<' ? '&lt;'
    : c === '>' ? '&gt;'
    : c === '"' ? '&quot;'
    : '&#39;',
  );
}

function severityIcon(sev: Severity): string {
  switch (sev) {
    case 'critical': return '🔴';
    case 'error': return '🔴';
    case 'warning': return '🟡';
    case 'info': return '🔵';
  }
}

// Format review as a GitHub-flavored Markdown PR comment with <details> blocks.
function formatResultForPR(result: ReviewResult, filename?: string): string {
  const lines: string[] = [];
  lines.push(`### Code Review${filename ? ` — \`${filename}\`` : ''}`);
  lines.push('');
  lines.push(`**Score:** ${result.score}/100 · **Provider:** ${result.provider}/${result.model}`);
  lines.push('');
  lines.push(result.summary);
  lines.push('');

  if (result.findings.length === 0) {
    lines.push('_No issues detected._');
    return lines.join('\n');
  }

  lines.push(`**${result.findings.length} finding${result.findings.length === 1 ? '' : 's'}:**`);
  lines.push('');
  for (const f of result.findings) {
    const icon = severityIcon(f.severity);
    const lineRef = f.line != null ? ` · L${f.line}` : '';
    lines.push('<details>');
    lines.push(
      `<summary>${icon} <strong>[${f.severity.toUpperCase()}]</strong> ${escapeHtml(f.title)}${lineRef}</summary>`,
    );
    lines.push('');
    lines.push(`**Category:** ${f.category}`);
    lines.push('');
    lines.push(f.description);
    if (f.suggestion) {
      lines.push('');
      lines.push(`**Suggestion:** ${f.suggestion}`);
    }
    lines.push('');
    lines.push('</details>');
    lines.push('');
  }

  return lines.join('\n');
}

// Concatenate all project files into one code block
// Cap memory on very large projects: once we cross the overflow check
// budget, stop appending and flag truncation. The user still hits the
// confirm dialog, and we never build a 20MB string just to discard it.
const CONCAT_HARD_LIMIT = Math.floor(MAX_REVIEW_CHARS * 1.1);

function concatenateProjectFiles(files: ProjectFile[]): string {
  const parts: string[] = [];
  let total = 0;
  let truncated = false;
  let skipped = 0;

  for (const file of files) {
    if (truncated) {
      skipped++;
      continue;
    }
    const header =
      `// ═══════════════════════════════════════════════════════════════\n` +
      `// FILE: ${file.relativePath}\n` +
      `// ═══════════════════════════════════════════════════════════════\n\n`;
    const body = `${file.content}\n\n\n`;
    const chunk = header + body;
    if (total + chunk.length > CONCAT_HARD_LIMIT) {
      truncated = true;
      skipped++;
      continue;
    }
    parts.push(chunk);
    total += chunk.length;
  }

  if (truncated) {
    parts.push(
      `// ═══════════════════════════════════════════════════════════════\n` +
      `// TRUNCATED: ${skipped} additional file(s) omitted — exceeds ${CONCAT_HARD_LIMIT.toLocaleString()} char budget.\n` +
      `// ═══════════════════════════════════════════════════════════════\n`,
    );
  }

  return parts.join('');
}

interface Props {
  projectFiles?: ProjectFile[] | undefined;
  projectName?: string | undefined;
  projectPath?: string | undefined;
  onClearProject?: (() => void) | undefined;
  onRescanProject?: (() => Promise<void>) | undefined;
}

export function ReviewView({ projectFiles, projectName, projectPath, onClearProject, onRescanProject }: Props) {
  const [code, setCode] = useState('');
  const [filename, setFilename] = useState('');
  const [provider, setProvider] = useState<Provider>('anthropic');
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied'>('idle');
  const [copyPrStatus, setCopyPrStatus] = useState<'idle' | 'copied'>('idle');
  const [exportStatus, setExportStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [selectedFileIndex, setSelectedFileIndex] = useState(0);
  const [isAllFilesMode, setIsAllFilesMode] = useState(false);
  const [highlightLine, setHighlightLine] = useState<number | undefined>();
  const [highlightTrigger, setHighlightTrigger] = useState(0);
  const [sevFilter, setSevFilter] = useState<Set<Severity>>(() => loadSetPref('ui.sevFilter', ALL_SEVERITIES));
  const [catFilter, setCatFilter] = useState<Set<Category>>(() => loadSetPref('ui.catFilter', ALL_CATEGORIES));
  const [searchQuery, setSearchQuery] = useState<string>(() => loadStringPref('ui.searchQuery', ''));
  const [ignoredFingerprints, setIgnoredFingerprints] = useState<Set<string>>(
    () => new Set(loadArrayPref('ui.ignored')),
  );
  const [ignorePatterns, setIgnorePatterns] = useState<string[]>(() => loadArrayPref('ui.ignorePatterns'));
  const [patternInput, setPatternInput] = useState<string>('');
  const [patternError, setPatternError] = useState<string | null>(null);
  const [compareMode, setCompareMode] = useState<boolean>(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showDashboard, setShowDashboard] = useState(false);
  const [rulePreset, setRulePreset] = useState<RulePresetId>(
    () => (loadStringPref('ui.rulePreset', 'all') as RulePresetId),
  );
  const [exportFormat, setExportFormat] = useState<ExportFormat>(
    () => (loadStringPref('ui.exportFormat', 'markdown') as ExportFormat),
  );
  const [focusedFindingIdx, setFocusedFindingIdx] = useState<number>(-1);
  const lastSavedRef = useRef<string | null>(null);
  const { state, run, cancel, reset, restore } = useReview();
  const { history, showHistory, addToHistory, deleteEntry: handleDeleteHistory, clearAll: clearHistory, toggle: toggleHistory, close: closeHistory } = useHistoryPanel();
  const { toasts, push: pushToast, dismiss: dismissToast } = useToasts();
  const isRunning = state.status === 'streaming' || state.status === 'running';

  const onDropFile = useCallback((content: string, name: string) => {
    setCode(content);
    setFilename(name);
    reset();
  }, [reset]);
  const { isDragging, handleDrop, dropError, clearDropError } = useDragDrop(onDropFile);

  const containerRef = useRef<HTMLDivElement>(null);

  const isProjectMode = Boolean(projectFiles && projectFiles.length > 0);
  const [filesChanged, setFilesChanged] = useState(false);
  const [rescanning, setRescanning] = useState(false);
  const [dirtyPaths, setDirtyPaths] = useState<Set<string>>(new Set());

  // Start/stop file watcher when entering/leaving project mode
  useEffect(() => {
    if (!projectPath) return;

    window.api.watchProject(projectPath).catch((err) => {
      console.error('Failed to start file watcher:', err);
    });

    const unsub = window.api.onProjectFilesChanged((changedPath) => {
      setFilesChanged(true);
      if (changedPath) {
        setDirtyPaths((prev) => {
          const next = new Set(prev);
          next.add(changedPath);
          return next;
        });
      }
    });

    return () => {
      unsub();
      window.api.unwatchProject().catch((err) => console.error('Failed to stop file watcher:', err));
      setFilesChanged(false);
      setDirtyPaths(new Set());
    };
  }, [projectPath]);

  // Auto-rescan when files change on disk
  useEffect(() => {
    if (!filesChanged || !onRescanProject || rescanning) return;
    setRescanning(true);
    setFilesChanged(false);
    onRescanProject().finally(() => setRescanning(false));
  }, [filesChanged, onRescanProject, rescanning]);

  // Load settings on mount
  useEffect(() => {
    window.api.settingsGet().then((s) => {
      setSettings(s);
      if (s.activeProvider && PROVIDERS.includes(s.activeProvider as Provider)) {
        setProvider(s.activeProvider as Provider);
      }
    }).catch(() => {
      // Non-fatal - use defaults
    });
  }, []);

  // Load first project file when entering project mode
  useEffect(() => {
    if (isProjectMode && projectFiles && projectFiles.length > 0) {
      const firstFile = projectFiles[0];
      if (firstFile) {
        setCode(firstFile.content);
        setFilename(firstFile.relativePath);
        setSelectedFileIndex(0);
        setIsAllFilesMode(false);
        reset();
      }
    }
  }, [projectFiles, isProjectMode]);

  // Global Esc key cancels an in-flight review (convenience shortcut).
  useEffect(() => {
    if (!isRunning) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isRunning, cancel]);

  // Auto-save completed reviews to history, gated on settings.autoSaveHistory.
  useEffect(() => {
    if (state.status !== 'done') return;
    if (settings && settings.autoSaveHistory === false) return;
    const result = state.result;
    const key = dedupKey(code, result.provider, result.model, filename);
    if (lastSavedRef.current === key) return;
    lastSavedRef.current = key;

    window.api.historyAdd({
      filename: filename || 'untitled',
      code,
      provider: result.provider,
      model: result.model,
      language: result.language,
      score: result.score,
      summary: result.summary,
      findings: result.findings,
      ...(result.tokensUsed ? { tokensUsed: result.tokensUsed } : {}),
    }).then((entry) => {
      addToHistory(entry);
    }).catch((err) => console.error('Failed to save history entry:', err));
  }, [state, filename, code, addToHistory, settings]);

  // Resize handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const containerRect = containerRef.current.getBoundingClientRect();
      const newWidth = containerRect.right - e.clientX;
      setPanelWidth(Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, newWidth)));
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  const buildRules = useCallback((): string[] => {
    const rules: string[] = [];
    rules.push(...getPresetRules(rulePreset));
    const profile = settings?.styleProfile?.trim();
    if (profile) rules.push(`Project style guidance: ${profile}`);
    return rules;
  }, [rulePreset, settings]);

  const prepareOutgoingCode = useCallback(
    (src: string): { text: string; hitCount: number } => {
      if (settings?.redactSecretsBeforeSend === false) return { text: src, hitCount: 0 };
      const r = redactSecrets(src);
      return { text: r.code, hitCount: r.hits.length };
    },
    [settings],
  );

  function handleReview() {
    if (!code.trim()) return;
    const rules = buildRules();
    const { text, hitCount } = prepareOutgoingCode(code);
    if (hitCount > 0) {
      pushToast(`Redacted ${hitCount} secret${hitCount === 1 ? '' : 's'} before sending`, 'info');
    }
    run({
      code: text,
      ...(filename ? { filename } : {}),
      provider,
      ...(rules.length > 0 ? { rules } : {}),
    });
  }

  const handleSelectFile = useCallback((index: number) => {
    if (!projectFiles) return;
    const file = projectFiles[index];
    if (!file) return;
    setCode(file.content);
    setFilename(file.relativePath);
    setSelectedFileIndex(index);
    setIsAllFilesMode(false);
    reset();
  }, [projectFiles, reset]);

  const handleReviewDirty = useCallback(async () => {
    if (!projectFiles || projectFiles.length === 0) return;
    if (dirtyPaths.size === 0) return;
    const dirtyFiles = projectFiles.filter((f) => dirtyPaths.has(f.path));
    if (dirtyFiles.length === 0) {
      setDirtyPaths(new Set());
      return;
    }

    const allCode = concatenateProjectFiles(dirtyFiles);

    if (allCode.length > MAX_REVIEW_CHARS) {
      const estimatedTokens = Math.round(allCode.length / 4);
      const ok = await window.api.confirm(
        `This will send ~${estimatedTokens.toLocaleString()} tokens (${dirtyFiles.length} changed files, ` +
        `${Math.round(allCode.length / 1024)}KB) to the AI provider.\n\n` +
        `This may incur significant API costs. Continue?`,
      );
      if (!ok) return;
    }

    const reviewFilename = `${projectName || 'project'} (${dirtyFiles.length} changed files)`;
    setCode(allCode);
    setFilename(reviewFilename);
    setIsAllFilesMode(true);
    const rules = buildRules();
    const { text, hitCount } = prepareOutgoingCode(allCode);
    if (hitCount > 0) {
      pushToast(`Redacted ${hitCount} secret${hitCount === 1 ? '' : 's'} before sending`, 'info');
    }
    run({
      code: text,
      filename: reviewFilename,
      provider,
      ...(rules.length > 0 ? { rules } : {}),
    });
    setDirtyPaths(new Set());
  }, [projectFiles, dirtyPaths, projectName, provider, run, buildRules, prepareOutgoingCode, pushToast]);

  const handleReviewAll = useCallback(async () => {
    if (!projectFiles || projectFiles.length === 0) return;

    const allCode = concatenateProjectFiles(projectFiles);

    if (allCode.length > MAX_REVIEW_CHARS) {
      const estimatedTokens = Math.round(allCode.length / 4);
      const ok = await window.api.confirm(
        `This will send ~${estimatedTokens.toLocaleString()} tokens (${projectFiles.length} files, ` +
        `${Math.round(allCode.length / 1024)}KB) to the AI provider.\n\n` +
        `This may incur significant API costs. Continue?`
      );
      if (!ok) return;
    }

    const reviewFilename = `${projectName || 'project'} (${projectFiles.length} files)`;
    setCode(allCode);
    setFilename(reviewFilename);
    setIsAllFilesMode(true);
    const rules = buildRules();
    const { text, hitCount } = prepareOutgoingCode(allCode);
    if (hitCount > 0) {
      pushToast(`Redacted ${hitCount} secret${hitCount === 1 ? '' : 's'} before sending`, 'info');
    }
    run({
      code: text,
      filename: reviewFilename,
      provider,
      ...(rules.length > 0 ? { rules } : {}),
    });
  }, [projectFiles, projectName, provider, run, buildRules, prepareOutgoingCode, pushToast]);

  const handleCopyAll = useCallback(async () => {
    if (state.status !== 'done') return;

    const text = formatResultForCopy(state.result, filename);
    try {
      await navigator.clipboard.writeText(text);
      setCopyStatus('copied');
      setTimeout(() => setCopyStatus('idle'), 2000);
    } catch {
      console.error('Clipboard write failed: navigator.clipboard.writeText is not available');
    }
  }, [state, filename]);

  const handleCopyPr = useCallback(async () => {
    if (state.status !== 'done') return;
    const text = formatResultForPR(state.result, filename);
    try {
      await navigator.clipboard.writeText(text);
      setCopyPrStatus('copied');
      setTimeout(() => setCopyPrStatus('idle'), 2000);
    } catch {
      console.error('Clipboard write failed');
    }
  }, [state, filename]);

  const handleLoadHistory = useCallback((entry: HistoryEntry) => {
    setCode(entry.code);
    setFilename(entry.filename);
    closeHistory();
    lastSavedRef.current = dedupKey(entry.code, entry.provider, entry.model, entry.filename);
    restore({
      summary: entry.summary,
      score: entry.score,
      findings: entry.findings,
      language: entry.language,
      provider: entry.provider,
      model: entry.model,
      ...(entry.tokensUsed ? { tokensUsed: entry.tokensUsed } : {}),
    });
  }, [restore, closeHistory]);

  const handleExport = useCallback(async () => {
    if (state.status !== 'done') return;

    setExportStatus('saving');
    let text: string;
    switch (exportFormat) {
      case 'sarif':
        text = toSARIF(state.result, filename ? { filename } : {});
        break;
      case 'json':
        text = toJSON(state.result);
        break;
      case 'csv':
        text = toCSV(state.result, filename || undefined);
        break;
      case 'html':
        text = toHTML(state.result, filename || undefined);
        break;
      case 'junit':
        text = toJUnitXML(state.result, filename || undefined);
        break;
      case 'github':
        text = toGithubAnnotations(state.result, filename || undefined);
        break;
      case 'diffhtml': {
        const prior = filename
          ? history.find((h) => h.filename === filename
              && dedupKey(h.code, h.provider, h.model, h.filename)
                 !== dedupKey(code, state.result.provider, state.result.model, filename))
          : undefined;
        if (!prior) {
          text = toHTML(state.result, filename || undefined);
        } else {
          const d = diffFindings(
            { findings: prior.findings, score: prior.score },
            { findings: state.result.findings, score: state.result.score },
          );
          const diffOpts: { filename?: string; beforeLabel?: string; afterLabel?: string } = {
            beforeLabel: new Date(prior.createdAt).toLocaleString(),
            afterLabel: 'now',
          };
          if (filename) diffOpts.filename = filename;
          text = toDiffHTML(d, diffOpts);
        }
        break;
      }
      default:
        text = formatResultForCopy(state.result, filename);
    }
    const safeName = (filename || 'review').replace(/[^a-zA-Z0-9._-]/g, '_');
    const ext = EXPORT_EXTENSIONS[exportFormat];
    const defaultFilename = `${safeName}-review.${ext}`;

    try {
      const saved = await window.api.exportReview(text, defaultFilename);
      if (saved) {
        setExportStatus('saved');
        pushToast(`Saved ${exportFormat.toUpperCase()} export`, 'success');
        setTimeout(() => setExportStatus('idle'), 2000);
      } else {
        setExportStatus('idle');
      }
    } catch (err) {
      setExportStatus('idle');
      pushToast(`Export failed: ${err instanceof Error ? err.message : 'unknown error'}`, 'error');
    }
  }, [state, filename, exportFormat, history, code, pushToast]);


  const handleLineClick = useCallback((line: number) => {
    setHighlightLine(line);
    setHighlightTrigger((t) => t + 1);
  }, []);

  useEffect(() => { savePref('ui.sevFilter', [...sevFilter]); }, [sevFilter]);
  useEffect(() => { savePref('ui.catFilter', [...catFilter]); }, [catFilter]);
  useEffect(() => { savePref('ui.searchQuery', searchQuery); }, [searchQuery]);
  useEffect(() => { savePref('ui.ignored', [...ignoredFingerprints]); }, [ignoredFingerprints]);
  useEffect(() => { savePref('ui.ignorePatterns', ignorePatterns); }, [ignorePatterns]);
  useEffect(() => { savePref('ui.rulePreset', rulePreset); }, [rulePreset]);
  useEffect(() => { savePref('ui.exportFormat', exportFormat); }, [exportFormat]);

  const ignoreList = useMemo(
    () => new IgnoreList(ignoredFingerprints, ignorePatterns),
    [ignoredFingerprints, ignorePatterns],
  );

  const codeMetrics = useMemo(() => computeCodeMetrics(code), [code]);

  const redactionPreview = useMemo(() => {
    if (settings?.redactSecretsBeforeSend === false) return null;
    if (!code) return null;
    const r = redactSecrets(code);
    if (r.hits.length === 0) return null;
    return { count: r.hits.length, summary: summarizeRedactions(r.hits) };
  }, [code, settings]);

  // Find the most recent prior history entry for the same filename, excluding
  // the current just-saved review. Used for compare-to-last.
  const priorEntry = useMemo<HistoryEntry | undefined>(() => {
    if (!filename) return undefined;
    const candidates = history.filter((h) => h.filename === filename);
    if (state.status !== 'done') return candidates[0];
    const currentKey = dedupKey(code, state.result.provider, state.result.model, filename);
    return candidates.find((h) => dedupKey(h.code, h.provider, h.model, h.filename) !== currentKey);
  }, [history, filename, state, code]);

  const diff = useMemo(() => {
    if (!compareMode || state.status !== 'done' || !priorEntry) return null;
    return diffFindings(
      { findings: priorEntry.findings, score: priorEntry.score },
      { findings: state.result.findings, score: state.result.score },
    );
  }, [compareMode, state, priorEntry]);

  const newFingerprints = useMemo<Set<string>>(() => {
    if (!diff) return new Set();
    return new Set(diff.added.map(findingFingerprint));
  }, [diff]);

  const scoreTrend = useMemo<number[]>(() => {
    if (!filename) return [];
    const pts = history
      .filter((h) => h.filename === filename)
      .slice()
      .reverse()
      .map((h) => h.score);
    if (state.status === 'done') pts.push(state.result.score);
    return pts.slice(-12);
  }, [history, filename, state]);

  const visibleFindings = useMemo(() => {
    if (state.status !== 'done') return [];
    const filtered = filterFindings(state.result.findings, {
      severities: sevFilter,
      categories: catFilter,
      query: searchQuery,
    });
    return ignoreList.filter(filtered);
  }, [state, sevFilter, catFilter, searchQuery, ignoreList]);

  const handleDismissFinding = useCallback((f: Finding) => {
    setIgnoredFingerprints((prev) => {
      const next = new Set(prev);
      next.add(findingFingerprint(f));
      return next;
    });
  }, []);

  const handleResetIgnored = useCallback(() => {
    setIgnoredFingerprints(new Set());
  }, []);

  const handleAddPattern = useCallback(() => {
    const raw = patternInput.trim();
    if (!raw) return;
    try {
      new RegExp(raw);
    } catch {
      setPatternError('Invalid regex');
      return;
    }
    setIgnorePatterns((prev) => (prev.includes(raw) ? prev : [...prev, raw]));
    setPatternInput('');
    setPatternError(null);
  }, [patternInput]);

  const handleRemovePattern = useCallback((p: string) => {
    setIgnorePatterns((prev) => prev.filter((x) => x !== p));
  }, []);

  // Reset keyboard focus when findings list changes.
  useEffect(() => {
    setFocusedFindingIdx(-1);
  }, [visibleFindings]);

  // j/k navigate findings; Enter jumps to the focused finding's line.
  useEffect(() => {
    if (state.status !== 'done' || visibleFindings.length === 0) return;

    const isEditable = (el: EventTarget | null): boolean => {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isEditable(e.target)) return;
      if (e.key === 'j') {
        e.preventDefault();
        setFocusedFindingIdx((idx) => Math.min(visibleFindings.length - 1, idx + 1));
      } else if (e.key === 'k') {
        e.preventDefault();
        setFocusedFindingIdx((idx) => Math.max(0, idx - 1));
      } else if (e.key === 'Enter' && focusedFindingIdx >= 0) {
        const f = visibleFindings[focusedFindingIdx];
        if (f?.line !== undefined) {
          e.preventDefault();
          setHighlightLine(f.line);
          setHighlightTrigger((t) => t + 1);
        }
      } else if (e.key === 'x' && focusedFindingIdx >= 0) {
        const f = visibleFindings[focusedFindingIdx];
        if (f) {
          e.preventDefault();
          handleDismissFinding(f);
        }
      } else if (e.key === '/') {
        e.preventDefault();
        const input = document.querySelector<HTMLInputElement>('.findings-search-input');
        input?.focus();
        input?.select();
      } else if (e.key === 'n' || e.key === 'N') {
        if (newFingerprints.size === 0) return;
        e.preventDefault();
        const step = e.key === 'n' ? 1 : -1;
        const start = focusedFindingIdx < 0 ? (step > 0 ? -1 : visibleFindings.length) : focusedFindingIdx;
        const len = visibleFindings.length;
        for (let i = 1; i <= len; i += 1) {
          const idx = (start + step * i + len * len) % len;
          const f = visibleFindings[idx];
          if (f && newFingerprints.has(findingFingerprint(f))) {
            setFocusedFindingIdx(idx);
            break;
          }
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state, visibleFindings, focusedFindingIdx, handleDismissFinding, newFingerprints]);

  const toggleSevFilter = useCallback((sev: Severity) => {
    setSevFilter((prev) => {
      const next = new Set(prev);
      if (next.has(sev)) {
        if (next.size > 1) next.delete(sev);
      } else {
        next.add(sev);
      }
      return next;
    });
  }, []);

  // "?" opens the keyboard shortcuts overlay (outside editable elements).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t instanceof HTMLElement) {
        const tag = t.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable) return;
      }
      if (e.key === '?') {
        e.preventDefault();
        setShowShortcuts((prev) => !prev);
      } else if (e.key === 'Escape' && showShortcuts) {
        e.preventDefault();
        setShowShortcuts(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showShortcuts]);

  const toggleCatFilter = useCallback((cat: Category) => {
    setCatFilter((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) {
        if (next.size > 1) next.delete(cat);
      } else {
        next.add(cat);
      }
      return next;
    });
  }, []);

  const charCount = code.length;
  const lineCount = code ? code.split('\n').length : 0;
  // Rough tokens-per-char: code tends to compress slightly better than prose,
  // so divide by 3.5. Purely an order-of-magnitude estimate for user awareness.
  const tokenEstimate = charCount > 0 ? Math.ceil(charCount / 3.5) : 0;

  function formatTokens(n: number): string {
    if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
    return String(n);
  }

  return (
    <div className={`review-view${isProjectMode ? ' project-mode' : ''}`} ref={containerRef}>
      {/* Project banner */}
      {isProjectMode && projectName && (
        <div className="project-banner">
          <div className="project-banner-info">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <rect x="2" y="3" width="12" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.2"/>
              <path d="M2 6H14" stroke="currentColor" strokeWidth="1.2"/>
              <path d="M5.5 3V1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
            <span className="project-banner-name">{projectName}</span>
            <span className="project-banner-count">{projectFiles?.length} files</span>
            {rescanning && <span className="project-banner-sync">Syncing…</span>}
          </div>
          <div className="project-banner-actions">
            {dirtyPaths.size > 0 && !isRunning && (
              <button
                className="btn"
                onClick={handleReviewDirty}
                title="Review only files that changed on disk since the last scan"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <circle cx="7" cy="7" r="3" fill="currentColor"/>
                </svg>
                Review Dirty ({dirtyPaths.size})
              </button>
            )}
            <button
              className="btn btn-primary"
              onClick={handleReviewAll}
              disabled={isRunning}
            >
              {isRunning && isAllFilesMode ? (
                <><span className="spinner" />Reviewing All...</>
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M2 3H12M2 7H12M2 11H8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                  Review All
                </>
              )}
            </button>
            <button
              className="btn"
              onClick={() => { setFilesChanged(true); }}
              disabled={rescanning}
              title="Rescan project files from disk"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M11.5 7A4.5 4.5 0 1 1 7 2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                <path d="M7 1V3.5L9.5 2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              {rescanning ? 'Scanning…' : 'Rescan'}
            </button>
            <button className="btn" onClick={onClearProject}>
              Exit Project
            </button>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="review-toolbar">
        <div className="toolbar-left">
          <span className="toolbar-prompt">&gt;_</span>
          <div className="toolbar-separator" />

          {isProjectMode && projectFiles ? (
            <select
              className="select file-select"
              value={isAllFilesMode ? -1 : selectedFileIndex}
              onChange={(e) => {
                const val = Number(e.target.value);
                if (val >= 0) handleSelectFile(val);
              }}
            >
              {isAllFilesMode && (
                <option value={-1}>All Files ({projectFiles.length})</option>
              )}
              {projectFiles.map((file, i) => (
                <option key={file.path} value={i}>
                  {file.relativePath}
                </option>
              ))}
            </select>
          ) : (
            <input
              className="filename-input"
              placeholder="filename.ts"
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
            />
          )}

          <div className="toolbar-separator" />

          <select
            className="select provider-select"
            value={provider}
            onChange={(e) => setProvider(e.target.value as Provider)}
          >
            {PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {PROVIDER_CONFIGS[p]?.label}
                {settings?.providers[p]?.model ? ` (${settings?.providers[p]?.model})` : ''}
              </option>
            ))}
          </select>

          <div className="toolbar-separator" />

          <select
            className="select preset-select"
            value={rulePreset}
            onChange={(e) => setRulePreset(e.target.value as RulePresetId)}
            title="Rule preset — scope what the reviewer focuses on"
          >
            {Object.values(RULE_PRESETS).map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </div>

        <div className="toolbar-right">
          {history.length > 0 && (
            <button
              className="btn btn-sm"
              onClick={() => setShowDashboard(true)}
              title="Project dashboard"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <rect x="1.5" y="1.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2"/>
                <rect x="7.5" y="1.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2"/>
                <rect x="1.5" y="7.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2"/>
                <rect x="7.5" y="7.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2"/>
              </svg>
              <span className="btn-label-desktop">Dashboard</span>
            </button>
          )}

          {history.length > 0 && (
            <div style={{ position: 'relative' }}>
              <button
                className={`btn btn-sm${showHistory ? ' active' : ''}`}
                onClick={toggleHistory}
                title="Review history"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.2"/>
                  <path d="M7 4V7.5L9.5 9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                </svg>
                <span className="btn-label-desktop">History</span>
                <span className="toolbar-badge">{history.length}</span>
              </button>
              {showHistory && (
                <div className="history-dropdown">
                  <div className="history-dropdown-header">
                    <span>Recent Reviews</span>
                    <button
                      className="btn-copy"
                      onClick={clearHistory}
                    >
                      Clear All
                    </button>
                  </div>
                  <div className="history-dropdown-list">
                    {history.map((entry) => (
                      <button
                        key={entry.id}
                        className="history-item"
                        onClick={() => handleLoadHistory(entry)}
                      >
                        <div className="history-item-top">
                          <span className="history-item-name">{entry.filename}</span>
                          <span className="history-item-score">{entry.score}/100</span>
                        </div>
                        <div className="history-item-meta">
                          <span>{entry.provider}</span>
                          <span>{entry.findings.length} issues</span>
                          <span>{new Date(entry.createdAt).toLocaleDateString()}</span>
                          <button
                            className="history-item-delete"
                            onClick={(e) => handleDeleteHistory(entry.id, e)}
                            title="Delete"
                          >
                            &times;
                          </button>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {state.status !== 'idle' && !isRunning && (
            <button className="btn btn-sm" onClick={reset}>
              Clear
            </button>
          )}

          {isRunning ? (
            <button
              className="btn btn-sm btn-danger"
              onClick={cancel}
              title="Cancel the running review"
            >
              Cancel
            </button>
          ) : null}

          <button
            className="btn btn-primary"
            onClick={handleReview}
            disabled={isRunning || !code.trim()}
          >
            {isRunning ? (
              <><span className="spinner" />Analyzing</>
            ) : (
              'Review'
            )}
          </button>
        </div>
      </div>

      {/* Editor */}
      <div
        className={`editor-pane${isDragging ? ' drag-over' : ''}`}
      >
        {dropError && (
          <div className="error-banner" role="alert">
            {dropError}
            <button
              className="btn btn-sm"
              style={{ marginLeft: 'auto' }}
              onClick={clearDropError}
            >
              Dismiss
            </button>
          </div>
        )}
        {redactionPreview && (
          <div
            className="redaction-banner"
            role="status"
            title={redactionPreview.summary}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path d="M6 1L2 3v3c0 2.5 1.7 4.3 4 5 2.3-.7 4-2.5 4-5V3L6 1z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round"/>
            </svg>
            <span className="redaction-banner-msg">
              {redactionPreview.count} secret{redactionPreview.count === 1 ? '' : 's'} will be redacted before sending
            </span>
            <span className="redaction-banner-detail">{redactionPreview.summary}</span>
          </div>
        )}
        <div className="pane-header">
          <span className="pane-label">
            <span className="pane-label-text">Source</span>
            {isProjectMode && filename && (
              <span className="pane-filename">{filename}</span>
            )}
          </span>
          <span className="pane-meta" title="lines · characters · estimated tokens">
            {lineCount > 0 ? `${lineCount}L · ${charCount}C · ~${formatTokens(tokenEstimate)} tok` : 'EMPTY'}
          </span>
        </div>
        {lineCount > 0 && (
          <div className="code-metrics-bar" title="Static code metrics (heuristic)">
            <span className="metric-chip">
              <span className="metric-chip-label">COMMENTS</span>
              <span className="metric-chip-value">{Math.round(codeMetrics.commentRatio * 100)}%</span>
            </span>
            <span className="metric-chip">
              <span className="metric-chip-label">BRANCHES</span>
              <span className="metric-chip-value">{codeMetrics.branches}</span>
            </span>
            <span className="metric-chip">
              <span className="metric-chip-label">MAX NEST</span>
              <span className="metric-chip-value">{codeMetrics.maxNesting}</span>
            </span>
            <span className="metric-chip">
              <span className="metric-chip-label">MAX LINE</span>
              <span className="metric-chip-value">{codeMetrics.maxLineLength}</span>
            </span>
            {codeMetrics.todoCount > 0 && (
              <span className="metric-chip metric-chip-warn">
                <span className="metric-chip-label">TODO</span>
                <span className="metric-chip-value">{codeMetrics.todoCount}</span>
              </span>
            )}
          </div>
        )}
        <div className="code-editor-wrap">
          <CodeEditor
            value={code}
            onChange={setCode}
            {...(isAllFilesMode ? {} : { filename })}
            onCtrlEnter={handleReview}
            {...(highlightLine != null ? { highlightLine, highlightTrigger } : {})}
            findings={state.status === 'done' ? visibleFindings : []}
            onFindingClick={(f) => {
              if (f.line !== undefined) {
                setHighlightLine(f.line);
                setHighlightTrigger((t) => t + 1);
              }
              const idx = visibleFindings.findIndex((v) => v.id === f.id);
              if (idx >= 0) setFocusedFindingIdx(idx);
            }}
          />
        </div>
        {isDragging && (
          <div
            className="drop-overlay"
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
          >
            <div className="drop-overlay-text">Drop file to review</div>
          </div>
        )}
      </div>

      {/* Resize Handle */}
      <div
        className={`resize-handle${isResizing ? ' resizing' : ''}`}
        onMouseDown={handleMouseDown}
      />

      {/* Results */}
      <div className="results-pane" style={{ width: panelWidth }}>
        <div className="results-header">
          <span className="pane-label">
            <span className="pane-label-text">Findings</span>
          </span>
          <div className="results-header-actions">
            {state.status === 'done' && (
              <>
                <span className="results-count">
                  {state.result.findings.length} finding{state.result.findings.length !== 1 ? 's' : ''}
                </span>
                <button
                  className={`btn-copy${copyStatus === 'copied' ? ' copied' : ''}`}
                  onClick={handleCopyAll}
                  title="Copy all findings as plain Markdown"
                >
                  {copyStatus === 'copied' ? (
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <path d="M3 7L6 10L11 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <rect x="4" y="4" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.2"/>
                      <path d="M2 10V2.5C2 2.22386 2.22386 2 2.5 2H10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                    </svg>
                  )}
                  {copyStatus === 'copied' ? 'Copied' : 'Copy All'}
                </button>
                <button
                  className={`btn-copy${copyPrStatus === 'copied' ? ' copied' : ''}`}
                  onClick={handleCopyPr}
                  title="Copy as a GitHub PR comment with collapsible findings"
                >
                  {copyPrStatus === 'copied' ? 'Copied' : 'Copy PR'}
                </button>
                {priorEntry && (
                  <button
                    className={`btn-copy${compareMode ? ' copied' : ''}`}
                    onClick={() => setCompareMode((v) => !v)}
                    title={`Compare against previous review (${new Date(priorEntry.createdAt).toLocaleString()})`}
                  >
                    {compareMode && diff
                      ? `Δ +${diff.added.length}/−${diff.removed.length}`
                      : 'Compare'}
                  </button>
                )}
                {ignoredFingerprints.size > 0 && (
                  <button
                    className="btn-copy"
                    onClick={handleResetIgnored}
                    title="Restore dismissed findings"
                  >
                    Restore {ignoredFingerprints.size}
                  </button>
                )}
                <select
                  className="select export-format-select"
                  value={exportFormat}
                  onChange={(e) => setExportFormat(e.target.value as ExportFormat)}
                  title="Export format"
                  disabled={exportStatus === 'saving'}
                >
                  <option value="markdown">Markdown</option>
                  <option value="sarif">SARIF</option>
                  <option value="json">JSON</option>
                  <option value="csv">CSV</option>
                  <option value="html">HTML</option>
                  <option value="junit">JUnit XML</option>
                  <option value="github">GitHub Annotations</option>
                  <option value="diffhtml">HTML Diff (vs last review)</option>
                </select>
                <button
                  className={`btn-copy${exportStatus === 'saved' ? ' copied' : ''}`}
                  onClick={handleExport}
                  disabled={exportStatus === 'saving'}
                  title={`Export review as ${exportFormat.toUpperCase()}`}
                >
                  {exportStatus === 'saved' ? (
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <path d="M3 7L6 10L11 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <path d="M7 2V9M7 9L4 6.5M7 9L10 6.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                      <path d="M2 10V11.5H12V10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                  {exportStatus === 'saved' ? 'Saved' : exportStatus === 'saving' ? 'Saving...' : 'Export'}
                </button>
              </>
            )}
          </div>
        </div>

        <div className="results-scroll">
          {state.status === 'idle' && (
            <div className="results-empty">
              <div className="results-empty-text">
                Waiting for input<span className="cursor-blink" />
              </div>
            </div>
          )}

          {(state.status === 'running' || state.status === 'streaming') && (
            <div className="results-empty">
              <span className="spinner" />
              {state.status === 'streaming' && state.chunks ? (
                <div className="stream-container" style={{ width: '100%' }}>
                  <div className="stream-header">Processing{isAllFilesMode ? ` ${projectFiles?.length} files` : ''}</div>
                  <div className="stream-text">{state.chunks}</div>
                </div>
              ) : (
                <div className="results-empty-text">Reviewing<span className="cursor-blink" /></div>
              )}
            </div>
          )}

          {state.status === 'error' && (
            <div className="error-banner">{state.message}</div>
          )}

          {state.status === 'done' && (
            <>
              <ReviewMetadata result={state.result} scoreTrend={scoreTrend} />
              {/* Score card */}
              <div className="summary-card">
                <div className="summary-top">
                  <div>
                    <div className="summary-label">Quality Score</div>
                    <div className="score-readout">
                      {state.result.score}
                      <span className="score-unit">/100</span>
                    </div>
                  </div>
                  {state.result.findings.length > 0 && (
                    <div
                      className="summary-pie"
                      aria-label="Severity breakdown"
                      title="Severity breakdown"
                      dangerouslySetInnerHTML={{
                        __html: toSeverityPieSVG(state.result.findings, { size: 56, innerRatio: 0.55 }),
                      }}
                    />
                  )}
                </div>
                <div className="score-bar-track">
                  <div
                    className="score-bar-fill"
                    style={{ width: `${state.result.score}%` }}
                  />
                </div>
                <div className="summary-text">{state.result.summary}</div>
              </div>

              {state.result.findings.length === 0 ? (
                <div className="no-issues">
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M2 6L5 9L10 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square"/>
                  </svg>
                  No issues found
                </div>
              ) : (
                <>
                  <div className="sev-filter-bar">
                    {ALL_SEVERITIES.map((sev) => {
                      const count = state.result.findings.filter((f) => f.severity === sev).length;
                      if (count === 0) return null;
                      return (
                        <button
                          key={sev}
                          className={`sev-filter-btn sev-${sev}${sevFilter.has(sev) ? ' active' : ''}`}
                          onClick={() => toggleSevFilter(sev)}
                        >
                          {sev} ({count})
                        </button>
                      );
                    })}
                  </div>
                  <div className="sev-filter-bar cat-filter-bar">
                    {ALL_CATEGORIES.map((cat) => {
                      const count = state.result.findings.filter((f) => f.category === cat).length;
                      if (count === 0) return null;
                      return (
                        <button
                          key={cat}
                          className={`sev-filter-btn cat-${cat}${catFilter.has(cat) ? ' active' : ''}`}
                          onClick={() => toggleCatFilter(cat)}
                        >
                          {cat} ({count})
                        </button>
                      );
                    })}
                  </div>
                  <div className="findings-search">
                    <input
                      type="search"
                      className="findings-search-input"
                      placeholder="Search findings…"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                    />
                    {(searchQuery || visibleFindings.length !== state.result.findings.length) && (
                      <span className="findings-search-count">
                        {visibleFindings.length}/{state.result.findings.length}
                      </span>
                    )}
                  </div>
                  <div className="ignore-pattern-row">
                    <input
                      type="text"
                      className="ignore-pattern-input"
                      placeholder="Ignore pattern (regex)…"
                      value={patternInput}
                      onChange={(e) => { setPatternInput(e.target.value); setPatternError(null); }}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddPattern(); } }}
                      aria-invalid={patternError !== null}
                    />
                    <button
                      className="btn-copy"
                      onClick={handleAddPattern}
                      disabled={!patternInput.trim()}
                      title="Add regex pattern to ignore matching findings"
                    >
                      Add
                    </button>
                  </div>
                  {patternError && (
                    <div className="ignore-pattern-error">{patternError}</div>
                  )}
                  {ignorePatterns.length > 0 && (
                    <div className="ignore-pattern-chips">
                      {ignorePatterns.map((p) => (
                        <span key={p} className="ignore-pattern-chip" title={`/${p}/i`}>
                          <code>{p}</code>
                          <button
                            type="button"
                            className="ignore-pattern-chip-remove"
                            onClick={() => handleRemovePattern(p)}
                            aria-label={`Remove pattern ${p}`}
                          >×</button>
                        </span>
                      ))}
                    </div>
                  )}
                  {visibleFindings.length === 0 && (
                    <div className="no-issues" style={{ opacity: 0.7 }}>
                      No findings match the current filter.
                    </div>
                  )}
                  {visibleFindings.map((f, i) => (
                    <FindingCard
                      key={f.id}
                      finding={f}
                      focused={i === focusedFindingIdx}
                      isNew={newFingerprints.has(findingFingerprint(f))}
                      onLineClick={handleLineClick}
                      onDismiss={handleDismissFinding}
                    />
                  ))}
                </>
              )}
            </>
          )}
        </div>
      </div>

      {showShortcuts && (
        <div
          className="shortcuts-overlay"
          role="dialog"
          aria-modal="true"
          onClick={() => setShowShortcuts(false)}
        >
          <div className="shortcuts-modal" onClick={(e) => e.stopPropagation()}>
            <div className="shortcuts-header">
              <span>Keyboard Shortcuts</span>
              <button
                className="btn-copy"
                onClick={() => setShowShortcuts(false)}
                aria-label="Close shortcuts"
              >
                ×
              </button>
            </div>
            <dl className="shortcuts-list">
              <div><dt><kbd>Ctrl</kbd>+<kbd>Enter</kbd></dt><dd>Run review</dd></div>
              <div><dt><kbd>Esc</kbd></dt><dd>Cancel running review / close this dialog</dd></div>
              <div><dt><kbd>j</kbd></dt><dd>Focus next finding</dd></div>
              <div><dt><kbd>k</kbd></dt><dd>Focus previous finding</dd></div>
              <div><dt><kbd>Enter</kbd></dt><dd>Jump to focused finding's line</dd></div>
              <div><dt><kbd>x</kbd></dt><dd>Dismiss focused finding</dd></div>
              <div><dt><kbd>/</kbd></dt><dd>Focus findings search</dd></div>
              <div><dt><kbd>n</kbd> / <kbd>N</kbd></dt><dd>Next / previous NEW finding (compare mode)</dd></div>
              <div><dt><kbd>?</kbd></dt><dd>Toggle this help</dd></div>
            </dl>
          </div>
        </div>
      )}

      {showDashboard && (
        <DashboardView
          history={history}
          onClose={() => setShowDashboard(false)}
          onOpenEntry={(entry) => {
            handleLoadHistory(entry);
            setShowDashboard(false);
          }}
        />
      )}

      {toasts.length > 0 && (
        <div className="toast-stack" role="status" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className={`toast toast-${t.kind}`}>
              <span className="toast-msg">{t.message}</span>
              <button
                className="toast-close"
                onClick={() => dismissToast(t.id)}
                aria-label="Dismiss notification"
              >×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
