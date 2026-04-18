/**
 * Retry an async operation with exponential backoff + jitter.
 *
 * Only retries when `shouldRetry(err)` returns true — by default this is
 * HTTP 429 and 5xx. AbortErrors are never retried. The caller's signal is
 * checked between attempts so cancellation doesn't silently wait for the
 * next backoff window.
 */

export interface RetryOptions {
  maxAttempts?: number;
  baseMs?: number;
  capMs?: number;
  signal?: AbortSignal;
  shouldRetry?: (err: unknown) => boolean;
  onRetry?: (attempt: number, delayMs: number, err: unknown) => void;
}

function defaultShouldRetry(err: unknown): boolean {
  if (err instanceof Error) {
    if (err.name === 'AbortError') return false;
    // Error bodies formatted by providers.ts look like "X request failed with status 429".
    const match = err.message.match(/status (\d{3})/);
    if (match && match[1]) {
      const status = Number(match[1]);
      if (status === 408 || status === 425 || status === 429) return true;
      if (status >= 500 && status < 600) return true;
      return false;
    }
    if (/ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|network|fetch failed/i.test(err.message)) {
      return true;
    }
  }
  return false;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
    };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
  });
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseMs = options.baseMs ?? 500;
  const capMs = options.capMs ?? 10_000;
  const signal = options.signal;
  const shouldRetry = options.shouldRetry ?? defaultShouldRetry;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (signal?.aborted) {
      throw signal.reason ?? new DOMException('Aborted', 'AbortError');
    }
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt >= maxAttempts) break;
      if (!shouldRetry(err)) break;
      const exp = Math.min(capMs, baseMs * 2 ** (attempt - 1));
      const jitter = Math.random() * exp * 0.25;
      let delay = Math.floor(exp + jitter);
      // Honor Retry-After when the server provides one (RFC 7231 §7.1.3).
      // If the server says wait longer, wait longer; shorter is ignored so
      // we don't hammer a rate-limited service. Capped by capMs.
      const retryAfterMs = (err as { retryAfterMs?: unknown } | null)?.retryAfterMs;
      if (typeof retryAfterMs === 'number' && Number.isFinite(retryAfterMs) && retryAfterMs > delay) {
        delay = Math.min(capMs, Math.floor(retryAfterMs));
      }
      options.onRetry?.(attempt, delay, err);
      await sleep(delay, signal);
    }
  }
  throw lastErr;
}
