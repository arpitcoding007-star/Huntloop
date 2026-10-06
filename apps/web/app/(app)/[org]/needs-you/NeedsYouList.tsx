"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Badge, Button, FormMessage, Menu } from "@huntloop/ui";
import { AlarmClock, CalendarClock, Clock, Sunrise } from "lucide-react";
import type { AttentionGroup, RankedItem } from "../../../../lib/needs-you/rank";
import { snoozeAttentionAction } from "./actions";

/**
 * "Needs you" items, rendered — shared by the dashboard rail and the full
 * `/needs-you` page so the two can never disagree about what an item says.
 *
 * Each item shows four things in a fixed order: what kind of work it is (the
 * badge), whose account it is (the title), why it is here (one sentence the
 * ranker wrote from the facts), and the one action that resolves it. Snooze
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
  grouped = false,
  compact = false,
}: {
  org: string;
  items: RankedItem[];
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
          <ItemCard key={item.key} org={org} item={item} compact={compact} onSnoozed={onSnoozed} />
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
                <ItemCard key={item.key} org={org} item={item} compact={false} onSnoozed={onSnoozed} />
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
  compact,
  onSnoozed,
}: {
  org: string;
  item: RankedItem;
  compact: boolean;
  onSnoozed: (key: string, res: Result) => void;
}) {
  const [pending, start] = useTransition();

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

      <div className="mt-2.5">
        <Button size="sm" variant="secondary" href={item.href} linkComponent={Link} className="w-full">
          {item.actionLabel}
        </Button>
      </div>
    </article>
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
