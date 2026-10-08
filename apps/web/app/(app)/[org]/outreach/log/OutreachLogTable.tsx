"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  Field,
  FormMessage,
  Freshness,
  Select,
  type Column,
} from "@huntloop/ui";
import { MessageSquareReply, Send } from "lucide-react";
import type { LogFilters, LogRow } from "../../../../../lib/data/outreach-log";
import { OUTCOME_LABEL } from "../../../../../lib/outreach-log/outcome";
import { logActivityAction } from "../../opportunities/[id]/activity-actions";

const CHANNEL_LABEL: Record<string, string> = {
  email: "Email",
  linkedin: "LinkedIn",
  phone: "Phone",
  chat: "Chat",
  other: "Other",
};

const OUTCOME_TONE = { replied: "success", waiting: "neutral", "no-response": "warning" } as const;

type Result = { ok: true; message?: string } | { ok: false; error: string } | null;

export function OutreachLogTable({
  org,
  rows,
  filters,
  people,
  canWrite,
  now,
}: {
  org: string;
  rows: LogRow[];
  filters: LogFilters;
  people: { id: string; name: string }[];
  canWrite: boolean;
  /** The server's clock, so every age on the page is measured from one instant. */
  now: string;
}) {
  const router = useRouter();
  const [navigating, startNav] = useTransition();
  const [result, setResult] = useState<Result>(null);

  /* Filters are the URL, so a filtered log is a link. Replace rather than
     push: Back should leave the log, not step through every select change. */
  const setFilter = (key: keyof LogFilters, value: string) => {
    const next = new URLSearchParams();
    const merged = { ...filters, [key]: value };
    if (merged.days !== 30) next.set("days", String(merged.days));
    if (merged.channel !== "all") next.set("channel", merged.channel);
    if (merged.person !== "all") next.set("person", merged.person);
    if (merged.outcome !== "all") next.set("outcome", merged.outcome);
    const qs = next.toString();
    startNav(() => router.replace(`/${org}/outreach/log${qs ? `?${qs}` : ""}`));
  };

  const filtered =
    filters.channel !== "all" || filters.person !== "all" || filters.outcome !== "all";

  const columns: Column<LogRow>[] = [
    {
      key: "when",
      header: "When",
      width: "112px",
      render: (r) => <Freshness date={r.occurredAt} now={now} />,
    },
    {
      key: "company",
      header: "Account",
      width: "24%",
      render: (r) => (
        <Link href={`/${org}/opportunities/${r.opportunityId}`} className="hl-focusable block min-w-0 rounded-sm">
          <div className="truncate font-medium text-fg">{r.company}</div>
          {r.contact && <div className="truncate text-[12px] text-fg-muted">{r.contact}</div>}
        </Link>
      ),
    },
    {
      key: "channel",
      header: "Channel",
      width: "96px",
      render: (r) => <span className="text-fg-secondary">{CHANNEL_LABEL[r.channel] ?? r.channel}</span>,
    },
    {
      key: "summary",
      header: "What",
      render: (r) =>
        r.href ? (
          <Link href={r.href} className="hl-focusable block truncate rounded-sm text-fg-secondary hover:text-fg">
            {r.summary}
          </Link>
        ) : (
          <span className="block truncate text-fg-secondary">{r.summary}</span>
        ),
    },
    {
      key: "by",
      header: "By",
      width: "120px",
      render: (r) => <span className="block truncate text-fg-secondary">{r.by}</span>,
    },
    {
      key: "outcome",
      header: "Outcome",
      width: "176px",
      render: (r) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={OUTCOME_TONE[r.outcome]} size="sm">
            {OUTCOME_LABEL[r.outcome]}
          </Badge>
          {canWrite && r.outcome !== "replied" && (
            <GotAReply org={org} row={r} onResult={setResult} />
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <div className="mt-4 flex flex-wrap items-end gap-3" aria-busy={navigating}>
        <FilterSelect
          label="Period"
          value={String(filters.days)}
          onChange={(v) => setFilter("days", v)}
          options={[
            ["7", "Last 7 days"],
            ["30", "Last 30 days"],
            ["90", "Last 90 days"],
          ]}
        />
        <FilterSelect
          label="Channel"
          value={filters.channel}
          onChange={(v) => setFilter("channel", v)}
          options={[["all", "All channels"], ...Object.entries(CHANNEL_LABEL)]}
        />
        <FilterSelect
          label="Person"
          value={filters.person}
          onChange={(v) => setFilter("person", v)}
          options={[
            ["all", "Everyone"],
            ["me", "Me"],
            ...people.filter((p) => p.name !== "You").map((p): [string, string] => [p.id, p.name]),
          ]}
        />
        <FilterSelect
          label="Outcome"
          value={filters.outcome}
          onChange={(v) => setFilter("outcome", v)}
          options={[
            ["all", "Any outcome"],
            ["replied", "Replied"],
            ["waiting", "Waiting"],
            ["no-response", "No response"],
          ]}
        />
      </div>

      <FormMessage result={result} className="mt-3" />

      <DataTable
        label="Reach-outs"
        className="mt-3"
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        empty={
          <EmptyState
            className="border-0 bg-transparent"
            icon={Send}
            title={filtered ? "No reach-outs match these filters" : "No reach-outs in this period"}
            description={
              filtered
                ? "Try another channel, person or outcome."
                : "Emails appear here as they send. Log a LinkedIn message or a call from Needs you or an opportunity and it appears here too."
            }
            action={
              <Button variant="secondary" href={`/${org}/needs-you`} linkComponent={Link}>
                Open Needs you
              </Button>
            }
          />
        }
      />
    </>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: [string, string][];
}) {
  return (
    <Field label={label} className="min-w-[140px]">
      {(field) => (
        <Select {...field} value={value} onChange={(e) => onChange(e.target.value)} className="h-8 text-[13px]">
          {options.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

/**
 * One click: they answered. Logged as an inbound touch on the same channel, so
 * it does everything a reply logged on the opportunity does — moves the stage
 * to Replied, records the reply outcome the learning loop reads — and the row
 * turns Replied because the ledger now says so.
 */
function GotAReply({
  org,
  row,
  onResult,
}: {
  org: string;
  row: LogRow;
  onResult: (r: Result) => void;
}) {
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="ghost"
      icon={MessageSquareReply}
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await logActivityAction(org, row.opportunityId, {
            kind: row.channel === "phone" ? "call" : "message",
            channel: row.channel,
            direction: "inbound",
          });
          onResult(
            res.ok
              ? { ok: true, message: `${row.company}: ${res.message ?? "Logged."}` }
              : { ok: false, error: res.error },
          );
        })
      }
    >
      {pending ? "Logging…" : "Got a reply"}
    </Button>
  );
}
