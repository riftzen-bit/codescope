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
  ALLOWED_PROVIDERS,
  MAX_STYLE_PROFILE_CHARS,
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

/** Maximum number of files returned by app:readProjectFiles (recursive scan). */
const PROJECT_MAX_FILES = 500;

/**
 * Upper bound on `entry.code` length (UTF-16 code units, i.e. `string.length`)
 * accepted by history:add. Project-mode reviews concatenate every scanned
 * file, so this is a separate, larger cap than the per-file read limit.
 *
 * NAMED IN CHARS, NOT BYTES: `code.length` counts UTF-16 code units, not
 * bytes, so CJK/emoji-heavy code will serialize to roughly 2–3× this value
 * on disk. Treat the constant as a user-perceived size hint, not a byte
 * guarantee. Truncation also snaps back one unit if it would split a
 * surrogate pair, so we never emit invalid UTF-16.
 */
const MAX_HISTORY_CODE_CHARS = 10 * 1024 * 1024;

/** Upper bound on poller-mode project watcher snapshots. */
const MAX_POLL_FILES = 5000;

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
 *
 * NOTE: `realpathSync` requires both `userPath` and `base` to EXIST on disk;
 * it throws ENOENT otherwise. All current callers pass paths to existing
 * files or directories. If a future caller needs to validate an "about to
 * be created" path, resolve the parent directory with this helper and append
 * the basename after the check.
 */
function assertInsideBase(userPath: string, base: string): string {
  const resolved = path.resolve(userPath);
  let realBase: string;
  try {
    realBase = realpathSync(path.resolve(base));
  } catch {
    throw new Error('Access denied: path is outside the selected folder');
  }
  return assertInsideBaseResolved(resolved, realBase);
}

/**
 * Hot-loop variant: caller has already resolved `realBase` once for the
 * whole walk and passes it in, so we skip the second realpathSync that
 * `assertInsideBase` runs per call. On a 500-file project that halves the
 * per-entry syscall cost; on a Windows network share it is the difference
 * between responsive and frozen. `preResolvedBase` MUST come from
 * `realpathSync` (or an equivalent symlink-resolved form) — a plain
 * `path.resolve(base)` is not sufficient since a symlinked base would
 * false-negative against its resolved children.
 *
 * Pass `isSymlink: false` (from `dirent.isSymbolicLink()`) when the caller
 * already knows the entry is a regular file or directory. We then skip
 * realpathSync entirely and rely on plain prefix comparison. This is a
 * ~2× speedup on large trees where the vast majority of entries are not
 * symlinks. When the flag is omitted we default to the safe-but-slow path
 * so existing non-dirent callers are unaffected.
 */
