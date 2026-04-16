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
import { createWriteQueue } from './writeQueue.js';

// u2500u2500 Types u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500

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

// u2500u2500 File operations u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500

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

async function loadHistory(): Promise<HistoryEntry[]> {
  try {
    const data = await fs.readFile(getHistoryPath(), 'utf-8');
    const parsed = JSON.parse(data);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidEntry);
  } catch {
    return [];
  }
}

const enqueueWrite = createWriteQueue();

async function saveHistory(entries: HistoryEntry[]): Promise<void> {
  return enqueueWrite(async () => {
    await fs.mkdir(getSettingsDir(), { recursive: true });
    await fs.writeFile(getHistoryPath(), JSON.stringify(entries, null, 2), 'utf-8');
  });
}

// u2500u2500 Public API u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500

let cached: HistoryEntry[] | null = null;

export async function getHistory(): Promise<HistoryEntry[]> {
  if (!cached) {
    cached = await loadHistory();
  }
  return cached;
}

export async function addHistoryEntry(entry: Omit<HistoryEntry, 'id' | 'createdAt'>): Promise<HistoryEntry> {
  const entries = await getHistory();
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
