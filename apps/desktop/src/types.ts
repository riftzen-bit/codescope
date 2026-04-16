// Re-export shared types used in renderer.
// These mirror @code-review/core types — kept local to avoid importing Node-only
// packages in the renderer bundle. Changes to Finding, ReviewResult, HistoryEntry
// etc. in packages/core must be synced here manually.
// TODO: extract a shared types-only package (no Node deps) to eliminate duplication.

// ── Settings types ───────────────────────────────────────────────────────────

export interface ProviderSettings {
  model: string;
  enabled: boolean;
}

export interface ProjectInfo {
  id: string;
  name: string;
  path: string;
  addedAt: number;
}

export interface ProjectFile {
  name: string;
  path: string;
  relativePath: string;
  content: string;
}

export interface AppSettings {
  activeProvider: string;
  providers: Record<string, ProviderSettings>;
  ollamaUrl: string;
  theme: 'light' | 'dark' | 'system';
  projects: ProjectInfo[];
  autoSaveHistory: boolean;
  defaultLanguage: string;
  allowLanAccess: boolean;
  version: number;
}

// ── Review types ─────────────────────────────────────────────────────────────

export type Severity = 'critical' | 'error' | 'warning' | 'info';

export type Category =
  | 'security'
  | 'performance'
  | 'correctness'
  | 'maintainability'
  | 'style'
  | 'other';

export interface Finding {
  id: string;
  severity: Severity;
  category: Category;
  line?: number;
  title: string;
  description: string;
  suggestion: string;
}

export interface ReviewResult {
  summary: string;
  score: number;
  findings: Finding[];
  language: string;
  provider: string;
  model: string;
  tokensUsed?: {
    input: number;
    output: number;
  };
}

export interface ReviewRequest {
  code: string;
  filename?: string;
  language?: string;
  rules?: string[];
  provider: string;
}

// ── History types ─────────────────────────────────────────────────────────

export interface HistoryEntry {
  id: string;
  filename: string;
  code: string;
  provider: string;
  model: string;
  language: string;
  score: number;
  summary: string;
  findings: Finding[];
  tokensUsed?: { input: number; output: number };
  createdAt: number;
}

// IPC window.api shape exposed by the preload script
export interface ElectronAPI {
  // Review
  reviewRun(req: ReviewRequest): Promise<ReviewResult>;
  reviewStream(
    req: ReviewRequest,
    onChunk: (text: string) => void,
    onDone: (result: ReviewResult) => void,
    onError: (err: string) => void,
  ): () => void; // returns unsubscribe

  // API Keys
  keysSave(provider: string, key: string): Promise<void>;
  keysGet(provider: string): Promise<string | null>;
  keysDelete(provider: string): Promise<void>;
  keysList(): Promise<string[]>;

  // Ollama
  ollamaTest(url: string): Promise<{ count: number }>;

  // Claude Code
  claudeCodeTest(): Promise<{ installed: boolean; version: string }>;

  // File system
  selectFolder(): Promise<string | null>;
  readFiles(
    folderPath: string,
    extensions?: string[],
  ): Promise<Array<{ name: string; path: string; content: string }>>;
  readProjectFiles(folderPath: string): Promise<ProjectFile[]>;

  // File watching
  watchProject(folderPath: string): Promise<void>;
  unwatchProject(): Promise<void>;
  onProjectFilesChanged(callback: () => void): () => void;

  // Confirm dialog
  confirm(message: string): Promise<boolean>;

  // Export
  exportReview(content: string, defaultFilename?: string): Promise<boolean>;

  // History
  historyList(): Promise<HistoryEntry[]>;
  historyGet(id: string): Promise<HistoryEntry | null>;
  historyAdd(entry: Omit<HistoryEntry, 'id' | 'createdAt'>): Promise<HistoryEntry>;
  historyDelete(id: string): Promise<void>;
  historyClear(): Promise<void>;

  // Projects
  projectAdd(name: string, path: string): Promise<AppSettings>;
  projectRemove(projectId: string): Promise<AppSettings>;
  projectList(): Promise<ProjectInfo[]>;

  // Settings
  settingsGet(): Promise<AppSettings>;
  settingsUpdate(updates: Partial<AppSettings>): Promise<AppSettings>;
  settingsSetProvider(provider: string): Promise<AppSettings>;
  settingsSetModel(provider: string, model: string): Promise<AppSettings>;
  settingsSetOllamaUrl(url: string): Promise<AppSettings>;
  settingsReset(): Promise<AppSettings>;
  settingsImport(data: Partial<AppSettings>): Promise<AppSettings>;
}

declare global {
  interface Window {
    api: ElectronAPI;
  }
}
