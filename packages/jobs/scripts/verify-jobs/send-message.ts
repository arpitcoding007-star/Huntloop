/** send_message and the checks around it — the handler with no undo. */
import { OrgScope, setAdminClientForTests } from "../../src/scope.ts";
import { sendExchangeNotifications } from "../../src/handlers/send-exchange-notifications.ts";
import { HANDLERS } from "../../src/registry.ts";
import { bounceHealth, contactAllowedAfter, repliedSinceLastSend, sendMessage } from "../../src/handlers/send-message.ts";
import { preclassify } from "../../src/mailbox/preclassify.ts";
import { bareDomain, checkContent } from "../../src/gate.ts";
import { inBusinessHours, nextBusinessWindow, zoneForCountry } from "../../src/business-hours.ts";
import { assessDomain, checkMailboxDomain } from "../../src/handlers/check-mailbox-domain.ts";
import { gmail } from "../../src/mailbox/gmail.ts";
import { buildMime, type OutgoingMessage } from "../../src/mailbox/provider.ts";
import { expect, expectEqual, expectThrows, type Recorded, fakeClient, ORG_A, ORG_B } from "./harness.ts";
import { MAILBOX_ID, sendable, connectedMailbox, liveEnrollment, sendContext, waited, markedSent, INBOUND_ID, deferred } from "./fixtures.ts";

console.log("\nsend_message — the checks that stop a second send");

{
  /* Step 1. The queue is at-least-once by design, so this branch is the only
     thing between a retried job and a prospect receiving the same email
     twice. */
  const { ctx, calls } = sendContext(
    sendable({ sent_at: new Date().toISOString(), provider_message_id: "gmail-1" }),
  );
  const outcome = await sendMessage(ctx);

  expect("an already-sent message is skipped rather than resent", outcome.ok);
  expectEqual(
    "and says so, with the provider id that proves it went",
    (outcome as { result: Record<string, unknown> }).result.skipped,
    "already sent",
  );
  expect("nothing was sent again", !markedSent(calls));
  setAdminClientForTests(null);
}

{
  // §46's ladder. At autonomy 0–1 a person approves; a message in the queue
  // without `scheduled_at` means something enqueued work it should not have.
  const { ctx, calls } = sendContext(sendable({ scheduled_at: null }));
  const outcome = await sendMessage(ctx);

  expect("an unapproved message is refused", !outcome.ok);
  expect(
    "permanently — retrying will not make a person approve it",
    (outcome as { permanent?: boolean }).permanent === true,
  );
  expect("and it is not sent", !markedSent(calls));
  setAdminClientForTests(null);
}

{
  const { ctx, calls } = sendContext(sendable({ direction: "inbound" }));
  const outcome = await sendMessage(ctx);
  expect("an inbound message is never sent", !outcome.ok && !markedSent(calls));
  setAdminClientForTests(null);
}

{
  const { ctx, calls } = sendContext(sendable({ to_email: null }));
  const outcome = await sendMessage(ctx);
  expect("a message with no recipient is refused rather than sent nowhere", !outcome.ok);
  expect("and not marked sent", !markedSent(calls));
  setAdminClientForTests(null);
}

{
  /* Audit lead 8. `can_contact` judges the recipient as one address, so a
     value carrying a line break would smuggle in recipients nobody checked. */
  const { ctx, calls } = sendContext(sendable({ to_email: "dana@acme.co\r\nBcc: extra@third.example" }));
  const outcome = await sendMessage(ctx);
  expect("a recipient with a line break in it is never sent", outcome.ok && !markedSent(calls));
  expect(
    "and is skipped as an invalid address before any allowance is claimed",
    (outcome as { result?: { skipped?: string } }).result?.skipped === "invalid_address" &&
      !calls.some((c) => c.table === "claim_mailbox_send"),
  );
  setAdminClientForTests(null);
}

console.log("\nbuildMime — header values stay on their own line (audit lead 8)");
{
  const headerBlock = (mime: string) => mime.split("\r\n\r\n")[0]!.split("\r\n");
  const injected = headerBlock(
    buildMime("founder@huntloop.test", {
      to: "dana@acme.co",
      subject: "hello\r\nBcc: extra@third.example",
      text: "x",
      inReplyTo: "<a@b.test>\r\nBcc: extra@third.example",
    }),
  );
  expect("a CRLF in the subject adds no header line", !injected.some((l) => /^bcc:/i.test(l)));
  expect("the subject keeps its words on one line", injected.includes("Subject: hello Bcc: extra@third.example"));
  expect(
    "a malformed In-Reply-To is dropped, not sent",
    !injected.some((l) => /^(in-reply-to|references):/i.test(l)),
  );

  const threaded = headerBlock(
    buildMime("founder@huntloop.test", {
      to: "dana@acme.co",
      subject: "Re: hi",
      text: "x",
      inReplyTo: "<CA+abc@mail.gmail.com>",
    }),
  );
  expect("a well-formed In-Reply-To still threads", threaded.includes("In-Reply-To: <CA+abc@mail.gmail.com>"));

  await expectThrows(
    "a recipient carrying a line break is refused",
    () =>
      buildMime("founder@huntloop.test", {
        to: "dana@acme.co\r\nBcc: extra@third.example",
        subject: "s",
        text: "x",
      }),
    /recipient/,
  );
  await expectThrows(
    "a list of recipients is refused",
    () => buildMime("founder@huntloop.test", { to: "dana@acme.co, extra@third.example", subject: "s", text: "x" }),
    /recipient/,
  );
  await expectThrows(
    "an unsubscribe URL that would break out of its brackets is refused",
    () =>
      buildMime("founder@huntloop.test", {
        to: "dana@acme.co",
        subject: "s",
        text: "x",
        unsubscribeUrl: "https://huntloop.test/api/unsubscribe/x>\r\nBcc: extra@third.example",
      }),
    /unsubscribe/,
  );
  expect(
    "a non-ASCII subject is still RFC 2047 encoded",
    headerBlock(buildMime("founder@huntloop.test", { to: "dana@acme.co", subject: "Café — hello", text: "x" })).some(
      (l) => l.startsWith("Subject: =?UTF-8?B?"),
    ),
  );
}

console.log("\nsend_message — an unsubscribe that lands mid-approval still wins");

{
  /* Step 2. `advance_enrollments` already checked suppression, and it is
     checked again here because the gap between drafting and sending can be
     days when a human is approving. */
  const { ctx, calls } = sendContext(sendable(), {
    "rpc:can_contact": { data: [{ allowed: false, reason: "suppressed", detail: {} }], error: null },
  });
  const outcome = await sendMessage(ctx);

  expect("a suppressed recipient is not written to", outcome.ok && !markedSent(calls));
  expectEqual(
    "and the skip names the reason",
    (outcome as { result: Record<string, unknown> }).result.skipped,
    "suppressed",
  );
  expect(
    "the refusal is recorded against the message, not only in the job log",
    calls.some(
      (c) =>
        c.table === "messages" &&
        c.verb === "update" &&
        /suppression list/.test(String((c.payload as { error?: string })?.error)),
    ),
  );
  expect(
    "and a failed event goes on the timeline",
    calls.some((c) => c.table === "message_events" && c.verb === "insert"),
  );
  setAdminClientForTests(null);
}

