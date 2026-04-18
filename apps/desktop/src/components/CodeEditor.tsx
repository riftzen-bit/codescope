import Editor, { OnMount, loader } from '@monaco-editor/react';
import { useRef, useCallback, useEffect, useState } from 'react';
import * as monaco from 'monaco-editor';
import type { Finding, Severity } from '@code-review/core';

// Configure Monaco to load from node_modules instead of CDN
loader.config({ monaco });

// Register custom themes at module scope so they exist before any <Editor>
// mounts with a theme prop that references them. If registration is deferred
// to onMount, Monaco's initial setTheme call falls back to the default (white)
// theme in dark mode. Tracked per monaco instance because @monaco-editor/react's
// loader may hand onMount a different namespace than the bundled import.
const themedInstances = new WeakSet<typeof monaco>();
function registerThemes(m: typeof monaco) {
  if (themedInstances.has(m)) return;
  themedInstances.add(m);
  // Hex values track the CSS token layer in globals.css so the editor
  // background/cursor/selection stay flush with the app shell. If you
  // retune --bg, --accent, or --text in globals.css, update the matching
  // Monaco keys below in the same commit.
  m.editor.defineTheme('codescope-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#17131B',
      'editor.foreground': '#F1EBE2',
      'editor.lineHighlightBackground': '#1D1823',
      'editor.lineHighlightBorder': '#00000000',
      'editorLineNumber.foreground': '#6E6358',
      'editorLineNumber.activeForeground': '#E89A3C',
      'editorCursor.foreground': '#E89A3C',
      'editor.selectionBackground': '#E89A3C33',
      'editor.inactiveSelectionBackground': '#E89A3C1A',
      'editorIndentGuide.background': '#2A2430',
      'editorIndentGuide.activeBackground': '#3D3542',
      'editorGutter.background': '#17131B',
      'editorWidget.background': '#24202C',
      'editorWidget.border': '#3D3542',
      'editorSuggestWidget.background': '#24202C',
      'editorSuggestWidget.border': '#3D3542',
      'editorSuggestWidget.selectedBackground': '#312A38',
      'scrollbarSlider.background': '#6E635855',
      'scrollbarSlider.hoverBackground': '#877C7188',
      'scrollbarSlider.activeBackground': '#E89A3CAA',
    },
  });

  m.editor.defineTheme('codescope-light', {
    base: 'vs',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#F5EDDD',
      'editor.foreground': '#2B1F18',
      'editor.lineHighlightBackground': '#EDE3CE',
      'editorLineNumber.foreground': '#A89680',
      'editorLineNumber.activeForeground': '#B35E1A',
      'editorCursor.foreground': '#B35E1A',
      'editor.selectionBackground': '#B35E1A26',
      'editor.inactiveSelectionBackground': '#B35E1A14',
      'editorIndentGuide.background': '#DDD2BA',
      'editorIndentGuide.activeBackground': '#C7B998',
      'editorGutter.background': '#F5EDDD',
      'editorWidget.background': '#EDE3CE',
      'editorWidget.border': '#C7B998',
      'editorSuggestWidget.background': '#EDE3CE',
      'editorSuggestWidget.border': '#C7B998',
      'editorSuggestWidget.selectedBackground': '#DDD2BA',
      'scrollbarSlider.background': '#A8968055',
      'scrollbarSlider.hoverBackground': '#88765F88',
      'scrollbarSlider.activeBackground': '#B35E1AAA',
    },
  });
}

// Register immediately with the bundled monaco namespace so themes are ready
// before React renders the <Editor>.
registerThemes(monaco);

interface Props {
  value: string;
  onChange: (value: string) => void;
  filename?: string;
  onCtrlEnter?: () => void;
  highlightLine?: number;
  highlightTrigger?: number;
  findings?: readonly Finding[];
  onFindingClick?: (finding: Finding) => void;
}

// Map file extensions to Monaco language IDs
function getLanguageFromFilename(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    py: 'python',
    pyw: 'python',
    rs: 'rust',
    go: 'go',
    java: 'java',
    cpp: 'cpp',
    cc: 'cpp',
    cxx: 'cpp',
    'c++': 'cpp',
    c: 'c',
    h: 'c',
    hpp: 'cpp',
    cs: 'csharp',
    rb: 'ruby',
    php: 'php',
    swift: 'swift',
    kt: 'kotlin',
    kts: 'kotlin',
    html: 'html',
    htm: 'html',
    css: 'css',
    scss: 'scss',
    sass: 'scss',
    less: 'less',
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    xml: 'xml',
    md: 'markdown',
    txt: 'plaintext',
    sql: 'sql',
    sh: 'shell',
    bash: 'shell',
    zsh: 'shell',
    ps1: 'powershell',
    vue: 'html',
    svelte: 'html',
  };
  return map[ext] || 'plaintext';
}

const SEV_RANK: Record<Severity, number> = { critical: 0, error: 1, warning: 2, info: 3 };

