import { useState, useEffect, useCallback } from 'react';
import type { ProjectInfo, ProjectFile, AppSettings } from '../types';

interface Props {
  onReviewProject: (files: ProjectFile[], projectName: string, projectPath: string) => void;
}

export function ProjectView({ onReviewProject }: Props) {
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [scanning, setScanning] = useState<string | null>(null);
  const [scanProgress, setScanProgress] = useState<{ current: number; total: number } | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);

  const loadProjects = useCallback(async () => {
    try {
      const list = await window.api.projectList();
      setProjects(list);
    } catch (err) {
      console.error('Failed to load projects:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load projects on mount
  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const handleAddProject = useCallback(async () => {
    setAdding(true);
    try {
      const folderPath = await window.api.selectFolder();
      if (!folderPath) return;

      // Extract folder name from path
      const name = folderPath.split(/[/\\]/).pop() || 'Unnamed Project';
      await window.api.projectAdd(name, folderPath);
      await loadProjects();
    } catch (err) {
      console.error('Failed to add project:', err);
    } finally {
      setAdding(false);
    }
  }, [loadProjects]);

  const handleRemoveProject = useCallback(async (projectId: string) => {
    try {
      await window.api.projectRemove(projectId);
      await loadProjects();
    } catch (err) {
      console.error('Failed to remove project:', err);
    }
  }, [loadProjects]);

  const handleScanProject = useCallback(async (project: ProjectInfo) => {
    setScanning(project.id);
    setScanProgress({ current: 0, total: 0 });
    setScanError(null);

    try {
      const { files, truncated, limit } = await window.api.readProjectFiles(project.path);
      setScanProgress({ current: files.length, total: files.length });

      if (files.length === 0) {
        setScanError('No code files found in this project.');
        return;
      }

      if (truncated) {
        const ok = await window.api.confirm(
          `This project has more than ${limit} source files. Only the first ${limit} will be loaded. Continue?`,
        );
        if (!ok) return;
      }

      onReviewProject(files, project.name, project.path);
    } catch (err) {
      console.error('Failed to scan project:', err);
      setScanError(`Failed to scan project: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setScanning(null);
      setScanProgress(null);
    }
  }, [onReviewProject]);

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  if (loading) {
    return (
      <div className="project-view">
        <div className="pv-loading">
          <span className="spinner" />
          Loading projects...
        </div>
      </div>
    );
  }

  return (
    <div className="project-view">
      <div className="pv-header">
        <div className="pv-header-inner">
          <h1 className="pv-title">Projects</h1>
          <p className="pv-subtitle">
            Add entire projects for comprehensive code review
          </p>
        </div>
        <button
          className="btn btn-primary"
          onClick={handleAddProject}
          disabled={adding}
        >
          {adding ? (
            <><span className="spinner" /> Adding...</>
          ) : (
            <>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M7 2V12M2 7H12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              Add Project
            </>
          )}
        </button>
      </div>

      {projects.length === 0 ? (
        <div className="pv-empty">
          <div className="pv-empty-icon">
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
              <rect x="8" y="12" width="32" height="28" rx="2" stroke="currentColor" strokeWidth="2"/>
              <path d="M8 18H40" stroke="currentColor" strokeWidth="2"/>
              <path d="M16 12V8C16 6.89543 16.8954 6 18 6H30C31.1046 6 32 6.89543 32 8V12" stroke="currentColor" strokeWidth="2"/>
            </svg>
          </div>
          <div className="pv-empty-title">No projects yet</div>
          <div className="pv-empty-desc">
            Add a project folder to review all source code files at once.
            Node modules, build artifacts, and hidden folders are automatically skipped.
          </div>
        </div>
      ) : (
        <div className="pv-list">
          {projects.map((project) => (
            <div key={project.id} className="pv-card">
              <div className="pv-card-icon">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <rect x="2" y="4" width="16" height="14" rx="2" stroke="currentColor" strokeWidth="1.5"/>
                  <path d="M2 8H18" stroke="currentColor" strokeWidth="1.5"/>
                  <path d="M6 4V2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </div>
              <div className="pv-card-body">
                <div className="pv-card-name">{project.name}</div>
                <div className="pv-card-path" title={project.path}>
                  {project.path}
                </div>
                <div className="pv-card-date">Added {formatDate(project.addedAt)}</div>
              </div>
              <div className="pv-card-actions">
                <button
                  className="btn btn-primary"
                  onClick={() => handleScanProject(project)}
                  disabled={scanning === project.id}
                >
                  {scanning === project.id ? (
                    <>
                      <span className="spinner" />
                      {scanProgress ? `${scanProgress.current} files` : 'Scanning...'}
                    </>
                  ) : (
                    'Review'
                  )}
                </button>
                <button
                  className="btn btn-danger"
                  onClick={() => handleRemoveProject(project.id)}
                  disabled={scanning === project.id}
                  title="Remove project"
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M3 4H11M5 4V3C5 2.44772 5.44772 2 6 2H8C8.55228 2 9 2.44772 9 3V4M10 4V11C10 11.5523 9.55228 12 9 12H5C4.44772 12 4 11.5523 4 11V4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {scanError && (
        <div className="error-banner" style={{ margin: '0 0 var(--space-3)' }}>
          {scanError}
          <button className="btn" style={{ marginLeft: 'auto', fontSize: '11px' }} onClick={() => setScanError(null)}>
            Dismiss
          </button>
        </div>
      )}

      <div className="pv-info">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.2"/>
          <path d="M7 6V10M7 4.5V4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
        </svg>
        <span>
          Automatically skips: node_modules, .git, dist, build, __pycache__, and other common non-source directories.
          Max 500 files per scan.
        </span>
      </div>
    </div>
  );
}