console.log("\nsend_message — OUT-01: the cap that existed and was never asked");
{
  /* The gap this closes. `can_contact` covers five refusals; the handler used
     to call `is_suppressed`, which is one of them. A two-day cadence was
     configurable, documented, tested in SQL — and unenforced by the only code
     that sends mail. */
  const { ctx, calls } = sendContext(sendable(), {
    "rpc:can_contact": {
      data: [{ allowed: false, reason: "too_soon", detail: { minDays: 2 } }],
      error: null,
    },
  });
  const outcome = await sendMessage(ctx);

  expect("a contact inside the cadence window is not written to", !markedSent(calls));
  const w = waited(calls, /every 2 days/);
  expect(
    "PANEL-302: 'too soon' becomes 'fine' on its own, so it waits rather than fails",
    outcome.ok && w.deferred,
    JSON.stringify(outcome),
  );
  expect(
    "and writes no `error`, which would strand an approved message for good",
    w.noError,
    JSON.stringify(calls.filter((c) => c.table === "messages").map((c) => c.payload)),
  );
  expect("the wait names the setting rather than a code", w.says);
  setAdminClientForTests(null);
}

{
  /* PANEL-302: where the wait ends. A cadence wait ends when the cadence
     does, a daily ceiling at the next UTC midnight; neither burns retries. */
  const now = new Date("2026-11-20T10:00:00Z");
  const cadence = contactAllowedAfter("too_soon", { lastSentAt: "2026-11-19T09:00:00Z", minDays: 2 }, now);
  expect(
    "a cadence wait ends just after the last send plus the cadence",
    cadence.toISOString() === "2026-11-21T09:01:00.000Z",
    cadence.toISOString(),
  );
  const daily = contactAllowedAfter("org_daily_cap", { sentToday: 200, cap: 200 }, now);
  expect(
    "a daily-ceiling wait ends just after the next UTC midnight",
    daily.toISOString() === "2026-11-21T00:01:00.000Z",
    daily.toISOString(),
  );
  const unreadable = contactAllowedAfter("unavailable", undefined, now);
  expect(
    "an unreadable check waits a short while, and does not fail open",
    unreadable.getTime() - now.getTime() === 15 * 60_000,
  );
  const stale = contactAllowedAfter("too_soon", { lastSentAt: "2026-01-01T00:00:00Z", minDays: 2 }, now);
  expect("a cadence already over falls back to an hour, never the past", stale.getTime() > now.getTime());
}

{
  // Erasure's whole point: the plaintext address is gone, only the hash
  // remains, and `is_suppressed` therefore finds nothing.
  const { ctx, calls } = sendContext(sendable(), {
    "rpc:can_contact": {
      data: [{ allowed: false, reason: "org_daily_cap", detail: { sentToday: 200, cap: 200 } }],
      error: null,
    },
  });
  const outcome = await sendMessage(ctx);
  const w = waited(calls, /daily ceiling/);
  expect("an org at its daily ceiling sends nothing further", !markedSent(calls));
  expect(
    "and the message waits for tomorrow instead of being stranded (PANEL-302)",
    outcome.ok && w.deferred && w.noError && w.says,
    JSON.stringify(outcome),
  );
  setAdminClientForTests(null);
}

{
  /* Every other quota in this codebase fails open, and is right to. This one
     must not: the cost of being wrong is an email to somebody who asked never
     to hear from us, and it cannot be recalled. */
  const { ctx, calls } = sendContext(sendable(), {
    "rpc:can_contact": { data: null, error: { message: "function does not exist" } },
  });
  const outcome = await sendMessage(ctx);
  expect(
    "a safety check that cannot be read fails CLOSED, unlike every budget in this codebase",
    !markedSent(calls) && !calls.some((c) => c.verb === "rpc" && c.table === "claim_mailbox_send"),
    JSON.stringify(outcome),
  );
  expect(
    "closed means waiting and asking again, not stranded (PANEL-302)",
    waited(calls, /did not pass/).deferred && waited(calls, /did not pass/).noError,
  );
  setAdminClientForTests(null);
}

{
  /* Order matters as much as presence. The safety check has to come before the
     mailbox allowance is claimed, or a refused message still consumes one of
     the day's sends from a limit somebody is paying for.

     The send itself needs a provider and a token, so these tests stop at the
     mailbox; `record_contact_send` after a successful send is covered by
     `0017`'s own suite, which can run the counter for real. */
  const { ctx, calls } = sendContext(sendable(), {
    /* Stopped at the allowance on purpose. Letting this run on would reach
       `provider.send`, which is a real HTTP request to a mail API — a test
       that tries to send mail is not a test. */
    "rpc:claim_mailbox_send": { data: false, error: null },
  });
  await sendMessage(ctx);
  const rpcs = calls.filter((c) => c.verb === "rpc").map((c) => c.table);
  expect(
    "the contact-safety check runs before the mailbox allowance is claimed",
    rpcs.indexOf("can_contact") >= 0 &&
      rpcs.indexOf("can_contact") < rpcs.indexOf("claim_mailbox_send"),
    JSON.stringify(rpcs),
  );
  setAdminClientForTests(null);
}

console.log("\nsend_message — one message per address in flight (OUT-013)");

for (const [name, lane] of [
  ["held by another message", { data: false, error: null }],
  ["unreadable", { data: null, error: { message: "boom" } }],
] as const) {
  const { ctx, calls } = sendContext(sendable(), { "rpc:claim_contact_lane": lane });
  const outcome = await sendMessage(ctx);
  expect(`a lane ${name} waits rather than sends`, deferred(outcome, calls, "address_busy"), outcome);
  expect(
    "and says why, for the inbox (OUT-014)",
    calls.some((c) => c.table === "messages" && c.verb === "update" &&
      String((c.payload as { wait_reason?: string })?.wait_reason ?? "").includes("this address")),
  );
  expect(
    "and spends none of the mailbox's allowance",
    !calls.some((c) => c.verb === "rpc" && c.table === "claim_mailbox_send"),
  );
  setAdminClientForTests(null);
}

console.log("\nsend_message — the allowance is claimed before the send, not after");

{
  const { ctx, calls } = sendContext(sendable(), {
    "rpc:claim_mailbox_send": { data: false, error: null },
  });
  const outcome = await sendMessage(ctx);

  expect("a mailbox out of allowance does not send", !markedSent(calls));
  /* DB-101: a wait, not a failure — it costs no retry and waits for the reset. */
  const waited = calls.find((c) => c.table === "messages" && c.verb === "update" && (c.payload as { not_before?: string })?.not_before);
  const until = new Date(String((waited?.payload as { not_before?: string })?.not_before));
  expect(
    "and it waits until the allowance resets at the next UTC midnight",
    outcome.ok && until.getUTCHours() === 0 && until.getTime() > Date.now(),
    waited?.payload,
  );
  setAdminClientForTests(null);
}

{
  const { dailyCap, isRevokedGrant } = await import("../../src/mailbox/index.ts");
  const now = new Date("2026-11-10T12:00:00Z");
  expectEqual("a warm mailbox's cap is its limit", dailyCap({ daily_limit: 50 }, now), 50);
  expectEqual("on its first day, a warming mailbox's cap is 10", dailyCap({ daily_limit: 50, warmup_started_at: "2026-11-10T08:00:00Z" }, now), 10);
  expectEqual("three days in, 25", dailyCap({ daily_limit: 50, warmup_started_at: "2026-11-07T08:00:00Z" }, now), 25);
  expect("a 400 from the token endpoint is a revoked grant", isRevokedGrant("Google refused the token request (400): invalid_grant"));
  expect("a 503 is not", !isRevokedGrant("Google refused the token request (503): backend error"));
  expect("nor is a timeout", !isRevokedGrant("The operation was aborted due to timeout"));
}

