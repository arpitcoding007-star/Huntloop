/**
 * Task → model routing, and the price list used to attribute cost.
 *
 * This is plan §7.1 expressed as code rather than as a table in a document, so
 * that "which model ran this?" is answered by the thing that actually ran.
 *
 * The routing rule the plan states, and this file encodes: Haiku only where the
 * task is genuinely closed-set classification; everything whose output a
 * customer eventually reads runs on Opus. The failure cost of a bad
 * qualification or a tone-deaf opening line is far larger than the token delta,
 * and that is a judgement worth making once, here, rather than per call site.
 */

export const MODELS = {
  opus: "claude-opus-5",
  sonnet: "claude-sonnet-5",
  haiku: "claude-haiku-4-5",
} as const;

export type ModelId = (typeof MODELS)[keyof typeof MODELS];

/** Effort levels, per the API's `output_config.effort`. */
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface Route {
  model: ModelId;
  effort: Effort;
}

/**
 * Every task Huntloop runs. Adding a member here without adding a route is a
 * type error, which is the point — a task with no declared model would
 * otherwise silently inherit whatever the last caller passed.
 */
export type TaskName =
  | "research_company"
  | "recommend_sources"
  | "extract_signals"
  | "qualify_opportunity"
  | "explain_why_now"
  | "personalize_message"
  | "classify_reply"
  | "sales_agent"
  | "analyze_performance";

export const ROUTES: Record<TaskName, Route> = {
  // Multi-source synthesis whose quality propagates into every later step.
  research_company: { model: MODELS.opus, effort: "high" },
  recommend_sources: { model: MODELS.opus, effort: "medium" },
  // Deterministic extraction from fetched pages into §33's normalized event.
  extract_signals: { model: MODELS.haiku, effort: "medium" },
  // This decides where money goes, and must be willing to return IGNORE (§17).
  qualify_opportunity: { model: MODELS.opus, effort: "high" },
  explain_why_now: { model: MODELS.opus, effort: "medium" },
  // The customer-visible artifact. A bad opener burns the prospect permanently.
  personalize_message: { model: MODELS.opus, effort: "medium" },
  // Short input, fixed label set, high volume.
  classify_reply: { model: MODELS.haiku, effort: "low" },
  sales_agent: { model: MODELS.opus, effort: "medium" },
  analyze_performance: { model: MODELS.opus, effort: "high" },
};

/**
 * What each model's request surface accepts.
 *
 * This exists because the differences are 400 errors, not degradations. Haiku
 * 4.5 predates both adaptive thinking and the effort parameter, and predates
 * the dynamic-filtering web tools; sending any of the three to it fails the
 * request outright. Encoding that here means a future routing change — moving
 * `extract_signals` to Haiku to save money, say — cannot silently produce a
 * request shape that model has never accepted.
 */
export interface ModelCapabilities {
  adaptiveThinking: boolean;
  effort: boolean;
  webFetch: boolean;
}

const CAPABILITIES: Record<ModelId, ModelCapabilities> = {
  [MODELS.opus]: { adaptiveThinking: true, effort: true, webFetch: true },
  [MODELS.sonnet]: { adaptiveThinking: true, effort: true, webFetch: true },
  [MODELS.haiku]: { adaptiveThinking: false, effort: false, webFetch: false },
};

export function capabilities(model: ModelId): ModelCapabilities {
  return CAPABILITIES[model];
}

/**
 * List price in USD per million tokens.
 *
 * Sonnet 5 carries an introductory rate ($2.00/$10.00) that expires
 * 2026-08-31. The standard rate is used here on purpose: a cost dashboard that
 * quietly assumes a promotional price will understate the bill from the day it
 * ends, and it will do so without anyone changing a line of code.
 */
const PRICES: Record<ModelId, { input: number; output: number }> = {
  [MODELS.opus]: { input: 5.0, output: 25.0 },
  [MODELS.sonnet]: { input: 3.0, output: 15.0 },
  [MODELS.haiku]: { input: 1.0, output: 5.0 },
};

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/**
 * Cost of one call, in cents, to four decimal places.
 *
 * Cache reads bill at ~0.1× input and cache writes at ~1.25×, which is the
 * whole reason §7.2 calls caching the biggest lever: the ICP and product
 * context are byte-identical across every opportunity in a campaign, so almost
 * all of a mature campaign's input tokens should be arriving at the 0.1× rate.
 * If they are not, the cache is broken and this number is how you find out.
 */
export function estimateCostCents(model: ModelId, usage: TokenUsage): number {
  const price = PRICES[model];
  const perToken = (n: number, rate: number) => (n / 1_000_000) * rate;
  const usd =
    perToken(usage.inputTokens, price.input) +
    perToken(usage.cacheReadTokens, price.input * 0.1) +
    perToken(usage.cacheWriteTokens, price.input * 1.25) +
    perToken(usage.outputTokens, price.output);
  return Math.round(usd * 100 * 10_000) / 10_000;
}
