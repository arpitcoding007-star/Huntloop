"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  Badge,
  Button,
  Card,
  CardBody,
  EmptyState,
  Field,
  FormMessage,
  Freshness,
  Input,
  SectionLabel,
  Select,
  Textarea,
} from "@huntloop/ui";
import { AlertTriangle, ArrowUpRight, Check, Inbox as InboxIcon, Pencil, Sparkles, X } from "lucide-react";
import type { Draft, Message, MessageEventKind, Thread } from "../../../../lib/data/inbox";
import {
  approveMessageAction,
  assignThreadAction,
  editDraftAction,
  rejectDraftAction,
  replyToThreadAction,
  setThreadStatusAction,
} from "./actions";

type Result = { ok: true; message?: string } | { ok: false; error: string } | null;
type MemberOption = { userId: string; label: string };

/**
 * The inbox — `threads` and `messages` from `0004`.
 *
 * ── The failure states are the point ─────────────────────────────────────
 *
 * §78: "record the failure and do not falsely mark the message as sent." So a
 * bounced message is rendered as a bounce, in the danger tone, above the copy
 * rather than below it — not in the same grey as one that simply has no events
 * yet. Those two states look identical in most inboxes, and they mean opposite
 * things: one reached somebody and one did not.
 *
 * ── Why there is no reply box ────────────────────────────────────────────
 *
 * Sending needs a connected mailbox, and there is no OAuth flow and nowhere to
 * encrypt a token. The control says so rather than composing a message with
 * nowhere to send it. See the note in `actions.ts`.
 */

const EVENT_TONE: Record<MessageEventKind, "success" | "warning" | "danger" | "neutral"> = {
  delivered: "success",
  opened: "success",
  clicked: "success",
  replied: "success",
  bounced: "danger",
  failed: "danger",
  complained: "danger",
  unsubscribed: "warning",
};

const STATUSES = ["open", "snoozed", "closed"] as const;

