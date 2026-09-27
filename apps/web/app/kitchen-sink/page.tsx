"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ClaimBadge,
  Column,
  DataTable,
  EvidenceList,
  FilterBar,
  Freshness,
  Menu,
  Modal,
  Note,
  PriorityBadge,
  ScorePill,
  SectionLabel,
  StatCard,
  StatGrid,
  StatusDot,
  useToast,
  type Priority,
  type ScoreDimension,
} from "@huntloop/ui";
import {
  CalendarCheck,
  CheckCircle2,
  Copy,
  Download,
  MoreHorizontal,
  Inbox,
  MessageSquare,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  Target,
  Trash2,
  Users,
  XCircle,
  Zap,
} from "lucide-react";

/* ── Fixtures ──────────────────────────────────────────────────────────── */

/* This page is a client component, so any relative time it renders has to be
   computed from a fixed instant — `new Date()` would produce one string on
   the server and a different one in the browser, and React would report a
   hydration mismatch. */
const DEMO_NOW = new Date("2026-08-11T09:00:00Z");

/** Sort order for the priority column — HOT is highest. */
const PRIORITY_RANK: Record<Priority, number> = {
  ignore: 0,
  watch: 1,
  warm: 2,
  hot: 3,
};

/* The fixtures below deliberately do NOT use ScorePill's `factors` prop. A
   signed "+18" on screen is a claim about the model's arithmetic, and master
   context §51 records the weighting as NOT DEFINED — a gallery is exactly
   where an invented one would get copied into the real table. Dimensions say
   what was assessed without asserting how it was combined. */
type Opportunity = {
  id: string;
  company: string;
  domain: string;
  person: string;
  title: string;
  priority: Priority;
  priorityReason: string;
  score: number;
  scoreWhy: string;
  confidence: "high" | "medium" | "low";
  dimensions: ScoreDimension[];
  status: "new" | "qualified" | "contacted" | "replied" | "rejected";
  signal: string;
  aiScored: boolean;
};

