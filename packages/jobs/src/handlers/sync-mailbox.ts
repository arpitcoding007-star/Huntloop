/**
 * `sync_mailbox` — read what has arrived, and work out what it is a reply to.
 *
 * ── Matching, in the order the signals are trustworthy ───────────────────
 *
 *   1. Provider thread id. Both Gmail and Graph thread on their own side, and
 *      when they say two messages are one conversation they are right.
 *   2. `In-Reply-To` against a `Message-ID` we recorded when sending. Works
 *      across providers and survives a reply arriving at a different mailbox.
 *   3. The sender's address against a thread's participants. The weakest, and
 *      it is here because the first two both fail on a reply sent from a
 *      phone that started a new message rather than replying — which is
 *      common, and which is still a person answering.
 *
 * A message that matches none of these is stored as an inbound message with no
 * thread. It is not discarded: an unmatched reply is still a human being
 * answering, and the inbox shows it. Silently dropping it would make the
 * product look like it loses mail, which is the one thing an inbox cannot do.
 *
 * ── What a reply does ────────────────────────────────────────────────────
 *
 * Stops the sequence, moves the opportunity to `replied`, records an outcome
 * for the learning loop, and — where the classification says so — suppresses
 * the address or marks it undeliverable. §78: a reply is the signal the whole
 * campaign exists to produce, and a sequence that keeps sending after one is
 * the single most damaging bug this system can have.
 */
import { classifyReply, type ReplyClassification } from "@huntloop/ai";
import { AiUnavailable, runForOrg } from "../ai.ts";
import { MailboxUnavailable, authorize, type IncomingMessage } from "../mailbox/index.ts";
import type { JobContext, JobOutcome } from "../registry.ts";

export interface SyncPayload {
  mailboxId: string;
}

export async function syncMailbox(ctx: JobContext): Promise<JobOutcome> {
  const { scope, payload } = ctx;
  const mailboxId = String(payload.mailboxId ?? "");
  if (!mailboxId) {
    return { ok: false, permanent: true, error: "sync_mailbox: no mailboxId in payload." };
  }

  let mailbox;
  try {
    mailbox = await authorize(scope, mailboxId);
  } catch (e) {
    if (e instanceof MailboxUnavailable) return { ok: true, result: { skipped: e.message } };
    throw e;
  }

  let sync;
  try {
    sync = await mailbox.provider.sync(mailbox.accessToken, mailbox.syncCursor);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    await scope.update("mailboxes", { last_error: reason.slice(0, 1000) }).eq("id", mailboxId);
    return { ok: false, error: reason };
  }

  let stored = 0;
  let matched = 0;
  let replies = 0;
  let skippedClassification: string | null = null;

  for (const incoming of sync.messages) {
    /* Our own sends come back through the sync on some providers. Storing them
       would create a second row for a message already recorded, and — worse —
       classify our own copy as a reply. */
    if (incoming.from === mailbox.email.toLowerCase()) continue;

    const { data: existing } = await scope
      .select("messages", "id")
      .eq("provider_message_id", incoming.providerMessageId)
      .maybeSingle();
    if (existing) continue;

    const threadId = await matchThread(ctx, mailboxId, incoming);
    if (threadId) matched++;

    const { data: row } = await scope
      .insert("messages", {
        thread_id: threadId,
        mailbox_id: mailboxId,
        direction: "inbound",
        subject: incoming.subject,
        body_text: incoming.text,
        from_email: incoming.from,
        to_email: incoming.to,
        message_id_header: incoming.messageIdHeader,
        in_reply_to: incoming.inReplyTo,
        provider_message_id: incoming.providerMessageId,
        // Inbound: the send time is when *they* sent it, which is what the
        // inbox orders by and what "2h ago" means to the person reading it.
        sent_at: incoming.receivedAt,
      })
      .select("id")
      .maybeSingle();

    if (!row) continue;
    stored++;

    let classification: ReplyClassification | null = null;
    if (!skippedClassification) {
      try {
        const ourMessage = threadId ? await lastOutbound(ctx, threadId) : null;
        const run = await runForOrg(scope, classifyReply, {
          subject: incoming.subject,
          body: incoming.text,
          ourMessage,
        });
        classification = run.output;
      } catch (e) {
        if (e instanceof AiUnavailable) {
          /* Stop asking — every remaining message fails the same way for the
             same deployment-level reason. The messages are still stored and
             still visible; they are unclassified, and the inbox says so
             rather than showing a label nobody produced. */
          skippedClassification = e.message;
        }
      }
    }

    if (classification) {
      await applyClassification(ctx, {
        messageId: String(row.id),
        threadId,
        from: incoming.from,
        classification,
      });
      if (["positive", "neutral", "negative", "wrong_person"].includes(classification.label)) {
        replies++;
      }
    }
  }

  await scope
    .update("mailboxes", {
      sync_cursor: sync.cursor,
      last_sync_at: new Date().toISOString(),
      last_error: null,
    })
    .eq("id", mailboxId);

  return {
    ok: true,
    result: {
      fetched: sync.messages.length,
      stored,
      matched,
      replies,
      ...(skippedClassification ? { classification_skipped: skippedClassification } : {}),
    },
  };
}

