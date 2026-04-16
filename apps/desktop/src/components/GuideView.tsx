import { type JSX, useState } from 'react';

interface GuideStep {
  title: string;
  description: string;
  actionLabel?: string;
  actionView?: string;
  renderIllustration: () => JSX.Element;
}

const GUIDE_STEPS: GuideStep[] = [
  {
    title: 'Welcome to CodeScope',
    description:
      'CodeScope is an AI-powered code review tool. Paste code or load a project, pick an AI provider, and get detailed findings with scores and suggestions.',
    renderIllustration: () => (
      <svg viewBox="0 0 200 140" fill="none" xmlns="http://www.w3.org/2000/svg">
        {/* Code window */}
        <rect x="30" y="20" width="140" height="100" rx="6" stroke="var(--color-text)" strokeWidth="1.5" fill="var(--color-bg-secondary)"/>
        <rect x="30" y="20" width="140" height="22" rx="6" fill="var(--color-bg-secondary)" stroke="var(--color-text)" strokeWidth="1.5"/>
        <rect x="30" y="31" width="140" height="11" fill="var(--color-bg-secondary)"/>
        {/* Window dots */}
        <circle cx="44" cy="31" r="3" fill="var(--color-text)" opacity="0.3"/>
        <circle cx="54" cy="31" r="3" fill="var(--color-text)" opacity="0.3"/>
        <circle cx="64" cy="31" r="3" fill="var(--color-text)" opacity="0.3"/>
        {/* Code lines */}
        <rect x="44" y="56" width="60" height="5" rx="2" fill="var(--color-primary)" opacity="0.6"/>
        <rect x="44" y="68" width="90" height="5" rx="2" fill="var(--color-text)" opacity="0.2"/>
        <rect x="44" y="80" width="75" height="5" rx="2" fill="var(--color-text)" opacity="0.2"/>
        <rect x="44" y="92" width="50" height="5" rx="2" fill="var(--color-primary)" opacity="0.4"/>
        {/* Checkmark circle */}
        <circle cx="148" cy="92" r="18" fill="var(--color-bg-secondary)" stroke="var(--color-primary)" strokeWidth="2"/>
        <path d="M139 92l6 6 12-12" stroke="var(--color-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
  },
  {
    title: 'Configure AI Providers',
    description:
      'Go to the Config tab to add API keys for Claude (Anthropic), GPT (OpenAI), or Gemini (Google). Or run Ollama locally — no key needed. Claude Code CLI is also supported.',
    actionLabel: 'Go to Config',
    actionView: 'settings',
    renderIllustration: () => (
      <svg viewBox="0 0 200 140" fill="none" xmlns="http://www.w3.org/2000/svg">
        {/* Central hub */}
        <circle cx="100" cy="70" r="18" stroke="var(--color-primary)" strokeWidth="2" fill="var(--color-bg-secondary)"/>
        <path d="M92 70l5 5 11-10" stroke="var(--color-primary)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
        {/* Key icons */}
        <g opacity="0.85">
          {/* Left key */}
          <circle cx="38" cy="50" r="10" stroke="var(--color-text)" strokeWidth="1.5" fill="var(--color-bg-secondary)"/>
          <rect x="45" y="47" width="16" height="6" rx="1" stroke="var(--color-text)" strokeWidth="1.5" fill="none"/>
          <rect x="57" y="53" width="4" height="4" rx="0.5" stroke="var(--color-text)" strokeWidth="1.2" fill="none"/>
          {/* Left line */}
          <line x1="52" y1="55" x2="82" y2="65" stroke="var(--color-text)" strokeWidth="1" strokeDasharray="3 2" opacity="0.5"/>
        </g>
        <g opacity="0.85">
          {/* Top key */}
          <circle cx="100" cy="22" r="10" stroke="var(--color-text)" strokeWidth="1.5" fill="var(--color-bg-secondary)"/>
          <rect x="107" y="19" width="16" height="6" rx="1" stroke="var(--color-text)" strokeWidth="1.5" fill="none"/>
          <rect x="119" y="25" width="4" height="4" rx="0.5" stroke="var(--color-text)" strokeWidth="1.2" fill="none"/>
          {/* Top line */}
          <line x1="100" y1="32" x2="100" y2="52" stroke="var(--color-text)" strokeWidth="1" strokeDasharray="3 2" opacity="0.5"/>
        </g>
        <g opacity="0.85">
          {/* Right provider */}
          <circle cx="162" cy="50" r="10" stroke="var(--color-primary)" strokeWidth="1.5" fill="var(--color-bg-secondary)"/>
          <text x="162" y="54" textAnchor="middle" fontSize="9" fill="var(--color-primary)" fontWeight="600">AI</text>
          <line x1="148" y1="55" x2="118" y2="65" stroke="var(--color-text)" strokeWidth="1" strokeDasharray="3 2" opacity="0.5"/>
        </g>
        <g opacity="0.85">
          {/* Bottom provider */}
          <circle cx="162" cy="100" r="10" stroke="var(--color-primary)" strokeWidth="1.5" fill="var(--color-bg-secondary)"/>
          <text x="162" y="104" textAnchor="middle" fontSize="9" fill="var(--color-primary)" fontWeight="600">AI</text>
          <line x1="148" y1="96" x2="118" y2="78" stroke="var(--color-text)" strokeWidth="1" strokeDasharray="3 2" opacity="0.5"/>
        </g>
        <g opacity="0.85">
          {/* Bottom-left provider */}
          <circle cx="38" cy="100" r="10" stroke="var(--color-text)" strokeWidth="1.5" fill="var(--color-bg-secondary)"/>
          <rect x="33" y="97" width="10" height="6" rx="1" stroke="var(--color-text)" strokeWidth="1.2" fill="none"/>
          <line x1="52" y1="95" x2="82" y2="78" stroke="var(--color-text)" strokeWidth="1" strokeDasharray="3 2" opacity="0.5"/>
        </g>
      </svg>
    ),
  },
  {
    title: 'Run Your First Review',
    description:
      'In the Review tab, paste code into the editor or drag a file. Select a provider and click Review. Results appear on the right with findings, a score, and improvement suggestions.',
    actionLabel: 'Go to Review',
    actionView: 'review',
    renderIllustration: () => (
      <svg viewBox="0 0 200 140" fill="none" xmlns="http://www.w3.org/2000/svg">
        {/* Editor pane */}
        <rect x="16" y="20" width="84" height="100" rx="4" stroke="var(--color-text)" strokeWidth="1.5" fill="var(--color-bg-secondary)"/>
        <rect x="16" y="20" width="84" height="18" rx="4" fill="var(--color-bg-secondary)" stroke="var(--color-text)" strokeWidth="1.5"/>
        <rect x="16" y="29" width="84" height="9" fill="var(--color-bg-secondary)"/>
        <rect x="24" y="48" width="50" height="4" rx="1.5" fill="var(--color-primary)" opacity="0.7"/>
        <rect x="24" y="58" width="68" height="4" rx="1.5" fill="var(--color-text)" opacity="0.2"/>
        <rect x="24" y="68" width="55" height="4" rx="1.5" fill="var(--color-text)" opacity="0.2"/>
        <rect x="24" y="78" width="40" height="4" rx="1.5" fill="var(--color-primary)" opacity="0.4"/>
        <rect x="24" y="88" width="62" height="4" rx="1.5" fill="var(--color-text)" opacity="0.2"/>
        {/* Divider */}
        <line x1="104" y1="20" x2="104" y2="120" stroke="var(--color-text)" strokeWidth="1" opacity="0.3"/>
        {/* Results pane */}
        <rect x="108" y="20" width="76" height="100" rx="4" stroke="var(--color-text)" strokeWidth="1.5" fill="var(--color-bg-secondary)"/>
        {/* Score circle */}
        <circle cx="146" cy="52" r="18" stroke="var(--color-primary)" strokeWidth="2" fill="none"/>
        <text x="146" y="57" textAnchor="middle" fontSize="12" fontWeight="700" fill="var(--color-primary)">87</text>
        {/* Finding items */}
        <rect x="116" y="78" width="60" height="12" rx="3" stroke="var(--color-text)" strokeWidth="1" fill="var(--color-bg-secondary)" opacity="0.8"/>
        <rect x="119" y="81" width="4" height="6" rx="1" fill="#DC2626" opacity="0.8"/>
        <rect x="127" y="83" width="30" height="3" rx="1" fill="var(--color-text)" opacity="0.3"/>
        <rect x="116" y="96" width="60" height="12" rx="3" stroke="var(--color-text)" strokeWidth="1" fill="var(--color-bg-secondary)" opacity="0.8"/>
        <rect x="119" y="99" width="4" height="6" rx="1" fill="#CA8A04" opacity="0.8"/>
        <rect x="127" y="101" width="38" height="3" rx="1" fill="var(--color-text)" opacity="0.3"/>
      </svg>
    ),
  },
  {
    title: 'Review Entire Projects',
    description:
      'In the Projects tab, add a project folder. CodeScope scans all code files recursively. Click "Review All" to review the entire project at once. File watcher auto-detects changes.',
    actionLabel: 'Go to Projects',
    actionView: 'projects',
    renderIllustration: () => (
      <svg viewBox="0 0 200 140" fill="none" xmlns="http://www.w3.org/2000/svg">
        {/* Folder */}
        <path d="M20 45 Q20 38 27 38 L68 38 L74 32 L140 32 Q147 32 147 39 L147 105 Q147 112 140 112 L27 112 Q20 112 20 105 Z" stroke="var(--color-text)" strokeWidth="1.5" fill="var(--color-bg-secondary)"/>
        {/* Tree lines */}
        <line x1="45" y1="55" x2="45" y2="100" stroke="var(--color-text)" strokeWidth="1" opacity="0.3"/>
        {/* File items */}
        <line x1="45" y1="62" x2="55" y2="62" stroke="var(--color-text)" strokeWidth="1" opacity="0.3"/>
        <rect x="55" y="58" width="55" height="8" rx="2" fill="var(--color-primary)" opacity="0.6" stroke="var(--color-primary)" strokeWidth="1"/>
        <rect x="58" y="61" width="30" height="3" rx="1" fill="var(--color-primary)" opacity="0.6"/>
        <line x1="45" y1="76" x2="55" y2="76" stroke="var(--color-text)" strokeWidth="1" opacity="0.3"/>
        <rect x="55" y="72" width="48" height="8" rx="2" fill="var(--color-bg-secondary)" stroke="var(--color-text)" strokeWidth="1" opacity="0.4"/>
        <rect x="58" y="75" width="24" height="3" rx="1" fill="var(--color-text)" opacity="0.25"/>
        <line x1="45" y1="90" x2="55" y2="90" stroke="var(--color-text)" strokeWidth="1" opacity="0.3"/>
        <rect x="55" y="86" width="52" height="8" rx="2" fill="var(--color-bg-secondary)" stroke="var(--color-text)" strokeWidth="1" opacity="0.4"/>
        <rect x="58" y="89" width="28" height="3" rx="1" fill="var(--color-text)" opacity="0.25"/>
        {/* Scan animation indicator */}
        <circle cx="168" cy="68" r="16" stroke="var(--color-primary)" strokeWidth="1.5" fill="none" strokeDasharray="4 3"/>
        <circle cx="168" cy="68" r="6" fill="var(--color-primary)" opacity="0.3"/>
        <line x1="168" y1="52" x2="168" y2="48" stroke="var(--color-primary)" strokeWidth="1.5" strokeLinecap="round"/>
        <line x1="168" y1="84" x2="168" y2="88" stroke="var(--color-primary)" strokeWidth="1.5" strokeLinecap="round"/>
        <line x1="152" y1="68" x2="148" y2="68" stroke="var(--color-primary)" strokeWidth="1.5" strokeLinecap="round"/>
        <line x1="184" y1="68" x2="188" y2="68" stroke="var(--color-primary)" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    title: 'Reading Review Results',
    description:
      'Each finding shows a severity level (critical / error / warning / info), category, and suggestion. Click a finding to jump to the relevant line. Filter by severity, or export results as Markdown.',
    renderIllustration: () => (
      <svg viewBox="0 0 200 140" fill="none" xmlns="http://www.w3.org/2000/svg">
        {/* Finding card */}
        <rect x="24" y="18" width="152" height="48" rx="5" stroke="var(--color-text)" strokeWidth="1.5" fill="var(--color-bg-secondary)"/>
        <rect x="24" y="18" width="3" height="48" rx="1.5" fill="#DC2626"/>
        {/* Severity badge */}
        <rect x="32" y="26" width="40" height="13" rx="3" fill="#DC2626" opacity="0.12" stroke="#DC2626" strokeWidth="1"/>
        <text x="52" y="36" textAnchor="middle" fontSize="8" fontWeight="700" fill="#DC2626">CRITICAL</text>
        {/* Line number badge */}
        <rect x="148" y="26" width="24" height="13" rx="3" fill="var(--color-bg-secondary)" stroke="var(--color-primary)" strokeWidth="1"/>
        <text x="160" y="36" textAnchor="middle" fontSize="8" fill="var(--color-primary)">L:42</text>
        {/* Title line */}
        <rect x="32" y="44" width="90" height="5" rx="2" fill="var(--color-text)" opacity="0.5"/>
        {/* Description lines */}
        <rect x="32" y="54" width="140" height="4" rx="1.5" fill="var(--color-text)" opacity="0.2"/>
        <rect x="32" y="61" width="110" height="4" rx="1.5" fill="var(--color-text)" opacity="0.2"/>
        {/* Warning card */}
        <rect x="24" y="76" width="152" height="36" rx="5" stroke="var(--color-text)" strokeWidth="1.5" fill="var(--color-bg-secondary)"/>
        <rect x="24" y="76" width="3" height="36" rx="1.5" fill="#CA8A04"/>
        <rect x="32" y="83" width="36" height="11" rx="3" fill="#CA8A04" opacity="0.12" stroke="#CA8A04" strokeWidth="1"/>
        <text x="50" y="92" textAnchor="middle" fontSize="8" fontWeight="700" fill="#CA8A04">WARN</text>
        <rect x="32" y="98" width="120" height="4" rx="1.5" fill="var(--color-text)" opacity="0.2"/>
        {/* Info card */}
        <rect x="24" y="122" width="152" height="12" rx="5" stroke="var(--color-text)" strokeWidth="1" fill="var(--color-bg-secondary)" opacity="0.5"/>
        <rect x="24" y="122" width="3" height="12" rx="1.5" fill="#0284C7" opacity="0.6"/>
        <rect x="32" y="125" width="100" height="4" rx="1.5" fill="var(--color-text)" opacity="0.15"/>
      </svg>
    ),
  },
  {
    title: 'Pro Tips',
    description:
      'Drag and drop files directly onto the editor. Export reviews as Markdown. Review history auto-saves locally. Use dark mode for comfortable long sessions. Import and export settings between machines.',
    actionLabel: 'Start reviewing',
    actionView: 'review',
    renderIllustration: () => (
      <svg viewBox="0 0 200 140" fill="none" xmlns="http://www.w3.org/2000/svg">
        {/* Lightning bolt */}
        <path d="M108 18 L82 76 L96 76 L88 122 L122 60 L106 60 Z" stroke="var(--color-primary)" strokeWidth="2" strokeLinejoin="round" fill="var(--color-primary)" opacity="0.15"/>
        {/* Tip icons orbiting */}
        {/* Drag & drop */}
        <rect x="22" y="24" width="32" height="24" rx="4" stroke="var(--color-text)" strokeWidth="1.5" fill="var(--color-bg-secondary)"/>
        <path d="M30 38 L38 30 L46 38" stroke="var(--color-text)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" opacity="0.5"/>
        <line x1="38" y1="30" x2="38" y2="44" stroke="var(--color-text)" strokeWidth="1.2" strokeLinecap="round" opacity="0.5"/>
        {/* Markdown export */}
        <rect x="146" y="24" width="32" height="24" rx="4" stroke="var(--color-text)" strokeWidth="1.5" fill="var(--color-bg-secondary)"/>
        <text x="162" y="40" textAnchor="middle" fontSize="10" fontWeight="700" fill="var(--color-text)" opacity="0.5">MD</text>
        {/* History */}
        <circle cx="38" cy="100" r="14" stroke="var(--color-text)" strokeWidth="1.5" fill="var(--color-bg-secondary)"/>
        <path d="M38 93 L38 100 L44 100" stroke="var(--color-text)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.5"/>
        {/* Dark mode */}
        <circle cx="162" cy="100" r="14" stroke="var(--color-text)" strokeWidth="1.5" fill="var(--color-bg-secondary)"/>
        <path d="M168 103 A8 8 0 1 1 159 94 A6 6 0 0 0 168 103 Z" fill="var(--color-text)" opacity="0.4"/>
      </svg>
    ),
  },
];

export function GuideView({ onNavigate }: { onNavigate: (view: string) => void }) {
  const [step, setStep] = useState(0);
  const [transitioning, setTransitioning] = useState(false);

  const goTo = (next: number) => {
    if (next === step || transitioning) return;
    setTransitioning(true);
    setTimeout(() => {
      setStep(next);
      setTransitioning(false);
    }, 150);
  };

  const current = GUIDE_STEPS[step];
  if (!current) return null;

  return (
    <div className="guide-view">
      <div className="guide-header">
        <span className="guide-step-counter">Step {step + 1} of {GUIDE_STEPS.length}</span>
        <h1 className="guide-title">Getting Started</h1>
      </div>

      <div className={`guide-card${transitioning ? ' guide-card--out' : ''}`}>
        <div className="guide-illustration">
          {current.renderIllustration()}
        </div>
        <div className="guide-content">
          <h2 className="guide-step-title">{current.title}</h2>
          <p className="guide-step-desc">{current.description}</p>
          {current.actionLabel && current.actionView && (
            <button
              className="guide-action-btn"
              onClick={() => onNavigate(current.actionView!)}
            >
              {current.actionLabel} &rarr;
            </button>
          )}
        </div>
      </div>

      <div className="guide-nav">
        <button
          className="btn guide-nav-btn"
          onClick={() => goTo(step - 1)}
          disabled={step === 0}
        >
          Previous
        </button>

        <div className="guide-dots">
          {GUIDE_STEPS.map((_, i) => (
            <button
              key={i}
              className={`guide-dot${i === step ? ' guide-dot--active' : ''}`}
              onClick={() => goTo(i)}
              aria-label={`Go to step ${i + 1}`}
            />
          ))}
        </div>

        <button
          className="btn btn-primary guide-nav-btn"
          onClick={() =>
            step === GUIDE_STEPS.length - 1 ? onNavigate('review') : goTo(step + 1)
          }
        >
          {step === GUIDE_STEPS.length - 1 ? 'Start reviewing' : 'Next'}
        </button>
      </div>
    </div>
  );
}
