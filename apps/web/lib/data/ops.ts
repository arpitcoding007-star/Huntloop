import "server-only";
import type { TenantClient } from "@huntloop/db";

/**
 * The operator's view of the engine — `0019`'s views, read through RLS.
 *
 * ── Why this file exists ─────────────────────────────────────────────────
 *
 * `JOB-01`: a job that exhausted its attempts set `status = 'failed'` and was
 * never seen by anybody again. `markFailed` had no reader. The work simply did
 * not happen, and the only symptom was an absence — a company that never got
 * researched, a message that never went — which is the hardest kind of failure
 * to notice and the easiest to misattribute to the product being bad at its
 * job.
 *
 * `0019` built the views and the retry/cancel functions to fix that and
 * nothing called them, so the dead letter queue existed and remained
 * unreadable. This is the read half.
 *
 * ── Why every one of these is a view and not a query ─────────────────────
 *
 * So the screen and any future alerting agree by construction. A page that
 * computed "is the backlog old" with its own predicate would eventually
 * disagree with the one an operator runs in the SQL editor at 2am, and the
 * disagreement would be discovered during the incident rather than before it.
 *
 * Every view is `security_invoker`, so a member sees their own org and nobody
 * else's — asserted structurally by the migration suite.
 */

export interface JobHealthRow {
  jobName: string;
  status: string;
  jobs: number;
  newest: string | null;
  /** Seconds since the oldest still-queued job was due. Null when none are. */
  oldestDueSeconds: number | null;
  exhausted: number;
}

export interface DeadLetter {
  id: string;
  jobName: string;
  error: string | null;
  attempts: number;
  maxAttempts: number;
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  /** False when a retry would fail identically. See `0019`'s note. */
  retryable: boolean;
}

export interface QueuePressure {
  queued: number;
  running: number;
  oldestDue: string | null;
  /** This org's share of everything queued across the estate, 0–1. */
  shareOfQueue: number | null;
}

export interface OpsSnapshot {
  health: JobHealthRow[];
  dead: DeadLetter[];
  pressure: QueuePressure | null;
}

/**
 * Everything the ops screen renders, in three reads.
 *
 * Failures return empty rather than throwing. An ops screen that 500s when one
 * of its panels cannot be read is an ops screen that is unavailable exactly
 * when it is needed — the same reasoning `recentJobs` uses.
 */
export async function opsSnapshot(
  db: TenantClient,
  orgId: string,
  deadLimit = 50,
): Promise<OpsSnapshot> {
  const [health, dead, pressure] = await Promise.all([
    db
      .from("job_health")
      .select("job_name, status, jobs, newest, oldest_due_seconds, exhausted")
      .eq("org_id", orgId)
      .order("jobs", { ascending: false }),
    db
      .from("job_dead_letters")
      .select("id, job_name, error, attempts, max_attempts, payload, created_at, updated_at, retryable")
      .eq("org_id", orgId)
      .order("updated_at", { ascending: false })
      .limit(deadLimit),
    db
      .from("queue_pressure")
      .select("queued, running, oldest_due, share_of_queue")
      .eq("org_id", orgId)
      .maybeSingle(),
  ]);

  return {
    health: (health.data ?? []).map((row) => ({
      jobName: String(row.job_name),
      status: String(row.status),
      jobs: Number(row.jobs ?? 0),
      newest: row.newest ? String(row.newest) : null,
      oldestDueSeconds:
        row.oldest_due_seconds === null || row.oldest_due_seconds === undefined
          ? null
          : Number(row.oldest_due_seconds),
      exhausted: Number(row.exhausted ?? 0),
    })),
    dead: (dead.data ?? []).map((row) => ({
      id: String(row.id),
      jobName: String(row.job_name),
      error: row.error ? String(row.error) : null,
      attempts: Number(row.attempts ?? 0),
      maxAttempts: Number(row.max_attempts ?? 0),
      payload: (row.payload ?? {}) as Record<string, unknown>,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      retryable: Boolean(row.retryable),
    })),
    pressure: pressure.data
      ? {
          queued: Number(pressure.data.queued ?? 0),
          running: Number(pressure.data.running ?? 0),
          oldestDue: pressure.data.oldest_due ? String(pressure.data.oldest_due) : null,
          shareOfQueue:
            pressure.data.share_of_queue === null || pressure.data.share_of_queue === undefined
              ? null
              : Number(pressure.data.share_of_queue),
        }
      : null,
  };
}
