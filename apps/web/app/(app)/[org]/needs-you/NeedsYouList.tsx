"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Badge, Button, Field, FormMessage, Menu, Select, Textarea } from "@huntloop/ui";
import { AlarmClock, CalendarClock, Clock, MessageSquarePlus, PenLine, Sunrise } from "lucide-react";
import type { NeedsYouItem } from "../../../../lib/data/needs-you";
import type { AttentionGroup } from "../../../../lib/needs-you/rank";
import { logActivityAction } from "../opportunities/[id]/activity-actions";
import { snoozeAttentionAction } from "./actions";

/**
 * "Needs you" items, rendered — shared by the dashboard rail and the full
 * `/needs-you` page so the two can never disagree about what an item says.
 *
 * Each item shows four things in a fixed order: what kind of work it is (the
 * badge), whose account it is (the title), why it is here (one sentence the
 * ranker wrote from the facts), and the one action that resolves it. Items
 * about reaching someone also carry the opportunity's why-now and who to
 * reach, and can be logged or drafted from here — the daily loop without a
 * page load per account. Snooze
 * sits beside the action rather than replacing "dismiss": an item that is
 * still true should come back, and dismissing a real reply forever is how a
 * queue starts lying.
 */

const GROUP_LABEL: Record<AttentionGroup, string> = {
  conversations: "Conversations",
  "follow-ups": "Follow-ups",
  opportunities: "New opportunities",
  workspace: "Workspace health",
};

const GROUP_ORDER: AttentionGroup[] = ["conversations", "follow-ups", "opportunities", "workspace"];

type Result = { ok: true; message?: string } | { ok: false; error: string } | null;

