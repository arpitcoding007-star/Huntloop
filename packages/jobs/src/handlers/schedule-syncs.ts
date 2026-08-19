/**
 * `schedule_syncs` — the second sweeper: whose inbox is due to be read?
 *
 * ── Why this is separate from `schedule_scans` ───────────────────────────
 *
 * They are the same shape and different work. Scanning a source is a fetch
 * against somebody else's website on a cadence the *user* chose; syncing a
 * mailbox is a call against a provider API on a cadence *deliverability*
 * chose, and the two caps have no reason to move together. Folding them into
 * one sweeper would mean a backlog of sources delaying every reply in the
 * product, and a reply that arrives late is the one kind of lateness this
 * system cannot afford — §78.
 *
 * ── The cadence, and why it is a constant here ───────────────────────────
 *
 * `SYNC_INTERVAL_MINUTES`, uniformly. A per-mailbox interval is a setting
 * nobody would ever have a reason to change: a user does not want their
 * replies read *less* often, and reading them more often than the provider's
 * quota allows is how a mailbox gets throttled for everyone in the org. When
 * that stops being true the column to add is `mailboxes.sync_interval_minutes`
 * and this becomes the default — the query below already reads a timestamp
 * per row rather than assuming a global schedule.
 *
 * ── The three properties, unchanged from `schedule_scans` ────────────────
 *
 * Bounded by `MAX_PER_TICK`, idempotent on the mailbox id so a slow sync is
 * not enqueued twice, and ordered oldest-first so the most neglected inbox
 * goes first rather than the luckiest.
 */
import { enqueue } from "../queue.ts";
import { OrgScope } from "../scope.ts";
import type { JobContext, JobOutcome } from "../registry.ts";

const MAX_PER_TICK = 50;

/** How stale a mailbox's last read may be before it is due again. */
const SYNC_INTERVAL_MINUTES = 15;

export async function scheduleSyncs(ctx: JobContext): Promise<JobOutcome> {
  /* Cross-tenant read, fanned out into per-org enqueues immediately — the
     same one legitimate use of `OrgScope.global()` as the scan sweeper. */
  const db = OrgScope.global();

  const dueBefore = new Date(
    ctx.now.getTime() - SYNC_INTERVAL_MINUTES * 60_000,
  ).toISOString();

  const { data, error } = await db
    .from("mailboxes")
    .select("id, org_id, last_sync_at")
    /* `connected` only. A disconnected mailbox is one whose refresh token
       stopped working, and enqueuing a sync for it produces one failed job
       every fifteen minutes forever — noise that buries the real failures,
       for a mailbox whose fix is a person clicking "reconnect". */
    .eq("status", "connected")
    .is("deleted_at", null)
    /* NULL is "never synced", which is due now — same reading as
       `next_scan_at`, asked the same way for the same PostgREST reason. */
    .or(`last_sync_at.is.null,last_sync_at.lte.${dueBefore}`)
    .order("last_sync_at", { ascending: true, nullsFirst: true })
    .limit(MAX_PER_TICK);

  if (error) return { ok: false, error: `schedule_syncs: ${error.message}` };

  const due = data ?? [];
  let enqueued = 0;
  let alreadyQueued = 0;

  for (const mailbox of due) {
    const result = await enqueue({
      orgId: String(mailbox.org_id),
      name: "sync_mailbox",
      payload: { mailboxId: String(mailbox.id) },
      idempotencyKey: `sync:${mailbox.id}`,
    });
    if (result.created) enqueued++;
    else alreadyQueued++;
  }

  return {
    ok: true,
    result: {
      due: due.length,
      enqueued,
      already_queued: alreadyQueued,
      saturated: due.length === MAX_PER_TICK,
    },
  };
}