const OPPORTUNITIES: Opportunity[] = [
  {
    id: "ld_01",
    company: "Alphio AI",
    domain: "alphio.ai",
    person: "Marta Kovacs",
    title: "VP Revenue Operations",
    priority: "hot",
    priorityReason:
      "Strong fit, a problem stated in the founder's own words, and a funding trigger three days old.",
    score: 91,
    scoreWhy:
      "Series A three days ago, hiring 3 SDRs, and running a competitor's sequencing tool that we displace in 70% of head-to-heads.",
    confidence: "high",
    dimensions: [
      { label: "ICP fit", value: 94 },
      { label: "Problem severity", value: 88 },
      { label: "Evidence strength", value: 82 },
      { label: "Trigger strength", value: 90 },
      { label: "Trigger freshness", value: 96 },
      { label: "Buying likelihood", value: "unknown" },
      { label: "Product relevance", value: 92 },
      { label: "Decision-maker accessibility", value: 71 },
    ],
    status: "qualified",
    signal: "Raised $12M Series A",
    aiScored: true,
  },
  {
    id: "ld_02",
    company: "Northwind Logistics",
    domain: "northwind.co",
    person: "Devan Rao",
    title: "Head of Growth",
    priority: "warm",
    priorityReason:
      "Good fit and a clear hiring signal, but nothing yet showing the problem is urgent for them.",
    score: 78,
    scoreWhy:
      "Strong firmographic fit and an active outbound team, but the only trigger is a job post from ten days ago.",
    confidence: "medium",
    dimensions: [
      { label: "ICP fit", value: 85 },
      { label: "Problem severity", value: 58 },
      { label: "Evidence strength", value: 61 },
      { label: "Trigger strength", value: 54 },
      { label: "Trigger freshness", value: 74 },
      { label: "Buying likelihood", value: "unknown" },
      { label: "Product relevance", value: 80 },
      { label: "Decision-maker accessibility", value: 66 },
    ],
    status: "contacted",
    signal: "Job post: Sales Development",
    aiScored: true,
  },
  {
    id: "ld_03",
    company: "Cormorant Health",
    domain: "cormorant.health",
    person: "Priya Nandakumar",
    title: "Director of Partnerships",
    priority: "warm",
    priorityReason:
      "They replied and asked for pricing — intent is evidenced, even though the fit is only fair.",
    score: 64,
    scoreWhy:
      "Right title and region, and an inbound pricing question. Healthcare procurement cycles are long, and no budget signal is on file.",
    confidence: "medium",
    dimensions: [
      { label: "ICP fit", value: 62 },
      { label: "Problem severity", value: 55 },
      { label: "Evidence strength", value: 70 },
      { label: "Trigger strength", value: 68 },
      { label: "Trigger freshness", value: 88 },
      { label: "Buying likelihood", value: 60 },
      { label: "Product relevance", value: 58 },
      { label: "Decision-maker accessibility", value: "unknown" },
    ],
    status: "replied",
    signal: "Replied — asked for pricing",
    aiScored: true,
  },
  {
    id: "ld_04",
    company: "SVP Chain",
    domain: "svpchain.io",
    person: "Tom Aldridge",
    title: "Founder",
    priority: "watch",
    priorityReason:
      "Plausible fit on tech stack alone. A website rebuild is not evidence of a problem we solve.",
    score: 52,
    scoreWhy:
      "Founder-led company under 10 employees — below the ICP headcount floor, and the only signal is a website rebuild.",
    confidence: "low",
    dimensions: [
      { label: "ICP fit", value: 41 },
      { label: "Problem severity", value: "unknown" },
      { label: "Evidence strength", value: 28 },
      { label: "Trigger strength", value: 22 },
      { label: "Trigger freshness", value: 80 },
      { label: "Buying likelihood", value: "unknown" },
      { label: "Product relevance", value: 55 },
      { label: "Decision-maker accessibility", value: 90 },
    ],
    status: "new",
    signal: "Website rebuild detected",
    aiScored: true,
  },
  {
    id: "ld_05",
    company: "Harbourfront Capital",
    domain: "harbourfront.fund",
    person: "Elise Duforet",
    title: "Operating Partner",
    priority: "ignore",
    priorityReason:
      "Outside every active ICP. Matched on region only, which is not a reason to contact anyone.",
    score: 34,
    scoreWhy:
      "Matched on region only. Firmographics fall outside every active ICP; surfaced by a broad source, not by a signal.",
    confidence: "high",
    dimensions: [
      { label: "ICP fit", value: 12 },
      { label: "Problem severity", value: "unknown" },
      { label: "Evidence strength", value: 18 },
      { label: "Trigger strength", value: 0 },
      { label: "Trigger freshness", value: 0 },
      { label: "Buying likelihood", value: "unknown" },
      { label: "Product relevance", value: 15 },
      { label: "Decision-maker accessibility", value: "unknown" },
    ],
    status: "rejected",
    signal: "—",
    aiScored: true,
  },
];

const STATUS_META: Record<
  Opportunity["status"],
  { label: string; variant: "neutral" | "brand" | "info" | "success" | "danger" }
> = {
  new: { label: "New", variant: "info" },
  qualified: { label: "Qualified", variant: "brand" },
  contacted: { label: "Contacted", variant: "neutral" },
  replied: { label: "Replied", variant: "success" },
  rejected: { label: "Rejected", variant: "danger" },
};

/* ── Page ──────────────────────────────────────────────────────────────── */

