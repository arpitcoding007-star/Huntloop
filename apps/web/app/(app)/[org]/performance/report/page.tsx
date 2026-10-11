import Link from "next/link";
import { notFound } from "next/navigation";
import { getShellChrome } from "../../../../../lib/data/chrome";
import { listCompetitors } from "../../../../../lib/data/competitor-intel";
import { currentViewer } from "../../../../../lib/data/membership";
import { getPerformance, type PerformanceScope } from "../../../../../lib/data/performance";
import { PERIODS, PERIOD_LABEL, type Period } from "../../../../../lib/performance/compute";
import { BrandLink } from "../../../../BrandLink";
import { PrintButton } from "./PrintButton";

/**
 * Share report — Performance and competitors on one printable page. §9.1c.
 *
 * Not a reports menu: the same figures Performance computes, laid out for
 * paper, so a founder can send the week's numbers to a co-founder or an
 * investor as a PDF (the browser's "Save as PDF"). Nothing here is typed in or
 * estimated; every number is the one the Performance screen shows for the same
 * period and scope, and competitors are the workspace's accepted ones.
 */

const pct = (r: number | null) => (r === null ? "—" : `${Math.round(r * 100)}%`);
const money = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;
const days = (d: number | null) => (d === null ? "—" : d < 1 ? "<1 day" : `${Math.round(d * 10) / 10} days`);

