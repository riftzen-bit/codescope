import { useState, useEffect, useCallback } from 'react';
import type { HistoryEntry, ReviewResult } from '../types';

export function useHistoryPanel() {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    window.api.historyList().then(setHistory).catch((err) => console.error('Failed to load history:', err));
  }, []);

  const addToHistory = useCallback((entry: HistoryEntry) => {
    setHistory((prev) => [entry, ...prev].slice(0, 50));
  }, []);

  const deleteEntry = useCallback(async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await window.api.historyDelete(id);
      setHistory((prev) => prev.filter((h) => h.id !== id));
    } catch (err) {
      console.error('Failed to delete history entry:', err);
    }
  }, []);

  const clearAll = useCallback(async () => {
    try {
      await window.api.historyClear();
      setHistory([]);
      setShowHistory(false);
    } catch (err) {
      console.error('Failed to clear history:', err);
    }
  }, []);

  const toggle = useCallback(() => {
    setShowHistory((prev) => !prev);
  }, []);

  const close = useCallback(() => {
    setShowHistory(false);
  }, []);

  return {
    history,
    showHistory,
    addToHistory,
    deleteEntry,
    clearAll,
    toggle,
    close,
  };
}
