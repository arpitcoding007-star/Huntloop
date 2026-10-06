import Link from "next/link";
import { notFound } from "next/navigation";
import {
  BreakdownList,
  Card,
  CardBody,
  CardHeader,
  Note,
  StatCard,
  StatGrid,
} from "@huntloop/ui";
import {
  CalendarCheck,
  Download,
  Flame,
  MessageSquareReply,
  Send,
  Sparkles,
  ThumbsUp,
  Trophy,
} from "lucide-react";
import { canAdmin, canSpend, currentViewer } from "../../../../lib/data/membership";
import { getPerformance } from "../../../../lib/data/performance";
import {
  PERIODS,
  PERIOD_LABEL,
  type Funnel,
  type Insight,
  type Period,
} from "../../../../lib/performance/compute";
import { DemoFigures } from "../DemoFigures";
import { Breakdowns } from "./Breakdowns";
import { GoalsCard } from "./GoalsCard";
import { Narrative } from "./Narrative";

/**
 * Performance — what the loop is producing, and why. COMMAND.md §16.3-E.
 *
 * Replaces the Learn section's "Analytics", which was model spend under a
 * name that promised outcomes (M-11). Spend now lives under Operate as "AI
 * spend"; this screen joins it to outcomes as cost per meeting.
 *
 * Order is the argument: what the data says (insights that pass a significance
 * test, or a plain "not enough data"), then the funnel those rest on, then
 * where replies come from, then why deals end, then what it cost.
 */

const pct = (r: number | null) => (r === null ? "—" : `${Math.round(r * 100)}%`);
const days = (d: number | null) => (d === null ? "—" : d < 1 ? "<1 day" : `${Math.round(d * 10) / 10} days`);

function delta(now: number, before: number): string | undefined {
  if (now === before) return before === 0 ? undefined : "same as before";
  if (before === 0) return `up from 0`;
  const change = Math.round(((now - before) / before) * 100);
  return `${change > 0 ? "+" : ""}${change}% vs previous period`;
}

const TONE: Record<Insight["tone"], string> = {
  strength: "border-success-border bg-success-surface",
  risk: "border-warning-border bg-warning-surface",
  change: "border-brand-border bg-brand-surface",
  info: "border-line-subtle bg-surface",
};