export function CodeEditor({ value, onChange, filename, onCtrlEnter, highlightLine, highlightTrigger, findings, onFindingClick }: Props) {
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const decorationsCollRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
  const findingsCollRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
  const clickDisposerRef = useRef<monaco.IDisposable | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isDark, setIsDark] = useState(() =>
    document.documentElement.getAttribute('data-theme') === 'dark',
  );

  useEffect(() => {
    // Re-sync after mount: App.tsx applies data-theme in its own useEffect, which
    // may run after CodeEditor's useState initializer captured the attribute.
    setIsDark(document.documentElement.getAttribute('data-theme') === 'dark');
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.getAttribute('data-theme') === 'dark');
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || highlightLine == null || highlightLine < 1) {
      decorationsCollRef.current?.clear();
      return;
    }
    editor.revealLineInCenter(highlightLine);
    const decorations = [{
      range: new monaco.Range(highlightLine, 1, highlightLine, 1),
      options: {
        isWholeLine: true,
        className: 'highlight-line',
        glyphMarginClassName: 'highlight-line-glyph',
      },
    }];
    if (decorationsCollRef.current) {
      decorationsCollRef.current.set(decorations);
    } else {
      decorationsCollRef.current = editor.createDecorationsCollection(decorations);
    }
  }, [highlightLine, highlightTrigger]);

  // Findings → gutter markers. Keep the highest-severity decoration per line
  // (same line may have multiple findings).
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const coll = findingsCollRef.current ?? editor.createDecorationsCollection([]);
    findingsCollRef.current = coll;

    if (!findings || findings.length === 0) {
      coll.clear();
      return;
    }

    const byLine = new Map<number, Finding>();
    for (const f of findings) {
      if (f.line === undefined || f.line < 1) continue;
      const prev = byLine.get(f.line);
      if (!prev || SEV_RANK[f.severity] < SEV_RANK[prev.severity]) byLine.set(f.line, f);
    }

    const decorations: monaco.editor.IModelDeltaDecoration[] = [];
    for (const [line, f] of byLine) {
      decorations.push({
        range: new monaco.Range(line, 1, line, 1),
        options: {
          isWholeLine: true,
          className: `finding-line finding-line-${f.severity}`,
          glyphMarginClassName: `finding-gutter finding-gutter-${f.severity}`,
          glyphMarginHoverMessage: {
            value: `**${f.severity.toUpperCase()}** · ${f.title}\n\n${f.description}`,
          },
          overviewRuler: {
            position: monaco.editor.OverviewRulerLane.Right,
            color:
              f.severity === 'critical' || f.severity === 'error'
                ? (isDark ? '#DC6D6D' : '#9C2F2F')
              : f.severity === 'warning'
                ? (isDark ? '#E89A3C' : '#B35E1A')
              : (isDark ? '#8FA7BD' : '#425B73'),
          },
        },
      });
    }
    coll.set(decorations);
  }, [findings, isDark]);

  // Clicking a glyph → onFindingClick. Monaco gives us the target type so we
  // only react to glyph-margin clicks, not regular code clicks.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !onFindingClick || !findings) return;
    clickDisposerRef.current?.dispose();
    const disp = editor.onMouseDown((e) => {
      if (e.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) return;
      const ln = e.target.position?.lineNumber;
      if (ln == null) return;
      const hit = findings.find((f) => f.line === ln);
      if (hit) onFindingClick(hit);
    });
    clickDisposerRef.current = disp;
    return () => {
      disp.dispose();
      clickDisposerRef.current = null;
    };
  }, [findings, onFindingClick]);

  const language = filename ? getLanguageFromFilename(filename) : 'plaintext';

  useEffect(() => {
    loader.init().then(() => setIsReady(true));
  }, []);

  const handleMount: OnMount = useCallback((editor, monacoInstance) => {
    editorRef.current = editor;

    // Ensure themes are registered on the monaco instance the editor is using
    // (the loader's instance may differ from the bundled import).
    registerThemes(monacoInstance);
    monacoInstance.editor.setTheme(isDark ? 'codescope-dark' : 'codescope-light');

    if (onCtrlEnter) {
      editor.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.Enter, () => {
        onCtrlEnter();
      });
    }

    editor.focus();
  }, [onCtrlEnter, isDark]);

  const handleChange = useCallback((val: string | undefined) => {
    onChange(val ?? '');
  }, [onChange]);

  if (!isReady) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        color: 'var(--text-tertiary)',
        fontFamily: 'var(--font-mono)',
        fontSize: '12px'
      }}>
        Initializing editor...
      </div>
    );
  }

  return (
    <Editor
      height="100%"
      language={language}
      value={value}
      onChange={handleChange}
      onMount={handleMount}
      theme={isDark ? 'codescope-dark' : 'codescope-light'}
      loading={
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: 'var(--text-tertiary)',
          fontFamily: 'var(--font-mono)',
          fontSize: '12px'
        }}>
          Loading editor...
        </div>
      }
      options={{
        fontSize: 13,
        fontFamily: "'SF Mono', 'Cascadia Code', Consolas, 'Liberation Mono', monospace",
        lineHeight: 22,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        padding: { top: 16, bottom: 16 },
        lineNumbers: 'on',
        glyphMargin: true,
        renderLineHighlight: 'line',
        tabSize: 2,
        automaticLayout: true,
        wordWrap: 'on',
        scrollbar: {
          verticalScrollbarSize: 6,
          horizontalScrollbarSize: 6,
        },
        overviewRulerBorder: false,
        hideCursorInOverviewRuler: true,
        overviewRulerLanes: 0,
        folding: true,
        lineDecorationsWidth: 8,
        lineNumbersMinChars: 4,
        dragAndDrop: false,
        dropIntoEditor: { enabled: false },
      }}
    />
  );
}
