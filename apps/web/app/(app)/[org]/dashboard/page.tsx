import Link from "next/link";
import { canSpend, currentViewer } from "../../../../lib/data/membership";
import { getDashboard } from "../../../../lib/data/dashboard";
import { RefreshButton } from "../RefreshButton";
import {
  ActionRail,
  ActionRailItem,
  BreakdownList,
  Button,
  Card,
  CardHeader,
  ClaimBadge,
  EmptyState,
  EvidenceList,
  Freshness,
  PriorityBadge,
  QuotaBar,
  QuotaBarGroup,
  ScorePill,
  SectionLabel,
  StatCard,
  StatGrid,
} from "@huntloop/ui";
import {
  Binoculars,
  CalendarCheck,
  CheckCircle2,
  Eye,
  Flame,
  MessageSquare,
  Plus,
  Radar,
  Search,
  Send,
  Sparkles,
  Target,
  Thermometer,
  Zap,
} from "lucide-react";

/**
 * The Command Center — plan §2's layout, re-cut against the master context.
 *
 * What changed and why: the previous version led with pipeline stages (New /
 * Qualified / Approved / Contacted), which is a campaign tool's dashboard.
 * Master context §46 asks the opportunity dashboard to answer four questions
 * on sight — how urgent (§15 HOT/WARM/WATCH/IGNORE), how strong (§16 score),
 * why now (§13 trigger), and what to do next — so priority leads, why-now
 * gets its own section with the evidence attached, and activity counts drop
 * below both. §88's rule applies here more than anywhere: this screen is the
 * one connected loop, not a wall of unrelated metrics.
 *
 * ── Every number here now comes from a query ─────────────────────────────
 *
 * It did not before. Each figure was a literal in this file — `value={12}`,
 * "9 new triggers in the last 24h", two mailboxes at `acme.co` with sending
 * quotas — which read identically on a live deployment and an empty one. The
 * screen carried an unconditional "these are not real" banner because that was
 * the only honest thing it could say about itself.
 *
 * `lib/data/dashboard.ts` is the other half of that change, and the banner is
 * gone: in demo mode the layout's `DataSourceBanner` already says the whole
 * deployment is on fixtures, and there is nothing left on this screen that is
 * invented independently of it.
 *
 * ── Why a section can disappear ──────────────────────────────────────────
 *
 * Because "nothing to show" and "nothing measured" are different, and both are
 * different from zero. A workspace with no connected mailbox has no sending
 * capacity to draw — not a bar at 0/0 — and an empty action rail means nothing
 * needs a person, which is a real and good state. Rendering an empty frame in
 * either case invents a shape for data that does not exist.
 */
