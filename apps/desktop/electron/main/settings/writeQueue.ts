/**
 * Per-path write queue — writes to the SAME file serialize, writes to
 * DIFFERENT files run concurrently. Prevents an unrelated in-flight write
 * from blocking a save to a separate file.
 *
 * A per-task timeout prevents a hung write (e.g. network drive that never
 * acknowledges fs.writeFile) from blocking every subsequent enqueue on the
 * same path forever.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Crash-safe write: data lands at `<target>.tmp`, fsync flushes it to the
 * platter, then fs.rename atomically replaces the target. A mid-write crash
 * leaves the original file intact (or a stale `.tmp` which the next run
 * overwrites). Without this, a single fs.writeFile on settings.json /
 * history.json / secure-keys.json can be observed truncated after power
 * loss — which silently drops every stored encrypted API key next boot.
 *
 * fs.rename on Windows maps to ReplaceFileW on NTFS since Node 17, and is
 * atomic on POSIX. Same-volume only (`.tmp` lives next to the target).
 */
export async function atomicWriteFile(
  target: string,
  data: string | Buffer,
  opts?: { mode?: number },
): Promise<void> {
  const tmp = target + '.tmp';
  const handle = await fs.open(tmp, 'w', opts?.mode ?? 0o600);
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(tmp, target);
}

export interface WriteQueueOptions {
  /** Milliseconds after which a single task is rejected and the queue advances. */
  timeoutMs?: number;
  /**
   * Invoked when the prior write for a key rejected. The queue continues to
   * the next enqueued task regardless (the original awaiter already saw its
   * rejection). Use this to surface failures via structured telemetry rather
   * than relying on console.error, which is easy to miss in packaged builds.
   * Thrown errors from the hook are swallowed so one bad sink cannot wedge
   * the queue.
   */
  onError?: (key: string, err: unknown) => void;
}

const DEFAULT_TIMEOUT_MS = 10_000;

export type EnqueueFn = (key: string, fn: () => Promise<void>) => Promise<void>;

export function createWriteQueue(options: WriteQueueOptions = {}): EnqueueFn {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const onError = options.onError;
  const queues = new Map<string, Promise<void>>();

  return function enqueue(key: string, fn: () => Promise<void>): Promise<void> {
    // Normalize so `/a/./b` and `/a/b` share a lane.
    const normKey = path.resolve(key);
    const prior = queues.get(normKey) ?? Promise.resolve();
    const next = prior
      .catch((err) => {
        console.error(`writeQueue[${normKey}]: prior write failed:`, err);
        if (onError) {
          try { onError(normKey, err); } catch (hookErr) {
            console.error(`writeQueue[${normKey}]: onError hook threw:`, hookErr);
          }
        }
      })
      .then(() => new Promise<void>((resolve, reject) => {
        let done = false;
        const timer = setTimeout(() => {
          if (done) return;
          done = true;
          reject(new Error(`writeQueue: task exceeded timeout ${timeoutMs}ms`));
        }, timeoutMs);
        fn().then(
          () => { if (done) return; done = true; clearTimeout(timer); resolve(); },
          (err) => { if (done) return; done = true; clearTimeout(timer); reject(err); },
        );
      }));
    queues.set(normKey, next);
    // Drop the entry once this write settles AND no follow-up has replaced it.
    // Prevents unbounded Map growth when many distinct paths are written once.
    next.finally(() => {
      if (queues.get(normKey) === next) queues.delete(normKey);
    });
    return next;
  };
}
