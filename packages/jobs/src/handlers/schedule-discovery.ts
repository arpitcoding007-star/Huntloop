/**
 * `schedule_discovery` — turn due searches into jobs.
 *
 * ── Why this exists beside `schedule_scans` rather than inside it ────────
 *
 * They answer the same question about different tables, and the temptation
 * was to merge them. Kept apart for one reason: a scan is free and a search
 * costs credits, so the two have different failure consequences and will
 * acquire different guards. Merging them would mean the free path carries the
 * paid path's caution, or — much worse — the paid path inherits the free
 * path's lack of it.
 *
 * ── The claim, and the advance ──────────────────────────────────────────
 *
 * `claim_due_discovery_queries` does both under `for update skip locked`, and
 * it advances `next_run_at` as part of the claim rather than after the run.
 *
 * That ordering is the whole design. Advancing afterwards means a worker that
 * crashes leaves a query permanently due — every tick claims it, every tick
 * dies, and the query is claimed forever. With a credit card attached, that
 * is not a stuck job; it is a bill. Advancing first means a crashed run is
 * simply skipped until its next window, which is the safe direction to fail.
 */
import { enqueue } from "../queue.ts";
import { OrgScope } from "../scope.ts";
import type { JobContext, JobOutcome } from "../registry.ts";

/**
 * How many searches one tick starts.
 *
 * Low on purpose. Each one is a job that may read five pages and spend real
 * credits, and a scheduler that started forty at once would put a month's
 * budget in the queue in a second — before any of them had reported a cost.
 */
const MAX_PER_TICK = 10;

export async function scheduleDiscovery(_ctx: JobContext): Promise<JobOutcome> {
  const db = OrgScope.global();

  /* eslint-disable-next-line @typescript-eslint/no-explicit-any --
     The same reason `scope.ts` gives: no generated Supabase types. */
  const { data, error } = await (db.rpc as any)("claim_due_discovery_queries", {
    p_limit: MAX_PER_TICK,
  });

  if (error) return { ok: false, error: `schedule_discovery: ${error.message}` };

  const due = (data ?? []) as Array<{ id: string; org_id: string }>;
  let enqueued = 0;

  for (const query of due) {
    const { created } = await enqueue({
      orgId: query.org_id,
      name: "discover_companies",
      payload: { queryId: query.id },
      /* Hourly granularity, matching the shortest interval a query may have.
         Two schedulers in the same hour collapse to one job; the run row's
         own unique index is the second line of defence. */
      idempotencyKey: `discover:${query.id}:${new Date().toISOString().slice(0, 13)}`,
    });
    if (created) enqueued++;
  }

  return { ok: true, result: { due: due.length, enqueued } };
}
