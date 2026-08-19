/**
 * The queue — `job_executions` from `0004`, made claimable by `0008`.
 *
 * ── Why a table and not a hosted queue ───────────────────────────────────
 *
 * The same argument `0005` makes about the rate limiter, and it holds better
 * here. Every job in this system either reads a web page or calls a model, so
 * the unit of work is seconds to tens of seconds; the queue round trip is
 * noise against that. A Postgres table is transactional with the rows the job
 * is about, is backed up with them, and is visible in the same SQL editor —
 * none of which is true of a queue in another service.
 *
 * `INNGEST_*` being configured changes where the *tick* comes from, not where
 * the work lives. See `src/index.ts`.
 *
 * ── The two properties that make it correct ──────────────────────────────
 *
 * At-least-once, not exactly-once. `claim_job_executions` hands a row to one
 * worker under `for update skip locked`, and `requeue_stalled_jobs` gives it
 * back if that worker dies — so a job can run twice, and every handler is
 * written to tolerate that. Exactly-once across a network is not available,
 * and pretending otherwise is how duplicate emails get sent.
 *
 * Idempotent enqueue. `idempotency_key` is unique among queued and running
 * rows, so "scan source X" enqueued by both the scheduler and a Scan Now
 * button is one job.
 */
import type { AdminClient } from "@huntloop/db/admin";
import { adminClient } from "./scope.ts";

/**
 * Every kind of work this system does.
 *
 * A closed union, so the registry in `registry.ts` is exhaustive by type and a
 * job name with no handler cannot be enqueued.
 */
export type JobName =
  | "schedule_scans"
  | "scan_source"
  | "research_company"
  | "score_opportunity"
  | "enrich_person";

export interface JobRow {
  id: string;
  org_id: string | null;
  job_name: JobName;
  status: string;
  attempts: number;
  max_attempts: number;
  payload: Record<string, unknown>;
  run_at: string;
  error: string | null;
}

export interface EnqueueOptions {
  orgId: string | null;
  name: JobName;
  payload?: Record<string, unknown>;
  /** When to run. Omitted means now. */
  runAt?: Date;
  /** Collapses duplicates while one is queued or running. */
  idempotencyKey?: string;
  maxAttempts?: number;
}

export interface Enqueued {
  id: string | null;
  /** False when an identical job was already queued or running. */
  created: boolean;
}

export async function enqueue(
  options: EnqueueOptions,
  db: AdminClient = adminClient(),
): Promise<Enqueued> {
  const row = {
    org_id: options.orgId,
    job_name: options.name,
    payload: options.payload ?? {},
    run_at: (options.runAt ?? new Date()).toISOString(),
    idempotency_key: options.idempotencyKey ?? null,
    max_attempts: options.maxAttempts ?? 3,
    status: "queued",
  };

  const { data, error } = await db
    .from("job_executions")
    .insert(row)
    .select("id")
    .maybeSingle();

  if (error) {
    /* 23505 is the idempotency index doing its job, which is a success from
       the caller's point of view: the work they asked for is already going to
       happen. Every other code is a real failure and is raised. */
    if (error.code === "23505") return { id: null, created: false };
    throw new Error(`enqueue(${options.name}): ${error.message}`);
  }

  return { id: data ? String(data.id) : null, created: true };
}

/** Claims up to `limit` due jobs for this worker. Atomic — see `0008`. */
export async function claim(
  limit: number,
  worker: string,
  db: AdminClient = adminClient(),
): Promise<JobRow[]> {
  const { data, error } = await db.rpc("claim_job_executions", {
    p_limit: limit,
    p_worker: worker,
  });
  if (error) throw new Error(`claim: ${error.message}`);
  return (data ?? []) as JobRow[];
}

export async function succeed(
  jobId: string,
  result: Record<string, unknown>,
  db: AdminClient = adminClient(),
): Promise<void> {
  const { error } = await db
    .from("job_executions")
    .update({
      status: "succeeded",
      finished_at: new Date().toISOString(),
      locked_at: null,
      locked_by: null,
      error: null,
      result,
    })
    .eq("id", jobId);
  if (error) throw new Error(`succeed(${jobId}): ${error.message}`);
}

/**
 * Records a failure, and decides whether it gets another go.
 *
 * Backoff is exponential from the attempt count the claim already incremented,
 * so a source that is down is retried in a minute, then four, then nine —
 * rather than hammering a host that is already struggling.
 *
 * `permanent` skips the retries entirely. Some failures are answers: a source
 * whose URL does not parse will not parse next time either, and three attempts
 * at it is three times the log noise for the same outcome.
 */
export async function markFailed(
  job: JobRow,
  message: string,
  options: { permanent?: boolean } = {},
  db: AdminClient = adminClient(),
): Promise<void> {
  const exhausted = options.permanent || job.attempts >= job.max_attempts;
  const backoffMinutes = Math.min(job.attempts * job.attempts, 60);

  const { error } = await db
    .from("job_executions")
    .update({
      status: exhausted ? "failed" : "queued",
      error: message.slice(0, 2000),
      finished_at: exhausted ? new Date().toISOString() : null,
      locked_at: null,
      locked_by: null,
      run_at: exhausted
        ? job.run_at
        : new Date(Date.now() + backoffMinutes * 60_000).toISOString(),
    })
    .eq("id", job.id);

  if (error) throw new Error(`markFailed(${job.id}): ${error.message}`);
}

/** Hands abandoned work back to the queue. Called at the start of every tick. */
export async function requeueStalled(db: AdminClient = adminClient()): Promise<number> {
  const { data, error } = await db.rpc("requeue_stalled_jobs", {});
  if (error) throw new Error(`requeueStalled: ${error.message}`);
  return Number(data ?? 0);
}
