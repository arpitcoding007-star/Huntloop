/**
 * Public surface of @huntloop/db.
 *
 * Note what is NOT exported here: `./admin`. The service-role client is
 * reachable only through the explicit `@huntloop/db/admin` subpath, so it can
 * never arrive by accident through a barrel import, and every use site names
 * it in a way that is trivially greppable and obvious in review.
 */

export { createTenantClient, resolveMembership } from "./server.ts";
export type { CookieStore, TenantClient } from "./server.ts";

export { createClientSideClient } from "./browser.ts";
export type { ClientSideClient } from "./browser.ts";

export {
  EncryptionUnavailable,
  decryptSecret,
  encryptSecret,
  isEncryptionConfigured,
} from "./crypto.ts";

export * from "./types.ts";

/**
 * The scoring-rule language and its evaluator.
 *
 * Pure — it imports no client and touches no I/O — which is why it can live
 * beside the row types and be used by both the engine and the review screen
 * without either of them importing the other.
 */
export {
  InvalidRuleError,
  RULE_EFFECTS,
  RULE_FIELDS,
  RULE_INTENTS,
  RULE_OPERATORS,
  applyRules,
  describeExpression,
  describeRule,
  evaluate,
  isRuleField,
  isRuleOperator,
  validateExpression,
  validateRule,
  type FactValue,
  type RuleCondition,
  type RuleEffect,
  type RuleExpression,
  type RuleFacts,
  type RuleField,
  type RuleIntent,
  type RuleOperator,
  type RuleOutcome,
  type RulePriority,
  type RuleTraceEntry,
  type ScoringRule,
} from "./rules.ts";

/** `organizations.settings`, given a shape. Pure, for the same reason. */
export {
  EMPTY_ORG_PROFILE,
  ORG_TONES,
  isOrgTone,
  parseOrgProfile,
  serializeOrgProfile,
  voiceGuidance,
  type OrgEngineSettings,
  type OrgProfile,
  type OrgTone,
  type OrgVoice,
} from "./org-profile.ts";

/**
 * The ICP, as a type both sides import.
 *
 * The reason this is here rather than in the web app is `ICP-01`: the seed
 * and the reader disagreed about the shape of one jsonb column, jsonb
 * accepted both, and the qualifier judged every company against a profile
 * asserting nothing. A schema that lives with the row types is a schema the
 * writer, the reader and the provider query translator all import from the
 * same place — which is the only arrangement in which they cannot drift.
 */
export {
  CRITERIA_KEYS,
  EXCLUSION_KEYS,
  InvalidIcpError,
  bandsToRange,
  isEmpty as isIcpEmpty,
  isExcluded,
  parseCriteria,
  parseExclusions,
  parseIcp,
  scoreIcp,
  serializeCriteria,
  serializeExclusions,
  type EmployeeRange,
  type ExclusionSubject,
  type ExclusionVerdict,
  type Icp,
  type IcpCriteria,
  type IcpExclusions,
  type IcpQuality,
} from "./icp.ts";

/** Entity resolution — the deterministic half. `0012` has the exact lookups. */
export {
  InvalidDomainError,
  canonicalizeDomain,
  compareCompanies,
  editDistance,
  normalizeName,
  orderPair,
  rootLabel,
  type MatchCandidate,
  type MatchConfidence,
  type MatchResult,
  type MatchSignal,
} from "./identity.ts";

/** Contact fit — who to talk to, and why. Deterministic; the angle is not. */
export {
  classifyTitle,
  rankContacts,
  scoreContactFit,
  type ContactFit,
  type ContactSubject,
  type FitDimensions,
  type PersonaSpec,
  type RankedContact,
  type TitleClassification,
} from "./contact.ts";

/**
 * ICP → a provider-neutral search. Deterministic, and total over the ICP: a
 * criterion either maps or is reported as unmappable, never silently dropped.
 */
export {
  EMPTY_FILTERS,
  canonicalFilters,
  describeFilters,
  translateIcp,
  type DiscoveryFilters,
  type Translation,
  type UnmappedCriterion,
} from "./discovery.ts";
