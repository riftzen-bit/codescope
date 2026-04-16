import { useState, useEffect, useRef, useCallback } from 'react';
import { useReview } from '../hooks/useReview';
import { useDragDrop } from '../hooks/useDragDrop';
import { useHistoryPanel } from '../hooks/useHistoryPanel';
import { FindingCard } from './FindingCard';
import { CodeEditor } from './CodeEditor';
import { PROVIDER_CONFIGS } from './settings/providers';
import type { AppSettings, HistoryEntry, ProjectFile, ReviewResult, Severity } from '../types';

const ALL_SEVERITIES: Severity[] = ['critical', 'error', 'warning', 'info'];

const PROVIDERS = Object.keys(PROVIDER_CONFIGS) as Array<keyof typeof PROVIDER_CONFIGS>;

function ReviewMetadata({ result }: { result: ReviewResult }) {
  const items: Array<{ label: string; value: string }> = [
    { label: 'Provider', value: result.provider },
    { label: 'Model', value: result.model },
    { label: 'Language', value: result.language },
  ];
  if (result.tokensUsed) {
    items.push({ label: 'Tokens', value: `${result.tokensUsed.input}↑ ${result.tokensUsed.output}↓` });
  }
  return (
    <dl className="review-metadata">
      {items.map((item) => (
        <div key={item.label} className="review-metadata-item">
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
type Provider = keyof typeof PROVIDER_CONFIGS;

const MAX_REVIEW_CHARS = 200_000;

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

// Concatenate all project files into one code block
function concatenateProjectFiles(files: ProjectFile[]): string {
  const parts: string[] = [];

  for (const file of files) {
    parts.push(`// ═══════════════════════════════════════════════════════════════`);
    parts.push(`// FILE: ${file.relativePath}`);
    parts.push(`// ═══════════════════════════════════════════════════════════════`);
    parts.push('');
    parts.push(file.content);
    parts.push('');
    parts.push('');
  }

  return parts.join('\n');
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
  const [exportStatus, setExportStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [selectedFileIndex, setSelectedFileIndex] = useState(0);
  const [isAllFilesMode, setIsAllFilesMode] = useState(false);
  const [highlightLine, setHighlightLine] = useState<number | undefined>();
  const [highlightTrigger, setHighlightTrigger] = useState(0);
  const [sevFilter, setSevFilter] = useState<Set<Severity>>(new Set(ALL_SEVERITIES));
  const lastSavedRef = useRef<string | null>(null);
  const { state, run, reset, restore } = useReview();
  const { history, showHistory, addToHistory, deleteEntry: handleDeleteHistory, clearAll: clearHistory, toggle: toggleHistory, close: closeHistory } = useHistoryPanel();

  const onDropFile = useCallback((content: string, name: string) => {
    setCode(content);
    setFilename(name);
    reset();
  }, [reset]);
  const { isDragging, handleDrop } = useDragDrop(onDropFile);

  const containerRef = useRef<HTMLDivElement>(null);

  const isProjectMode = Boolean(projectFiles && projectFiles.length > 0);
  const [filesChanged, setFilesChanged] = useState(false);
  const [rescanning, setRescanning] = useState(false);

  // Start/stop file watcher when entering/leaving project mode
  useEffect(() => {
    if (!projectPath) return;

    window.api.watchProject(projectPath).catch((err) => {
      console.error('Failed to start file watcher:', err);
    });

    const unsub = window.api.onProjectFilesChanged(() => {
      setFilesChanged(true);
    });

    return () => {
      unsub();
      window.api.unwatchProject().catch((err) => console.error('Failed to stop file watcher:', err));
      setFilesChanged(false);
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

  // Auto-save completed reviews to history
  useEffect(() => {
    if (state.status !== 'done') return;
    const result = state.result;
    const key = `${result.provider}:${result.model}:${filename}:${result.score}:${result.summary.slice(0, 50)}`;
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
  }, [state, filename, code, addToHistory]);

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

  const isRunning = state.status === 'streaming' || state.status === 'running';

  function handleReview() {
    if (!code.trim()) return;
    run({ code, ...(filename ? { filename } : {}), provider });
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
    run({ code: allCode, filename: reviewFilename, provider });
  }, [projectFiles, projectName, provider, run]);

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

  const handleLoadHistory = useCallback((entry: HistoryEntry) => {
    setCode(entry.code);
    setFilename(entry.filename);
    closeHistory();
    lastSavedRef.current = `${entry.provider}:${entry.model}:${entry.filename}:${entry.score}:${entry.summary.slice(0, 50)}`;
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
    const text = formatResultForCopy(state.result, filename);
    const safeName = (filename || 'review').replace(/[^a-zA-Z0-9._-]/g, '_');
    const defaultFilename = `${safeName}-review.md`;

    try {
      const saved = await window.api.exportReview(text, defaultFilename);
      if (saved) {
        setExportStatus('saved');
        setTimeout(() => setExportStatus('idle'), 2000);
      } else {
        setExportStatus('idle');
      }
    } catch {
      setExportStatus('idle');
    }
  }, [state, filename]);


  const handleLineClick = useCallback((line: number) => {
    setHighlightLine(line);
    setHighlightTrigger((t) => t + 1);
  }, []);

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

  const charCount = code.length;
  const lineCount = code ? code.split('\n').length : 0;

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
        </div>

        <div className="toolbar-right">
          {state.status === 'done' && (
            <ReviewMetadata result={state.result} />
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

          {state.status !== 'idle' && (
            <button className="btn btn-sm" onClick={reset}>
              Clear
            </button>
          )}

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
        <div className="pane-header">
          <span className="pane-label">
            <span className="pane-label-accent">01</span> &nbsp;SOURCE
            {isProjectMode && filename && (
              <span className="pane-filename">{filename}</span>
            )}
          </span>
          <span className="pane-meta">
            {lineCount > 0 ? `${lineCount}L · ${charCount}C` : 'EMPTY'}
          </span>
        </div>
        <div className="code-editor-wrap">
          <CodeEditor
            value={code}
            onChange={setCode}
            {...(isAllFilesMode ? {} : { filename })}
            onCtrlEnter={handleReview}
            {...(highlightLine != null ? { highlightLine, highlightTrigger } : {})}
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
            <span className="pane-label-accent">02</span> &nbsp;FINDINGS
          </span>
          <div className="results-header-actions">
            {state.status === 'done' && (
              <>
                <span className="results-count">
                  {state.result.findings.length} ISSUE{state.result.findings.length !== 1 ? 'S' : ''}
                </span>
                <button
                  className={`btn-copy${copyStatus === 'copied' ? ' copied' : ''}`}
                  onClick={handleCopyAll}
                  title="Copy all findings"
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
                  className={`btn-copy${exportStatus === 'saved' ? ' copied' : ''}`}
                  onClick={handleExport}
                  disabled={exportStatus === 'saving'}
                  title="Export review to file"
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
                AWAITING INPUT<span className="cursor-blink" />
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
                <div className="results-empty-text">RUNNING<span className="cursor-blink" /></div>
              )}
            </div>
          )}

          {state.status === 'error' && (
            <div className="error-banner">{state.message}</div>
          )}

          {state.status === 'done' && (
            <>
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
                  ALL CLEAR — NO ISSUES DETECTED
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
                  {state.result.findings
                    .filter((f) => sevFilter.has(f.severity))
                    .map((f) => (
                      <FindingCard
                        key={f.id}
                        finding={f}
                        onLineClick={handleLineClick}
                      />
                    ))}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
