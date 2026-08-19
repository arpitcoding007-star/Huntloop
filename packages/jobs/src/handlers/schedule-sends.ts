/**
 * `schedule_sends` — the third sweeper: which approved messages have not gone?
 *
 * ── Why an approved message needs a sweeper at all ───────────────────────
 *
 * Because the request path is not allowed to enqueue. `enqueue()` writes
 * through the service-role client, and calling it from a Server Action would
 * put the RLS bypass on a public POST endpoint — the argument in
 * `packages/db/src/admin.ts`, and the reason `apps/web/lib/data/engine.ts`
 * exists. So a person approving a draft, or writing a reply, does what every
 * other request-path write does: it writes a *request* to a tenant table, and a
 * sweeper turns requests into jobs.
 *
 * The request, here, is `messages.scheduled_at`. That column already means
 * "approved and due" — `send_message` refuses any message without it, on the
 * grounds that §46's ladder puts a human between the draft and the send at
 * autonomy 0 and 1. This sweeper is the other half of that sentence: a message
 * that has been approved is one somebody expects to leave.
 *
 * Without it the approval queue is a queue with no exit. A person reads a
 * draft, approves it, and nothing ever sends — which is the §7 failure in its
 * worst form, because the interface reported success.
 *
 * ── Why `advance_enrollments` still enqueues directly ────────────────────
 *
 * It is a job, so the bypass is where it belongs, and enqueuing inline sends an
 * autonomous campaign's message on the same tick that drafted it rather than
 * the next one. Both paths use `send:<message id>` as the idempotency key, so
 * the two collapse into one job rather than racing — which is the property
 * that makes having both safe rather than merely convenient.
 *
 * ── What is deliberately not swept ───────────────────────────────────────
 *
 * A message with `error` set. The send handler writes that field when a send
 * fails for a reason retrying will not fix — a suppressed recipient, a missing
 * address — and re-enqueuing those every tick would be an unbounded loop
 * against rows whose problem is not time.
 */
import { enqueue } from "../queue.ts";
import { OrgScope } from "../scope.ts";
import type { JobContext, JobOutcome } from "../registry.ts";

const MAX_PER_TICK = 50;

export async function scheduleSends(ctx: JobContext): Promise<JobOutcome> {
  /* Cross-tenant read, fanned out into per-org enqueues immediately — the same
     one legitimate use of `OrgScope.global()` as the other two sweepers. */
  const db = OrgScope.global();

  const { data, error } = await db
    .from("messages")
    .select("id, org_id, scheduled_at")
    .eq("direction", "outbound")
    .is("sent_at", null)
    .is("error", null)
    .is("deleted_at", null)
    .not("scheduled_at", "is", null)
    .lte("scheduled_at", ctx.now.toISOString())
    /* Oldest approval first. A person who approved a draft an hour ago is
       waiting on it more than one who approved a draft a minute ago, and a
       backlog served newest-first is a backlog where the oldest item never
       goes. */
    .order("scheduled_at", { ascending: true })
    .limit(MAX_PER_TICK);

  if (error) return { ok: false, error: `schedule_sends: ${error.message}` };

  const due = data ?? [];
  let enqueued = 0;
  let alreadyQueued = 0;

  for (const message of due) {
    const result = await enqueue({
      orgId: String(message.org_id),
      name: "send_message",
      payload: { messageId: String(message.id) },
      /* The same key `advance_enrollments` uses, so a message drafted and
         queued inline is not queued a second time here. */
      idempotencyKey: `send:${message.id}`,
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
