/**
 * `schedule_learning` — the weekly question, asked once per org.
 *
 * ── Why this is the last thing built and the first thing to be careful with ─
 *
 * The reference system Huntloop is a second draft of wrote exactly this sweeper
 * and then deliberately never scheduled it. The comment in its own source says
 * why: auto-running paid model calls across every tenant needs a usage cap
 * first, "the same lesson learned running the single-tenant predecessor". It
 * shipped a capability it could not safely turn on, and the capability sat
 * there being reachable only by whoever held the cron secret.
 *
 * Huntloop solved that problem before this file existed — `usage_counters`,
 * `check_quota_internal` before every task, `rate_limits`, and `ai_runs`
 * written before the call. So this sweeper is safe to schedule in a way that
 * one never was. The three properties `schedule_scans` documents hold here too,
 * and there is a fourth that matters more at this cadence:
 *
 * **It does not ask again until the answer would be different.** An org is due
 * when its last run is older than `MIN_INTERVAL_DAYS`, and the query is over
 * `learning_runs` itself rather than over a schedule column somebody has to
 * remember to update. There is no second system to disagree with the first.
 *
 * ── Why it skips orgs with nothing to say ────────────────────────────────
 *
 * A cheap `outcomes` count before enqueuing anything. The handler refuses below
 * `MIN_LEARNING_SIGNALS` anyway and refuses before spending — but enqueuing a
 * job per idle org every week fills `job_executions` with rows whose only
 * content is "nothing happened", and a queue that is mostly noise is a queue
 * nobody reads when it matters.
 *
 * The reference system's version had the mirror-image bug and it is worth
 * naming: its weekly cron selected orgs with any feedback in the last 7 days,
 * and the analysis it called then refused unless the org had 3 rows *in total*
 * — so it reliably enqueued work it had already decided to refuse.
 */
import { enqueue } from "../queue.ts";
import { OrgScope } from "../scope.ts";
import type { JobContext, JobOutcome } from "../registry.ts";

/**
 * How many orgs one tick may start an analysis for.
 *
 * Lower than `schedule_scans`' fifty on purpose. This is the most expensive
 * single call the product makes — Opus at high effort over a few hundred
 * records — and a weekly cadence means there is no urgency at all: an org
 * missed on this tick is picked up on the next one, minutes later, and nobody
 * notices. Fifty simultaneous analyses would be the largest instantaneous
 * spend the system is capable of, for no benefit.
 */
const MAX_PER_TICK = 5;

/**
 * The floor between two analyses of the same org.
 *
 * Six days rather than seven, so a weekly rhythm does not drift later by a tick
 * each week and eventually skip a week entirely — the classic failure of "run
 * if last run was more than 7 days ago" on a job that fires at a fixed time.
 */
const MIN_INTERVAL_DAYS = 6;

/** Outcomes in the window, below which there is nothing to enqueue about. */
const MIN_OUTCOMES_TO_BOTHER = 5;
const WINDOW_DAYS = 90;