export function NeedsYouList({
  org,
  items,
  canWrite = false,
  grouped = false,
  compact = false,
}: {
  org: string;
  items: NeedsYouItem[];
  /** Whether to offer Log touch and Draft. A rendering decision; RLS refuses the write regardless. */
  canWrite?: boolean;
  /** Group under headings (the full page) or keep one ranked list (the rail). */
  grouped?: boolean;
  /** The rail: tighter cards, the reason clamped to two lines. */
  compact?: boolean;
}) {
  const [result, setResult] = useState<Result>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const visible = items.filter((i) => !hidden.has(i.key));

  const onSnoozed = (key: string, res: Result) => {
    setResult(res);
    if (res?.ok) setHidden((prev) => new Set(prev).add(key));
  };

  if (!grouped) {
    return (
      <div className="flex flex-col gap-2">
        <FormMessage result={result} />
        {visible.map((item) => (
          <ItemCard key={item.key} org={org} item={item} canWrite={canWrite} compact={compact} onSnoozed={onSnoozed} onLogged={setResult} />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <FormMessage result={result} />
      {GROUP_ORDER.map((group) => {
        const inGroup = visible.filter((i) => i.group === group);
        if (inGroup.length === 0) return null;
        return (
          <section key={group} aria-labelledby={`needs-you-${group}`}>
            <h2
              id={`needs-you-${group}`}
              className="mb-2 text-[11px] font-medium tracking-label text-fg-muted uppercase"
            >
              {GROUP_LABEL[group]} · {inGroup.length}
            </h2>
            <div className="grid gap-2 md:grid-cols-2">
              {inGroup.map((item) => (
                <ItemCard key={item.key} org={org} item={item} canWrite={canWrite} compact={false} onSnoozed={onSnoozed} onLogged={setResult} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function ItemCard({
  org,
  item,
  canWrite,
  compact,
  onSnoozed,
  onLogged,
}: {
  org: string;
  item: NeedsYouItem;
  canWrite: boolean;
  compact: boolean;
  onSnoozed: (key: string, res: Result) => void;
  onLogged: (res: Result) => void;
}) {
  const [pending, start] = useTransition();
  const [logging, setLogging] = useState(false);
  /* Only items with `context` are about reaching someone (see withContext);
     conversations are answered in the inbox and workspace items have no one. */
  const reachable = Boolean(item.context && item.opportunityId);
  const opportunityHref = item.opportunityId ? `/${org}/opportunities/${item.opportunityId}` : null;

  const snooze = (until: Date) =>
    start(async () => {
      const res = await snoozeAttentionAction(org, item.key, until.toISOString());
      onSnoozed(item.key, res.ok ? { ok: true, message: res.message } : { ok: false, error: res.error });
    });

  return (
    <article
      className="rounded-lg border border-line-subtle bg-surface p-3"
      aria-label={`${item.label}: ${item.title}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant={item.tone} size="sm">
              {item.label}
            </Badge>
            {item.priority && item.priority !== "watch" && item.group !== "workspace" && (
              <span className="text-[11px] text-fg-muted uppercase">{item.priority}</span>
            )}
          </div>
          <div className="mt-1.5 truncate text-[13px] font-medium text-fg">{item.title}</div>
        </div>
        <Menu
          label={`Snooze ${item.title}`}
          align="end"
          trigger={(props) => (
            <button
              {...props}
              type="button"
              disabled={pending}
              aria-label={`Snooze ${item.title}`}
              className="hl-focusable shrink-0 rounded-sm p-1 text-fg-muted transition-colors duration-[120ms] hover:text-fg-secondary disabled:opacity-50"
            >
              <AlarmClock className="size-3.5" strokeWidth={1.75} />
            </button>
          )}
          items={[
            { label: "Later today", icon: Clock, onSelect: () => snooze(laterToday()) },
            { label: "Tomorrow morning", icon: Sunrise, onSelect: () => snooze(tomorrowMorning()) },
            { label: "Next week", icon: CalendarClock, onSelect: () => snooze(nextMonday()) },
          ]}
        />
      </div>

      <p
        className={[
          "mt-1.5 text-[12px] leading-[1.5] text-fg-secondary",
          compact ? "line-clamp-3" : "",
        ].join(" ")}
      >
        {item.why}
      </p>

      {item.context && (
        <dl className="mt-1.5 space-y-0.5 text-[12px] leading-[1.5]">
          {item.context.whyNow && (
            <div className="flex min-w-0 gap-1.5">
              <dt className="shrink-0 text-fg-muted">Why now</dt>
              <dd className="min-w-0 truncate text-fg-secondary" title={item.context.whyNow}>
                {item.context.whyNow}
              </dd>
            </div>
          )}
          <div className="flex min-w-0 gap-1.5">
            <dt className="shrink-0 text-fg-muted">Reach</dt>
            <dd className="min-w-0 truncate text-fg-secondary">
              {item.context.buyer ? (
                <>
                  {item.context.buyer.name}
                  {item.context.buyer.title && <span className="text-fg-muted">, {item.context.buyer.title}</span>}
                </>
              ) : opportunityHref ? (
                <Link href={`${opportunityHref}#decision-makers`} className="hl-focusable rounded-sm underline underline-offset-2">
                  No contact yet — find one
                </Link>
              ) : (
                "No contact yet"
              )}
            </dd>
          </div>
        </dl>
      )}

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        <Button size="sm" variant="secondary" href={item.href} linkComponent={Link} className="flex-1">
          {item.actionLabel}
        </Button>
        {canWrite && reachable && opportunityHref && (
          <>
            <Button
              size="sm"
              variant="ghost"
              icon={MessageSquarePlus}
              aria-expanded={logging}
              onClick={() => setLogging((open) => !open)}
            >
              Log touch
            </Button>
            {/* To the opportunity's assistant with "What should I write?" in
                the box — not sent. Opening a page should not spend money. */}
            <Button
              size="sm"
              variant="ghost"
              icon={PenLine}
              href={`${opportunityHref}?ask=write#ask`}
              linkComponent={Link}
            >
              Draft
            </Button>
          </>
        )}
      </div>

      {logging && item.opportunityId && (
        <LogTouch
          org={org}
          opportunityId={item.opportunityId}
          company={item.title}
          onDone={(res) => {
            setLogging(false);
            onLogged(res);
          }}
          onCancel={() => setLogging(false)}
        />
      )}
    </article>
  );
}

/**
 * The one-step version of the opportunity page's Log activity form: what
 * channel, which way, and an optional note. It writes through the same action,
 * so the stage moves forward and replies become outcomes exactly as they do
 * there. The server revalidates this page, so a resolved item leaves the queue
 * because it is resolved, not because the browser hid it.
 */
function LogTouch({
  org,
  opportunityId,
  company,
  onDone,
  onCancel,
}: {
  org: string;
  opportunityId: string;
  company: string;
  onDone: (res: Result) => void;
  onCancel: () => void;
}) {
  const [channel, setChannel] = useState("linkedin");
  const [direction, setDirection] = useState<"outbound" | "inbound">("outbound");
  const [note, setNote] = useState("");
  const [error, setError] = useState<Result>(null);
  const [pending, start] = useTransition();

  const submit = () =>
    start(async () => {
      const res = await logActivityAction(org, opportunityId, {
        kind: channel === "phone" ? "call" : "message",
        channel,
        direction,
        body: note.trim() || undefined,
      });
      if (res.ok) onDone({ ok: true, message: `${company}: ${res.message ?? "Logged."}` });
      else setError({ ok: false, error: res.error });
    });

  return (
    <div className="mt-2.5 space-y-2 rounded-md border border-line bg-canvas p-2.5">
      <div className="flex flex-wrap gap-2">
        <Field label="Channel" className="min-w-[120px] flex-1">
          {(field) => (
            <Select {...field} value={channel} onChange={(e) => setChannel(e.target.value)} disabled={pending} className="h-8 text-[13px]">
              <option value="linkedin">LinkedIn</option>
              <option value="email">Email</option>
              <option value="phone">Phone</option>
              <option value="other">Other</option>
            </Select>
          )}
        </Field>
        <Field label="What happened" className="min-w-[120px] flex-1">
          {(field) => (
            <Select
              {...field}
              value={direction}
              onChange={(e) => setDirection(e.target.value === "inbound" ? "inbound" : "outbound")}
              disabled={pending}
              className="h-8 text-[13px]"
            >
              <option value="outbound">I reached out</option>
              <option value="inbound">They replied</option>
            </Select>
          )}
        </Field>
      </div>
      <Textarea
        aria-label="Note (optional)"
        placeholder="Note (optional)"
        rows={2}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        disabled={pending}
        className="text-[13px]"
      />
      <FormMessage result={error} />
      <div className="flex gap-1.5">
        <Button size="sm" variant="primary" onClick={submit} disabled={pending}>
          {pending ? "Logging…" : "Log it"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/* ── Snooze times, in the viewer's own clock ─────────────────────────────── */

function laterToday(): Date {
  return new Date(Date.now() + 4 * 3600_000);
}

function tomorrowMorning(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d;
}

function nextMonday(): Date {
  const d = new Date();
  const add = ((8 - d.getDay()) % 7) || 7;
  d.setDate(d.getDate() + add);
  d.setHours(9, 0, 0, 0);
  return d;
}
