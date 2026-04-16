/**
 * Serialized write queue — ensures only one write runs at a time.
 * Each write starts from a clean state regardless of prior failures.
 */
export function createWriteQueue() {
  let queue: Promise<void> = Promise.resolve();

  return function enqueue(fn: () => Promise<void>): Promise<void> {
    queue = queue.catch((err) => { console.error('writeQueue: prior write failed:', err); }).then(fn);
    return queue;
  };
}
