"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import {
  Badge,
  Card,
  FormMessage,
  PriorityBadge,
  Select,
  type Priority,
} from "@huntloop/ui";
import type { Assignment } from "../../../../lib/data/team";
import { setOpportunityStatusAction } from "./actions";

/**
 * The pipeline — the `opportunity_status` enum from `0003`, as a board.
 *
 * ── Why the columns are a subset, and why the rest are not hidden ────────
 *
 * The enum has eleven states. Eight of them are a pipeline — `discovered`
 * through `won` — and three are terminal or out of band: `lost`, `archived`,
 * and `ignore`-like states that would each add a column nobody drags into.
 * Rendering all eleven makes the board unreadable at the width a board is
 * useful; rendering eight and *dropping* the others would make an opportunity
 * disappear when it is marked lost, which is the worse failure. So the closed
 * states get one shared column at the end, and the count is honest.
 *
 * ── Why this is a select and not drag-and-drop ───────────────────────────
 *
 * A board implies dragging, and dragging that works properly is a keyboard
 * story, a touch story and a live-region story — A11Y-01/02/03 are in this
 * repo's history for a reason. A per-card stage select is operable by
 * everybody on day one and writes exactly the same column. When drag lands it
 * should be added alongside this control, not instead of it.
 */

/** In pipeline order. The order is the product's, not the enum's declaration. */
const STAGES = [
  { key: "discovered", label: "Discovered" },
  { key: "researching", label: "Researching" },
  { key: "qualified", label: "Qualified" },
  { key: "assigned", label: "Assigned" },
  { key: "contacted", label: "Contacted" },
  { key: "replied", label: "Replied" },
  { key: "meeting", label: "Meeting" },
  { key: "proposal", label: "Proposal" },
  { key: "won", label: "Won" },
] as const;

/** Everything that has left the pipeline, in one column rather than three. */
const CLOSED = ["lost", "archived"] as const;

const ALL_STATUSES = [...STAGES.map((s) => s.key), ...CLOSED] as const;

export function PipelineBoard({
  org,
  opportunities,
  canWrite,
}: {
  org: string;
  opportunities: Assignment[];
  canWrite: boolean;
}) {
  const [result, setResult] = useState<
    { ok: true; message?: string } | { ok: false; error: string } | null
  >(null);

  const columns = useMemo(() => {
    const byStage = new Map<string, Assignment[]>();
    for (const stage of STAGES) byStage.set(stage.key, []);
    byStage.set("closed", []);

    for (const o of opportunities) {
      const key = (CLOSED as readonly string[]).includes(o.status) ? "closed" : o.status;
      // A status the board does not know about still has to appear somewhere,
      // or an opportunity silently vanishes from the only screen that shows
      // the whole pipeline.
      (byStage.get(key) ?? byStage.get("closed"))!.push(o);
    }
    return byStage;
  }, [opportunities]);

  return (
    <div className="space-y-4">
      <FormMessage result={result} />

      {/*
        The board scrolls inside its own container. The page body must never
        scroll sideways — ten columns at a readable width exceed any viewport,
        and a horizontally scrolling document drags the sidebar off with it.

        ── `relative` is load-bearing, and `overflow-x-auto` alone is not ──

        `overflow` only clips descendants it is the containing block for. An
        absolutely positioned element resolves its containing block to the
        nearest *positioned* ancestor, so while this div was `static` every
        `sr-only` span inside the board — one per `PriorityBadge`, one per
        stage `<select>` label — hung off an ancestor further up and escaped
        the clip entirely. Each sits at the x-offset of its column, up to
        2,500px out, and the document grew to match.

        It is invisible in every direction you would normally look. The spans
        are screen-reader-only so nothing appears on screen; the computed
        styles all read correctly (this box `overflow-x: auto` at 364px,
        `main` above it `overflow-y: auto`, the shell above that
        `overflow: hidden`); and walking the tree for wide elements finds
        nothing, because the offenders are 1px wide. The only symptom is
        `documentElement.scrollWidth` — 2493 against a 412 viewport — and a
        page that really does scroll sideways, dragging the sidebar with it.

        Making this div `relative` gives those spans a containing block inside
        the scroller, so it clips them. The same reason there is no
        `-mx-6 … px-6` bleed to the page edge: it widens this box past its
        container and leaks the overflow a second way, for a cosmetic gain.

        `e2e/engage.spec.ts` asserts the page cannot scroll sideways, on both
        viewport projects — which is what turns this from a comment into
        something that stays true. It was the mobile project that caught it.
      */}
      <div className="relative overflow-x-auto pb-4">
        <div className="flex min-w-max gap-3">
          {[...STAGES, { key: "closed", label: "Closed" } as const].map((stage) => {
            const cards = columns.get(stage.key) ?? [];
            return (
              <section key={stage.key} className="w-[260px] shrink-0">
                <header className="flex items-center justify-between px-1 pb-2">
                  <h2 className="text-[11px] font-medium tracking-[0.06em] text-fg-muted uppercase">
                    {stage.label}
                  </h2>
                  <span className="font-mono text-[12px] text-fg-muted">{cards.length}</span>
                </header>

                <div className="space-y-2">
                  {cards.length === 0 ? (
                    <p className="rounded-md border border-dashed border-line px-3 py-4 text-center text-[12px] text-fg-muted">
                      Nothing here
                    </p>
                  ) : (
                    cards.map((o) => (
                      <PipelineCard
                        key={o.id}
                        org={org}
                        opportunity={o}
                        canWrite={canWrite}
                        onResult={setResult}
                      />
                    ))
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function PipelineCard({
  org,
  opportunity,
  canWrite,
  onResult,
}: {
  org: string;
  opportunity: Assignment;
  canWrite: boolean;
  onResult: (r: { ok: true; message?: string } | { ok: false; error: string }) => void;
}) {
  const [pending, start] = useTransition();

  return (
    <Card className="p-3">
      <Link
        href={`/${org}/opportunities/${opportunity.id}`}
        className="hl-focusable block truncate text-[13px] font-medium text-fg underline-offset-2 hover:underline"
      >
        {opportunity.company}
      </Link>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <PriorityBadge
          priority={opportunity.priority as Priority}
          reason={opportunity.priorityReason}
        />
        {opportunity.ownerId ? (
          <Badge variant="neutral">{opportunity.ownerIsYou ? "Yours" : "Assigned"}</Badge>
        ) : (
          <Badge variant="neutral">Unassigned</Badge>
        )}
      </div>

      {canWrite && (
        <label className="mt-2 block">
          <span className="sr-only">Stage for {opportunity.company}</span>
          <Select
            value={opportunity.status}
            disabled={pending}
            className="mt-0 h-8 text-[12px]"
            onChange={(e) =>
              start(async () => {
                const res = await setOpportunityStatusAction(
                  org,
                  opportunity.id,
                  e.target.value,
                );
                onResult(
                  res.ok ? { ok: true, message: res.message } : { ok: false, error: res.error },
                );
              })
            }
          >
            {ALL_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </label>
      )}
    </Card>
  );
}
