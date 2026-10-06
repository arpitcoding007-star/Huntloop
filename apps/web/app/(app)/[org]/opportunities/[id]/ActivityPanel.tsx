"use client";

import Link from "next/link";
import { useState, useTransition, type ComponentType } from "react";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Field,
  FormMessage,
  Freshness,
  Input,
  Select,
  Textarea,
} from "@huntloop/ui";
import {
  ArrowRightLeft,
  Ban,
  CircleSlash,
  Flag,
  Linkedin,
  Mail,
  MailWarning,
  MessageSquare,
  Phone,
  Plus,
  Search,
  StickyNote,
  ThumbsDown,
  Trash2,
  UserCheck,
  UserPlus,
  Users,
} from "lucide-react";
import type { Timeline, TimelineItem } from "../../../../../lib/data/activity";
import { deleteActivityAction, logActivityAction } from "./activity-actions";
import { dueInstant } from "./NextStepBar";

/**
 * The relationship timeline — everything that happened with this account, on
 * every channel, newest first. COMMAND.md §16.3-A.
 *
 * Email rows come from the ledger's triggers and cannot be forgotten; the rest
 * is what people log here. System rows (stage and band moves, the engine's own
 * steps) are rendered quieter than human ones, because a reader scanning a
 * history is looking for what people said and did.
 */

type Icon = ComponentType<{ className?: string; strokeWidth?: number }>;

function iconFor(item: TimelineItem): Icon {
  switch (item.kind) {
    case "email_sent":
    case "email_received":
      return Mail;
    case "email_bounced":
    case "email_complained":
    case "email_unsubscribed":
      return MailWarning;
    case "draft_rejected":
      return Ban;
    case "stage_changed":
      return ArrowRightLeft;
    case "priority_changed":
      return Flag;
    case "owner_changed":
      return UserCheck;
    case "override_recorded":
      return ThumbsDown;
    case "outcome_recorded":
      return CircleSlash;
    case "discovered":
      return Search;
    case "note":
      return StickyNote;
    case "call":
      return Phone;
    case "meeting":
      return Users;
    case "connection_request":
      return UserPlus;
    case "message":
      return item.channel === "linkedin" ? Linkedin : item.channel === "email" ? Mail : MessageSquare;
  }
}

const SYSTEM_KINDS = new Set(["stage_changed", "priority_changed", "owner_changed", "discovered"]);

type Result = { ok: true; message?: string } | { ok: false; error: string } | null;