export function InboxView({
  org,
  threads,
  drafts = [],
  members = [],
  canWrite,
  now,
}: {
  org: string;
  threads: Thread[];
  /** Outbound messages nobody has approved yet, threaded or not (P0-1). */
  drafts?: Draft[];
  members?: MemberOption[];
  canWrite: boolean;
  now: string;
}) {
  const [result, setResult] = useState<Result>(null);

  const needsReply = threads.filter((t) => t.awaitingUs && t.status === "open");
  const failing = threads.filter((t) => t.hasFailure);
  /* Every draft is reviewed in one place — the queue — threaded or not, so
     Edit and Reject are always beside Approve. A draft inside a thread links
     up to its card. */
  const queue = drafts;

  if (threads.length === 0 && queue.length === 0) {
    return (
      <Card>
        <CardBody>
          <EmptyState
            icon={InboxIcon}
            title="Nothing here yet"
            description="Replies to your outreach arrive here. Nothing has been sent, so there is nothing to reply to."
          />
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <Figure label="Waiting for approval" value={drafts.length} />
        <Figure label="Conversations" value={threads.length} />
        <Figure label="Waiting on you" value={needsReply.length} />
        <Figure label="With a delivery failure" value={failing.length} />
      </div>

      {failing.length > 0 && (
        <div className="flex items-start gap-2.5 rounded-md border border-danger-border bg-danger-surface px-4 py-3">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" strokeWidth={1.75} />
          <div>
            <p className="text-[13px] text-danger">
              {failing.length}{" "}
              {failing.length === 1 ? "conversation has" : "conversations have"} a
              message that did not reach anybody.
            </p>
            <p className="mt-0.5 text-[12px] text-fg-secondary">
              A bounce or a complaint is not a silent outcome — the address may
              be wrong, or the mailbox may be in trouble. Treat these as unsent.
            </p>
          </div>
        </div>
      )}

      <FormMessage result={result} />

      {queue.length > 0 && (
        <section aria-labelledby="approval-queue" className="space-y-3">
          <div>
            <h2 id="approval-queue" className="text-[11px] font-medium tracking-label text-fg-muted uppercase">
              Waiting for your approval · {queue.length}
            </h2>
            <p className="mt-1 text-[12px] text-fg-muted">
              Drafted by a campaign at autonomy 0–1. Nothing sends, and the sequence waits, until a
              person approves. Edit the words if they are not right; reject to stop the sequence.
            </p>
          </div>
          {queue.map((d) => (
            <DraftCard key={d.id} org={org} draft={d} canWrite={canWrite} now={now} onResult={setResult} />
          ))}
        </section>
      )}

      {threads.length > 0 && <SectionLabel>Conversations</SectionLabel>}
      <div className="space-y-4">
        {threads.map((t) => (
          <ThreadCard
            key={t.id}
            org={org}
            thread={t}
            members={members}
            canWrite={canWrite}
            now={now}
            onResult={setResult}
          />
        ))}
      </div>
    </div>
  );
}

function Figure({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-[11px] font-medium tracking-label text-fg-muted uppercase">
        {label}
      </p>
      <p className="mt-0.5 font-mono text-[18px] text-fg">{value}</p>
    </div>
  );
}

function ThreadCard({
  org,
  thread,
  members,
  canWrite,
  now,
  onResult,
}: {
  org: string;
  thread: Thread;
  members: MemberOption[];
  canWrite: boolean;
  now: string;
  onResult: (r: { ok: true; message?: string } | { ok: false; error: string }) => void;
}) {
  const [pending, start] = useTransition();
  const [replying, setReplying] = useState(false);

  /* A reply goes to whoever wrote last, so a thread with nothing incoming has
     no address to answer. Derived here rather than loaded: the messages are
     already on the client, and asking the server would be asking it something
     the page can already see. */
  const canReply = thread.messages.some((m) => m.direction === "inbound");

  return (
    <Card id={`thread-${thread.id}`} className="scroll-mt-6">
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-[14px] font-medium text-fg">
              {thread.subject ?? "No subject"}
            </h2>
            {/* P0-2: a conversation is about an account. Reading a reply
                without the research behind it is how the answer goes wrong. */}
            {thread.opportunityId && (
              <Link
                href={`/${org}/opportunities/${thread.opportunityId}`}
                className="hl-focusable mt-0.5 inline-flex items-center gap-1 rounded-sm text-[12px] text-fg-secondary underline decoration-line-strong underline-offset-2 hover:text-fg"
              >
                {thread.company ?? "Open the opportunity"}
                <ArrowUpRight className="size-3" strokeWidth={1.75} />
              </Link>
            )}
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <Badge variant={thread.status === "open" ? "brand" : "neutral"}>
                {thread.status}
              </Badge>
              {thread.classification && (
                <Badge variant="neutral">{thread.classification}</Badge>
              )}
              {thread.awaitingUs && <Badge variant="warning">Waiting on you</Badge>}
              {thread.hasFailure && <Badge variant="danger">Delivery failed</Badge>}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {canWrite && members.length > 1 && (
              <label>
                <span className="sr-only">Who handles {thread.subject ?? "this conversation"}</span>
                <Select
                  value={thread.assigneeId ?? ""}
                  disabled={pending}
                  className="mt-0 h-8 w-[150px]"
                  onChange={(e) =>
                    start(async () => {
                      const res = await assignThreadAction(org, thread.id, e.target.value || null);
                      onResult(res.ok ? { ok: true, message: res.message } : { ok: false, error: res.error });
                    })
                  }
                >
                  <option value="">Nobody</option>
                  {members.map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.label}
                    </option>
                  ))}
                </Select>
              </label>
            )}
            {canWrite && (
              <label>
                <span className="sr-only">Status for {thread.subject ?? "this conversation"}</span>
                <Select
                  value={STATUSES.includes(thread.status as (typeof STATUSES)[number]) ? thread.status : "open"}
                  disabled={pending}
                  className="mt-0 h-8 w-[120px]"
                  onChange={(e) =>
                    start(async () => {
                      const res = await setThreadStatusAction(org, thread.id, e.target.value);
                      onResult(
                        res.ok
                          ? { ok: true, message: res.message }
                          : { ok: false, error: res.error },
                      );
                    })
                  }
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </Select>
              </label>
            )}
            {canWrite && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setReplying((open) => !open)}
                pending={
                  canReply
                    ? undefined
                    : "Nothing has arrived in this conversation yet, so there is no address to answer."
                }
              >
                Reply
              </Button>
            )}
          </div>
        </div>

        <ol className="space-y-3">
          {thread.messages.map((m) => (
            <li key={m.id}>
              <MessageRow message={m} now={now} canWrite={canWrite} />
            </li>
          ))}
        </ol>

        {replying && canWrite && canReply && (
          <ReplyBox
            org={org}
            threadId={thread.id}
            onDone={() => setReplying(false)}
            onResult={onResult}
          />
        )}
      </CardBody>
    </Card>
  );
}

