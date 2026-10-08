import Link from "next/link";
import { notFound } from "next/navigation";
import { canWrite, currentViewer } from "../../../../../lib/data/membership";
import { getOutreachLog, LIMIT, parseLogFilters } from "../../../../../lib/data/outreach-log";
import { DemoFigures } from "../../DemoFigures";
import { OutreachLogTable } from "./OutreachLogTable";

/**
 * Outreach log — every reach-out on every channel, with what came of it.
 * COMMAND.md §8.1b.
 *
 * For teams who sell over LinkedIn and the phone as much as email: the
 * opportunity page shows one account's history, Performance shows rates, and
 * this is the list in between — who was contacted, how, by whom, and whether
 * they answered. Filters are URL parameters so a manager can send "my
 * LinkedIn reach-outs with no response" as a link.
 */
export default async function OutreachLogPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ org }, query] = await Promise.all([params, searchParams]);
  const viewer = await currentViewer(org);
  if (!viewer) notFound();

  const filters = parseLogFilters(query);
  const { data, source } = await getOutreachLog(org, filters);
  const replyRate = data.total > 0 ? Math.round((data.counts.replied / data.total) * 100) : null;

  return (
    <div className="mx-auto w-full max-w-[1200px] px-6 py-8 lg:px-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="hl-heading text-fg">Outreach log</h1>
          <p className="mt-1 max-w-[680px] text-[13px] text-fg-muted">
            Every reach-out on every channel, newest first. Emails are recorded as they send; log
            LinkedIn messages and calls from Needs you or the opportunity. A touch counts as replied
            when the account answers afterwards on any channel, and as no response after{" "}
            {data.quietAfterBusinessDays} business days of silence.
          </p>
        </div>
        <Link
          href={`/${org}/outreach`}
          className="hl-focusable rounded-sm text-[13px] text-fg-muted hover:text-fg-secondary"
        >
          Campaigns and mailboxes →
        </Link>
      </header>

      {source !== "live" && (
        <div className="mt-6">
          <DemoFigures what="Example data has no reach-outs, so the log is empty." />
        </div>
      )}

      <p className="mt-6 text-[13px] text-fg-secondary" role="status">
        <span className="hl-tabular font-medium text-fg">{data.total}</span> reach-outs in the last{" "}
        {filters.days} days
        {replyRate !== null && (
          <>
            {" · "}
            <span className="hl-tabular">{data.counts.replied}</span> replied ({replyRate}%){" · "}
            <span className="hl-tabular">{data.counts.waiting}</span> waiting{" · "}
            <span className="hl-tabular">{data.counts["no-response"]}</span> no response
          </>
        )}
      </p>
      {data.capped && (
        <p className="mt-1 text-[12px] text-fg-muted">
          Showing the newest {LIMIT}. Narrow the period, channel or person to reach the rest.
        </p>
      )}

      <OutreachLogTable
        org={org}
        rows={data.rows}
        filters={filters}
        people={data.people}
        canWrite={canWrite(viewer)}
        now={new Date().toISOString()}
      />
    </div>
  );
}

export const metadata = { title: "Outreach log" };
