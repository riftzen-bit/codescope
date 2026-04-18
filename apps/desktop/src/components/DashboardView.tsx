import { useMemo } from 'react';
import type { HistoryEntry } from '../types';
import { detectTrend, percentileRank, summarizeFindings } from '@code-review/core';
import { ScoreTrendChart } from './ScoreTrendChart';

interface Props {
  history: readonly HistoryEntry[];
  onClose: () => void;
  onOpenEntry?: (entry: HistoryEntry) => void;
}

interface FileRow {
  filename: string;
  count: number;
  latestScore: number;
  avgScore: number;
  trendPoints: number[];
  direction: ReturnType<typeof detectTrend>['direction'];
  findings: number;
  lastEntry: HistoryEntry;
}

function aggregate(history: readonly HistoryEntry[]): FileRow[] {
  const byFile = new Map<string, HistoryEntry[]>();
  for (const h of history) {
    const list = byFile.get(h.filename) ?? [];
    list.push(h);
    byFile.set(h.filename, list);
  }
  const rows: FileRow[] = [];
  for (const [filename, entries] of byFile) {
    const sorted = entries.slice().sort((a, b) => a.createdAt - b.createdAt);
    const scores = sorted.map((e) => e.score);
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    const trend = detectTrend(scores);
    const last = sorted[sorted.length - 1]!;
    rows.push({
      filename,
      count: entries.length,
      latestScore: last.score,
      avgScore: Math.round(avg * 10) / 10,
      trendPoints: scores.slice(-12),
      direction: trend.direction,
      findings: last.findings.length,
      lastEntry: last,
    });
  }
  return rows.sort((a, b) => a.latestScore - b.latestScore);
}

export function DashboardView({ history, onClose, onOpenEntry }: Props) {
  const rows = useMemo(() => aggregate(history), [history]);

  const overall = useMemo(() => {
    if (history.length === 0) return null;
    const scores = history.map((h) => h.score);
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    const latestByFile = new Map<string, HistoryEntry>();
    for (const h of history.slice().sort((a, b) => a.createdAt - b.createdAt)) {
      latestByFile.set(h.filename, h);
    }
    const latestFindings = Array.from(latestByFile.values()).flatMap((h) => h.findings);
    const breakdown = summarizeFindings(latestFindings);
    return {
      reviewCount: history.length,
      fileCount: latestByFile.size,
      avgScore: Math.round(avg * 10) / 10,
      latestFindingsTotal: latestFindings.length,
      breakdown,
    };
  }, [history]);

  const allScores = useMemo(() => history.map((h) => h.score), [history]);

  return (
    <div className="dashboard-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="dashboard-modal" onClick={(e) => e.stopPropagation()}>
        <div className="dashboard-header">
          <h2>Project Dashboard</h2>
          <button className="btn-copy" onClick={onClose} aria-label="Close dashboard">×</button>
        </div>

        {overall === null ? (
          <p className="dashboard-empty">No review history yet. Run a review to get started.</p>
        ) : (
          <>
            <div className="dashboard-stats">
              <div className="dashboard-stat">
                <span className="dashboard-stat-label">Reviews</span>
                <span className="dashboard-stat-value">{overall.reviewCount}</span>
              </div>
              <div className="dashboard-stat">
                <span className="dashboard-stat-label">Files</span>
                <span className="dashboard-stat-value">{overall.fileCount}</span>
              </div>
              <div className="dashboard-stat">
                <span className="dashboard-stat-label">Avg score</span>
                <span className="dashboard-stat-value">{overall.avgScore}</span>
              </div>
              <div className="dashboard-stat">
                <span className="dashboard-stat-label">Open findings</span>
                <span className="dashboard-stat-value">{overall.latestFindingsTotal}</span>
              </div>
              <div className="dashboard-stat">
                <span className="dashboard-stat-label">Severity</span>
                <span className="dashboard-stat-value dashboard-sev">
                  <span className="sev-dot sev-critical" /> {overall.breakdown.bySeverity.critical}
                  <span className="sev-dot sev-error" /> {overall.breakdown.bySeverity.error}
                  <span className="sev-dot sev-warning" /> {overall.breakdown.bySeverity.warning}
                  <span className="sev-dot sev-info" /> {overall.breakdown.bySeverity.info}
                </span>
              </div>
            </div>

            <div className="dashboard-table-wrap">
              <table className="dashboard-table">
                <thead>
                  <tr>
                    <th>File</th>
                    <th>Reviews</th>
                    <th>Latest</th>
                    <th>Avg</th>
                    <th>Pct rank</th>
                    <th>Findings</th>
                    <th>Trend</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const pr = Math.round(percentileRank(r.latestScore, allScores));
                    return (
                      <tr
                        key={r.filename}
                        className="dashboard-row"
                        onClick={() => onOpenEntry?.(r.lastEntry)}
                        role={onOpenEntry ? 'button' : undefined}
                        tabIndex={onOpenEntry ? 0 : undefined}
                      >
                        <td className="dashboard-file" title={r.filename}>{r.filename}</td>
                        <td>{r.count}</td>
                        <td className={`dashboard-score dir-${r.direction}`}>{r.latestScore}</td>
                        <td>{r.avgScore}</td>
                        <td>{pr}%</td>
                        <td>{r.findings}</td>
                        <td>
                          {r.trendPoints.length > 1
                            ? <ScoreTrendChart points={r.trendPoints} width={120} height={32} />
                            : <span className="dashboard-muted">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
