/**
 * `schedule_demand` — the cross-tenant producer of `cluster_demand` (0042).
 * Hourly. A workspace is grouped when a person asked ("Group now" on the
 * Demand screen), or when it has at least `MIN_SIGNALS` new statements and
 * was last grouped more than a day ago. One model call per workspace per day
 * at most, unless someone asks.
 */
import { enqueue } from "../queue.ts";
import { OrgScope } from "../scope.ts";
import type { JobContext, JobOutcome } from "../registry.ts";
import { MIN_SIGNALS } from "./cluster-demand.ts";

const DAY_MS = 24 * 3600_000;
const MAX_PER_RUN = 50;

export async function scheduleDemand(ctx: JobContext): Promise<JobOutcome> {
  const db = OrgScope.global();

  const [{ data: states, error }, { data: pending, error: pendingError }] = await Promise.all([
    db.from("demand_state").select("org_id, requested_at, last_clustered_at").limit(5000),
    db
      .from("demand_signals")
      .select("org_id")
      .is("clustered_at", null)
      .is("theme_id", null)
      .limit(20_000),
  ]);
  if (error) return { ok: false, error: `schedule_demand: ${error.message}` };
  if (pendingError) return { ok: false, error: `schedule_demand: ${pendingError.message}` };

  const waiting = new Map<string, number>();
  for (const row of (pending ?? []) as { org_id: string }[]) {
    waiting.set(row.org_id, (waiting.get(row.org_id) ?? 0) + 1);
  }
  const state = new Map(
    ((states ?? []) as { org_id: string; requested_at: string | null; last_clustered_at: string | null }[]).map((s) => [
      s.org_id,
      s,
    ]),
  );

  const due = new Set<string>();
  for (const [orgId, s] of state) if (s.requested_at) due.add(orgId);
  for (const [orgId, count] of waiting) {
    const last = state.get(orgId)?.last_clustered_at;
    const stale = !last || ctx.now.getTime() - new Date(last).getTime() > DAY_MS;
    if (count >= MIN_SIGNALS && stale) due.add(orgId);
  }

  let enqueued = 0;
  for (const orgId of [...due].slice(0, MAX_PER_RUN)) {
    const { created } = await enqueue({
      orgId,
      name: "cluster_demand",
      idempotencyKey: `cluster_demand:${orgId}`,
    });
    if (created) enqueued++;
  }

  return { ok: true, result: { due: due.size, enqueued } };
}
