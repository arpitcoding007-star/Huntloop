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
import { parseOrgProfile } from "@huntloop/db/org-profile";
import { MailboxUnavailable, authorize, isSingleAddress, pickMailbox } from "../mailbox/index.ts";
import { bareDomain, checkContent } from "../gate.ts";
import { inBusinessHours, nextBusinessWindow, zoneForCountry } from "../business-hours.ts";
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
       to_email, sent_at, scheduled_at, provider_message_id,
       send_attempted_at, approved_by, opportunity_id`,
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

  if (message.send_attempted_at) {
    /* OUT-001. An earlier run claimed this send and did not finish recording
       it: it may have reached the inbox. Sending again on that guess is the
       one mistake outreach cannot undo, so this stops and asks a person. */
    return {
      ok: false,
      permanent: true,
      error:
        "Delivery unknown: an earlier attempt to send this message did not finish. " +
        "Check the mailbox's Sent folder before sending it again.",
    };
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

  /* One address, or nothing is sent. `can_contact` judges the string it is
     given as a single address, so a value carrying a line break or a list
     would let recipients through that no check ever saw (audit lead 8). */
  if (!isSingleAddress(String(message.to_email))) {
    const why = "Not sent: the recipient is not a single valid email address.";
    await scope.update("messages", { error: why }).eq("id", messageId);
    return { ok: true, result: { skipped: "invalid_address", to: message.to_email } };
  }

  /* Step 2. One question, asked once.
     `0017` built `can_contact` to be *the* gate — suppression, the erasure
     residue hash, the per-contact cadence, the 30-day cap and the org's daily
     ceiling — and said so in its own comment: two guards means one of them
     eventually gets skipped. This used to call `is_suppressed`, which is the
     first of those five checks and therefore skipped the other four. A
     deployment with a two-day cadence would happily send twice in an hour.

     It also missed the case erasure exists for: after `erase_contact` there is
     no plaintext address left to compare, only a hash, so `is_suppressed`
     finds nothing and concludes the person is contactable. */
  const { data: verdictRows } = await scope.rpc("can_contact", {
    p_org: scope.orgId,
    p_email: message.to_email,
  });
  const verdict = (Array.isArray(verdictRows) ? verdictRows[0] : verdictRows) as
    | { allowed?: boolean; reason?: string; detail?: Record<string, unknown> }
    | null
    | undefined;

  /* A gate that cannot be read does NOT fail open. Everywhere else in this
     codebase an unreadable quota fails open, because the cost of being wrong
     is a reconciliation and it is ours. Here the cost is an email that a
     person asked us never to send, to somebody who is not our customer, and
     it cannot be taken back. */
  if (!verdict || verdict.allowed !== true) {
    const reason = verdict?.reason ?? "unavailable";
    await scope.update("messages", { error: refusalMessage(reason, verdict?.detail) })
      .eq("id", messageId);
    await recordEvent(ctx, messageId, "failed", { reason });

    /* Suppression and erasure are permanent; a cadence cap is not. The first
       group is closed out as a skip so it stops occupying the queue. The
       second stays a retryable failure, because "too soon" becomes "fine" by
       itself, and re-queueing a message somebody approved is what the sender
       expects. */
    if (reason === "suppressed" || reason === "invalid_address" || reason === "unknown_org") {
      return { ok: true, result: { skipped: reason, to: message.to_email } };
    }
    return { ok: false, error: refusalMessage(reason, verdict?.detail) };
  }

  /*
   * Step 3b. An unsubscribe link has to exist before anything else is spent.
   *
   * `absolute()` returns null when `NEXT_PUBLIC_SITE_URL` is unset, and until
   * now that produced the worst outcome available here, quietly: `withFooter`
   * returned the body unchanged and `oneClickUrl` handed the provider null,
   * so the message went out with **no footer link and no `List-Unsubscribe`
   * header** — a commercial email carrying no opt-out mechanism at all.
   *
   * `unsubscribeUrl`'s own comment argues that a dead unsubscribe link is
   * worse than none. That is right, and it left out the case that is worse
   * than both: no link. It is also the only failure in this handler that is a
   * legal requirement rather than a deliverability one — CAN-SPAM
   * §7704(a)(3), CASL and PECR each require a working opt-out on every
   * commercial message, and none of them have an exception for a missing
   * environment variable.
   *
   * So: the third option, refuse. Retryable rather than permanent, because
   * the fix is one variable and the message should go out once it is set —
   * the same shape as the allowance refusal below.
   *
   * Placed before `claim_mailbox_send` so a misconfiguration cannot burn a
   * day's send allowance on a message that was never going to leave.
   */
  /* The token is read on its own: since 0047 it lives in a table no tenant
     session can read (security audit lead 6), not on `messages`. */
  const { data: tokenRow } = await scope
    .select("message_unsubscribe_tokens", "token")
    .eq("message_id", messageId)
    .maybeSingle();
  const unsubscribeToken = tokenRow?.token ?? null;

  if (!unsubscribeUrl(unsubscribeToken)) {
    const why =
      "Not sent: no unsubscribe link could be built for this message, so it " +
      "would arrive with no way to opt out. Set NEXT_PUBLIC_SITE_URL.";
    await scope.update("messages", { error: why }).eq("id", messageId);
    await recordEvent(ctx, messageId, "failed", { reason: "no_unsubscribe_url" });
    return { ok: false, error: why };
  }

  /*
   * Step 3c. The sender's postal address, which is the other mandatory
   * element of a commercial message.
   *
   * CAN-SPAM §7704(a)(5) requires a valid physical postal address in every
   * commercial email and CASL requires the sender's mailing address; neither
   * has an exception for a workspace that has not filled the field in. The
   * footer carried only an unsubscribe line until now, and no column existed
   * that could have held an address — see `OrgComplianceSettings`.
   *
   * Refused rather than defaulted for the same reason as the unsubscribe URL
   * above, and the refusal names the screen rather than the column, because
   * the person who reads this in the outreach inbox is the person who has to
   * go and fix it.
   */
  const { data: orgRow } = await scope.organization("settings").maybeSingle();
  const postalAddress = parseOrgProfile(
    (orgRow as { settings?: unknown } | null)?.settings,
  ).compliance.postalAddress;

  if (!postalAddress) {
    const why =
      "Not sent: this workspace has no postal address, which every commercial " +
      "email is required to carry. Add one under Settings → Organisation.";
    await scope.update("messages", { error: why }).eq("id", messageId);
    await recordEvent(ctx, messageId, "failed", { reason: "no_postal_address" });
    return { ok: false, error: why };
  }

  /*
   * Step 3d. The plan's email allowance.
   *
   * `emails` is one of five quotas `plans.limits` defines and the landing
   * page prices. It was incremented after every successful send — the line
   * near the bottom of this function — and checked nowhere, so a workspace
   * on Free, whose allowance is literally zero, was metered and never
   * stopped. Of the five limits the pricing section calls "the limits the
   * product actually enforces", this was one of the three that were not.
   *
   * Distinct from `claim_mailbox_send` below, which is a per-mailbox daily
   * cap protecting sender reputation and does not vary by plan. Both are
   * real and neither substitutes for the other.
   *
   * Checked before the allowance claim for the same reason as the two
   * preconditions above, and it fails *open* on a read error — the same call
   * `packages/jobs/src/ai.ts` makes, with the same reasoning: the cost of
   * failing open is a reconciliation and it is ours, while the cost of
   * failing closed is a customer's outreach silently stopping.
   */
  const { data: quotaData, error: quotaError } = await scope.rpc("check_quota_internal", {
    p_org: scope.orgId,
    p_metric: "emails",
  });
  const quotaRow = (Array.isArray(quotaData) ? quotaData[0] : quotaData) as
    | { allowed?: boolean; used?: number; quota?: number | null }
    | undefined;

  if (!quotaError && quotaRow && quotaRow.allowed === false) {
    const why =
      `Not sent: this workspace has used ${quotaRow.used ?? 0} of its ` +
      `${quotaRow.quota ?? 0} emails this month. The message stays queued ` +
      `and sends when the allowance resets, or when the plan changes.`;
    await scope.update("messages", { error: why }).eq("id", messageId);
    await recordEvent(ctx, messageId, "failed", { reason: "over_email_quota" });
    return { ok: false, error: why };
  }

  /*
   * Step 3e. They wrote back since our last email (P0-2).
   *
   * A reply stops the sequence only once `classify_reply` has run and the
   * thread has resolved to an opportunity. A reply the model never saw — no
   * key, quota exhausted, an outage — or one that arrived from a phone as a
   * new message with no thread, left the enrollment running, and the next
   * step went out on top of somebody's answer. So a sequence step asks the
   * mailbox directly: has this person written to us since we last wrote to
   * them? If so, a person looks before anything else is sent. Out-of-office
   * replies do not count; everything else, classified or not, does.
   *
   * Sequence steps only. A message without an enrollment is somebody
   * answering from the inbox, and the reply it answers is the reason it exists.
   *
   * The message goes back to the approval queue rather than failing. A person
   * who reads the reply and approves the step anyway has answered the
   * question, so replies older than their approval no longer hold it.
   */
  if (message.enrollment_id) {
    const approvedAt = message.approved_by && message.scheduled_at ? String(message.scheduled_at) : null;
    if (await repliedSinceLastSend(ctx, String(message.to_email), approvedAt)) {
      const why =
        "Held for approval: they have written back since the last email. Read the reply in " +
        "the inbox, then approve this step if it should still go, or stop the sequence.";
      await scope.update("messages", { scheduled_at: null, error: why }).eq("id", messageId);
      await recordEvent(ctx, messageId, "failed", { reason: "reply_pending" });
      return { ok: true, result: { skipped: "held_for_approval", reason: "reply_pending" } };
    }
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

  /*
   * Step 3f. A mailbox that is bouncing stops (P0-5).
   *
   * A bad list burns a domain in an afternoon: every bounce tells the
   * receiving providers this sender does not know who it is writing to. Past
   * BOUNCE_LIMIT over the window, nothing more leaves this mailbox until the
   * rate falls — the message stays queued, and the mailbox carries the reason
   * where the outreach screen shows it.
   */
  const bounce = await bounceHealth(ctx, mailbox.id);
  if (bounce.paused) {
    const why =
      `Paused: ${mailbox.email} bounced ${bounce.bounces} of its last ${bounce.sends} emails ` +
      `in ${BOUNCE_WINDOW_DAYS} days, over the ${Math.round(BOUNCE_LIMIT * 100)}% limit. ` +
      `Nothing more leaves it until older bounces fall out of that window; clean the list ` +
      `before resuming.`;
    await scope.update("mailboxes", { last_error: why }).eq("id", mailbox.id);
    await recordEvent(ctx, messageId, "failed", { reason: "bounce_rate", ...bounce });
    return defer(ctx, messageId, new Date(Date.now() + 6 * 3600_000), "bounce_rate", why);
  }

  /*
   * Step 3f-ii. Cold sends need a sendable domain, a fresh inbox read and the
   * recipient's working day (P1-4, P1-2, P1-5). Replies from the inbox skip
   * all three: somebody wrote to us and a person is answering.
   *
   *   - A domain the check found unable to send (no MX or no SPF) sends no
   *     cold email at all.
   *   - The mailbox must have been read in the last SYNC_FRESH_MINUTES, so a
   *     reply that arrived since the last read stops the sequence before
   *     the next step rather than after it.
   *   - Outside 08:00–18:00 Monday to Friday in the recipient's zone, the
   *     send waits for the next window.
   *
   * Each waits on `not_before` instead of failing — see `defer`.
   */
  if (message.enrollment_id) {
    const { data: domainRow } = await scope
      .select("mailboxes", "domain_status, domain_report")
      .eq("id", mailbox.id)
      .maybeSingle();
    const domain = domainRow as { domain_status?: string | null; domain_report?: { problems?: string[] } | null } | null;
    if (domain?.domain_status === "fail") {
      const why =
        `Paused: ${mailbox.email}'s domain is not set up to send email. ` +
        (domain.domain_report?.problems ?? []).join(" ");
      await scope.update("mailboxes", { last_error: why.slice(0, 1000) }).eq("id", mailbox.id);
      await recordEvent(ctx, messageId, "failed", { reason: "domain_not_ready" });
      return defer(ctx, messageId, new Date(Date.now() + 6 * 3600_000), "domain_not_ready", why);
    }

    const freshAfter = Date.now() - SYNC_FRESH_MINUTES * 60_000;
    if (!mailbox.lastSyncAt || new Date(mailbox.lastSyncAt).getTime() < freshAfter) {
      return defer(ctx, messageId, new Date(Date.now() + 15 * 60_000), "inbox_not_fresh");
    }

    const zone = zoneForCountry(await recipientCountry(ctx, message.opportunity_id ?? null));
    if (zone && !inBusinessHours(new Date(), zone)) {
      return defer(ctx, messageId, nextBusinessWindow(new Date(), zone), "outside_business_hours");
    }
  }

  /*
   * Step 3g. Nobody read this one (P0-4).
   *
   * At autonomy 2+ the draft goes out unreviewed, so it gets the content
   * check a reviewer would have given it. A failure is not a send failure: the
   * message goes back to the approval queue with the reasons on it, which is
   * what autonomy 0–1 would have done with it in the first place.
   */
  /* OUT-011: only a message nobody approved. A person who read a held draft
     and approved it has answered every question this check asks. */
  if (message.enrollment_id && !message.approved_by && (await autonomyFor(ctx, String(message.enrollment_id))) >= 2) {
    const issues = checkContent({
      subject: String(message.subject ?? ""),
      body: String(message.body_text ?? ""),
      allowedDomains: [mailbox.email, String(message.to_email), ...(await orgDomains(ctx))],
    });
    if (issues.length) {
      const why = `Held for approval: ${issues.join(" ")}`.slice(0, 2000);
      await scope.update("messages", { scheduled_at: null, error: why }).eq("id", messageId);
      await recordEvent(ctx, messageId, "failed", { reason: "pre_send_check", issues });
      return { ok: true, result: { skipped: "held_for_approval", issues } };
    }
  }

  /* OUT-013. `can_contact` reads a counter that moves only after a send, so
     two lanes with two messages to one address both passed it. One message
     per address is in flight; the other waits. Before the allowance claim,
     so waiting does not spend it. A lane that cannot be read does not open:
     the same posture as `can_contact` above. */
  const { data: lane, error: laneError } = await scope.rpc("claim_contact_lane", {
    p_org: scope.orgId,
    p_email: message.to_email,
    p_message: messageId,
  });
  if (laneError || lane !== true) {
    const soon = new Date(Date.now() + 15 * 60_000);
    return defer(ctx, messageId, soon, "address_busy", "Another message to this address is being sent.");
  }

  // Step 4. Atomic, and before the send.
  const { data: claimed } = await scope.rpc("claim_mailbox_send", { p_mailbox: mailbox.id });
  if (claimed !== true) {
    /* DB-101: the allowance is a wait, not a failure. Retrying burned three
       attempts in minutes and the sweep re-enqueued it every tick until
       midnight; it now waits for the UTC day the counter resets on. */
    const tomorrow = new Date();
    tomorrow.setUTCHours(24, 0, 0, 0);
    return defer(ctx, messageId, tomorrow, "daily_allowance", `${mailbox.email} has used today's allowance.`);
  }

  const thread = message.thread_id ? await loadThread(ctx, String(message.thread_id)) : null;

  /* OUT-001. Step 5 is at-most-once. Only one run can move
     `send_attempted_at` from null, and a run that loses does not send. */
  const { data: won, error: claimError } = await scope
    .update("messages", { send_attempted_at: new Date().toISOString() })
    .eq("id", messageId)
    .is("sent_at", null)
    .is("send_attempted_at", null)
    .select("id");
  if (claimError) return { ok: false, error: `send_message: ${claimError.message}` };
  if (!Array.isArray(won) || won.length === 0) {
    return { ok: true, result: { skipped: "another run is sending this message" } };
  }

  try {
    // Step 5.
    const sent = await mailbox.provider.send(mailbox.accessToken, {
      to: String(message.to_email),
      subject: String(message.subject ?? ""),
      text: withFooter(
        String(message.body_text ?? ""),
        unsubscribeUrl(unsubscribeToken),
        postalAddress,
      ),
      /* The HTML part gets the same footer, not none.
         `withFooter` used to be applied to `text` only, so a message with an
         HTML body would have rendered — in the part most clients actually
         display — with no unsubscribe link and no address. Nothing writes
         `body_html` today, which is the only reason that was not already a
         live defect, and a latent one in this handler is not worth keeping. */
      ...(message.body_html
        ? {
            html: withHtmlFooter(
              String(message.body_html),
              unsubscribeUrl(unsubscribeToken),
              postalAddress,
            ),
          }
        : {}),
      inReplyTo: thread?.lastMessageId ?? null,
      threadId: thread?.providerThreadId ?? null,
      /* The header gets the one-click endpoint, the footer above gets the page
         with a button. RFC 8058's POST comes from the mail client and is an
         explicit action; the footer link is a GET that mail clients and
         security gateways prefetch, so it must land somewhere that asks. */
      unsubscribeUrl: oneClickUrl(unsubscribeToken),
    });

    // Step 6. Both columns in one update: the CHECK constraint refuses a
    // `sent_at` without a provider id, so they cannot be written separately.
    const { error: recordError } = await scope
      .update("messages", {
        sent_at: new Date().toISOString(),
        provider_message_id: sent.providerMessageId,
        message_id_header: sent.messageIdHeader,
        from_email: mailbox.email,
        mailbox_id: mailbox.id,
        error: null,
      })
      .eq("id", messageId);

    if (recordError) {
      /* The message left. Not recording it must never become a retry: the
         claim above stays set, so a rerun stops at "delivery unknown". */
      await recordEvent(ctx, messageId, "delivered", {
        provider_message_id: sent.providerMessageId,
        record_error: recordError.message.slice(0, 500),
      });
      return {
        ok: false,
        permanent: true,
        error: `Sent, but the send could not be recorded: ${recordError.message}`,
      };
    }

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

    /* The counter `can_contact` reads, rolled after the provider accepted and
       never before. Recording it earlier would decrement a customer's
       allowance for a message that failed to send; recording it later than
       this — in a sweep — would leave the cadence cap wrong for the whole
       window between, which is the window in which a sequence sends again. */
    await scope.rpc("record_contact_send", {
      p_org: scope.orgId,
      p_email: message.to_email,
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
    /* OUT-001. Only a definite refusal releases the claim and allows a retry.
       A timeout, a 5xx or an accepted request with no id may have delivered,
       and is left for a person rather than re-sent. */
    const refused = isDefiniteRefusal(reason);
    await scope
      .update("messages", {
        error: (refused ? reason : `Delivery unknown — check the Sent folder. ${reason}`).slice(0, 2000),
        ...(refused ? { send_attempted_at: null } : {}),
      })
      .eq("id", messageId);
    if (refused) await scope.rpc("release_contact_lane", { p_org: scope.orgId, p_message: messageId });
    await recordEvent(ctx, messageId, "failed", { reason: reason.slice(0, 500), refused });

    return refused ? { ok: false, error: reason } : { ok: false, permanent: true, error: reason };
  }
}

/* ── Pieces ──────────────────────────────────────────────────────────────── */

/** How recent the mailbox's last inbox read must be for a sequence step to send. Twice the sync cadence. */
export const SYNC_FRESH_MINUTES = 30;
export const BOUNCE_WINDOW_DAYS = 14;
export const BOUNCE_LIMIT = 0.05;
export const BOUNCE_MIN_SENDS = 10;

function rows<T>(data: unknown): T[] {
  return Array.isArray(data) ? (data as T[]) : [];
}

/**
 * A send that is right but early waits on `messages.not_before` (0048) and
 * succeeds, rather than failing. A failure spends one of three attempts and a
 * spent message is stranded; `schedule_sends` re-enqueues a deferred one once
 * `not_before` passes. Before 0048 the column is missing, and the wait falls
 * back to a retryable failure.
 */
async function defer(
  ctx: JobContext,
  messageId: string,
  until: Date,
  reason: string,
  why?: string,
): Promise<JobOutcome> {
  const { error } = await ctx.scope.update("messages", { not_before: until.toISOString() }).eq("id", messageId);
  if (error) return { ok: false, error: why ?? `send_message: waiting (${reason})` };
  return { ok: true, result: { deferred: reason, until: until.toISOString(), ...(why ? { why } : {}) } };
}

async function recipientCountry(ctx: JobContext, opportunityId: string | null): Promise<string | null> {
  if (!opportunityId) return null;
  const { data } = await ctx.scope
    .select("opportunities", "companies(country)")
    .eq("id", opportunityId)
    .maybeSingle();
  const company = (data as { companies?: { country?: string | null } | { country?: string | null }[] } | null)?.companies;
  const country = Array.isArray(company) ? company[0]?.country : company?.country;
  return country ?? null;
}

/**
 * Has this address written to us since our last email to it — and since a
 * person approved this step, when one did — with anything other than an
 * out-of-office? Exported for the test suite.
 */
export async function repliedSinceLastSend(
  ctx: JobContext,
  address: string,
  approvedAt: string | null = null,
): Promise<boolean> {
  const { scope } = ctx;
  const email = address.toLowerCase();

  const { data: lastOut } = await scope
    .select("messages", "sent_at")
    .eq("direction", "outbound")
    .eq("to_email", email)
    .not("sent_at", "is", null)
    .order("sent_at", { ascending: false })
    .limit(1);
  const lastSent = rows<{ sent_at: string | null }>(lastOut)[0]?.sent_at ?? null;
  const times = [lastSent, approvedAt].filter((t): t is string => Boolean(t)).map((t) => new Date(t).getTime());
  const since = times.length ? new Date(Math.max(...times)).toISOString() : null;

  let inbound = scope
    .select("messages", "id")
    .eq("direction", "inbound")
    .eq("from_email", email)
    .is("deleted_at", null);
  if (since) inbound = inbound.gt("sent_at", since);
  const { data: replies } = await inbound.order("sent_at", { ascending: false }).limit(20);
  const ids = rows<{ id: string }>(replies).map((r) => String(r.id));
  if (!ids.length) return false;

  /* An out-of-office is the one answer that is not an answer. Any other
     reply — and any reply nobody has classified — holds the sequence. */
  const { data: events } = await scope
    .select("message_events", "message_id, payload")
    .in("message_id", ids)
    .eq("kind", "replied");
  const autoReplies = new Set(
    rows<{ message_id: string; payload: { label?: string } | null }>(events)
      .filter((e) => e.payload?.label === "out_of_office")
      .map((e) => String(e.message_id)),
  );
  return ids.some((id) => !autoReplies.has(id));
}

/** Bounces over sends for one mailbox, over the window. Exported for the test suite. */
export async function bounceHealth(
  ctx: JobContext,
  mailboxId: string,
): Promise<{ paused: boolean; sends: number; bounces: number }> {
  const { scope } = ctx;
  const since = new Date(Date.now() - BOUNCE_WINDOW_DAYS * 86_400_000).toISOString();

  const { data: sent } = await scope
    .select("messages", "id")
    .eq("mailbox_id", mailboxId)
    .eq("direction", "outbound")
    .gte("sent_at", since)
    .limit(1000);
  const sends = rows(sent).length;
  if (sends < BOUNCE_MIN_SENDS) return { paused: false, sends, bounces: 0 };

  /* Bounce notices arrive as inbound messages on the same mailbox, and
     `applyClassification` marks each with a `bounced` event. */
  const { data: inbound } = await scope
    .select("messages", "id")
    .eq("mailbox_id", mailboxId)
    .eq("direction", "inbound")
    .gte("sent_at", since)
    .limit(1000);
  const inboundIds = rows<{ id: string }>(inbound).map((r) => String(r.id));
  if (!inboundIds.length) return { paused: false, sends, bounces: 0 };

  const { data: bounced } = await scope
    .select("message_events", "message_id")
    .in("message_id", inboundIds)
    .eq("kind", "bounced");
  const bounces = new Set(rows<{ message_id: string }>(bounced).map((e) => String(e.message_id))).size;

  return { paused: bounces / sends > BOUNCE_LIMIT, sends, bounces };
}

/** The campaign's autonomy level for this enrollment; 0 when it cannot be read, since 0 means a person approved. */
async function autonomyFor(ctx: JobContext, enrollmentId: string): Promise<number> {
  const { data } = await ctx.scope
    .select("enrollments", "campaigns(autonomy_level)")
    .eq("id", enrollmentId)
    .maybeSingle();
  const campaign = (data as { campaigns?: { autonomy_level?: number } | { autonomy_level?: number }[] } | null)
    ?.campaigns;
  const level = Array.isArray(campaign) ? campaign[0]?.autonomy_level : campaign?.autonomy_level;
  return Number(level ?? 0);
}

/** The org's own websites, from its products — the domains its messages may link to. */
async function orgDomains(ctx: JobContext): Promise<string[]> {
  const { data } = await ctx.scope.select("products", "website").is("deleted_at", null);
  return rows<{ website: string | null }>(data)
    .map((p) => bareDomain(p.website))
    .filter((d): d is string => Boolean(d));
}

/**
 * Did the provider answer "no" — so nothing was sent?
 *
 * The Gmail and Graph adapters throw `Gmail 4xx …` / `Graph 4xx …` when the
 * API answered with a client error. That is a definite refusal. Everything
 * else — a 5xx, an abort, a network error, "accepted but returned no id" — is
 * ambiguous about whether the message left.
 */
export function isDefiniteRefusal(reason: string): boolean {
  return /^(Gmail|Graph) 4\d\d\b/.test(reason);
}

/**
 * `can_contact`'s reason code as a sentence somebody can act on.
 *
 * The reason lands in `messages.error`, which is rendered on the outreach
 * screen beside the message that did not go. "frequency_cap" there is a
 * support ticket; "we have already sent 3 in 30 days, and the cap is 3" is an
 * answer, and it names the setting the reader has to change.
 *
 * An unrecognised code still produces a sentence rather than an empty string —
 * a new refusal added to `can_contact` later must degrade to something
 * readable rather than to a blank cell.
 */
export function refusalMessage(reason: string, detail?: Record<string, unknown>): string {
  switch (reason) {
    case "suppressed":
      return "Not sent: the recipient is on this organisation's suppression list.";
    case "too_soon": {
      const days = detail?.minDays;
      return (
        "Not sent: this address was contacted too recently. " +
        (days ? `This organisation allows one message every ${days} days.` : "")
      ).trim();
    }
    case "frequency_cap":
      return (
        `Not sent: this address has had ${detail?.sends30d ?? "several"} messages in the ` +
        `last 30 days, and the cap is ${detail?.cap ?? "lower"}.`
      );
    case "org_daily_cap":
      return (
        `Not sent: this organisation has sent ${detail?.sentToday ?? "its"} messages today, ` +
        `which is its daily ceiling of ${detail?.cap ?? "sends"}. It resumes tomorrow.`
      );
    case "invalid_address":
      return "Not sent: the recipient address is empty or malformed.";
    case "unknown_org":
      return "Not sent: the sending organisation could not be read.";
    default:
      /* Including the `unavailable` case, where the check itself failed. The
         message says what happened rather than inventing a reason it did not
         establish. */
      return `Not sent: the contact-safety check did not pass (${reason}).`;
  }
}

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
 *
 * Both arguments are checked before the send now, so the `null` branches are
 * unreachable in the handler's own path. They stay because this is an
 * exported-shaped helper and a footer function that silently drops a legally
 * required element when handed null is the bug this file just fixed.
 */
function withFooter(body: string, url: string | null, postalAddress: string | null): string {
  const parts = [body, "\n\n—"];
  if (postalAddress) parts.push(`\n${postalAddress}`);
  if (url) parts.push(`\nIf you'd rather not hear from us: ${url}`);
  return parts.join("");
}

/**
 * The same footer, for the HTML part.
 *
 * Appended rather than inserted into the document: a regex that tries to find
 * `</body>` in model-generated HTML will eventually meet a fragment that has
 * none, and an appended block renders correctly in every mail client either
 * way — they are far more forgiving of trailing markup than of a footer that
 * is not there.
 *
 * The address is escaped and its newlines become `<br>`, because it is
 * operator-supplied free text being placed into markup.
 */
function withHtmlFooter(body: string, url: string | null, postalAddress: string | null): string {
  const lines: string[] = [];
  if (postalAddress) lines.push(escapeHtml(postalAddress).replace(/\n/g, "<br>"));
  if (url) {
    const href = escapeHtml(url);
    lines.push(`If you'd rather not hear from us: <a href="${href}">unsubscribe</a>`);
  }
  if (!lines.length) return body;

  return (
    `${body}\n<hr>\n<div style="color:#666;font-size:12px;line-height:1.5">` +
    `${lines.join("<br><br>")}</div>`
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
