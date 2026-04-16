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
import { createWriteQueue } from './writeQueue.js';

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
  version: number;
}

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
  version: 1,
};

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

async function loadSettings(): Promise<AppSettings> {
  try {
    const data = await fs.readFile(getSettingsPath(), 'utf-8');
    const parsed = JSON.parse(data);
    if (typeof parsed !== 'object' || parsed === null) return { ...DEFAULT_SETTINGS };

    const activeProvider = typeof parsed.activeProvider === 'string'
      ? parsed.activeProvider : DEFAULT_SETTINGS.activeProvider;
    const theme = ['light', 'dark', 'system'].includes(parsed.theme)
      ? parsed.theme : DEFAULT_SETTINGS.theme;
    const ollamaUrl = typeof parsed.ollamaUrl === 'string'
      ? parsed.ollamaUrl : DEFAULT_SETTINGS.ollamaUrl;
    const version = typeof parsed.version === 'number'
      ? parsed.version : DEFAULT_SETTINGS.version;

    const rawProviders = typeof parsed.providers === 'object' && parsed.providers !== null
      ? parsed.providers : {};
    const providers: Record<string, ProviderSettings> = { ...DEFAULT_SETTINGS.providers };
    for (const [key, val] of Object.entries(rawProviders)) {
      if (typeof val === 'object' && val !== null
        && typeof (val as Record<string, unknown>).model === 'string'
        && typeof (val as Record<string, unknown>).enabled === 'boolean') {
        providers[key] = val as ProviderSettings;
      }
    }

    const projects = Array.isArray(parsed.projects)
      ? parsed.projects.filter(
          (p: unknown) =>
            typeof p === 'object' && p !== null
            && typeof (p as Record<string, unknown>).id === 'string'
            && typeof (p as Record<string, unknown>).name === 'string'
            && typeof (p as Record<string, unknown>).path === 'string',
        ) as ProjectInfo[]
      : [];

    const autoSaveHistory = typeof parsed.autoSaveHistory === 'boolean'
      ? parsed.autoSaveHistory : DEFAULT_SETTINGS.autoSaveHistory;
    const defaultLanguage = typeof parsed.defaultLanguage === 'string'
      ? parsed.defaultLanguage : DEFAULT_SETTINGS.defaultLanguage;
    const allowLanAccess = typeof parsed.allowLanAccess === 'boolean'
      ? parsed.allowLanAccess : DEFAULT_SETTINGS.allowLanAccess;

    return { activeProvider, providers, ollamaUrl, theme, projects, autoSaveHistory, defaultLanguage, allowLanAccess, version };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

const enqueueWrite = createWriteQueue();

async function saveSettings(settings: AppSettings): Promise<void> {
  return enqueueWrite(async () => {
    await ensureDir();
    await fs.writeFile(getSettingsPath(), JSON.stringify(settings, null, 2), 'utf-8');
  });
}

// ── Public API ───────────────────────────────────────────────────────────────

let cachedSettings: AppSettings | null = null;

export async function getSettings(): Promise<AppSettings> {
  if (!cachedSettings) {
    cachedSettings = await loadSettings();
  }
  return cachedSettings;
}

export async function updateSettings(updates: Partial<AppSettings>): Promise<AppSettings> {
  const current = await getSettings();
  const updated: AppSettings = {
    ...current,
    ...updates,
    providers: {
      ...current.providers,
      ...(updates.providers || {}),
    },
  };
  cachedSettings = updated;
  await saveSettings(updated);
  return updated;
}

export async function setProviderModel(provider: string, model: string): Promise<AppSettings> {
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