{
  /* OUT-011: a person approved the held draft; the gate does not hold it again. */
  const message = sendable({
    enrollment_id: "99999999-9999-9999-9999-999999999999",
    approved_by: "12121212-1212-1212-1212-121212121212",
    body_text: "Hi {{first_name}}",
  });
  const { ctx, calls } = sendContext(message, {
    "select:messages": (r: Recorded) => (r.filters.some(([f]) => f === "eq:id") ? { data: message, error: null } : { data: [], error: null }),
    "select:enrollments": liveEnrollment({ campaign: { autonomy_level: 3 } }),
  });
  const original = gmail.send;
  gmail.send = async () => ({ providerMessageId: "g-approved", providerThreadId: "t", messageIdHeader: "<a@b>" });
  const outcome = await sendMessage(ctx);
  gmail.send = original;
  expect("a draft a person approved is sent as approved, even at autonomy 3", outcome.ok && markedSent(calls));
  setAdminClientForTests(null);
}

console.log("\nsend_message — OUT-201: a withdrawn sequence's approved mail does not go");

{
  const ENROLLMENT = "99999999-9999-9999-9999-999999999999";
  const wrote = (calls: Recorded[], key: string) =>
    calls.find((c) => c.table === "messages" && c.verb === "update" && key in ((c.payload as object) ?? {}));

  const withdrawn: [string, ReturnType<typeof liveEnrollment>, string][] = [
    ["a stopped sequence", liveEnrollment({ status: "stopped", parked_reason: "Stopped by a person." }), "stopped"],
    ["a removed enrollment", liveEnrollment({ deleted_at: "2026-11-14T09:00:00Z" }), "removed"],
    ["an archived campaign", liveEnrollment({ campaign: { status: "archived" } }), "archived"],
    ["a deleted campaign", liveEnrollment({ campaign: { deleted_at: "2026-11-14T09:00:00Z" } }), "archived"],
    ["a won deal", liveEnrollment({ opportunity: { status: "won" } }), "won"],
    ["a lost deal", liveEnrollment({ opportunity: { status: "lost" } }), "lost"],
    ["an opportunity closed as not a fit", liveEnrollment({ opportunity: { status: "archived" } }), "archived"],
    ["a removed opportunity", liveEnrollment({ opportunity: { deleted_at: "2026-11-14T09:00:00Z" } }), "removed"],
    ["a company met through the Exchange", liveEnrollment({ opportunity: { origin: "engine", companies: { origin: "exchange" } } as never }), "Exchange"],
    ["an Exchange opportunity", liveEnrollment({ opportunity: { origin: "exchange" } as never }), "Exchange"],
    ["a sequence that no longer exists", { data: null, error: null } as never, "no longer exists"],
  ];
  for (const [label, enrollment, says] of withdrawn) {
    const message = sendable({ enrollment_id: ENROLLMENT, approved_by: "12121212-1212-1212-1212-121212121212" });
    const { ctx, calls } = sendContext(message, { "select:enrollments": enrollment });
    const outcome = await sendMessage(ctx);
    const error = String((wrote(calls, "error")?.payload as { error?: string } | undefined)?.error ?? "");
    expect(`${label}: an approved message is not sent`, !markedSent(calls) && !calls.some((c) => c.table === "claim_mailbox_send"));
    expect(`${label}: it is closed out, not retried`, outcome.ok && (outcome as { result: { skipped?: string } }).result.skipped === "withdrawn");
    expect(`${label}: the inbox says why ("${says}")`, error.startsWith("Not sent:") && error.includes(says));
    setAdminClientForTests(null);
  }

  {
    const message = sendable({ enrollment_id: ENROLLMENT });
    const { ctx, calls } = sendContext(message, { "select:organizations": { data: null, error: null } });
    const outcome = await sendMessage(ctx);
    expect("a deleted workspace's message is not sent", outcome.ok && !markedSent(calls));
    expect("and says the workspace was deleted", String((wrote(calls, "error")?.payload as { error?: string })?.error).includes("workspace was deleted"));
    setAdminClientForTests(null);
  }

  const held: [string, ReturnType<typeof liveEnrollment>][] = [
    ["a paused sequence", liveEnrollment({ status: "paused" })],
    ["a parked sequence", liveEnrollment({ status: "parked", parked_reason: "The campaign is not running." })],
    ["a paused campaign", liveEnrollment({ campaign: { status: "paused" } })],
    ["an unreadable sequence", { data: null, error: { message: "connection reset" } } as never],
  ];
  for (const [label, enrollment] of held) {
    const { ctx, calls } = sendContext(sendable({ enrollment_id: ENROLLMENT }), { "select:enrollments": enrollment });
    const outcome = await sendMessage(ctx);
    expect(`${label}: nothing is sent`, !markedSent(calls));
    expect(`${label}: it waits, so resuming sends it`, outcome.ok && Boolean(wrote(calls, "not_before")) && !wrote(calls, "error"));
    setAdminClientForTests(null);
  }
}

console.log("\nsend_message — PROD-201: a database without 0050 fails loudly");

{
  const { ctx, calls } = sendContext(sendable(), {
    "rpc:claim_contact_lane": { data: null, error: { code: "PGRST202", message: "Could not find the function public.claim_contact_lane" } },
  });
  const outcome = await sendMessage(ctx);
  expect("the send fails rather than deferring as 'address busy'", !outcome.ok && /migration 0050/.test(String((outcome as { error?: string }).error)));
  expect("nothing is sent and no wait is recorded", !markedSent(calls) && !calls.some((c) => c.verb === "update" && "not_before" in ((c.payload as object) ?? {})));
  expect("and the message is not stranded with an error", !calls.some((c) => c.table === "messages" && c.verb === "update" && "error" in ((c.payload as object) ?? {})));
  setAdminClientForTests(null);
}

{
  const { ctx, calls } = sendContext(sendable(), {
    "rpc:claim_contact_lane": { data: false, error: null },
  });
  const outcome = await sendMessage(ctx);
  expect("a busy lane still waits (it is not a missing migration)", outcome.ok && !markedSent(calls));
  setAdminClientForTests(null);
}

console.log("\nsend_message — PROD-207: the kill switch");

{
  const { ctx, calls } = sendContext(sendable(), {
    "rpc:platform_paused": { data: "Bounce spike, investigating", error: null },
  });
  const outcome = await sendMessage(ctx);
  const wait = calls.find((c) => c.table === "messages" && c.verb === "update" && "wait_reason" in ((c.payload as object) ?? {}));
  expect("a paused deployment sends nothing", outcome.ok && !markedSent(calls));
  expect("it waits instead, so lifting the pause sends it", calls.some((c) => c.verb === "update" && "not_before" in ((c.payload as object) ?? {})));
  expect("and the inbox shows the operator's reason", String((wait?.payload as { wait_reason?: string })?.wait_reason).includes("Bounce spike"));
  expect("nothing was claimed or spent", !calls.some((c) => c.table === "claim_mailbox_send" || c.table === "can_contact"));
  setAdminClientForTests(null);
}

{
  const { ctx, calls } = sendContext(sendable(), {
    "rpc:platform_paused": { data: null, error: { code: "08006", message: "connection failure" } },
  });
  const outcome = await sendMessage(ctx);
  expect("an unreadable pause state also waits (sends fail closed)", outcome.ok && !markedSent(calls));
  setAdminClientForTests(null);
}

