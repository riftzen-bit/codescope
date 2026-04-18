import { describe, it, expect } from 'vitest';
import { withRetry } from './retry.js';

describe('withRetry', () => {
  it('returns value on first success', async () => {
    const result = await withRetry(async () => 'ok');
    expect(result).toBe('ok');
  });

  it('retries on 429 and eventually succeeds', async () => {
    let attempts = 0;
    const result = await withRetry(
      async () => {
        attempts++;
        if (attempts < 3) throw new Error('Anthropic request failed with status 429');
        return 'ok';
      },
      { baseMs: 1, capMs: 5 },
    );
    expect(result).toBe('ok');
    expect(attempts).toBe(3);
  });

  it('retries on 5xx', async () => {
    let attempts = 0;
    const result = await withRetry(
      async () => {
        attempts++;
        if (attempts < 2) throw new Error('OpenAI request failed with status 503');
        return 'ok';
      },
      { baseMs: 1, capMs: 5 },
    );
    expect(result).toBe('ok');
  });

  it('does NOT retry on 400/401/403/404', async () => {
    let attempts = 0;
    await expect(withRetry(
      async () => {
        attempts++;
        throw new Error('Google request failed with status 401');
      },
      { baseMs: 1 },
    )).rejects.toThrow(/status 401/);
    expect(attempts).toBe(1);
  });

  it('stops after maxAttempts', async () => {
    let attempts = 0;
    await expect(withRetry(
      async () => {
        attempts++;
        throw new Error('Anthropic request failed with status 500');
      },
      { baseMs: 1, capMs: 5, maxAttempts: 2 },
    )).rejects.toThrow(/500/);
    expect(attempts).toBe(2);
  });

  it('does not retry on AbortError', async () => {
    let attempts = 0;
    await expect(withRetry(
      async () => {
        attempts++;
        const err = new Error('Cancelled');
        err.name = 'AbortError';
        throw err;
      },
      { baseMs: 1 },
    )).rejects.toThrow();
    expect(attempts).toBe(1);
  });

  it('retries on network-ish messages', async () => {
    let attempts = 0;
    const result = await withRetry(
      async () => {
        attempts++;
        if (attempts < 2) throw new Error('fetch failed: ECONNRESET');
        return 'ok';
      },
      { baseMs: 1 },
    );
    expect(result).toBe('ok');
  });

  it('fires onRetry callback', async () => {
    const seen: Array<{ attempt: number }> = [];
    let attempts = 0;
    await withRetry(
      async () => {
        attempts++;
        if (attempts < 2) throw new Error('request failed with status 500');
        return 'ok';
      },
      {
        baseMs: 1,
        onRetry: (attempt) => { seen.push({ attempt }); },
      },
    );
    expect(seen).toHaveLength(1);
    expect(seen[0]?.attempt).toBe(1);
  });

  it('aborts mid-backoff when signal fires', async () => {
    const controller = new AbortController();
    const promise = withRetry(
      async () => { throw new Error('request failed with status 500'); },
      { baseMs: 200, signal: controller.signal, maxAttempts: 5 },
    );
    setTimeout(() => controller.abort(), 10);
    await expect(promise).rejects.toThrow();
  });

  it('honors Retry-After (retryAfterMs on error) when longer than backoff', async () => {
    const seen: number[] = [];
    let attempts = 0;
    await withRetry(
      async () => {
        attempts++;
        if (attempts < 2) {
          const err = new Error('request failed with status 429') as Error & { retryAfterMs?: number };
          err.retryAfterMs = 50;
          throw err;
        }
        return 'ok';
      },
      {
        baseMs: 1,
        capMs: 500,
        onRetry: (_attempt, delay) => { seen.push(delay); },
      },
    );
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBeGreaterThanOrEqual(50);
  });
});