export default async function PerformanceReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<{ period?: string; scope?: string }>;
}) {
  const [{ org }, query] = await Promise.all([params, searchParams]);
  const viewer = await currentViewer(org);
  if (!viewer) notFound();

  const period: Period = (PERIODS as readonly string[]).includes(query.period ?? "") ? (query.period as Period) : "30d";
  const scope: PerformanceScope = query.scope === "mine" ? "mine" : "everyone";

  const [{ data, source }, chrome, { data: competitors }] = await Promise.all([
    getPerformance(org, period, scope),
    getShellChrome(org),
    listCompetitors(org),
  ]);
  const p = data.performance;
  const f = p.funnel;
  const prev = p.previousFunnel;
  const active = competitors.filter((c) => c.status === "active");
  const generated = new Date().toISOString().slice(0, 10);

  return (
    <div className="mx-auto w-full max-w-[900px] px-4 py-8 print:max-w-none print:p-0 sm:px-6 lg:px-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link
          href={`/${org}/performance?period=${period}&scope=${scope}`}
          className="hl-focusable rounded-sm text-[13px] text-fg-muted hover:text-fg-secondary"
        >
          ← Back to Performance
        </Link>
        <PrintButton />
      </div>

      {/* Always the light theme: this is a sheet of paper, on screen and printed
          (`data-theme` re-scopes every colour token for the subtree). */}
      <article
        data-theme="light"
        className="rounded-lg border border-line-subtle bg-surface px-5 py-6 text-fg shadow-card print:border-0 print:p-0 print:shadow-none sm:px-8"
      >
      <header className="border-b border-line pb-4">
        {/* The logo board's share-report lockup: mark + wordmark, light. */}
        <div className="mb-5">
          <BrandLink />
        </div>
        <p className="text-[12px] text-fg-muted">{chrome.orgName}</p>
        <h1 className="mt-1 text-[24px] font-semibold tracking-[-0.02em]">Performance report</h1>
        <p className="mt-1 text-[13px] text-fg-secondary">
          {PERIOD_LABEL[period]} ({p.window.from.slice(0, 10)} to {p.window.to.slice(0, 10)}) ·{" "}
          {scope === "mine" ? "Opportunities owned by the person who made this report" : "Whole workspace"} · generated{" "}
          {generated}
        </p>
        {source !== "live" && (
          <p className="mt-2 text-[12px] text-warning-text">
            Example data — this deployment has no database connected. Nothing here describes a real company.
          </p>
        )}
        {data.partial && <p className="mt-2 text-[12px] text-warning-text">{data.partial}</p>}
      </header>

      <Section title="What the data says">
        {p.insights.length === 0 ? (
          <p className="text-[13px] text-fg-secondary">
            Nothing stands out: no group differs from the rest by more than chance, and nothing is stalled.
          </p>
        ) : (
          <ul className="list-disc space-y-2 pl-5 text-[13px]">
            {p.insights.map((i) => (
              <li key={i.id}>
                {i.headline} <span className="text-fg-muted">{i.basis}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Funnel">
        <Table
          head={["", "This period", "Previous period"]}
          rows={[
            ["Found", f.discovered, prev.discovered],
            ["Qualified (hot or warm)", f.qualified, prev.qualified],
            ["First contacted", f.contacted, prev.contacted],
            ["First replied", f.replied, prev.replied],
            ["Positive replies", f.positive, prev.positive],
            ["Meetings", f.meetings, prev.meetings],
            ["Won", f.won, prev.won],
            ["Reply rate (of first contacted)", pct(p.cohort.replyRate), pct(p.previousCohort.replyRate)],
            ["Meeting rate (of first contacted)", pct(p.cohort.meetingRate), pct(p.previousCohort.meetingRate)],
            ["Median time to a reply", days(p.cohort.medianDaysToReply), days(p.previousCohort.medianDaysToReply)],
          ]}
        />
      </Section>

      <Section title="Pipeline value">
        <p className="text-[13px]">
          Open pipeline <strong>{money(p.pipeline.openCents)}</strong> from {p.pipeline.openWithValue} of{" "}
          {p.pipeline.openCount} open deals with a value entered. Won this period{" "}
          <strong>{money(p.pipeline.wonCents)}</strong> ({p.pipeline.wonCount} won, {p.pipeline.wonWithValue} with a
          value). Deals without a value are counted, never estimated.
        </p>
      </Section>

      <Section title="Where replies come from (first channel)">
        {p.breakdowns.channel.length === 0 ? (
          <p className="text-[13px] text-fg-secondary">Nobody was first contacted in this period.</p>
        ) : (
          <Table
            head={["Channel", "Contacted", "Replied", "Reply rate", "Meetings"]}
            rows={p.breakdowns.channel.map((s) => [s.label, s.contacted, s.replied, pct(s.replyRate), s.meetings])}
          />
        )}
        {p.breakdowns.product.some((s) => s.key !== "none") && (
          <div className="mt-4">
            <Table
              head={["Product", "Contacted", "Replied", "Reply rate", "Meetings"]}
              rows={p.breakdowns.product.map((s) => [s.label, s.contacted, s.replied, pct(s.replyRate), s.meetings])}
            />
          </div>
        )}
      </Section>

      <Section title="Why deals ended">
        {p.reasons.lost.length + p.reasons.disqualified.length === 0 ? (
          <p className="text-[13px] text-fg-secondary">No deal was lost or ruled out with a reason in this period.</p>
        ) : (
          <Table
            head={["Reason", "Lost", "Not a fit"]}
            rows={[...new Set([...p.reasons.lost, ...p.reasons.disqualified].map((t) => t.label))].map((label) => [
              label,
              p.reasons.lost.find((t) => t.label === label)?.count ?? 0,
              p.reasons.disqualified.find((t) => t.label === label)?.count ?? 0,
            ])}
          />
        )}
      </Section>

      <Section title="Stalled deals">
        {p.stalled.length === 0 ? (
          <p className="text-[13px] text-fg-secondary">Nothing at meeting or proposal stage has gone quiet for 14+ days.</p>
        ) : (
          <Table head={["Company", "Stage", "Days without activity"]} rows={p.stalled.slice(0, 20).map((s) => [s.company, s.stage, s.idleDays])} />
        )}
      </Section>

      <Section title="Competitors">
        {active.length === 0 ? (
          <p className="text-[13px] text-fg-secondary">No competitors have been accepted in this workspace.</p>
        ) : (
          <Table
            head={["Competitor", "Tier", "Prospects using them", "Evaluating", "Deals lost to them", "Our advantage"]}
            rows={active.map((c) => [
              c.name,
              c.tier ?? "—",
              c.signals.uses,
              c.signals.evaluating,
              c.losses,
              c.ourAdvantage ?? "—",
            ])}
          />
        )}
        <p className="mt-2 text-[11px] text-fg-muted">
          Prospect counts are evidence-backed signals only. Losses are all-time, from reasons recorded when deals were lost.
        </p>
      </Section>

      <Section title="What it cost">
        <p className="text-[13px]">
          Model spend {money(p.cost.aiCents)}
          {p.cost.perMeetingCents !== null && <> · {money(p.cost.perMeetingCents)} per meeting</>}
          {p.cost.perQualifiedCents !== null && <> · {money(p.cost.perQualifiedCents)} per qualified opportunity</>} ·
          provider credits {p.cost.providerCredits} (not converted to money). Workspace-wide.
        </p>
      </Section>
      </article>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6 break-inside-avoid">
      <h2 className="mb-2 text-[12px] font-semibold tracking-label text-fg-secondary uppercase">{title}</h2>
      {children}
    </section>
  );
}

function Table({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <div className="overflow-x-auto print:overflow-visible">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i} className="border-b border-line py-1.5 pr-3 text-left text-[12px] font-medium text-fg-muted">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j} className={`border-b border-line-subtle py-1.5 pr-3 ${j > 0 && typeof c === "number" ? "hl-tabular" : ""}`}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const metadata = { title: "Performance report" };
