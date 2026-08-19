/**
 * One tick of the engine.
 *
 * Claim a few jobs, run them, record what happened. That is the whole loop,
 * and everything interesting about it is in what it refuses to do:
 *
 * **It does not run forever.** `tick()` takes a deadline and stops claiming
 * when it is close. The runner is invoked from a serverless function with a
 * hard execution limit, and a worker killed mid-job leaves rows in `running`
 * that only `requeue_stalled_jobs` can recover — ten minutes later. Finishing
 * early and being invoked again is strictly better than being killed.
 *
 * **It does not run jobs in parallel.** Every job here either fetches a page
 * or calls a model; five at once against one Postgres connection pool and one
 * Anthropic rate limit buys latency and spends reliability. Concurrency is
 * across *invocations* — two runners claim disjoint sets, because
 * `claim_job_executions` uses `for update skip locked`.
 *
 * **It does not let one job's failure end the tick.** A handler that throws is
 * recorded against its own row and the loop continues, because the alternative
 * is one poisoned payload stopping every other org's work.
 */
import { OrgScope, adminClient } from "./scope.ts";
import { HANDLERS } from "./registry.ts";
import {
  claim,
  enqueue,
  markFailed,
  requeueStalled,
  succeed,
  type JobName,
  type JobRow,
} from "./queue.ts";

export interface TickOptions {
  /** Upper bound on jobs claimed in this invocation. */
  limit?: number;
  /** Stop claiming once within `reserveMs` of this. Defaults to 60s from now. */
  deadline?: Date;
  /** Milliseconds to keep in hand for the last job to finish and report. */
  reserveMs?: number;
  /** Identifies this worker in `job_executions.locked_by`. */
  worker?: string;
}

export interface TickReport {
  claimed: number;
  succeeded: number;
  failed: number;
  requeued: number;
  /** True when the deadline stopped the tick with work still queued. */
  stoppedEarly: boolean;
  jobs: { id: string; name: string; ok: boolean; detail: string }[];
}

export async function tick(options: TickOptions = {}): Promise<TickReport> {
  const limit = options.limit ?? 5;
  const reserveMs = options.reserveMs ?? 20_000;
  const deadline = options.deadline ?? new Date(Date.now() + 60_000);
  const worker = options.worker ?? `runner-${process.pid}`;

  const report: TickReport = {
    claimed: 0,
    succeeded: 0,
    failed: 0,
    requeued: 0,
    stoppedEarly: false,
    jobs: [],
  };

  /* Before claiming, not after. A tick that claims first would take fresh work
     while abandoned work sat in `running` for another cycle — and the whole
     reason a job is abandoned is that something went wrong with it, which is
     the work most worth getting back to. */
  report.requeued = await requeueStalled();

  const jobs = await claim(limit, worker);
  report.claimed = jobs.length;

  for (const job of jobs) {
    if (Date.now() > deadline.getTime() - reserveMs) {
      /* Out of time with jobs in hand. They are given back rather than run
         half-way: `markFailed` with a retryable message puts them at the front
         of the next tick, which is where they belong. */
      await markFailed(job, "The worker ran out of time before starting this job.");
      report.stoppedEarly = true;
      continue;
    }

    const outcome = await runOne(job);
    if (outcome.ok) {
      report.succeeded++;
      report.jobs.push({ id: job.id, name: job.job_name, ok: true, detail: outcome.detail });
    } else {
      report.failed++;
      report.jobs.push({ id: job.id, name: job.job_name, ok: false, detail: outcome.detail });
    }
  }

  return report;
}

async function runOne(job: JobRow): Promise<{ ok: boolean; detail: string }> {
  const handler = HANDLERS[job.job_name];
  if (!handler) {
    /* Unreachable through `enqueue`, whose `JobName` is a closed union — so
       this is a row written by an older deploy, or by hand. Permanent,
       because no number of retries will invent a handler. */
    await markFailed(job, `No handler for job "${job.job_name}".`, { permanent: true });
    return { ok: false, detail: `no handler for ${job.job_name}` };
  }

  /* The sweepers are the jobs with no org — they ask a cross-tenant question
     and fan the answer out into per-org work. Everything else gets a scope
     bound to its own org id, and a job row that lost its org is a bug rather
     than a global-permission grant. */
  const orgId = job.org_id ?? SWEEPER_ORG;
  if (!job.org_id && !SWEEPERS.has(job.job_name)) {
    await markFailed(job, `${job.job_name} has no org_id.`, { permanent: true });
    return { ok: false, detail: "no org_id" };
  }

  try {
    const outcome = await handler({
      scope: new OrgScope(orgId, adminClient()),
      payload: job.payload ?? {},
      job,
      now: new Date(),
    });

    if (outcome.ok) {
      await succeed(job.id, outcome.result);
      return { ok: true, detail: JSON.stringify(outcome.result) };
    }

    await markFailed(job, outcome.error, { permanent: outcome.permanent });
    return { ok: false, detail: outcome.error };
  } catch (error) {
    /* A throw is a bug rather than a handled failure, so it keeps its retries:
       the commonest cause is a transient network error inside a library that
       does not distinguish them, and giving up on the first would abandon
       recoverable work. */
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    await markFailed(job, message);
    return { ok: false, detail: message };
  }
}

/**
 * The org id a sweeper runs under.
 *
 * `OrgScope` refuses to be constructed without one, which is deliberate — a
 * scope with no org is a scope with no boundary. The sweeper does not use its
 * scope for anything (it reads through `OrgScope.global()` and enqueues per
 * org), so it is given the nil uuid: a value that matches no row, so a sweeper
 * that ever *did* try to read through its scope would read nothing rather than
 * everything.
 */
const SWEEPER_ORG = "00000000-0000-0000-0000-000000000000";

/**
 * The jobs allowed to run without an org.
 *
 * A closed set rather than a flag on the row, because "may read across every
 * tenant" is the most consequential property a job can have and it should be
 * stated in one place that a reviewer can read in full. Everything not listed
 * here fails permanently when its `org_id` is null — a job row that lost its
 * org is a bug, and the safe reading of that bug is "refuse", not "run this
 * against all of them".
 */
const SWEEPERS: ReadonlySet<JobName> = new Set<JobName>([
  "schedule_scans",
  "schedule_syncs",
  "advance_enrollments",
]);

/**
 * Enqueue the sweepers, once per tick.
 *
 * ── Why the driver calls this rather than `tick()` doing it ──────────────
 *
 * Because `tick()` is also how a test, a script, or an operator drains the
 * queue, and a drain that keeps adding work to the queue never finishes. The
 * sweep is the *heartbeat*; the tick is the *work*. Keeping them separate is
 * what lets `tick()` be called safely from anywhere.
 *
 * ── Why every driver must call it ────────────────────────────────────────
 *
 * These three jobs are the only things that put periodic work into the queue.
 * A driver that ticks without sweeping runs an engine that processes whatever
 * it is handed and never notices that a source is overdue, a reply is
 * unread, or a sequence is due to advance — an engine that looks healthy in
 * every log line and does nothing. That is exactly what the Inngest route did
 * before this function existed, which is the argument for it living here
 * rather than being repeated in each route.
 *
 * Each is idempotent on its own name, so a sweep still running from the last
 * tick is not started again, and `maxAttempts: 1` because a sweep that fails
 * is not worth retrying — the next tick is thirty seconds away and will ask
 * the same question against fresher rows.
 */
export async function sweep(): Promise<void> {
  for (const name of SWEEPERS) {
    await enqueue({ orgId: null, name, idempotencyKey: name, maxAttempts: 1 });
  }
}