export default async function PerformancePage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<{ period?: string }>;
}) {
  const { org } = await params;
  const { period: requested } = await searchParams;
  const viewer = await currentViewer(org);
  if (!viewer) notFound();

  const period: Period = (PERIODS as readonly string[]).includes(requested ?? "") ? (requested as Period) : "30d";
  const { data, source } = await getPerformance(org, period);
  const p = data.performance;
  const f: Funnel = p.funnel;
  const prev: Funnel = p.previousFunnel;
  const admin = canAdmin(viewer);
  const exportHref = (table: string) => `/${org}/performance/export?period=${period}&table=${table}`;

  return (
    <div className="mx-auto w-full max-w-[1200px] px-6 py-8 lg:px-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="hl-heading text-fg">Performance</h1>
          <p className="mt-1 max-w-[640px] text-[13px] text-fg-muted">
            What the loop produced in this period, what the numbers say about why, and what it cost.
            Rates are measured on the companies first contacted in the period, on every channel.
          </p>
        </div>
        <nav aria-label="Period" className="flex flex-wrap rounded-md border border-line bg-surface p-0.5">
          {PERIODS.map((value) => (
            <Link
              key={value}
              href={`/${org}/performance?period=${value}`}
              aria-current={value === period ? "page" : undefined}
              className={[
                "hl-focusable rounded-[5px] px-3 py-1.5 text-[13px] transition-colors duration-[120ms]",
                value === period ? "bg-brand-surface font-medium text-brand-text" : "text-fg-muted hover:text-fg-secondary",
              ].join(" ")}
            >
              {PERIOD_LABEL[value]}
            </Link>
          ))}
        </nav>
      </header>

      {source !== "live" && (
        <div className="mt-6">
          <DemoFigures what="These figures come from example opportunities with no outreach history, which is why most of the screen says there is nothing to measure yet." />
        </div>
      )}
      {data.partial && (
        <div className="mt-6">
          <Note tone="warning">{data.partial}</Note>
        </div>
      )}

      {/* ── What the data says ─────────────────────────────────────────── */}
      <section aria-labelledby="insights" className="mt-8">
        <h2 id="insights" className="text-[11px] font-medium tracking-label text-fg-muted uppercase">
          What the data says
        </h2>
        <ul className="mt-3 grid gap-3 md:grid-cols-2">
          {p.insights.map((i) => (
            <li key={i.id} className={`rounded-lg border px-4 py-3 ${TONE[i.tone]}`}>
              <p className="text-[14px] text-fg">{i.headline}</p>
              <p className="mt-1 text-[12px] text-fg-muted">{i.basis}</p>
              {i.breakdown && (
                <a href="#breakdowns" className="hl-focusable mt-1 inline-block rounded-sm text-[12px] text-brand-text underline underline-offset-2">
                  See the companies behind it
                </a>
              )}
            </li>
          ))}
          {p.insights.length === 0 && (
            <li className="rounded-lg border border-line-subtle px-4 py-3 text-[13px] text-fg-muted">
              Nothing stands out. No group differs from the rest by more than chance, and nothing is
              stalled.
            </li>
          )}
        </ul>
        <Narrative org={org} period={period} canAsk={canSpend(viewer)} />
      </section>

      {/* ── The funnel ─────────────────────────────────────────────────── */}
      <section aria-labelledby="funnel" className="mt-8">
        <div className="flex items-baseline justify-between">
          <h2 id="funnel" className="text-[11px] font-medium tracking-label text-fg-muted uppercase">
            {PERIOD_LABEL[period]}
          </h2>
          <a href={exportHref("funnel")} className="hl-focusable inline-flex items-center gap-1 rounded-sm text-[12px] text-fg-muted hover:text-fg-secondary">
            <Download className="size-3" strokeWidth={1.75} /> CSV
          </a>
        </div>
        <StatGrid className="mt-3">
          <StatCard label="Found" value={f.discovered} icon={Sparkles} hint={delta(f.discovered, prev.discovered)} />
          <StatCard label="Qualified (hot or warm)" value={f.qualified} icon={Flame} tone="hot" hint={delta(f.qualified, prev.qualified)} />
          <StatCard label="First contacted" value={f.contacted} icon={Send} tone="brand" hint={delta(f.contacted, prev.contacted)} />
          <StatCard label="First replied" value={f.replied} icon={MessageSquareReply} tone="info" hint={delta(f.replied, prev.replied)} />
          <StatCard label="Positive replies" value={f.positive} icon={ThumbsUp} tone="success" hint={delta(f.positive, prev.positive)} />
          <StatCard label="Meetings" value={f.meetings} icon={CalendarCheck} tone="violet" hint={delta(f.meetings, prev.meetings)} />
          <StatCard label="Won" value={f.won} icon={Trophy} tone="success" hint={delta(f.won, prev.won)} />
        </StatGrid>

        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <Card flush>
            <CardHeader title="Reply rate" description={`Of ${p.cohort.contacted} first contacted`} />
            <CardBody>
              <p className="hl-tabular text-[28px] leading-none text-fg">{pct(p.cohort.replyRate)}</p>
              <p className="mt-2 text-[12px] text-fg-muted">
                Previous period {pct(p.previousCohort.replyRate)} of {p.previousCohort.contacted}
              </p>
            </CardBody>
          </Card>
          <Card flush>
            <CardHeader title="Meeting rate" description={`Of ${p.cohort.contacted} first contacted`} />
            <CardBody>
              <p className="hl-tabular text-[28px] leading-none text-fg">{pct(p.cohort.meetingRate)}</p>
              <p className="mt-2 text-[12px] text-fg-muted">
                Previous period {pct(p.previousCohort.meetingRate)} of {p.previousCohort.contacted}
              </p>
            </CardBody>
          </Card>
          <Card flush>
            <CardHeader title="Time to an answer" description="Median, from first touch" />
            <CardBody className="space-y-1 text-[14px] text-fg">
              <Row label="To a reply" value={days(p.cohort.medianDaysToReply)} />
              <Row label="To a meeting" value={days(p.cohort.medianDaysToMeeting)} />
            </CardBody>
          </Card>
        </div>
      </section>

      {/* ── Where replies come from ─────────────────────────────────────── */}
      <section className="mt-8 space-y-2">
        <div className="flex justify-end">
          <a href={exportHref("segments")} className="hl-focusable inline-flex items-center gap-1 rounded-sm text-[12px] text-fg-muted hover:text-fg-secondary">
            <Download className="size-3" strokeWidth={1.75} /> CSV
          </a>
        </div>
        <Breakdowns org={org} breakdowns={p.breakdowns} />
      </section>

      {/* ── Why deals end, stalls, pace, cost ───────────────────────────── */}
      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        <Card flush>
          <CardHeader
            title="Why deals ended"
            description="Lost and not-a-fit reasons recorded in this period."
            actions={
              <a href={exportHref("reasons")} className="hl-focusable inline-flex items-center gap-1 rounded-sm text-[12px] text-fg-muted hover:text-fg-secondary">
                <Download className="size-3" strokeWidth={1.75} /> CSV
              </a>
            }
          />
          <CardBody className="space-y-4">
            {p.reasons.lost.length + p.reasons.disqualified.length === 0 ? (
              <p className="text-[13px] text-fg-muted">
                No deal was lost or ruled out in this period — or none was given a reason. Reasons are
                asked for when a deal moves to Lost and when it is marked not a fit.
              </p>
            ) : (
              <>
                {p.reasons.lost.length > 0 && (
                  <div>
                    <p className="text-[12px] font-medium text-fg-secondary">Lost</p>
                    <BreakdownList items={p.reasons.lost.map((t) => ({ label: t.label, value: t.count }))} />
                  </div>
                )}
                {p.reasons.disqualified.length > 0 && (
                  <div>
                    <p className="text-[12px] font-medium text-fg-secondary">Not a fit</p>
                    <BreakdownList items={p.reasons.disqualified.map((t) => ({ label: t.label, value: t.count }))} />
                  </div>
                )}
                {p.reasons.competitors.length > 0 && (
                  <div>
                    <p className="text-[12px] font-medium text-fg-secondary">Lost to</p>
                    <BreakdownList items={p.reasons.competitors.map((t) => ({ label: t.label, value: t.count }))} />
                  </div>
                )}
              </>
            )}
          </CardBody>
        </Card>

        <GoalsCard org={org} goals={data.goals} progress={data.progress} canAdmin={admin} />

        <Card flush>
          <CardHeader
            title="Stalled deals"
            description="At meeting or proposal stage, with no activity for 14 days or more."
          />
          <CardBody>
            {p.stalled.length === 0 ? (
              <p className="text-[13px] text-fg-muted">Nothing late-stage has gone quiet.</p>
            ) : (
              <ul className="divide-y divide-line-subtle">
                {p.stalled.slice(0, 10).map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-2 py-2 text-[13px]">
                    <Link href={`/${org}/opportunities/${s.id}`} className="hl-focusable rounded-sm text-fg underline-offset-2 hover:underline">
                      {s.company}
                    </Link>
                    <span className="text-fg-muted">
                      {s.stage} · {s.idleDays} days
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card flush>
          <CardHeader title="What it cost" description="Model spend and provider credits in this period, against what they produced." />
          <CardBody className="space-y-2 text-[13px]">
            <Row label="Model spend" value={`$${(p.cost.aiCents / 100).toFixed(2)}`} />
            <Row label="Provider credits" value={String(p.cost.providerCredits)} />
            <Row
              label="Model spend per qualified opportunity"
              value={p.cost.perQualifiedCents === null ? "—" : `$${(p.cost.perQualifiedCents / 100).toFixed(2)}`}
            />
            <Row
              label="Model spend per meeting"
              value={p.cost.perMeetingCents === null ? "—" : `$${(p.cost.perMeetingCents / 100).toFixed(2)}`}
            />
            <p className="pt-1 text-[12px] text-fg-muted">
              Credits are not converted to money: the price per credit is set by your provider
              contract, and inventing one would put a made-up number here.{" "}
              <Link href={`/${org}/analytics`} className="hl-focusable rounded-sm underline underline-offset-2">
                Full AI spend →
              </Link>
            </p>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-fg-secondary">{label}</span>
      <span className="hl-tabular text-fg">{value}</span>
    </div>
  );
}

export const metadata = { title: "Performance" };
