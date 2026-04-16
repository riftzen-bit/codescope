import type { Finding, Severity } from '../types';

interface Props {
  finding: Finding;
  onLineClick?: (line: number) => void;
}

function sevClass(s: Severity): string {
  switch (s) {
    case 'critical': return 'sev-critical';
    case 'error':    return 'sev-error';
    case 'warning':  return 'sev-warning';
    case 'info':     return 'sev-info';
  }
}

// Stacked bars of decreasing height to signal severity level visually
function SevBars({ severity }: { severity: Severity }) {
  const heights: Record<Severity, number[]> = {
    critical: [10, 10, 10, 10],
    error:    [10, 10, 10, 5],
    warning:  [10, 10, 5,  2],
    info:     [10, 5,  2,  2],
  };
  const bars = heights[severity];
  const cls = sevClass(severity);

  return (
    <div className={`sev-indicator ${cls}`} style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 12 }}>
      {bars.map((h, i) => (
        <div
          key={i}
          className="sev-bar"
          style={{ height: h, opacity: i < bars.filter(b => b === 10).length ? 1 : 0.35 }}
        />
      ))}
    </div>
  );
}

export function FindingCard({ finding, onLineClick }: Props) {
  const { severity, category, line, title, description, suggestion } = finding;
  const cls = sevClass(severity);

  return (
    <div className={`finding-card ${cls}`}>
      <div className="finding-top">
        <SevBars severity={severity} />
        <span className={`sev-label ${cls}`}>{severity}</span>
        <span className="finding-title">{title}</span>
      </div>
      <div className="finding-meta">
        {category}
        {line !== undefined && (
          <>
            {' · '}
            <button
              className="finding-line-link"
              onClick={() => onLineClick?.(line)}
              title={`Jump to line ${line}`}
            >
              ln {line}
            </button>
          </>
        )}
      </div>
      <div className="finding-desc">{description}</div>
      {suggestion && (
        <div className="finding-suggestion">{suggestion}</div>
      )}
    </div>
  );
}
