/**
 * Settings store - persists user preferences to a location that survives app uninstall.
 *
 * Storage location:
 * - Windows: %APPDATA%/CodeScope/settings.json
 * - macOS: ~/Library/Application Support/CodeScope/settings.json
 * - Linux: ~/.config/codescope/settings.json
 *
 * This is intentionally NOT in app.getPath('userData') which may be deleted on uninstall.
 */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createWriteQueue, atomicWriteFile } from './writeQueue.js';

/**
 * Source of truth for valid provider names. Duplicated at the IPC layer for
 * input validation, but also re-checked here at the store boundary so any
 * internal caller — migrations, history rehydrate, tests — cannot seed a
 * rogue provider key into settings.providers on disk. Defense-in-depth.
 */
export const ALLOWED_PROVIDERS: ReadonlySet<string> = new Set([
  'anthropic', 'openai', 'google', 'ollama', 'claude-code',
]);

function assertKnownProvider(provider: string): void {
  if (!ALLOWED_PROVIDERS.has(provider)) {
    throw new Error(`Unknown provider: ${JSON.stringify(provider)}`);
  }
}

// ── Types ────────────────────────────────────────────────────────────────────

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

/** Cap on user-supplied style profile text to avoid runaway system prompts. */
const MAX_STYLE_PROFILE_CHARS = 4000;

const DEFAULT_SETTINGS: AppSettings = {
  activeProvider: 'anthropic',
  providers: {
    anthropic: { model: 'claude-sonnet-4-6', enabled: true },
    openai: { model: 'gpt-5.4', enabled: true },
    google: { model: 'gemini-2.5-flash', enabled: true },
    ollama: { model: 'llama3.2', enabled: true },
    'claude-code': { model: 'claude-sonnet-4-6', enabled: true },
  },
  ollamaUrl: 'http://localhost:11434',
  theme: 'light',
  projects: [],
  autoSaveHistory: true,
  defaultLanguage: 'auto',
  allowLanAccess: false,
  styleProfile: '',
  redactSecretsBeforeSend: true,
  version: 1,
};

export { MAX_STYLE_PROFILE_CHARS };

// ── Path resolution ──────────────────────────────────────────────────────────

function getSettingsDir(): string {
  const platform = process.platform;

  if (platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'CodeScope');
  }

  if (platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'CodeScope');
  }

  const configDir = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(configDir, 'codescope');
}

function getSettingsPath(): string {
  return path.join(getSettingsDir(), 'settings.json');
}

function getKeysPath(): string {
  return path.join(getSettingsDir(), 'secure-keys.json');
}

// ── File operations ──────────────────────────────────────────────────────────

async function ensureDir(): Promise<void> {
  await fs.mkdir(getSettingsDir(), { recursive: true });
}

/**
 * Load from disk. `cacheable: true` means the result faithfully represents
 * what is on disk (missing file → defaults). `cacheable: false` means a
 * transient failure (EACCES, EIO, malformed JSON) — the caller MUST NOT
 * cache, otherwise a one-off read glitch poisons the cache and the next
 * updateSettings() would overwrite the user's real file with defaults.
 */
