import { ipcMain, dialog, BrowserWindow } from 'electron';
import fs from 'node:fs/promises';
import { watch, realpathSync, type FSWatcher } from 'node:fs';
import path from 'node:path';
import { ReviewEngine, sanitizeFinding } from '@code-review/core';
import type { ReviewRequest } from '@code-review/core';
import { saveKey, getKey, deleteKey, listProviders } from '../keys/safeStorage.js';
import { createProvider, testClaudeCode } from '../providers.js';
import { assertLocalUrl } from '../validation.js';
import { Channels } from './channels.js';
import {
  getSettings,
  updateSettings,
  setActiveProvider,
  setProviderModel,
  setOllamaUrl,
  resetSettings,
  addProject,
  removeProject,
  getProjects,
  type AppSettings,
} from '../settings/store.js';
import {
  getHistory,
  getHistoryEntry,
  addHistoryEntry,
  deleteHistoryEntry,
  clearHistory,
  type HistoryEntry,
} from '../settings/history.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum size of any single file read via app:readFiles (1 MiB). */
const MAX_FILE_BYTES = 1 * 1024 * 1024;

/** Maximum number of files returned by app:readFiles per call. */
const MAX_FILE_COUNT = 200;

/** Allowed provider names — must match createProvider's switch cases. */
const ALLOWED_PROVIDERS = new Set(['anthropic', 'openai', 'google', 'ollama', 'claude-code']);

/** Only allow these extensions to be read via app:readFiles. */
const ALLOWED_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.pyw', '.rs', '.go', '.java',
  '.cpp', '.cc', '.cxx', '.c++', '.h', '.hpp', '.c',
  '.cs', '.rb', '.php', '.swift', '.kt', '.kts',
  '.html', '.htm', '.css', '.scss', '.sass', '.less',
  '.json', '.yaml', '.yml', '.sh', '.bash', '.zsh', '.sql',
  '.md', '.txt', '.vue', '.svelte',
]);

/** Directories to skip when reading project files recursively. */
const IGNORED_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.turbo',
  '__pycache__',
  '.pytest_cache',
  'venv',
  '.venv',
  'env',
  '.env',
  'target',
  'vendor',
  'coverage',
  '.nyc_output',
  '.cache',
  'tmp',
  'temp',
  'logs',
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Validate that `name` is an allowed provider string. */
function assertProvider(name: unknown): asserts name is string {
  if (typeof name !== 'string' || !ALLOWED_PROVIDERS.has(name)) {
    throw new Error(`Invalid provider: ${JSON.stringify(name)}`);
  }
}

/**
 * Resolve `userPath` and verify it is strictly inside `base`.
 * Throws if the resolved path escapes `base` (path traversal guard).
 * Uses fs.realpathSync to resolve symlinks before the prefix check.
 */
