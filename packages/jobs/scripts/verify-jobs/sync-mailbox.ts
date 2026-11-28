/** sync_mailbox — what a reply does, and what it must not do. */
import { OrgScope, setAdminClientForTests } from "../../src/scope.ts";
import { applyClassification, syncMailbox } from "../../src/handlers/sync-mailbox.ts";
import { expect, expectEqual, type Recorded, fakeClient, ORG_A } from "./harness.ts";
import { THREAD_ID, OPPORTUNITY_ID, INBOUND_ID, incoming, syncContext } from "./fixtures.ts";

console.log("\nsync_mailbox — AI-009: a reply nobody could classify still stops the sequence");

{
  const saved = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  const { ctx, calls, restore } = syncContext([incoming({ text: "Thanks — let me check with my team next week." })], {
    "select:threads": { data: { id: THREAD_ID, opportunity_id: OPPORTUNITY_ID }, error: null },
  });
  const outcome = await syncMailbox(ctx);
  restore();
  if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
  const stoppedCall = calls.find(
    (c) => c.table === "enrollments" && c.verb === "update" && (c.payload as { status?: string })?.status === "parked",
  );
  expect("with no model available, the reply is stored", outcome.ok);
  expect("and the sequence on that opportunity is parked, so a person can resume it", Boolean(stoppedCall), calls.map((c) => `${c.verb}:${c.table}`));
  expect("scoped to that opportunity", JSON.stringify(stoppedCall?.filters).includes(OPPORTUNITY_ID));
}

console.log("\nsync_mailbox — what gets stored, and what does not");

{
  const { ctx, calls, restore } = syncContext([incoming()]);
  const outcome = await syncMailbox(ctx);
  restore();

  expect("an arriving reply is stored", outcome.ok);
  const inserted = calls.find((c) => c.table === "messages" && c.verb === "insert")
    ?.payload as Record<string, unknown>[] | undefined;
  expectEqual("as inbound", inserted?.[0]?.direction, "inbound");
  expectEqual(
    "with the sender's own Message-ID, so our reply can thread against it",
    inserted?.[0]?.message_id_header,
    "<reply@mail.acme.co>",
  );
  expect(
    "and the cursor is written back, so the next sync does not re-read it",
    calls.some(
      (c) =>
        c.table === "mailboxes" &&
        c.verb === "update" &&
        (c.payload as { sync_cursor?: string })?.sync_cursor === "cursor-2",
    ),
  );
}

{
  /* Our own sends come back through the sync on some providers. Storing one
     would create a second row for a message already recorded and — worse —
     classify our own copy as a reply from the prospect. */
  const { ctx, calls, restore } = syncContext([
    incoming({ from: "founder@huntloop.test" }),
  ]);
  await syncMailbox(ctx);
  restore();

  expect(
    "a message from our own address is not stored as a reply",
    !calls.some((c) => c.table === "messages" && c.verb === "insert"),
  );
}

{
  const { ctx, calls, restore } = syncContext([incoming()], {
    "select:messages": { data: { id: "already-here" }, error: null },
  });
  await syncMailbox(ctx);
  restore();

  expect(
    "a message already stored is not stored twice — the sync is at-least-once too",
    !calls.some((c) => c.table === "messages" && c.verb === "insert"),
  );
}

{
  /* With no API key the classifier cannot run. The messages must still land:
     an unmatched or unclassified reply is still a human being answering, and
     dropping it would make the product look like it loses mail. */
  const { ctx, calls, restore } = syncContext([incoming()]);
  const outcome = await syncMailbox(ctx);
  restore();

  expect("with no model configured the message is still stored", outcome.ok);
  expect(
    "and it is stored, not discarded",
    calls.some((c) => c.table === "messages" && c.verb === "insert"),
  );
  expect(
    "no classification is invented for it",
    !calls.some((c) => c.table === "threads" && c.verb === "update"),
  );
}

console.log("\nsync_mailbox — §78: a reply stops the sequence");