export function ActivityPanel({
  org,
  opportunityId,
  timeline,
  people,
  canWrite,
  now,
}: {
  org: string;
  opportunityId: string;
  timeline: Timeline;
  people: { id: string; name: string; title: string }[];
  canWrite: boolean;
  now: string;
}) {
  const [logging, setLogging] = useState(false);
  const [result, setResult] = useState<Result>(null);

  return (
    <Card flush>
      <CardHeader
        title="Activity"
        description="Every touch on every channel. Email is recorded automatically; log the rest here."
        actions={
          canWrite && !logging ? (
            <Button size="sm" variant="secondary" icon={Plus} onClick={() => setLogging(true)}>
              Log activity
            </Button>
          ) : undefined
        }
      />
      <CardBody className="space-y-4">
        {logging && (
          <LogActivityForm
            org={org}
            opportunityId={opportunityId}
            people={people}
            onDone={(res) => {
              if (res) setResult(res);
              if (!res || res.ok) setLogging(false);
            }}
          />
        )}
        <FormMessage result={result} />

        {timeline.items.length === 0 ? (
          <p className="text-[13px] text-fg-muted">
            Nothing has happened with this account yet. When an email goes out or arrives it appears
            here on its own; log a LinkedIn message, a call or a meeting with “Log activity”.
          </p>
        ) : (
          <ol className="relative space-y-0">
            {timeline.items.map((item, i) => (
              <TimelineRow
                key={item.id}
                org={org}
                item={item}
                now={now}
                last={i === timeline.items.length - 1}
                onResult={setResult}
              />
            ))}
          </ol>
        )}

        {timeline.hasMore && (
          <p className="text-[12px] text-fg-muted">Showing the 50 most recent. Older history is kept.</p>
        )}
        {timeline.ledgerStartedAt && timeline.items.length > 0 && (
          <p className="text-[11px] text-fg-muted">
            Stage changes are recorded from{" "}
            {new Date(timeline.ledgerStartedAt).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
            . Earlier history shows email and recorded outcomes only.
          </p>
        )}
      </CardBody>
    </Card>
  );
}

function TimelineRow({
  org,
  item,
  now,
  last,
  onResult,
}: {
  org: string;
  item: TimelineItem;
  now: string;
  last: boolean;
  onResult: (r: Result) => void;
}) {
  const [pending, start] = useTransition();
  const Glyph = iconFor(item);
  const quiet = SYSTEM_KINDS.has(item.kind);
  const who =
    item.actorType === "contact" ? "They" : item.actor ?? (item.actorType === "system" ? "Huntloop" : null);

  return (
    <li className="relative flex gap-3 pb-4">
      {!last && <span aria-hidden className="absolute top-7 bottom-0 left-[13px] w-px bg-line-subtle" />}
      <span
        className={[
          "relative z-[1] flex size-7 shrink-0 items-center justify-center rounded-full border",
          quiet ? "border-line-subtle bg-canvas text-fg-muted" : "border-line bg-surface text-fg-secondary",
        ].join(" ")}
      >
        <Glyph className="size-3.5" strokeWidth={1.75} />
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className={quiet ? "text-[13px] text-fg-muted" : "text-[13px] font-medium text-fg"}>
            {item.summary}
          </span>
          {who && <span className="text-[12px] text-fg-muted">· {who}</span>}
          <span className="ml-auto">
            <Freshness date={item.occurredAt} now={new Date(now)} label="" />
          </span>
        </div>
        {item.detail &&
          (item.href ? (
            <Link
              href={item.href}
              className="hl-focusable mt-0.5 block truncate rounded-sm text-[12px] text-fg-secondary underline decoration-line-strong underline-offset-2 hover:text-fg"
            >
              {item.detail}
            </Link>
          ) : (
            <p className="mt-0.5 text-[12px] text-fg-secondary">{item.detail}</p>
          ))}
        {item.body && (
          <p className="mt-1 text-[13px] leading-[1.55] whitespace-pre-wrap text-fg-secondary">{item.body}</p>
        )}
        {item.mine && (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await deleteActivityAction(org, item.id);
                onResult(res.ok ? { ok: true, message: res.message } : { ok: false, error: res.error });
              })
            }
            className="hl-focusable mt-1 inline-flex items-center gap-1 rounded-sm text-[11px] text-fg-muted transition-colors duration-[120ms] hover:text-danger disabled:opacity-50"
          >
            <Trash2 className="size-3" strokeWidth={1.75} />
            Remove
          </button>
        )}
      </div>
    </li>
  );
}

/* ── Logging ─────────────────────────────────────────────────────────────── */

type Kind = "message" | "call" | "meeting" | "connection_request" | "note";

const KINDS: { value: Kind; label: string }[] = [
  { value: "message", label: "Message" },
  { value: "call", label: "Call" },
  { value: "meeting", label: "Meeting" },
  { value: "connection_request", label: "Connection request" },
  { value: "note", label: "Note" },
];

const MESSAGE_CHANNELS = [
  { value: "linkedin", label: "LinkedIn" },
  { value: "email", label: "Email (outside Huntloop)" },
  { value: "chat", label: "Chat (Telegram, Slack, WhatsApp…)" },
  { value: "other", label: "Other" },
];

function channelFor(kind: Kind, messageChannel: string): string {
  if (kind === "call") return "phone";
  if (kind === "meeting") return "meeting";
  if (kind === "connection_request") return "linkedin";
  if (kind === "note") return "other";
  return messageChannel;
}

