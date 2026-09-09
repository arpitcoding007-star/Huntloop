/**
 * Research for a visitor who has no account yet.
 *
 * ── What this is for ────────────────────────────────────────────────────
 *
 * The landing page's primary call to action is a domain box, not a button. A
 * visitor types `acme.com`, Huntloop reads the site, and shows them what it
 * understood — before there is a session, an organisation, or an email
 * address. The sign-up wall moves to *after* the value instead of in front of
 * it, and the account they then create arrives with step two already answered.
 *
 * That is the whole funnel, and it puts a paid model call behind an
 * unauthenticated endpoint. Everything below is the consequence.
 *
 * ── Why it lives in `packages/jobs` ─────────────────────────────────────
 *
 * `public_research` (migration `0025`) has RLS enabled and **no policy**, so
 * nothing reads or writes it through PostgREST for any role that respects RLS.
 * That is deliberate: a readable version of this table is a public index of
 * which companies have been researched and roughly when, which is competitive
 * intelligence about our own visitors.
 *
 * Writing it therefore needs the service-role client, and `scope.ts` is the
 * only runtime file in the repo permitted to hold one. The alternative — a
 * SECURITY DEFINER function granted to `anon` — would be strictly worse: it
 * would let any browser store arbitrary jsonb keyed by any domain, which is a
 * cache-poisoning primitive whose payload is then *claimed by the next person
 * to sign up from that company*.
 *
 * ── The three controls, and what each one is actually for ───────────────
 *
 *   1. **The cache.** The commonest case is several people from one company
 *      trying it in the same week. They should cost one call between them.
 *   2. **The per-IP window.** Stops one visitor enumerating domains.
 *   3. **The global daily ceiling.** The one that matters. A distributed
 *      script defeats (2) trivially; nothing defeats a hard cap on what the
 *      whole endpoint may spend in a day. When it is reached the page says
 *      "create an account to run this", which is a worse funnel and a bounded
 *      bill.
 */
import { adminClient } from "./scope.ts";

export interface CachedResearch {
  domain: string;
  understanding: unknown;
  isLive: boolean;
  researchedAt: string;
}

export type AllowanceDecision =
  | { allowed: true }
  | { allowed: false; reason: "rate_limited" | "over_budget"; message: string };

/**
 * How many domains one source may research in an hour.
 *
 * Generous for a person — nobody legitimately checks six companies in an hour
 * on a marketing page — and restrictive for a script.
 */
const PER_IP_PER_HOUR = 5;

/**
 * The whole endpoint's ceiling for a day.
 *
 * Configurable because it is a spend decision rather than an engineering one,
 * and it should be set deliberately before this ships. The default is low on
 * purpose: an unset ceiling on an unauthenticated endpoint that calls Opus
 * with web fetching is the single most expensive misconfiguration available in
 * this codebase, and a conservative default fails toward a smaller bill.
 */
function dailyCeiling(): number {
  const raw = Number(process.env.PUBLIC_RESEARCH_DAILY_LIMIT);
  return Number.isFinite(raw) && raw >= 0 ? raw : 200;
}

/** Whether the funnel is switched on at all. Off by default — see below. */
export function publicResearchEnabled(): boolean {
  return process.env.PUBLIC_RESEARCH_ENABLED === "true";
}

/**
 * The cached reading for a domain, if there is a live one.
 *
 * Expiry matters more than it looks. A company's site changes, and a
 * nine-month-old reading presented as current would be wrong in exactly the
 * way this product exists not to be — so the filter is on `expires_at` rather
 * than on age at read time, and `0025` sets it to thirty days.
 */
export async function lookupPublicResearch(domain: string): Promise<CachedResearch | null> {
  const { data, error } = await adminClient()
    .from("public_research")
    .select("canonical_domain, understanding, is_live, created_at")
    .eq("canonical_domain", domain)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (error || !data) return null;

  const row = data as {
    canonical_domain: string;
    understanding: unknown;
    is_live: boolean;
    created_at: string;
  };

  return {
    domain: row.canonical_domain,
    understanding: row.understanding,
    isLive: row.is_live,
    researchedAt: row.created_at,
  };
}

