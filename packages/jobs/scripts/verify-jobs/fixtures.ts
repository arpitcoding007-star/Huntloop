/**
 * The mail fixtures several subject files share: a message that would send,
 * a connected mailbox, an inbound reply, and the environment a configured
 * deployment has. Loading this file sets that environment, so it is imported
 * by the mailbox sections and everything that runs after them.
 */
import { OrgScope, setAdminClientForTests } from "../../src/scope.ts";
import { gmail } from "../../src/mailbox/gmail.ts";
import { type Recorded, fakeClient, ORG_A } from "./harness.ts";

/* ── send_message — the handler with no undo ─────────────────────────────── */

/**
 * §78 and §46, as behaviour rather than as comments.
 *
 * This handler had no tests, which is worth saying plainly: it is the one
 * place in the product that puts mail in a stranger's inbox, and every guard
 * in it — already-sent, approved, suppressed, allowance — was verified only by
 * reading. A scan that runs twice costs a little money; a send that runs twice
 * costs a prospect.
 *
 * `authorize()` and the provider are reached through the real code path rather
 * than stubbed out: the token is genuinely encrypted with a test key and
 * genuinely decrypted, and only the provider's `send` is replaced. What is
 * being tested is the order of the checks, so anything that would let a check
 * be skipped has to stay real.
 */

export const MESSAGE_ID = "11111111-1111-1111-1111-111111111111";
export const MAILBOX_ID = "22222222-2222-2222-2222-222222222222";

process.env.MAILBOX_ENCRYPTION_KEY = "a".repeat(64);
/*
 * A send now refuses outright when no unsubscribe URL can be built, so the
 * harness has to model a configured deployment for every other check in this
 * section to reach the code it is aiming at. The unconfigured case gets its
 * own test below, which unsets this deliberately.
 */
process.env.NEXT_PUBLIC_SITE_URL = "https://huntloop.test";
export const { encryptSecret } = await import("@huntloop/db");

/** A message that would send, so each test can spoil exactly one thing. */
export function sendable(overrides: Record<string, unknown> = {}) {
  return {
    id: MESSAGE_ID,
    enrollment_id: null,
    mailbox_id: MAILBOX_ID,
    thread_id: null,
    direction: "outbound",
    subject: "The policy layer your agents are missing",
    body_text: "How are you gating custody today?",
    body_html: null,
    to_email: "dana@acme.co",
    sent_at: null,
    scheduled_at: new Date().toISOString(),
    provider_message_id: null,
    ...overrides,
  };
}

/** A connected mailbox whose token is valid for another hour. */
export function connectedMailbox() {
  return {
    id: MAILBOX_ID,
    email: "founder@huntloop.test",
    provider: "gmail",
    status: "connected",
    oauth_token_enc: encryptSecret("test-access-token"),
    refresh_token_enc: encryptSecret("test-refresh-token"),
    token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
    sync_cursor: null,
    daily_limit: 50,
    /* Read a minute ago: a sequence step waits for a fresh read (P1-2). */
    last_sync_at: new Date(Date.now() - 60_000).toISOString(),
  };
}

/**
 * A live enrollment row, as `send_message`'s parent check (OUT-201) and its
 * autonomy read see it. Each OUT-201 test spoils exactly one field.
 */
export function liveEnrollment(over: { status?: string; parked_reason?: string | null; deleted_at?: string | null; campaign?: Record<string, unknown>; opportunity?: Record<string, unknown> } = {}) {
  return {
    data: {
      status: over.status ?? "active",
      parked_reason: over.parked_reason ?? null,
      deleted_at: over.deleted_at ?? null,
      campaigns: { status: "active", deleted_at: null, autonomy_level: 0, ...over.campaign },
      opportunities: { status: "qualified", deleted_at: null, ...over.opportunity },
    },
    error: null,
  };
}

export function sendContext(message: Record<string, unknown>, responses: Record<string, unknown> = {}) {
  const { client, calls } = fakeClient({
    "select:messages": { data: message, error: null },
    /* 0047: the token is read from its own table, which no tenant session can
       see (security audit lead 6). */
    "select:message_unsubscribe_tokens": {
      data: { token: "44444444-4444-4444-4444-444444444444" },
      error: null,
    },
    "select:mailboxes": { data: connectedMailbox(), error: null },
    "select:enrollments": liveEnrollment(),
    /* `0017`'s single gate. Returned as a one-row array because it is a
       `returns table`, which is what PostgREST hands back — and the handler
       reading only the first element of an object would be a bug this stub
       must be able to catch. */
    "rpc:can_contact": { data: [{ allowed: true, reason: "ok", detail: {} }], error: null },
    "rpc:claim_mailbox_send": { data: true, error: null },
    /* OUT-013: this message holds its address's lane. */
    "rpc:claim_contact_lane": { data: true, error: null },
    /* OUT-001: the at-most-once claim on the message. One row back means this
       run won it; the tests for losing it override this. */
    "update:messages": { data: [{ id: "claimed" }], error: null },
    "insert:threads": { data: { id: "55555555-5555-5555-5555-555555555555" }, error: null },
    /* A configured workspace. Both of these are now send preconditions, so
       every other check in this section needs them satisfied to reach the
       code it is aiming at — and each has its own test below that removes
       exactly one of them. */
    "select:organizations": {
      data: { settings: { compliance: { postalAddress: "Acme Ltd\n1 Example Street\nLondon EC1A 1BB" } } },
      error: null,
    },
    "rpc:check_quota_internal": {
      data: [{ allowed: true, used: 12, quota: 5000 }],
      error: null,
    },
    ...responses,
  });
  setAdminClientForTests(client);
  return {
    calls,
    ctx: {
      scope: new OrgScope(ORG_A, client),
      payload: { messageId: MESSAGE_ID },
      job: { id: "job-1", org_id: ORG_A, job_name: "send_message" } as never,
      now: new Date(),
    },
  };
}

