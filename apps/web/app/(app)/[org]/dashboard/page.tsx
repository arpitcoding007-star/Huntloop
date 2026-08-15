import Link from "next/link";
import { canSpend, currentViewer } from "../../../../lib/data/membership";
import {
  ActionRail,
  ActionRailItem,
  Badge,
  BreakdownList,
  Button,
  Card,
  CardHeader,
  ClaimBadge,
  EvidenceList,
  Freshness,
  PriorityBadge,
  QuotaBar,
  QuotaBarGroup,
  ScorePill,
  SectionLabel,
  StatCard,
  StatGrid,
  type EvidenceItem,
  type Priority,
} from "@huntloop/ui";
import {
  Binoculars,
  CalendarCheck,
  Download,
  Eye,
  Flame,
  MessageSquare,
  Plus,
  RefreshCw,
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
 * Fixtures only. Wiring to Supabase is Phase 0/1.
 */

/* Fixed reference instant so the relative ages below don't drift with the
   clock. Real data will pass the request time down from the server. */
const NOW = new Date("2026-08-11T09:00:00Z");

const WHY_NOW: {
  company: string;
  domain: string;
  priority: Priority;
  priorityReason: string;
  score: number;
  explanation: string;
  eventDate: string;
  trigger: string;
  action: string;
  evidence: EvidenceItem[];
}[] = [
  {
    company: "Alphio AI",
    domain: "alphio.ai",
    priority: "hot",
    priorityReason:
      "Strong ICP fit, a stated problem in the founder's own words, and a funding trigger 3 days old.",
    score: 91,
    explanation:
      "Series A closed this week, and the launch post names custody permissions as an open problem — the exact gap the product closes.",
    eventDate: "2026-08-08",
    trigger: "Raised $12M Series A",
    action: "Reach out to the CTO about custody permissions",
    evidence: [
      {
        claim: "Alphio AI closed a $12M Series A led by Northgate Ventures.",
        kind: "fact",
        confidence: "high",
        source: "TechCrunch",
        sourceUrl: "https://techcrunch.com/",
        eventDate: "2026-08-08",
        observedAt: "2026-08-09",
        excerpt:
          "Alphio AI has raised $12 million to scale its autonomous trading agents to institutional desks.",
      },
      {
        claim:
          "Their agents will need controlled financial permissions before institutional desks will onboard.",
        kind: "inference",
        confidence: "medium",
        source: "Derived from the launch post and the funding announcement",
        eventDate: "2026-08-08",
        observedAt: "2026-08-09",
      },
      {
        claim: "Which wallet architecture they use today — MPC, multisig, or other.",
        kind: "unknown",
      },
    ],
  },
  {
    company: "Northwind Logistics",
    domain: "northwind.co",
    priority: "warm",
    priorityReason:
      "Good ICP fit and a clear hiring signal, but no evidence yet that the problem is urgent for them.",
    score: 74,
    explanation:
      "Hiring two integration engineers with a job spec that describes the manual process this replaces. No budget or timeline evidence.",
    eventDate: "2026-08-01",
    trigger: "Hiring 2 integration engineers",
    action: "Research current approach before contacting",
    evidence: [
      {
        claim: "Northwind posted two integration-engineer roles on 1 Aug.",
        kind: "fact",
        confidence: "high",
        source: "Careers page",
        sourceUrl: "https://example.com/",
        eventDate: "2026-08-01",
        observedAt: "2026-08-02",
        excerpt:
          "You will own the partner-integration pipeline, currently maintained by hand across 40+ carriers.",
      },
      {
        claim: "Whether a purchase decision is funded this quarter.",
        kind: "unknown",
      },
    ],
  },
  {
    company: "Cormorant Health",
    domain: "cormorant.health",
    priority: "watch",
    priorityReason:
      "Plausible fit, but the only trigger on file is four months old and nothing has changed since.",
    score: 48,
    explanation:
      "Regulatory approval in April is the sole signal. No hiring, no launches, no public statement of the problem since.",
    eventDate: "2026-04-14",
    trigger: "Received regulatory approval",
    action: "Keep monitoring — no reason to contact today",
    evidence: [
      {
        claim: "Cormorant received regulatory clearance for its remote-monitoring device.",
        kind: "fact",
        confidence: "high",
        source: "Company press release",
        sourceUrl: "https://example.com/",
        eventDate: "2026-04-14",
        observedAt: "2026-04-15",
      },
    ],
  },
];

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ org: string }>;
}) {
  const { org } = await params;
  const mayHunt = canSpend(await currentViewer(org));

  return (
    <div className="mx-auto grid w-full max-w-[1600px] gap-6 px-6 py-8 lg:px-8 min-[1440px]:grid-cols-[minmax(0,1fr)_320px]">
      {/* ── Main column ─────────────────────────────────────────────── */}
      <div className="min-w-0">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-[30px] leading-9 font-semibold text-fg">
                Command Center
              </h1>
              <Badge variant="brand" dot>
                Live
              </Badge>
            </div>
            <p className="mt-1 text-[13px] text-fg-muted">
              {org} · 14 sources monitored · last scan 20 minutes ago · autonomy
              L2 — Huntloop recommends, you approve
            </p>
          </div>
          {/* Refresh and Export are reads and stay for everyone. "New hunt"
              starts work that costs money, so a viewer does not get a button
              that would fail at the database (audit FEAT-04). */}
          <div className="flex items-center gap-2">
            <Button icon={RefreshCw} variant="ghost" aria-label="Refresh" />
            <Button icon={Download} variant="secondary">
              Export
            </Button>
            {mayHunt && (
              <Button icon={Plus} variant="primary">
                New hunt
              </Button>
            )}
          </div>
        </header>

        {/*
          Alert chips. All three were `href="#"` — links that look like links,
          announce as links, and go nowhere (audit A11Y-03 caught them; the
          underlying fault is the FEAT-01 one, the product asserting a
          capability it doesn't have).

          Two have real destinations and now point at them. The triggers chip
          does not: there is no triggers screen, so it renders as a plain
          status chip — no anchor, no focus ring, no "→". The arrow is the
          part that promises navigation, so it goes with the href.
        */}
        <div className="mt-6 flex flex-wrap gap-2">
          <span className="inline-flex h-8 items-center gap-2 rounded-md border border-warning-border bg-warning-surface px-3 text-[13px] text-warning">
            <Zap className="size-3.5" strokeWidth={1.75} />
            9 new triggers in the last 24h
          </span>
          <Link
            href={`/${org}/opportunities`}
            className="hl-focusable inline-flex h-8 items-center gap-2 rounded-md border border-brand-border bg-brand-surface px-3 text-[13px] text-brand-text transition-colors duration-[120ms] hover:border-brand"
          >
            <Sparkles className="size-3.5" strokeWidth={1.75} />
            12 opportunities awaiting your review →
          </Link>
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
              value={12}
              icon={Flame}
              tone="hot"
              href={`/${org}/opportunities?priority=hot`}
              linkComponent={Link}
              hint="Strong fit · strong pain · fresh trigger"
              aiGenerated
            />
            <StatCard
              label="Warm"
              value={34}
              icon={Thermometer}
              tone="warm"
              href={`/${org}/opportunities?priority=warm`}
              linkComponent={Link}
              hint="Good fit · weaker trigger"
              aiGenerated
            />
            <StatCard
              label="Watch"
              value={88}
              icon={Eye}
              tone="watch"
              href={`/${org}/opportunities?priority=watch`}
              linkComponent={Link}
              hint="Possible fit · evidence too thin"
              aiGenerated
            />
            <StatCard
              label="Ignore"
              value={46}
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
          <div className="mt-3 flex flex-col gap-3">
            {WHY_NOW.map((o) => (
              <Card key={o.domain} flush>
                <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-semibold text-fg">{o.company}</h3>
                      <PriorityBadge priority={o.priority} reason={o.priorityReason} />
                      <span className="font-mono text-[12px] text-fg-muted">
                        {o.domain}
                      </span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="text-[13px] text-fg-secondary">{o.trigger}</span>
                      <Freshness date={o.eventDate} now={NOW} />
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <ScorePill
                      score={o.score}
                      explanation={o.explanation}
                      confidence={o.priority === "watch" ? "low" : "medium"}
                      dimensions={[
                        { label: "ICP fit", value: o.priority === "hot" ? 94 : 71 },
                        { label: "Problem severity", value: o.priority === "hot" ? 88 : 55 },
                        { label: "Evidence strength", value: o.evidence.length > 2 ? 82 : 44 },
                        { label: "Trigger strength", value: o.priority === "hot" ? 90 : 60 },
                        {
                          label: "Trigger freshness",
                          value: o.priority === "watch" ? 12 : 86,
                        },
                        { label: "Buying likelihood", value: "unknown" },
                        { label: "Product relevance", value: o.priority === "hot" ? 92 : 68 },
                        { label: "Decision-maker accessibility", value: "unknown" },
                      ]}
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
                    <EvidenceList items={o.evidence} now={NOW} className="mt-3" />
                  </details>

                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line-subtle pt-3">
                    <span className="text-[11px] tracking-[0.06em] text-fg-muted uppercase">
                      Recommended
                    </span>
                    <span className="text-[13px] text-fg-secondary">{o.action}</span>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </section>

        {/* Activity, demoted below the verdict it produces.

            No `href` on any of these, deliberately. Each one's natural
            destination — companies, outreach, inbox, pipeline — is an unbuilt
            nav entry, and `StatCard` renders "Click to view →" plus a hover
            arrow whenever it is given one. They were all `href="#"`, so the
            most-visited screen in the product carried eight links that
            announced as links and went nowhere.

            Give each its href in the same commit that builds its screen,
            exactly as with the `unbuilt` nav flag. */}
        <section className="mt-10">
          <SectionLabel>Loop this week</SectionLabel>
          <StatGrid className="mt-3">
            <StatCard label="Discovered" value={180} icon={Search} />
            <StatCard label="Researched" value={134} icon={Target} tone="ai" aiGenerated />
            <StatCard label="Contacted" value={90} icon={Send} />
            <StatCard
              label="Replied"
              value={5}
              icon={MessageSquare}
              tone="info"
              hint="2 positive · 3 neutral"
            />
          </StatGrid>

          <SectionLabel className="mt-8">Outcomes</SectionLabel>
          <StatGrid className="mt-3" columns={3}>
            <StatCard label="Meetings" value={2} icon={CalendarCheck} tone="success" />
            <StatCard label="Opportunities" value={1} icon={Flame} tone="brand" />
            <StatCard
              label="Total companies"
              value={180}
              icon={Target}
              hint="of 1,000 on the Growth plan"
            />
          </StatGrid>
        </section>

        <section className="mt-10">
          <SectionLabel>Sending capacity</SectionLabel>
          <Card className="mt-3">
            <QuotaBarGroup>
              <QuotaBar label="founder@acme.co" used={38} limit={50} />
              <QuotaBar label="sales@acme.co" used={50} limit={50} />
            </QuotaBarGroup>
          </Card>
        </section>

        <section className="mt-10 grid gap-4 lg:grid-cols-2">
          <Card flush>
            <CardHeader
              title="Signals by type"
              description="What the sources actually produced this week."
            />
            <div className="p-5">
              <BreakdownList
                items={[
                  { label: "Funding", value: 31 },
                  { label: "Hiring", value: 24 },
                  { label: "Product launch", value: 18 },
                  { label: "Technology adoption", value: 12 },
                  { label: "Leadership change", value: 7 },
                ]}
              />
            </div>
          </Card>

          <Card flush>
            <CardHeader
              title="Source performance"
              description="Opportunities produced, not articles scraped."
            />
            <div className="p-5">
              <BreakdownList
                items={[
                  { label: "The Block", value: 22 },
                  { label: "Company blogs", value: 17 },
                  { label: "GitHub", value: 11 },
                  { label: "Job boards", value: 9 },
                  { label: "Hacker News", value: 4 },
                ]}
              />
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
          names. Below it the grid collapses to one column and the rail
          stacks under the main content; it is never absolutely positioned,
          so it cannot overlay anything at any width. */}
      <ActionRail moreCount={5}>
        <ActionRailItem
          title="12 replies unread"
          source="Inbox"
          sourceVariant="info"
          meta="2h ago"
          primaryLabel="Review"
        />
        <ActionRailItem
          title="5 messages need approval"
          source="AI"
          sourceVariant="ai"
          meta="Autonomy L2"
          primaryLabel="Approve"
          secondaryLabel="Skip"
        />
        {/* §58: a source that fails does not fail the hunt — it is marked
            unavailable, retried, and surfaced as something a human can see. */}
        <ActionRailItem
          title="Crunchbase source unavailable"
          source="Sources"
          sourceVariant="warning"
          meta="Failing since 06:10 · retrying"
          primaryLabel="View"
        />
        <ActionRailItem
          title="7 opportunities on evidence older than 90 days"
          source="Freshness"
          sourceVariant="neutral"
          meta="Re-research to re-score"
          primaryLabel="Re-research"
          secondaryLabel="Dismiss"
        />
      </ActionRail>
    </div>
  );
}
