/**
 * Public surface of @huntloop/providers.
 *
 * ── What a caller sees ───────────────────────────────────────────────────
 *
 * Five functions, one per capability. Each takes an org and a Huntloop-shaped
 * query, and returns a Huntloop-shaped result with a `meta` describing what
 * it cost and where it came from. None of them mentions a vendor, and that is
 * the whole design — `PRV-CHK` fails the build if any file outside
 * `src/adapters/` names one.
 *
 * ── The two ways a call ends ─────────────────────────────────────────────
 *
 * A **result** means the provider answered. `meta.outcome` says how: `ok`,
 * `partial` (more exists, resumable), `empty` (they looked and have nothing),
 * or `cache_hit`.
 *
 * A **`ProviderRefused`** means nothing was called and nothing was spent. It
 * carries the reason, and every caller is expected to surface it rather than
 * swallow it — because "we did not search" and "your market is empty" are the
 * two things this system must never confuse.
 *
 * A thrown `ProviderError` means the provider was called and failed after its
 * retries. Also not an empty result.
 */
import type { AdminClient } from "@huntloop/db/admin";
import {
  type Capability,
  type CompanySearchQuery,
  type CompanySearchResult,
  type PersonMatchQuery,
  type PersonSearchQuery,
  type PersonSearchResult,
  type ProviderCompany,
  type ProviderPerson,
  type ProviderResult,
  type VerificationStatus,
} from "./contract.ts";
import { ProviderRefused, callProvider } from "./call.ts";
import { TTL, requestHash } from "./cache.ts";
import { adapterFor, credentialsKnownBad } from "./registry.ts";

export interface CallContext {
  db: AdminClient;
  orgId: string;
  /** What this call is about, for the ledger. */
  entity?: { type: string; id: string } | null;
  /** Bypass the cache. For a refresh a user explicitly asked for. */
  refresh?: boolean;
}

/**
 * Steps 1 and 2 of the order documented in `call.ts`.
 *
 * Here rather than in `callProvider` because both are about *routing* — is
 * there an adapter, and is its key known to be broken — and `callProvider`
 * takes the adapter method as an argument, by which point routing has already
 * happened.
 */
async function route(
  ctx: CallContext,
  capability: Capability,
): Promise<{ adapter: NonNullable<ReturnType<typeof adapterFor>>; provider: string }> {
  const adapter = adapterFor(capability);

  if (!adapter) {
    throw new ProviderRefused({
      provider: "none",
      capability,
      outcome: "refused",
      credits: 0,
      latencyMs: null,
      httpStatus: null,
      attempts: 0,
      cachedAt: null,
      error:
        `No provider is configured for ${capability}. This deployment cannot ` +
        `answer that question, which is a configuration state rather than a failure.`,
      refusal: "no_provider",
    });
  }

  if (await credentialsKnownBad(ctx.db, ctx.orgId, capability)) {
    throw new ProviderRefused({
      provider: adapter.name,
      capability,
      outcome: "refused",
      credits: 0,
      latencyMs: null,
      httpStatus: null,
      attempts: 0,
      cachedAt: null,
      error:
        `The ${adapter.name} credentials for this organisation were rejected the ` +
        `last time they were checked. Fix the key rather than retrying — a bad ` +
        `key produces no results, not an error, in every call that follows.`,
      refusal: "credentials_invalid",
    });
  }

  return { adapter, provider: adapter.name };
}

/* ── company.search ────────────────────────────────────────────────────── */

export async function searchCompanies(
  ctx: CallContext,
  query: CompanySearchQuery,
): Promise<ProviderResult<CompanySearchResult>> {
  const { adapter, provider } = await route(ctx, "company.search");
  const run = adapter.searchCompanies;
  if (!run) throw unsupported(provider, "company.search");

  return callProvider<CompanySearchResult>({
    db: ctx.db,
    orgId: ctx.orgId,
    capability: "company.search",
    provider,
    requestHash: requestHash("company.search", provider, query),
    ttl: TTL["company.search"],
    entity: ctx.entity ?? null,
    skipCache: ctx.refresh ?? false,
    run: () => run.call(adapter, query),
    fromCache: (body) => body as CompanySearchResult,
    toCache: (data) => data,
  });
}

/* ── company.enrich ────────────────────────────────────────────────────── */

export async function enrichCompany(
  ctx: CallContext,
  input: { domain: string | null; name: string | null; providerId: string | null },
): Promise<ProviderResult<ProviderCompany | null>> {
  const { adapter, provider } = await route(ctx, "company.enrich");
  const run = adapter.enrichCompany;
  if (!run) throw unsupported(provider, "company.enrich");

  return callProvider<ProviderCompany | null>({
    db: ctx.db,
    orgId: ctx.orgId,
    capability: "company.enrich",
    provider,
    requestHash: requestHash("company.enrich", provider, input),
    ttl: TTL["company.enrich"],
    entity: ctx.entity ?? null,
    skipCache: ctx.refresh ?? false,
    run: () => run.call(adapter, input),
    fromCache: (body) => (body ?? null) as ProviderCompany | null,
    toCache: (data) => data,
    /* A null enrichment IS cached. "We asked about this domain and they have
       nothing" is a real answer and re-asking it monthly is the correct
       cadence — paying for it on every opportunity that touches the company
       is not. The failure case this does not cover, a provider outage
       returning null, cannot happen: an outage throws, and a throw is never
       cached. */
  });
}

