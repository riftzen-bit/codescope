import { useState, useRef, type CSSProperties } from 'react';
import { KeyIcon, CheckCircleIcon, XCircleIcon, ShieldIcon, TrashIcon } from '../Icons';
import { StatusPill } from './StatusPill';
import { PROVIDER_CONFIGS } from './providers';
import type { SaveState } from './types';

type CliStatus = 'idle' | 'testing' | 'ok' | 'fail';

interface ClaudeCodeCardProps {
  hasSavedToken: boolean;
  selectedModel: string;
  isActive: boolean;
  onTokenSaved: () => void;
  onTokenDeleted: () => void;
  onModelChange: (model: string) => void;
  onSetActive: () => void;
}

export function ClaudeCodeCard({
  hasSavedToken,
  selectedModel,
  isActive,
  onTokenSaved,
  onTokenDeleted,
  onModelChange,
  onSetActive,
}: ClaudeCodeCardProps) {
  const [tokenValue, setTokenValue] = useState('');
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState('');
  const [cliStatus, setCliStatus] = useState<CliStatus>('idle');
  const [cliMessage, setCliMessage] = useState('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const cfg = PROVIDER_CONFIGS['claude-code']!;
  const { Icon, color, label, models } = cfg;

  function clearTimer() {
    if (timerRef.current) clearTimeout(timerRef.current);
  }

  async function handleSaveToken() {
    const token = tokenValue.trim();
    if (!token) return;
    setSaveState('saving');
    clearTimer();
    try {
      await window.api.keysSave('claude-code', token);
      setTokenValue('');
      setSaveState('saved');
      setSaveError('');
      onTokenSaved();
      timerRef.current = setTimeout(() => setSaveState('idle'), 2800);
    } catch (e) {
      setSaveState('error');
      setSaveError(e instanceof Error ? e.message : 'Save failed');
    }
  }

  async function handleDeleteToken() {
    clearTimer();
    try {
      await window.api.keysDelete('claude-code');
      setTokenValue('');
      setSaveState('idle');
      onTokenDeleted();
    } catch (e) {
      setSaveState('error');
      setSaveError(e instanceof Error ? e.message : 'Delete failed');
    }
  }

  async function handleTestCli() {
    setCliStatus('testing');
    setCliMessage('');
    try {
      const { installed, version } = await window.api.claudeCodeTest();
      if (installed) {
        setCliStatus('ok');
        setCliMessage(`Installed \u2014 ${version}`);
      } else {
        setCliStatus('fail');
        setCliMessage('Claude Code CLI not found in PATH');
      }
    } catch (e) {
      setCliStatus('fail');
      setCliMessage(e instanceof Error ? e.message : 'Test failed');
    }
  }

  function handleTokenChange(v: string) {
    setTokenValue(v);
    if (saveState !== 'idle') setSaveState('idle');
    setSaveError('');
  }

  const canSave = tokenValue.trim().length > 0;

  return (
    <div
      className={`prov-card prov-card--claude-code${isActive ? ' prov-card--selected' : ''}${hasSavedToken ? ' prov-card--active' : ''}`}
      style={{ '--prov-color': color } as CSSProperties & Record<string, string>}
    >
      <div className="prov-stripe" />

      <div className="prov-icon-wrap">
        <Icon size={26} className="prov-icon" />
      </div>

      <div className="prov-body">
        <div className="prov-head">
          <div className="prov-head-left">
            <span className="prov-label">{label}</span>
            {isActive && <span className="prov-active-tag">Active</span>}
          </div>
          <div className="prov-status-area">
            {hasSavedToken && saveState === 'idle' && (
              <span className="key-active-badge">
                <ShieldIcon size={11} />
                Token active
              </span>
            )}
            <StatusPill state={saveState} error={saveError} />
          </div>
        </div>

        {/* Model selection */}
        <div className="prov-model-row">
          <label className="prov-model-label">Model</label>
          <select
            className="prov-model-select"
            value={selectedModel}
            onChange={(e) => onModelChange(e.target.value)}
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}{m.description ? ` — ${m.description}` : ''}
              </option>
            ))}
          </select>
        </div>

        {/* Token input */}
        <div className="prov-input-row">
          <div className="prov-input-wrap">
            <KeyIcon size={13} className="prov-input-icon" />
            <input
              className="prov-input"
              type="password"
              placeholder={hasSavedToken ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' : 'Paste token from Claude Code setup'}
              value={tokenValue}
              onChange={(e) => handleTokenChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleSaveToken(); }}
              autoComplete="off"
              data-1p-ignore
              spellCheck={false}
            />
          </div>

          <button
            className="prov-save-btn"
            onClick={() => void handleSaveToken()}
            disabled={!canSave || saveState === 'saving'}
          >
            {saveState === 'saving' ? <span className="sp-spinner" /> : null}
            {saveState === 'saving' ? 'Saving' : 'Save'}
          </button>

          {hasSavedToken && (
            <button
              className="prov-delete-btn"
              onClick={() => void handleDeleteToken()}
              title="Remove saved token"
            >
              <TrashIcon size={13} />
            </button>
          )}
        </div>

        {/* CLI test row */}
        <div className="prov-input-row" style={{ marginTop: '6px' }}>
          <button
            className="prov-save-btn"
            onClick={() => void handleTestCli()}
            disabled={cliStatus === 'testing'}
          >
            {cliStatus === 'testing' && <span className="sp-spinner" />}
            {cliStatus === 'testing' ? 'Testing' : 'Test CLI'}
          </button>

          {cliStatus === 'ok' && (
            <span className="key-active-badge key-active-badge--green">
              <CheckCircleIcon size={11} />
              Installed
            </span>
          )}
          {cliStatus === 'fail' && (
            <span className="key-active-badge key-active-badge--red">
              <XCircleIcon size={11} />
              Not found
            </span>
          )}
        </div>

        {cliMessage && (
          <div className={`ollama-msg${cliStatus === 'ok' ? ' ollama-msg--ok' : cliStatus === 'fail' ? ' ollama-msg--fail' : ''}`}>
            {cliStatus === 'ok' ? <CheckCircleIcon size={13} /> : <XCircleIcon size={13} />}
            {cliMessage}
          </div>
        )}

        <p className="ollama-hint">
          Token is optional. If not set, uses Anthropic API key or <code>claude login</code> credentials.
        </p>

        {/* Set as active button */}
        {(hasSavedToken || cliStatus === 'ok') && !isActive && (
          <button
            className="prov-set-active-btn"
            onClick={onSetActive}
          >
            Set as default provider
          </button>
        )}
      </div>
    </div>
  );
}
