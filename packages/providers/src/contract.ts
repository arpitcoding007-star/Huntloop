/**
 * What a data provider is, in this system's terms.
 *
 * ── The one rule this file exists to enforce ─────────────────────────────
 *
 * **Nothing outside `src/adapters/` may know a vendor exists.**
 *
 * Every type below is Huntloop-shaped. An adapter's job is to turn a vendor's
 * response into these and to turn these into a vendor's request; a caller's
 * job is never to know which vendor answered. `PRV-CHK` in `scripts/audit.mjs`
 * enforces it mechanically — the string "apollo" may not appear in an import
 * path or a type name outside the adapters directory — because architecture
 * principle 12 is only worth anything if it is checked.
 *
 * The test of whether this worked: deleting `src/adapters/apollo.ts` should
 * break the build in exactly one place, the registry.
 *
 * ── Why five capabilities and not one `search()` ─────────────────────────
 *
 * Because they have different costs, different cache lifetimes, different
 * failure meanings, and different vendors. Apollo can do four of the five and
 * Hunter can do one; a single interface would mean every adapter implementing
 * methods that throw, and every caller checking which ones are real. A
 * capability is the unit that is either configured or is not.
 *
 * ── `partial` is the load-bearing field ──────────────────────────────────
 *
 * A provider that returns 40 of the 100 rows asked for because it hit a page
 * limit is a *different fact* from a provider that has 40. The first is
 * resumable and the second is complete, and a system that cannot tell them
 * apart either re-pays for the first page forever or quietly stops at 40 and
 * reports a market smaller than it is.
 */

/* ── Capabilities ──────────────────────────────────────────────────────── */

