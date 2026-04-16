import type { ReactNode } from 'react';
import { CheckCircleIcon, XCircleIcon } from '../Icons';
import type { SaveState } from './types';

interface StatusPillProps {
  state: SaveState;
  error: string;
}

export function StatusPill({ state, error }: StatusPillProps) {
  if (state === 'idle') return null;

  const map: Record<Exclude<SaveState, 'idle'>, { icon: ReactNode; text: string; cls: string }> = {
    saving: {
      icon: <span className="sp-spinner" />,
      text: 'Saving…',
      cls: 'sp-saving',
    },
    saved: {
      icon: <CheckCircleIcon size={13} />,
      text: 'Saved',
      cls: 'sp-saved',
    },
    error: {
      icon: <XCircleIcon size={13} />,
      text: error || 'Failed',
      cls: 'sp-error',
    },
  };

  const { icon, text, cls } = map[state];

  return (
    <span className={`save-pill ${cls}`}>
      {icon}
      {text}
    </span>
  );
}
