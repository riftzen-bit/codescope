import Editor, { OnMount, loader } from '@monaco-editor/react';
import { useRef, useCallback, useEffect, useState } from 'react';
import * as monaco from 'monaco-editor';

// Configure Monaco to load from node_modules instead of CDN
loader.config({ monaco });

interface Props {
  value: string;
  onChange: (value: string) => void;
  filename?: string;
  onCtrlEnter?: () => void;
  highlightLine?: number;
  highlightTrigger?: number;
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

export function CodeEditor({ value, onChange, filename, onCtrlEnter, highlightLine, highlightTrigger }: Props) {
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const decorationsCollRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isDark, setIsDark] = useState(() =>
    document.documentElement.getAttribute('data-theme') === 'dark',
  );

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.getAttribute('data-theme') === 'dark');
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !highlightLine) {
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

  const language = filename ? getLanguageFromFilename(filename) : 'plaintext';

  useEffect(() => {
    loader.init().then(() => setIsReady(true));
  }, []);

  const handleMount: OnMount = useCallback((editor, monacoInstance) => {
    editorRef.current = editor;

    // Add Ctrl+Enter keybinding
    if (onCtrlEnter) {
      editor.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.Enter, () => {
        onCtrlEnter();
      });
    }

    // Focus editor
    editor.focus();
  }, [onCtrlEnter]);

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
      theme={isDark ? 'vs-dark' : 'vs'}
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
