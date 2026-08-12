/**
 * Public surface of @huntloop/ai.
 *
 * The rule this package holds: nothing here decides *whether* a model may be
 * called. Callers check `isAiConfigured()` and choose what to show when it is
 * false — because "no key" is a normal deployment state and the honest answer
 * to it is a screen that says so, not a fabricated result.
 */

export { isAiConfigured } from "./env.ts";

export {
  MODELS,
  ROUTES,
  capabilities,
  estimateCostCents,
  type Effort,
  type ModelId,
  type Route,
  type TaskName,
  type TokenUsage,
} from "./models.ts";

export {
  ModelRefusalError,
  createAnthropicClient,
  type ModelClient,
  type ModelRequest,
  type ModelResult,
} from "./client.ts";

export {
  ClaimValidationError,
  assertValidClaim,
  assertValidClaims,
  type Claim,
  type ClaimKind,
  type Confidence,
} from "./claims.ts";

export { definePrompt, inputHash, type Prompt } from "./prompt.ts";
export { UNTRUSTED_CONTENT_RULE, wrapUntrusted } from "./untrusted.ts";
export { InvalidUrlError, normalizeUrl, type NormalizedUrl } from "./url.ts";

export { nullRecorder, type RunFinish, type RunRecorder, type RunStart } from "./runs.ts";
export { runTask, type LLMTask, type RunContext, type TaskResult } from "./task.ts";

export {
  FIELD_LABELS,
  RESEARCH_FIELDS,
  researchCompany,
  type CompanyUnderstanding,
  type ResearchCompanyInput,
  type ResearchField,
  type ResearchFinding,
} from "./tasks/research-company.ts";

export {
  MAX_RECOMMENDATIONS,
  SOURCE_KINDS,
  icpElements,
  recommendSources,
  type IcpSummary,
  type SourceKind,
  type SourceRecommendation,
} from "./tasks/recommend-sources.ts";

export {
  PRIORITIES,
  SCORE_DIMENSIONS,
  qualifyOpportunity,
  type Priority,
  type Qualification,
  type QualificationEvidence,
  type QualifyInput,
  type ScoreDimensionLabel,
  type ScoredDimension,
} from "./tasks/qualify-opportunity.ts";