export default function KitchenSink() {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState("company");
  const [selected, setSelected] = useState<string[]>([]);
  /* Default sort is priority, then score — not score alone. §78 requires a
     strong trigger to be unable to make a poor-fit company HOT, so the
     verdict is what the list is ordered by and the score is detail within it. */
  const [sort, setSort] = useState<{ key: string; direction: "asc" | "desc" }>({
    key: "priority",
    direction: "desc",
  });

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? OPPORTUNITIES.filter((l) =>
          (scope === "company" ? l.company : scope === "person" ? l.person : l.domain)
            .toLowerCase()
            .includes(q),
        )
      : OPPORTUNITIES;

    return [...filtered].sort((a, b) => {
      const dir = sort.direction === "asc" ? 1 : -1;
      if (sort.key === "priority") {
        const rank = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
        return (rank !== 0 ? rank : a.score - b.score) * dir;
      }
      if (sort.key === "score") return (a.score - b.score) * dir;
      if (sort.key === "company") return a.company.localeCompare(b.company) * dir;
      return 0;
    });
  }, [query, scope, sort]);

  const columns: Column<Opportunity>[] = [
    {
      key: "company",
      header: "Company",
      width: "24%",
      sortable: true,
      render: (l) => (
        <div className="min-w-0">
          <div className="truncate font-medium text-fg">{l.company}</div>
          <div className="truncate font-mono text-[11px] text-fg-muted">
            {l.domain}
          </div>
        </div>
      ),
    },
    {
      key: "person",
      header: "Contact",
      width: "22%",
      render: (l) => (
        <div className="min-w-0">
          <div className="truncate text-fg">{l.person}</div>
          <div className="truncate text-[11px] text-fg-muted">{l.title}</div>
        </div>
      ),
    },
    {
      key: "signal",
      header: "Top signal",
      render: (l) => <span className="text-fg-secondary">{l.signal}</span>,
    },
    {
      key: "priority",
      header: "Priority",
      width: "96px",
      sortable: true,
      render: (l) => <PriorityBadge priority={l.priority} reason={l.priorityReason} />,
    },
    {
      key: "score",
      header: "Score",
      width: "88px",
      align: "center",
      sortable: true,
      render: (l) => (
        <ScorePill
          score={l.score}
          explanation={l.scoreWhy}
          confidence={l.confidence}
          dimensions={l.dimensions}
        />
      ),
    },
    {
      key: "status",
      header: "Status",
      width: "130px",
      render: (l) => (
        <StatusDot
          variant={STATUS_META[l.status].variant}
          label={STATUS_META[l.status].label}
        />
      ),
    },
  ];

  return (
    <main className="mx-auto w-full max-w-[1400px] px-6 py-8 lg:px-10">
      {/* ── Page header (Kima's Command Center chrome) ─────────────────── */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="hl-heading text-fg">
              Command Center
            </h1>
            <Badge variant="brand" dot>
              Live
            </Badge>
          </div>
          <p className="mt-1 text-[13px] text-fg-muted">
            Tuesday, August 11, 2026 · 14 sources monitored · autonomy L2 —
            Huntloop recommends, you approve
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button icon={RefreshCw} variant="ghost" aria-label="Refresh" />
          <Button icon={Download} variant="secondary">
            Export
          </Button>
          <Button icon={Plus} variant="primary">
            New campaign
          </Button>
        </div>
      </header>

      {/* ── Alert chips ───────────────────────────────────────────────────
          Spans, not anchors. This page is a swatch board: it exists to show
          what a chip looks like in each of the three semantic colours, and it
          has no org in scope to link anywhere. `href="#"` would announce three
          links to a screen reader and move focus nowhere when activated.
          The trailing "→" goes too — it reads as "this navigates". */}
      <div className="mt-6 flex flex-wrap gap-2">
        <span className="inline-flex h-8 items-center gap-2 rounded-md border border-warning-border bg-warning-surface px-3 text-[13px] text-warning-text">
          <Zap className="size-3.5" strokeWidth={1.75} />
          9 new triggers in the last 24h
        </span>
        <span className="inline-flex h-8 items-center gap-2 rounded-md border border-brand-border bg-brand-surface px-3 text-[13px] text-brand-text">
          <Sparkles className="size-3.5" strokeWidth={1.75} />
          12 opportunities awaiting review
        </span>
        <span className="inline-flex h-8 items-center gap-2 rounded-md border border-ai-border bg-ai-surface px-3 text-[13px] text-ai-text">
          <MessageSquare className="size-3.5" strokeWidth={1.75} />
          5 messages need approval
        </span>
      </div>

      {/* ── Pipeline overview ─────────────────────────────────────────── */}
      <section className="mt-8">
        <SectionLabel>Pipeline overview</SectionLabel>
        {/*
          Exactly one card keeps an `href`, and it points at a real page.

          All eight carried `href="#"`, so the gallery rendered eight links
          that announced as links, showed "Click to view →", and moved focus
          nowhere on activation. The linked variant is worth demonstrating —
          it changes the hover border, reveals the corner arrow, and adds the
          affordance line — but demonstrating it once against a URL that
          resolves is enough. The rest show the default, which is what most
          real call sites use.
        */}
        <StatGrid className="mt-3">
          <StatCard label="New today" value={0} icon={Inbox} />
          <StatCard
            label="Qualified"
            value={54}
            icon={Target}
            tone="brand"
            href="/kitchen-sink"
            linkComponent={Link}
            aiGenerated
          />
          <StatCard label="Approved" value={5} icon={CheckCircle2} tone="success" />
          <StatCard label="Contacted" value={90} icon={Send} />
        </StatGrid>

        <SectionLabel className="mt-8">Outcomes</SectionLabel>
        <StatGrid className="mt-3">
          <StatCard label="Replied" value={5} icon={MessageSquare} tone="info" />
          <StatCard label="Meetings" value={2} icon={CalendarCheck} tone="success" />
          <StatCard label="Rejected" value={2} icon={XCircle} tone="danger" />
          <StatCard
            label="Total companies"
            value={180}
            icon={Users}
            hint="of 1,000 on the Growth plan"
          />
        </StatGrid>
      </section>

      {/* ── Opportunity table ─────────────────────────────────────────── */}
      <section className="mt-10">
        <SectionLabel>Recent opportunities</SectionLabel>
        <div className="mt-3">
          <FilterBar
            value={query}
            onChange={setQuery}
            placeholder="Search opportunities…"
            scopes={[
              { value: "company", label: "Company" },
              { value: "person", label: "Contact name" },
              { value: "domain", label: "Domain" },
            ]}
            scope={scope}
            onScopeChange={setScope}
            selectionCount={selected.length}
            selectionActions={
              <>
                <Button size="sm" variant="secondary" icon={Send}>
                  Add to campaign
                </Button>
                <Button size="sm" variant="danger" icon={Trash2}>
                  Reject
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setSelected([])}
                >
                  Clear
                </Button>
              </>
            }
            actions={
              <>
                <Button icon={RefreshCw} variant="ghost" aria-label="Refresh" />
                <Button variant="primary" icon={Plus}>
                  Analyze a URL
                </Button>
              </>
            }
          />
        </div>

        <DataTable
          className="mt-3"
          rows={rows}
          columns={columns}
          rowKey={(l) => l.id}
          selectedIds={selected}
          onSelectionChange={setSelected}
          sort={sort}
          onSortChange={setSort}
          empty={
            <span className="text-[13px] text-fg-muted">
              No opportunities match “{query}”. Try a different search field.
            </span>
          }
        />
        <p className="mt-2 text-[12px] text-fg-muted">
          Hover or focus a score to see why the model assigned it. Scores never
          appear without an explanation.
        </p>
      </section>

      {/* ── Intelligence primitives ────────────────────────────────────
          The four components that carry the master context's non-negotiable
          rules: the §15 verdict, the §7 fact/inference/unknown split, §52
          provenance, and §81 freshness. Everything else in this gallery is
          chrome; these are the product. */}
      <section className="mt-12">
        <SectionLabel>Intelligence primitives</SectionLabel>
        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          <Card flush>
            <CardHeader
              title="Priority"
              description="HOT / WARM / WATCH / IGNORE — hover for the reason behind the verdict."
            />
            <CardBody className="flex flex-wrap items-center gap-3">
              <PriorityBadge
                priority="hot"
                size="md"
                reason="Strong ICP fit, evidenced pain, and a trigger 3 days old."
              />
              <PriorityBadge
                priority="warm"
                size="md"
                reason="Good fit and real pain, but the trigger is six weeks old."
              />
              <PriorityBadge
                priority="watch"
                size="md"
                reason="Plausible fit; the evidence on file does not support contacting yet."
              />
              <PriorityBadge
                priority="ignore"
                size="md"
                reason="Wrong segment — sells to consumers, not institutions."
              />
            </CardBody>
          </Card>

          <Card flush>
            <CardHeader
              title="Claim kind"
              description="An inference is never allowed to render as a fact."
            />
            <CardBody className="flex flex-wrap items-center gap-3">
              <ClaimBadge kind="fact" confidence="high" size="md" />
              <ClaimBadge kind="inference" confidence="medium" size="md" />
              <ClaimBadge kind="unknown" size="md" />
            </CardBody>
          </Card>

          <Card flush>
            <CardHeader
              title="Freshness"
              description="Presentation of signal age. Not the scoring decay curve — that is undefined."
            />
            <CardBody className="flex flex-col gap-2">
              <Freshness date="2026-08-10" now={DEMO_NOW} label="Triggered" />
              <Freshness date="2026-07-28" now={DEMO_NOW} label="Triggered" />
              <Freshness date="2026-06-20" now={DEMO_NOW} label="Triggered" />
              <Freshness date="2026-01-15" now={DEMO_NOW} label="Triggered" />
            </CardBody>
          </Card>

          <Card flush>
            <CardHeader
              title="Evidence"
              description="Source, excerpt, event date, observed date, confidence — §52 in full."
            />
            <CardBody>
              <EvidenceList
                now={DEMO_NOW}
                items={[
                  {
                    claim: "Alphio AI closed a $12M Series A on 8 Aug.",
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
                      "Their agents will need controlled financial permissions before institutions onboard.",
                    kind: "inference",
                    confidence: "medium",
                    source: "Derived from the launch post",
                    eventDate: "2026-08-08",
                    observedAt: "2026-08-09",
                  },
                  {
                    claim: "Which wallet architecture they use today.",
                    kind: "unknown",
                  },
                ]}
              />
            </CardBody>
          </Card>
        </div>
      </section>

      {/* ── Component gallery ─────────────────────────────────────────── */}
      <section className="mt-12 grid gap-4 lg:grid-cols-2">
        <Card flush>
          <CardHeader
            title="Badges"
            description="Green = system state. Violet = an AI produced this."
          />
          <CardBody className="flex flex-wrap gap-2">
            <Badge>Free</Badge>
            <Badge variant="brand">Production</Badge>
            <Badge variant="ai">AI</Badge>
            <Badge variant="success" dot>
              Healthy
            </Badge>
            <Badge variant="warning" dot>
              Degraded
            </Badge>
            <Badge variant="danger" dot>
              Bounced
            </Badge>
            <Badge variant="info">Beta</Badge>
            <Badge variant="ai" size="md">
              New
            </Badge>
          </CardBody>
        </Card>

        <Card flush>
          <CardHeader title="Buttons" description="32px default, 6px radius, no shadow." />
          <CardBody className="flex flex-wrap items-center gap-2">
            <Button variant="primary">Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">Danger</Button>
            <Button variant="primary" size="sm" icon={Plus}>
              Small
            </Button>
            <Button variant="secondary" size="lg" icon={Send}>
              Large
            </Button>
            <Button variant="secondary" disabled>
              Disabled
            </Button>
          </CardBody>
        </Card>

        <Card flush>
          <CardHeader
            title="Score pills"
            description="Eight named dimensions (master context §51), never one opaque number."
          />
          <CardBody className="flex flex-wrap items-center gap-4">
            {[34, 52, 64, 78, 91].map((s) => (
              <ScorePill
                key={s}
                score={s}
                explanation="Demo score — hover or focus for the dimension breakdown behind it."
                confidence={s >= 78 ? "high" : s >= 52 ? "medium" : "low"}
                dimensions={[
                  { label: "ICP fit", value: Math.min(100, s + 6) },
                  { label: "Problem severity", value: s },
                  { label: "Evidence strength", value: Math.max(0, s - 12) },
                  { label: "Trigger strength", value: s },
                  { label: "Trigger freshness", value: Math.max(0, s - 4) },
                  // Deliberately unmeasured — an unknown dimension reads as
                  // UNKNOWN, never as a zero (§78).
                  { label: "Buying likelihood", value: "unknown" },
                  { label: "Product relevance", value: Math.min(100, s + 3) },
                  { label: "Decision-maker accessibility", value: "unknown" },
                ]}
              />
            ))}
          </CardBody>
        </Card>

        <Card flush>
          <CardHeader title="Empty & loading states" />
          <CardBody className="space-y-3">
            <DataTable
              rows={[]}
              columns={[
                { key: "a", header: "Company", render: () => null },
                { key: "b", header: "Score", render: () => null },
              ]}
              rowKey={() => ""}
              loading
            />
            <DataTable
              rows={[]}
              columns={[
                { key: "a", header: "Company", render: () => null },
                { key: "b", header: "Score", render: () => null },
              ]}
              rowKey={() => ""}
              empty={
                <div className="space-y-2">
                  <div className="text-[13px] text-fg-secondary">
                    No opportunities discovered yet
                  </div>
                  <div className="text-[12px] text-fg-muted">
                    Define an ICP and pick your sources to start hunting.
                  </div>
                  <Button size="sm" variant="primary" className="mt-1">
                    Create ICP
                  </Button>
                </div>
              }
            />
          </CardBody>
        </Card>
      </section>

      <OverlaysAndFeedback />

      <footer className="mt-12 border-t border-line-subtle pt-6 text-[12px] text-fg-muted">
        Huntloop design system · tokens in{" "}
        <span className="font-mono text-fg-secondary">
          packages/ui/src/tokens.css
        </span>{" "}
        · color and chrome from Supabase, dashboard IA from Kima BD OS
        <br />
        <Link href="/acme/dashboard" className="hl-focusable rounded-sm text-brand-text hover:underline">
          View the assembled Command Center →
        </Link>
      </footer>
    </main>
  );
}

