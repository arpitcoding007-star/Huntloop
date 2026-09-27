/**
 * What CRM sync is, in this system's terms.
 *
 * ── Why this is not shaped like `packages/providers` ──────────────────────
 *
 * The provider package abstracts *reading* from several interchangeable
 * vendors behind one capability interface — the whole design rests on Apollo,
 * Hunter and ZeroBounce being able to answer the same question. CRM sync is
 * the opposite shape: today there is exactly one destination (HubSpot), it is
 * *written to*, not read from, and — critically — each org has its own
 * account, so there is no shared, deployment-wide credential to route through
 * a registry. Building a five-vendor abstraction over one real implementation
 * would be the premature-abstraction failure this codebase otherwise avoids;
 * see the roadmap for what changes the day a second CRM is real.
 *
 * ── What is deliberately narrow here ───────────────────────────────────────
 *
 * Three objects (company, contact, deal) and one read-back (deal stage). Not
 * a general HubSpot client, and not a sync of every field HubSpot has — only
 * what `sync_hubspot` needs to push an opportunity out and notice when a rep
 * moved it in HubSpot's own pipeline.
 */

export interface CrmCompanyInput {
  name: string;
  domain: string | null;
  industry: string | null;
  employeeCount: number | null;
}

export interface CrmContactInput {
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  title: string | null;
}

export interface CrmDealInput {
  name: string;
  /** 0–100, from `opportunity_scores.score`. Null when the dimension is UNKNOWN. */
  score: number | null;
  /** The opportunity's own explanation — never rewritten for HubSpot's audience. */
  whyNow: string;
  /** A link back to the opportunity in Huntloop, for a rep who wants the evidence. */
  evidenceUrl: string;
}

export interface CrmUpsertResult {
  /** The HubSpot object id. Stored in `external_ids` so the next push is an update. */
  id: string;
  /** True when this call created the object; false when it updated one found by search. */
  created: boolean;
}

export interface CrmDealStage {
  stageId: string;
  stageLabel: string | null;
  /** HubSpot's own "is this deal closed" flags, when the pipeline exposes them. */
  isClosed: boolean;
  isWon: boolean;
}

export type CrmErrorReason = "not_connected" | "unauthorized" | "rate_limited" | "failed";

export class CrmError extends Error {
  readonly reason: CrmErrorReason;
  readonly retryable: boolean;
  readonly httpStatus: number | null;

  constructor(
    message: string,
    options: { reason: CrmErrorReason; retryable?: boolean; httpStatus?: number | null },
  ) {
    super(message);
    this.name = "CrmError";
    this.reason = options.reason;
    this.retryable = options.retryable ?? options.reason === "rate_limited";
    this.httpStatus = options.httpStatus ?? null;
  }
}