/** Now, in the viewer's zone, as `<input type="datetime-local">` wants it. */
function localNow(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function LogActivityForm({
  org,
  opportunityId,
  people,
  onDone,
}: {
  org: string;
  opportunityId: string;
  people: { id: string; name: string; title: string }[];
  onDone: (result: Result) => void;
}) {
  const [kind, setKind] = useState<Kind>("message");
  const [messageChannel, setMessageChannel] = useState("linkedin");
  const [direction, setDirection] = useState<"outbound" | "inbound">("outbound");
  const [personId, setPersonId] = useState("");
  const [summary, setSummary] = useState("");
  const [body, setBody] = useState("");
  const [when, setWhen] = useState(localNow());
  const [stepText, setStepText] = useState("");
  const [stepDate, setStepDate] = useState("");
  const [feedback, setFeedback] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();

  const twoWay = kind === "message" || kind === "call";

  return (
    <form
      className="space-y-3 rounded-md border border-line bg-canvas p-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await logActivityAction(org, opportunityId, {
            kind,
            channel: channelFor(kind, messageChannel),
            direction: kind === "note" ? "internal" : kind === "connection_request" ? "outbound" : twoWay ? direction : "outbound",
            summary,
            body,
            occurredAt: when ? new Date(when).toISOString() : undefined,
            personId: personId || null,
            nextStep: stepText.trim() ? { text: stepText, dueAt: dueInstant(stepDate) } : null,
            productFeedback: feedback,
          });
          if (!res.ok) setErrors(res.fieldErrors ?? {});
          onDone(res.ok ? { ok: true, message: res.message } : { ok: false, error: res.error });
        });
      }}
    >
      <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">
        <Field label="What">
          {(field) => (
            <Select {...field} value={kind} disabled={pending} onChange={(e) => setKind(e.target.value as Kind)}>
              {KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {kind === "message" && (
          <Field label="Channel" error={errors.channel}>
            {(field) => (
              <Select {...field} value={messageChannel} disabled={pending} onChange={(e) => setMessageChannel(e.target.value)}>
                {MESSAGE_CHANNELS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        {twoWay && (
          <Field label="Who started it" error={errors.direction}>
            {(field) => (
              <Select
                {...field}
                value={direction}
                disabled={pending}
                onChange={(e) => setDirection(e.target.value as "outbound" | "inbound")}
              >
                <option value="outbound">We reached out</option>
                <option value="inbound">They replied or reached out</option>
              </Select>
            )}
          </Field>
        )}
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3">
        {people.length > 0 && kind !== "note" && (
          <Field label="With (optional)">
            {(field) => (
              <Select {...field} value={personId} disabled={pending} onChange={(e) => setPersonId(e.target.value)}>
                <option value="">Nobody in particular</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {p.title}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <Field label="When" error={errors.occurredAt}>
          {(field) => (
            <Input {...field} type="datetime-local" value={when} disabled={pending} onChange={(e) => setWhen(e.target.value)} />
          )}
        </Field>
      </div>

      <Field label="Summary (optional)" hint="Left blank, it is written for you — e.g. “Message sent on LinkedIn”." error={errors.summary}>
        {(field) => (
          <Input {...field} value={summary} maxLength={200} disabled={pending} onChange={(e) => setSummary(e.target.value)} />
        )}
      </Field>
      <Field label={kind === "note" ? "Note" : "Notes (optional)"} error={errors.body}>
        {(field) => (
          <Textarea
            {...field}
            rows={3}
            value={body}
            maxLength={5000}
            disabled={pending}
            placeholder={kind === "meeting" ? "What was agreed, who was there, what they asked for" : ""}
            onChange={(e) => setBody(e.target.value)}
          />
        )}
      </Field>

      <label className="flex items-start gap-2 text-[13px] text-fg-secondary">
        <input
          type="checkbox"
          checked={feedback}
          disabled={pending}
          onChange={(e) => setFeedback(e.target.checked)}
          className="mt-0.5 size-4 accent-[var(--color-brand)]"
        />
        <span>
          They asked for something we don&rsquo;t have, or objected to something
          <span className="block text-[12px] text-fg-muted">Counted under Prospect demand, so it can shape the roadmap.</span>
        </span>
      </label>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">
        <Field label="Then (optional next step)" error={errors["nextStep.text"]}>
          {(field) => (
            <Input
              {...field}
              value={stepText}
              maxLength={280}
              disabled={pending}
              placeholder="Follow up if no answer"
              onChange={(e) => setStepText(e.target.value)}
            />
          )}
        </Field>
        <Field label="Due">
          {(field) => (
            <Input {...field} type="date" value={stepDate} disabled={pending} onChange={(e) => setStepDate(e.target.value)} />
          )}
        </Field>
      </div>

      <p className="text-[12px] text-fg-muted">
        {kind === "meeting"
          ? "Logging a meeting moves the opportunity to Meeting if it is earlier in the pipeline."
          : twoWay && direction === "inbound"
            ? "Logging a reply moves the opportunity to Replied and stops any sequence on it."
            : kind !== "note"
              ? "Logging an outreach moves a new opportunity to Contacted."
              : "Notes are internal and change nothing else."}
      </p>

      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" variant="primary" disabled={pending}>
          {pending ? "Logging…" : "Log it"}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => onDone(null)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
