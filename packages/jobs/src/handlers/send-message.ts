/**
 * `send_message` — put one message into somebody's inbox.
 *
 * The most dangerous handler in this system, and every decision in it is about
 * that. A scan that runs twice costs a little money. A send that runs twice
 * costs a prospect, and there is no undo.
 *
 * ── The order of the checks, which is the whole design ───────────────────
 *
 *   1. Already sent?      Idempotency. The queue is at-least-once, so this
 *                         handler must be safe to run twice, and the only
 *                         reliable evidence is `sent_at` on the row.
 *   2. Suppressed?        Re-checked here even though `advance_enrollments`
 *                         checked it. Between drafting and sending there is a
 *                         window — sometimes days, if a human is approving —
 *                         and an unsubscribe that arrives inside it must win.
 *   3. Approved?          §46. A message with no `scheduled_at` is a draft
 *                         waiting for a person, and finding one in the queue
 *                         means something enqueued work it should not have.
 *   4. Allowance?         Claimed atomically *before* the send. A crash
 *                         between claiming and sending over-counts by one; the
 *                         reverse order over-sends, which costs a domain's
 *                         reputation and cannot be undone.
 *   5. Send.
 *   6. Record.            `sent_at` and the provider id together, because
 *                         `messages_sent_has_provider_id` in `0004` is §78
 *                         written down: a message cannot claim to have been
 *                         sent without proof.
 *
 * ── What happens when the provider fails ─────────────────────────────────
 *
 * The row keeps `sent_at` null and gains an `error`, and a `failed` event goes
 * into `message_events`. §78: record the failure, do not falsely mark the
 * message as sent. The job retries, and step 1 stops the retry from
 * double-sending if the first attempt actually succeeded and only the response
 * was lost.
 */
import { MailboxUnavailable, authorize, pickMailbox } from "../mailbox/index.ts";
import type { JobContext, JobOutcome } from "../registry.ts";

export interface SendPayload {
  messageId: string;
}

