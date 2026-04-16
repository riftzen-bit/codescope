/**
 * Secure API key storage using Electron's safeStorage + native fs.
 *
 * Keys are stored in the same persistent location as settings:
 * - Windows: %APPDATA%/CodeScope/secure-keys.json
 * - macOS: ~/Library/Application Support/CodeScope/secure-keys.json
 * - Linux: ~/.config/codescope/secure-keys.json
 *
 * This location survives app uninstall.
 */

import { safeStorage } from 'electron';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { getSettingsDir, getKeysPath } from '../settings/store.js';

// u2500u2500 Types u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500

interface KeyStore {
  [key: string]: string;
}

// u2500u2500 Validation u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500

const VALID_PROVIDER_RE = /^[a-z0-9_-]{1,64}$/;

function assertValidProvider(provider: string): void {
  if (typeof provider !== 'string' || !VALID_PROVIDER_RE.test(provider)) {
    throw new Error(`Invalid provider name: ${JSON.stringify(provider)}`);
  }
}

const keyName = (provider: string) => `key_${provider}`;

// u2500u2500 File operations u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500

async function ensureDir(): Promise<void> {
  await fs.mkdir(getSettingsDir(), { recursive: true });
}

let cachedKeys: KeyStore | null = null;

async function loadKeys(): Promise<KeyStore> {
  if (cachedKeys) return cachedKeys;
  try {
    const data = await fs.readFile(getKeysPath(), 'utf-8');
    cachedKeys = JSON.parse(data) as KeyStore;
    return cachedKeys;
  } catch {
    cachedKeys = {};
    return cachedKeys;
  }
}

async function restrictFileToCurrentUser(filePath: string): Promise<void> {
  if (process.platform !== 'win32') return;
  const username = process.env.USERNAME;
  if (!username) {
    console.warn('Skipping Windows ACL restriction: USERNAME environment variable not set');
    return;
  }
  try {
    await new Promise<void>((resolve, reject) => {
      execFile('icacls', [filePath, '/inheritance:r', '/grant:r', `${username}:F`], (err) => {
        if (err) reject(err); else resolve();
      });
    });
  } catch (err) {
    console.error('Failed to set Windows ACL on keys file:', err);
  }
}

async function saveKeys(keys: KeyStore): Promise<void> {
  cachedKeys = keys;
  await ensureDir();
  const keysPath = getKeysPath();
  await fs.writeFile(keysPath, JSON.stringify(keys, null, 2), { encoding: 'utf-8', mode: 0o600 });
  await restrictFileToCurrentUser(keysPath);
}

// u2500u2500 Public API u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500

export async function saveKey(provider: string, key: string): Promise<void> {
  assertValidProvider(provider);
  if (typeof key !== 'string' || key.length === 0) {
    throw new Error('API key must be a non-empty string');
  }

  const keys = await loadKeys();

  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      'OS encryption is not available. Cannot securely store API key. ' +
      'Please ensure your system keychain / credential manager is configured.',
    );
  }

  const encrypted = safeStorage.encryptString(key);
  keys[keyName(provider)] = encrypted.toString('base64');
  await saveKeys(keys);
}

export async function getKey(provider: string): Promise<string | null> {
  assertValidProvider(provider);
  const keys = await loadKeys();
  const raw = keys[keyName(provider)];
  if (!raw) return null;

  if (!safeStorage.isEncryptionAvailable()) {
    return null;
  }

  try {
    const buf = Buffer.from(raw, 'base64');
    return safeStorage.decryptString(buf);
  } catch {
    return null;
  }
}

export async function deleteKey(provider: string): Promise<void> {
  assertValidProvider(provider);
  const keys = await loadKeys();
  delete keys[keyName(provider)];
  await saveKeys(keys);
}

export async function listProviders(): Promise<string[]> {
  const keys = await loadKeys();
  return Object.keys(keys)
    .filter((k) => k.startsWith('key_'))
    .map((k) => k.slice('key_'.length));
}