/* ── person.search ─────────────────────────────────────────────────────── */

export async function searchPeople(
  ctx: CallContext,
  query: PersonSearchQuery,
): Promise<ProviderResult<PersonSearchResult>> {
  const { adapter, provider } = await route(ctx, "person.search");
  const run = adapter.searchPeople;
  if (!run) throw unsupported(provider, "person.search");

  return callProvider<PersonSearchResult>({
    db: ctx.db,
    orgId: ctx.orgId,
    capability: "person.search",
    provider,
    requestHash: requestHash("person.search", provider, query),
    ttl: TTL["person.search"],
    entity: ctx.entity ?? null,
    skipCache: ctx.refresh ?? false,
    run: () => run.call(adapter, query),
    fromCache: (body) => body as PersonSearchResult,
    toCache: (data) => data,
  });
}

/* ── person.match ──────────────────────────────────────────────────────── */

export async function matchPerson(
  ctx: CallContext,
  query: PersonMatchQuery,
): Promise<ProviderResult<ProviderPerson | null>> {
  const { adapter, provider } = await route(ctx, "person.match");
  const run = adapter.matchPerson;
  if (!run) throw unsupported(provider, "person.match");

  return callProvider<ProviderPerson | null>({
    db: ctx.db,
    orgId: ctx.orgId,
    capability: "person.match",
    provider,
    requestHash: requestHash("person.match", provider, query),
    ttl: TTL["person.match"],
    entity: ctx.entity ?? null,
    skipCache: ctx.refresh ?? false,
    run: () => run.call(adapter, query),
    fromCache: (body) => (body ?? null) as ProviderPerson | null,
    toCache: (data) => data,
  });
}

/* ── email.verify ──────────────────────────────────────────────────────── */

export async function verifyEmail(
  ctx: CallContext,
  email: string,
): Promise<ProviderResult<VerificationStatus>> {
  const { adapter, provider } = await route(ctx, "email.verify");
  const run = adapter.verifyEmail;
  if (!run) throw unsupported(provider, "email.verify");

  const normalized = email.trim().toLowerCase();

  return callProvider<VerificationStatus>({
    db: ctx.db,
    orgId: ctx.orgId,
    capability: "email.verify",
    provider,
    requestHash: requestHash("email.verify", provider, { email: normalized }),
    ttl: TTL["email.verify"],
    entity: ctx.entity ?? null,
    skipCache: ctx.refresh ?? false,
    run: () => run.call(adapter, normalized),
    fromCache: (body) => body as VerificationStatus,
    toCache: (data) => data,
    /* `unknown` is NOT cached for ninety days. It means the verifier ran and
       could not tell, which is frequently transient — a greylisting mail
       server, a temporary DNS failure — and caching it would make one bad
       moment permanent for a quarter. Every other status is an assertion and
       is cached. */
    cacheable: (data) => data !== "unknown",
  });
}

function unsupported(provider: string, capability: Capability): ProviderRefused {
  return new ProviderRefused({
    provider,
    capability,
    outcome: "refused",
    credits: 0,
    latencyMs: null,
    httpStatus: null,
    attempts: 0,
    cachedAt: null,
    error: `${provider} does not implement ${capability}.`,
    refusal: "capability_unsupported",
  });
}

/* ── Re-exports ────────────────────────────────────────────────────────── */

export {
  CAPABILITIES,
  ProviderError,
  isCapability,
  type Capability,
  type CallMeta,
  type CallOutcome,
  type CompanySearchQuery,
  type CompanySearchResult,
  type PersonMatchQuery,
  type PersonSearchQuery,
  type PersonSearchResult,
  type ProviderCompany,
  type ProviderPerson,
  type ProviderResult,
  type RefusalReason,
  type VerificationStatus,
} from "./contract.ts";

export { ProviderRefused, MAX_ATTEMPTS, TIMEOUT_MS } from "./call.ts";
export { TTL, invalidate, requestHash } from "./cache.ts";
export { usageThisMonth, type ProviderUsage } from "./ledger.ts";
export { budgetAllows, breakerOpen, describeBudget, type BudgetState } from "./budget.ts";
export {
  adapterFor,
  configuredProviders,
  credentialsKnownBad,
  providerFor,
  resetRegistryForTests,
  verifyCredentials,
  type ConfiguredProvider,
  type CredentialCheck,
} from "./registry.ts";