{
  const { ctx, calls } = sendContext(sendable(), {
    "rpc:platform_paused": { data: null, error: { code: "PGRST202", message: "not found" } },
  });
  const original = gmail.send;
  gmail.send = async () => ({ providerMessageId: "g-nopause", providerThreadId: "t", messageIdHeader: "<n@b>" });
  const outcome = await sendMessage(ctx);
  gmail.send = original;
  expect("before 0053 (no switch at all) sending is not blocked", outcome.ok && markedSent(calls));
  setAdminClientForTests(null);
}

console.log("\nsend_message — §78: sent means sent, and failed means failed");

{
  const original = gmail.send;
  const { ctx, calls } = sendContext(sendable());
  gmail.send = async () => ({
    providerMessageId: "gmail-abc",
    providerThreadId: "thread-abc",
    messageIdHeader: "<abc@mail.gmail.com>",
  });

  const outcome = await sendMessage(ctx);
  gmail.send = original;

  expect("a successful send reports the provider id", outcome.ok);

  const written = calls.find(
    (c) => c.table === "messages" && c.verb === "update" && (c.payload as { sent_at?: string })?.sent_at,
  )?.payload as Record<string, unknown> | undefined;

  expect("the send time is written", Boolean(written?.sent_at));
  expectEqual(
    "together with the provider id, because 0004's CHECK refuses one without the other",
    written?.provider_message_id,
    "gmail-abc",
  );
  expectEqual(
    "and the Message-ID, so a reply can be matched back to it",
    written?.message_id_header,
    "<abc@mail.gmail.com>",
  );
  setAdminClientForTests(null);
}

{
  const original = gmail.send;
  const { ctx, calls } = sendContext(sendable());
  gmail.send = async () => {
    throw new Error("550 mailbox unavailable");
  };

  const outcome = await sendMessage(ctx);
  gmail.send = original;

  expect("a provider failure fails the job", !outcome.ok);
  expect(
    "and the message is NOT marked sent — §78, the rule this handler exists for",
    !markedSent(calls),
  );
  expect(
    "the reason is on the row, where the person reading the inbox will find it",
    calls.some(
      (c) =>
        c.table === "messages" &&
        c.verb === "update" &&
        /550 mailbox unavailable/.test(String((c.payload as { error?: string })?.error)),
    ),
  );
  expect(
    "and a failed event is recorded rather than a delivered one",
    calls.some(
      (c) =>
        c.table === "message_events" &&
        c.verb === "insert" &&
        /* `scope.insert` normalises to a list, so the row is payload[0]. */
        (c.payload as { kind?: string }[])?.[0]?.kind === "failed",
    ),
  );
  setAdminClientForTests(null);
}

console.log("\nsend_message — OUT-001: at most once");

{
  let sends = 0;
  const original = gmail.send;
  gmail.send = async () => {
    sends++;
    return { providerMessageId: "x", providerThreadId: "t", messageIdHeader: "<x@y>" };
  };

  // An earlier run claimed the send and never recorded it.
  const earlier = sendContext({ ...sendable(), send_attempted_at: new Date().toISOString() });
  const stale = await sendMessage(earlier.ctx);
  expect("a send an earlier run started is never re-sent", sends === 0 && !stale.ok);
  expect(
    "and it is left for a person, not retried",
    (stale as { permanent?: boolean }).permanent === true,
  );
  expect(
    "and the message says so, which takes it out of the send sweep (OUT-201)",
    earlier.calls.some(
      (c) => c.table === "messages" && c.verb === "update" && /Delivery unknown/.test(String((c.payload as { error?: unknown })?.error ?? "")),
    ),
  );
  setAdminClientForTests(null);

  // Two runs at once: the one that loses the claim does not send.
  const lost = sendContext(sendable(), { "update:messages": { data: [], error: null } });
  const outcome = await sendMessage(lost.ctx);
  expect("a run that loses the claim does not send", sends === 0 && outcome.ok);
  setAdminClientForTests(null);

  gmail.send = original;
}

{
  const original = gmail.send;
  gmail.send = async () => {
    throw new Error("The operation was aborted due to timeout");
  };
  const { ctx, calls } = sendContext(sendable());
  const outcome = await sendMessage(ctx);
  gmail.send = original;

  expect(
    "an ambiguous failure is not retried — it may have been delivered",
    !outcome.ok && (outcome as { permanent?: boolean }).permanent === true,
  );
  expect(
    "and the claim is kept",
    !calls.some(
      (c) =>
        c.table === "messages" &&
        c.verb === "update" &&
        (c.payload as { send_attempted_at?: unknown })?.send_attempted_at === null,
    ),
  );
  setAdminClientForTests(null);
}

{
  const original = gmail.send;
  gmail.send = async () => {
    throw new Error("Gmail 400 on /gmail/v1/users/me/messages/send: invalid To header");
  };
  const { ctx, calls } = sendContext(sendable());
  const outcome = await sendMessage(ctx);
  gmail.send = original;

  expect(
    "a definite refusal releases the claim so the send can be retried",
    !outcome.ok &&
      (outcome as { permanent?: boolean }).permanent !== true &&
      calls.some(
        (c) =>
          c.table === "messages" &&
          c.verb === "update" &&
          (c.payload as { send_attempted_at?: unknown })?.send_attempted_at === null,
      ),
  );
  setAdminClientForTests(null);
}

console.log("\nsend_message — a message with no way to opt out does not leave");

/**
 * `NEXT_PUBLIC_SITE_URL` is what turns an unsubscribe token into a URL. With
 * it unset, `withFooter` returned the body unchanged and the provider was
 * handed a null `List-Unsubscribe` — so the message went out with no opt-out
 * mechanism of any kind, which is the one failure in this handler that breaks
 * a law rather than a deliverability guideline.
 *
 * Unset here rather than in the handler's own test fixture, because the point
 * is the *deployment* being misconfigured: the message row is perfectly
 * valid, and every earlier check passes.
 */
{
  const saved = process.env.NEXT_PUBLIC_SITE_URL;
  delete process.env.NEXT_PUBLIC_SITE_URL;

  const { ctx, calls } = sendContext(sendable());
  const outcome = await sendMessage(ctx);

  process.env.NEXT_PUBLIC_SITE_URL = saved;
  const w = waited(calls, /NEXT_PUBLIC_SITE_URL/);

  expect("nothing was marked sent", !markedSent(calls));
  expect(
    "the allowance is not claimed, so a misconfiguration costs no send budget",
    !calls.some((c) => c.verb === "rpc" && c.table === "claim_mailbox_send"),
  );
  expect("the wait names the setting rather than the symptom", w.says);
  expect(
    "and it is a wait, not an `error`, so setting the variable releases it (PANEL-302)",
    outcome.ok && w.deferred && w.noError,
    JSON.stringify(outcome),
  );
  setAdminClientForTests(null);
}

console.log("\nsend_message — a message with no sender address does not leave");

