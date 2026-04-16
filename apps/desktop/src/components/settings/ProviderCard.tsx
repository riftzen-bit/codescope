import { useState, useRef, type CSSProperties } from 'react';
import { KeyIcon, ShieldIcon, TrashIcon } from '../Icons';
import { StatusPill } from './StatusPill';
import type { ProviderConfig, SaveState } from './types';

interface ProviderCardProps {
  provider: string;
  cfg: ProviderConfig;
  hasSavedKey: boolean;
  selectedModel: string;
  isActive: boolean;
  onSaved: (provider: string) => void;
  onDeleted: (provider: string) => void;
  onModelChange: (provider: string, model: string) => void;
  onSetActive: (provider: string) => void;
}

export function ProviderCard({
  provider,
  cfg,
  hasSavedKey,
  selectedModel,
  isActive,
  onSaved,
  onDeleted,
  onModelChange,
  onSetActive,
}: ProviderCardProps) {
  const [value, setValue] = useState('');
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [error, setError] = useState('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearTimer() {
    if (timerRef.current) clearTimeout(timerRef.current);
  }

  function handleChange(v: string) {
    setValue(v);
    if (saveState !== 'idle') setSaveState('idle');
    setError('');
  }

  async function handleSave() {
    const key = value.trim();
    if (!key) return;
    setSaveState('saving');
    clearTimer();
    try {
      await window.api.keysSave(provider, key);
      setValue('');
      setSaveState('saved');
      setError('');
      onSaved(provider);
      timerRef.current = setTimeout(() => setSaveState('idle'), 2800);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Save failed';
      setSaveState('error');
      setError(msg);
    }
  }

  async function handleDelete() {
    clearTimer();
    try {
      await window.api.keysDelete(provider);
      setValue('');
      setSaveState('idle');
      onDeleted(provider);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Delete failed';
      setSaveState('error');
      setError(msg);
    }
  }

  const { Icon, label, placeholder, color, models } = cfg;
  const canSave = value.trim().length > 0;

  return (
    <div
      className={`prov-card${hasSavedKey ? ' prov-card--active' : ''}${isActive ? ' prov-card--selected' : ''}`}
      style={{ '--prov-color': color } as CSSProperties & Record<string, string>}
    >
      {/* Left accent stripe */}
      <div className="prov-stripe" />

      {/* Icon area */}
      <div className="prov-icon-wrap">
        <Icon size={26} className="prov-icon" />
      </div>

      {/* Info + input column */}
      <div className="prov-body">
        <div className="prov-head">
          <div className="prov-head-left">
            <span className="prov-label">{label}</span>
            {isActive && <span className="prov-active-tag">Active</span>}
          </div>
          <div className="prov-status-area">
            {hasSavedKey && saveState === 'idle' && (
              <span className="key-active-badge">
                <ShieldIcon size={11} />
                Key active
              </span>
            )}
            <StatusPill state={saveState} error={error} />
          </div>
        </div>

        {/* Model selection */}
        <div className="prov-model-row">
          <label className="prov-model-label">Model</label>
          <select
            className="prov-model-select"
            value={selectedModel}
            onChange={(e) => onModelChange(provider, e.target.value)}
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}{m.description ? ` — ${m.description}` : ''}
              </option>
            ))}
          </select>
        </div>

        {/* API Key input */}
        <div className="prov-input-row">
          <div className="prov-input-wrap">
            <KeyIcon size={13} className="prov-input-icon" />
            <input
              className="prov-input"
              type="password"
              placeholder={hasSavedKey ? '••••••••••••••••' : placeholder}
              value={value}
              onChange={(e) => handleChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleSave(); }}
              autoComplete="off"
              data-1p-ignore
              spellCheck={false}
            />
          </div>

          <button
            className="prov-save-btn"
            onClick={() => void handleSave()}
            disabled={!canSave || saveState === 'saving'}
          >
            {saveState === 'saving' ? <span className="sp-spinner" /> : null}
            {saveState === 'saving' ? 'Saving' : 'Save'}
          </button>

          {hasSavedKey && (
            <button
              className="prov-delete-btn"
              onClick={() => void handleDelete()}
              title="Remove saved key"
            >
              <TrashIcon size={13} />
            </button>
          )}
        </div>

        {/* Set as active button */}
        {hasSavedKey && !isActive && (
          <button
            className="prov-set-active-btn"
            onClick={() => onSetActive(provider)}
          >
            Set as default provider
          </button>
        )}
      </div>
    </div>
  );
}
