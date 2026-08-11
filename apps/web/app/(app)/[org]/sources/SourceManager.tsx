"use client";

import { useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Freshness,
  SectionLabel,
  StatusDot,
} from "@huntloop/ui";
import { AlertTriangle, Plus, RefreshCw, Sparkles, Trash2 } from "lucide-react";

/**
 * Source management — master context §10.
 *
 * §10 is explicit that the user accepts, removes and adds sources, and that
 * Huntloop's role is to *recommend* based on the ICP. So recommendations sit
 * in their own section with an accept action rather than being silently
 * switched on: a hunt the user did not choose the inputs for is a hunt they
 * cannot reason about, and §77 Principle 7 makes that control a requirement.
 *
 * The failure state is the other half. §58 says a source that fails must not
 * fail the hunt — it is marked unavailable, retried, and surfaced. A source
 * list that only ever shows green is lying by omission on the day it matters.
 */

type Status = "ok" | "degraded" | "unavailable";

interface Source {
  id: string;
  name: string;
  kind: string;
  url: string;
  status: Status;
  lastScanned: string;
  opportunities: number;
  failureCount: number;
  lastError?: string;
}

const ACTIVE: Source[] = [
  {
    id: "the-block",
    name: "The Block",
    kind: "News",
    url: "https://www.theblock.co",
    status: "ok",
    lastScanned: "2026-08-11",
    opportunities: 22,
    failureCount: 0,
  },
  {
    id: "company-blogs",
    name: "Company engineering blogs",
    kind: "Blog",
    url: "—",
    status: "ok",
    lastScanned: "2026-08-11",
    opportunities: 17,
    failureCount: 0,
  },
  {
    id: "github",
    name: "GitHub",
    kind: "Code",
    url: "https://github.com",
    status: "ok",
    lastScanned: "2026-08-11",
    opportunities: 11,
    failureCount: 0,
  },
  {
    id: "job-boards",
    name: "Job boards",
    kind: "Jobs",
    url: "—",
    status: "degraded",
    lastScanned: "2026-08-10",
    opportunities: 9,
    failureCount: 2,
    lastError: "Rate limited — backing off, partial results this cycle.",
  },
  {
    id: "crunchbase",
    name: "Crunchbase",
    kind: "Funding",
    url: "https://www.crunchbase.com",
    status: "unavailable",
    lastScanned: "2026-08-10",
    opportunities: 6,
    failureCount: 9,
    lastError: "HTTP 403 since 06:10. Retrying with backoff.",
  },
];

const RECOMMENDED = [
  { id: "blockworks", name: "Blockworks", kind: "News", why: "Covers the institutional side of your ICP's market." },
  { id: "hn", name: "Hacker News", kind: "Community", why: "Where your ICP's engineers describe problems publicly." },
  { id: "defillama", name: "DeFiLlama", kind: "Funding", why: "TVL and protocol changes for the Web3 half of the ICP." },
];

const STATUS_META: Record<Status, { label: string; variant: "success" | "warning" | "danger" }> = {
  ok: { label: "Healthy", variant: "success" },
  degraded: { label: "Degraded", variant: "warning" },
  unavailable: { label: "Unavailable", variant: "danger" },
};

export function SourceManager({ org }: { org: string }) {
  const [active, setActive] = useState(ACTIVE);
  const [recommended, setRecommended] = useState(RECOMMENDED);

  const failing = active.filter((s) => s.status !== "ok");

  return (
    <div className="mx-auto w-full max-w-[1200px] px-6 py-8 lg:px-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[30px] leading-9 font-semibold text-fg">Sources</h1>
          <p className="mt-1 text-[13px] text-fg-muted">
            {org} · {active.length} monitored · where Huntloop looks for signals
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button icon={RefreshCw} variant="secondary">
            Scan now
          </Button>
          <Button icon={Plus} variant="primary">
            Add a source
          </Button>
        </div>
      </header>

      {/* §58, stated where it changes what the numbers mean: a degraded source
          silently returning fewer results would make the hunt look complete. */}
      {failing.length > 0 && (
        <div className="mt-6 flex items-start gap-2.5 rounded-md border border-warning-border bg-warning-surface px-4 py-3">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" strokeWidth={1.75} />
          <div>
            <p className="text-[13px] text-warning">
              {failing.length} of {active.length} sources are not returning full results.
            </p>
            <p className="mt-0.5 text-[12px] text-fg-secondary">
              The hunt continued without them and will retry. Treat this
              cycle&rsquo;s results as incomplete rather than as an empty market.
            </p>
          </div>
        </div>
      )}

      <section className="mt-8">
        <SectionLabel>Monitored</SectionLabel>
        <Card flush className="mt-3">
          <ul className="divide-y divide-line-subtle">
            {active.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-[13px] font-medium text-fg">
                      {s.name}
                    </span>
                    <Badge variant="neutral">{s.kind}</Badge>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <Freshness date={s.lastScanned} now={new Date("2026-08-11T09:00:00Z")} label="Scanned" />
                    <span className="text-[12px] text-fg-muted">
                      {s.opportunities} opportunities produced
                    </span>
                  </div>
                  {s.lastError && (
                    <p className="mt-1 text-[12px] text-fg-muted">{s.lastError}</p>
                  )}
                </div>

                <StatusDot
                  variant={STATUS_META[s.status].variant}
                  label={STATUS_META[s.status].label}
                />

                <Button
                  size="sm"
                  variant="ghost"
                  icon={Trash2}
                  aria-label={`Remove ${s.name}`}
                  onClick={() => setActive((prev) => prev.filter((x) => x.id !== s.id))}
                />
              </li>
            ))}
          </ul>
        </Card>
      </section>

      <section className="mt-8">
        <Card flush>
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                <Sparkles className="size-4 text-ai" strokeWidth={1.75} />
                Recommended for your ICP
              </span>
            }
            description="Suggested, not enabled. Nothing is scanned until you accept it."
          />
          <CardBody>
            {recommended.length === 0 ? (
              <p className="text-[13px] text-fg-muted">
                No further recommendations. Add your own with “Add a source”.
              </p>
            ) : (
              <ul className="space-y-3">
                {recommended.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-medium text-fg">{r.name}</span>
                        <Badge variant="neutral">{r.kind}</Badge>
                      </div>
                      <p className="mt-0.5 text-[12px] text-fg-muted">{r.why}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          setRecommended((prev) => prev.filter((x) => x.id !== r.id))
                        }
                      >
                        Dismiss
                      </Button>
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => {
                          setActive((prev) => [
                            ...prev,
                            {
                              id: r.id,
                              name: r.name,
                              kind: r.kind,
                              url: "—",
                              status: "ok",
                              lastScanned: "2026-08-11",
                              opportunities: 0,
                              failureCount: 0,
                            },
                          ]);
                          setRecommended((prev) => prev.filter((x) => x.id !== r.id));
                        }}
                      >
                        Accept
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </section>
    </div>
  );
}
