import {
  ActionRail,
  ActionRailItem,
  Badge,
  BreakdownList,
  Button,
  Card,
  CardHeader,
  QuotaBar,
  QuotaBarGroup,
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
  Users,
  XCircle,
  Zap,
} from "lucide-react";

/**
 * The real Command Center — plan §2's ASCII layout assembled from the
 * design-system primitives, replacing the /kitchen-sink gallery view for
 * this one screen. Fixtures only; wiring to Supabase is Phase 0/1.
 */
export default async function DashboardPage({
  params,
}: {
  params: Promise<{ org: string }>;
}) {
  const { org } = await params;

  return (
    <div className="mx-auto grid w-full max-w-[1600px] gap-6 px-6 py-8 lg:px-8 2xl:grid-cols-[minmax(0,1fr)_320px]">
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
              {org} · 3 campaigns running · autonomy L2 — AI recommends, you
              approve
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
        </div>

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

        <section className="mt-10">
          <SectionLabel>Sending capacity</SectionLabel>
          <Card className="mt-3">
            <QuotaBarGroup>
              <QuotaBar label="founder@acme.co" used={38} limit={50} />
              <QuotaBar label="sales@acme.co" used={50} limit={50} />
            </QuotaBarGroup>
          </Card>
        </section>

        <section className="mt-10 grid gap-4 lg:grid-cols-[1fr_320px]">
          <Card flush>
            <CardHeader title="Recent leads" description="Sorted by score." />
            <ul className="divide-y divide-line-subtle">
              {[
                {
                  company: "Alphio AI",
                  signal: "Raised $12M Series A",
                  score: 91,
                  status: "Qualified" as const,
                  variant: "brand" as const,
                },
                {
                  company: "Northwind Logistics",
                  signal: "Job post: Sales Development",
                  score: 78,
                  status: "Contacted" as const,
                  variant: "neutral" as const,
                },
                {
                  company: "Cormorant Health",
                  signal: "Replied — asked for pricing",
                  score: 64,
                  status: "Replied" as const,
                  variant: "success" as const,
                },
              ].map((lead) => (
                <li
                  key={lead.company}
                  className="flex items-center justify-between gap-3 px-5 py-3"
                >
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-medium text-fg">
                      {lead.company}
                    </div>
                    <div className="truncate text-[12px] text-fg-muted">{lead.signal}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <StatusDot variant={lead.variant} label={lead.status} />
                    <ScorePill
                      score={lead.score}
                      explanation="Demo score for the Command Center preview."
                      size="sm"
                    />
                  </div>
                </li>
              ))}
            </ul>
          </Card>

          <Card flush>
            <CardHeader title="By ICP" />
            <div className="p-5">
              <BreakdownList
                items={[
                  { label: "SaaS", value: 67 },
                  { label: "Fintech", value: 43 },
                  { label: "Healthcare", value: 28 },
                  { label: "Logistics", value: 19 },
                ]}
              />
            </div>
          </Card>
        </section>
      </div>

      {/* ── Action rail ───────────────────────────────────────────────
          Only sits beside content at ≥1536px (Tailwind 2xl) — the grid
          above stacks to a single column below that, so the rail never
          overlays main content, per plan §1.4 #9 / §2. */}
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
        <ActionRailItem
          title="sales@acme.co at 100% capacity"
          source="Mailbox"
          sourceVariant="warning"
          meta="Resets at midnight"
          primaryLabel="View"
        />
      </ActionRail>
    </div>
  );
}
