import { useCallback, useRef, useState } from 'react';

export type ToastKind = 'info' | 'success' | 'error';

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

interface Options {
  /** Auto-dismiss after N ms. Pass 0 to pin. Default 2800ms. */
  ttl?: number;
}

/**
 * Tiny queue-based toast manager. No portal, no context — caller renders
 * the list wherever it wants via `toasts`. Components that push toasts get
 * stable `push`/`dismiss` refs and a bounded queue (5 newest visible).
 */
export function useToasts(options: Options = {}) {
  const ttl = options.ttl ?? 2800;
  const [toasts, setToasts] = useState<readonly Toast[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const t = timers.current.get(id);
    if (t) { clearTimeout(t); timers.current.delete(id); }
    setToasts((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const push = useCallback((message: string, kind: ToastKind = 'info') => {
    const id = nextId.current++;
    setToasts((prev) => [...prev, { id, kind, message }].slice(-5));
    if (ttl > 0) {
      timers.current.set(id, setTimeout(() => {
        timers.current.delete(id);
        setToasts((prev) => prev.filter((x) => x.id !== id));
      }, ttl));
    }
    return id;
  }, [ttl]);

  return { toasts, push, dismiss };
}
