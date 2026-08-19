import "server-only";
import type { TenantClient } from "@huntloop/db";

/**
 * Plan quota — `usage_counters` and `plans` from `0001`, written through
 * `0007`'s `increment_usage()`.
 *
 * ── How this differs from the rate limiter ───────────────────────────────
 *
 * They look alike and answer different questions, and conflating them makes
 * one of the two wrong:
 *
 *   `lib/rate-limit.ts`   how *fast* — a fixed window, resets hourly, exists
 *                         to stop a loop costing money. Refusing is temporary
 *                         and the user should retry later.
 *   this file             how *much* — a calendar month against the plan the
 *                         org pays for. Refusing is not temporary; the answer
 *                         is to upgrade, and the message has to say so.
 *
 * A rate-limit message ("try again in 40 minutes") shown for an exhausted
 * plan quota is a lie that costs a sale.
 */

/** The metrics `plans.limits` carries. Keys, not free text. */
export type UsageMetric = "opportunities" | "ai_runs" | "emails" | "enrich" | "seats";

export interface Quota {
  used: number;
  /** `null` means unlimited — a real answer, and not the same as zero. */
  limit: number | null;
  allowed: boolean;
}

/**
 * What the quota is, without spending any of it.
 *
 * Used to render "412 of 1,000 this month" and to decide whether to offer an
 * action at all. Never used *instead of* `consumeQuota` before doing the work:
 * between a check and a use, a second request can consume the last unit.
 */
export async function checkQuota(
  db: TenantClient,
  orgId: string,
  metric: UsageMetric,
): Promise<Quota> {
  const { data, error } = await db.rpc("check_quota", { p_org: orgId, p_metric: metric });
  if (error || !data) return UNKNOWN;

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return UNKNOWN;

  return {
    used: Number(row.used ?? 0),
    limit: row.quota === null || row.quota === undefined ? null : Number(row.quota),
    allowed: Boolean(row.allowed),
  };
}

/**
 * Spend, and say whether that was within the plan.
 *
 * Always increments, including when the answer is no — same reasoning as
 * `consume_rate_limit`: a counter that stops counting once over limit hides
 * the overage exactly when somebody needs to see it. The caller decides what
 * to do with `allowed`; this function never refuses on the caller's behalf.
 */
export async function consumeQuota(
  db: TenantClient,
  orgId: string,
  metric: UsageMetric,
  amount = 1,
): Promise<Quota> {
  const { data, error } = await db.rpc("increment_usage", {
    p_org: orgId,
    p_metric: metric,
    p_amount: amount,
  });
  if (error || !data) return UNKNOWN;

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return UNKNOWN;

  return {
    used: Number(row.used ?? 0),
    limit: row.quota === null || row.quota === undefined ? null : Number(row.quota),
    allowed: Boolean(row.allowed),
  };
}

/**
 * The sentence a user reads when their plan is exhausted.
 *
 * Written once, here, because the difference between this and a rate-limit
 * message is the whole reason the two systems are separate — and a message
 * composed at each call site is where that distinction gets lost.
 */
export function quotaMessage(metric: UsageMetric, quota: Quota): string {
  const noun = NOUNS[metric];
  return (
    `Your plan includes ${quota.limit?.toLocaleString() ?? "unlimited"} ${noun} a month, ` +
    `and this organisation has used ${quota.used.toLocaleString()}. ` +
    `This is a plan limit rather than a temporary one — it resets at the start of ` +
    `next month, or an owner can change the plan under Settings → Billing.`
  );
}

const NOUNS: Record<UsageMetric, string> = {
  opportunities: "qualified opportunities",
  ai_runs: "model runs",
  emails: "sent emails",
  enrich: "contact enrichments",
  seats: "seats",
};

/**
 * What we return when the counter itself could not be read.
 *
 * `allowed: true` on purpose, and it is the one decision in this file worth
 * arguing about. Failing open means a database problem lets an org over-spend
 * its plan by some amount; failing closed means the same problem stops every
 * customer working. The rate limiter makes the opposite choice, because there
 * the cost of failing open is a bill from Anthropic that arrives regardless of
 * whether we meant it. Here the cost is a reconciliation, and it is ours.
 *
 * `limit: null` keeps the UI honest while that is true: it renders as
 * "unlimited", not as a number this function does not have.
 */
const UNKNOWN: Quota = { used: 0, limit: null, allowed: true };

/**
 * Every quota for one org, for the billing screen.
 *
 * Sequential rather than parallel: PostgREST opens a connection per request
 * and five at once for a settings page is a poor use of the pool for data
 * nobody is waiting on.
 */
export async function allQuotas(
  db: TenantClient,
  orgId: string,
): Promise<Record<UsageMetric, Quota>> {
  const metrics: UsageMetric[] = ["opportunities", "ai_runs", "emails", "enrich", "seats"];
  const out = {} as Record<UsageMetric, Quota>;
  for (const m of metrics) out[m] = await checkQuota(db, orgId, m);
  return out;
}
