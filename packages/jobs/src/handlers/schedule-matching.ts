/**
 * `schedule_matching` — keep Exchange matches current (build plan DN-50,
 * "continuous matching").
 *
 * Hourly. Enqueues `match_needs` for open needs in categories where matching
 * is switched on, when the need has never been matched, was last matched more
 * than a day ago, or an offering in its category was listed or changed since
 * (DN-59: a new supplier is matched on the next run, not the next day). A newly
 * opened category matches its backlog on the next run.
 *
 * Which requests are due is decided in SQL (`exchange_needs_due`, 0068): never
 * matched first, then the stalest, so a backlog longer than one run is worked
 * through instead of the same newest requests every hour.
 */
import { enqueue } from "../queue.ts";
import { OrgScope } from "../scope.ts";
import type { JobContext, JobOutcome } from "../registry.ts";

export const MAX_NEEDS_PER_RUN = 200;

export async function scheduleMatching(_ctx: JobContext): Promise<JobOutcome> {
  const db = OrgScope.global();

  const { data: due, error } = await db.rpc("exchange_needs_due", { p_limit: MAX_NEEDS_PER_RUN });
  if (error) return { ok: false, error: `schedule_matching: ${error.message}` };

  let enqueued = 0;
  for (const need of (due ?? []) as { need_id: string; org_id: string; key: string }[]) {
    const { created } = await enqueue({
      orgId: need.org_id,
      name: "match_needs",
      payload: { needId: need.need_id },
      idempotencyKey: need.key,
    });
    if (created) enqueued++;
  }

  return { ok: true, result: { enqueued } };
}
