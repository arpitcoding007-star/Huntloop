import "server-only";
import { requireOrgId } from "./org";
import { load, type Loaded } from "./source";

/**
 * The inbox — `threads`, `messages` and `message_events` from `0004`.
 *
 * ── Why a message's delivery state is derived, not stored ────────────────
 *
 * `messages` records what was written and whether it left; `message_events`
 * records what happened to it afterwards — delivered, bounced, opened,
 * replied, complained. There is no `status` column on a message, deliberately,
 * because a bounce and a complaint are both *events with a time*, and
 * collapsing them into one mutable field loses the sequence. So the newest
 * event is computed here on read.
 *
 * The one thing this file must not do is soften it. §78: "record the failure
 * and do not falsely mark the message as sent." A message with a `bounced`
 * event has not reached anybody, and the inbox has to say so rather than
 * showing it in the same grey as one that simply has no events yet.
 */

export type MessageEventKind =
  | "delivered"
  | "bounced"
  | "opened"
  | "clicked"
  | "replied"
  | "complained"
  | "unsubscribed"
  | "failed";

export interface Message {
  id: string;
  direction: "outbound" | "inbound";
  subject: string | null;
  bodyText: string | null;
  aiGenerated: boolean;
  /** §62 rule 9: a personalised claim names the evidence behind it. */
  evidenceCount: number;
  sentAt: string | null;
  scheduledAt: string | null;
  createdAt: string | null;
  /** The most recent event, or null when nothing has happened to it yet. */
  latestEvent: { kind: MessageEventKind; occurredAt: string } | null;
}

export interface Thread {
  id: string;
  subject: string | null;
  status: string;
  classification: string | null;
  opportunityId: string | null;
  lastMessageAt: string | null;
  messages: Message[];
  /** True when anything in the thread bounced, failed or complained. */
  hasFailure: boolean;
  /** True when the last message in the thread came from the other side. */
  awaitingUs: boolean;
}

export async function listThreads(orgSlug: string): Promise<Loaded<Thread[]>> {
  return load(
    async (db) => {
      const orgId = await requireOrgId(orgSlug, "listThreads");

      const { data, error } = await db
        .from("threads")
        .select(
          `id, subject, status, classification, opportunity_id, last_message_at,
           messages(id, direction, subject, body_text, ai_generated, evidence_ids,
             sent_at, scheduled_at, created_at, deleted_at,
             message_events(kind, occurred_at))`,
        )
        .eq("org_id", orgId)
        .is("deleted_at", null)
        // Newest conversation first: an inbox ordered any other way makes the
        // thing that just happened the thing you have to scroll for.
        .order("last_message_at", { ascending: false, nullsFirst: false });

      if (error) throw new Error(`listThreads: ${error.message}`);
      return (data ?? []).map(mapThread);
    },
    () => DEMO,
  );
}

const FAILURES: readonly MessageEventKind[] = ["bounced", "failed", "complained"];

/* eslint-disable @typescript-eslint/no-explicit-any --
   Supabase row types for a nested select are generated from a live project's
   schema. Confined to the mappers so the rest of the file is checked. */
function mapThread(row: any): Thread {
  const messages = (Array.isArray(row.messages) ? row.messages : [])
    .filter((m: any) => !m.deleted_at)
    .map(mapMessage)
    /* PostgREST does not order embedded rows, and a conversation rendered out
       of order is a different conversation. `created_at` rather than `sent_at`,
       because an unsent draft has no send time and would otherwise sort to one
       end regardless of when it was written. */
    .sort((a: Message, b: Message) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));

  const last = messages[messages.length - 1];

  return {
    id: String(row.id),
    subject: row.subject ?? null,
    status: String(row.status ?? "open"),
    classification: row.classification ?? null,
    opportunityId: row.opportunity_id ?? null,
    lastMessageAt: row.last_message_at ?? null,
    messages,
    hasFailure: messages.some(
      (m: Message) => m.latestEvent && FAILURES.includes(m.latestEvent.kind),
    ),
    awaitingUs: Boolean(last && last.direction === "inbound"),
  };
}

function mapMessage(row: any): Message {
  const events = (Array.isArray(row.message_events) ? row.message_events : [])
    .filter((e: any) => typeof e.kind === "string")
    .sort((a: any, b: any) =>
      String(b.occurred_at ?? "").localeCompare(String(a.occurred_at ?? "")),
    );

  return {
    id: String(row.id),
    direction: row.direction === "inbound" ? "inbound" : "outbound",
    subject: row.subject ?? null,
    bodyText: row.body_text ?? null,
    aiGenerated: Boolean(row.ai_generated),
    evidenceCount: Array.isArray(row.evidence_ids) ? row.evidence_ids.length : 0,
    sentAt: row.sent_at ?? null,
    scheduledAt: row.scheduled_at ?? null,
    createdAt: row.created_at ?? null,
    latestEvent: events[0]
      ? {
          kind: events[0].kind as MessageEventKind,
          occurredAt: String(events[0].occurred_at ?? ""),
        }
      : null,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Demo threads.
 *
 * One reply that needs answering and one bounce, because those are the two
 * states an inbox exists to surface. A demo of only successful sends would
 * make the failure rendering — the part §78 is about — the code path nobody
 * ever looks at.
 */
const DEMO: Thread[] = [
  {
    id: "demo-thread-1",
    subject: "The policy layer your agents are missing",
    status: "open",
    classification: "interested",
    opportunityId: null,
    lastMessageAt: null,
    hasFailure: false,
    awaitingUs: true,
    messages: [
      {
        id: "demo-message-1",
        direction: "outbound",
        subject: "The policy layer your agents are missing",
        bodyText:
          "Saw you shipped an agent that moves funds last month — how are you gating it today?",
        aiGenerated: true,
        evidenceCount: 2,
        sentAt: null,
        scheduledAt: null,
        createdAt: "2026-08-10T09:00:00Z",
        latestEvent: { kind: "opened", occurredAt: "2026-08-10T11:20:00Z" },
      },
      {
        id: "demo-message-2",
        direction: "inbound",
        subject: "Re: The policy layer your agents are missing",
        bodyText: "We're doing it in application code right now. What does yours look like?",
        aiGenerated: false,
        evidenceCount: 0,
        sentAt: null,
        scheduledAt: null,
        createdAt: "2026-08-10T14:05:00Z",
        latestEvent: { kind: "replied", occurredAt: "2026-08-10T14:05:00Z" },
      },
    ],
  },
  {
    id: "demo-thread-2",
    subject: "Freight partners and booking APIs",
    status: "open",
    classification: null,
    opportunityId: null,
    lastMessageAt: null,
    hasFailure: true,
    awaitingUs: false,
    messages: [
      {
        id: "demo-message-3",
        direction: "outbound",
        subject: "Freight partners and booking APIs",
        bodyText: "Noticed your partner network each expose their own booking APIs.",
        aiGenerated: true,
        evidenceCount: 1,
        sentAt: null,
        scheduledAt: null,
        createdAt: "2026-08-09T08:30:00Z",
        latestEvent: { kind: "bounced", occurredAt: "2026-08-09T08:31:00Z" },
      },
    ],
  },
];
