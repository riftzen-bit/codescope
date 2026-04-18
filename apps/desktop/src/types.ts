// Shared types for the renderer. Review-domain types are re-exported from
// @code-review/core so there is a single source of truth; renderer-only shapes
// (Electron bridge, project files, settings, history) stay local.

import type { Finding, ReviewRequest, ReviewResult } from '@code-review/core';

export type {
  Severity,
  Category,
  Finding,
  ReviewRequest,
  ReviewResult,
} from '@code-review/core';

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
  styleProfile: string;
  redactSecretsBeforeSend: boolean;
  version: number;
}

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

export interface ProjectFilesResult {
  files: ProjectFile[];
  truncated: boolean;
  limit: number;
  totalFound: number;
}

export interface ElectronAPI {
  reviewRun(req: ReviewRequest & { provider: string }): Promise<ReviewResult>;
  reviewStream(
    req: ReviewRequest & { provider: string },
    onChunk: (text: string) => void,
    onDone: (result: ReviewResult) => void,
    onError: (err: string) => void,
  ): () => void;
  reviewCancel(): Promise<void>;

  keysSave(provider: string, key: string): Promise<void>;
  keysGet(provider: string): Promise<string | null>;
  keysDelete(provider: string): Promise<void>;
  keysList(): Promise<string[]>;

  ollamaTest(url: string): Promise<{ count: number }>;
  claudeCodeTest(): Promise<{ installed: boolean; version: string }>;

  selectFolder(): Promise<string | null>;
  readFiles(
    folderPath: string,
    extensions?: string[],
  ): Promise<Array<{ name: string; path: string; content: string }>>;
  readProjectFiles(folderPath: string): Promise<ProjectFilesResult>;

  watchProject(folderPath: string): Promise<void>;
  unwatchProject(): Promise<void>;
  onProjectFilesChanged(callback: (changedPath: string | null) => void): () => void;

  confirm(message: string): Promise<boolean>;
  exportReview(content: string, defaultFilename?: string): Promise<boolean>;

  historyList(): Promise<HistoryEntry[]>;
  historyGet(id: string): Promise<HistoryEntry | null>;
  historyAdd(entry: Omit<HistoryEntry, 'id' | 'createdAt'>): Promise<HistoryEntry>;
  historyDelete(id: string): Promise<void>;
  historyClear(): Promise<void>;

  projectAdd(name: string, path: string): Promise<AppSettings>;
  projectRemove(projectId: string): Promise<AppSettings>;
  projectList(): Promise<ProjectInfo[]>;

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
