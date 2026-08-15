import * as Sentry from "@sentry/nextjs";
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
  /**
   * Why the call was refused. Absent when `allowed`.
   *
   * `exhausted`     the budget is spent — a normal, user-facing outcome.
   * `unenforceable` the limit could not be applied at all. Not the user's
   *                 doing and not something they can wait out.
   */
  reason?: "exhausted" | "unenforceable";
}

/**
 * A refusal, in the shape the AI wrappers return.
 *
 * `kind` exists so a screen can tell "you've done this too often" apart from
 * "that failed" and render the right thing — `RateLimited` carries a retry
 * time, `ErrorState` carries a retry button, and showing either in the other's
 * place is actively misleading.
 *
 * `retryAt` is an ISO string rather than a Date because this crosses a Server
 * Action boundary, and a string has one unambiguous representation on both
 * sides.
 */
export interface RateLimitRefusal {
  ok: false;
  kind: "rate_limited";
  error: string;
  retryAt: string | null;
}

export function refusal(
  decision: RateLimitDecision,
): RateLimitRefusal | { ok: false; error: string } {
  /*
   * `unenforceable` is deliberately NOT tagged as a rate limit.
   *
   * From the user's side the two are different events: one is "you have done
   * this too often", which is their doing and passes with time, and the other
   * is "this deployment is misconfigured", which is neither. Tagging both the
   * same way would put them under a heading reading "Too many requests" and a
   * retry time that will never arrive — blaming the user for our mistake, and
   * telling them to wait for something that is not coming.
   */
  if (decision.reason === "unenforceable") {
    return { ok: false, error: rateLimitMessage(decision) };
  }

  return {
    ok: false,
    kind: "rate_limited",
    error: rateLimitMessage(decision),
    retryAt: decision.resetAt?.toISOString() ?? null,
  };
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
   * Locally this is a normal state: before the migrations are applied there is
   * no `rate_limits` table, and refusing would make onboarding untestable
   * during setup. It is bounded by the fact that this configuration has no
   * auth either — it is a demo, not a deployment.
   *
   * In production it is none of those things. A deployment with an
   * ANTHROPIC_API_KEY and no database has no auth, no metering, and no limit,
   * which is every control removed at once — so it refuses instead. That is
   * RL-01 in the audit backlog, and the asymmetry is the whole point: the
   * permissive branch is only reachable where nothing is at stake.
   *
   * NODE_ENV rather than a check for the production URL, deliberately: preview
   * deploys also build as production, they are also publicly reachable, and
   * their model calls are billed to the same account.
   */
  if (!db) {
    if (process.env.NODE_ENV !== "production") {
      return { allowed: true, remaining: Infinity, resetAt: null, unenforced: true };
    }

    // The user cannot act on this and did nothing wrong; the operator can, and
    // would otherwise never find out. Sentry is the right audience.
    Sentry.captureMessage(
      "Rate limiting is unenforceable: a production deployment has an AI key " +
        "and no database. Refusing model calls. See audit/BACKLOG.md RL-01.",
      "error",
    );

    return {
      allowed: false,
      remaining: 0,
      resetAt: null,
      unenforced: true,
      reason: "unenforceable",
    };
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
     * A partially applied schema is its own state, and it is the one this
     * project was actually found in: 0001–0004 applied, 0005 not.
     *
     * `isSchemaApplied()` probes `organizations`, so that project reports as
     * fully live — every screen renders real rows — while this RPC does not
     * exist. Left as the generic branch below, the result was an unhandled
     * "Rate limit check failed: Could not find the function
     * public.consume_rate_limit" on a screen with no way to explain it.
     *
     * It is the same *situation* as a production deployment with no database:
     * the limiter cannot run. So it takes the same path — refuse, tag it
     * `unenforceable`, and tell the operator rather than the user, because
     * only the operator can fix it. The user-facing behaviour is identical to
     * the branch above and for the identical reason.
     */
    if (isMissingLimiterSchema(error)) {
      Sentry.captureMessage(
        "Rate limiting is unenforceable: consume_rate_limit() is missing. " +
          "Apply packages/db/migrations/0005_rate_limits.sql — see SETUP.md " +
          "step 3. Refusing model calls until then.",
        "error",
      );
      return {
        allowed: false,
        remaining: 0,
        resetAt: null,
        unenforced: true,
        reason: "unenforceable",
      };
    }

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

  const allowed = Boolean(row.allowed);
  return {
    allowed,
    remaining: Number(row.remaining ?? 0),
    resetAt: row.reset_at ? new Date(row.reset_at) : null,
    ...(allowed ? {} : { reason: "exhausted" as const }),
  };
}

/**
 * Is this error "0005 has not been applied" rather than "the call failed"?
 *
 * Narrow on purpose. Widening it would turn a transient database fault into a
 * silent refusal that never reaches the `throw` below, which is the failure the
 * generic branch exists to make loud.
 *
 *   PGRST202  PostgREST cannot find the function in its schema cache
 *   PGRST205  …or the table
 *   42883     Postgres: undefined_function
 *   42P01     Postgres: undefined_table
 */
function isMissingLimiterSchema(error: { code?: string; message: string }): boolean {
  if (error.code && ["PGRST202", "PGRST205", "42883", "42P01"].includes(error.code)) {
    return true;
  }
  return /consume_rate_limit|rate_limits/.test(error.message) &&
    /(does not exist|schema cache|could not find)/i.test(error.message);
}

/** Message for a caller that has been refused. Names when, not just no. */
export function rateLimitMessage(decision: RateLimitDecision): string {
  if (decision.reason === "unenforceable") {
    // Says nothing about why. The cause is a deployment misconfiguration, and
    // "this server has an AI key but no database" is a map of what to attack.
    return (
      "This feature is temporarily unavailable. The team has been notified — " +
      "nothing you did caused this."
    );
  }
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