function assertInsideBase(userPath: string, base: string): string {
  const resolved = path.resolve(userPath);
  let realResolved: string;
  let realBase: string;
  try {
    realResolved = realpathSync(resolved);
    realBase = realpathSync(path.resolve(base));
  } catch {
    throw new Error('Access denied: path is outside the selected folder');
  }
  if (process.platform === 'win32') {
    realResolved = realResolved.toLowerCase();
    realBase = realBase.toLowerCase();
  }
  if (realResolved !== realBase && !realResolved.startsWith(realBase + path.sep)) {
    throw new Error('Access denied: path is outside the selected folder');
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// Handler registration
// ---------------------------------------------------------------------------

async function buildEngine(request: ReviewRequest & { provider: string }): Promise<{ engine: ReviewEngine; reviewRequest: ReviewRequest }> {
  assertProvider(request?.provider);
  const { provider: providerName, ...reviewRequest } = request;
  const settings = await getSettings();
  const model = settings.providers[providerName]?.model;

  let apiKey: string | undefined;
  let token: string | undefined;
  if (providerName === 'claude-code') {
    apiKey = (await getKey('anthropic')) ?? undefined;
    token = (await getKey('claude-code')) ?? undefined;
  } else {
    apiKey = (await getKey(providerName)) ?? undefined;
  }

  const provider = createProvider(providerName, apiKey, {
    ...(model ? { model } : {}),
    ollamaUrl: settings.ollamaUrl,
    token,
    allowLan: settings.allowLanAccess,
  });
  return { engine: new ReviewEngine(provider), reviewRequest };
}

const approvedPaths = new Set<string>();

export async function registerHandlers(): Promise<void> {
  // Pre-populate approved paths before binding handlers to avoid race condition
  try {
    const projects = await getProjects();
    for (const p of projects) approvedPaths.add(path.resolve(p.path));
  } catch (err) {
    console.error('Failed to load persisted projects:', err);
  }
  // ── review:run ─────────────────────────────────────────────────────────────
  ipcMain.handle(Channels.REVIEW_RUN, async (_event, request: ReviewRequest & { provider: string }) => {
    const { engine, reviewRequest } = await buildEngine(request);
    return engine.review(reviewRequest);
  });

  // ── review:stream ──────────────────────────────────────────────────────────
  ipcMain.handle(Channels.REVIEW_STREAM, async (event, request: ReviewRequest & { provider: string }) => {
    const { engine, reviewRequest } = await buildEngine(request);

    try {
      const result = await engine.reviewStream(reviewRequest, (chunk: string) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send(Channels.REVIEW_STREAM_CHUNK, chunk);
        }
      });
      if (!event.sender.isDestroyed()) {
        event.sender.send(Channels.REVIEW_STREAM_DONE, result);
      }
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!event.sender.isDestroyed()) {
        event.sender.send(Channels.REVIEW_STREAM_ERROR, message);
      }
      throw err;
    }
  });

  // ── keys:save ──────────────────────────────────────────────────────────────
  ipcMain.handle(Channels.KEYS_SAVE, async (_event, provider: unknown, key: unknown) => {
    assertProvider(provider);
    if (typeof key !== 'string' || key.trim().length === 0) {
      throw new Error('API key must be a non-empty string');
    }
    await saveKey(provider, key.trim());
  });

  // ── keys:get ───────────────────────────────────────────────────────────────
  ipcMain.handle(Channels.KEYS_GET, async (_event, provider: unknown) => {
    assertProvider(provider);
    return await getKey(provider);
  });

  // ── keys:delete ────────────────────────────────────────────────────────────
  ipcMain.handle(Channels.KEYS_DELETE, async (_event, provider: unknown) => {
    assertProvider(provider);
    await deleteKey(provider);
  });

  // ── keys:list ──────────────────────────────────────────────────────────────
  ipcMain.handle(Channels.KEYS_LIST, async () => {
    return await listProviders();
  });

  // ── app:selectFolder ───────────────────────────────────────────────────────
  ipcMain.handle(Channels.APP_SELECT_FOLDER, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const selected = result.filePaths[0]!;
    approvedPaths.add(path.resolve(selected));
    return selected;
  });

  // ── app:readFiles ──────────────────────────────────────────────────────────
  // Only reads files inside the user-selected folder (path traversal guard),
  // only allows known text extensions, and caps individual file size.
  ipcMain.handle(
    Channels.APP_READ_FILES,
    async (_event, folderPath: unknown, extensions: unknown = []) => {
      if (typeof folderPath !== 'string' || folderPath.trim().length === 0) {
        throw new Error('folderPath must be a non-empty string');
      }

      // Validate the extensions array: only allow strings from ALLOWED_EXTENSIONS.
      const requestedExts: string[] = [];
      if (Array.isArray(extensions)) {
        for (const ext of extensions) {
          if (typeof ext !== 'string') continue;
          const normalised = ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
          if (ALLOWED_EXTENSIONS.has(normalised)) {
            requestedExts.push(normalised);
          }
        }
      }

      const resolvedFolder = path.resolve(folderPath.trim());
      if (!approvedPaths.has(resolvedFolder)) {
        throw new Error('Access denied: folder was not selected by the user');
      }

      const entries = await fs.readdir(resolvedFolder, { withFileTypes: true });

      // Collect eligible file paths first
      const candidates: Array<{ name: string; filePath: string }> = [];
      for (const entry of entries) {
        if (candidates.length >= MAX_FILE_COUNT) break;
        if (!entry.isFile()) continue;

        const ext = path.extname(entry.name).toLowerCase();
        if (requestedExts.length > 0) {
          if (!requestedExts.includes(ext)) continue;
        } else {
          if (!ALLOWED_EXTENSIONS.has(ext)) continue;
        }

        try {
          const filePath = assertInsideBase(path.join(resolvedFolder, entry.name), resolvedFolder);
          candidates.push({ name: entry.name, filePath });
        } catch {
          continue;
        }
      }

      // Read in parallel batches
      const BATCH_SIZE = 20;
      const files: Array<{ name: string; path: string; content: string }> = [];
      for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
        const batch = candidates.slice(i, i + BATCH_SIZE);
        const results = await Promise.all(batch.map(async ({ name, filePath }) => {
          try {
            const stat = await fs.stat(filePath);
            if (stat.size > MAX_FILE_BYTES) return null;
            const content = await fs.readFile(filePath, 'utf-8');
            return { name, path: filePath, content };
          } catch {
            return null;
          }
        }));
        for (const r of results) {
          if (r) files.push(r);
        }
      }

      return files;
    },
  );

  // ── settings:get ───────────────────────────────────────────────────────────
  ipcMain.handle(Channels.SETTINGS_GET, () => {
    return getSettings();
  });

  // ── settings:update ────────────────────────────────────────────────────────
  ipcMain.handle(Channels.SETTINGS_UPDATE, (_event, updates: Partial<AppSettings>) => {
    if (typeof updates !== 'object' || updates === null) {
      throw new Error('Updates must be an object');
    }
    const VALID_THEMES = new Set(['light', 'dark', 'system']);
    const sanitized: Partial<AppSettings> = {};
    if ('theme' in updates && typeof updates.theme === 'string' && VALID_THEMES.has(updates.theme)) {
      sanitized.theme = updates.theme as AppSettings['theme'];
    }
    if ('autoSaveHistory' in updates && typeof updates.autoSaveHistory === 'boolean') {
      sanitized.autoSaveHistory = updates.autoSaveHistory;
    }
    if ('defaultLanguage' in updates && typeof updates.defaultLanguage === 'string' && updates.defaultLanguage.trim().length > 0) {
      sanitized.defaultLanguage = updates.defaultLanguage.trim();
    }
    if ('allowLanAccess' in updates && typeof updates.allowLanAccess === 'boolean') {
      sanitized.allowLanAccess = updates.allowLanAccess;
    }
    return updateSettings(sanitized);
  });

  // ── settings:setProvider ───────────────────────────────────────────────────
  ipcMain.handle(Channels.SETTINGS_SET_PROVIDER, (_event, provider: unknown) => {
    assertProvider(provider);
    return setActiveProvider(provider);
  });

  // ── settings:setModel ──────────────────────────────────────────────────────
  ipcMain.handle(Channels.SETTINGS_SET_MODEL, (_event, provider: unknown, model: unknown) => {
    assertProvider(provider);
    if (typeof model !== 'string' || model.trim().length === 0) {
      throw new Error('Model must be a non-empty string');
    }
    return setProviderModel(provider, model.trim());
  });

  // ── settings:setOllamaUrl ──────────────────────────────────────────────────
  ipcMain.handle(Channels.SETTINGS_SET_OLLAMA_URL, async (_event, url: unknown) => {
    if (typeof url !== 'string' || url.trim().length === 0) {
      throw new Error('URL must be a non-empty string');
    }
    const settings = await getSettings();
    const validated = assertLocalUrl(url, settings.allowLanAccess);
    return setOllamaUrl(validated);
  });

  // ── settings:reset ─────────────────────────────────────────────────────────
  ipcMain.handle(Channels.SETTINGS_RESET, () => {
    return resetSettings();
  });

  // ── settings:import ───────────────────────────────────────────────────────
  ipcMain.handle(Channels.SETTINGS_IMPORT, async (_event, data: unknown) => {
    if (typeof data !== 'object' || data === null) {
      throw new Error('Import data must be an object');
    }
    const raw = data as Record<string, unknown>;
    const VALID_THEMES = new Set(['light', 'dark', 'system']);
    const sanitized: Partial<AppSettings> = {};

    if (typeof raw.activeProvider === 'string' && ALLOWED_PROVIDERS.has(raw.activeProvider)) {
      sanitized.activeProvider = raw.activeProvider;
    }
    if (typeof raw.theme === 'string' && VALID_THEMES.has(raw.theme)) {
      sanitized.theme = raw.theme as AppSettings['theme'];
    }
    if (typeof raw.ollamaUrl === 'string' && raw.ollamaUrl.trim().length > 0) {
      try {
        const currentSettings = await getSettings();
        sanitized.ollamaUrl = assertLocalUrl(raw.ollamaUrl, currentSettings.allowLanAccess);
      } catch {
        // skip invalid URL silently during import
      }
    }
    if (typeof raw.autoSaveHistory === 'boolean') {
      sanitized.autoSaveHistory = raw.autoSaveHistory;
    }
    if (typeof raw.defaultLanguage === 'string' && raw.defaultLanguage.trim().length > 0) {
      sanitized.defaultLanguage = raw.defaultLanguage.trim();
    }
    if (typeof raw.allowLanAccess === 'boolean') {
      sanitized.allowLanAccess = raw.allowLanAccess;
    }
    if (typeof raw.providers === 'object' && raw.providers !== null) {
      const validProviders: Record<string, { model: string; enabled: boolean }> = {};
      for (const [key, val] of Object.entries(raw.providers as Record<string, unknown>)) {
        if (typeof val !== 'object' || val === null) continue;
        const v = val as Record<string, unknown>;
        if (typeof v.model !== 'string' || typeof v.enabled !== 'boolean') continue;
        validProviders[key] = { model: v.model, enabled: v.enabled };
      }
      if (Object.keys(validProviders).length > 0) {
        sanitized.providers = validProviders;
      }
    }

    return updateSettings(sanitized);
  });

  // ── app:readProjectFiles ───────────────────────────────────────────────────
  // Recursively reads all code files in a project directory, skipping ignored dirs.
  ipcMain.handle(
    Channels.APP_READ_PROJECT_FILES,
    async (_event, folderPath: unknown) => {
      if (typeof folderPath !== 'string' || folderPath.trim().length === 0) {
        throw new Error('folderPath must be a non-empty string');
      }

      const resolvedFolder = path.resolve(folderPath.trim());
      if (!approvedPaths.has(resolvedFolder)) {
        throw new Error('Access denied: folder was not selected by the user');
      }
      const filePaths: Array<{ name: string; fullPath: string }> = [];

      const MAX_DEPTH = 20;

      async function walkDir(dir: string, depth = 0): Promise<void> {
        if (filePaths.length >= MAX_FILE_COUNT) return;
        if (depth >= MAX_DEPTH) return;

        let entries: import('node:fs').Dirent[];
        try {
          entries = await fs.readdir(dir, { withFileTypes: true }) as import('node:fs').Dirent[];
        } catch {
          return;
        }

        for (const entry of entries) {
          if (filePaths.length >= MAX_FILE_COUNT) break;

          const entryName = String(entry.name);
          const fullPath = path.join(dir, entryName);

          if (entry.isDirectory()) {
            if (IGNORED_DIRECTORIES.has(entryName.toLowerCase())) continue;
            if (entryName.startsWith('.') && entryName !== '.') continue;
            await walkDir(fullPath, depth + 1);
          } else if (entry.isFile()) {
            const ext = path.extname(entryName).toLowerCase();
            if (!ALLOWED_EXTENSIONS.has(ext)) continue;

            try {
              assertInsideBase(fullPath, resolvedFolder);
            } catch {
              continue;
            }

            filePaths.push({ name: entryName, fullPath });
          }
        }
      }

      await walkDir(resolvedFolder);

      // Read files in parallel batches
      const BATCH_SIZE = 20;
      const files: Array<{ name: string; path: string; relativePath: string; content: string }> = [];
      for (let i = 0; i < filePaths.length; i += BATCH_SIZE) {
        const batch = filePaths.slice(i, i + BATCH_SIZE);
        const results = await Promise.all(batch.map(async ({ name, fullPath }) => {
          try {
            const stat = await fs.stat(fullPath);
            if (stat.size > MAX_FILE_BYTES) return null;
            const content = await fs.readFile(fullPath, 'utf-8');
            const relativePath = path.relative(resolvedFolder, fullPath).replace(/\\/g, '/');
            return { name, path: fullPath, relativePath, content };
          } catch {
            return null;
          }
        }));
        for (const r of results) {
          if (r) files.push(r);
        }
      }
      return files;
    },
  );

  // ── app:exportReview ────────────────────────────────────────────────────────
  ipcMain.handle(Channels.APP_CONFIRM, async (event, message: unknown) => {
    if (typeof message !== 'string') throw new Error('message must be a string');
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return false;
    const { response } = await dialog.showMessageBox(win, {
      type: 'question',
      buttons: ['Cancel', 'Continue'],
      defaultId: 0,
      cancelId: 0,
      message,
    });
    return response === 1;
  });

  ipcMain.handle(
    Channels.APP_EXPORT_REVIEW,
    async (event, content: unknown, defaultFilename: unknown) => {
      if (typeof content !== 'string' || content.length === 0) {
        throw new Error('Export content must be a non-empty string');
      }
      const fname = typeof defaultFilename === 'string' ? defaultFilename : 'review.md';

      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) return false;

      const result = await dialog.showSaveDialog(win, {
        defaultPath: fname,
        filters: [
          { name: 'Markdown', extensions: ['md'] },
          { name: 'JSON', extensions: ['json'] },
          { name: 'Text', extensions: ['txt'] },
        ],
      });

      if (result.canceled || !result.filePath) return false;

      await fs.writeFile(result.filePath, content, 'utf-8');
      return true;
    },
  );

  // ── ollama:test ────────────────────────────────────────────────────────────
  ipcMain.handle(Channels.OLLAMA_TEST, async (_event, url: unknown) => {
    if (typeof url !== 'string' || url.trim().length === 0) {
      throw new Error('URL must be a non-empty string');
    }
    const settings = await getSettings();
    const trimmed = assertLocalUrl(url, settings.allowLanAccess);
    const res = await fetch(`${trimmed}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (text.length > 1024 * 1024) throw new Error('Response too large');
    const data = JSON.parse(text) as { models?: unknown[] };
    return { count: data.models?.length ?? 0 };
  });

  // ── claude-code:test ───────────────────────────────────────────────────────
  ipcMain.handle(Channels.CLAUDE_CODE_TEST, async () => {
    return testClaudeCode();
  });

  // ── project:add ────────────────────────────────────────────────────────────
  ipcMain.handle(Channels.PROJECT_ADD, (_event, name: unknown, projectPath: unknown) => {
    if (typeof name !== 'string' || name.trim().length === 0) {
      throw new Error('Project name must be a non-empty string');
    }
    if (typeof projectPath !== 'string' || projectPath.trim().length === 0) {
      throw new Error('Project path must be a non-empty string');
    }
    approvedPaths.add(path.resolve(projectPath.trim()));
    return addProject(name.trim(), projectPath.trim());
  });

  // ── project:remove ─────────────────────────────────────────────────────────
  ipcMain.handle(Channels.PROJECT_REMOVE, async (_event, projectId: unknown) => {
    if (typeof projectId !== 'string' || projectId.trim().length === 0) {
      throw new Error('Project ID must be a non-empty string');
    }
    const id = projectId.trim();
    const projects = await getProjects();
    const target = projects.find((p) => p.id === id);
    if (target) {
      approvedPaths.delete(path.resolve(target.path));
      // Stop any file watcher watching this project's directory
      for (const [wcId, state] of watcherState) {
        if (state.projectPath === path.resolve(target.path)) {
          cleanupWatcher(wcId);
        }
      }
    }
    return removeProject(id);
  });

  // ── project:list ───────────────────────────────────────────────────────────
  ipcMain.handle(Channels.PROJECT_LIST, () => {
    return getProjects();
  });

  // ── history:list ──────────────────────────────────────────────────────────
  ipcMain.handle(Channels.HISTORY_LIST, () => {
    return getHistory();
  });

  // ── history:get ───────────────────────────────────────────────────────────
  ipcMain.handle(Channels.HISTORY_GET, (_event, id: unknown) => {
    if (typeof id !== 'string') throw new Error('History ID must be a string');
    return getHistoryEntry(id);
  });

  // ── history:add ───────────────────────────────────────────────────────────
  ipcMain.handle(Channels.HISTORY_ADD, (_event, entry: unknown) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new Error('History entry must be an object');
    }
    const e = entry as Record<string, unknown>;
    if (typeof e.filename !== 'string') throw new Error('History entry: filename must be a string');
    if (typeof e.code !== 'string') throw new Error('History entry: code must be a string');
    if (e.code.length > MAX_FILE_BYTES) throw new Error('History entry: code exceeds maximum size');
    if (typeof e.provider !== 'string') throw new Error('History entry: provider must be a string');
    if (typeof e.model !== 'string') throw new Error('History entry: model must be a string');
    if (typeof e.language !== 'string') throw new Error('History entry: language must be a string');
    if (typeof e.score !== 'number') throw new Error('History entry: score must be a number');
    if (typeof e.summary !== 'string') throw new Error('History entry: summary must be a string');
    if (!Array.isArray(e.findings)) throw new Error('History entry: findings must be an array');
    e.findings = (e.findings as unknown[]).map((f, i) => sanitizeFinding(f, i));
    return addHistoryEntry(entry as Omit<HistoryEntry, 'id' | 'createdAt'>);
  });

  // ── history:delete ────────────────────────────────────────────────────────
  ipcMain.handle(Channels.HISTORY_DELETE, (_event, id: unknown) => {
    if (typeof id !== 'string') throw new Error('History ID must be a string');
    return deleteHistoryEntry(id);
  });

  // ── history:clear ─────────────────────────────────────────────────────────
  ipcMain.handle(Channels.HISTORY_CLEAR, () => {
    return clearHistory();
  });

  // ── app:watchProject / app:unwatchProject ─────────────────────────────────
  const watcherState = new Map<number, { watcher: FSWatcher; timer: ReturnType<typeof setTimeout> | null; projectPath: string }>();

  function cleanupWatcher(wcId: number) {
    const entry = watcherState.get(wcId);
    if (!entry) return;
    entry.watcher.close();
    if (entry.timer) clearTimeout(entry.timer);
    watcherState.delete(wcId);
  }

  ipcMain.handle(
    Channels.APP_WATCH_PROJECT,
    async (event, folderPath: unknown) => {
      if (typeof folderPath !== 'string' || folderPath.trim().length === 0) {
        throw new Error('folderPath must be a non-empty string');
      }

      const wcId = event.sender.id;

      // Clean up previous watcher for this window
      cleanupWatcher(wcId);

      const resolvedFolder = path.resolve(folderPath.trim());

      if (!approvedPaths.has(resolvedFolder)) {
        throw new Error('Access denied: folder was not selected by the user');
      }

      const stat = await fs.stat(resolvedFolder);
      if (!stat.isDirectory()) {
        throw new Error('Watch path is not a directory');
      }

      try {
        const watcher = watch(resolvedFolder, { recursive: true }, (_eventType, filename) => {
          if (!filename) return;

          const ext = path.extname(filename).toLowerCase();
          if (!ALLOWED_EXTENSIONS.has(ext)) return;

          const baseName = path.basename(filename);
          if (baseName.startsWith('.')) return;

          const segments = filename.replace(/\\/g, '/').split('/');
          const inIgnored = segments.some((s) => IGNORED_DIRECTORIES.has(s.toLowerCase()));
          if (inIgnored) return;

          const state = watcherState.get(wcId);
          if (!state) return;
          if (state.timer) clearTimeout(state.timer);
          state.timer = setTimeout(() => {
            state.timer = null;
            if (!event.sender.isDestroyed()) {
              event.sender.send(Channels.APP_PROJECT_FILES_CHANGED);
            }
          }, 400);
        });

        watcherState.set(wcId, { watcher, timer: null, projectPath: resolvedFolder });

        event.sender.once('destroyed', () => cleanupWatcher(wcId));
      } catch (err) {
        console.error('Failed to watch project directory:', err);
      }
    },
  );

  ipcMain.handle(Channels.APP_UNWATCH_PROJECT, (event) => {
    cleanupWatcher(event.sender.id);
  });
}