/**
 * CAN-SPAM §7704(a)(5) and CASL both require the sender's physical postal
 * address on every commercial message. The footer carried an unsubscribe
 * line and nothing else, and no column existed anywhere that could have held
 * an address — so this was not a template omission, it was a missing field.
 */
{
  const { ctx, calls } = sendContext(sendable(), {
    /* A workspace that has never filled the field in, which is every
       workspace that existed before `OrgComplianceSettings` did. */
    "select:organizations": { data: { settings: {} }, error: null },
  });
  const outcome = await sendMessage(ctx);
  const w = waited(calls, /Settings → Organisation/);

  expect("nothing was marked sent", !markedSent(calls));
  expect(
    "the allowance is not claimed either",
    !calls.some((c) => c.verb === "rpc" && c.table === "claim_mailbox_send"),
  );
  expect("the wait names the screen that fixes it, not the column", w.says);
  expect(
    "and adding the address releases it: a wait, not an `error` (PANEL-302)",
    outcome.ok && w.deferred && w.noError,
    JSON.stringify(outcome),
  );
  setAdminClientForTests(null);
}

{
  /* An address too short to be one is the same as no address. The floor is
     in `parseOrgProfile`, so the handler and the settings form cannot
     disagree about what counts as set. */
  const { ctx, calls } = sendContext(sendable(), {
    "select:organizations": {
      data: { settings: { compliance: { postalAddress: "London" } } },
      error: null,
    },
  });
  const outcome = await sendMessage(ctx);

  expect(
    "a one-word address is not accepted as one",
    waited(calls, /postal address/).deferred,
    JSON.stringify(outcome),
  );
  expect("and nothing was sent", !markedSent(calls));
  setAdminClientForTests(null);
}

console.log("\nsend_message — what the recipient actually receives in the footer");

/**
 * The two elements every commercial message is required to carry, asserted
 * against what the provider was handed rather than against the helper that
 * builds it. `withFooter` being correct is not the same as it being called,
 * and the bug this replaces was precisely a correct helper reached with a
 * null argument.
 */
{
  const original = gmail.send;
  let sent: OutgoingMessage | null = null;
  gmail.send = async (_token, input) => {
    sent = input;
    return {
      providerMessageId: "gmail-footer",
      providerThreadId: null,
      messageIdHeader: "<footer@mail.gmail.com>",
    };
  };

  const { ctx } = sendContext(sendable());
  await sendMessage(ctx);
  gmail.send = original;

  const text = String((sent as OutgoingMessage | null)?.text ?? "");
  expect("the body is still there", /How are you gating custody today\?/.test(text));
  expect("the postal address is in the footer", /1 Example Street/.test(text));
  expect(
    "so is a link to the page that asks before unsubscribing",
    /huntloop\.test\/unsubscribe\//.test(text),
  );
  expect(
    "and the header carries the one-click endpoint, which is a different URL",
    /huntloop\.test\/api\/unsubscribe\//.test(
      String((sent as OutgoingMessage | null)?.unsubscribeUrl ?? ""),
    ),
  );
  setAdminClientForTests(null);
}

{
  /* The HTML part gets the same footer. Nothing writes `body_html` today,
     so this covers a path that is latent rather than live — which is the
     only reason the omission was not already a shipped defect. */
  const original = gmail.send;
  let sent: OutgoingMessage | null = null;
  gmail.send = async (_token, input) => {
    sent = input;
    return {
      providerMessageId: "gmail-html",
      providerThreadId: null,
      messageIdHeader: "<html@mail.gmail.com>",
    };
  };

  const { ctx } = sendContext(sendable({ body_html: "<p>Hello &amp; welcome</p>" }));
  await sendMessage(ctx);
  gmail.send = original;

  const html = String((sent as OutgoingMessage | null)?.html ?? "");
  expect("the HTML body survives", /<p>Hello &amp; welcome<\/p>/.test(html));
  expect("the HTML part carries the address too", /1 Example Street/.test(html));
  expect("and an unsubscribe anchor", /<a href="[^"]*\/unsubscribe\/[^"]*">/.test(html));
  expect(
    "the address's newlines become line breaks rather than collapsing",
    /Acme Ltd<br>1 Example Street/.test(html),
  );
  setAdminClientForTests(null);
}

console.log("\nsend_message — the plan's email allowance, which was metered and never checked");

/**
 * `emails` is one of five quotas `plans.limits` defines and the pricing page
 * prices. It was incremented after every successful send and checked
 * nowhere, so a Free workspace — allowance zero — was counted and never
 * stopped.
 */
{
  const { ctx, calls } = sendContext(sendable(), {
    "rpc:check_quota_internal": {
      data: [{ allowed: false, used: 5000, quota: 5000 }],
      error: null,
    },
  });
  const outcome = await sendMessage(ctx);
  const w = waited(calls, /5000 of its 5000 emails/);

  expect("a workspace over its email quota does not send", !markedSent(calls));
  expect(
    "the allowance is not claimed, so the cap costs no mailbox budget",
    !calls.some((c) => c.verb === "rpc" && c.table === "claim_mailbox_send"),
  );
  expect("the wait quotes the numbers rather than saying 'quota exceeded'", w.says);
  expect(
    "PANEL-302: it waits and is asked again, so it sends when the allowance resets — " +
      "the copy's promise, which an `error` made false",
    outcome.ok && w.deferred && w.noError,
    JSON.stringify(outcome),
  );
  setAdminClientForTests(null);
}

{
  /* Fails open, like every other quota in this codebase. A quota that cannot
     be read must not stop a customer's outreach — the cost of failing open
     is a reconciliation and it is ours. */
  const original = gmail.send;
  gmail.send = async () => ({
    providerMessageId: "gmail-open",
    providerThreadId: null,
    messageIdHeader: "<open@mail.gmail.com>",
  });
  const { ctx, calls } = sendContext(sendable(), {
    "rpc:check_quota_internal": { data: null, error: { message: "relation missing" } },
  });
  const outcome = await sendMessage(ctx);
  gmail.send = original;

  expect("an unreadable quota does not stop the send", outcome.ok);
  expect("and the message goes", markedSent(calls));
  setAdminClientForTests(null);
}

/* ── P0: email safety without a model ────────────────────────────────────── */

console.log("\npreclassify — an opt-out or a bounce is honoured with no model");

{
  const at = (text: string, extra: Partial<{ from: string; subject: string }> = {}) =>
    preclassify({ from: extra.from ?? "dana@acme.co", subject: extra.subject ?? "Re: hello", text });

  expectEqual("\"please remove me\" is an unsubscribe", at("Please remove me from your list.")?.label, "unsubscribe");
  expectEqual("a bare \"STOP\" is an unsubscribe", at("STOP")?.label, "unsubscribe");
  expectEqual("\"stop emailing me\" is an unsubscribe", at("Stop emailing me, thanks")?.label, "unsubscribe");
  expectEqual("mailer-daemon is a bounce", at("Delivery failed", { from: "mailer-daemon@googlemail.com" })?.label, "bounce");
  expectEqual("an \"Undeliverable:\" subject is a bounce", at("…", { subject: "Undeliverable: hello" })?.label, "bounce");
  expectEqual("an ordinary reply is left to the model", at("Sounds interesting, can we talk Tuesday?"), null);
  expectEqual(
    "our own footer quoted back does not count as theirs",
    at("Sure, send the deck.\n\nOn Mon, Dana wrote:\n> If you'd rather not hear from us: unsubscribe"),
    null,
  );
  expectEqual("\"don't stop\" in passing is not an opt-out", at("Don't stop at the pilot, we want the full rollout."), null);
  expectEqual("\"Please unsubscribe me\" is an opt-out", at("Please unsubscribe me")?.label, "unsubscribe");
  expectEqual(
    "an auto-reply whose footer says \"unsubscribe\" is not",
    at(
      "Thanks for your email. I am travelling until Monday with limited access and will reply when I am back. " +
        "For anything urgent please contact our support desk at the usual address. " +
        "You received this because you are subscribed to our updates; unsubscribe at any time from the preferences page.",
    ),
    null,
  );
}

