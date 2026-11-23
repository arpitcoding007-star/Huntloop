/**
 * `schedule_matching` — keep Exchange matches current (build plan DN-50,
 * "continuous matching").
 *
 * Hourly. Enqueues `match_needs` for open needs in categories where matching
 * is switched on, when the need has never been matched or was last matched
 * more than a day ago. New offerings are therefore picked up within a day
 * without a trigger on every offering write, and a newly opened category
 * matches its backlog on the next run.
 *
 * Bounded per run, and idempotent per need per day through the queue key.
 */
import { enqueue } from "../queue.ts";
import { OrgScope } from "../scope.ts";
import type { JobContext, JobOutcome } from "../registry.ts";

const DAY_MS = 86_400_000;
export const MAX_NEEDS_PER_RUN = 200;

export async function scheduleMatching(ctx: JobContext): Promise<JobOutcome> {
  const db = OrgScope.global();

  const { data: categories, error: catError } = await db
    .from("exchange_categories")
    .select("id")
    .eq("matching_enabled", true)
    .eq("active", true)
    .limit(1000);
  if (catError) return { ok: false, error: `schedule_matching: ${catError.message}` };
  const enabled = ((categories ?? []) as { id: string }[]).map((c) => c.id);
  if (enabled.length === 0) return { ok: true, result: { skipped: "no category has matching switched on" } };

  const { data: needs, error } = await db
    .from("exchange_needs")
    .select("id, org_id, exchange_matches(computed_at)")
    .eq("status", "open")
    .is("deleted_at", null)
    .in("category_id", enabled)
    .order("last_confirmed_at", { ascending: false })
    .limit(MAX_NEEDS_PER_RUN * 5);
  if (error) return { ok: false, error: `schedule_matching: ${error.message}` };

  const day = ctx.now.toISOString().slice(0, 10);
  let enqueued = 0;
  for (const need of (needs ?? []) as { id: string; org_id: string; exchange_matches: { computed_at: string }[] | null }[]) {
    if (enqueued >= MAX_NEEDS_PER_RUN) break;
    const latest = Math.max(0, ...(need.exchange_matches ?? []).map((m) => new Date(m.computed_at).getTime()));
    if (latest && ctx.now.getTime() - latest < DAY_MS) continue;
    const { created } = await enqueue({
      orgId: need.org_id,
      name: "match_needs",
      payload: { needId: need.id },
      idempotencyKey: `match_needs:${need.id}:${day}`,
    });
    if (created) enqueued++;
  }

  return { ok: true, result: { enabledCategories: enabled.length, enqueued } };
}