/** Did anything write a send time? The one question these tests keep asking. */
/**
 * PANEL-302: a refusal that clears on its own is a wait, `not_before` plus a
 * `wait_reason`, and never `error`, which `schedule_sends` treats as final.
 */
export function waited(calls: Recorded[], reason: RegExp): { deferred: boolean; noError: boolean; says: boolean } {
  const updates = calls.filter((c) => c.table === "messages" && c.verb === "update");
  const payloads = updates.map((c) => (c.payload ?? {}) as Record<string, unknown>);
  return {
    deferred: payloads.some((p) => typeof p.not_before === "string"),
    noError: !payloads.some((p) => "error" in p && p.error !== null),
    says: payloads.some((p) => reason.test(String(p.wait_reason ?? ""))),
  };
}

export function markedSent(calls: Recorded[]): boolean {
  return calls.some(
    (c) =>
      c.table === "messages" &&
      c.verb === "update" &&
      Boolean((c.payload as { sent_at?: string })?.sent_at),
  );
}

/* ── sync_mailbox — what a reply does, and what it must not do ───────────── */

/**
 * §78: "a sequence that keeps sending after a reply is the single most
 * damaging bug this system can have." That sentence was in the file's own
 * header and nothing tested it.
 *
 * Two layers here. The storage path runs through the real handler, including
 * the real `authorize()` — with no `ANTHROPIC_API_KEY` in the test
 * environment, classification is skipped, which is itself a behaviour worth
 * pinning: the messages are still stored and simply unclassified. The
 * classification consequences are driven through `applyClassification`
 * directly, because reaching them through the handler means making a model
 * call the suite deliberately cannot make.
 */

export const THREAD_ID = "66666666-6666-6666-6666-666666666666";
export const OPPORTUNITY_ID = "77777777-7777-7777-7777-777777777777";
export const INBOUND_ID = "88888888-8888-8888-8888-888888888888";

export function incoming(overrides: Record<string, unknown> = {}) {
  return {
    providerMessageId: "gmail-in-1",
    providerThreadId: "thread-abc",
    messageIdHeader: "<reply@mail.acme.co>",
    inReplyTo: "<abc@mail.gmail.com>",
    from: "dana@acme.co",
    to: "founder@huntloop.test",
    subject: "Re: The policy layer your agents are missing",
    text: "Interesting — how does it handle multisig?",
    receivedAt: new Date().toISOString(),
    ...overrides,
  };
}

export function syncContext(messages: Record<string, unknown>[], responses: Record<string, unknown> = {}) {
  const { client, calls } = fakeClient({
    "select:mailboxes": { data: connectedMailbox(), error: null },
    // No row with this provider id yet, so the message is new.
    "select:messages": { data: null, error: null },
    "insert:messages": { data: { id: INBOUND_ID }, error: null },
    "select:threads": { data: null, error: null },
    ...responses,
  });
  setAdminClientForTests(client);

  const original = gmail.sync;
  gmail.sync = async () => ({ messages: messages as never, cursor: "cursor-2" });

  return {
    calls,
    restore: () => {
      gmail.sync = original;
      setAdminClientForTests(null);
    },
    ctx: {
      scope: new OrgScope(ORG_A, client),
      payload: { mailboxId: MAILBOX_ID },
      job: { id: "job-2", org_id: ORG_A, job_name: "sync_mailbox" } as never,
      now: new Date(),
    },
  };
}

/** Whether this run deferred the message instead of sending or failing it. */
export function deferred(outcome: unknown, calls: Recorded[], reason: string): boolean {
  return (
    (outcome as { ok?: boolean }).ok === true &&
    (outcome as { result?: { deferred?: string } }).result?.deferred === reason &&
    !markedSent(calls) &&
    calls.some((c) => c.table === "messages" && c.verb === "update" && Boolean((c.payload as { not_before?: string })?.not_before))
  );
}