console.log("\npre-send gate — what an unreviewed message may not carry");

{
  const base = { subject: "Quick question", body: "Saw the hiring post. Worth a chat?", allowedDomains: ["huntloop.test", "acme.co"] };
  expectEqual("a clean message passes", checkContent(base).length, 0);
  expect("an unfilled {{first_name}} is caught", checkContent({ ...base, body: "Hi {{first_name}}," }).length > 0);
  expect("an unfilled [First Name] is caught", checkContent({ ...base, body: "Hi [First Name]," }).length > 0);
  expect(
    "a link to a domain nobody chose is caught",
    checkContent({ ...base, body: "See https://evil.example/x" }).some((i) => i.includes("evil.example")),
  );
  expectEqual("a link to the recipient's own site passes", checkContent({ ...base, body: "Your page https://www.acme.co/careers" }).length, 0);
  expectEqual("a subdomain of an allowed domain passes", checkContent({ ...base, body: "https://cal.huntloop.test/dana" }).length, 0);
  expect("an empty subject is caught", checkContent({ ...base, subject: " " }).length > 0);
  expect("a reply-to address on a domain nobody chose is caught", checkContent({ ...base, body: "Write to billing@evil.example" }).length > 0);
  expectEqual("the recipient's own address is fine", checkContent({ ...base, body: "Or reply to dana@acme.co" }).length, 0);
  expectEqual("bareDomain strips scheme, www, port and path", bareDomain("https://WWW.Acme.co:443/x"), "acme.co");
  expectEqual("bareDomain reads an address", bareDomain("dana@acme.co"), "acme.co");
}

/** `select:messages` answered by which query it is, so the send-time checks can be fed. */
function messagesBy(
  message: Record<string, unknown>,
  feeds: { lastOut?: unknown[]; replies?: unknown[]; sent?: unknown[]; inbound?: unknown[] } = {},
) {
  return (r: Recorded) => {
    const has = (k: string, v?: unknown) => r.filters.some(([f, x]) => f === k && (v === undefined || x === v));
    if (has("eq:id")) return { data: message, error: null };
    if (has("eq:to_email") && has("eq:direction", "outbound")) return { data: feeds.lastOut ?? [], error: null };
    if (has("eq:from_email") && has("eq:direction", "inbound")) return { data: feeds.replies ?? [], error: null };
    if (has("eq:mailbox_id") && has("eq:direction", "outbound")) return { data: feeds.sent ?? [], error: null };
    if (has("eq:mailbox_id") && has("eq:direction", "inbound")) return { data: feeds.inbound ?? [], error: null };
    return { data: [], error: null };
  };
}

/* The sends below that should go, go through a stubbed provider. */
const originalSend = gmail.send;
gmail.send = async () => ({
  providerMessageId: "gmail-p0",
  providerThreadId: "thread-p0",
  messageIdHeader: "<p0@mail.gmail.com>",
});

console.log("\nsend_message — P0-2: a reply nobody has read holds the sequence");

{
  const message = sendable({ enrollment_id: "99999999-9999-9999-9999-999999999999" });
  const { ctx, calls } = sendContext(message, {
    "select:messages": messagesBy(message, {
      lastOut: [{ sent_at: "2026-10-01T10:00:00Z" }],
      replies: [{ id: INBOUND_ID }],
    }),
    "select:message_events": { data: [], error: null },
  });
  const outcome = await sendMessage(ctx);
  expect("an unclassified reply since the last send stops the next step", !markedSent(calls));
  expect(
    "it goes back to the approval queue with the reason",
    calls.some(
      (c) =>
        c.table === "messages" &&
        c.verb === "update" &&
        (c.payload as { scheduled_at?: unknown })?.scheduled_at === null &&
        String((c.payload as { error?: string })?.error).includes("written back"),
    ),
  );
  expect("and the job succeeds rather than burning retries", outcome.ok);
  setAdminClientForTests(null);
}

{
  /* A person read the reply and approved the step after it arrived. */
  const message = sendable({
    enrollment_id: "99999999-9999-9999-9999-999999999999",
    approved_by: "12121212-1212-1212-1212-121212121212",
    scheduled_at: new Date().toISOString(),
  });
  const { ctx, calls } = sendContext(message, {
    "select:messages": (r: Recorded) => {
      if (r.filters.some(([f, v]) => f === "gt:sent_at" && new Date(String(v)).getTime() > Date.now() - 60_000)) {
        return { data: [], error: null };
      }
      return messagesBy(message, { replies: [{ id: INBOUND_ID }] })(r);
    },
    "select:message_events": { data: [], error: null },
  });
  const outcome = await sendMessage(ctx);
  expect("a step approved after the reply arrived goes", outcome.ok && markedSent(calls));
  setAdminClientForTests(null);
}

{
  const message = sendable({ enrollment_id: "99999999-9999-9999-9999-999999999999" });
  const { ctx, calls } = sendContext(message, {
    "select:messages": messagesBy(message, { replies: [{ id: INBOUND_ID }] }),
    "select:message_events": { data: [{ message_id: INBOUND_ID, payload: { label: "out_of_office" } }], error: null },
  });
  const outcome = await sendMessage(ctx);
  expect("an out-of-office does not hold it", outcome.ok && markedSent(calls));
  setAdminClientForTests(null);
}

{
  const message = sendable({ enrollment_id: null });
  const { ctx, calls } = sendContext(message, {
    "select:messages": messagesBy(message, { replies: [{ id: INBOUND_ID }] }),
  });
  const outcome = await sendMessage(ctx);
  expect("an answer written from the inbox is not held by the reply it answers", outcome.ok && markedSent(calls));
  setAdminClientForTests(null);
}

console.log("\nsend_message — P0-5: a bouncing mailbox stops");

{
  const message = sendable();
  const sent = Array.from({ length: 20 }, (_, i) => ({ id: `s${i}` }));
  const inbound = [{ id: "b1" }, { id: "b2" }, { id: "b3" }];
  const { ctx, calls } = sendContext(message, {
    "select:messages": messagesBy(message, { sent, inbound }),
    "select:message_events": { data: inbound.map((m) => ({ message_id: m.id })), error: null },
  });
  const outcome = await sendMessage(ctx);
  expect("3 bounces in 20 sends pauses the mailbox", !markedSent(calls));
  expect(
    "the message waits on not_before rather than failing",
    outcome.ok && calls.some((c) => c.table === "messages" && c.verb === "update" && Boolean((c.payload as { not_before?: string })?.not_before)),
  );
  expect(
    "and the mailbox carries the reason",
    calls.some((c) => c.table === "mailboxes" && c.verb === "update" && String((c.payload as { last_error?: string })?.last_error).includes("bounced")),
  );
  setAdminClientForTests(null);
}

{
  const message = sendable();
  const sent = Array.from({ length: 5 }, (_, i) => ({ id: `s${i}` }));
  const { ctx, calls } = sendContext(message, {
    "select:messages": messagesBy(message, { sent, inbound: [{ id: "b1" }] }),
    "select:message_events": { data: [{ message_id: "b1" }], error: null },
  });
  const outcome = await sendMessage(ctx);
  expect("one bounce in five sends is too few to judge", outcome.ok && markedSent(calls));
  setAdminClientForTests(null);
}

console.log("\nsend_message — P0-4: an unreviewed message gets the reviewer's look");

