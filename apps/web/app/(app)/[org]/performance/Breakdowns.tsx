"use client";

import Link from "next/link";
import { useState } from "react";
import { Card, CardBody, CardHeader } from "@huntloop/ui";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { BreakdownKey, Segment } from "../../../../lib/performance/compute";

/**
 * Where replies come from — the cohort split five ways, each number one click
 * from the companies behind it.
 *
 * The range beside a rate is its 95% interval. It is shown because "40%" from
 * five companies and "40%" from two hundred are different claims, and the
 * table is where a reader would otherwise compare them as equals.
 */

const TABS: { key: BreakdownKey; label: string }[] = [
  { key: "channel", label: "First channel" },
  { key: "source", label: "Source" },
  { key: "trigger", label: "Trigger" },
  { key: "priority", label: "Priority" },
  { key: "owner", label: "Owner" },
];

const pct = (r: number | null) => (r === null ? "—" : `${Math.round(r * 100)}%`);

export function Breakdowns({
  org,
  breakdowns,
  focus,
}: {
  org: string;
  breakdowns: Record<BreakdownKey, Segment[]>;
  /** Open on this breakdown — e.g. from an insight's "See the numbers". */
  focus?: BreakdownKey;
}) {
  const [tab, setTab] = useState<BreakdownKey>(focus ?? "channel");
  const [open, setOpen] = useState<string | null>(null);
  const rows = breakdowns[tab];

  return (
    <Card flush id="breakdowns">
      <CardHeader
        title="Where replies come from"
        description="Companies first contacted in this period, split by what they had in common. The range is the 95% interval: wide ranges mean small groups."
      />
      <CardBody className="space-y-3">
        <div role="tablist" aria-label="Split by" className="flex flex-wrap gap-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => {
                setTab(t.key);
                setOpen(null);
              }}
              className={[
                "hl-focusable rounded-md px-3 py-1.5 text-[13px] transition-colors duration-[120ms]",
                tab === t.key ? "bg-brand-surface font-medium text-brand-text" : "text-fg-muted hover:text-fg-secondary",
              ].join(" ")}
            >
              {t.label}
            </button>
          ))}
        </div>

        {rows.length === 0 ? (
          <p className="text-[13px] text-fg-muted">
            Nobody was first contacted in this period, so there is nothing to split yet.
          </p>
        ) : (
          <div role="tabpanel" className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-[13px]">
              <thead>
                <tr className="border-b border-line-subtle text-left text-[11px] tracking-label text-fg-muted uppercase">
                  <th scope="col" className="py-2 pr-3 font-medium">Group</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">Contacted</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">Replied</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">Reply rate</th>
                  <th scope="col" className="py-2 text-right font-medium">Meetings</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => {
                  const expanded = open === s.key;
                  return (
                    <SegmentRow
                      key={s.key}
                      org={org}
                      segment={s}
                      expanded={expanded}
                      onToggle={() => setOpen(expanded ? null : s.key)}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function SegmentRow({
  org,
  segment: s,
  expanded,
  onToggle,
}: {
  org: string;
  segment: Segment;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr className="border-b border-line-subtle last:border-0">
        <td className="py-2 pr-3">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            className="hl-focusable inline-flex items-center gap-1 rounded-sm text-left text-fg capitalize hover:text-brand-text"
          >
            {expanded ? (
              <ChevronDown className="size-3.5 shrink-0" strokeWidth={1.75} />
            ) : (
              <ChevronRight className="size-3.5 shrink-0" strokeWidth={1.75} />
            )}
            {s.label}
          </button>
        </td>
        <td className="hl-tabular py-2 pr-3 text-right text-fg-secondary">{s.contacted}</td>
        <td className="hl-tabular py-2 pr-3 text-right text-fg-secondary">{s.replied}</td>
        <td className="hl-tabular py-2 pr-3 text-right text-fg">
          {pct(s.replyRate)}
          {s.interval && (
            <span className="ml-1.5 text-[11px] text-fg-muted">
              ({pct(s.interval[0])}–{pct(s.interval[1])})
            </span>
          )}
        </td>
        <td className="hl-tabular py-2 text-right text-fg-secondary">{s.meetings}</td>
      </tr>
      {expanded && (
        <tr className="border-b border-line-subtle">
          <td colSpan={5} className="pb-3 pl-5">
            <ul className="flex flex-wrap gap-x-3 gap-y-1">
              {s.companies.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/${org}/opportunities/${c.id}`}
                    className="hl-focusable rounded-sm text-[12px] text-fg-secondary underline decoration-line-strong underline-offset-2 hover:text-fg"
                  >
                    {c.name}
                  </Link>
                </li>
              ))}
              {s.contacted > s.companies.length && (
                <li className="text-[12px] text-fg-muted">and {s.contacted - s.companies.length} more</li>
              )}
            </ul>
          </td>
        </tr>
      )}
    </>
  );
}
