/**
 * Row types for the tables in packages/db/migrations.
 *
 * Hand-written rather than generated, because generation needs a live project
 * and this package has to typecheck offline. They are kept deliberately thin —
 * only the columns the app reads today — and `verify-migrations.ts` is what
 * proves the *database* matches its own rules. If these drift from the SQL,
 * the SQL wins.
 */

export type ClaimKind = "fact" | "inference" | "unknown";
export type Confidence = "low" | "medium" | "high";
export type OrgRole = "owner" | "admin" | "member" | "viewer";
export type OpportunityPriority = "hot" | "warm" | "watch" | "ignore";
export type SourceStatus = "ok" | "degraded" | "unavailable";
export type MemoryScope =
  | "organization"
  | "team"
  | "user"
  | "account"
  | "opportunity";

export type OpportunityStatus =
  | "discovered"
  | "researching"
  | "qualified"
  | "assigned"
  | "contacted"
  | "replied"
  | "meeting"
  | "proposal"
  | "won"
  | "lost"
  | "archived";

export interface Organization {
  id: string;
  name: string;
  slug: string;
  plan_id: string | null;
  trial_ends_at: string | null;
}

export interface Membership {
  id: string;
  org_id: string;
  user_id: string;
  role: OrgRole;
}

export interface Company {
  id: string;
  org_id: string;
  canonical_domain: string;
  name: string;
  website: string | null;
  industry: string | null;
  employee_count: number | null;
  country: string | null;
  business_model: string | null;
  description: string | null;
  tech_stack: string[];
  last_researched_at: string | null;
}

export interface Evidence {
  id: string;
  org_id: string;
  subject_type: "company" | "opportunity" | "contact" | "signal";
  subject_id: string;
  claim: string;
  kind: ClaimKind;
  /** NULL for `unknown` — asserting nothing carries no confidence. */
  confidence: Confidence | null;
  source_id: string | null;
  /** Guaranteed non-null when `kind === "fact"` by a CHECK constraint. */
  source_url: string | null;
  excerpt: string | null;
  event_date: string | null;
  observed_at: string;
}

export interface Opportunity {
  id: string;
  org_id: string;
  company_id: string;
  icp_id: string | null;
  primary_person_id: string | null;
  priority: OpportunityPriority;
  /** NOT NULL in the database — the verdict never travels without its reason. */
  priority_reason: string;
  status: OpportunityStatus;
  owner_id: string | null;
  why_this_company: string | null;
  identified_problem: string | null;
  potential_gap: string | null;
  why_now: string | null;
  current_approach: string | null;
  potential_use_case: string | null;
  outreach_angle: string | null;
  confidence: Confidence | null;
  first_seen_at: string;
}

/**
 * The eight §51 dimensions. `null` means UNKNOWN and must render as UNKNOWN —
 * coercing it to 0 anywhere in the app turns "we did not establish this" into
 * "we measured this and it is bad", which is a finding Huntloop never made.
 */
export interface OpportunityScore {
  id: string;
  org_id: string;
  opportunity_id: string;
  model_version: string;
  score: number;
  icp_fit: number | null;
  problem_severity: number | null;
  evidence_strength: number | null;
  trigger_strength: number | null;
  trigger_freshness: number | null;
  buying_likelihood: number | null;
  product_relevance: number | null;
  decision_maker_accessibility: number | null;
  confidence: Confidence | null;
  /** NOT NULL in the database — there is no such thing as an unexplained score. */
  explanation: string;
  computed_at: string;
}

export interface Source {
  id: string;
  org_id: string;
  icp_id: string | null;
  kind: string;
  name: string;
  url: string | null;
  is_enabled: boolean;
  recommended_by: "system" | "user";
  status: SourceStatus;
  failure_count: number;
  last_scanned_at: string | null;
  last_error: string | null;
}

export interface CompanyTrigger {
  id: string;
  org_id: string;
  company_id: string;
  trigger_type: string;
  event_date: string;
  strength: number | null;
  evidence_id: string | null;
}

export interface Memory {
  id: string;
  org_id: string;
  scope: MemoryScope;
  /** NULL exactly when scope is `organization` — enforced by CHECK. */
  scope_id: string | null;
  kind: "durable" | "conversational";
  key: string | null;
  content: string;
  source: "user" | "derived";
  confidence: Confidence | null;
  expires_at: string | null;
}