function MessageRow({
  message,
  now,
  canWrite,
}: {
  message: Message;
  now: string;
  canWrite: boolean;
}) {
  const failed =
    message.latestEvent && EVENT_TONE[message.latestEvent.kind] === "danger";

  return (
    <div
      className={[
        "rounded-md border px-3 py-2.5",
        failed
          ? "border-danger-border bg-danger-surface"
          : message.direction === "inbound"
            ? "border-line bg-surface"
            : "border-line-subtle bg-canvas",
      ].join(" ")}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="neutral">
          {message.direction === "inbound" ? "Received" : "Sent"}
        </Badge>

        {message.aiGenerated && (
          <span className="flex items-center gap-1 text-[12px] text-ai">
            <Sparkles className="size-3" strokeWidth={1.75} />
            Drafted by Huntloop
          </span>
        )}

        {/* §62 rule 9: a personalised claim names the evidence behind it, or
            the message does not send. Shown per message because that rule is
            checked per message, and a reader deciding whether to trust a
            claim needs to know whether anything backs it. */}
        {message.aiGenerated && (
          <Badge variant={message.evidenceCount > 0 ? "success" : "warning"}>
            {message.evidenceCount > 0
              ? `${message.evidenceCount} evidence`
              : "No evidence cited"}
          </Badge>
        )}

        {message.latestEvent && (
          <Badge variant={EVENT_TONE[message.latestEvent.kind]}>
            {message.latestEvent.kind}
          </Badge>
        )}

        {message.direction === "outbound" && !message.sentAt && (
          /* Two states, not one. Both are "not sent", and only one of them is
             waiting on a person — which is the difference between a queue you
             have to work and a queue you have to wait for.

             Neither says "sent". `messages_sent_has_provider_id` in 0004
             refuses a send time without the provider id that proves it left,
             so an outbound message with no `sent_at` genuinely has not gone. */
          <Badge variant={message.scheduledAt ? "neutral" : "warning"}>
            {message.scheduledAt ? "Queued to send" : "Awaiting approval"}
          </Badge>
        )}

        {/* §46's ladder, at the point it acts on. At autonomy 0–1 the engine
            writes a message and stops, and this is the human step it stops
            for — so the control lives on the message rather than on the
            conversation. */}
        {message.direction === "outbound" && !message.sentAt && !message.scheduledAt && (
          <a
            href={`#draft-${message.id}`}
            className="hl-focusable rounded-sm text-[12px] text-brand-text underline underline-offset-2"
          >
            {canWrite ? "Review in the approval queue" : "In the approval queue"}
          </a>
        )}

        <span className="ml-auto">
          {message.createdAt && (
            <Freshness date={message.createdAt} now={new Date(now)} label="" />
          )}
        </span>
      </div>

      {message.subject && (
        <p className="mt-1.5 text-[13px] font-medium text-fg">{message.subject}</p>
      )}
      {message.bodyText && (
        <p className="mt-1 text-[13px] whitespace-pre-wrap text-fg-secondary">
          {message.bodyText}
        </p>
      )}
    </div>
  );
}

/**
 * Write a reply, and say plainly what pressing send does.
 *
 * "Queue" rather than "Send", because that is what happens: the action writes
 * an approved message and the runner sends it on the next tick. A button
 * labelled Send on a screen where nothing sends synchronously would be a small
 * lie that gets found out the first time somebody watches for the message to
 * appear as sent — §7, on the screen where the user is most likely to be
 * watching for exactly that.
 */
