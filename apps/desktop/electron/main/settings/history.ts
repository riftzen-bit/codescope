/**
 * Review history store - persists past review results.
 *
 * Storage: history.json in the same directory as settings.json.
 * Capped at MAX_ENTRIES to prevent unbounded growth.
 */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getSettingsDir } from './store.js';
import { createWriteQueue, atomicWriteFile } from './writeQueue.js';

// ── Types ───────────────────────────────────────────────────────────────────

export interface HistoryEntry {
  id: string;
  filename: string;
  code: string;
  provider: string;
  model: string;
  language: string;
  score: number;
  summary: string;
  findings: Array<{
    id: string;
    severity: string;
    category: string;
    line?: number;
    title: string;
    description: string;
    suggestion: string;
  }>;
  tokensUsed?: { input: number; output: number };
  createdAt: number;
}

const MAX_ENTRIES = 50;

// ── File operations ─────────────────────────────────────────────────────────

function getHistoryPath(): string {
  return path.join(getSettingsDir(), 'history.json');
}

function isValidEntry(v: unknown): v is HistoryEntry {
  if (typeof v !== 'object' || v === null) return false;
  const e = v as Record<string, unknown>;
  return typeof e.id === 'string'
    && typeof e.filename === 'string'
    && typeof e.code === 'string'
    && typeof e.provider === 'string'
    && typeof e.model === 'string'
    && typeof e.language === 'string'
    && typeof e.score === 'number'
    && typeof e.summary === 'string'
    && Array.isArray(e.findings)
    && typeof e.createdAt === 'number';
}

/**
 * Load from disk. `cacheable: true` means the result faithfully represents
 * the file (missing file → []), so the caller may cache it. `cacheable: false`
 * means a transient error (EACCES, EIO, parse failure) — the caller MUST NOT
 * cache, otherwise a one-off read glitch poisons the cache until process exit.
 */
async function loadHistory(): Promise<{ entries: HistoryEntry[]; cacheable: boolean }> {
  try {
    const data = await fs.readFile(getHistoryPath(), 'utf-8');
    const parsed = JSON.parse(data);
    if (!Array.isArray(parsed)) return { entries: [], cacheable: true };
    return { entries: parsed.filter(isValidEntry), cacheable: true };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | null)?.code;
    if (code === 'ENOENT') return { entries: [], cacheable: true };
    console.error('loadHistory: transient error, not caching result:', err);
    return { entries: [], cacheable: false };
  }
}

const enqueueWrite = createWriteQueue();

async function saveHistory(entries: HistoryEntry[]): Promise<void> {
  const target = getHistoryPath();
  return enqueueWrite(target, async () => {
    await fs.mkdir(getSettingsDir(), { recursive: true });
    await atomicWriteFile(target, JSON.stringify(entries, null, 2));
  });
}

// ── Public API ──────────────────────────────────────────────────────────────

let cached: HistoryEntry[] | null = null;

export async function getHistory(): Promise<HistoryEntry[]> {
  if (cached) return cached;
  const { entries, cacheable } = await loadHistory();
  if (cacheable) cached = entries;
  return entries;
}

export async function addHistoryEntry(entry: Omit<HistoryEntry, 'id' | 'createdAt'>): Promise<HistoryEntry> {
  // Defensive copy: getHistory() returns the live cached array by reference.
  // Two concurrent addHistoryEntry calls would otherwise share the same
  // array and could interleave unshift/truncate between awaits, producing
  // surprising ordering and transient length > MAX_ENTRIES.
  const entries = [...await getHistory()];
  const newEntry: HistoryEntry = {
    ...entry,
    id: crypto.randomUUID(),
    createdAt: Date.now(),
  };

  entries.unshift(newEntry);

  if (entries.length > MAX_ENTRIES) {
    entries.length = MAX_ENTRIES;
  }

  cached = entries;
  await saveHistory(entries);
  return newEntry;
}

export async function getHistoryEntry(id: string): Promise<HistoryEntry | null> {
  const entries = await getHistory();
  return entries.find((e) => e.id === id) ?? null;
}

export async function deleteHistoryEntry(id: string): Promise<void> {
  const entries = (await getHistory()).filter((e) => e.id !== id);
  cached = entries;
  await saveHistory(entries);
}

export async function clearHistory(): Promise<void> {
  cached = [];
  await saveHistory([]);
}
