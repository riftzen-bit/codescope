/**
 * Rough per-token cost estimates, USD per 1M tokens.
 * Figures are order-of-magnitude and meant to drive a UI indicator, not
 * billing. The tables live in ./prices.json (structured, jq-editable) and
 * get bundled into the dist. Local providers (Ollama, Claude Code CLI) are
 * reported as free because the user is running inference on their own
 * hardware or on a plan that is not token-metered.
 */

import pricesData from './prices.json';

export interface TokenCost {
  inputPerMTokens: number;
  outputPerMTokens: number;
}

interface PriceTable {
  providerDefaults: Record<string, TokenCost>;
  models: Record<string, Record<string, TokenCost>>;
  unknownProviderFallback: TokenCost;
}

// The JSON carries a leading "$comment" key that TS doesn't know about; cast
// through unknown so we can read only the fields we need.
const PRICES = pricesData as unknown as PriceTable;

const warnedKeys = new Set<string>();
function warnOnce(key: string, message: string): void {
  if (warnedKeys.has(key)) return;
  warnedKeys.add(key);
  // eslint-disable-next-line no-console
  console.warn(`[cost] ${message}`);
}

/** Reset the one-time-warning memo. Test-only. */
export function _resetCostWarnings(): void {
  warnedKeys.clear();
}

export function getTokenCost(provider: string, model: string): TokenCost {
  const modelTable = PRICES.models[provider];
  const providerDefault = PRICES.providerDefaults[provider];

  if (modelTable) {
    const byModel = modelTable[model];
    if (byModel) return byModel;
    if (providerDefault) {
      warnOnce(
        `model:${provider}/${model}`,
        `unknown model "${model}" for provider "${provider}"; using provider default cost`,
      );
      return providerDefault;
    }
  }

  if (providerDefault) return providerDefault;

  warnOnce(
    `provider:${provider}`,
    `unknown provider "${provider}"; using conservative fallback cost`,
  );
  return PRICES.unknownProviderFallback;
}

/** Estimate USD cost for a completed review, given token counts. */
export function estimateCost(
  provider: string,
  model: string,
  tokens: { input: number; output: number },
): number {
  const c = getTokenCost(provider, model);
  const inCost = (tokens.input / 1_000_000) * c.inputPerMTokens;
  const outCost = (tokens.output / 1_000_000) * c.outputPerMTokens;
  return inCost + outCost;
}

/** Format a cost as a short USD string: <$0.01, $0.03, $1.42. */
export function formatCost(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return 'free';
  if (usd < 0.01) return '<$0.01';
  if (usd < 1) return `$${usd.toFixed(2)}`;
  if (usd < 10) return `$${usd.toFixed(2)}`;
  return `$${usd.toFixed(1)}`;
}