/**
 * Whether this request may spend a model call.
 *
 * Asked *before* the call, never after, for the same reason `rate-limit.ts`
 * gives: the calls that go wrong are the slow expensive ones, and a limit
 * checked afterwards has already paid for the thing it was meant to prevent.
 *
 * Both counters are read from `public_research` itself rather than from a
 * separate limiter table. That is a deliberate simplification with one real
 * consequence: a request that was *refused* leaves no row, so refusals do not
 * count toward the limits. Since a refusal costs nothing, that is the correct
 * direction for the imprecision to fall.
 */
export async function anonymousAllowance(ipHash: string): Promise<AllowanceDecision> {
  const db = adminClient();
  const now = Date.now();

  const ceiling = dailyCeiling();
  if (ceiling === 0) {
    return {
      allowed: false,
      reason: "over_budget",
      message: "Public research is switched off on this deployment.",
    };
  }

  const [{ count: ipCount }, { count: dayCount }] = await Promise.all([
    db
      .from("public_research")
      .select("id", { count: "exact", head: true })
      .eq("ip_hash", ipHash)
      .gte("created_at", new Date(now - 60 * 60 * 1000).toISOString()),
    db
      .from("public_research")
      .select("id", { count: "exact", head: true })
      .gte("created_at", new Date(now - 24 * 60 * 60 * 1000).toISOString()),
  ]);

  if ((ipCount ?? 0) >= PER_IP_PER_HOUR) {
    return {
      allowed: false,
      reason: "rate_limited",
      message:
        "You've looked up a few companies already. Create a free account and " +
        "there's no limit.",
    };
  }

  if ((dayCount ?? 0) >= ceiling) {
    return {
      allowed: false,
      reason: "over_budget",
      message:
        "We've hit today's limit for anonymous lookups. Create a free account " +
        "and we'll read your site right away.",
    };
  }

  return { allowed: true };
}

/**
 * Stores a reading, or refreshes the one that is there.
 *
 * `is_live` is carried rather than assumed. False means the deployment had no
 * model configured and this is the labelled worked example — storing that
 * distinction is what stops the example being promoted to a real reading by
 * the next visitor, or by the person who claims it at signup.
 */
export async function recordPublicResearch(
  domain: string,
  understanding: unknown,
  isLive: boolean,
  ipHash: string,
): Promise<void> {
  const db = adminClient();

  /* Upsert on the unique `canonical_domain`. Two visitors from the same
     company in the same second both get an answer; one row survives, and
     neither request fails on a constraint the user cannot see. */
  const { error } = await db.from("public_research").upsert(
    {
      canonical_domain: domain,
      understanding,
      is_live: isLive,
      ip_hash: ipHash,
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    },
    { onConflict: "canonical_domain" },
  );

  // Reported, not thrown. The visitor has their answer on screen either way,
  // and failing their request because the cache write failed would trade a
  // working funnel for a tidy log.
  if (error) console.error(`recordPublicResearch(${domain}): ${error.message}`);
}

/**
 * A stable, non-reversible identifier for a request source.
 *
 * Hashed rather than stored, because the question this answers is "is one
 * source hammering us", which a hash answers exactly as well as an address —
 * and an `inet` column here would be personal data about people who never
 * became customers.
 *
 * Salted with a deployment secret so the hashes are not comparable across
 * deployments and cannot be brute-forced from the (small) IPv4 space. Falls
 * back to a constant when unset, which weakens the anonymity but never the
 * rate limiting; a deployment that cares sets the variable.
 */
export async function hashIp(ip: string): Promise<string> {
  const salt = process.env.PUBLIC_RESEARCH_SALT ?? "huntloop-public-research";
  const bytes = new TextEncoder().encode(`${salt}:${ip}`);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}