export async function sendMessage(ctx: JobContext): Promise<JobOutcome> {
  const { scope, payload } = ctx;
  const messageId = String(payload.messageId ?? "");
  if (!messageId) {
    return { ok: false, permanent: true, error: "send_message: no messageId in payload." };
  }

  const { data: message, error } = await scope
    .select(
      "messages",
      `id, enrollment_id, mailbox_id, thread_id, direction, subject, body_text, body_html,
       to_email, sent_at, scheduled_at, unsubscribe_token, provider_message_id`,
    )
    .eq("id", messageId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) return { ok: false, error: `send_message: ${error.message}` };
  if (!message) return { ok: true, result: { skipped: "the message no longer exists" } };

  if (message.sent_at) {
    /* Step 1. Not an error: the queue is at-least-once by design, and this is
       the branch that makes that safe. A message with a send time has gone. */
    return { ok: true, result: { skipped: "already sent", provider_message_id: message.provider_message_id } };
  }

  if (message.direction !== "outbound") {
    return { ok: false, permanent: true, error: "send_message: that message is inbound." };
  }

  if (!message.scheduled_at) {
    /* Step 3. §46's ladder puts a human between the draft and the send at
       levels 0 and 1, and `scheduled_at` is where that decision lives. Finding
       an unapproved message in the queue means something enqueued work it
       should not have — worth failing loudly rather than sending. */
    return {
      ok: false,
      permanent: true,
      error:
        "send_message: that message has not been approved. At autonomy 0–1 a " +
        "person approves each message, and nothing should have queued this.",
    };
  }

  if (!message.to_email) {
    return { ok: false, permanent: true, error: "send_message: that message has no recipient." };
  }

  // Step 2.
  const { data: suppressed } = await scope.rpc("is_suppressed", {
    p_org: scope.orgId,
    p_email: message.to_email,
  });
  if (suppressed === true) {
    await scope
      .update("messages", {
        error: "Not sent: the recipient is on this organisation's suppression list.",
      })
      .eq("id", messageId);
    await recordEvent(ctx, messageId, "failed", { reason: "suppressed" });
    return { ok: true, result: { skipped: "suppressed", to: message.to_email } };
  }

  const mailboxId = message.mailbox_id ?? (await pickMailbox(scope));
  if (!mailboxId) {
    return {
      ok: false,
      error:
        "No connected mailbox has any send allowance left today. This message " +
        "stays queued and is sent when the daily limit resets.",
    };
  }

  let mailbox;
  try {
    mailbox = await authorize(scope, mailboxId);
  } catch (e) {
    if (e instanceof MailboxUnavailable) {
      /* Permanent for *this* attempt: a disconnected mailbox does not
         reconnect by being retried. The message stays unsent with the reason
         on it, and the outreach screen shows the mailbox needing attention. */
      await scope.update("messages", { error: e.message }).eq("id", messageId);
      return { ok: false, permanent: true, error: e.message };
    }
    throw e;
  }

  // Step 4. Atomic, and before the send.
  const { data: claimed } = await scope.rpc("claim_mailbox_send", { p_mailbox: mailbox.id });
  if (claimed !== true) {
    return {
      ok: false,
      error: `${mailbox.email} has used its daily allowance. This message is sent tomorrow.`,
    };
  }

  const thread = message.thread_id ? await loadThread(ctx, String(message.thread_id)) : null;

  try {
    // Step 5.
    const sent = await mailbox.provider.send(mailbox.accessToken, {
      to: String(message.to_email),
      subject: String(message.subject ?? ""),
      text: withFooter(String(message.body_text ?? ""), unsubscribeUrl(message.unsubscribe_token)),
      ...(message.body_html ? { html: String(message.body_html) } : {}),
      inReplyTo: thread?.lastMessageId ?? null,
      threadId: thread?.providerThreadId ?? null,
      /* The header gets the one-click endpoint, the footer above gets the page
         with a button. RFC 8058's POST comes from the mail client and is an
         explicit action; the footer link is a GET that mail clients and
         security gateways prefetch, so it must land somewhere that asks. */
      unsubscribeUrl: oneClickUrl(message.unsubscribe_token),
    });

    // Step 6. Both columns in one update: the CHECK constraint refuses a
    // `sent_at` without a provider id, so they cannot be written separately.
    await scope
      .update("messages", {
        sent_at: new Date().toISOString(),
        provider_message_id: sent.providerMessageId,
        message_id_header: sent.messageIdHeader,
        from_email: mailbox.email,
        mailbox_id: mailbox.id,
        error: null,
      })
      .eq("id", messageId);

    const threadId = await ensureThread(ctx, {
      messageId,
      enrollmentId: message.enrollment_id ? String(message.enrollment_id) : null,
      mailboxId: mailbox.id,
      subject: String(message.subject ?? ""),
      providerThreadId: sent.providerThreadId,
      participants: [mailbox.email, String(message.to_email)],
      existingThreadId: message.thread_id ? String(message.thread_id) : null,
    });

    await recordEvent(ctx, messageId, "delivered", {
      provider_message_id: sent.providerMessageId,
    });

    await scope.rpc("increment_usage_internal", {
      p_org: scope.orgId,
      p_metric: "emails",
      p_amount: 1,
    });

    /* The opportunity has now been contacted, which the pipeline should say.
       Only forward — a reply that already moved it past `contacted` must not
       be dragged back by a later step of the same sequence. */
    if (message.enrollment_id) {
      await advanceOpportunityStatus(ctx, String(message.enrollment_id));
    }

    return {
      ok: true,
      result: {
        to: message.to_email,
        from: mailbox.email,
        provider_message_id: sent.providerMessageId,
        thread_id: threadId,
      },
    };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);

    /* §78, exactly. The allowance was already claimed and is not given back:
       over-counting by one is the safe direction, and the alternative — a
       refund that races with a send that actually left — is not. */
    await scope.update("messages", { error: reason.slice(0, 2000) }).eq("id", messageId);
    await recordEvent(ctx, messageId, "failed", { reason: reason.slice(0, 500) });

    return { ok: false, error: reason };
  }
}

/* ── Pieces ──────────────────────────────────────────────────────────────── */

