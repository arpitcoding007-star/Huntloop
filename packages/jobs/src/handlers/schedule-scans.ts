/**
 * `schedule_scans` — the one job with no org.
 *
 * Everything else in this system is enqueued *about* something: a source, a
 * company, an opportunity. This is the job that asks the cross-tenant
 * question — "what is due, anywhere?" — and turns the answer into per-org work.
 *
 * ── Why a sweeper and not a cron per source ──────────────────────────────
 *
 * Because sources are user data. A customer adding a source at 3pm would
 * otherwise need a schedule created for it, and one deleted when they pause
 * it, and both of those are a second system that can disagree with the first.
 * `sources.next_scan_at` is the schedule; this job reads it. A source is due
 * when its row says so, and nothing else has an opinion.
 *
 * ── The three properties that keep it safe ───────────────────────────────
 *
 * **Bounded.** One tick enqueues at most `MAX_PER_TICK`. A deployment that has
 * been down for a day comes back to a backlog, and enqueuing all of it at once
 * would turn a recovery into an outage — of our own database, and of every
 * source host we would then hit simultaneously.
 *
 * **Idempotent.** The key is the source id, so a source that is still being
 * scanned from the last tick is not enqueued again. Without that, a scan
 * taking longer than the tick interval accumulates one duplicate per tick
 * until the queue is nothing else.
 *
 * **Fair.** Ordered by `next_scan_at`, so the longest-overdue source goes
 * first rather than the alphabetically luckiest. One org with four hundred
 * sources cannot starve an org with three, because the overdue ones interleave
 * by time rather than by tenant.
 */
import { enqueue } from "../queue.ts";
import { OrgScope } from "../scope.ts";
import type { JobContext, JobOutcome } from "../registry.ts";

const MAX_PER_TICK = 50;

export async function scheduleScans(ctx: JobContext): Promise<JobOutcome> {
  /* The one legitimately cross-tenant read in the engine — see `OrgScope.global`.
     It fans out into per-org enqueues immediately below, and every one of
     those carries the org id from the row it came from. */
  const db = OrgScope.global();

  const { data, error } = await db
    .from("sources")
    .select("id, org_id, next_scan_at")
    .eq("is_enabled", true)
    .is("deleted_at", null)
    /* NULL is "never scanned", which is due now. PostgREST has no `nulls
       first` on a filtered comparison, so the two cases are asked as one
       `or` and the ordering below puts NULLs first by default. */
    .or(`next_scan_at.is.null,next_scan_at.lte.${ctx.now.toISOString()}`)
    .order("next_scan_at", { ascending: true, nullsFirst: true })
    .limit(MAX_PER_TICK);

  if (error) return { ok: false, error: `schedule_scans: ${error.message}` };

  const due = data ?? [];
  let enqueued = 0;
  let alreadyQueued = 0;

  for (const source of due) {
    const result = await enqueue({
      orgId: String(source.org_id),
      name: "scan_source",
      payload: { sourceId: String(source.id) },
      idempotencyKey: `scan:${source.id}`,
    });
    if (result.created) enqueued++;
    else alreadyQueued++;
  }

  return {
    ok: true,
    result: {
      due: due.length,
      enqueued,
      already_queued: alreadyQueued,
      /* Reported so the operator can tell a healthy sweep from a saturated
         one. `due === MAX_PER_TICK` means there was more work than the cap,
         which is fine once and a capacity problem if it persists. */
      saturated: due.length === MAX_PER_TICK,
    },
  };
}
