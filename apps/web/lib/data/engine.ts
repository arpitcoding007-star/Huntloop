import "server-only";
import type { TenantClient } from "@huntloop/db";

/**
 * What the request path is allowed to know about the engine.
 *
 * ── Why the app does not import @huntloop/jobs to enqueue ────────────────
 *
 * It could — the package is a dependency, and `/api/jobs/tick` imports it. But
 * `enqueue()` writes through the service-role client, and doing that from a
 * Server Action would put the RLS bypass on a public POST endpoint. The whole
 * argument in `packages/db/src/admin.ts` is that the bypass belongs to code
 * with no user session; a Server Action has one.
 *
 * So the request path asks for work the way the *scheduler* understands it:
 * `sources.next_scan_at`. That column is written through RLS like any other
 * tenant row, the sweeper reads it on the next tick, and there is exactly one
 * writer to `job_executions`. Two writers with different ideas of "due" is how
 * a source ends up scanned twice in one tick.
 */

/**
 * Whether anything is actually running the queue.
 *
 * `/api/jobs/tick` refuses every request when `CRON_SECRET` is unset — see the
 * route, and the reason it fails closed. So without it, work can be queued and
 * will never be picked up.
 *
 * Read here so the screens can say which state they are in. A "Scan now"
 * button that queues into a queue nobody drains is worse than a disabled one:
 * it reports success, and the user waits.
 */
export function isEngineRunning(): boolean {
  return Boolean(process.env.CRON_SECRET?.trim());
}

/** True when Inngest is driving the tick instead of Vercel Cron. */
export function isInngestDriving(): boolean {
  return Boolean(
    process.env.INNGEST_EVENT_KEY?.trim() && process.env.INNGEST_SIGNING_KEY?.trim(),
  );
}

/**
 * Bring a source's next scan forward to now.
 *
 * Returns false when it was already due, which is not a failure — it is the
 * answer to "is it queued?", and saying "queued" twice for one scan would
 * imply two scans.
 */
export async function enqueueScan(
  db: TenantClient,
  orgId: string,
  sourceId: string,
): Promise<boolean> {
  const { data } = await db
    .from("sources")
    .select("next_scan_at")
    .eq("id", sourceId)
    .eq("org_id", orgId)
    .maybeSingle();

  const alreadyDue =
    !data?.next_scan_at || new Date(String(data.next_scan_at)).getTime() <= Date.now();

  if (!alreadyDue) {
    await db
      .from("sources")
      .update({ next_scan_at: new Date().toISOString() })
      .eq("id", sourceId)
      .eq("org_id", orgId);
  }

  return !alreadyDue;
}

/**
 * Ask for a company to be researched and re-scored on the next tick.
 *
 * Same shape as `enqueueScan` and the same reason: this writes a *request* to a
 * tenant table, and the sweeper turns requests into jobs. `last_researched_at`
 * is the field the research handler gates on, so clearing it is exactly the
 * instruction "this is stale" in the vocabulary the handler already reads.
 */
export async function requestResearch(
  db: TenantClient,
  orgId: string,
  companyId: string,
): Promise<void> {
  await db
    .from("companies")
    .update({ last_researched_at: null })
    .eq("id", companyId)
    .eq("org_id", orgId);
}

/**
 * What the engine has been doing, for the screens that report on it.
 *
 * Reads `job_executions` through RLS — the rows are tenant data and carry an
 * `org_id`, so a member sees their own org's jobs and nobody else's.
 */
export interface JobSummary {
  name: string;
  status: string;
  attempts: number;
  error: string | null;
  result: Record<string, unknown> | null;
  createdAt: string;
  finishedAt: string | null;
}

export async function recentJobs(
  db: TenantClient,
  orgId: string,
  limit = 20,
): Promise<JobSummary[]> {
  const { data, error } = await db
    .from("job_executions")
    .select("job_name, status, attempts, error, result, created_at, finished_at")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return [];

  return (data ?? []).map((row) => ({
    name: String(row.job_name),
    status: String(row.status),
    attempts: Number(row.attempts ?? 0),
    error: row.error ?? null,
    result: (row.result ?? null) as Record<string, unknown> | null,
    createdAt: String(row.created_at),
    finishedAt: row.finished_at ?? null,
  }));
}

/**
 * When the engine last actually did something for this org.
 *
 * ── Why this exists alongside `isEngineRunning()` ────────────────────────
 *
 * They answer different questions, and conflating them is how a screen ends up
 * lying. `isEngineRunning()` reads `CRON_SECRET` and answers "would
 * `/api/jobs/tick` accept a caller?". It has never answered "is anyone
 * calling it", and that gap used to be hidden by a cron committed in
 * `vercel.json` — set the secret, and Vercel was already scheduling the
 * request.
 *
 * That cron is gone (see OPS-04: Hobby allows one run a day, and a daily tick
 * is a queue that never drains). So "the secret is set" now routinely means
 * "the endpoint is reachable and nothing is reaching it", and a screen that
 * treats the two as the same would report a working engine to somebody whose
 * sources are never scanned. §7 aimed at ourselves.
 *
 * This is the observed fact rather than a configuration guess: a row in
 * `job_executions` exists because a tick created it. Null means nothing has
 * ever run for this org.
 *
 * Org-scoped, which is deliberate. The sweepers carry no `org_id` — they are
 * the cross-tenant question — so what this sees is the per-org work a sweep
 * produced, which is exactly what "is anything scanning *my* sources" means.
 */
export async function lastTickAt(db: TenantClient, orgId: string): Promise<string | null> {
  const { data, error } = await db
    .from("job_executions")
    .select("created_at")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return String(data.created_at);
}