{
  const message = sendable({ enrollment_id: "99999999-9999-9999-9999-999999999999", body_text: "Hi {{first_name}}, see https://evil.example" });
  const { ctx, calls } = sendContext(message, {
    "select:messages": messagesBy(message),
    "select:enrollments": liveEnrollment({ campaign: { autonomy_level: 3 } }),
  });
  const outcome = await sendMessage(ctx);
  expect("at autonomy 3 a bad draft is not sent", outcome.ok && !markedSent(calls));
  expect(
    "it goes back to the approval queue",
    calls.some((c) => c.table === "messages" && c.verb === "update" && (c.payload as { scheduled_at?: unknown })?.scheduled_at === null),
  );
  setAdminClientForTests(null);
}

{
  const message = sendable({ enrollment_id: "99999999-9999-9999-9999-999999999999", body_text: "Hi {{first_name}}" });
  const { ctx, calls } = sendContext(message, {
    "select:messages": messagesBy(message),
    "select:enrollments": liveEnrollment({ campaign: { autonomy_level: 1 } }),
  });
  const outcome = await sendMessage(ctx);
  expect("at autonomy 1 a person approved it, and it goes as approved", outcome.ok && markedSent(calls));
  setAdminClientForTests(null);
}

console.log("\nsend_message — autonomy 2: the opening needs a person, follow-ups do not");
for (const [label, level, opening, body, approver, sends] of [
  ["an opening nobody approved is held", 2, null, "Hello", null, false],
  ["a follow-up to an approved opening is sent", 2, { id: "m0" }, "Hello", null, true],
  ["a bad follow-up is still held", 2, { id: "m0" }, "Hi {{first_name}}", null, false],
  ["an approved opening is sent", 2, null, "Hello", "12121212-1212-1212-1212-121212121212", true],
  ["at autonomy 3 the opening is sent", 3, null, "Hello", null, true],
] as const) {
  const message = sendable({ enrollment_id: "99999999-9999-9999-9999-999999999999", body_text: body, approved_by: approver });
  const other = messagesBy(message);
  const { ctx, calls } = sendContext(message, {
    "select:messages": (r: Recorded) => (r.filters.some(([f]) => f === "not:approved_by") ? { data: opening, error: null } : other(r)),
    "select:enrollments": liveEnrollment({ campaign: { autonomy_level: level } }),
  });
  const outcome = await sendMessage(ctx);
  expect(label, outcome.ok && markedSent(calls) === sends, JSON.stringify(outcome));
  if (!sends) {
    expect(
      `${label}: back in the approval queue`,
      calls.some((c) => c.table === "messages" && c.verb === "update" && (c.payload as { scheduled_at?: unknown })?.scheduled_at === null),
    );
  }
  setAdminClientForTests(null);
}
{
  const message = sendable({ enrollment_id: "99999999-9999-9999-9999-999999999999" });
  const other = messagesBy(message);
  const { ctx, calls } = sendContext(message, {
    "select:messages": (r: Recorded) => (r.filters.some(([f]) => f === "not:approved_by") ? { data: null, error: { message: "timeout" } } : other(r)),
    "select:enrollments": liveEnrollment({ campaign: { autonomy_level: 2 } }),
  });
  let threw = false;
  await sendMessage(ctx).catch(() => (threw = true));
  expect("an approval that cannot be read sends nothing, and the job retries", threw && !markedSent(calls));
  setAdminClientForTests(null);
}

console.log("\nsend_message — P1: domain, a fresh inbox read, and the recipient's working day");

const ENROLLED = "99999999-9999-9999-9999-999999999999";

{
  const message = sendable({ enrollment_id: ENROLLED });
  const { ctx, calls } = sendContext(message, {
    "select:messages": messagesBy(message),
    "select:mailboxes": { data: { ...connectedMailbox(), last_sync_at: new Date(Date.now() - 3 * 3600_000).toISOString() }, error: null },
  });
  expect("a sequence step waits for an inbox read less than 30 minutes old", deferred(await sendMessage(ctx), calls, "inbox_not_fresh"));
  setAdminClientForTests(null);
}

{
  const message = sendable({ enrollment_id: null });
  const { ctx, calls } = sendContext(message, {
    "select:messages": messagesBy(message),
    "select:mailboxes": { data: { ...connectedMailbox(), last_sync_at: null }, error: null },
  });
  const outcome = await sendMessage(ctx);
  expect("a reply from the inbox does not wait for a sync", outcome.ok && markedSent(calls));
  setAdminClientForTests(null);
}

{
  const message = sendable({ enrollment_id: ENROLLED });
  const { ctx, calls } = sendContext(message, {
    "select:messages": messagesBy(message),
    "select:mailboxes": {
      data: { ...connectedMailbox(), domain_status: "fail", domain_report: { problems: ["acme.test has no SPF record."] } },
      error: null,
    },
  });
  const outcome = await sendMessage(ctx);
  expect("a domain that failed its check sends no cold email", deferred(outcome, calls, "domain_not_ready"));
  expect(
    "and the mailbox says why",
    calls.some((c) => c.table === "mailboxes" && c.verb === "update" && String((c.payload as { last_error?: string })?.last_error).includes("SPF")),
  );
  setAdminClientForTests(null);
}

{
  /* Pick a country whose working day is not now, so the test holds at any hour. */
  const now = new Date();
  const candidates = ["JP", "US", "GB", "IN", "AU", "BR"];
  const closed = candidates.find((c) => !inBusinessHours(now, zoneForCountry(c)!));
  const open = candidates.find((c) => inBusinessHours(now, zoneForCountry(c)!));
  const OPP = "77777777-7777-7777-7777-777777777777";

  if (closed) {
    const message = sendable({ enrollment_id: ENROLLED, opportunity_id: OPP });
    const { ctx, calls } = sendContext(message, {
      "select:messages": messagesBy(message),
      "select:opportunities": { data: { companies: { country: closed } }, error: null },
    });
    expect(`outside ${closed}'s working day, a sequence step waits`, deferred(await sendMessage(ctx), calls, "outside_business_hours"));
    setAdminClientForTests(null);
  }
  if (open) {
    const message = sendable({ enrollment_id: ENROLLED, opportunity_id: OPP });
    const { ctx, calls } = sendContext(message, {
      "select:messages": messagesBy(message),
      "select:opportunities": { data: { companies: { country: open } }, error: null },
    });
    const outcome = await sendMessage(ctx);
    expect(`inside ${open}'s working day, it goes`, outcome.ok && markedSent(calls));
    setAdminClientForTests(null);
  }

  const message = sendable({ enrollment_id: ENROLLED, opportunity_id: OPP });
  const { ctx, calls } = sendContext(message, {
    "select:messages": messagesBy(message),
    "select:opportunities": { data: { companies: { country: "Atlantis" } }, error: null },
  });
  const outcome = await sendMessage(ctx);
  expect("an unknown country holds nothing", outcome.ok && markedSent(calls));
  setAdminClientForTests(null);
}

gmail.send = originalSend;

console.log("\nschedule_sends — JOB-202: workspaces take turns (0056)");

