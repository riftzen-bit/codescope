/**
 * Shared input-validation helpers used across IPC handlers and providers.
 */

/** Validate that a URL is http(s) pointing to localhost (or private network if allowLan). */
export function assertLocalUrl(url: string, allowLan = false): string {
  const trimmed = url.replace(/\/$/, '').trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Invalid URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http:// or https:// URLs are allowed');
  }
  const hostname = parsed.hostname.toLowerCase();
  const isLoopback = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  if (isLoopback) return trimmed;
  if (allowLan) {
    const isIPv4Private = /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(hostname);
    const isIPv6Private = hostname.startsWith('fe80:') || hostname.startsWith('fc') || hostname.startsWith('fd');
    if (isIPv4Private || isIPv6Private) return trimmed;
  }
  throw new Error(
    allowLan
      ? 'Ollama URL must point to localhost or a private network address'
      : 'Ollama URL must point to localhost. Enable "Allow LAN access" in settings for private network addresses.',
  );
}
