"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  Field,
  FilterBar,
  FormMessage,
  Freshness,
  PriorityBadge,
  ScorePill,
  SectionLabel,
  Select,
  StatCard,
  StatGrid,
  type Column,
  type Priority,
} from "@huntloop/ui";
import { Binoculars, Eye, Flame, Plus, Radar, Send, Thermometer } from "lucide-react";
import type { OpportunityRow } from "../../../../lib/data/opportunities";
import type { CampaignTarget } from "../../../../lib/data/outreach";
import { enrollOpportunitiesAction } from "./actions";
import { RefreshButton } from "../RefreshButton";

/**
 * The opportunity list.
 *
 * The default sort is priority, then score — not score alone. §78 requires
 * that a strong trigger cannot lift a poor-fit company, so the verdict orders
 * the list and the score is detail within it. That is also the index the
 * migration creates (`opportunities_priority_idx`), so the UI default and the
 * query plan agree rather than quietly fighting.
 *
 * The priority filter is a real filter, not a saved view: §15's four buckets
 * are the primary way a salesperson triages, and burying them in a dropdown
 * would make the product's headline classification a second-class control.
 */

const RANK: Record<Priority, number> = { ignore: 0, watch: 1, warm: 2, hot: 3 };

const FILTERS: { value: Priority | "all"; label: string; icon: typeof Flame }[] = [
  { value: "all", label: "All", icon: Eye },
  { value: "hot", label: "Hot", icon: Flame },
  { value: "warm", label: "Warm", icon: Thermometer },
  { value: "watch", label: "Watch", icon: Eye },
  { value: "ignore", label: "Ignore", icon: Binoculars },
];

