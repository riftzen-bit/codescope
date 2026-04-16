import { type SVGProps, type ReactNode } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function icon(
  path: ReactNode,
  viewBox = '0 0 24 24',
) {
  return function Icon({ size = 16, style, className, ...rest }: IconProps) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox={viewBox}
        width={size}
        height={size}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.8}
        style={{ flexShrink: 0, ...style }}
        className={className}
        aria-hidden="true"
        {...rest}
      >
        {path}
      </svg>
    );
  };
}

// ── Generic utility icons ──────────────────────────────────────────────

export const KeyIcon = icon(
  <>
    <circle cx="7.5" cy="15.5" r="4.5" stroke="currentColor" />
    <path d="M15.5 8.5l6 6" stroke="currentColor" />
    <path d="M11.5 12.5l8-8" stroke="currentColor" />
    <path d="M18 7l2 2" stroke="currentColor" />
    <path d="M16 9l2 2" stroke="currentColor" />
  </>,
);

export const CheckCircleIcon = icon(
  <>
    <circle cx="12" cy="12" r="9" stroke="currentColor" />
    <path d="M8.5 12.5l2.5 2.5 4.5-5" stroke="currentColor" />
  </>,
);

export const XCircleIcon = icon(
  <>
    <circle cx="12" cy="12" r="9" stroke="currentColor" />
    <path d="M9 9l6 6M15 9l-6 6" stroke="currentColor" />
  </>,
);

export const TrashIcon = icon(
  <>
    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" stroke="currentColor" />
    <path d="M10 11v5M14 11v5" stroke="currentColor" />
  </>,
);

export const ServerIcon = icon(
  <>
    <rect x="2" y="3" width="20" height="6" rx="1" stroke="currentColor" />
    <rect x="2" y="15" width="20" height="6" rx="1" stroke="currentColor" />
    <circle cx="6" cy="6" r="1" fill="currentColor" stroke="none" />
    <circle cx="6" cy="18" r="1" fill="currentColor" stroke="none" />
    <path d="M10 6h8M10 18h8" stroke="currentColor" />
  </>,
);

export const ShieldIcon = icon(
  <>
    <path d="M12 3L4 7v5c0 5.25 3.5 10.15 8 11 4.5-.85 8-5.75 8-11V7L12 3z" stroke="currentColor" />
    <path d="M9 12l2 2 4-4" stroke="currentColor" />
  </>,
);

export const LinkIcon = icon(
  <>
    <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" stroke="currentColor" />
    <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" stroke="currentColor" />
  </>,
);

export const TerminalIcon = icon(
  <>
    <rect x="2" y="3" width="20" height="18" rx="2" stroke="currentColor" />
    <path d="M6 9l4 3-4 3" stroke="currentColor" />
    <path d="M12 15h6" stroke="currentColor" />
  </>,
);

// ── Provider brand icons (Official logos from Simple Icons / brand guidelines) ──

/**
 * Anthropic official logo - stylized "A" mark
 * Source: Anthropic brand guidelines, Simple Icons
 */
export function AnthropicIcon({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path d="M13.827 3.52h3.603L24 20.48h-3.603l-6.57-16.96zm-7.258 0h3.767L16.906 20.48h-3.674l-1.343-3.461H5.017l-1.344 3.46H0l6.57-16.96zm2.327 5.136L6.769 14.16h4.254l-2.127-5.504z" />
    </svg>
  );
}

/**
 * OpenAI official logo - hexagonal bloom/knot symbol
 * Source: OpenAI brand guidelines, Simple Icons
 */
export function OpenAIIcon({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z" />
    </svg>
  );
}

/**
 * Google "G" logo - official 4-color G mark
 * Source: Google brand guidelines
 */
