/**
 * Budgets and breakers — the two things that stop a bad day becoming a bill.
 *
 * ── The fail-open decision, and why it is the same as `withinAiBudget` ───
 *
 * When the budget cannot be *read* — the table is unavailable, the RPC
 * errors — this allows the call. That looks wrong and is deliberate, and the
 * reasoning is copied verbatim from `apps/web/lib/ai/budget.ts` because it is
 * the same trade:
 *
 *   the cost of failing open  is a reconciliation, and it is ours
 *   the cost of failing closed is a customer whose product stopped working
 *                              because a housekeeping table was unavailable
 *
 * When the budget *is* read and says no, it fails closed. That is not the
 * same situation and it is not the same decision.
 *
 * ── Why the breaker is in the database ───────────────────────────────────
 *
 * Because this runs on serverless functions. An in-process breaker across N
 * instances is N independent breakers, each of which has to learn the outage
 * separately — N times the failed calls and N times the bill, at exactly the
 * moment the vendor is asking for less traffic.
 *
 * `PERF-05` accepted a per-instance cache for a HEAD request. This is the
 * case where that trade goes the other way, and the difference is that one
 * saves a request while the other spends money.
 */
import type { AdminClient } from "@huntloop/db/admin";

/* eslint-disable @typescript-eslint/no-explicit-any -- see cache.ts */
type Query = any;

export interface BudgetState {
  allowed: boolean;
  used: number;
  /** Null when no limit is configured, which is not the same as a limit of zero. */
  limit: number | null;
  remaining: number | null;
  /** True when the state could not be read and we allowed the call anyway. */
  assumed: boolean;
}

export async function budgetAllows(
  db: AdminClient,
  orgId: string,
  provider: string,
): Promise<BudgetState> {
  const { data, error } = await (db.rpc as Query)("provider_budget_state", {
    p_org: orgId,
    p_provider: provider,
  });

  if (error || !Array.isArray(data) || data.length === 0) {
    return { allowed: true, used: 0, limit: null, remaining: null, assumed: true };
  }

  const row = data[0] as {
    used: number | string;
    limit: number | string | null;
    remaining: number | string | null;
    allowed: boolean;
  };

  return {
    allowed: row.allowed !== false,
    used: Number(row.used ?? 0),
    limit: row.limit === null || row.limit === undefined ? null : Number(row.limit),
    remaining: row.remaining === null || row.remaining === undefined ? null : Number(row.remaining),
    assumed: false,
  };
}

/**
 * Is this provider being left alone?
 *
 * Same fail-open posture: a breaker whose state cannot be read must not stop
 * the product. The consequence is a few extra failed calls during an outage
 * that also happens to have broken the breaker table, which is a situation
 * with bigger problems.
 */
export async function breakerOpen(
  db: AdminClient,
  orgId: string,
  provider: string,
): Promise<boolean> {
  const { data, error } = await (db.from("provider_breakers") as Query)
    .select("open_until")
    .eq("org_id", orgId)
    .eq("provider", provider)
    .maybeSingle();

  if (error || !data) return false;

  const openUntil = (data as { open_until: string | null }).open_until;
  if (!openUntil) return false;
  return new Date(openUntil).getTime() > Date.now();
}

/**
 * A human sentence for a refusal.
 *
 * Every refusal in this package reaches a screen eventually — the discovery
 * run says why it stopped, the enrichment says why it did not run — and a
 * refusal a user cannot understand is a support ticket. Same reason
 * `budgetRefusal` exists on the AI side.
 */
export function describeBudget(state: BudgetState, provider: string): string {
  if (state.allowed) {
    if (state.limit === null) return `No ${provider} credit limit is set for this organisation.`;
    return `${state.remaining} of ${state.limit} ${provider} credits left this month.`;
  }
  return (
    `This organisation has used all ${state.limit} of its ${provider} credits for the month. ` +
    `Discovery and enrichment through ${provider} will resume next month, or when an ` +
    `administrator raises the limit in Settings.`
  );
}