/**
 * The two unsubscribe addresses, which are deliberately different pages.
 *
 * `/unsubscribe/<token>` asks before acting, because it is reached by a GET
 * and mail clients prefetch those. `/api/unsubscribe/<token>` acts on POST,
 * because that POST is RFC 8058 one-click and only ever arrives when somebody
 * pressed the client's own Unsubscribe button.
 *
 * No base URL, no link. A relative unsubscribe URL in an email is a dead link,
 * and a dead unsubscribe link is worse than none: it converts somebody who
 * wanted to leave quietly into somebody pressing "report spam".
 */
function unsubscribeUrl(token: unknown): string | null {
  return absolute(token, "/unsubscribe/");
}

function oneClickUrl(token: unknown): string | null {
  return absolute(token, "/api/unsubscribe/");
}

function absolute(token: unknown, prefix: string): string | null {
  if (typeof token !== "string" || !token) return null;
  const base = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!base) return null;
  return new URL(`${prefix}${token}`, base).toString();
}

/**
 * The footer.
 *
 * Appended here rather than asked of the model, because it must be present on
 * every message and a prompt is not a guarantee. `List-Unsubscribe` covers the
 * clients that support one-click; this covers the ones that do not, and the
 * recipients who look for a link because that is what they are used to.
 */
function withFooter(body: string, url: string | null): string {
  if (!url) return body;
  return `${body}\n\n—\nIf you'd rather not hear from us: ${url}`;
}

async function loadThread(
  ctx: JobContext,
  threadId: string,
): Promise<{ providerThreadId: string | null; lastMessageId: string | null } | null> {
  const { data: thread } = await ctx.scope
    .select("threads", "id, provider_thread_id")
    .eq("id", threadId)
    .maybeSingle();
  if (!thread) return null;

  const { data: last } = await ctx.scope
    .select("messages", "message_id_header")
    .eq("thread_id", threadId)
    .not("message_id_header", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    providerThreadId: thread.provider_thread_id ?? null,
    lastMessageId: last?.message_id_header ?? null,
  };
}

/**
 * The thread this message belongs to, created if this is the first.
 *
 * A thread exists so that a reply arriving three days later has something to
 * attach to. Creating it at send time rather than at reply time is what makes
 * the match possible at all: the provider thread id only exists once the
 * provider has seen the message.
 */
async function ensureThread(
  ctx: JobContext,
  input: {
    messageId: string;
    enrollmentId: string | null;
    mailboxId: string;
    subject: string;
    providerThreadId: string | null;
    participants: string[];
    existingThreadId: string | null;
  },
): Promise<string | null> {
  const { scope } = ctx;
  if (input.existingThreadId) {
    await scope
      .update("threads", { last_message_at: new Date().toISOString() })
      .eq("id", input.existingThreadId);
    return input.existingThreadId;
  }

  let opportunityId: string | null = null;
  if (input.enrollmentId) {
    const { data: enrollment } = await scope
      .select("enrollments", "opportunity_id")
      .eq("id", input.enrollmentId)
      .maybeSingle();
    opportunityId = enrollment?.opportunity_id ?? null;
  }

  const { data: thread } = await scope
    .insert("threads", {
      opportunity_id: opportunityId,
      mailbox_id: input.mailboxId,
      subject: input.subject,
      status: "open",
      provider_thread_id: input.providerThreadId,
      participants: input.participants.map((p) => p.toLowerCase()),
      last_message_at: new Date().toISOString(),
    })
    .select("id")
    .maybeSingle();

  if (!thread) return null;

  await scope.update("messages", { thread_id: thread.id }).eq("id", input.messageId);
  return String(thread.id);
}

async function recordEvent(
  ctx: JobContext,
  messageId: string,
  kind: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await ctx.scope.insert("message_events", { message_id: messageId, kind, payload });
}

async function advanceOpportunityStatus(ctx: JobContext, enrollmentId: string): Promise<void> {
  const { data: enrollment } = await ctx.scope
    .select("enrollments", "opportunity_id")
    .eq("id", enrollmentId)
    .maybeSingle();
  if (!enrollment?.opportunity_id) return;

  await ctx.scope
    .update("opportunities", { status: "contacted" })
    .eq("id", enrollment.opportunity_id)
    .in("status", ["discovered", "researching", "qualified", "assigned"]);
}
