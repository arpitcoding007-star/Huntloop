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
