"use server";

import { revalidatePath } from "next/cache";
import {
  currentUserId,
  fail,
  mutate,
  ok,
  type ActionResult,
} from "../../../../lib/data/org";
import { replyBodySchema, threadStatusSchema, uuidSchema } from "../../../../lib/validation";

/**
 * Inbox writes — `threads` from `0004`.
 *
 * ── Why triage is the only thing you can do here ─────────────────────────
 *
 * A thread's status and its assignee are the two things a person changes while
 * reading their inbox. Replying is not on that list, and its absence is
 * deliberate rather than unfinished: sending needs a connected mailbox, and
 * there is no OAuth flow and nowhere to encrypt a token. A reply box that
 * composed a message with nowhere to send it would be the §7 failure aimed at
 * the one screen where the user would most reasonably assume it worked.
 *
 * `messages_sent_has_provider_id` in `0004` says the same thing at the
 * database level: an outbound message cannot claim a send time without the
 * provider id that proves it left. The schema will not let us fake it either.
 */

export async function setThreadStatusAction(
  org: string,
  threadId: string,
  status: string,
): Promise<ActionResult<undefined>> {
  const parsed = threadStatusSchema.safeParse(status);
  if (!parsed.success) return fail("That isn't a state a conversation can be in.");

  return mutate(org, "setThreadStatus", async ({ db, orgId }) => {
    const id = uuidSchema.safeParse(threadId);
    if (!id.success) return fail("That conversation reference isn't valid.");

    const { error } = await db
      .from("threads")
      .update({ status: parsed.data })
      .eq("id", id.data)
      .eq("org_id", orgId)
      .is("deleted_at", null);

    if (error) return fail(`That conversation could not be updated: ${error.message}`);

    revalidatePath(`/${org}/inbox`);
    return ok(undefined, `Moved to ${parsed.data}.`);
  });
}

/**
 * Take a conversation, or hand it back.
 *
 * `threads.assignee_id` references `auth.users`, so the same membership check
 * as `assignOpportunityAction` applies — the foreign key would accept any real
 * user id in the system, including one from another tenant.
 */
export async function assignThreadAction(
  org: string,
  threadId: string,
  assigneeId: string | null,
): Promise<ActionResult<undefined>> {
  return mutate(org, "assignThread", async ({ db, orgId }) => {
    const id = uuidSchema.safeParse(threadId);
    if (!id.success) return fail("That conversation reference isn't valid.");
    if (assigneeId !== null && !uuidSchema.safeParse(assigneeId).success) {
      return fail("That member reference isn't valid.");
    }

    if (assigneeId !== null) {
      const { count } = await db
        .from("memberships")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId)
        .eq("user_id", assigneeId)
        .is("deleted_at", null);

      if ((count ?? 0) === 0) {
        return fail("That person is not a member of this organisation.");
      }
    }

    const { error } = await db
      .from("threads")
      .update({ assignee_id: assigneeId })
      .eq("id", id.data)
      .eq("org_id", orgId)
      .is("deleted_at", null);

    if (error) return fail(`That conversation could not be assigned: ${error.message}`);

    revalidatePath(`/${org}/inbox`);
    return ok(undefined, assigneeId ? "Assigned." : "Unassigned.");
  });
}

/**
 * Send a reply a person wrote.
 *
 * ── Why this writes a row rather than sending ────────────────────────────
 *
 * Nothing in the request path sends, and nothing in the request path enqueues.
 * `enqueue()` writes through the service-role client, and calling it from a
 * Server Action would put the RLS bypass on a public POST endpoint — see
 * `lib/data/engine.ts` for the same decision about scans. So this does what
 * every other request-path write does: it writes a request to a tenant table.
 *
 * The request is a `messages` row with `scheduled_at` set. That column means
 * "approved and due" — `send_message` refuses any message without it — and the
 * `schedule_sends` sweeper turns those into jobs on the next tick. A reply a
 * person typed is approved by definition: they are the human in §46's ladder.
 *
 * ── What it will not do ──────────────────────────────────────────────────
 *
 * Claim the message was sent. `messages_sent_has_provider_id` in `0004` makes
 * that a database constraint rather than a convention: an outbound message
 * cannot carry a send time without the provider id that proves it left. The
 * reply appears in the thread as queued, and becomes sent when it has actually
 * gone. §78 — a delivery failure is recorded as a failure.
 */
