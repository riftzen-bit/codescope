import { useState, useEffect, useCallback } from 'react';

const MAX_DROP_BYTES = 2 * 1024 * 1024;

export function useDragDrop(onFile: (content: string, name: string) => void) {
  const [isDragging, setIsDragging] = useState(false);
  const [dropError, setDropError] = useState<string | null>(null);

  const clearDropError = useCallback(() => setDropError(null), []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (!file) return;
    if (file.size > MAX_DROP_BYTES) {
      setDropError(
        `File too large (${Math.round(file.size / 1024)}KB). Maximum is 2MB.`,
      );
      return;
    }
    setDropError(null);
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        onFile(reader.result, file.name);
      }
    };
    reader.onerror = () => {
      setDropError('Failed to read dropped file.');
    };
    reader.readAsText(file);
  }, [onFile]);

  // Window-level drag detection — bypasses Monaco's event interception
  useEffect(() => {
    let counter = 0;
    const onEnter = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) {
        counter++;
        setIsDragging(true);
      }
    };
    const onLeave = () => {
      counter--;
      if (counter <= 0) { counter = 0; setIsDragging(false); }
    };
    const onDrop = () => {
      counter = 0;
      setIsDragging(false);
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  return { isDragging, handleDrop, dropError, clearDropError };
}
