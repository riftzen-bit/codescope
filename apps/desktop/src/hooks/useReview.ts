import { useState, useCallback, useRef } from 'react';
import type { ReviewRequest, ReviewResult } from '../types';

export type ReviewState =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'streaming'; chunks: string }
  | { status: 'done'; result: ReviewResult }
  | { status: 'error'; message: string };

export function useReview() {
  const [state, setState] = useState<ReviewState>({ status: 'idle' });
  const unsubRef = useRef<(() => void) | null>(null);

  const cancel = useCallback(() => {
    if (unsubRef.current) {
      unsubRef.current();
      unsubRef.current = null;
    }
    setState({ status: 'idle' });
  }, []);

  const run = useCallback((req: ReviewRequest) => {
    // Cancel any in-flight review
    if (unsubRef.current) {
      unsubRef.current();
      unsubRef.current = null;
    }

    setState({ status: 'streaming', chunks: '' });

    const unsub = window.api.reviewStream(
      req,
      (chunk) => {
        setState((prev) => ({
          status: 'streaming',
          chunks: prev.status === 'streaming' ? prev.chunks + chunk : chunk,
        }));
      },
      (result) => {
        unsubRef.current = null;
        setState({ status: 'done', result });
      },
      (err) => {
        unsubRef.current = null;
        setState({ status: 'error', message: err });
      },
    );

    unsubRef.current = unsub;
  }, []);

  const reset = useCallback(() => {
    cancel();
    setState({ status: 'idle' });
  }, [cancel]);

  const restore = useCallback((result: ReviewResult) => {
    cancel();
    setState({ status: 'done', result });
  }, [cancel]);

  return { state, run, cancel, reset, restore };
}