/**
 * Overlays and feedback.
 *
 * Its own component rather than more JSX in `KitchenSink`, because these
 * three need state to demonstrate at all — a modal that is never open and a
 * menu that never opens are two rectangles.
 *
 * They are in the gallery for the same reason everything else is: it is the
 * page `e2e/a11y.spec.ts` runs axe against, so a component that appears
 * here is a component whose contrast, labelling and roles are checked on
 * every run. One that only exists on a screen behind a click is not.
 */
function OverlaysAndFeedback() {
  const [modalOpen, setModalOpen] = useState(false);
  const { toast } = useToast();

  return (
    <section className="mt-12">
      <SectionLabel>Overlays and feedback</SectionLabel>
      <div className="mt-3 grid gap-4 lg:grid-cols-2">
        <Card flush>
          <CardHeader
            title="Notes"
            description="An inline notice beside content that is there — not a state standing in for content that is not."
          />
          <CardBody className="flex flex-col gap-2.5">
            <Note>
              Your role is read-only. You can see what your opportunities are
              scored against, but not change it.
            </Note>
            <Note tone="info">
              Discovery runs once a day. The next pass is scheduled for 06:00.
            </Note>
            <Note tone="warning">
              No model is connected, so drafting and scoring are paused.
            </Note>
            <Note tone="danger">
              The last sync to HubSpot failed. Nothing has been written since.
            </Note>
          </CardBody>
        </Card>

        <Card flush>
          <CardHeader
            title="Modal, menu, toast"
            description="Dismissal, focus and announcement — the three things these get wrong when hand-rolled."
          />
          <CardBody className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={() => setModalOpen(true)}>
              Open a modal
            </Button>

            <Menu
              linkComponent={Link}
              items={[
                { label: "Copy link", icon: Copy, onSelect: () => {} },
                { label: "Export CSV", icon: Download, onSelect: () => {} },
                { label: "Open the Command Center", href: "/acme/dashboard" },
                {
                  label: "Delete",
                  icon: Trash2,
                  tone: "danger",
                  separated: true,
                  onSelect: () => {},
                },
              ]}
              trigger={(props) => (
                <Button variant="secondary" {...props} aria-label="Row actions">
                  <MoreHorizontal className="size-4" strokeWidth={1.75} />
                </Button>
              )}
            />

            <Button
              variant="ghost"
              onClick={() =>
                toast({
                  tone: "success",
                  title: "Opportunity archived",
                  description: "Alphio AI has moved out of the queue.",
                  action: { label: "Undo", onClick: () => {} },
                })
              }
            >
              Confirm something
            </Button>

            <Button
              variant="ghost"
              onClick={() =>
                toast({
                  tone: "danger",
                  title: "Could not reach the model",
                  description: "Nothing was drafted. Your text is unchanged.",
                })
              }
            >
              Fail at something
            </Button>
          </CardBody>
        </Card>
      </div>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Delete this workspace?"
        description="This cannot be undone."
        footer={
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => setModalOpen(false)}>
              Delete workspace
            </Button>
          </>
        }
      >
        <p>
          Every opportunity, company, contact and message in this workspace is
          removed, along with the evidence behind each score. Members lose
          access immediately.
        </p>
        <Note tone="warning" className="mt-4">
          Exports are not kept. Download anything you need before confirming.
        </Note>
      </Modal>
    </section>
  );
}