/* ── Matching ────────────────────────────────────────────────────────────── */

async function matchThread(
  ctx: JobContext,
  mailboxId: string,
  incoming: IncomingMessage,
): Promise<string | null> {
  const { scope } = ctx;

  // 1. The provider's own answer.
  if (incoming.providerThreadId) {
    const { data } = await scope
      .select("threads", "id")
      .eq("mailbox_id", mailboxId)
      .eq("provider_thread_id", incoming.providerThreadId)
      .maybeSingle();
    if (data) return String(data.id);
  }

  // 2. The header chain, which crosses mailboxes and providers.
  if (incoming.inReplyTo) {
    const { data } = await scope
      .select("messages", "thread_id")
      .eq("message_id_header", incoming.inReplyTo)
      .not("thread_id", "is", null)
      .maybeSingle();
    if (data?.thread_id) return String(data.thread_id);
  }

  /* 3. The sender, against threads this mailbox has open with them. Ordered
     newest-first and limited to one, because a person we have emailed twice
     has two threads and the recent one is the conversation they are in.

     Deliberately last and deliberately narrow: matching on address alone
     would attach an unrelated email from the same person to whichever thread
     happened to be found. Restricting to open threads on this mailbox is what
     keeps that acceptable. */
  const { data: byParticipant } = await scope
    .select("threads", "id")
    .eq("mailbox_id", mailboxId)
    .eq("status", "open")
    .contains("participants", [incoming.from])
    .order("last_message_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return byParticipant ? String(byParticipant.id) : null;
}

async function lastOutbound(ctx: JobContext, threadId: string): Promise<string | null> {
  const { data } = await ctx.scope
    .select("messages", "body_text")
    .eq("thread_id", threadId)
    .eq("direction", "outbound")
    .not("sent_at", "is", null)
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.body_text ?? null;
}

/* ── What a classification changes ───────────────────────────────────────── */

/**
 * What a classified reply does to the rest of the system.
 *
 * Exported for the test suite, and only for it — nothing else imports this.
 * The same reason `groundableClaims` and `citableClaims` are exported from the
 * AI tasks: the branch that stops a sequence when somebody replies is the one
 * §78 calls the most damaging bug this product can have, and reaching it
 * through the whole handler means reaching it through a model call, which the
 * test suite deliberately cannot make.
 */
export async function applyClassification(
  ctx: JobContext,
  input: {
    messageId: string;
    threadId: string | null;
    from: string;
    classification: ReplyClassification;
  },
): Promise<void> {
  const { scope } = ctx;
  const { label, summary, needsHuman } = input.classification;

  await scope.insert("message_events", {
    message_id: input.messageId,
    kind: label === "bounce" ? "bounced" : label === "unsubscribe" ? "unsubscribed" : "replied",
    payload: { label, summary, confidence: input.classification.confidence },
  });

  if (input.threadId) {
    await scope
      .update("threads", {
        classification: label,
        last_message_at: new Date().toISOString(),
        /* An auto-reply does not reopen a closed thread and does not keep an
           open one at the top of somebody's list. `needsHuman` is the field
           that decides what a person sees, and the classifier is explicit that
           a machine answering is never that. */
        ...(needsHuman ? { status: "open" } : {}),
      })
      .eq("id", input.threadId);
  }

  /* A bounce is a fact about the address, and the most useful one this system
     ever learns: it stops every future send to it, across every campaign. */
  if (label === "bounce") {
    await scope
      .update("contact_points", { verification_status: "undeliverable" })
      .eq("kind", "email")
      .eq("value", input.from);
  }

  if (label === "unsubscribe") {
    await scope.upsert(
      "suppressions",
      {
        kind: "email",
        value: input.from,
        reason: summary.slice(0, 500),
        source: "reply",
      },
      { onConflict: "org_id,kind,value", ignoreDuplicates: true },
    );
  }

  /* An out-of-office is not an answer and must not stop a sequence — the
     person is back next week and the follow-up is the point. Everything else
     from a human does stop it. */
  if (label === "out_of_office") return;

  const opportunityId = input.threadId ? await opportunityFor(ctx, input.threadId) : null;
  if (!opportunityId) return;

  await scope
    .update("enrollments", {
      status: "stopped",
      parked_reason: `They replied: ${summary}`.slice(0, 500),
      next_action_at: null,
    })
    .eq("opportunity_id", opportunityId)
    .eq("status", "active");

  if (label === "bounce") return;

  await scope
    .update("opportunities", { status: "replied" })
    .eq("id", opportunityId)
    .in("status", ["contacted", "assigned", "qualified"]);

  /* The learning loop's raw material (`0004`). `positive` is recorded as its
     own outcome kind because "they answered" and "they answered warmly" are
     the two things a campaign's performance is actually measured on, and
     collapsing them loses the one that matters. */
  await scope.insert("outcomes", {
    opportunity_id: opportunityId,
    kind: label === "positive" ? "positive" : "reply",
    occurred_at: new Date().toISOString(),
  });
}

async function opportunityFor(ctx: JobContext, threadId: string): Promise<string | null> {
  const { data } = await ctx.scope
    .select("threads", "opportunity_id")
    .eq("id", threadId)
    .maybeSingle();
  return data?.opportunity_id ?? null;
}
