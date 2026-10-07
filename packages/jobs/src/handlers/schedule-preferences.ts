/**
 * `schedule_preferences` — the cross-tenant producer of `learn_preferences`
 * (K3, `0044`). Hourly.
 *
 * A person is due when they have at least `MIN_PENDING` signals Huntloop has
 * not considered yet and were last learned from more than `MIN_GAP_HOURS`
 * ago — or when somebody asked (`preference_state.requested_at`). Most runs
 * spend nothing: the style rules are arithmetic, and the model is called only
 * for new typed notes (see `learn_preferences`).
 */
import { enqueue } from "../queue.ts";
import { OrgScope } from "../scope.ts";
import type { JobContext, JobOutcome } from "../registry.ts";

export const MIN_PENDING = 3;
export const MIN_GAP_HOURS = 6;
const MAX_PER_RUN = 100;

export async function schedulePreferences(ctx: JobContext): Promise<JobOutcome> {
  const db = OrgScope.global();

  const [{ data: pending, error }, { data: states, error: stateError }] = await Promise.all([
    db.from("preference_signals").select("org_id, user_id").is("learned_at", null).limit(20_000),
    db.from("preference_state").select("org_id, user_id, last_learned_at, requested_at").limit(20_000),
  ]);
  if (error) return { ok: false, error: `schedule_preferences: ${error.message}` };
  if (stateError) return { ok: false, error: `schedule_preferences: ${stateError.message}` };

  const pair = (org: string, user: string) => `${org}:${user}`;
  const waiting = new Map<string, number>();
  for (const row of (pending ?? []) as { org_id: string; user_id: string }[]) {
    const key = pair(row.org_id, row.user_id);
    waiting.set(key, (waiting.get(key) ?? 0) + 1);
  }
  const state = new Map(
    ((states ?? []) as { org_id: string; user_id: string; last_learned_at: string | null; requested_at: string | null }[]).map(
      (s) => [pair(s.org_id, s.user_id), s],
    ),
  );

  const due = new Set<string>();
  for (const [key, s] of state) if (s.requested_at) due.add(key);
  for (const [key, count] of waiting) {
    const last = state.get(key)?.last_learned_at;
    const stale = !last || ctx.now.getTime() - new Date(last).getTime() > MIN_GAP_HOURS * 3600_000;
    if (count >= MIN_PENDING && stale) due.add(key);
  }

  let enqueued = 0;
  for (const key of [...due].slice(0, MAX_PER_RUN)) {
    const [orgId, userId] = key.split(":") as [string, string];
    const { created } = await enqueue({
      orgId,
      name: "learn_preferences",
      payload: { userId },
      idempotencyKey: `learn_preferences:${orgId}:${userId}`,
    });
    if (created) enqueued++;
  }

  return { ok: true, result: { due: due.size, enqueued } };
}
