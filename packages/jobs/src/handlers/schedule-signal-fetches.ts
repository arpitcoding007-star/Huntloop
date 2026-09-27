/**
 * `schedule_signal_fetches` — turn stale companies into `fetch_company_signals` jobs.
 *
 * ── Why a plain query instead of a claim-and-advance RPC ──────────────────
 *
 * `schedule_discovery` claims through `claim_due_discovery_queries` because a
 * discovery query has its own cadence per org and a crash mid-claim must not
 * leave it claimed forever with a credit card attached (see that file). A
 * signal fetch is simpler: "stale" is one global rule — more than 48 hours
 * since the last check, or never checked — not a per-org schedule a customer
 * configured. `last_signal_checked_at` is written by the handler itself only
 * after a real attempt, so a crashed job simply leaves the timestamp stale
 * and the company is picked up again next tick. That is the same
 * fail-safe-not-stuck property `schedule_discovery` gets from a dedicated RPC,
 * reached here without one.
 *
 * ── What it deliberately does not filter on ───────────────────────────────
 *
 * Every company with an Apollo id, not only ones attached to a live
 * opportunity. Cheaper to write, and the credit cost is bounded by
 * `MAX_PER_TICK` regardless. Narrowing to "has a live opportunity" is a real
 * optimisation worth making once volume makes it matter — see the roadmap —
 * and is not done here because it needs an embedded-relation filter this
 * package has no precedent for and no way to test without a live project.
 */
import { enqueue } from "../queue.ts";
import { OrgScope } from "../scope.ts";
import type { JobContext, JobOutcome } from "../registry.ts";

/** Matches `packages/providers/src/cache.ts`'s TTL for `company.signals`. */
const STALE_AFTER_HOURS = 48;

/**
 * How many fetches one tick starts.
 *
 * Same reasoning as `schedule_discovery`'s `MAX_PER_TICK`: each one is a real
 * provider call, and a scheduler that started hundreds at once would spend a
 * month's signal budget in one tick before any of them had reported a cost.
 */
const MAX_PER_TICK = 25;

export async function scheduleSignalFetches(_ctx: JobContext): Promise<JobOutcome> {
  const db = OrgScope.global();
  const staleBefore = new Date(Date.now() - STALE_AFTER_HOURS * 60 * 60 * 1000).toISOString();

  /* eslint-disable-next-line @typescript-eslint/no-explicit-any --
     The same reason every other handler gives: no generated Supabase types. */
  const { data, error } = await (db.from("companies") as any)
    .select("id, org_id, external_ids!inner(provider)")
    .is("deleted_at", null)
    .eq("external_ids.provider", "apollo")
    .or(`last_signal_checked_at.is.null,last_signal_checked_at.lt.${staleBefore}`)
    .order("last_signal_checked_at", { ascending: true, nullsFirst: true })
    .limit(MAX_PER_TICK);

  if (error) return { ok: false, error: `schedule_signal_fetches: ${error.message}` };

  const due = (data ?? []) as Array<{ id: string; org_id: string }>;
  let enqueued = 0;

  for (const company of due) {
    const { created } = await enqueue({
      orgId: company.org_id,
      name: "fetch_company_signals",
      payload: { companyId: company.id },
      /* Daily granularity is enough to collapse a scheduler tick that runs
         more than once in the same window with a manual "check now" — the
         48-hour staleness rule is what actually paces the real cadence. */
      idempotencyKey: `signals:${company.id}:${new Date().toISOString().slice(0, 10)}`,
    });
    if (created) enqueued++;
  }

  return { ok: true, result: { due: due.length, enqueued } };
}