export const CAPABILITIES = [
  "company.search",
  "company.enrich",
  "person.search",
  "person.match",
  "email.verify",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export function isCapability(value: string): value is Capability {
  return (CAPABILITIES as readonly string[]).includes(value);
}

/* ── The envelope ──────────────────────────────────────────────────────── */

/**
 * How a call ended.
 *
 * Seven values, and collapsing any two loses a distinction something
 * downstream depends on. The mapping to `provider_calls.outcome` in `0011` is
 * exact and deliberate — the database and the type must agree, because the
 * ledger is what the budget, the breaker and the health view all read.
 */
export type CallOutcome =
  | "ok"
  | "cache_hit"
  | "partial"
  | "empty"
  | "rate_limited"
  | "failed"
  | "refused";

/**
 * Why a call was refused before it was made.
 *
 * A refusal costs nothing and must never be presented as a result. The
 * discovery runner turns each of these into a `stop_reason`, which is how a
 * customer finds out their search stopped because of a budget rather than
 * because their market is empty.
 */
export type RefusalReason =
  | "no_provider"
  | "credentials_invalid"
  | "budget_exhausted"
  | "breaker_open"
  | "capability_unsupported";

export interface CallMeta {
  provider: string;
  capability: Capability;
  outcome: CallOutcome;
  /** In the provider's own credit unit. Zero for a cache hit or a refusal. */
  credits: number;
  /** Null when the call was served from cache or refused. */
  latencyMs: number | null;
  httpStatus: number | null;
  attempts: number;
  /** When this came from cache, when it was originally fetched. */
  cachedAt: Date | null;
  error: string | null;
  refusal: RefusalReason | null;
}

export interface ProviderResult<T> {
  meta: CallMeta;
  data: T;
}

/* ── Companies ─────────────────────────────────────────────────────────── */

/**
 * A company as this system understands one.
 *
 * Every field nullable except the two that make it an entity at all. A
 * provider that has a name and nothing else has still told us something; a
 * type that demanded an industry would force an adapter to invent one, which
 * is the §7 failure moved into a type definition.
 */
export interface ProviderCompany {
  /** The provider's own id. The key for `external_ids`, never for us. */
  providerId: string;
  name: string;
  /** Already canonicalized by the adapter. Null when unusable — see `identity.ts`. */
  domain: string | null;
  website: string | null;
  description: string | null;
  industry: string | null;
  employeeCount: number | null;
  revenueBand: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  foundedYear: number | null;
  linkedinUrl: string | null;
  technologies: string[];
  /** Shape mirrors `companies.funding`. */
  funding: {
    stage: string | null;
    totalRaisedUsd: number | null;
    lastRoundAt: string | null;
    lastRoundUsd: number | null;
  } | null;
  /**
   * Whatever else the vendor sent, capped by the adapter.
   *
   * Kept for the reason `enrichment_records.raw` is kept: when the mapping is
   * wrong, the only way to know what the provider actually said is to have
   * kept it. Never read by anything but a debugging human.
   */
  raw: Record<string, unknown> | null;
}

export interface CompanySearchQuery {
  /** Free-text, when the provider supports it. Most of the filtering is below. */
  keywords: string[];
  industries: string[];
  /** Provider-neutral: names, not codes. The adapter maps them. */
  locations: string[];
  employeeMin: number | null;
  employeeMax: number | null;
  revenueBands: string[];
  technologies: string[];
  /** Domains to exclude at the provider, saving the credits entirely. */
  excludeDomains: string[];
  /** Where to resume. Opaque; produced by a previous result. */
  cursor: string | null;
  /** How many rows this call should ask for. The adapter clamps to its own page size. */
  limit: number;
}

export interface CompanySearchResult {
  items: ProviderCompany[];
  /**
   * What the provider says exists in total. Null when it does not say.
   *
   * The ONLY sanctioned source of an addressable-market number. `0013`'s
   * `addressable_source` is 'provider' or 'manual' and has no third value,
   * because a model's estimate of a market size is the most expensive kind of
   * fabrication — it is the number a customer repeats to their board.
   */
  total: number | null;
  /** Null when there is nothing more to read. */
  cursor: string | null;
  /** True when we stopped early rather than exhausting the result set. */
  partial: boolean;
}

/* ── People ────────────────────────────────────────────────────────────── */

export interface ProviderPerson {
  providerId: string;
  firstName: string | null;
  lastName: string | null;
  title: string | null;
  seniority: string | null;
  department: string | null;
  linkedinUrl: string | null;
  city: string | null;
  country: string | null;
  /**
   * Contact points, if the provider revealed any.
   *
   * `confidence` is a word, never a percentage (§16), and `verified` reflects
   * the provider's own assertion rather than our verification. An address the
   * provider constructed from a pattern arrives as `low` and unverified — see
   * the note on `email_status` in the Apollo adapter, which is the single
   * most important mapping decision in this package.
   */
  contacts: Array<{
    kind: "email" | "phone" | "linkedin";
    value: string;
    confidence: "low" | "medium" | "high";
    verified: boolean;
  }>;
  raw: Record<string, unknown> | null;
}

export interface PersonSearchQuery {
  companyDomain: string | null;
  companyName: string | null;
  /** The provider's id for the company, when we have one. Far more precise. */
  companyProviderId: string | null;
  titles: string[];
  seniorities: string[];
  departments: string[];
  cursor: string | null;
  limit: number;
}

export interface PersonSearchResult {
  items: ProviderPerson[];
  total: number | null;
  cursor: string | null;
  partial: boolean;
}

export interface PersonMatchQuery {
  firstName: string | null;
  lastName: string | null;
  title: string | null;
  companyDomain: string;
  companyName: string;
}

export type VerificationStatus = "deliverable" | "undeliverable" | "risky" | "unknown";

/* ── The adapter ───────────────────────────────────────────────────────── */

/**
 * What an adapter must provide.
 *
 * Every method is optional except `name` and `capabilities`. An adapter
 * declares what it can do and the registry refuses to route a capability to
 * one that does not claim it — rather than every method existing and four of
 * them throwing, which pushes the check to runtime and to every caller.
 *
 * `credits` is per call rather than per result on purpose: that is how these
 * vendors bill, and estimating per result would produce a ledger that never
 * reconciles with an invoice.
 */
export interface ProviderAdapter {
  readonly name: string;
  readonly capabilities: readonly Capability[];

  /**
   * A cheap call that proves the credentials work.
   *
   * The entire argument of `PRV-01`. Without this, a deployment with the
   * wrong key reports "no results" — indistinguishable from a market with no
   * companies in it — and does so forever, because nothing ever asks.
   *
   * Must be the cheapest authenticated endpoint the vendor has, and must not
   * consume a search credit.
   */
  verifyCredentials(): Promise<{ ok: boolean; detail: string }>;

  searchCompanies?(query: CompanySearchQuery): Promise<RawCall<CompanySearchResult>>;
  enrichCompany?(input: { domain: string | null; name: string | null; providerId: string | null }): Promise<RawCall<ProviderCompany | null>>;
  searchPeople?(query: PersonSearchQuery): Promise<RawCall<PersonSearchResult>>;
  matchPerson?(query: PersonMatchQuery): Promise<RawCall<ProviderPerson | null>>;
  verifyEmail?(email: string): Promise<RawCall<VerificationStatus>>;
}

/**
 * What an adapter returns before the plumbing wraps it.
 *
 * The adapter reports the credits and the HTTP status; retry, caching,
 * budgets, the ledger and the breaker are all applied around it by `call.ts`.
 * That split is what keeps an adapter to "translate this vendor" and stops
 * each one growing its own slightly different retry policy — which is exactly
 * what `providers.ts` was starting to do with two vendors.
 */
export interface RawCall<T> {
  data: T;
  credits: number;
  httpStatus: number | null;
  /** True when the provider said there is more than it returned. */
  partial?: boolean;
}

/**
 * The error an adapter throws for a failure worth retrying.
 *
 * `retryable` is the adapter's judgement, because only it knows what the
 * vendor's status codes mean. `call.ts` honours it rather than guessing from
 * the status, which is how a vendor that returns 400 for a rate limit — and
 * they exist — gets retried correctly.
 */
export class ProviderError extends Error {
  readonly provider: string;
  readonly httpStatus: number | null;
  readonly retryable: boolean;
  readonly rateLimited: boolean;

  constructor(
    provider: string,
    message: string,
    options: { httpStatus?: number | null; retryable?: boolean; rateLimited?: boolean } = {},
  ) {
    super(message);
    this.name = "ProviderError";
    this.provider = provider;
    this.httpStatus = options.httpStatus ?? null;
    this.rateLimited = options.rateLimited ?? false;
    /* A rate limit is retryable by definition; anything else defaults to not,
       so an adapter has to opt in to spending money again. */
    this.retryable = options.retryable ?? options.rateLimited ?? false;
  }
}