export function OpportunityTable({
  org,
  rows: all,
  now,
  initialPriority,
  initialQuery,
  canWrite,
  campaigns,
}: {
  org: string;
  rows: OpportunityRow[];
  /**
   * The server's clock as an ISO string, so every relative age on the page is
   * measured from one instant. Passed rather than read here: a client clock
   * can be wrong, and two `new Date()` calls in one render are two instants.
   */
  now: string;
  /** Seeded from `?priority=` by the server component. See page.tsx. */
  initialPriority?: Priority;
  /**
   * Seeded from `?company=`, for the same reason `initialPriority` exists.
   * The Companies screen shows how many live opportunities each company has,
   * and that number needs somewhere to go — without this it would either be
   * inert text or a link to an unfiltered list, which is a link that lies
   * about where it lands.
   */
  initialQuery?: string;
  /**
   * Whether to render the write affordances. Resolved on the server — this is
   * a rendering decision, not an authorization one; RLS is the boundary and
   * refuses the write regardless. See lib/data/membership.ts.
   */
  canWrite: boolean;
  /**
   * The campaigns a selection can be added to, loaded by the server component.
   *
   * Passed rather than fetched on demand because the button that opens the
   * picker has to know whether there is anything to pick before it is pressed
   * — a control that opens onto "no campaigns" is a control that should have
   * said so.
   */
  campaigns: CampaignTarget[];
}) {
  const [query, setQuery] = useState(initialQuery ?? "");
  const [scope, setScope] = useState("company");
  /* Initial value only — clicking a filter does not rewrite the URL. Keeping
     them in sync would mean a router push per click, which re-runs the server
     component to change a `useState` the client already owns. The deep link is
     for arriving here from elsewhere; once you are here, the buttons are the
     control. */
  const [priority, setPriority] = useState<Priority | "all">(initialPriority ?? "all");
  const [selected, setSelected] = useState<string[]>([]);
  const [enrolling, setEnrolling] = useState(false);
  const [sort, setSort] = useState<{ key: string; direction: "asc" | "desc" }>({
    key: "priority",
    direction: "desc",
  });

  const counts = useMemo(() => {
    const c: Record<Priority, number> = { hot: 0, warm: 0, watch: 0, ignore: 0 };
    for (const o of all) c[o.priority]++;
    return c;
  }, [all]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = all;
    if (priority !== "all") out = out.filter((o) => o.priority === priority);
    if (q) {
      out = out.filter((o) =>
        (scope === "company" ? o.company : scope === "domain" ? o.domain : o.industry)
          .toLowerCase()
          .includes(q),
      );
    }
    return [...out].sort((a, b) => {
      const dir = sort.direction === "asc" ? 1 : -1;
      if (sort.key === "priority") {
        const r = RANK[a.priority] - RANK[b.priority];
        return (r !== 0 ? r : a.score - b.score) * dir;
      }
      if (sort.key === "score") return (a.score - b.score) * dir;
      if (sort.key === "company") return a.company.localeCompare(b.company) * dir;
      if (sort.key === "trigger")
        return (Date.parse(a.triggerDate) - Date.parse(b.triggerDate)) * dir;
      return 0;
    });
  }, [all, priority, query, scope, sort]);

  const columns: Column<OpportunityRow>[] = [
    {
      key: "company",
      header: "Company",
      width: "26%",
      sortable: true,
      render: (o) => (
        <Link
          href={`/${org}/opportunities/${o.id}`}
          className="hl-focusable block min-w-0 rounded-sm"
        >
          <div className="truncate font-medium text-fg">{o.company}</div>
          <div className="truncate font-mono text-[11px] text-fg-muted">{o.domain}</div>
        </Link>
      ),
    },
    {
      key: "priority",
      header: "Priority",
      width: "104px",
      sortable: true,
      render: (o) => <PriorityBadge priority={o.priority} reason={o.priorityReason} />,
    },
    {
      key: "score",
      header: "Score",
      width: "80px",
      align: "center",
      sortable: true,
      render: (o) => (
        <ScorePill
          score={o.score}
          explanation={o.scoreExplanation}
          confidence={o.confidence}
          dimensions={o.dimensions}
          size="sm"
        />
      ),
    },
    {
      key: "trigger",
      header: "Why now",
      sortable: true,
      render: (o) => (
        <div className="min-w-0">
          <div className="truncate text-fg-secondary">{o.trigger}</div>
          <Freshness date={o.triggerDate} now={now} />
        </div>
      ),
    },
    {
      key: "evidence",
      header: "Evidence",
      width: "128px",
      render: (o) => (
        <span className="text-[12px] text-fg-muted">
          {o.evidence.filter((e) => e.kind === "fact").length} fact ·{" "}
          {o.evidence.filter((e) => e.kind === "unknown").length} unknown
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      width: "116px",
      render: (o) => <Badge variant="neutral">{o.status}</Badge>,
    },
  ];

  return (
    <div className="mx-auto w-full max-w-[1600px] px-6 py-8 lg:px-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[30px] leading-9 font-semibold text-fg">Opportunities</h1>
          <p className="mt-1 text-[13px] text-fg-muted">
            {all.length} qualified against your ICP · ordered by verdict, then score
          </p>
        </div>
        {/* One Refresh, not two. There was a second identical one eleven rows
            below in the FilterBar; that is the one kept, because it sits with
            the other controls that change what is displayed (audit UX-04).

            "Analyze a URL" is a real destination and is now a link to it. It
            was a primary button with no handler on the screen a salesperson
            spends the most time on. */}
        <div className="flex items-center gap-2">
          {canWrite && (
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

      <section className="mt-6">
        <SectionLabel>Priority</SectionLabel>
        <StatGrid className="mt-3">
          <StatCard label="Hot" value={counts.hot} icon={Flame} tone="hot" aiGenerated />
          <StatCard label="Warm" value={counts.warm} icon={Thermometer} tone="warm" aiGenerated />
          <StatCard label="Watch" value={counts.watch} icon={Eye} tone="watch" aiGenerated />
          <StatCard label="Ignore" value={counts.ignore} icon={Binoculars} tone="ignore" aiGenerated />
        </StatGrid>
      </section>

      <div className="mt-8 flex flex-wrap gap-1.5" role="group" aria-label="Filter by priority">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            aria-pressed={priority === f.value}
            onClick={() => setPriority(f.value)}
            className={[
              "hl-focusable inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-[13px]",
              "transition-colors duration-[120ms]",
              priority === f.value
                ? "border-brand-border bg-brand-surface text-brand-text"
                : "border-line bg-surface text-fg-secondary hover:border-line-strong hover:text-fg",
            ].join(" ")}
          >
            <f.icon className="size-3.5" strokeWidth={1.75} />
            {f.label}
            {f.value !== "all" && (
              <span className="hl-tabular text-fg-muted">{counts[f.value]}</span>
            )}
          </button>
        ))}
      </div>

      {/* Below the filters and above the table, because that is where the
          selection it acts on is. A dialog would cover the rows the user is
          about to commit, which is the one thing they might still want to
          check. */}
      {enrolling && canWrite && campaigns.length > 0 && (
        <EnrollPanel
          org={org}
          campaigns={campaigns}
          selected={selected}
          onClose={() => setEnrolling(false)}
          onEnrolled={() => {
            setEnrolling(false);
            setSelected([]);
          }}
        />
      )}

      <FilterBar
        className="mt-3"
        value={query}
        onChange={setQuery}
        placeholder="Search opportunities…"
        scopes={[
          { value: "company", label: "Company" },
          { value: "domain", label: "Domain" },
          { value: "industry", label: "Industry" },
        ]}
        scope={scope}
        onScopeChange={setScope}
        selectionCount={selected.length}
        selectionActions={
          <>
            {/* Selecting rows is a read; acting on the selection is not. A
                viewer can still select and clear, which is how you compare
                things — they just get no button that would fail. */}
            {canWrite && (
              <Button
                size="sm"
                variant="secondary"
                icon={Send}
                onClick={() => setEnrolling((open) => !open)}
                pending={
                  campaigns.length === 0
                    ? "There are no campaigns to add these to yet. Create one under Outreach."
                    : undefined
                }
              >
                Add to campaign
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
              Clear
            </Button>
          </>
        }
        actions={<RefreshButton />}
      />

      <DataTable
        className="mt-3"
        rows={rows}
        columns={columns}
        rowKey={(o) => o.id}
        selectedIds={selected}
        onSelectionChange={setSelected}
        sort={sort}
        onSortChange={setSort}
        empty={
          <EmptyState
            className="border-0 bg-transparent"
            title={
              query || priority !== "all"
                ? "No opportunities match this filter"
                : "No opportunities discovered yet"
            }
            /*
             * The description used to read "Define an ICP and pick your
             * sources to start hunting" — an instruction naming two screens
             * that are `unbuilt` in the nav, given on the one screen where the
             * user has nothing else to try (audit UX-06).
             *
             * It now names only what exists, and offers it. An empty state
             * with no exit is the only place a first-time user is guaranteed
             * to be stuck.
             */
            description={
              query || priority !== "all"
                ? "Try a different priority or search field."
                : "Nothing has been qualified against your ICP yet. Analyze a company you already have in mind, or check where Huntloop is looking."
            }
            action={
              query || priority !== "all" ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setQuery("");
                    setPriority("all");
                  }}
                >
                  Clear filters
                </Button>
              ) : (
                <>
                  <Button
                    variant="primary"
                    icon={Plus}
                    href={`/${org}/analyze`}
                    linkComponent={Link}
                  >
                    Analyze a company URL
                  </Button>
                  <Button
                    variant="secondary"
                    icon={Radar}
                    href={`/${org}/sources`}
                    linkComponent={Link}
                  >
                    Review sources
                  </Button>
                </>
              )
            }
          />
        }
      />
    </div>
  );
}