function assertInsideBaseResolved(
  userPath: string,
  preResolvedBase: string,
  isSymlink: boolean = true,
): string {
  const resolved = path.resolve(userPath);
  let realResolved: string;
  if (isSymlink) {
    try {
      realResolved = realpathSync(resolved);
    } catch {
      throw new Error('Access denied: path is outside the selected folder');
    }
  } else {
    // Non-symlink fast path: parent was already verified, name came from
    // readdir (never contains `..`), so path.resolve is sufficient.
    realResolved = resolved;
  }
  let realBase = preResolvedBase;
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

/**
 * Paths approved process-wide. These come from the persisted projects list
 * and are usable by any window because the user explicitly registered them
 * as projects (cross-window access is intentional for those).
 */
const persistentApprovedPaths = new Set<string>();

/**
 * Paths approved ad-hoc by a specific window via app:selectFolder. These are
 * scoped to the window that did the selection — a second window cannot read
 * files inside a folder the user only picked in the first window.
 */
const windowApprovedPaths = new Map<number, Set<string>>();

function isApproved(wcId: number, resolvedPath: string): boolean {
  if (persistentApprovedPaths.has(resolvedPath)) return true;
  return windowApprovedPaths.get(wcId)?.has(resolvedPath) === true;
}

function approveForWindow(wcId: number, resolvedPath: string): void {
  let set = windowApprovedPaths.get(wcId);
  if (!set) { set = new Set(); windowApprovedPaths.set(wcId, set); }
  set.add(resolvedPath);
}

/** Per-webContents AbortController for the currently running review, if any. */
const inFlightReviews = new Map<number, AbortController>();

export async function registerHandlers(): Promise<void> {
  // Pre-populate approved paths before binding handlers to avoid race condition
  try {
    const projects = await getProjects();
    for (const p of projects) persistentApprovedPaths.add(path.resolve(p.path));
  } catch (err) {
    console.error('Failed to load persisted projects:', err);
  }
  // ── review:run ─────────────────────────────────────────────────────────────
  ipcMain.handle(Channels.REVIEW_RUN, async (event, request: ReviewRequest & { provider: string }) => {
    const wcId = event.sender.id;
    inFlightReviews.get(wcId)?.abort();
    const controller = new AbortController();
    inFlightReviews.set(wcId, controller);
    try {
      const { engine, reviewRequest } = await buildEngine(request);
      return await engine.review(reviewRequest, controller.signal);
    } finally {
      if (inFlightReviews.get(wcId) === controller) inFlightReviews.delete(wcId);
    }
  });

  // ── review:stream ──────────────────────────────────────────────────────────
  ipcMain.handle(Channels.REVIEW_STREAM, async (event, request: ReviewRequest & { provider: string }) => {
    const wcId = event.sender.id;
    inFlightReviews.get(wcId)?.abort();
    const controller = new AbortController();
    inFlightReviews.set(wcId, controller);

    try {
      const { engine, reviewRequest } = await buildEngine(request);
      const result = await engine.reviewStream(
        reviewRequest,
        (chunk: string) => {
          if (!event.sender.isDestroyed()) {
            event.sender.send(Channels.REVIEW_STREAM_CHUNK, chunk);
          }
        },
        controller.signal,
      );
      if (!event.sender.isDestroyed()) {
        event.sender.send(Channels.REVIEW_STREAM_DONE, result);
      }
      return result;
    } catch (err) {
      // Resolve invoke() to undefined on failure: the renderer already learns
      // about the error through REVIEW_STREAM_ERROR. Rethrowing here would
      // also reject the invoke() promise, causing preload to fire onError
      // twice (once via the channel, once via .catch).
      const message = err instanceof Error ? err.message : String(err);
      if (!event.sender.isDestroyed()) {
        event.sender.send(Channels.REVIEW_STREAM_ERROR, message);
      }
    } finally {
      if (inFlightReviews.get(wcId) === controller) inFlightReviews.delete(wcId);
    }
  });

  // ── review:cancel ──────────────────────────────────────────────────────────
  ipcMain.handle(Channels.REVIEW_CANCEL, (event) => {
    const wcId = event.sender.id;
    const controller = inFlightReviews.get(wcId);
    if (controller) {
      controller.abort();
      inFlightReviews.delete(wcId);
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
    // Filter against the allowlist so a legacy or renamed entry in the on-disk
    // key file cannot surface as a phantom provider in the UI's "configured"
    // count.
    const all = await listProviders();
    return all.filter((p) => ALLOWED_PROVIDERS.has(p));
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
    const wcId = event.sender.id;
    // Register the 'destroyed' cleanup hook exactly once per wcId. We use
    // `windowApprovedPaths.has(wcId)` as the "already bound" gate: the set
    // is only populated from here, so if the map has the key we've already
    // attached a listener on a prior selectFolder call. Subsequent calls
    // just add to the existing approval Set.
    const firstTime = !windowApprovedPaths.has(wcId);
    approveForWindow(wcId, path.resolve(selected));
    if (firstTime) {
      event.sender.once('destroyed', () => {
        windowApprovedPaths.delete(wcId);
      });
    }
    return selected;
  });

  // ── app:readFiles ──────────────────────────────────────────────────────────
  // Only reads files inside the user-selected folder (path traversal guard),
  // only allows known text extensions, and caps individual file size.
  ipcMain.handle(
    Channels.APP_READ_FILES,
    async (event, folderPath: unknown, extensions: unknown = []) => {
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
      if (!isApproved(event.sender.id, resolvedFolder)) {
        throw new Error('Access denied: folder was not selected by the user');
      }

      const entries = await fs.readdir(resolvedFolder, { withFileTypes: true });
      entries.sort((a, b) => String(a.name).localeCompare(String(b.name)));

      // Collect ALL eligible file paths (no pre-read cap). The cap is applied
      // AFTER size filtering so oversized files don't silently reduce the
      // effective limit below MAX_FILE_COUNT.
      const candidates: Array<{ name: string; filePath: string }> = [];
      for (const entry of entries) {
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

      // Read in parallel batches; stop once MAX_FILE_COUNT real (size-passed)
      // files are collected.
      const BATCH_SIZE = 20;
      const files: Array<{ name: string; path: string; content: string }> = [];
      for (let i = 0; i < candidates.length && files.length < MAX_FILE_COUNT; i += BATCH_SIZE) {
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
          if (r && files.length < MAX_FILE_COUNT) files.push(r);
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
    if ('styleProfile' in updates && typeof updates.styleProfile === 'string') {
      sanitized.styleProfile = updates.styleProfile.slice(0, MAX_STYLE_PROFILE_CHARS);
    }
    if ('redactSecretsBeforeSend' in updates && typeof updates.redactSecretsBeforeSend === 'boolean') {
      sanitized.redactSecretsBeforeSend = updates.redactSecretsBeforeSend;
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
    // Settle allowLanAccess first so ollamaUrl validation honours an
    // imported-and-enabled LAN toggle in the same payload. Otherwise a
    // legitimate export with { allowLanAccess: true, ollamaUrl: "<LAN>" }
    // would silently drop the URL because we'd check it against the
    // pre-import flag.
    if (typeof raw.allowLanAccess === 'boolean') {
      sanitized.allowLanAccess = raw.allowLanAccess;
    }
    const currentSettings = await getSettings();
    const effectiveAllowLan = typeof raw.allowLanAccess === 'boolean'
      ? raw.allowLanAccess
      : currentSettings.allowLanAccess;
    if (typeof raw.ollamaUrl === 'string' && raw.ollamaUrl.trim().length > 0) {
      try {
        sanitized.ollamaUrl = assertLocalUrl(raw.ollamaUrl, effectiveAllowLan);
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
    if (typeof raw.styleProfile === 'string') {
      sanitized.styleProfile = raw.styleProfile.slice(0, MAX_STYLE_PROFILE_CHARS);
    }
    if (typeof raw.redactSecretsBeforeSend === 'boolean') {
      sanitized.redactSecretsBeforeSend = raw.redactSecretsBeforeSend;
    }
    if (typeof raw.providers === 'object' && raw.providers !== null) {
      const validProviders: Record<string, { model: string; enabled: boolean }> = {};
      for (const [key, val] of Object.entries(raw.providers as Record<string, unknown>)) {
        // Only accept keys matching known providers — an imported file must
        // not be able to seed arbitrary entries into settings.providers.
        if (!ALLOWED_PROVIDERS.has(key)) continue;
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
    async (event, folderPath: unknown) => {
      if (typeof folderPath !== 'string' || folderPath.trim().length === 0) {
        throw new Error('folderPath must be a non-empty string');
      }

      const resolvedFolder = path.resolve(folderPath.trim());
      if (!isApproved(event.sender.id, resolvedFolder)) {
        throw new Error('Access denied: folder was not selected by the user');
      }
      // Resolve the base once. `assertInsideBase` otherwise runs
      // `realpathSync(base)` per entry, which on a 500-file project turns
      // into 500 redundant blocking syscalls and freezes IPC on Windows
      // network shares. If the base itself isn't resolvable, deny early.
      let realFolderBase: string;
      try {
        realFolderBase = realpathSync(resolvedFolder);
      } catch {
        throw new Error('Access denied: folder was not selected by the user');
      }
      const filePaths: Array<{ name: string; fullPath: string }> = [];
      let truncated = false;

      const MAX_DEPTH = 20;

      async function walkDir(dir: string, depth = 0): Promise<void> {
        if (filePaths.length >= PROJECT_MAX_FILES) { truncated = true; return; }
        if (depth >= MAX_DEPTH) return;

        let entries: import('node:fs').Dirent[];
        try {
          entries = await fs.readdir(dir, { withFileTypes: true }) as import('node:fs').Dirent[];
        } catch {
          return;
        }

        // Stable alphabetical order across platforms; directories first so deep
        // trees are traversed before the current level's files are listed.
        entries.sort((a, b) => {
          const ad = a.isDirectory() ? 0 : 1;
          const bd = b.isDirectory() ? 0 : 1;
          if (ad !== bd) return ad - bd;
          return String(a.name).localeCompare(String(b.name));
        });

        for (const entry of entries) {
          if (filePaths.length >= PROJECT_MAX_FILES) { truncated = true; break; }

          const entryName = String(entry.name);
          const fullPath = path.join(dir, entryName);

          if (entry.isDirectory()) {
            if (IGNORED_DIRECTORIES.has(entryName.toLowerCase())) continue;
            if (entryName.startsWith('.') && entryName !== '.') continue;
            // Symlink escape guard: resolve the real path BEFORE recursing so
            // a symlinked directory that points outside the approved folder
            // cannot be walked into. (Files are guarded in the else-if below.)
            try {
              assertInsideBaseResolved(fullPath, realFolderBase, entry.isSymbolicLink());
            } catch {
              continue;
            }
            await walkDir(fullPath, depth + 1);
          } else if (entry.isFile()) {
            const ext = path.extname(entryName).toLowerCase();
            if (!ALLOWED_EXTENSIONS.has(ext)) continue;

            try {
              assertInsideBaseResolved(fullPath, realFolderBase, entry.isSymbolicLink());
            } catch {
              continue;
            }

            filePaths.push({ name: entryName, fullPath });
          }
        }
      }

      await walkDir(resolvedFolder);

      // Read files in parallel batches; stop once PROJECT_MAX_FILES real
      // (size-passed) files are collected so oversized files do not shrink
      // the effective cap.
      const BATCH_SIZE = 20;
      const files: Array<{ name: string; path: string; relativePath: string; content: string }> = [];
      for (let i = 0; i < filePaths.length && files.length < PROJECT_MAX_FILES; i += BATCH_SIZE) {
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
          if (r && files.length < PROJECT_MAX_FILES) files.push(r);
        }
      }
      return {
        files,
        truncated,
        limit: PROJECT_MAX_FILES,
        totalFound: files.length,
      };
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
    persistentApprovedPaths.add(path.resolve(projectPath.trim()));
    return addProject(name.trim(), projectPath.trim());
  });

  // ── File watcher state (shared by PROJECT_REMOVE + APP_WATCH_PROJECT) ────
  // Declared here, above PROJECT_REMOVE's first read, so the binding is
  // initialized before any handler body runs. (Handlers register synchronously
  // but fire later, so a bottom-of-function declaration worked in practice —
  // this ordering makes the dependency legible to readers and to tsc.)
  //
  // Primary watcher uses fs.watch recursive. On platforms where that throws
  // ERR_FEATURE_UNAVAILABLE_ON_PLATFORM (older Linux builds) we fall back to
  // an mtime-based poller so the UI still rescans when files change on disk.
  type WatcherEntry = {
    stop: () => void;
    timer: ReturnType<typeof setTimeout> | null;
    projectPath: string;
    pendingPath: string | null;
  };
  const watcherState = new Map<number, WatcherEntry>();

  function cleanupWatcher(wcId: number) {
    const entry = watcherState.get(wcId);
    if (!entry) return;
    try { entry.stop(); } catch { /* ignore */ }
    if (entry.timer) clearTimeout(entry.timer);
    watcherState.delete(wcId);
  }

  function isRelevantPath(rel: string): boolean {
    const ext = path.extname(rel).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) return false;
    const baseName = path.basename(rel);
    if (baseName.startsWith('.')) return false;
    const segments = rel.replace(/\\/g, '/').split('/').filter((s) => s.length > 0);
    for (let i = 0; i < segments.length; i++) {
      const s = segments[i]!;
      if (IGNORED_DIRECTORIES.has(s.toLowerCase())) return false;
      // Non-leaf segment that looks like a dotdir (.vscode, .idea, .claude, etc.) — skip.
      if (i < segments.length - 1 && s.startsWith('.')) return false;
    }
    return true;
  }

  /**
   * Poller hot-loop snapshot. `realBase` MUST be a pre-resolved (symlink-
   * expanded) path — the caller resolves it once via realpathSync so this
   * function doesn't re-run realpathSync on the project root 5000× per tick
   * on large trees. A plain `path.resolve(base)` is not sufficient because
   * a symlinked base would false-negative against its resolved children.
   */
  async function snapshotProject(dir: string, realBase: string): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    const MAX_DEPTH = 15;
    async function walk(d: string, depth: number) {
      if (depth > MAX_DEPTH) return;
      if (map.size >= MAX_POLL_FILES) return;
      let entries: import('node:fs').Dirent[];
      try {
        entries = await fs.readdir(d, { withFileTypes: true }) as import('node:fs').Dirent[];
      } catch {
        return;
      }
      for (const entry of entries) {
        if (map.size >= MAX_POLL_FILES) return;
        const name = String(entry.name);
        const full = path.join(d, name);
        if (entry.isDirectory()) {
          if (IGNORED_DIRECTORIES.has(name.toLowerCase())) continue;
          if (name.startsWith('.')) continue;
          // Symlink escape guard: don't descend into a directory whose real
          // path is outside the watched project root.
          try {
            assertInsideBaseResolved(full, realBase, entry.isSymbolicLink());
          } catch {
            continue;
          }
          await walk(full, depth + 1);
        } else if (entry.isFile()) {
          const ext = path.extname(name).toLowerCase();
          if (!ALLOWED_EXTENSIONS.has(ext)) continue;
          try {
            assertInsideBaseResolved(full, realBase, entry.isSymbolicLink());
          } catch {
            continue;
          }
          try {
            const st = await fs.stat(full);
            map.set(full, st.mtimeMs);
          } catch {
            // ignore
          }
        }
      }
    }
    await walk(dir, 0);
    return map;
  }

  async function startPoller(
    dir: string,
    onChange: (changedPath: string | null) => void,
  ): Promise<() => void> {
    // 5s balances responsiveness against I/O cost on large projects. Each tick
    // walks the tree, so doubling from 2.5s halves steady-state I/O while
    // still catching edits in a user-visible window.
    const POLL_INTERVAL_MS = 5000;
    // Resolve the project root ONCE and reuse across every tick. The per-
    // entry symlink checks below get the pre-resolved value, so a 5000-file
    // tree costs 5001 realpathSync calls per tick (one per entry + one for
    // each new file's own realpath) instead of ~10000 (double that).
    let realBase: string;
    try {
      realBase = realpathSync(dir);
    } catch {
      // Root itself is unresolvable — likely unmounted or permissions. The
      // APP_WATCH_PROJECT caller already asserted isApproved + statted the
      // directory, so this only fires on a narrow race; skip polling rather
      // than spinning on a broken path.
      return () => {};
    }
    let prev = await snapshotProject(dir, realBase);
    let stopped = false;
    let running = false;
    const interval = setInterval(async () => {
      if (stopped) return;
      // Re-entrancy guard: if the previous snapshot is still walking (large
      // tree, slow disk), skip this tick rather than stacking walks.
      if (running) return;
      running = true;
      try {
        const cur = await snapshotProject(dir, realBase);
        // Count mutations rather than short-circuiting. When many files change
        // in one tick (git pull, branch switch, `npm install`) a single "one
        // file changed" event is misleading — the renderer would refresh a
        // random entry instead of invalidating its view. Emit `null` past the
        // threshold so the consumer re-scans wholesale.
        const BULK_DIFF_THRESHOLD = 5;
        let firstChange: string | null = null;
        let diffCount = 0;
        for (const [p, m] of cur) {
          if (prev.get(p) !== m) {
            diffCount++;
            if (firstChange === null) firstChange = p;
            if (diffCount > BULK_DIFF_THRESHOLD) break;
          }
        }
        if (diffCount <= BULK_DIFF_THRESHOLD) {
          for (const p of prev.keys()) {
            if (!cur.has(p)) {
              diffCount++;
              if (firstChange === null) firstChange = p;
              if (diffCount > BULK_DIFF_THRESHOLD) break;
            }
          }
        }
        prev = cur;
        if (diffCount > BULK_DIFF_THRESHOLD) {
          onChange(null);
        } else if (firstChange !== null) {
          onChange(firstChange);
        }
      } finally {
        running = false;
      }
    }, POLL_INTERVAL_MS);
    return () => { stopped = true; clearInterval(interval); };
  }

  function startFsWatcher(
    dir: string,
    onChange: (changedPath: string | null) => void,
  ): FSWatcher {
    const watcher = watch(dir, { recursive: true }, (_eventType, filename) => {
      if (!filename) { onChange(null); return; }
      const rel = String(filename);
      if (!isRelevantPath(rel)) return;
      onChange(path.join(dir, rel));
    });
    return watcher;
  }

  // ── project:remove ─────────────────────────────────────────────────────────
  ipcMain.handle(Channels.PROJECT_REMOVE, async (_event, projectId: unknown) => {
    if (typeof projectId !== 'string' || projectId.trim().length === 0) {
      throw new Error('Project ID must be a non-empty string');
    }
    const id = projectId.trim();
    const projects = await getProjects();
    const target = projects.find((p) => p.id === id);
    if (target) {
      const resolved = path.resolve(target.path);
      persistentApprovedPaths.delete(resolved);
      // Revoke any per-window ad-hoc approvals that still reference the same
      // path. Without this, a window that had also picked the folder via
      // dialog keeps a ghost approval after the user explicitly removes the
      // project — defeating the point of removal.
      for (const set of windowApprovedPaths.values()) {
        set.delete(resolved);
      }
      // Stop any file watcher watching this project's directory AND abort
      // any in-flight review that was launched from that watching window, so
      // the renderer doesn't keep receiving stream chunks for a project that
      // no longer exists in the persisted list.
      for (const [wcId, state] of watcherState) {
        if (state.projectPath === resolved) {
          inFlightReviews.get(wcId)?.abort();
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
    // Truncate oversize code (project-mode reviews concatenate many files) so
    // the review still lands in history. The marker lets the renderer show
    // a "truncated" hint when rehydrating the saved entry. Compute the
    // replacement locally; never write back to the caller's input object.
    let code = e.code;
    if (code.length > MAX_HISTORY_CODE_CHARS) {
      let keep = MAX_HISTORY_CODE_CHARS - 200;
      // Snap back if the cut would split a UTF-16 surrogate pair. Without
      // this, the persisted JSON can contain a lone high surrogate that
      // fails to round-trip through JSON.parse on some runtimes.
      const last = code.charCodeAt(keep - 1);
      if (last >= 0xd800 && last <= 0xdbff) keep -= 1;
      code = code.slice(0, keep) +
        `\n\n/* [CodeScope] history truncated: ${code.length - keep} chars dropped */`;
    }
    if (typeof e.provider !== 'string') throw new Error('History entry: provider must be a string');
    if (typeof e.model !== 'string') throw new Error('History entry: model must be a string');
    if (typeof e.language !== 'string') throw new Error('History entry: language must be a string');
    if (typeof e.score !== 'number') throw new Error('History entry: score must be a number');
    if (typeof e.summary !== 'string') throw new Error('History entry: summary must be a string');
    if (!Array.isArray(e.findings)) throw new Error('History entry: findings must be an array');
    // Explicit pick — spreading the caller's object preserves arbitrary extra
    // keys that then leak into the on-disk JSON. HistoryEntry's `Omit` type
    // enforces nothing at runtime, so unknown fields would survive indefinitely.
    let tokensUsed: { input: number; output: number } | undefined;
    if (typeof e.tokensUsed === 'object' && e.tokensUsed !== null) {
      const t = e.tokensUsed as Record<string, unknown>;
      if (typeof t.input === 'number' && typeof t.output === 'number') {
        tokensUsed = { input: t.input, output: t.output };
      }
    }
    const sanitized: Omit<HistoryEntry, 'id' | 'createdAt'> = {
      filename: e.filename,
      code,
      provider: e.provider,
      model: e.model,
      language: e.language,
      score: e.score,
      summary: e.summary,
      findings: (e.findings as unknown[]).map((f, i) => sanitizeFinding(f, i)),
      ...(tokensUsed ? { tokensUsed } : {}),
    };
    return addHistoryEntry(sanitized);
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

      if (!isApproved(event.sender.id, resolvedFolder)) {
        throw new Error('Access denied: folder was not selected by the user');
      }

      const stat = await fs.stat(resolvedFolder);
      if (!stat.isDirectory()) {
        throw new Error('Watch path is not a directory');
      }

      const handleChange = (changedPath: string | null) => {
        const state = watcherState.get(wcId);
        if (!state) return;
        state.pendingPath = changedPath;
        if (state.timer) clearTimeout(state.timer);
        state.timer = setTimeout(() => {
          state.timer = null;
          const emit = state.pendingPath;
          state.pendingPath = null;
          if (!event.sender.isDestroyed()) {
            event.sender.send(Channels.APP_PROJECT_FILES_CHANGED, emit);
          }
        }, 400);
      };

      let stop: () => void;
      try {
        const watcher = startFsWatcher(resolvedFolder, handleChange);
        // Runtime-error fallback: if the watcher emits 'error' after it's
        // running (some Linux kernels silently drop recursive events and
        // surface an error event later), close it and hand off to the
        // poller so changes are still detected.
        watcher.on('error', async (err) => {
          console.error('fs.watch emitted error, switching to poller:', err);
          try { watcher.close(); } catch { /* ignore */ }
          try {
            const pollerStop = await startPoller(resolvedFolder, handleChange);
            const state = watcherState.get(wcId);
            if (state) state.stop = pollerStop;
            else { try { pollerStop(); } catch { /* ignore */ } }
          } catch (e) {
            console.error('Failed to start poller fallback:', e);
          }
        });
        stop = () => { try { watcher.close(); } catch { /* ignore */ } };
      } catch (err) {
        console.warn('fs.watch recursive unavailable, falling back to polling:', err);
        stop = await startPoller(resolvedFolder, handleChange);
      }

      watcherState.set(wcId, {
        stop,
        timer: null,
        projectPath: resolvedFolder,
        pendingPath: null,
      });

      event.sender.once('destroyed', () => cleanupWatcher(wcId));
    },
  );

  ipcMain.handle(Channels.APP_UNWATCH_PROJECT, (event) => {
    cleanupWatcher(event.sender.id);
  });
}
