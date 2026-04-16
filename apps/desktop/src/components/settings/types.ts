import type { ComponentType } from 'react';

export interface ProviderConfig {
  id: string;
  label: string;
  placeholder: string;
  hasKey: boolean;
  description: string;
  color: string;
  Icon: ComponentType<{ size?: number; className?: string }>;
  models: ModelOption[];
}

export interface ModelOption {
  id: string;
  label: string;
  description?: string;
}

export type OllamaStatus = 'idle' | 'testing' | 'ok' | 'fail';
export type SaveState = 'idle' | 'saving' | 'saved' | 'error';
