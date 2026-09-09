/**
 * `schedule_recomputes` — turn a customer's request to rescore into work.
 *
 * The other half of `0023`'s seam. A Server Action may not write to
 * `job_executions` — that would put the service-role bypass on a public POST
 * endpoint — so it writes a `score_recompute_requests` row through RLS, and
 * this sweeper is the one writer that turns those rows into jobs.
 *
 * Exactly the shape `schedule_discovery` has, for exactly the same reason, and
 * the claim is the same `for update skip locked`: two ticks overlapping must
 * not both start the same recomputation.
 *
 * ── Why the cap is low ───────────────────────────────────────────────────
 *
 * A recomputation is the most expensive thing a customer can ask for — one
 * model call per opportunity. Five concurrent ones across the estate is
 * already the largest sustained spend this system can generate, and the next
 * tick is thirty seconds away, so a sixth request waits half a minute rather
 * than doubling the bill.
 */
import { enqueue } from "../queue.ts";
import { OrgScope } from "../scope.ts";
import type { JobContext, JobOutcome } from "../registry.ts";

const MAX_PER_TICK = 5;

interface ClaimedRecompute {
  id: string;
  org_id: string;
  icp_id: string | null;
  reason: string;
  cursor: string | null;
}

export async function scheduleRecomputes(_ctx: JobContext): Promise<JobOutcome> {
  /* Cross-tenant by nature — "who has asked" — fanning out into per-org jobs
     that each carry the org id from the row they came from. */
  const db = OrgScope.global();

  const { data, error } = await db.rpc("claim_due_recomputes", { p_limit: MAX_PER_TICK });
  if (error) return { ok: false, error: `schedule_recomputes: ${error.message}` };

  const claimed = (Array.isArray(data) ? data : []) as ClaimedRecompute[];
  if (!claimed.length) return { ok: true, result: { claimed: 0 } };

  let enqueued = 0;
  for (const request of claimed) {
    const { created } = await enqueue({
      orgId: String(request.org_id),
      name: "recompute_scores",
      payload: {
        requestId: String(request.id),
        reason: String(request.reason),
        /* Resumed rather than restarted. The claim marks the row `running` and
           hands back where the last pass stopped, so a recomputation
           interrupted by a deploy does not re-score — and re-pay for — every
           company it had already done. */
        ...(request.cursor ? { after: String(request.cursor) } : {}),
        ...(request.icp_id ? { icpId: String(request.icp_id) } : {}),
      },
      /* Keyed on the request, so a claim that races with a still-running pass
         of the same recomputation collapses instead of forking it. */
      idempotencyKey: `recompute:${request.id}`,
    });
    if (created) enqueued++;
  }

  return { ok: true, result: { claimed: claimed.length, enqueued } };
}
