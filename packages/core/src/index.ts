// Providers
export type { AIProvider, ChatMessage, ChatResponse } from './providers/types.js';

// Review engine
export { ReviewEngine } from './review/engine.js';

// Review types
export type { Finding, ReviewRequest, ReviewResult, Severity, Category } from './review/types.js';

// Review utilities
export { detectLanguage, parseReviewResponse, sanitizeFinding } from './review/parser.js';
export { SYSTEM_PROMPT, buildUserMessage } from './review/prompts.js';

// Rule presets
export { RULE_PRESETS, getPresetRules } from './review/rules.js';
export type { RulePreset, RulePresetId } from './review/rules.js';

// Export formats
export { toSARIF, toJSON } from './review/sarif.js';
export type { SarifOptions } from './review/sarif.js';

// Token cost
export { estimateCost, formatCost, getTokenCost } from './review/cost.js';
export type { TokenCost } from './review/cost.js';

// Review cache
export { ReviewCache, reviewCacheKey, djb2, contentKey } from './review/cache.js';
export type { CachedReview } from './review/cache.js';

// Aggregation helpers
export {
  summarizeFindings,
  sortFindingsBySeverity,
  groupFindingsByCategory,
  mergeResults,
  formatTokens,
} from './review/aggregate.js';
export type {
  FindingsSummary,
  SeverityCounts,
  CategoryCounts,
} from './review/aggregate.js';

// Filter + diff
export { filterFindings } from './review/filter.js';
export type { FindingFilter } from './review/filter.js';
export { diffFindings } from './review/diff.js';
export type { FindingsDiff } from './review/diff.js';

// Extra exporters (CSV / HTML / JUnit XML / GitHub annotations / HTML diff)
export {
  toCSV,
  toHTML,
  toJUnitXML,
  toGithubAnnotations,
  toDiffHTML,
} from './review/exporters.js';

// Code metrics
export { computeCodeMetrics } from './review/metrics.js';
export type { CodeMetrics } from './review/metrics.js';

// Ignore list
export { IgnoreList, findingFingerprint } from './review/ignore.js';

// Sparkline
export { sparkline } from './review/sparkline.js';

// Trend analysis
export { movingAverage, detectTrend, percentileRank } from './review/trend.js';
export type { TrendAnalysis, TrendDirection } from './review/trend.js';

// Secret redaction
export { redactSecrets, summarizeRedactions } from './review/redact.js';
export type { RedactionHit, RedactionResult } from './review/redact.js';

// Severity pie chart
export { toSeverityPieSVG } from './review/pie.js';
export type { PieSVGOptions } from './review/pie.js';

// Fix-time heuristic
export { estimateFixTime, estimateTotalFixTime, formatDuration } from './review/fixtime.js';
export type { FixTimeSummary } from './review/fixtime.js';

// Messaging / digest exporters
export { toSlack, toEmail, toStatusLine, toMarkdownTable } from './review/messaging.js';

// Retry
export { withRetry } from './retry.js';
export type { RetryOptions } from './retry.js';

// URL validation
export { assertLocalUrl } from './validation.js';
