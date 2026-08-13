import type { TaskName } from "@huntloop/ai";
import { resolveDataSource } from "./data/source";

/**
 * Rate limiting for the paths that spend money.
 *
 * The counter lives in Postgres — see `packages/db/migrations/0005_rate_limits.sql`
 * for why that rather than Redis, and for the `consume_rate_limit()` function
 * this file calls. The membership check lives inside that function, because it
 * is SECURITY DEFINER and therefore the only thing standing between a stranger
 * and another org's quota.
 *
 * This is the second half of the fix in `recorder.ts`. That one stopped a
 * non-member spending our Anthropic budget; this bounds how fast a legitimate
 * member can. Both are needed and neither is a substitute for the other: RLS
 * protects rows, and the bill is not a row.
 */

export interface RateLimitDecision {
  allowed: boolean;
  /** Calls left in the current window. */
  remaining: number;
  /** When the window rolls over. Null when the limit could not be applied. */
  resetAt: Date | null;
  /**
   * True when no limit was enforced because there is no database to count in.
   *
   * Surfaced rather than hidden so a caller can decide, and so the honest
   * answer is available to whoever asks "was this call limited?".
   */
  unenforced?: boolean;
}

interface Limit {
  /** Per-person cap. Stops one user looping a form. */
  perUser: number;
  /** Org-wide cap. Ten seats looping the same form is the same bill. */
  perOrg: number;
  windowSeconds: number;
}

/**
 * Budgets, per task.
 *
 * Set against what the task actually costs rather than uniformly. The two that
 * fetch pages and run Opus at `high` effort are the expensive ones and get the
 * tightest budgets; `explain_why_now` reasons over evidence it is handed
 * without going back to the web, so it is cheaper and looser.
 *
 * These are deliberately generous for a human and restrictive for a script.
 * Twenty company analyses in an hour is a heavy day of real work; it is four
 * seconds of a loop.
 */
const LIMITS: Partial<Record<TaskName, Limit>> = {
  // ~8 page fetches + Opus high. The most expensive thing the product does.
  research_company: { perUser: 20, perOrg: 100, windowSeconds: 3600 },
  qualify_opportunity: { perUser: 20, perOrg: 100, windowSeconds: 3600 },
  // No fetching — reasons over claims already gathered.
  explain_why_now: { perUser: 60, perOrg: 300, windowSeconds: 3600 },
  // Onboarding. Run once or twice per org, ever.
  recommend_sources: { perUser: 20, perOrg: 60, windowSeconds: 3600 },
};

/**
 * Consumes one unit of budget for `task`, and says whether to proceed.
 *
 * Always call this *before* the model call, for the same reason `runs.ts`
 * writes its accounting row before the call: the calls that go wrong are the
 * ones that are slow and expensive, and a limit checked afterwards has already
 * paid for the thing it was meant to prevent.
 *
 * Both counters are consumed when both are configured, and the per-user one is
 * consumed first — so a single abusive seat exhausts its own budget before it
 * can eat into the org's.
 */
export async function consumeRateLimit(
  orgId: string,
  task: TaskName,
): Promise<RateLimitDecision> {
  const limit = LIMITS[task];
  if (!limit) return { allowed: true, remaining: Infinity, resetAt: null };

  const { db } = await resolveDataSource();

  /*
   * No database → nothing to count in.
   *
   * This is the same trade `resolveRecorder` already makes for cost accounting
   * and it is made here for consistency rather than re-argued: before the
   * migrations are applied there is no `rate_limits` table, and refusing would
   * make onboarding untestable during setup. It is bounded by the fact that
   * this configuration has no auth either — it is a local demo, not a
   * deployment — and it is reported rather than hidden.
   *
   * A deployment that has an ANTHROPIC_API_KEY and no database is the one
   * configuration where this is a real hole. That is a misconfiguration, and
   * it is recorded in the audit backlog rather than papered over here.
   */
  if (!db) {
    return { allowed: true, remaining: Infinity, resetAt: null, unenforced: true };
  }

  const perUser = await consumeOne(db, orgId, task, limit.perUser, limit.windowSeconds, true);
  if (!perUser.allowed) return perUser;

  return consumeOne(db, orgId, task, limit.perOrg, limit.windowSeconds, false);
}

type Db = NonNullable<Awaited<ReturnType<typeof resolveDataSource>>["db"]>;

async function consumeOne(
  db: Db,
  orgId: string,
  task: TaskName,
  max: number,
  windowSeconds: number,
  perUser: boolean,
): Promise<RateLimitDecision> {
  const { data, error } = await db.rpc("consume_rate_limit", {
    p_org: orgId,
    p_action: task,
    p_limit: max,
    p_window_seconds: windowSeconds,
    p_per_user: perUser,
  });

  if (error) {
    /*
     * Fail closed.
     *
     * The tempting alternative — proceed when the limiter is broken, so an
     * outage in a secondary system does not take the product down — is exactly
     * the reasoning that produced SEC-01: a cost control that yields under
     * pressure is not a control, and "the limiter is unreachable" is
     * indistinguishable from "someone is hammering the limiter".
     *
     * The blast radius of failing closed is a feature being unavailable. The
     * blast radius of failing open is an unbounded bill.
     */
    throw new Error(`Rate limit check failed: ${error.message}`);
  }

  // Postgres `returns table` arrives as a one-row array.
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("Rate limit check returned no decision.");

  return {
    allowed: Boolean(row.allowed),
    remaining: Number(row.remaining ?? 0),
    resetAt: row.reset_at ? new Date(row.reset_at) : null,
  };
}

/** Message for a caller that has been refused. Names when, not just no. */
export function rateLimitMessage(decision: RateLimitDecision): string {
  if (!decision.resetAt) {
    return "You've made too many requests. Try again shortly.";
  }
  const minutes = Math.max(
    1,
    Math.ceil((decision.resetAt.getTime() - Date.now()) / 60_000),
  );
  return (
    `You've reached the limit for this action. It resets in ` +
    `${minutes} minute${minutes === 1 ? "" : "s"}.`
  );
}
