"use client";

import { useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Column,
  DataTable,
  FilterBar,
  ScorePill,
  SectionLabel,
  StatCard,
  StatGrid,
  StatusDot,
} from "@huntloop/ui";
import {
  CalendarCheck,
  CheckCircle2,
  Download,
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

type Lead = {
  id: string;
  company: string;
  domain: string;
  person: string;
  title: string;
  score: number;
  scoreWhy: string;
  factors: { label: string; impact: number }[];
  status: "new" | "qualified" | "contacted" | "replied" | "rejected";
  signal: string;
  aiScored: boolean;
};

const LEADS: Lead[] = [
  {
    id: "ld_01",
    company: "Alphio AI",
    domain: "alphio.ai",
    person: "Marta Kovacs",
    title: "VP Revenue Operations",
    score: 91,
    scoreWhy:
      "Series A eight weeks ago, hiring 3 SDRs, and running a competitor's sequencing tool that we displace in 70% of head-to-heads.",
    factors: [
      { label: "Funding within 90d", impact: 22 },
      { label: "Hiring SDRs", impact: 18 },
      { label: "Competitor tech detected", impact: 15 },
      { label: "Headcount below ICP floor", impact: -6 },
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
    score: 78,
    scoreWhy:
      "Strong firmographic fit and an active outbound team, but no trigger event in the last 90 days.",
    factors: [
      { label: "Industry match", impact: 20 },
      { label: "Employee count in band", impact: 14 },
      { label: "No recent trigger", impact: -12 },
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
    score: 64,
    scoreWhy:
      "Right title and region, but healthcare procurement cycles historically convert at 0.4× our baseline.",
    factors: [
      { label: "Title match", impact: 16 },
      { label: "Region match", impact: 8 },
      { label: "Vertical converts below baseline", impact: -14 },
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
    score: 52,
    scoreWhy:
      "Founder-led company under 10 employees — below the ICP headcount floor, and no budget signal detected.",
    factors: [
      { label: "Tech stack overlap", impact: 12 },
      { label: "Below headcount floor", impact: -18 },
      { label: "No budget signal", impact: -8 },
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
    score: 34,
    scoreWhy:
      "Matched on region only. Firmographics fall outside every active ICP; surfaced by a broad saved search.",
    factors: [
      { label: "Region match", impact: 8 },
      { label: "Industry outside ICP", impact: -20 },
      { label: "No role fit", impact: -10 },
    ],
    status: "rejected",
    signal: "—",
    aiScored: true,
  },
];

const STATUS_META: Record<
  Lead["status"],
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
  const [sort, setSort] = useState<{ key: string; direction: "asc" | "desc" }>({
    key: "score",
    direction: "desc",
  });

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? LEADS.filter((l) =>
          (scope === "company" ? l.company : scope === "person" ? l.person : l.domain)
            .toLowerCase()
            .includes(q),
        )
      : LEADS;

    return [...filtered].sort((a, b) => {
      const dir = sort.direction === "asc" ? 1 : -1;
      if (sort.key === "score") return (a.score - b.score) * dir;
      if (sort.key === "company") return a.company.localeCompare(b.company) * dir;
      return 0;
    });
  }, [query, scope, sort]);

  const columns: Column<Lead>[] = [
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
      key: "score",
      header: "Score",
      width: "88px",
      align: "center",
      sortable: true,
      render: (l) => (
        <ScorePill
          score={l.score}
          explanation={l.scoreWhy}
          factors={l.factors}
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
            <h1 className="text-[30px] leading-9 font-semibold text-fg">
              Command Center
            </h1>
            <Badge variant="brand" dot>
              Live
            </Badge>
          </div>
          <p className="mt-1 text-[13px] text-fg-muted">
            Monday, August 10, 2026 · 3 campaigns running · autonomy L2 —
            AI recommends, you approve
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

      {/* ── Alert chips ───────────────────────────────────────────────── */}
      <div className="mt-6 flex flex-wrap gap-2">
        <a
          href="#"
          className="hl-focusable inline-flex h-8 items-center gap-2 rounded-md border border-warning-border bg-warning-surface px-3 text-[13px] text-warning transition-colors duration-[120ms] hover:border-warning"
        >
          <Zap className="size-3.5" strokeWidth={1.75} />
          61 leads awaiting review →
        </a>
        <a
          href="#"
          className="hl-focusable inline-flex h-8 items-center gap-2 rounded-md border border-brand-border bg-brand-surface px-3 text-[13px] text-brand-text transition-colors duration-[120ms] hover:border-brand"
        >
          <Sparkles className="size-3.5" strokeWidth={1.75} />
          88 leads scored 70+ →
        </a>
        <a
          href="#"
          className="hl-focusable inline-flex h-8 items-center gap-2 rounded-md border border-ai-border bg-ai-surface px-3 text-[13px] text-ai-text transition-colors duration-[120ms] hover:border-ai"
        >
          <MessageSquare className="size-3.5" strokeWidth={1.75} />
          5 messages need approval →
        </a>
      </div>

      {/* ── Pipeline overview ─────────────────────────────────────────── */}
      <section className="mt-8">
        <SectionLabel>Pipeline overview</SectionLabel>
        <StatGrid className="mt-3">
          <StatCard label="New today" value={0} icon={Inbox} href="#" />
          <StatCard
            label="Qualified"
            value={54}
            icon={Target}
            tone="brand"
            href="#"
            aiGenerated
          />
          <StatCard label="Approved" value={5} icon={CheckCircle2} tone="success" href="#" />
          <StatCard label="Contacted" value={90} icon={Send} href="#" />
        </StatGrid>

        <SectionLabel className="mt-8">Outcomes</SectionLabel>
        <StatGrid className="mt-3">
          <StatCard label="Replied" value={5} icon={MessageSquare} tone="info" href="#" />
          <StatCard
            label="Meetings"
            value={2}
            icon={CalendarCheck}
            tone="success"
            href="#"
          />
          <StatCard label="Rejected" value={2} icon={XCircle} tone="danger" href="#" />
          <StatCard
            label="Total leads"
            value={180}
            icon={Users}
            hint="of 1,000 on the Growth plan"
          />
        </StatGrid>
      </section>

      {/* ── Lead table ────────────────────────────────────────────────── */}
      <section className="mt-10">
        <SectionLabel>Recent leads</SectionLabel>
        <div className="mt-3">
          <FilterBar
            value={query}
            onChange={setQuery}
            placeholder="Search leads…"
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
                  Add lead
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
              No leads match “{query}”. Try a different search field.
            </span>
          }
        />
        <p className="mt-2 text-[12px] text-fg-muted">
          Hover or focus a score to see why the model assigned it. Scores never
          appear without an explanation.
        </p>
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
            description="Band colors: poor / fair / good / excellent."
          />
          <CardBody className="flex flex-wrap items-center gap-4">
            {[34, 52, 64, 78, 91].map((s) => (
              <ScorePill
                key={s}
                score={s}
                explanation="Demo score — hover shows the factor breakdown that produced it."
                factors={[
                  { label: "Firmographic fit", impact: 18 },
                  { label: "Trigger event", impact: 12 },
                  { label: "Missing budget signal", impact: -9 },
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
                    No leads discovered yet
                  </div>
                  <div className="text-[12px] text-fg-muted">
                    Define an ICP to start discovery.
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

      <footer className="mt-12 border-t border-line-subtle pt-6 text-[12px] text-fg-muted">
        Huntloop design system · tokens in{" "}
        <span className="font-mono text-fg-secondary">
          packages/ui/src/tokens.css
        </span>{" "}
        · color and chrome from Supabase, dashboard IA from Kima BD OS
      </footer>
    </main>
  );
}
