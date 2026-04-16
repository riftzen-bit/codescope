import { useState, useEffect, useRef } from 'react';
import { KeyIcon, ServerIcon, TerminalIcon } from './Icons';
import { ProviderCard, OllamaCard, ClaudeCodeCard, CLOUD_PROVIDERS, PROVIDER_CONFIGS } from './settings';
import type { AppSettings } from '../types';

type Theme = 'light' | 'dark' | 'system';

interface SettingsViewProps {
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
}

export function SettingsView({ theme, onThemeChange }: SettingsViewProps) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [savedKeys, setSavedKeys] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [historyCount, setHistoryCount] = useState<number>(0);
  const importInputRef = useRef<HTMLInputElement>(null);

  // Load settings and keys on mount
  useEffect(() => {
    async function load() {
      try {
        const [loadedSettings, providers, history] = await Promise.all([
          window.api.settingsGet(),
          window.api.keysList(),
          window.api.historyList(),
        ]);
        setSettings(loadedSettings);
        setSavedKeys(new Set(providers));
        setHistoryCount(history.length);
      } catch (err) {
        console.error('Failed to load settings:', err);
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  function handleKeySaved(provider: string) {
    setSavedKeys((prev) => new Set([...prev, provider]));
  }

  function handleKeyDeleted(provider: string) {
    setSavedKeys((prev) => {
      const next = new Set(prev);
      next.delete(provider);
      return next;
    });
  }

  async function handleModelChange(provider: string, model: string) {
    try {
      const updated = await window.api.settingsSetModel(provider, model);
      setSettings(updated);
    } catch (err) {
      console.error('Failed to update model:', err);
    }
  }

  async function handleSetActiveProvider(provider: string) {
    try {
      const updated = await window.api.settingsSetProvider(provider);
      setSettings(updated);
    } catch (err) {
      console.error('Failed to set active provider:', err);
    }
  }

  async function handleOllamaUrlChange(url: string) {
    try {
      const updated = await window.api.settingsSetOllamaUrl(url);
      setSettings(updated);
    } catch (err) {
      console.error('Failed to update Ollama URL:', err);
    }
  }

  async function handleToggleAutoSave() {
    if (!settings) return;
    try {
      const updated = await window.api.settingsUpdate({ autoSaveHistory: !settings.autoSaveHistory });
      setSettings(updated);
    } catch (err) {
      console.error('Failed to update autoSaveHistory:', err);
    }
  }

  async function handleToggleAllowLan() {
    if (!settings) return;
    try {
      const updated = await window.api.settingsUpdate({ allowLanAccess: !settings.allowLanAccess });
      setSettings(updated);
    } catch (err) {
      console.error('Failed to update allowLanAccess:', err);
    }
  }

  async function handleDefaultLanguageChange(lang: string) {
    try {
      const updated = await window.api.settingsUpdate({ defaultLanguage: lang });
      setSettings(updated);
    } catch (err) {
      console.error('Failed to update defaultLanguage:', err);
    }
  }

  function handleExportSettings() {
    if (!settings) return;
    const json = JSON.stringify(settings, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'codescope-settings.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function handleImportClick() {
    importInputRef.current?.click();
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as Partial<AppSettings>;
      const updated = await window.api.settingsImport(parsed);
      setSettings(updated);
    } catch (err) {
      console.error('Failed to import settings:', err);
    }
  }

  async function handleClearHistory() {
    const confirmed = await window.api.confirm(
      'Clear all review history? This cannot be undone.',
    );
    if (!confirmed) return;
    try {
      await window.api.historyClear();
      setHistoryCount(0);
    } catch (err) {
      console.error('Failed to clear history:', err);
    }
  }

  if (loading || !settings) {
    return (
      <div className="settings-view">
        <div className="sv-loading">Loading settings...</div>
      </div>
    );
  }

  return (
    <div className="settings-view">
      {/* Page header */}
      <div className="sv-header">
        <div className="sv-header-inner">
          <h1 className="sv-title">Settings</h1>
          <p className="sv-subtitle">Configure AI providers and connections</p>
        </div>
        <div className="sv-header-rule" />
      </div>

      {/* API Keys section */}
      <section className="sv-section">
        <div className="sv-section-label">
          <KeyIcon size={12} />
          API Keys
          <span className="sv-section-count">
            {savedKeys.size} / {CLOUD_PROVIDERS.length} configured
          </span>
        </div>

        <div className="prov-grid">
          {CLOUD_PROVIDERS.map((cfg) => (
            <ProviderCard
              key={cfg.id}
              provider={cfg.id}
              cfg={cfg}
              hasSavedKey={savedKeys.has(cfg.id)}
              selectedModel={settings.providers[cfg.id]?.model ?? cfg.models[0]?.id ?? ''}
              isActive={settings.activeProvider === cfg.id}
              onSaved={handleKeySaved}
              onDeleted={handleKeyDeleted}
              onModelChange={handleModelChange}
              onSetActive={handleSetActiveProvider}
            />
          ))}
        </div>
      </section>

      {/* Local Models section */}
      <section className="sv-section">
        <div className="sv-section-label">
          <ServerIcon size={12} />
          Local Models
        </div>
        <OllamaCard
          url={settings.ollamaUrl}
          selectedModel={settings.providers['ollama']?.model ?? PROVIDER_CONFIGS['ollama']?.models[0]?.id ?? 'llama3.2'}
          isActive={settings.activeProvider === 'ollama'}
          onUrlChange={handleOllamaUrlChange}
          onModelChange={(model) => handleModelChange('ollama', model)}
          onSetActive={() => handleSetActiveProvider('ollama')}
        />
      </section>

      {/* Claude Code CLI section */}
      <section className="sv-section">
        <div className="sv-section-label">
          <TerminalIcon size={12} />
          Claude Code CLI
        </div>
        <ClaudeCodeCard
          hasSavedToken={savedKeys.has('claude-code')}
          selectedModel={settings.providers['claude-code']?.model ?? PROVIDER_CONFIGS['claude-code']?.models[0]?.id ?? 'claude-sonnet-4-6'}
          isActive={settings.activeProvider === 'claude-code'}
          onTokenSaved={() => handleKeySaved('claude-code')}
          onTokenDeleted={() => handleKeyDeleted('claude-code')}
          onModelChange={(model) => handleModelChange('claude-code', model)}
          onSetActive={() => handleSetActiveProvider('claude-code')}
        />
      </section>

      {/* Appearance section */}
      <section className="sv-section">
        <div className="sv-section-label">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="0.8"/>
            <path d="M6 1A5 5 0 016 11" fill="currentColor"/>
          </svg>
          Appearance
        </div>
        <div className="theme-selector">
          <label className="theme-selector-label">Theme</label>
          <div className="theme-options">
            {(['light', 'dark', 'system'] as const).map((t) => (
              <button
                key={t}
                className={`theme-option${theme === t ? ' theme-option--active' : ''}`}
                onClick={() => onThemeChange(t)}
              >
                {t === 'light' && (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <circle cx="7" cy="7" r="3" stroke="currentColor" strokeWidth="1.2"/>
                    <path d="M7 1V2.5M7 11.5V13M1 7H2.5M11.5 7H13M3 3L4 4M10 10L11 11M11 3L10 4M4 10L3 11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                  </svg>
                )}
                {t === 'dark' && (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M12 8.5A5.5 5.5 0 115.5 2a4.5 4.5 0 006.5 6.5z" stroke="currentColor" strokeWidth="1.2"/>
                  </svg>
                )}
                {t === 'system' && (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <rect x="2" y="2" width="10" height="7" rx="1" stroke="currentColor" strokeWidth="1.2"/>
                    <path d="M5 12H9M7 9V12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                  </svg>
                )}
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Review Preferences section */}
      <section className="sv-section">
        <div className="sv-section-label">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <rect x="1" y="2" width="10" height="8" rx="1" stroke="currentColor" strokeWidth="0.8"/>
            <path d="M3 5h6M3 7h4" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round"/>
          </svg>
          Review Preferences
        </div>
        <div className="sv-prefs-card">
          <div className="sv-pref-row">
            <div className="sv-pref-info">
              <span className="sv-pref-label">Auto-save reviews to history</span>
              <span className="sv-pref-hint">Automatically save completed reviews</span>
            </div>
            <button
              className={`sv-toggle${settings.autoSaveHistory ? ' sv-toggle--on' : ''}`}
              onClick={handleToggleAutoSave}
              aria-label="Toggle auto-save history"
            >
              <span className="sv-toggle-thumb" />
            </button>
          </div>
          <div className="sv-pref-divider" />
          <div className="sv-pref-row">
            <div className="sv-pref-info">
              <span className="sv-pref-label">Allow LAN access</span>
              <span className="sv-pref-hint">Allow Ollama URLs on private network (not just localhost)</span>
            </div>
            <button
              className={`sv-toggle${settings.allowLanAccess ? ' sv-toggle--on' : ''}`}
              onClick={handleToggleAllowLan}
              aria-label="Toggle LAN access"
            >
              <span className="sv-toggle-thumb" />
            </button>
          </div>
          <div className="sv-pref-divider" />
          <div className="sv-pref-row">
            <div className="sv-pref-info">
              <span className="sv-pref-label">Default language</span>
              <span className="sv-pref-hint">Pre-select language for new reviews</span>
            </div>
            <select
              className="sv-pref-select"
              value={settings.defaultLanguage}
              onChange={(e) => handleDefaultLanguageChange(e.target.value)}
            >
              <option value="auto">Auto-detect</option>
              <option value="typescript">TypeScript</option>
              <option value="javascript">JavaScript</option>
              <option value="python">Python</option>
              <option value="rust">Rust</option>
              <option value="go">Go</option>
              <option value="java">Java</option>
              <option value="csharp">C#</option>
              <option value="ruby">Ruby</option>
              <option value="php">PHP</option>
              <option value="swift">Swift</option>
              <option value="kotlin">Kotlin</option>
              <option value="cpp">C/C++</option>
            </select>
          </div>
          <div className="sv-pref-divider" />
          <div className="sv-pref-row">
            <div className="sv-pref-info">
              <span className="sv-pref-label">Max review characters</span>
              <span className="sv-pref-hint">Maximum code input per review</span>
            </div>
            <span className="sv-pref-value">200,000</span>
          </div>
        </div>
      </section>

      {/* Data Management section */}
      <section className="sv-section">
        <div className="sv-section-label">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <ellipse cx="6" cy="3" rx="4" ry="1.5" stroke="currentColor" strokeWidth="0.8"/>
            <path d="M2 3v6c0 .83 1.79 1.5 4 1.5s4-.67 4-1.5V3" stroke="currentColor" strokeWidth="0.8"/>
            <path d="M2 6c0 .83 1.79 1.5 4 1.5S10 6.83 10 6" stroke="currentColor" strokeWidth="0.8"/>
          </svg>
          Data Management
        </div>
        <div className="sv-prefs-card">
          <div className="sv-data-row">
            <div className="sv-pref-info">
              <span className="sv-pref-label">Export Settings</span>
              <span className="sv-pref-hint">Download current settings as JSON</span>
            </div>
            <button className="sv-data-btn" onClick={handleExportSettings}>
              Export
            </button>
          </div>
          <div className="sv-pref-divider" />
          <div className="sv-data-row">
            <div className="sv-pref-info">
              <span className="sv-pref-label">Import Settings</span>
              <span className="sv-pref-hint">Load settings from a JSON file</span>
            </div>
            <button className="sv-data-btn" onClick={handleImportClick}>
              Import
            </button>
            <input
              ref={importInputRef}
              type="file"
              accept=".json,application/json"
              style={{ display: 'none' }}
              onChange={handleImportFile}
            />
          </div>
          <div className="sv-pref-divider" />
          <div className="sv-data-row">
            <div className="sv-pref-info">
              <span className="sv-pref-label">Clear Review History</span>
              <span className="sv-pref-hint">{historyCount} saved {historyCount === 1 ? 'review' : 'reviews'}</span>
            </div>
            <button className="sv-data-btn sv-data-btn--danger" onClick={handleClearHistory}>
              Clear
            </button>
          </div>
        </div>
      </section>

      {/* About section */}
      <section className="sv-section">
        <div className="sv-section-label">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="0.8"/>
            <path d="M6 5.5v3M6 4h.01" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round"/>
          </svg>
          About
        </div>
        <div className="sv-about-card">
          <div className="sv-about-name">CodeScope</div>
          <div className="sv-about-version">Version 0.1.0</div>
          <div className="sv-about-platform">{navigator.userAgent}</div>
          <div className="sv-about-credit">Built with Electron + React</div>
        </div>
      </section>
    </div>
  );
}