/**
 * Choose a campaign, and say what enrolling will and will not do.
 *
 * ── Why the autonomy level is on every option ────────────────────────────
 *
 * Because it is the answer to the only question that matters at this moment:
 * does pressing this send email to these people. §46's ladder lives on the
 * campaign, so a picker that showed only names would make the difference
 * between "drafts for review" and "sends on its own" invisible at exactly the
 * point of no return.
 *
 * ── Why unsendable campaigns are shown, disabled ─────────────────────────
 *
 * A campaign with no email step accepts enrollments and advances them into
 * nothing. Hiding it would read as the campaign you just made having vanished;
 * showing it with the reason points at the missing step, which is the thing
 * that needs doing. The server refuses these as well — this is the explanation,
 * not the check.
 */
function EnrollPanel({
  org,
  campaigns,
  selected,
  onClose,
  onEnrolled,
}: {
  org: string;
  campaigns: CampaignTarget[];
  selected: string[];
  onClose: () => void;
  onEnrolled: () => void;
}) {
  const sendable = campaigns.filter((c) => c.sendable);
  const [campaignId, setCampaignId] = useState(sendable[0]?.id ?? "");
  const [result, setResult] = useState<
    { ok: true; message?: string } | { ok: false; error: string } | null
  >(null);
  const [pending, startTransition] = useTransition();

  const chosen = campaigns.find((c) => c.id === campaignId) ?? null;
  const count = selected.length;

  return (
    <div className="mt-3 rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Campaign" className="min-w-[240px] flex-1">
          {(field) => (
            <Select
              {...field}
              value={campaignId}
              onChange={(e) => setCampaignId(e.target.value)}
              disabled={pending}
            >
              <option value="">Choose a campaign…</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id} disabled={!c.sendable}>
                  {c.name} · {c.status} · autonomy {c.autonomyLevel}
                  {c.sendable ? "" : " — no email step yet"}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <div className="flex items-center gap-2 pb-0.5">
          <Button
            size="sm"
            variant="primary"
            icon={Send}
            disabled={pending}
            pending={
              count === 0
                ? "Select at least one opportunity first."
                : !campaignId
                  ? "Choose a campaign first."
                  : undefined
            }
            onClick={() => {
              startTransition(async () => {
                const outcome = await enrollOpportunitiesAction(org, campaignId, selected);
                setResult(outcome);
                if (outcome.ok) onEnrolled();
              });
            }}
          >
            {pending ? "Adding…" : `Add ${count} to campaign`}
          </Button>
          <Button size="sm" variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
        </div>
      </div>

      {chosen && chosen.sendable && (
        <p className="mt-3 text-[13px] text-fg-muted">
          {chosen.autonomyLevel >= 2
            ? `"${chosen.name}" is at autonomy ${chosen.autonomyLevel}, so messages it writes are sent without further approval.`
            : `"${chosen.name}" is at autonomy ${chosen.autonomyLevel}, so messages are drafted and wait for you.`}
          {chosen.status === "active"
            ? " The campaign is active, so the first step is due on the next run."
            : ` The campaign is ${chosen.status}, so nothing happens until it is started.`}
        </p>
      )}

      <FormMessage result={result} className="mt-3" />
    </div>
  );
}
