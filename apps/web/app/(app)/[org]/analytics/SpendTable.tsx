"use client";

import {
  Badge,
  DataTable,
  EmptyState,
  Freshness,
  type Column,
} from "@huntloop/ui";
import { Zap } from "lucide-react";
import type { SpendRun } from "../../../../lib/data/spend";

/**
 * The runs table.
 *
 * Split out of `page.tsx` for a concrete reason rather than tidiness:
 * `DataTable` is a Client Component, and its `columns` carry a `render`
 * function per column. Functions cannot cross the server→client boundary, so
 * building those columns in the Server Component throws at request time —
 * "Functions cannot be passed directly to Client Components". The columns have
 * to be constructed on the client side of the boundary, which means here.
 *
 * The page keeps the data loading and the membership check; this takes plain
 * serialisable rows. That is the right split anyway: the query and the
 * authorisation stay on the server, and only the presentation is shipped.
 *
 * `now` is passed in rather than read from the clock here, because `Freshness`
 * renders a relative time — computing it from `new Date()` inside a client
 * component gives one string on the server and a different one in the browser,
 * and React reports a hydration mismatch.
 */
export function SpendTable({
  runs,
  now,
  formatMoney,
  labelForTask,
}: {
  runs: SpendRun[];
  now: string;
  /** Serialisable inputs only — hence a lookup table, not a formatter. */
  formatMoney: Record<string, string>;
  labelForTask: Record<string, string>;
}) {
  const columns: Column<SpendRun>[] = [
    {
      key: "task",
      header: "Task",
      width: "24%",
      render: (run) => (
        <div className="min-w-0">
          <div className="truncate text-fg">{labelForTask[run.task] ?? run.task}</div>
          <div className="truncate font-mono text-[11px] text-fg-muted">{run.model}</div>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      width: "124px",
      render: (run) =>
        run.status === "succeeded" ? (
          <Badge variant="success">Succeeded</Badge>
        ) : run.status === "failed" ? (
          <Badge variant="danger">Failed</Badge>
        ) : (
          // Not "Running". A row can sit in this state because the function
          // died, and calling that "running" hides the thing worth noticing.
          <Badge variant="warning">No outcome</Badge>
        ),
    },
    {
      key: "cost",
      header: "Cost",
      width: "96px",
      align: "right",
      render: (run) => (
        <span className="hl-tabular text-fg">{formatMoney[run.id] ?? "—"}</span>
      ),
    },
    {
      key: "tokens",
      header: "Tokens",
      width: "200px",
      align: "right",
      render: (run) => (
        <span className="hl-tabular text-[12px] text-fg-muted">
          {run.inputTokens.toLocaleString()} in · {run.outputTokens.toLocaleString()} out
          {run.cacheReadTokens > 0 && (
            <> · {run.cacheReadTokens.toLocaleString()} cached</>
          )}
        </span>
      ),
    },
    {
      key: "latency",
      header: "Latency",
      width: "96px",
      align: "right",
      render: (run) => (
        <span className="hl-tabular text-[12px] text-fg-muted">
          {run.latencyMs === null ? "—" : `${(run.latencyMs / 1000).toFixed(1)}s`}
        </span>
      ),
    },
    {
      key: "when",
      header: "When",
      width: "150px",
      render: (run) => <Freshness date={run.createdAt} now={now} />,
    },
  ];

  return (
    <DataTable
      className="mt-3"
      rows={runs}
      columns={columns}
      rowKey={(run) => run.id}
      empty={
        <EmptyState
          className="border-0 bg-transparent"
          icon={Zap}
          title="No model calls yet"
          description="Analyze a company or run onboarding, and every call will be recorded here with what it cost."
        />
      }
    />
  );
}