export async function scheduleLearning(ctx: JobContext): Promise<JobOutcome> {
  /* Cross-tenant by nature — "which orgs are due" — and it fans out into
     per-org enqueues immediately, each carrying the org id from the row it
     came from. The same legitimate use `schedule_scans` documents. */
  const db = OrgScope.global();

  /* Requests first, and unconditionally.

     A person pressing "Run analysis" writes a `learning_runs` row in state
     `requested`, because the request path may not write to `job_executions` —
     `enqueue()` goes through the service-role client and a Server Action has a
     user session. This is the other half of that seam.

     Requests bypass the six-day interval entirely. Somebody asked; telling
     them to come back on Thursday because a scheduled run happened on Monday
     would be the product refusing to answer a question it can answer. */
  const requested = await enqueueRequested(db);

  const windowStart = new Date(ctx.now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const staleBefore = new Date(ctx.now.getTime() - MIN_INTERVAL_DAYS * 24 * 60 * 60 * 1000);

  /* Orgs that have had an outcome recently. This is the population; being due
     is decided per org below. Reading outcomes rather than organizations means
     an org that has never done anything is never considered at all, which is
     the common case on any deployment with more than a handful of tenants. */
  const { data: recent, error } = await db
    .from("outcomes")
    .select("org_id, occurred_at")
    .gte("occurred_at", windowStart.toISOString())
    .order("occurred_at", { ascending: false })
    .limit(2000);

  if (error) return { ok: false, error: `schedule_learning: ${error.message}` };

  const counts = new Map<string, number>();
  for (const row of (recent ?? []) as { org_id: string }[]) {
    const orgId = String(row.org_id);
    counts.set(orgId, (counts.get(orgId) ?? 0) + 1);
  }

  const candidates = [...counts.entries()]
    .filter(([, count]) => count >= MIN_OUTCOMES_TO_BOTHER)
    .map(([orgId]) => orgId);

  if (!candidates.length) {
    return { ok: true, result: { requested, candidates: 0, enqueued: 0 } };
  }

  /* When each candidate last ran. One query for all of them; `learning_runs`
     is the schedule of record, so there is no `next_analysis_at` column to
     drift out of agreement with it. */
  const { data: runs } = await db
    .from("learning_runs")
    .select("org_id, created_at")
    .in("org_id", candidates)
    .order("created_at", { ascending: false })
    .limit(1000);

  const lastRun = new Map<string, string>();
  for (const row of (runs ?? []) as { org_id: string; created_at: string }[]) {
    const orgId = String(row.org_id);
    if (!lastRun.has(orgId)) lastRun.set(orgId, row.created_at);
  }

  const due = candidates
    .filter((orgId) => {
      const last = lastRun.get(orgId);
      return !last || new Date(last) < staleBefore;
    })
    /* Longest-since-analysed first, so an org is never starved by tenants that
       happen to sort earlier — the same fairness property `schedule_scans`
       gets from ordering on `next_scan_at`. An org with no run at all sorts
       first, which is right: it has never been told anything. */
    .sort((a, b) => (lastRun.get(a) ?? "") .localeCompare(lastRun.get(b) ?? ""))
    .slice(0, MAX_PER_TICK);

  let enqueued = 0;
  let alreadyQueued = 0;

  for (const orgId of due) {
    const result = await enqueue({
      orgId,
      name: "analyze_performance",
      payload: { scheduled: true, windowDays: WINDOW_DAYS },
      /* Keyed by org and week, so a tick that overlaps a still-running
         analysis does not start a second one — and so a manual run and the
         sweep in the same week do not both fire. The date part means the key
         rolls over rather than blocking forever if a job row is left behind. */
      idempotencyKey: `learn:${orgId}:${isoWeek(ctx.now)}`,
      /* One attempt. A synthesis that failed will be tried again in six days
         with more data, and retrying an Opus-at-high-effort call three times
         on a schedule nobody is watching is the shape of an unexplained bill. */
      maxAttempts: 1,
    });
    if (result.created) enqueued++;
    else alreadyQueued++;
  }

  return {
    ok: true,
    result: {
      requested,
      candidates: candidates.length,
      due: due.length,
      enqueued,
      already_queued: alreadyQueued,
      saturated: due.length === MAX_PER_TICK,
    },
  };
}

/**
 * Turn `learning_runs` rows in state `requested` into jobs.
 *
 * The run row already exists and carries its own window, so the job is handed
 * the id rather than creating a second row — which is what makes the button
 * that produced it able to show "running" immediately instead of showing
 * nothing until a worker gets round to it.
 *
 * Unbounded by `MAX_PER_TICK` on purpose. That cap exists to stop a scheduled
 * sweep starting five simultaneous Opus calls nobody asked for; every row here
 * is one somebody did ask for, and there is a much tighter natural bound —
 * `learning_runs_one_open_per_org` means an org can have at most one
 * outstanding request at a time.
 */
async function enqueueRequested(db: ReturnType<typeof OrgScope.global>): Promise<number> {
  const { data, error } = await db
    .from("learning_runs")
    .select("id, org_id, window_start, window_end")
    .eq("status", "requested")
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .limit(50);

  if (error || !data?.length) return 0;

  let enqueued = 0;
  for (const row of data as { id: string; org_id: string; window_start: string; window_end: string }[]) {
    const days = Math.max(
      7,
      Math.round(
        (new Date(row.window_end).getTime() - new Date(row.window_start).getTime()) /
          (24 * 60 * 60 * 1000),
      ),
    );

    const result = await enqueue({
      orgId: String(row.org_id),
      name: "analyze_performance",
      payload: { runId: String(row.id), windowDays: days },
      /* Keyed on the run row, so a tick that overlaps the previous one does
         not start the same analysis twice. */
      idempotencyKey: `learn-run:${row.id}`,
      maxAttempts: 1,
    });
    if (result.created) enqueued++;
  }

  return enqueued;
}

/**
 * ISO-ish week stamp, for the idempotency key.
 *
 * Not a calendar-correct ISO week number — it does not need to be. It needs to
 * change once a week and to be the same for every tick inside that week, and
 * "days since epoch, divided by seven" does both without a date library or an
 * off-by-one around new year.
 */
function isoWeek(now: Date): string {
  const days = Math.floor(now.getTime() / (24 * 60 * 60 * 1000));
  return `w${Math.floor(days / 7)}`;
}