async function loadSettings(): Promise<{ settings: AppSettings; cacheable: boolean }> {
  let data: string;
  try {
    data = await fs.readFile(getSettingsPath(), 'utf-8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | null)?.code;
    if (code === 'ENOENT') {
      return { settings: { ...DEFAULT_SETTINGS }, cacheable: true };
    }
    console.error('loadSettings: transient read error, not caching result:', err);
    return { settings: { ...DEFAULT_SETTINGS }, cacheable: false };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch (err) {
    console.error('loadSettings: JSON parse error, not caching result:', err);
    return { settings: { ...DEFAULT_SETTINGS }, cacheable: false };
  }
  if (typeof parsed !== 'object' || parsed === null) {
    console.error('loadSettings: unexpected non-object root, not caching result');
    return { settings: { ...DEFAULT_SETTINGS }, cacheable: false };
  }

  const p = parsed as Record<string, unknown>;

  const activeProvider = typeof p.activeProvider === 'string'
    ? p.activeProvider : DEFAULT_SETTINGS.activeProvider;
  const theme = (p.theme === 'light' || p.theme === 'dark' || p.theme === 'system')
    ? p.theme : DEFAULT_SETTINGS.theme;
  const ollamaUrl = typeof p.ollamaUrl === 'string'
    ? p.ollamaUrl : DEFAULT_SETTINGS.ollamaUrl;
  const version = typeof p.version === 'number'
    ? p.version : DEFAULT_SETTINGS.version;

  const rawProviders = typeof p.providers === 'object' && p.providers !== null
    ? p.providers as Record<string, unknown>
    : {};
  const providers: Record<string, ProviderSettings> = { ...DEFAULT_SETTINGS.providers };
  for (const [key, val] of Object.entries(rawProviders)) {
    if (typeof val === 'object' && val !== null
      && typeof (val as Record<string, unknown>).model === 'string'
      && typeof (val as Record<string, unknown>).enabled === 'boolean') {
      providers[key] = val as ProviderSettings;
    }
  }

  const projects = Array.isArray(p.projects)
    ? p.projects.filter(
        (proj: unknown) =>
          typeof proj === 'object' && proj !== null
          && typeof (proj as Record<string, unknown>).id === 'string'
          && typeof (proj as Record<string, unknown>).name === 'string'
          && typeof (proj as Record<string, unknown>).path === 'string',
      ) as ProjectInfo[]
    : [];

  const autoSaveHistory = typeof p.autoSaveHistory === 'boolean'
    ? p.autoSaveHistory : DEFAULT_SETTINGS.autoSaveHistory;
  const defaultLanguage = typeof p.defaultLanguage === 'string'
    ? p.defaultLanguage : DEFAULT_SETTINGS.defaultLanguage;
  const allowLanAccess = typeof p.allowLanAccess === 'boolean'
    ? p.allowLanAccess : DEFAULT_SETTINGS.allowLanAccess;
  const styleProfile = typeof p.styleProfile === 'string'
    ? p.styleProfile.slice(0, MAX_STYLE_PROFILE_CHARS)
    : DEFAULT_SETTINGS.styleProfile;
  const redactSecretsBeforeSend = typeof p.redactSecretsBeforeSend === 'boolean'
    ? p.redactSecretsBeforeSend : DEFAULT_SETTINGS.redactSecretsBeforeSend;

  return {
    settings: { activeProvider, providers, ollamaUrl, theme, projects, autoSaveHistory, defaultLanguage, allowLanAccess, styleProfile, redactSecretsBeforeSend, version },
    cacheable: true,
  };
}

const enqueueWrite = createWriteQueue();

async function saveSettings(settings: AppSettings): Promise<void> {
  const target = getSettingsPath();
  return enqueueWrite(target, async () => {
    await ensureDir();
    await atomicWriteFile(target, JSON.stringify(settings, null, 2));
  });
}

// ── Public API ───────────────────────────────────────────────────────────────

let cachedSettings: AppSettings | null = null;

export async function getSettings(): Promise<AppSettings> {
  if (cachedSettings) return cachedSettings;
  const { settings, cacheable } = await loadSettings();
  if (cacheable) cachedSettings = settings;
  return settings;
}

export async function updateSettings(updates: Partial<AppSettings>): Promise<AppSettings> {
  if (updates.activeProvider !== undefined) {
    assertKnownProvider(updates.activeProvider);
  }
  // Drop rogue provider keys before merging so a bug or migration can't
  // persist `providers['evil'] = …` to disk via the generic update path.
  // IPC-layer filters already do this for imports; this is the last line.
  let providerPatch = updates.providers;
  if (providerPatch) {
    const filtered: Record<string, ProviderSettings> = {};
    for (const [key, val] of Object.entries(providerPatch)) {
      if (ALLOWED_PROVIDERS.has(key)) filtered[key] = val;
    }
    providerPatch = filtered;
  }
  const current = await getSettings();
  const updated: AppSettings = {
    ...current,
    ...updates,
    providers: {
      ...current.providers,
      ...(providerPatch || {}),
    },
  };
  cachedSettings = updated;
  await saveSettings(updated);
  return updated;
}

export async function setProviderModel(provider: string, model: string): Promise<AppSettings> {
  assertKnownProvider(provider);
  const current = await getSettings();
  const providerSettings = current.providers[provider] || { model: '', enabled: true };
  return updateSettings({
    providers: {
      ...current.providers,
      [provider]: { ...providerSettings, model },
    },
  });
}

export async function setActiveProvider(provider: string): Promise<AppSettings> {
  assertKnownProvider(provider);
  return updateSettings({ activeProvider: provider });
}

export async function setOllamaUrl(url: string): Promise<AppSettings> {
  return updateSettings({ ollamaUrl: url });
}

export async function resetSettings(): Promise<AppSettings> {
  cachedSettings = { ...DEFAULT_SETTINGS };
  await saveSettings(cachedSettings);
  return cachedSettings;
}

// ── Project management ───────────────────────────────────────────────────────

export async function addProject(name: string, projectPath: string): Promise<AppSettings> {
  const current = await getSettings();
  const id = crypto.randomUUID();
  const newProject: ProjectInfo = {
    id,
    name,
    path: projectPath,
    addedAt: Date.now(),
  };
  return updateSettings({
    projects: [...current.projects, newProject],
  });
}

export async function removeProject(projectId: string): Promise<AppSettings> {
  const current = await getSettings();
  return updateSettings({
    projects: current.projects.filter((p) => p.id !== projectId),
  });
}

export async function getProjects(): Promise<ProjectInfo[]> {
  const settings = await getSettings();
  return settings.projects;
}

// Export paths for key storage module
export { getSettingsDir, getKeysPath };
