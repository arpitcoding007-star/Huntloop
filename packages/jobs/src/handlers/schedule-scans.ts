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
 *
 * ── And one property that is about the customer rather than the system ────
 *
 * **Bounded by the customer's own backlog.** An org with three hundred
 * unlooked-at opportunities does not need a fourth hundred. `usage_counters`
 * caps what an org may *spend* in a month and cannot express this: spend is a
 * flow and inventory is a level, so a customer can be well inside budget and
 * still be accumulating work nobody will ever read.
 *
 * The reference system Huntloop is a second draft of had exactly this control
 * — `UNWORKED_LEAD_CAP = 40`, checked before any spend — and its own comment
 * records that the constant was a first-tenant simplification. `0010` makes it
 * per-org and configurable, which is the one place that system's author said
 * they would have done it differently.
 *
 * The check is one query per tick rather than one per source: `saturated_org_ids()`
 * answers for every tenant at once, because at most fifty sources are being
 * considered and they resolve to a handful of distinct orgs.
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

  /* Read once, for every tenant. A failure here does not stop the sweep: a
     backlog cap is backpressure, and trading "the engine stopped" for "a
     counter query failed" is the wrong direction — the same call
     `withinBudget` and `lib/data/usage.ts` both make, for the same reason. */
  const saturated = new Set<string>();
  const { data: full, error: fullError } = await db.rpc("saturated_org_ids", {});
  if (fullError) {
    console.error(
      `schedule_scans: the backlog cap could not be read (${fullError.message}); ` +
        `scheduling without it.`,
    );
  } else {
    for (const row of (full ?? []) as unknown[]) {
      /* PostgREST returns a `setof uuid` as bare scalars, and a `returns table`
         as objects. Handling both means a future change from one to the other
         does not silently produce an empty set — which would disable the cap
         while every log line still said it was running. */
      const id =
        row && typeof row === "object"
          ? String((row as Record<string, unknown>).saturated_org_ids ?? "")
          : String(row);
      if (id) saturated.add(id);
    }
  }

  let enqueued = 0;
  let alreadyQueued = 0;
  let skippedForBacklog = 0;

  for (const source of due) {
    if (saturated.has(String(source.org_id))) {
      /* Deliberately does NOT advance `next_scan_at`. The source is still due,
         and it becomes eligible again the moment the backlog is worked down —
         rather than being pushed an interval into the future for the crime of
         being behind, which would make a saturated org's sources drift out of
         schedule permanently. */
      skippedForBacklog++;
      continue;
    }

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
      /* Reported rather than silent. An operator looking at `job_executions`
         to work out why a customer stopped receiving opportunities needs this
         number to be the first thing they see — the reference system's
         equivalent returned `skipped_cap: 1` into a response nobody stored,
         and the answer was only discoverable by reading the source. */
      skipped_backlog_full: skippedForBacklog,
      backlog_saturated_orgs: saturated.size,
      /* Reported so the operator can tell a healthy sweep from a saturated
         one. `due === MAX_PER_TICK` means there was more work than the cap,
         which is fine once and a capacity problem if it persists. */
      saturated: due.length === MAX_PER_TICK,
    },
  };
}
