import { useState, useRef, useEffect, useCallback, type CSSProperties } from 'react';
import { CheckCircleIcon, XCircleIcon, LinkIcon } from '../Icons';
import { PROVIDER_CONFIGS } from './providers';
import type { OllamaStatus } from './types';

interface OllamaCardProps {
  url: string;
  selectedModel: string;
  isActive: boolean;
  onUrlChange: (url: string) => void;
  onModelChange: (model: string) => void;
  onSetActive: () => void;
}

export function OllamaCard({
  url,
  selectedModel,
  isActive,
  onUrlChange,
  onModelChange,
  onSetActive,
}: OllamaCardProps) {
  const [status, setStatus] = useState<OllamaStatus>('idle');
  const [message, setMessage] = useState('');
  const [localUrl, setLocalUrl] = useState(url);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const cfg = PROVIDER_CONFIGS['ollama']!;
  const { Icon, color, label, models } = cfg;

  useEffect(() => { setLocalUrl(url); }, [url]);

  const debouncedSave = useCallback((newUrl: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onUrlChange(newUrl);
    }, 600);
  }, [onUrlChange]);

  async function handleTest() {
    setStatus('testing');
    setMessage('');
    try {
      const { count } = await window.api.ollamaTest(localUrl);
      setStatus('ok');
      setMessage(`Connected \u2014 ${count} model${count !== 1 ? 's' : ''} available`);
    } catch (e) {
      setStatus('fail');
      setMessage(e instanceof Error ? e.message : 'Connection failed');
    }
  }

  function handleUrlInputChange(newUrl: string) {
    setLocalUrl(newUrl);
    setStatus('idle');
    setMessage('');
    debouncedSave(newUrl);
  }

  function handleUrlBlur() {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    onUrlChange(localUrl);
  }

  return (
    <div
      className={`prov-card prov-card--ollama${isActive ? ' prov-card--selected' : ''}`}
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
            {status === 'ok' && (
              <span className="key-active-badge key-active-badge--green">
                <CheckCircleIcon size={11} />
                Online
              </span>
            )}
            {status === 'fail' && (
              <span className="key-active-badge key-active-badge--red">
                <XCircleIcon size={11} />
                Offline
              </span>
            )}
          </div>
        </div>

        {/* Model selection */}
        <div className="prov-model-row">
          <label className="prov-model-label">Model</label>
          <input
            className="prov-model-select"
            list="ollama-models"
            value={selectedModel}
            onChange={(e) => onModelChange(e.target.value)}
            placeholder="e.g. gemma4:31b"
            spellCheck={false}
            autoComplete="off"
          />
          <datalist id="ollama-models">
            {models.map((m) => (
              <option key={m.id} value={m.id} />
            ))}
          </datalist>
        </div>

        {/* URL input */}
        <div className="prov-input-row">
          <div className="prov-input-wrap">
            <LinkIcon size={13} className="prov-input-icon" />
            <input
              className="prov-input"
              type="text"
              value={localUrl}
              onChange={(e) => handleUrlInputChange(e.target.value)}
              onBlur={handleUrlBlur}
              placeholder="http://localhost:11434"
              spellCheck={false}
            />
          </div>

          <button
            className="prov-save-btn"
            onClick={() => void handleTest()}
            disabled={status === 'testing'}
          >
            {status === 'testing' && <span className="sp-spinner" />}
            {status === 'testing' ? 'Testing' : 'Test'}
          </button>
        </div>

        {message && (
          <div className={`ollama-msg${status === 'ok' ? ' ollama-msg--ok' : status === 'fail' ? ' ollama-msg--fail' : ''}`}>
            {status === 'ok' ? <CheckCircleIcon size={13} /> : <XCircleIcon size={13} />}
            {message}
          </div>
        )}

        <p className="ollama-hint">
          Run <code>ollama serve</code> locally — no API key needed.
        </p>

        {/* Set as active button */}
        {status === 'ok' && !isActive && (
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