export function GoogleIcon({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}

/**
 * Ollama logo - stylized llama head
 * Source: Ollama brand / GitHub
 */
export function OllamaIcon({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 0C5.373 0 0 5.373 0 12c0 6.628 5.373 12 12 12 6.628 0 12-5.372 12-12C24 5.373 18.628 0 12 0zm-.766 4.078c.579-.037 1.056.384 1.401.78.345.394.6.87.703 1.398.104.528.056 1.092-.08 1.616-.137.525-.355 1.015-.596 1.48a6.993 6.993 0 0 1-.412.712c-.038.057-.08.11-.119.167.051-.003.098-.019.15-.019 1.66 0 3.192.546 4.43 1.469l.074-.073c.238-.235.552-.388.886-.442a1.63 1.63 0 0 1 .978.138c.307.148.559.39.72.692.16.302.224.651.173.99-.05.34-.212.654-.463.893a1.63 1.63 0 0 1-.916.432 1.63 1.63 0 0 1-.969-.153 1.63 1.63 0 0 1-.698-.698l-.037-.075a5.503 5.503 0 0 0-4.178-1.923 5.49 5.49 0 0 0-4.161 1.901l-.051.083a1.63 1.63 0 0 1-.691.67 1.63 1.63 0 0 1-.96.143 1.63 1.63 0 0 1-.898-.44 1.63 1.63 0 0 1-.448-.9 1.63 1.63 0 0 1 .172-.972c.16-.297.41-.536.714-.681a1.63 1.63 0 0 1 .963-.14c.33.05.635.198.87.427l.092.091a6.945 6.945 0 0 1 4.404-1.459c-.04-.057-.08-.114-.119-.172a6.96 6.96 0 0 1-.411-.711 5.527 5.527 0 0 1-.596-1.481 3.16 3.16 0 0 1-.08-1.616 2.757 2.757 0 0 1 .704-1.398c.26-.297.607-.588 1.02-.707a1.804 1.804 0 0 1 .38-.052zm-.084 1.239a.595.595 0 0 0-.124.02.812.812 0 0 0-.37.29 1.67 1.67 0 0 0-.377.82c-.052.322-.03.681.06 1.039.088.358.242.711.425 1.028.092.16.192.309.297.45.105-.141.205-.29.297-.45.183-.317.337-.67.426-1.028.089-.358.111-.717.059-1.039a1.67 1.67 0 0 0-.378-.82.812.812 0 0 0-.37-.29.595.595 0 0 0-.124-.02h.18zm.85 8.187a4.373 4.373 0 0 1 3.311 1.527c.08.091.152.188.227.283.255-.32.636-.535 1.064-.563.552-.036 1.074.27 1.318.77.244.5.165 1.1-.199 1.514a1.384 1.384 0 0 1-1.442.438c-.498-.143-.873-.555-.95-1.05-.03-.192-.017-.38.03-.557a4.39 4.39 0 0 0-3.36-1.582 4.39 4.39 0 0 0-3.359 1.581c.047.178.06.365.03.558-.077.494-.452.906-.95 1.049a1.384 1.384 0 0 1-1.442-.438 1.384 1.384 0 0 1-.199-1.515 1.384 1.384 0 0 1 1.318-.77c.428.029.809.244 1.064.564.075-.096.147-.192.227-.284A4.373 4.373 0 0 1 12 13.504zm-2.636 4.219a.597.597 0 0 0-.42.18.597.597 0 0 0-.173.424c0 .16.063.312.173.424a.592.592 0 0 0 .84 0 .597.597 0 0 0 .173-.424.597.597 0 0 0-.173-.424.597.597 0 0 0-.42-.18zm5.272 0a.597.597 0 0 0-.42.18.597.597 0 0 0-.173.424c0 .16.063.312.173.424a.592.592 0 0 0 .84 0 .597.597 0 0 0 .173-.424.597.597 0 0 0-.173-.424.597.597 0 0 0-.42-.18z" />
    </svg>
  );
}

/**
 * Claude Code CLI icon - terminal with Anthropic "A" mark
 */
export function ClaudeCodeIcon({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <rect x="2" y="3" width="20" height="18" rx="2.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M6 9l3.5 2.5L6 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 15h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
