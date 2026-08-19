"use client";

import { useState, useTransition } from "react";
import {
  Badge,
  Button,
  Card,
  CardBody,
  EmptyState,
  FormMessage,
  Freshness,
  SectionLabel,
  Select,
} from "@huntloop/ui";
import { AlertTriangle, Inbox as InboxIcon, Sparkles } from "lucide-react";
import type { Message, MessageEventKind, Thread } from "../../../../lib/data/inbox";
import { setThreadStatusAction } from "./actions";

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
  canWrite,
  now,
}: {
  org: string;
  threads: Thread[];
  canWrite: boolean;
  now: string;
}) {
  const [result, setResult] = useState<
    { ok: true; message?: string } | { ok: false; error: string } | null
  >(null);

  const needsReply = threads.filter((t) => t.awaitingUs && t.status === "open");
  const failing = threads.filter((t) => t.hasFailure);

  if (threads.length === 0) {
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

      <SectionLabel>Conversations</SectionLabel>
      <div className="space-y-4">
        {threads.map((t) => (
          <ThreadCard
            key={t.id}
            org={org}
            thread={t}
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
      <p className="text-[11px] font-medium tracking-[0.06em] text-fg-muted uppercase">
        {label}
      </p>
      <p className="mt-0.5 font-mono text-[18px] text-fg">{value}</p>
    </div>
  );
}

function ThreadCard({
  org,
  thread,
  canWrite,
  now,
  onResult,
}: {
  org: string;
  thread: Thread;
  canWrite: boolean;
  now: string;
  onResult: (r: { ok: true; message?: string } | { ok: false; error: string }) => void;
}) {
  const [pending, start] = useTransition();

  return (
    <Card>
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-[14px] font-medium text-fg">
              {thread.subject ?? "No subject"}
            </h2>
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

          <div className="flex items-center gap-2">
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
            <Button
              size="sm"
              variant="secondary"
              pending="Replying isn't built yet — it needs a connected mailbox, and there's no OAuth flow or token storage."
            >
              Reply
            </Button>
          </div>
        </div>

        <ol className="space-y-3">
          {thread.messages.map((m) => (
            <li key={m.id}>
              <MessageRow message={m} now={now} />
            </li>
          ))}
        </ol>
      </CardBody>
    </Card>
  );
}

function MessageRow({ message, now }: { message: Message; now: string }) {
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
          /* Not "sent". `messages_sent_has_provider_id` in 0004 refuses a send
             time without the provider id that proves it left, so an outbound
             message with no `sent_at` genuinely has not gone. */
          <Badge variant="neutral">Not sent</Badge>
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
