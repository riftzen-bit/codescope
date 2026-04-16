import { useState, useCallback, useEffect } from 'react';
import { ReviewView } from './components/ReviewView';
import { SettingsView } from './components/SettingsView';
import { ProjectView } from './components/ProjectView';
import { GuideView } from './components/GuideView';
import type { ProjectFile, AppSettings } from './types';

type View = 'review' | 'projects' | 'settings' | 'guide';
type Theme = 'light' | 'dark' | 'system';

interface ProjectReviewState {
  files: ProjectFile[];
  projectName: string;
  projectPath: string;
}

function applyTheme(theme: Theme): void {
  let resolved: 'light' | 'dark' = 'light';
  if (theme === 'dark') {
    resolved = 'dark';
  } else if (theme === 'system') {
    resolved = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.documentElement.setAttribute('data-theme', resolved);
}

export function App() {
  const [view, setView] = useState<View>('review');
  const [projectReview, setProjectReview] = useState<ProjectReviewState | null>(null);
  const [theme, setTheme] = useState<Theme>('light');

  useEffect(() => {
    window.api.settingsGet().then((s) => {
      setTheme(s.theme || 'light');
      applyTheme(s.theme || 'light');
    }).catch((err) => { console.error('Failed to load settings:', err); });
  }, []);

  useEffect(() => {
    applyTheme(theme);
    if (theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const handler = () => applyTheme('system');
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    }
  }, [theme]);

  // Prevent Electron from navigating when files are dropped anywhere on the window
  useEffect(() => {
    const prevent = (e: DragEvent) => e.preventDefault();
    document.addEventListener('dragover', prevent);
    document.addEventListener('drop', prevent);
    return () => {
      document.removeEventListener('dragover', prevent);
      document.removeEventListener('drop', prevent);
    };
  }, []);

  const handleThemeChange = useCallback(async (newTheme: Theme) => {
    setTheme(newTheme);
    applyTheme(newTheme);
    try {
      await window.api.settingsUpdate({ theme: newTheme });
    } catch {
      // Non-fatal
    }
  }, []);

  const handleReviewProject = useCallback((files: ProjectFile[], projectName: string, projectPath: string) => {
    setProjectReview({ files, projectName, projectPath });
    setView('review');
  }, []);

  const handleRescanProject = useCallback(async () => {
    if (!projectReview) return;
    const files = await window.api.readProjectFiles(projectReview.projectPath);
    setProjectReview((prev) => prev ? { ...prev, files } : null);
  }, [projectReview]);

  const handleClearProjectReview = useCallback(() => {
    setProjectReview(null);
  }, []);

  return (
    <div className="app">
      <nav className="nav">
        <div className="nav-left">
          {/* Brand */}
          <div className="nav-logo">
            <div className="nav-logo-mark">
              <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M6 7L10 10L6 13" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <line x1="12" y1="13" x2="15" y2="13" stroke="white" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </div>
            <span className="nav-title">CodeScope</span>
          </div>

          <div className="nav-divider" />

          <button
            className={`nav-btn${view === 'review' ? ' active' : ''}`}
            onClick={() => setView('review')}
          >
            <svg className="nav-btn-icon" viewBox="0 0 12 12" fill="none">
              <rect x="0.5" y="0.5" width="11" height="11" stroke="currentColor" strokeWidth="0.8"/>
              <line x1="2" y1="4" x2="10" y2="4" stroke="currentColor" strokeWidth="0.8"/>
              <line x1="2" y1="6" x2="8" y2="6" stroke="currentColor" strokeWidth="0.8"/>
              <line x1="2" y1="8" x2="6" y2="8" stroke="currentColor" strokeWidth="0.8"/>
            </svg>
            Review
          </button>

          <button
            className={`nav-btn${view === 'projects' ? ' active' : ''}`}
            onClick={() => setView('projects')}
          >
            <svg className="nav-btn-icon" viewBox="0 0 12 12" fill="none">
              <rect x="1" y="2.5" width="10" height="8" rx="1" stroke="currentColor" strokeWidth="0.8"/>
              <path d="M1 5H11" stroke="currentColor" strokeWidth="0.8"/>
              <path d="M4 2.5V1" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round"/>
            </svg>
            Projects
          </button>

          <button
            className={`nav-btn${view === 'guide' ? ' active' : ''}`}
            onClick={() => setView('guide')}
          >
            <svg className="nav-btn-icon" viewBox="0 0 12 12" fill="none">
              <rect x="1" y="1" width="10" height="10" rx="2" stroke="currentColor" strokeWidth="0.8"/>
              <line x1="4" y1="4" x2="8" y2="4" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round"/>
              <line x1="4" y1="6" x2="8" y2="6" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round"/>
              <line x1="4" y1="8" x2="6" y2="8" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round"/>
            </svg>
            Guide
          </button>

          <button
            className={`nav-btn${view === 'settings' ? ' active' : ''}`}
            onClick={() => setView('settings')}
          >
            <svg className="nav-btn-icon" viewBox="0 0 12 12" fill="none">
              <circle cx="6" cy="6" r="2" stroke="currentColor" strokeWidth="0.8"/>
              <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="0.8" strokeDasharray="2 2"/>
            </svg>
            Config
          </button>
        </div>

        <div className="nav-right">
          <button
            className="nav-btn"
            onClick={() => handleThemeChange(theme === 'dark' ? 'light' : 'dark')}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          >
            {theme === 'dark' ? (
              <svg className="nav-btn-icon" viewBox="0 0 12 12" fill="none">
                <circle cx="6" cy="6" r="3" stroke="currentColor" strokeWidth="0.8"/>
                <path d="M6 1V2M6 10V11M1 6H2M10 6H11M2.5 2.5L3.2 3.2M8.8 8.8L9.5 9.5M9.5 2.5L8.8 3.2M3.2 8.8L2.5 9.5" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round"/>
              </svg>
            ) : (
              <svg className="nav-btn-icon" viewBox="0 0 12 12" fill="none">
                <path d="M10 7.5A4.5 4.5 0 114.5 2a3.5 3.5 0 005.5 5.5z" stroke="currentColor" strokeWidth="0.8"/>
              </svg>
            )}
          </button>

          <div className="nav-divider" />

          <div className="nav-status">
            <div className="nav-status-dot" />
            READY
          </div>
        </div>
      </nav>

      <div className="view">
        {view === 'review' && (
          <ReviewView
            projectFiles={projectReview?.files ?? undefined}
            projectName={projectReview?.projectName ?? undefined}
            projectPath={projectReview?.projectPath ?? undefined}
            onClearProject={handleClearProjectReview}
            onRescanProject={handleRescanProject}
          />
        )}
        {view === 'projects' && (
          <ProjectView onReviewProject={handleReviewProject} />
        )}
        {view === 'settings' && (
          <SettingsView theme={theme} onThemeChange={handleThemeChange} />
        )}
        {view === 'guide' && (
          <GuideView onNavigate={(v) => setView(v as View)} />
        )}
      </div>
    </div>
  );
}
