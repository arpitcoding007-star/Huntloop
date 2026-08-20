import "server-only";
import type { TenantClient } from "@huntloop/db";

/**
 * The monthly ceiling on model runs, for the request path.
 *
 * ── The gap this closes (ANL-04) ─────────────────────────────────────────
 *
 * The engine has obeyed a monthly quota since it was written: `runForOrg`
 * checks `check_quota_internal` before every task and increments `ai_runs`
 * after every success, so the ceiling a customer sees on the billing screen is
 * the ceiling the engine obeys.
 *
 * The request path did neither. It consumed a *rate* limit, which bounds how
 * fast somebody can ask and resets every window — so a person clicking Analyze
 * once a minute all month stayed inside every limit the app enforced and spent
 * without bound. And because nothing on this side incremented the counter, the
 * usage screen reported a number that excluded every run started from the UI:
 * the bill and the meter disagreed, and the meter was the one being shown.
 *
 * ── Why `check_quota` rather than `check_quota_internal` ─────────────────
 *
 * `_internal` is granted to `service_role` only, which is right — it takes an
 * org id and answers for it. `check_quota` answers the same question through
 * the caller's own session: it is `SECURITY DEFINER` with a membership check
 * inside it, so a member can ask about their own org and nobody can ask about
 * anyone else's. That is the seam this path is supposed to use.
 *
 * ── Why it fails open ────────────────────────────────────────────────────
 *
 * The same decision the engine and `lib/data/usage.ts` already make: a quota
 * that cannot be read does not stop the product. The cost of failing open is a
 * reconciliation and it is ours; the cost of failing closed is a customer who
 * paid for a plan and cannot use it because a counter query failed.
 */

export interface BudgetDecision {
  allowed: boolean;
  used: number;
  /** Null means the plan has no ceiling for this metric. */
  quota: number | null;
}

export async function withinAiBudget(
  db: TenantClient,
  orgId: string,
): Promise<BudgetDecision> {
  const { data, error } = await db.rpc("check_quota", {
    p_org: orgId,
    p_metric: "ai_runs",
  });

  if (error) return { allowed: true, used: 0, quota: null };

  const row = (Array.isArray(data) ? data[0] : data) as
    | { used?: number; quota?: number | null; allowed?: boolean }
    | undefined;
  if (!row) return { allowed: true, used: 0, quota: null };

  return {
    allowed: Boolean(row.allowed),
    used: Number(row.used ?? 0),
    quota: row.quota === null || row.quota === undefined ? null : Number(row.quota),
  };
}

/**
 * What the user is told when they are over it.
 *
 * Names the number and when it resets. "You have reached your limit" with no
 * figure and no date is the shape that generates a support ticket, because the
 * only way to find out either is to ask.
 */
export function budgetRefusal(decision: BudgetDecision): { ok: false; error: string } {
  return {
    ok: false,
    error:
      `This organisation has used ${decision.used} of its ${decision.quota} model runs ` +
      `this month. The limit resets at the start of next month, and a larger plan ` +
      `raises it now.`,
  };
}

/**
 * Count a run that was delivered.
 *
 * After the fact, and deliberately not before: a refused or crashed call has
 * not produced anything the org asked for. The *cost* of it is still recorded
 * in `ai_runs`, which is where cost belongs — quota measures work delivered,
 * `ai_runs` measures money spent, and conflating them makes one of the two
 * wrong. Same split as the engine's.
 *
 * Failure is swallowed for the reason the engine gives: the work is done, and
 * a failed counter increment must not turn a completed run into an error the
 * user sees.
 */
export async function countAiRun(db: TenantClient, orgId: string): Promise<void> {
  const { error } = await db.rpc("increment_usage", {
    p_org: orgId,
    p_metric: "ai_runs",
    p_amount: 1,
  });
  if (error) console.error("ai_runs usage increment failed", error.message);
}
