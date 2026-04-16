import { contextBridge, ipcRenderer } from 'electron';
import { Channels } from '../main/ipc/channels.js';
import type { ReviewRequest, ReviewResult } from '@code-review/core';
import type { AppSettings } from '../main/settings/store.js';
import type { HistoryEntry } from '../main/settings/history.js';

contextBridge.exposeInMainWorld('api', {
  reviewRun(request: ReviewRequest & { provider: string }): Promise<ReviewResult> {
    return ipcRenderer.invoke(Channels.REVIEW_RUN, request);
  },
  reviewStream(
    request: ReviewRequest & { provider: string },
    onChunk: (chunk: string) => void,
    onDone: (result: ReviewResult) => void,
    onError: (message: string) => void,
  ): () => void {
    const chunkListener = (_e: Electron.IpcRendererEvent, chunk: string) => onChunk(chunk);
    const doneListener = (_e: Electron.IpcRendererEvent, result: ReviewResult) => {
      cleanup();
      onDone(result);
    };
    const errorListener = (_e: Electron.IpcRendererEvent, message: string) => {
      cleanup();
      onError(message);
    };

    function cleanup() {
      ipcRenderer.removeListener(Channels.REVIEW_STREAM_CHUNK, chunkListener);
      ipcRenderer.removeListener(Channels.REVIEW_STREAM_DONE, doneListener);
      ipcRenderer.removeListener(Channels.REVIEW_STREAM_ERROR, errorListener);
    }

    ipcRenderer.on(Channels.REVIEW_STREAM_CHUNK, chunkListener);
    ipcRenderer.on(Channels.REVIEW_STREAM_DONE, doneListener);
    ipcRenderer.on(Channels.REVIEW_STREAM_ERROR, errorListener);

    ipcRenderer.invoke(Channels.REVIEW_STREAM, request).catch((err: unknown) => {
      cleanup();
      onError(err instanceof Error ? err.message : String(err));
    });

    return cleanup;
  },
  keysSave(provider: string, key: string): Promise<void> {
    return ipcRenderer.invoke(Channels.KEYS_SAVE, provider, key);
  },
  keysGet(provider: string): Promise<string | null> {
    return ipcRenderer.invoke(Channels.KEYS_GET, provider);
  },
  keysDelete(provider: string): Promise<void> {
    return ipcRenderer.invoke(Channels.KEYS_DELETE, provider);
  },
  keysList(): Promise<string[]> {
    return ipcRenderer.invoke(Channels.KEYS_LIST);
  },
  selectFolder(): Promise<string | null> {
    return ipcRenderer.invoke(Channels.APP_SELECT_FOLDER);
  },
  readFiles(folderPath: string, extensions?: string[]): Promise<Array<{ name: string; path: string; content: string }>> {
    return ipcRenderer.invoke(Channels.APP_READ_FILES, folderPath, extensions);
  },
  readProjectFiles(folderPath: string): Promise<Array<{ name: string; path: string; relativePath: string; content: string }>> {
    return ipcRenderer.invoke(Channels.APP_READ_PROJECT_FILES, folderPath);
  },

  // File watching
  watchProject(folderPath: string): Promise<void> {
    return ipcRenderer.invoke(Channels.APP_WATCH_PROJECT, folderPath);
  },
  unwatchProject(): Promise<void> {
    return ipcRenderer.invoke(Channels.APP_UNWATCH_PROJECT);
  },
  onProjectFilesChanged(callback: () => void): () => void {
    const listener = () => callback();
    ipcRenderer.on(Channels.APP_PROJECT_FILES_CHANGED, listener);
    return () => {
      ipcRenderer.removeListener(Channels.APP_PROJECT_FILES_CHANGED, listener);
    };
  },

  // Ollama
  ollamaTest(url: string): Promise<{ count: number }> {
    return ipcRenderer.invoke(Channels.OLLAMA_TEST, url);
  },

  // Claude Code
  claudeCodeTest(): Promise<{ installed: boolean; version: string }> {
    return ipcRenderer.invoke(Channels.CLAUDE_CODE_TEST);
  },

  // Confirm dialog
  confirm(message: string): Promise<boolean> {
    return ipcRenderer.invoke(Channels.APP_CONFIRM, message);
  },

  // Export
  exportReview(content: string, defaultFilename?: string): Promise<boolean> {
    return ipcRenderer.invoke(Channels.APP_EXPORT_REVIEW, content, defaultFilename);
  },

  // Projects
  projectAdd(name: string, path: string): Promise<AppSettings> {
    return ipcRenderer.invoke(Channels.PROJECT_ADD, name, path);
  },
  projectRemove(projectId: string): Promise<AppSettings> {
    return ipcRenderer.invoke(Channels.PROJECT_REMOVE, projectId);
  },
  projectList(): Promise<Array<{ id: string; name: string; path: string; addedAt: number }>> {
    return ipcRenderer.invoke(Channels.PROJECT_LIST);
  },

  // History
  historyList(): Promise<HistoryEntry[]> {
    return ipcRenderer.invoke(Channels.HISTORY_LIST);
  },
  historyGet(id: string): Promise<HistoryEntry | null> {
    return ipcRenderer.invoke(Channels.HISTORY_GET, id);
  },
  historyAdd(entry: Omit<HistoryEntry, 'id' | 'createdAt'>): Promise<HistoryEntry> {
    return ipcRenderer.invoke(Channels.HISTORY_ADD, entry);
  },
  historyDelete(id: string): Promise<void> {
    return ipcRenderer.invoke(Channels.HISTORY_DELETE, id);
  },
  historyClear(): Promise<void> {
    return ipcRenderer.invoke(Channels.HISTORY_CLEAR);
  },

  // Settings
  settingsGet(): Promise<AppSettings> {
    return ipcRenderer.invoke(Channels.SETTINGS_GET);
  },
  settingsUpdate(updates: Partial<AppSettings>): Promise<AppSettings> {
    return ipcRenderer.invoke(Channels.SETTINGS_UPDATE, updates);
  },
  settingsSetProvider(provider: string): Promise<AppSettings> {
    return ipcRenderer.invoke(Channels.SETTINGS_SET_PROVIDER, provider);
  },
  settingsSetModel(provider: string, model: string): Promise<AppSettings> {
    return ipcRenderer.invoke(Channels.SETTINGS_SET_MODEL, provider, model);
  },
  settingsSetOllamaUrl(url: string): Promise<AppSettings> {
    return ipcRenderer.invoke(Channels.SETTINGS_SET_OLLAMA_URL, url);
  },
  settingsReset(): Promise<AppSettings> {
    return ipcRenderer.invoke(Channels.SETTINGS_RESET);
  },
  settingsImport(data: Partial<AppSettings>): Promise<AppSettings> {
    return ipcRenderer.invoke(Channels.SETTINGS_IMPORT, data);
  },
});