export async function replyToThreadAction(
  org: string,
  threadId: string,
  body: string,
): Promise<ActionResult<{ messageId: string }>> {
  const parsed = replyBodySchema.safeParse(body);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "That reply could not be read.");
  }

  return mutate(org, "replyToThread", async ({ db, orgId }) => {
    const id = uuidSchema.safeParse(threadId);
    if (!id.success) return fail("That conversation reference isn't valid.");

    const { data: thread, error: threadError } = await db
      .from("threads")
      .select("id, subject, mailbox_id, status")
      .eq("id", id.data)
      .eq("org_id", orgId)
      .is("deleted_at", null)
      .maybeSingle();

    if (threadError) return fail(`That conversation could not be read: ${threadError.message}`);
    if (!thread) return fail("That conversation no longer exists.");

    /* Who to answer, and what to thread against, both come from the last
       message that arrived rather than from the thread. A thread's subject is
       whatever it started as; the reply has to go to whoever wrote last, and
       carry their `Message-ID` so their client files the answer with the
       question. Without `In-Reply-To` a reply starts a new conversation in the
       recipient's inbox, which is how one thread becomes two. */
    const { data: incoming, error: incomingError } = await db
      .from("messages")
      .select("id, from_email, subject, message_id_header, mailbox_id")
      .eq("org_id", orgId)
      .eq("thread_id", id.data)
      .eq("direction", "inbound")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (incomingError) return fail(`That conversation could not be read: ${incomingError.message}`);
    if (!incoming?.from_email) {
      return fail(
        "There is no incoming message in this conversation to reply to, so there " +
          "is no address to answer. Start the conversation from a campaign instead.",
      );
    }

    /* The mailbox it arrived at, so the reply comes from the address the
       recipient already has a conversation with. Replying from a different one
       looks — correctly — like a different sender. */
    const mailboxId = incoming.mailbox_id ?? thread.mailbox_id;
    if (!mailboxId) {
      return fail(
        "This conversation is not attached to a mailbox, so there is nothing to " +
          "send from. Connect one under Outreach.",
      );
    }

    const { data: mailbox } = await db
      .from("mailboxes")
      .select("id, status")
      .eq("id", mailboxId)
      .eq("org_id", orgId)
      .is("deleted_at", null)
      .maybeSingle();

    if (!mailbox) return fail("The mailbox this conversation used no longer exists.");
    if (mailbox.status !== "connected") {
      return fail(
        `That mailbox is ${mailbox.status}, so nothing can be sent from it. ` +
          "Reconnect it under Outreach.",
      );
    }

    const { data: created, error } = await db
      .from("messages")
      .insert({
        org_id: orgId,
        thread_id: id.data,
        mailbox_id: mailboxId,
        direction: "outbound",
        subject: replySubject(incoming.subject ?? thread.subject),
        body_text: parsed.data,
        /* False, and it matters. §7 and §62: `ai_generated` is what the inbox
           renders a model badge from, and marking a person's own words as
           generated is a lie in the direction that costs the user credibility
           with the person they are writing to. */
        ai_generated: false,
        to_email: incoming.from_email,
        in_reply_to: incoming.message_id_header,
        /* Approved and due, because a person wrote it and pressed send. This is
           the field `schedule_sends` sweeps and `send_message` requires. */
        scheduled_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (error) return fail(`That reply could not be queued: ${error.message}`);

    /* Reopened, because answering a closed conversation is the act of having
       something more to say about it. Left alone when it is open or snoozed, so
       this cannot un-snooze something the user deliberately parked. */
    if (thread.status === "closed") {
      await db
        .from("threads")
        .update({ status: "open" })
        .eq("id", id.data)
        .eq("org_id", orgId);
    }

    revalidatePath(`/${org}/inbox`);
    return ok(
      { messageId: String(created.id) },
      "Reply queued. It is sent on the next run, and shows as sent once it has actually gone.",
    );
  });
}

/**
 * Approve a drafted message, so it can leave.
 *
 * At autonomy 0 and 1 the engine writes a message and stops: `scheduled_at`
 * stays null, which is the state `send_message` refuses. This is the control
 * that fills it in — the human in §46's ladder, doing the one thing the ladder
 * exists to keep them doing.
 *
 * Refusing an already-approved message rather than re-approving it keeps
 * `scheduled_at` meaning "when this was approved". Re-stamping it on a second
 * click would move a message that has been waiting an hour to the back of the
 * sweeper's oldest-first queue, which is the opposite of what pressing the
 * button twice means.
 */
export async function approveMessageAction(
  org: string,
  messageId: string,
): Promise<ActionResult<undefined>> {
  return mutate(org, "approveMessage", async ({ db, orgId }) => {
    const id = uuidSchema.safeParse(messageId);
    if (!id.success) return fail("That message reference isn't valid.");

    const { data: message, error: readError } = await db
      .from("messages")
      .select("id, direction, scheduled_at, sent_at, to_email")
      .eq("id", id.data)
      .eq("org_id", orgId)
      .is("deleted_at", null)
      .maybeSingle();

    if (readError) return fail(`That message could not be read: ${readError.message}`);
    if (!message) return fail("That message no longer exists.");
    if (message.direction !== "outbound") return fail("That message is one you received.");
    if (message.sent_at) return fail("That message has already been sent.");
    if (message.scheduled_at) return fail("That message is already approved and waiting to send.");
    if (!message.to_email) {
      return fail(
        "That message has no recipient address, so approving it would queue a send " +
          "that cannot happen.",
      );
    }

    const { error } = await db
      .from("messages")
      .update({
        scheduled_at: new Date().toISOString(),
        /* Who approved it, on the row. §46's ladder is an accountability
           mechanism as much as a safety one, and "a person approved this" is
           worth little if the record does not say which person. */
        approved_by: await currentUserId(db),
      })
      .eq("id", id.data)
      .eq("org_id", orgId)
      .is("deleted_at", null)
      /* Only while still unapproved. Two people reading the same queue can
         press approve at the same moment, and the second write would move the
         approval time of a message already on its way out. */
      .is("scheduled_at", null);

    if (error) return fail(`That message could not be approved: ${error.message}`);

    revalidatePath(`/${org}/inbox`);
    return ok(undefined, "Approved. It is sent on the next run.");
  });
}

/** `Re: ` once, however many times the conversation has gone back and forth. */
function replySubject(subject: string | null): string {
  const base = (subject ?? "").trim();
  if (!base) return "Re:";
  return /^re:/i.test(base) ? base : `Re: ${base}`;
}
