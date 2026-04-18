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
import { atomicWriteFile } from '../settings/writeQueue.js';

// ── Types ───────────────────────────────────────────────────────────────────

interface KeyStore {
  [key: string]: string;
}

// ── Validation ──────────────────────────────────────────────────────────────

const VALID_PROVIDER_RE = /^[a-z0-9_-]{1,64}$/;

function assertValidProvider(provider: string): void {
  if (typeof provider !== 'string' || !VALID_PROVIDER_RE.test(provider)) {
    throw new Error(`Invalid provider name: ${JSON.stringify(provider)}`);
  }
}

const keyName = (provider: string) => `key_${provider}`;

// ── File operations ─────────────────────────────────────────────────────────

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
  // Prefer the fully-qualified DOMAIN\username when USERDOMAIN is populated
  // (domain-joined or modern Windows installs). On a domain-joined machine a
  // bare `username` can collide with a local account of the same short name
  // but different SID, applying the grant to the wrong principal. Fall back
  // to the unqualified name only if USERDOMAIN is unavailable.
  const username = process.env.USERNAME;
  const userDomain = process.env.USERDOMAIN;
  if (!username) {
    console.error(
      '[safeStorage] SECURITY: USERNAME not set — cannot restrict ACLs on ' +
      `${filePath}; file remains readable by any principal with default NTFS ACLs. ` +
      'Encrypted key values are still safe (protected by safeStorage), but the ' +
      'on-disk container is not ACL-restricted. Investigate the environment.',
    );
    return;
  }
  const principal = userDomain ? `${userDomain}\\${username}` : username;
  try {
    await new Promise<void>((resolve, reject) => {
      execFile('icacls', [filePath, '/inheritance:r', '/grant:r', `${principal}:F`], (err) => {
        if (err) reject(err); else resolve();
      });
    });
  } catch (err) {
    console.error(
      `[safeStorage] SECURITY: icacls failed for principal ${principal} on ${filePath}:`,
      err,
      '— file may retain inherited ACLs. Encrypted keys are still protected by ' +
      'safeStorage but the container is not ACL-locked.',
    );
  }
}

async function saveKeys(keys: KeyStore): Promise<void> {
  cachedKeys = keys;
  await ensureDir();
  const keysPath = getKeysPath();
  await atomicWriteFile(keysPath, JSON.stringify(keys, null, 2), { mode: 0o600 });
  await restrictFileToCurrentUser(keysPath);
}

// ── Public API ──────────────────────────────────────────────────────────────

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