export default async function DashboardPage({
  params,
}: {
  params: Promise<{ org: string }>;
}) {
  const { org } = await params;
  const [viewer, { data }] = await Promise.all([
    currentViewer(org),
    getDashboard(org),
  ]);
  const mayHunt = canSpend(viewer);

  /* Resolved once per request and passed down, so every relative age on the
     page is measured from one instant rather than from a fresh `new Date()`
     per component. */
  const now = new Date();

  const { counts, whyNow, loop, outcomes, capacity, attention } = data;
  const totalOpportunities = counts.hot + counts.warm + counts.watch + counts.ignore;

  /* No `DemoFigures` here any more, and its own comment is the argument for
     removing it: a screen renders it while its numbers do not come from the
     database, and stops on the commit that wires it up. That commit is this
     one. In demo mode the layout's `DataSourceBanner` already says the whole
     deployment is on fixtures, and two banners saying the same thing in
     different words reads as one of them being about something else. */
  return (
    <>
      <div className="mx-auto grid w-full max-w-[1600px] gap-6 px-6 py-8 lg:px-8 min-[1440px]:grid-cols-[minmax(0,1fr)_320px]">
      {/* ── Main column ─────────────────────────────────────────────── */}
      <div className="min-w-0">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-[30px] leading-9 font-semibold text-fg">
                Command Center
              </h1>
              {/* No "Live" badge. It described the hunt, not the data, and
                  next to invented figures it read as a claim that they were
                  real — the §7 failure this screen is most exposed to. */}
            </div>
            <p className="mt-1 text-[13px] text-fg-muted">
              {org} · {totalOpportunities === 0
                ? "no opportunities yet"
                : `${totalOpportunities} ${totalOpportunities === 1 ? "opportunity" : "opportunities"} qualified against your ICP`}
            </p>
          </div>
          {/* "Analyze a URL" starts work that costs money, so a viewer does not
              get a button that would fail at the database (audit FEAT-04). It
              is a link rather than a `pending` button, because unlike the
              "New hunt" it replaced, its destination exists: scheduled hunting
              is the sources screen's scan interval, and one-off qualification
              is Analyze. There was never a third thing for that button to do. */}
          <div className="flex items-center gap-2">
            <RefreshButton />
            <Button
              icon={Radar}
              variant="secondary"
              href={`/${org}/sources`}
              linkComponent={Link}
            >
              Sources
            </Button>
            {mayHunt && (
              <Button
                icon={Plus}
                variant="primary"
                href={`/${org}/analyze`}
                linkComponent={Link}
              >
                Analyze a URL
              </Button>
            )}
          </div>
        </header>

        {/*
          Alert chips. All three were `href="#"` — links that look like links,
          announce as links, and go nowhere (audit A11Y-03 caught them; the
          underlying fault is the FEAT-01 one, the product asserting a
          capability it doesn't have).

          The counts are real now, and each chip is rendered only when its
          count is non-zero: "0 new triggers in the last 24h" is a sentence
          nobody needs, and a row of zeroes reads as a broken screen rather
          than a quiet week.
        */}
        <div className="mt-6 flex flex-wrap gap-2">
          {data.triggersLastDay > 0 && (
            <span className="inline-flex h-8 items-center gap-2 rounded-md border border-warning-border bg-warning-surface px-3 text-[13px] text-warning">
              <Zap className="size-3.5" strokeWidth={1.75} />
              {data.triggersLastDay} new{" "}
              {data.triggersLastDay === 1 ? "trigger" : "triggers"} in the last 24h
            </span>
          )}
          {data.awaitingReview > 0 && (
            <Link
              href={`/${org}/opportunities`}
              className="hl-focusable inline-flex h-8 items-center gap-2 rounded-md border border-brand-border bg-brand-surface px-3 text-[13px] text-brand-text transition-colors duration-[120ms] hover:border-brand"
            >
              <Sparkles className="size-3.5" strokeWidth={1.75} />
              {data.awaitingReview}{" "}
              {data.awaitingReview === 1 ? "opportunity" : "opportunities"} awaiting your
              review →
            </Link>
          )}
          <Link
            href={`/${org}/analyze`}
            className="hl-focusable inline-flex h-8 items-center gap-2 rounded-md border border-line bg-surface px-3 text-[13px] text-fg-secondary transition-colors duration-[120ms] hover:border-line-strong hover:text-fg"
          >
            <Search className="size-3.5" strokeWidth={1.75} />
            Analyze a company URL →
          </Link>
        </div>

        {/* §15 — the headline classification, above everything else.
            Each card deep-links into the list filtered to its bucket, which is
            why `?priority=` exists on that page. These four were `href="#"`:
            cards that said "Click to view →" and did not. */}
        <section className="mt-8">
          <SectionLabel>Priority</SectionLabel>
          <StatGrid className="mt-3">
            <StatCard
              label="Hot"
              value={counts.hot}
              icon={Flame}
              tone="hot"
              href={`/${org}/opportunities?priority=hot`}
              linkComponent={Link}
              hint="Strong fit · strong pain · fresh trigger"
              aiGenerated
            />
            <StatCard
              label="Warm"
              value={counts.warm}
              icon={Thermometer}
              tone="warm"
              href={`/${org}/opportunities?priority=warm`}
              linkComponent={Link}
              hint="Good fit · weaker trigger"
              aiGenerated
            />
            <StatCard
              label="Watch"
              value={counts.watch}
              icon={Eye}
              tone="watch"
              href={`/${org}/opportunities?priority=watch`}
              linkComponent={Link}
              hint="Possible fit · evidence too thin"
              aiGenerated
            />
            <StatCard
              label="Ignore"
              value={counts.ignore}
              icon={Binoculars}
              tone="ignore"
              href={`/${org}/opportunities?priority=ignore`}
              linkComponent={Link}
              hint="Poor fit — kept, not deleted"
              aiGenerated
            />
          </StatGrid>
        </section>

        {/* §13 + §52 — the differentiator, and the reason the score is
            trustworthy. Evidence sits inline rather than behind a click:
            a why-now claim with the source one page away is a claim most
            users will never check. */}
        <section className="mt-10">
          <SectionLabel>Why now</SectionLabel>
          {whyNow.length === 0 ? (
            <Card className="mt-3">
              <div className="p-5">
                <EmptyState
                  icon={Search}
                  title="Nothing is waiting for a verdict"
                  description="Why now lists the opportunities nobody has triaged yet. When a scan turns up a company that fits, it appears here with the evidence behind it."
                />
              </div>
            </Card>
          ) : (
            <div className="mt-3 flex flex-col gap-3">
              {whyNow.map((o) => (
                <Card key={o.id} flush>
                  <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/${org}/opportunities/${o.id}`}
                          className="hl-focusable rounded-sm text-base font-semibold text-fg"
                        >
                          {o.company}
                        </Link>
                        <PriorityBadge priority={o.priority} reason={o.priorityReason} />
                        <span className="font-mono text-[12px] text-fg-muted">
                          {o.domain}
                        </span>
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                        {o.trigger ? (
                          <>
                            <span className="text-[13px] text-fg-secondary">
                              {o.trigger}
                            </span>
                            {o.triggerDate && <Freshness date={o.triggerDate} now={now} />}
                          </>
                        ) : (
                          /* §7: no trigger on file is a fact about the
                             evidence, not a blank space to fill with one. */
                          <span className="text-[13px] text-fg-muted">
                            No trigger recorded yet
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <ScorePill
                        score={o.score}
                        explanation={o.scoreExplanation}
                        confidence={o.confidence}
                        dimensions={o.dimensions}
                      />
                    </div>
                  </div>

                  <div className="px-5 pt-3 pb-4">
                    <details className="group">
                      <summary className="hl-focusable inline-flex cursor-pointer list-none items-center gap-2 rounded-sm text-[12px] text-fg-muted transition-colors duration-[120ms] hover:text-fg-secondary">
                        <span className="text-[11px] tracking-[0.06em] uppercase">
                          Evidence ({o.evidence.length})
                        </span>
                        <span aria-hidden className="group-open:hidden">
                          ▸
                        </span>
                        <span aria-hidden className="hidden group-open:inline">
                          ▾
                        </span>
                      </summary>
                      {o.evidence.length === 0 ? (
                        <p className="mt-3 text-[13px] text-fg-muted">
                          Nothing is attributed to this opportunity yet, so the score
                          above rests on the company research rather than on evidence
                          gathered for it.
                        </p>
                      ) : (
                        <EvidenceList items={o.evidence} now={now} className="mt-3" />
                      )}
                    </details>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </section>

        {/* Activity, demoted below the verdict it produces. Each card now has
            the screen its number came from, because each of those screens
            exists — they were `href="#"` when they did not. */}
        <section className="mt-10">
          <SectionLabel>Loop this week</SectionLabel>
          <StatGrid className="mt-3">
            <StatCard
              label="Discovered"
              value={loop.discovered}
              icon={Search}
              href={`/${org}/opportunities`}
              linkComponent={Link}
            />
            <StatCard
              label="Researched"
              value={loop.researched}
              icon={Target}
              tone="ai"
              href={`/${org}/companies`}
              linkComponent={Link}
              aiGenerated
            />
            {/* Sent, not drafted. A message with no send time has not reached
                anybody, and §78 is that distinction stated as a rule. */}
            <StatCard
              label="Contacted"
              value={loop.contacted}
              icon={Send}
              href={`/${org}/outreach`}
              linkComponent={Link}
              hint="Messages that actually left"
            />
            <StatCard
              label="Replied"
              value={loop.replied}
              icon={MessageSquare}
              tone="info"
              href={`/${org}/inbox`}
              linkComponent={Link}
            />
          </StatGrid>

          <SectionLabel className="mt-8">Outcomes</SectionLabel>
          <StatGrid className="mt-3" columns={3}>
            <StatCard
              label="Meetings"
              value={outcomes.meetings}
              icon={CalendarCheck}
              tone="success"
              href={`/${org}/pipeline`}
              linkComponent={Link}
            />
            <StatCard
              label="Won"
              value={outcomes.won}
              icon={CheckCircle2}
              tone="brand"
              href={`/${org}/pipeline`}
              linkComponent={Link}
            />
            {/* No denominator. It used to read "of 1,000 on the Growth plan",
                and there is no plan ceiling in the schema for that number to
                have come from — an invented denominator is the same failure as
                an invented numerator. */}
            <StatCard
              label="Companies known"
              value={outcomes.companies}
              icon={Target}
              href={`/${org}/companies`}
              linkComponent={Link}
            />
          </StatGrid>
        </section>

        {capacity.length > 0 && (
          <section className="mt-10">
            <SectionLabel>Sending capacity</SectionLabel>
            <Card className="mt-3">
              <QuotaBarGroup>
                {capacity.map((m) => (
                  <QuotaBar key={m.label} label={m.label} used={m.used} limit={m.limit} />
                ))}
              </QuotaBarGroup>
            </Card>
          </section>
        )}

        <section className="mt-10 grid gap-4 lg:grid-cols-2">
          <Card flush>
            <CardHeader
              title="Signals by type"
              description="What the sources actually produced this week."
            />
            <div className="p-5">
              {data.signalsByType.length === 0 ? (
                <p className="text-[13px] text-fg-muted">
                  No triggers were recorded this week.
                </p>
              ) : (
                <BreakdownList items={data.signalsByType} />
              )}
            </div>
          </Card>

          <Card flush>
            <CardHeader
              title="Source performance"
              description="Evidence attributed, not articles scraped."
            />
            <div className="p-5">
              {data.sourcePerformance.length === 0 ? (
                <p className="text-[13px] text-fg-muted">
                  No evidence has been attributed to a source this week.
                </p>
              ) : (
                <BreakdownList items={data.sourcePerformance} />
              )}
            </div>
          </Card>
        </section>

        {/* §7 — the rule the whole product rests on, stated where the numbers
            above are read rather than buried in a docs page. */}
        <p className="mt-8 flex flex-wrap items-center gap-2 text-[12px] text-fg-muted">
          <ClaimBadge kind="fact" />
          observed at a source ·
          <ClaimBadge kind="inference" />
          concluded by a model ·
          <ClaimBadge kind="unknown" />
          not established. Huntloop never promotes the second into the first.
        </p>
      </div>

      {/* ── Action rail ───────────────────────────────────────────────
          Sits beside content at ≥1440px — the exact threshold plan §1.4 #9
          names. It is never absolutely positioned, so it cannot overlay
          anything at any width.

          UX-11: below that threshold the grid collapses to one column, and
          the rail used to stack *under* the main content — which put "Needs
          you" roughly two thousand pixels down on a 1280px laptop, past the
          verdict, the why-now cards, the weekly counts and two breakdowns.
          A queue of things needing a person, reachable only by scrolling past
          everything that does not, is a queue nobody works.

          So it comes first when the layout is stacked and returns to the
          right-hand column when there is room for one. `order` rather than a
          second copy of the markup: two rails in the DOM would be two rails
          for a screen reader, and the one that is visually hidden is the one
          it would read.

          It renders at all only when something is actually waiting, so this
          cannot push the page down for a workspace with nothing to do. */}
      {attention.length > 0 && (
        <ActionRail className="order-first min-[1440px]:order-none">
          {attention.map((item) => (
            <ActionRailItem
              key={item.kind}
              title={item.title}
              source={item.source}
              sourceVariant={RAIL_TONE[item.kind]}
              meta={item.meta}
              primaryLabel="Open"
              href={item.href ?? undefined}
              linkComponent={Link}
            />
          ))}
        </ActionRail>
      )}
      </div>
    </>
  );
}

const RAIL_TONE = {
  replies: "info",
  approvals: "ai",
  "failing-sources": "warning",
  "stale-evidence": "neutral",
} as const;

export const metadata = { title: "Command Center" };