{
  const { client, calls } = fakeClient({
    "rpc:due_sends_fair": {
      data: [
        { id: "m-a1", org_id: ORG_A, scheduled_at: "2026-11-19T08:00:00Z" },
        { id: "m-b1", org_id: ORG_B, scheduled_at: "2026-11-19T09:00:00Z" },
      ],
      error: null,
    },
  });
  setAdminClientForTests(client);
  const outcome = await HANDLERS.schedule_sends({
    scope: OrgScope.global() as never,
    payload: {},
    job: { id: "j", org_id: null, job_name: "schedule_sends" } as never,
    now: new Date("2026-11-19T10:00:00Z"),
  });
  const rpc = calls.find((c) => c.verb === "rpc" && c.table === "due_sends_fair");
  expect("it asks the fair read, with the tick's own clock and the batch size", Boolean(rpc) &&
    (rpc!.payload as Record<string, unknown>).p_now === "2026-11-19T10:00:00.000Z" &&
    (rpc!.payload as Record<string, unknown>).p_limit === 50, JSON.stringify(rpc?.payload));
  expect("not the old oldest-first table read", !calls.some((c) => c.table === "messages" && c.verb === "select"));
  const inserts = calls.filter((c) => c.table === "job_executions" && c.verb === "insert");
  const orgs = inserts.map((c) => (c.payload as Record<string, unknown>).org_id);
  expect("each workspace's message is queued in its own workspace", outcome.ok && orgs.includes(ORG_A) && orgs.includes(ORG_B), JSON.stringify(orgs));
  setAdminClientForTests(null);
}

{
  const { client, calls } = fakeClient({
    "rpc:due_sends_fair": { data: null, error: { code: "PGRST202", message: "Could not find the function" } },
    "select:messages": { data: [{ id: "m-1", org_id: ORG_A, scheduled_at: "2026-11-19T08:00:00Z" }], error: null },
  });
  setAdminClientForTests(client);
  const outcome = await HANDLERS.schedule_sends({
    scope: OrgScope.global() as never,
    payload: {},
    job: { id: "j", org_id: null, job_name: "schedule_sends" } as never,
    now: new Date("2026-11-19T10:00:00Z"),
  });
  expect("before 0056 it falls back to the oldest-first read, so mail still goes",
    outcome.ok && calls.some((c) => c.table === "messages" && c.verb === "select") &&
    calls.some((c) => c.table === "job_executions" && c.verb === "insert"));
  setAdminClientForTests(null);
}

console.log("\nbusiness hours — the window, in the recipient's zone");

{
  const ny = "America/New_York";
  /* 2026-11-02 is a Monday. 14:00 UTC is 09:00 in New York (EST). */
  expect("Monday 09:00 in New York is open", inBusinessHours(new Date("2026-11-02T14:00:00Z"), ny));
  expect("Monday 07:00 in New York is closed", !inBusinessHours(new Date("2026-11-02T12:00:00Z"), ny));
  expect("Saturday noon is closed", !inBusinessHours(new Date("2026-11-07T17:00:00Z"), ny));
  expectEqual(
    "Saturday's next window is Monday 08:00 New York",
    nextBusinessWindow(new Date("2026-11-07T17:00:00Z"), ny).toISOString(),
    "2026-11-09T13:00:00.000Z",
  );
  expectEqual("a country name resolves", zoneForCountry("United Kingdom"), "Europe/London");
  expectEqual("an ISO code resolves, any case", zoneForCountry("de"), "Europe/Berlin");
  expectEqual("an unknown country is no zone", zoneForCountry("Atlantis"), null);
}

console.log("\ncheck_mailbox_domain — what the DNS says about the sending domain");

{
  const fakeDns = (records: Record<string, string[]>, mx: boolean) => ({
    resolveMx: async () => (mx ? [{ exchange: "mx.example" }] : []),
    resolveTxt: async (name: string) => {
      if (!records[name]) throw Object.assign(new Error("ENODATA"), { code: "ENODATA" });
      return records[name]!.map((r) => [r]);
    },
  });

  const full = await assessDomain(
    "acme.test",
    fakeDns(
      {
        "acme.test": ["v=spf1 include:_spf.google.com ~all"],
        "_dmarc.acme.test": ["v=DMARC1; p=none"],
        "google._domainkey.acme.test": ["v=DKIM1; k=rsa; p=MIIB"],
      },
      true,
    ),
  );
  expectEqual("MX, SPF, DMARC and DKIM is a pass", full.status, "pass");
  expectEqual("and names the selector it found", full.dkim, "google");

  const noDmarc = await assessDomain("acme.test", fakeDns({ "acme.test": ["v=spf1 -all"] }, true));
  expectEqual("no DMARC or DKIM is a warning", noDmarc.status, "warn");

  const noSpf = await assessDomain("acme.test", fakeDns({ "_dmarc.acme.test": ["v=DMARC1; p=reject"] }, true));
  expectEqual("no SPF is a failure", noSpf.status, "fail");

  const noMx = await assessDomain("acme.test", fakeDns({ "acme.test": ["v=spf1 -all"] }, false));
  expectEqual("no MX is a failure", noMx.status, "fail");
  expect("and the problem is said in words", noMx.problems.some((p) => p.includes("MX")));

  const { client, calls } = fakeClient({
    "select:mailboxes": { data: { id: MAILBOX_ID, email: "founder@acme.test" }, error: null },
  });
  const outcome = await checkMailboxDomain(
    {
      scope: new OrgScope(ORG_A, client),
      payload: { mailboxId: MAILBOX_ID },
      job: { id: "job-d", org_id: ORG_A, job_name: "check_mailbox_domain" } as never,
      now: new Date(),
    },
    fakeDns({ "acme.test": ["v=spf1 -all"] }, true),
  );
  expect("the handler stores the verdict on the mailbox", outcome.ok && calls.some(
    (c) => c.table === "mailboxes" && c.verb === "update" && (c.payload as { domain_status?: string })?.domain_status === "warn",
  ));
}

console.log("\nan unreadable check stops the send");
{
  const { client } = fakeClient({ "select:messages": { data: null, error: { message: "URI too long" } } });
  const scope = new OrgScope(ORG_A, client);
  await expectThrows("an unreadable reply is not silence", () => repliedSinceLastSend({ scope } as never, "p@x.test"), /unreadable/);
  await expectThrows("an unreadable bounce count is not zero bounces", () => bounceHealth({ scope } as never, "box"), /unreadable/);

  const saved = { RESEND_API_KEY: process.env.RESEND_API_KEY, EMAIL_FROM: process.env.EMAIL_FROM, NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL };
  Object.assign(process.env, { RESEND_API_KEY: "re_synthetic", EMAIL_FROM: "a@x.test", NEXT_PUBLIC_SITE_URL: "https://x.test" });
  const prefs = fakeClient({
    "rpc:exchange_queue_notifications": { data: {}, error: null },
    "select:exchange_notifications": { data: [{ id: "n", org_id: "o", user_id: "u", kind: "match_alert", title: "t", body: null, href: "/x", hot: true, created_at: "2026-11-24T00:00:00Z" }], error: null },
    "select:profiles": { data: [{ id: "u", email: "u@x.test" }], error: null },
    "select:organizations": { data: [], error: null },
    "select:notification_preferences": { data: null, error: { message: "down" } },
  });
  setAdminClientForTests(prefs.client);
  const realFetch = globalThis.fetch;
  let sent = 0;
  globalThis.fetch = (async () => ((sent += 1), new Response("{}"))) as typeof fetch;
  try {
    const out = await sendExchangeNotifications({ scope: OrgScope.global() as never, payload: {}, job: {} as never, now: new Date() });
    expect("unread preferences are not the defaults: nobody is emailed", !out.ok && sent === 0, [out, sent]);
  } finally {
    globalThis.fetch = realFetch;
    setAdminClientForTests(null);
    for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
}