function ReplyBox({
  org,
  threadId,
  onDone,
  onResult,
}: {
  org: string;
  threadId: string;
  onDone: () => void;
  onResult: (r: { ok: true; message?: string } | { ok: false; error: string }) => void;
}) {
  const [body, setBody] = useState("");
  const [pending, start] = useTransition();

  return (
    <div className="rounded-md border border-line bg-canvas p-3">
      <Field label="Your reply">
        {(field) => (
          <Textarea
            {...field}
            value={body}
            rows={4}
            disabled={pending}
            placeholder="Written by you, and sent as you — not drafted by Huntloop."
            onChange={(e) => setBody(e.target.value)}
          />
        )}
      </Field>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="primary"
          disabled={pending}
          pending={body.trim() ? undefined : "Write something first."}
          onClick={() =>
            start(async () => {
              const res = await replyToThreadAction(org, threadId, body);
              onResult(
                res.ok ? { ok: true, message: res.message } : { ok: false, error: res.error },
              );
              if (res.ok) {
                setBody("");
                onDone();
              }
            })
          }
        >
          {pending ? "Queueing…" : "Queue reply"}
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/**
 * One draft waiting for a person: read it, fix it, approve it or refuse it.
 *
 * The evidence badge sits beside the words for the same reason it does in a
 * thread (§62 rule 9): whether anything backs a claim is the question a
 * reviewer is answering. After an edit it says so, because sentences a person
 * added are not covered by the evidence the engine cited.
 */
function DraftCard({
  org,
  draft,
  canWrite,
  now,
  onResult,
}: {
  org: string;
  draft: Draft;
  canWrite: boolean;
  now: string;
  onResult: (r: Result) => void;
}) {
  const [mode, setMode] = useState<"read" | "edit" | "reject">("read");
  const [subject, setSubject] = useState(draft.subject ?? "");
  const [body, setBody] = useState(draft.bodyText ?? "");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();

  const report = (res: { ok: true; message?: string } | { ok: false; error: string; fieldErrors?: Record<string, string> }) => {
    onResult(res.ok ? { ok: true, message: res.message } : { ok: false, error: res.error });
    if (!res.ok) setErrors(res.fieldErrors ?? {});
    return res.ok;
  };

  return (
    <Card id={`draft-${draft.id}`} className="scroll-mt-6">
      <CardBody className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {draft.aiGenerated && (
            <span className="flex items-center gap-1 text-[12px] text-ai">
              <Sparkles className="size-3" strokeWidth={1.75} />
              Drafted by Huntloop
            </span>
          )}
          {draft.aiGenerated && (
            <Badge variant={draft.evidenceCount > 0 ? "success" : "warning"}>
              {draft.evidenceCount > 0 ? `${draft.evidenceCount} evidence` : "No evidence cited"}
            </Badge>
          )}
          {draft.edited && <Badge variant="neutral">Edited by a person</Badge>}
          <Badge variant="warning">Awaiting approval</Badge>
          <span className="ml-auto">
            {draft.createdAt && <Freshness date={draft.createdAt} now={new Date(now)} label="" />}
          </span>
        </div>

        <div className="text-[12px] text-fg-muted">
          To <span className="font-mono text-fg-secondary">{draft.toEmail ?? "no address"}</span>
          {draft.company && (
            <>
              {" "}at{" "}
              {draft.opportunityId ? (
                <Link
                  href={`/${org}/opportunities/${draft.opportunityId}`}
                  className="hl-focusable rounded-sm text-fg-secondary underline decoration-line-strong underline-offset-2 hover:text-fg"
                >
                  {draft.company}
                </Link>
              ) : (
                draft.company
              )}
            </>
          )}
          {draft.campaign && <> · {draft.campaign}</>}
        </div>

        {mode === "edit" ? (
          <div className="space-y-2">
            <Field label="Subject" error={errors.subject}>
              {(field) => (
                <Input {...field} value={subject} maxLength={200} disabled={pending} onChange={(e) => setSubject(e.target.value)} />
              )}
            </Field>
            <Field label="Body" error={errors.body} hint="Sentences you add are yours: the cited evidence covers only what the engine wrote.">
              {(field) => (
                <Textarea {...field} rows={8} value={body} maxLength={8000} disabled={pending} onChange={(e) => setBody(e.target.value)} />
              )}
            </Field>
          </div>
        ) : (
          <div>
            {draft.subject && <p className="text-[13px] font-medium text-fg">{draft.subject}</p>}
            {draft.bodyText && (
              <p className="mt-1 text-[13px] whitespace-pre-wrap text-fg-secondary">{draft.bodyText}</p>
            )}
          </div>
        )}

        {mode === "reject" && (
          <Field label="Why (optional)" hint="Kept with the draft. Its sequence is paused so nothing follows up on it.">
            {(field) => (
              <Input {...field} value={reason} maxLength={500} disabled={pending} placeholder="Wrong angle for this company" onChange={(e) => setReason(e.target.value)} />
            )}
          </Field>
        )}

        {canWrite && (
          <div className="flex flex-wrap items-center gap-2">
            {mode === "read" && (
              <>
                <Button
                  size="sm"
                  variant="primary"
                  icon={Check}
                  disabled={pending}
                  pending={draft.toEmail ? undefined : "This draft has no recipient address, so it cannot be sent."}
                  onClick={() => start(async () => void report(await approveMessageAction(org, draft.id)))}
                >
                  {pending ? "Approving…" : "Approve"}
                </Button>
                <Button size="sm" variant="secondary" icon={Pencil} disabled={pending} onClick={() => setMode("edit")}>
                  Edit
                </Button>
                <Button size="sm" variant="ghost" icon={X} disabled={pending} onClick={() => setMode("reject")}>
                  Reject
                </Button>
              </>
            )}
            {mode === "edit" && (
              <>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      if (report(await editDraftAction(org, draft.id, { subject, body }))) setMode("read");
                    })
                  }
                >
                  {pending ? "Saving…" : "Save changes"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => {
                    setSubject(draft.subject ?? "");
                    setBody(draft.bodyText ?? "");
                    setErrors({});
                    setMode("read");
                  }}
                >
                  Cancel
                </Button>
              </>
            )}
            {mode === "reject" && (
              <>
                <Button
                  size="sm"
                  variant="danger"
                  disabled={pending}
                  onClick={() => start(async () => void report(await rejectDraftAction(org, draft.id, reason)))}
                >
                  {pending ? "Rejecting…" : "Reject draft"}
                </Button>
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => setMode("read")}>
                  Cancel
                </Button>
              </>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