/** Drives the consequences of one classification and reports what was written. */
async function classify(label: string, extra: Record<string, unknown> = {}) {
  const { client, calls } = fakeClient({
    "select:threads": { data: { opportunity_id: OPPORTUNITY_ID }, error: null },
    ...extra,
  });
  setAdminClientForTests(client);

  await applyClassification(
    {
      scope: new OrgScope(ORG_A, client),
      payload: {},
      job: { id: "job-3", org_id: ORG_A, job_name: "sync_mailbox" } as never,
      now: new Date(),
    },
    {
      messageId: INBOUND_ID,
      threadId: THREAD_ID,
      from: "dana@acme.co",
      classification: {
        label,
        summary: "They asked how it handles multisig.",
        confidence: "high",
        needsHuman: label !== "out_of_office",
      } as never,
    },
  );

  setAdminClientForTests(null);
  return calls;
}

/** Did anything stop the enrollment? */
function stopped(calls: Recorded[]): boolean {
  return calls.some(
    (c) =>
      c.table === "enrollments" &&
      c.verb === "update" &&
      (c.payload as { status?: string })?.status === "stopped",
  );
}

{
  const calls = await classify("positive");

  expect("a positive reply stops the enrollment", stopped(calls));
  expect(
    "and clears its next action, so nothing is waiting to fire",
    calls.some(
      (c) =>
        c.table === "enrollments" &&
        c.verb === "update" &&
        (c.payload as { next_action_at?: string | null })?.next_action_at === null,
    ),
  );
  expect(
    "the opportunity moves to replied",
    calls.some(
      (c) =>
        c.table === "opportunities" &&
        c.verb === "update" &&
        (c.payload as { status?: string })?.status === "replied",
    ),
  );
  expect(
    "and a positive outcome is recorded as its own kind, not collapsed into 'reply'",
    calls.some(
      (c) =>
        c.table === "outcomes" &&
        c.verb === "insert" &&
        (c.payload as { kind?: string }[])?.[0]?.kind === "positive",
    ),
  );
}

{
  const calls = await classify("negative");
  expect("a negative reply stops the sequence just the same", stopped(calls));
  expect(
    "and is recorded as a reply rather than as positive",
    calls.some(
      (c) =>
        c.table === "outcomes" &&
        c.verb === "insert" &&
        (c.payload as { kind?: string }[])?.[0]?.kind === "reply",
    ),
  );
}

{
  /* The one exception, and it has to be an exception: the person is back next
     week and the follow-up is the entire point of the sequence. */
  const calls = await classify("out_of_office");
  expect("an out-of-office does NOT stop the sequence", !stopped(calls));
  expect(
    "and does not move the opportunity to replied",
    !calls.some((c) => c.table === "opportunities" && c.verb === "update"),
  );
}

{
  /* OUT-005: the bounce arrives from the mail system; the address that failed
     is the recipient of our outbound message on the thread. */
  const calls = await classify("bounce", {
    "select:messages": { data: { to_email: "Prospect@Acme.co" }, error: null },
  });

  const marked = calls.find(
    (c) =>
      c.table === "contact_points" &&
      c.verb === "update" &&
      (c.payload as { verification_status?: string })?.verification_status === "undeliverable",
  );
  expect("a bounce marks the address undeliverable, which stops every future campaign", Boolean(marked));
  expect(
    "and it is the address we sent to, not the one the bounce came from",
    JSON.stringify(marked?.filters ?? []).includes("prospect@acme.co") &&
      !JSON.stringify(marked?.filters ?? []).includes("dana@acme.co"),
  );
  expect(
    "and the address is suppressed",
    calls.some((c) => c.table === "suppressions" && JSON.stringify(c.payload).includes("prospect@acme.co")),
  );
  expect("it stops this enrollment too", stopped(calls));
  expect(
    "but the opportunity is NOT moved to replied — a bounce is not an answer",
    !calls.some(
      (c) =>
        c.table === "opportunities" &&
        c.verb === "update" &&
        (c.payload as { status?: string })?.status === "replied",
    ),
  );
}

{
  const calls = await classify("unsubscribe");

  expect(
    "an unsubscribe is written to the suppression list, not just to the thread",
    calls.some((c) => c.table === "suppressions" && c.verb === "upsert"),
  );
  expect("and it stops the sequence", stopped(calls));
}

{
  /* A reply on a thread with no opportunity behind it still has to be safe:
     there is nothing to stop, and nothing should be invented to stop. */
  const calls = await classify("positive", {
    "select:threads": { data: { opportunity_id: null }, error: null },
  });
  expect("a reply with no opportunity behind it stops nothing", !stopped(calls));
  expect(
    "and the reply is still recorded against the thread",
    calls.some((c) => c.table === "threads" && c.verb === "update"),
  );
}

