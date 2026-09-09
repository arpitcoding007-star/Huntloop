/**
 * Everything that happens around a provider call.
 *
 * ── Why this is one function and not five middlewares ────────────────────
 *
 * Because the order is the design, and a composition mechanism would let
 * somebody change it without noticing. The order is:
 *
 *   1. is a provider configured?            no  → refused, costs nothing
 *   2. are its credentials known-bad?        yes → refused, costs nothing
 *   3. is the breaker open?                  yes → refused, costs nothing
 *   4. is there a cached answer?             yes → cache_hit, costs nothing
 *   5. is there budget left?                 no  → refused, costs nothing
 *   6. call, with retries
 *   7. record the ledger row, always
 *   8. cache the answer, if it is cacheable
 *
 * Every step before 6 costs nothing, and that is the point: five of the eight
 * are there to *not* spend money. Cache before budget (4 before 5) is the one
 * that looks wrong and is not — a cached answer costs nothing, so refusing it
 * for lack of budget would deny a customer data we already hold and paid for.
 *
 * ── What is deliberately not here ────────────────────────────────────────
 *
 * Any knowledge of a vendor. This file never sees a URL, a header or a JSON
 * body; it sees an adapter method and a promise. That is what makes the
 * retry policy uniform and what makes `PRV-CHK` enforceable.
 */
import type { AdminClient } from "@huntloop/db/admin";
import {
  ProviderError,
  type Capability,
  type CallMeta,
  type ProviderResult,
  type RawCall,
  type RefusalReason,
} from "./contract.ts";
import { readCache, writeCache, type CacheTtl } from "./cache.ts";
import { recordCall } from "./ledger.ts";
import { budgetAllows, breakerOpen } from "./budget.ts";

/**
 * The retry policy, in one place.
 *
 * Three attempts, exponential with jitter, 15-second timeout each. The
 * numbers are chosen against what these calls actually are: a provider search
 * takes 300ms–3s, so 15s is "something is wrong" rather than "this is slow",
 * and a third attempt eight seconds after the first is past almost every
 * transient failure while still being inside a job's own deadline.
 *
 * Jitter matters more than it looks. Without it, a tick that claims ten jobs
 * and hits a rate limit retries all ten at the same millisecond, three times
 * — which is a self-inflicted thundering herd against a vendor that just told
 * us to slow down.
 */
export const MAX_ATTEMPTS = 3;
export const TIMEOUT_MS = 15_000;

