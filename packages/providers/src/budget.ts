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

export interface Reservation extends BudgetState {
  /** Credits held against the counter until `settleReservation`. */
  reserved: number;
}

/**
 * The budget check and the spend, as one step (PROV-015, 0050).
 *
 * `budgetAllows` then a call is check-then-act: four lanes could each read
 * "one left" and all four spend it. This takes the credit a call needs to be
 * allowed in the statement that decides. Same fail-open posture as
 * `budgetAllows` when the state cannot be read — and then nothing is held,
 * so there is nothing to give back.
 */
export async function reserveCredit(
  db: AdminClient,
  orgId: string,
  provider: string,
): Promise<Reservation> {
  const { data, error } = await (db.rpc as Query)("reserve_provider_credit", {
    p_org: orgId,
    p_provider: provider,
  });

  /* Before 0050 the function does not exist; the old check still applies. */
  if (error || !Array.isArray(data) || data.length === 0) {
    return { ...(await budgetAllows(db, orgId, provider)), reserved: 0 };
  }

  const row = data[0] as {
    used: number | string;
    limit: number | string | null;
    remaining: number | string | null;
    allowed: boolean;
  };
  const allowed = row.allowed === true;

  return {
    allowed,
    used: Number(row.used ?? 0),
    limit: row.limit === null || row.limit === undefined ? null : Number(row.limit),
    remaining: row.remaining === null || row.remaining === undefined ? null : Number(row.remaining),
    assumed: false,
    reserved: allowed ? 1 : 0,
  };
}

/** Hands a reservation back once the ledger has counted the real spend. */
export async function settleReservation(
  db: AdminClient,
  orgId: string,
  provider: string,
  reservation: Reservation,
): Promise<void> {
  if (reservation.reserved <= 0) return;
  const { error } = await (db.rpc as Query)("settle_provider_credit", {
    p_org: orgId,
    p_provider: provider,
    p_reserved: reservation.reserved,
  });
  /* Unsettled means the counter is one high until the month turns: the safe
     direction, and worth a line in the log. */
  if (error) console.error(`[providers] could not settle a ${provider} reservation: ${error.message}`);
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