function backoffMs(attempt: number): number {
  const base = 500 * Math.pow(2, attempt - 1);
  return base + Math.floor(Math.random() * base);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface CallOptions<T> {
  db: AdminClient;
  orgId: string;
  capability: Capability;
  provider: string;
  /** sha256 of the normalized request. Produced by the caller — see `cache.ts`. */
  requestHash: string;
  /** How long an answer to this question stays true. */
  ttl: CacheTtl;
  /** What the call is about, for the ledger. */
  entity?: { type: string; id: string } | null;
  /** The adapter method. Called at most `MAX_ATTEMPTS` times. */
  run: () => Promise<RawCall<T>>;
  /** Rebuilds the typed result from a cached body. */
  fromCache: (body: unknown) => T;
  /** Turns a live result into something storable. */
  toCache: (data: T) => unknown;
  /**
   * Whether this answer may be cached.
   *
   * Defaults to true. The caller says no for an answer whose emptiness might
   * be a provider problem rather than a fact — see the note in `providers.ts`
   * about an outage cached as "no results", which is the failure this whole
   * flag exists for.
   */
  cacheable?: (data: T) => boolean;
  /** Skip the cache read. For a deliberate refresh a user asked for. */
  skipCache?: boolean;
}

function refusal(
  provider: string,
  capability: Capability,
  reason: RefusalReason,
  detail: string,
): CallMeta {
  return {
    provider,
    capability,
    outcome: "refused",
    credits: 0,
    latencyMs: null,
    httpStatus: null,
    attempts: 0,
    cachedAt: null,
    error: detail,
    refusal: reason,
  };
}

/**
 * A refusal, with the shape a caller can act on.
 *
 * Thrown rather than returned because the alternative is every call site
 * checking `meta.outcome === "refused"` before touching `data`, and `data`
 * has no honest value for a call that did not happen. Returning an empty
 * result would be the exact confusion this package exists to prevent.
 */
export class ProviderRefused extends Error {
  readonly meta: CallMeta;
  constructor(meta: CallMeta) {
    super(meta.error ?? "The provider call was refused.");
    this.name = "ProviderRefused";
    this.meta = meta;
  }
}

export async function callProvider<T>(options: CallOptions<T>): Promise<ProviderResult<T>> {
  const { db, orgId, capability, provider, requestHash, ttl } = options;
  const entity = options.entity ?? null;

  /* ── 3. breaker ──────────────────────────────────────────────────────
     Steps 1 and 2 are the registry's, which is why they are not here: a
     provider that is not configured has no adapter to call, and there is
     nothing to route. */
  if (await breakerOpen(db, orgId, provider)) {
    const meta = refusal(
      provider,
      capability,
      "breaker_open",
      `${provider} has failed repeatedly and is being left alone for a few minutes.`,
    );
    await recordCall(db, { orgId, meta, requestHash, entity });
    throw new ProviderRefused(meta);
  }

  /* ── 4. cache ────────────────────────────────────────────────────────
     Before the budget check, deliberately: an answer we already hold cost
     nothing to serve, and refusing it for lack of budget would deny a
     customer data they have already paid for. */
  if (!options.skipCache) {
    const cached = await readCache(db, orgId, requestHash);
    if (cached) {
      const meta: CallMeta = {
        provider,
        capability,
        outcome: "cache_hit",
        credits: 0,
        latencyMs: null,
        httpStatus: null,
        attempts: 0,
        cachedAt: cached.fetchedAt,
        error: null,
        refusal: null,
      };
      /* A hit still writes a ledger row. Without it the hit rate is
         unmeasurable, and an unmeasured cache is indistinguishable from a
         broken one. */
      await recordCall(db, { orgId, meta, requestHash, entity });
      return { meta, data: options.fromCache(cached.body) };
    }
  }

  /* ── 5. budget ───────────────────────────────────────────────────── */
  const budget = await budgetAllows(db, orgId, provider);
  if (!budget.allowed) {
    const meta = refusal(
      provider,
      capability,
      "budget_exhausted",
      `This organisation has used its ${provider} credit allowance for the month (${budget.used} of ${budget.limit}).`,
    );
    await recordCall(db, { orgId, meta, requestHash, entity });
    throw new ProviderRefused(meta);
  }

  /* ── 6. call ─────────────────────────────────────────────────────── */
  const started = Date.now();
  let attempt = 0;
  let lastError: unknown = null;

  while (attempt < MAX_ATTEMPTS) {
    attempt++;
    try {
      const raw = await options.run();
      const latencyMs = Date.now() - started;

      /* `partial` and `empty` are both successes and both distinct from `ok`.
         Getting this wrong is the "failed search looks like an empty market"
         failure, one layer down from where the discovery runner reports it. */
      const outcome = raw.partial
        ? "partial"
        : isEmptyResult(raw.data)
          ? "empty"
          : "ok";

      const meta: CallMeta = {
        provider,
        capability,
        outcome,
        credits: raw.credits,
        latencyMs,
        httpStatus: raw.httpStatus,
        attempts: attempt,
        cachedAt: null,
        error: null,
        refusal: null,
      };

      await recordCall(db, { orgId, meta, requestHash, entity });

      /* ── 8. cache ───────────────────────────────────────────────────
         Only successes, and only what the caller says is cacheable. A
         `partial` result IS cached — it is a real answer to the question
         asked, and the cursor beside it is what makes the next page cheap. */
      const cacheable = options.cacheable ? options.cacheable(raw.data) : true;
      if (cacheable) {
        await writeCache(db, {
          orgId,
          capability,
          provider,
          requestHash,
          body: options.toCache(raw.data),
          ttl,
        });
      }

      return { meta, data: raw.data };
    } catch (e) {
      lastError = e;
      const providerError = e instanceof ProviderError ? e : null;
      const retryable = providerError?.retryable ?? isTransport(e);

      if (!retryable || attempt >= MAX_ATTEMPTS) break;
      await sleep(backoffMs(attempt));
    }
  }

  /* ── 7. record the failure ───────────────────────────────────────────
     A failure is never cached. An outage stored as "no results" would be
     served for the whole TTL, and a customer would spend a day looking at an
     empty market that is not empty. */
  const providerError = lastError instanceof ProviderError ? lastError : null;
  const message = lastError instanceof Error ? lastError.message : String(lastError);

  const meta: CallMeta = {
    provider,
    capability,
    outcome: providerError?.rateLimited ? "rate_limited" : "failed",
    credits: 0,
    latencyMs: Date.now() - started,
    httpStatus: providerError?.httpStatus ?? null,
    attempts: attempt,
    cachedAt: null,
    error: message.slice(0, 500),
    refusal: null,
  };

  await recordCall(db, { orgId, meta, requestHash, entity });
  throw lastError instanceof Error ? lastError : new Error(message);
}

/**
 * Is this result "the provider looked and found nothing"?
 *
 * Shape-based rather than typed, because the envelope differs per capability
 * and a discriminator on every result type would be four extra fields to keep
 * in sync for one question asked in one place.
 */
function isEmptyResult(data: unknown): boolean {
  if (data === null || data === undefined) return true;
  if (Array.isArray(data)) return data.length === 0;
  if (typeof data === "object" && "items" in data) {
    const items = (data as { items?: unknown }).items;
    return Array.isArray(items) && items.length === 0;
  }
  return false;
}

/**
 * A network-layer failure, as opposed to the vendor rejecting the request.
 *
 * Retried, because a DNS blip or a dropped socket says nothing about whether
 * the request was valid. A vendor's 400 says a great deal, and is not retried
 * unless the adapter marks it — which is the `ProviderError.retryable` seam.
 */
function isTransport(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  if (e.name === "TimeoutError" || e.name === "AbortError") return true;
  const message = e.message.toLowerCase();
  return (
    message.includes("fetch failed") ||
    message.includes("econnreset") ||
    message.includes("etimedout") ||
    message.includes("enotfound") ||
    message.includes("socket hang up") ||
    message.includes("network")
  );
}
