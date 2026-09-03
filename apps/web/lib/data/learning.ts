import "server-only";
import type { FindingKind, FindingProposal } from "@huntloop/ai";
import { requireOrgId } from "./org";
import { load, type Loaded } from "./source";

/**
 * Learning runs and their findings — `0010`, and the Learn stage of §4.
 *
 * ── Citations are resolved here, under RLS ───────────────────────────────
 *
 * A finding stores `uuid[]` columns naming the opportunities, companies and
 * sources it rests on. This loader turns those into labels by querying for
 * them through the caller's own session — which is the structural half of the
 * cross-tenant guarantee.
 *
 * The task's `parse()` already refuses an id that was not in its input, and
 * that is the boundary that should catch it. This is what holds if that
 * boundary ever fails: an id belonging to another org resolves to no row under
 * RLS, so it renders as nothing rather than as somebody else's company name.
 * Two independent mechanisms, because a learning finding is written to be read
 * and acted on by a person — a leak here would be laundered into a human
 * decision before anyone thought to check it.
 *
 * ── Why a finding whose citations no longer resolve is still shown ───────
 *
 * A cited opportunity can be deleted between the run and the review. Dropping
 * the finding would be tidier and wrong: the pattern it describes happened,
 * and the reviewer needs to see that one of its examples is gone rather than
 * see a shorter list with no explanation. Unresolvable ids are counted and
 * reported, not hidden.
 */

export type LearningRunStatus =
  | "requested"
  | "running"
  | "ready"
  /** Not enough has happened yet. Deliberately not `failed` — see `0010`. */
  | "insufficient"
  | "failed";

const RUN_STATUSES: readonly LearningRunStatus[] = [
  "requested",
  "running",
  "ready",
  "insufficient",
  "failed",
];
export type FindingStatus = "pending" | "approved" | "rejected";

export interface Citation {
  id: string;
  label: string;
  /** Where this points, when the reviewer can usefully follow it. */
  href: string | null;
}

export interface LearningFinding {
  id: string;
  runId: string;
  kind: FindingKind;
  headline: string;
  detail: string;
  recommendation: string;
  confidence: "low" | "medium" | "high" | null;
  supportingCount: number;
  contradictingCount: number;
  proposal: FindingProposal | null;
  status: FindingStatus;
  decidedAt: string | null;
  appliedType: "scoring_rule" | "memory" | null;
  citations: Citation[];
  /** Cited ids that no longer resolve. See the note above. */
  missingCitations: number;
}

export interface LearningRun {
  id: string;
  status: LearningRunStatus;
  trigger: "manual" | "scheduled";
  windowStart: string | null;
  windowEnd: string | null;
  outcomesConsidered: number;
  decisionsConsidered: number;
  ratingsConsidered: number;
  summary: string | null;
  error: string | null;
  createdAt: string | null;
  findings: LearningFinding[];
}

/** How many past runs the screen shows. Reviewing is about the latest. */
const MAX_RUNS = 10;

export async function listLearningRuns(orgSlug: string): Promise<Loaded<LearningRun[]>> {
  return load(
    async (db) => {
      const orgId = await requireOrgId(orgSlug, "listLearningRuns");

      const { data: runs, error } = await db
        .from("learning_runs")
        .select(
          "id, status, trigger, window_start, window_end, outcomes_considered, " +
            "decisions_considered, ratings_considered, summary, error, created_at",
        )
        .eq("org_id", orgId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(MAX_RUNS);

      if (error) throw new Error(`listLearningRuns: ${error.message}`);
      if (!runs?.length) return [];

      /* eslint-disable-next-line @typescript-eslint/no-explicit-any --
         PostgREST widens a select's result to a union with its error shape
         when it cannot prove the column list against a generated schema, and
         this repo deliberately has none. Same note as icp.ts. */
      const runIds = (runs as any[]).map((r) => String(r.id));

      const { data: findings, error: findingsError } = await db
        .from("learning_findings")
        .select(
          "id, run_id, kind, headline, detail, recommendation, confidence, " +
            "cited_opportunity_ids, cited_company_ids, cited_source_ids, " +
            "supporting_count, contradicting_count, proposal, status, decided_at, applied_type",
        )
        .eq("org_id", orgId)
        .in("run_id", runIds)
        /* Pending first, then by how much they rest on. A reviewer's attention
           is the scarce thing here, and the ordering is what decides where it
           goes — a decided finding is history and a two-record finding is a
           note, so neither should be above an undecided one drawn from thirty. */
        .order("status", { ascending: true })
        .order("supporting_count", { ascending: false });

      if (findingsError) throw new Error(`listLearningRuns: ${findingsError.message}`);

      const rows = findings ?? [];
      const labels = await resolveCitations(db, orgId, orgSlug, rows);

      /* eslint-disable @typescript-eslint/no-explicit-any -- see icp.ts */
      const byRun = new Map<string, LearningFinding[]>();
      for (const row of rows as any[]) {
        const mapped = mapFinding(row, labels);
        const list = byRun.get(mapped.runId) ?? [];
        list.push(mapped);
        byRun.set(mapped.runId, list);
      }

      return (runs as any[]).map((row) => ({
        id: String(row.id),
        status: (RUN_STATUSES.includes(row.status) ? row.status : "requested") as LearningRunStatus,
        trigger: row.trigger === "scheduled" ? ("scheduled" as const) : ("manual" as const),
        windowStart: row.window_start ?? null,
        windowEnd: row.window_end ?? null,
        outcomesConsidered: Number(row.outcomes_considered ?? 0),
        decisionsConsidered: Number(row.decisions_considered ?? 0),
        ratingsConsidered: Number(row.ratings_considered ?? 0),
        summary: row.summary ?? null,
        error: row.error ?? null,
        createdAt: row.created_at ?? null,
        findings: byRun.get(String(row.id)) ?? [],
      }));
      /* eslint-enable @typescript-eslint/no-explicit-any */
    },
    () => DEMO,
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any -- see icp.ts */

/**
 * Every cited id, resolved to a label in three queries rather than N.
 *
 * The `in` filters carry ids that came out of the database in the first place,
 * and RLS scopes each query to the caller's org — so an id from another tenant
 * simply matches nothing. That is the whole mechanism; there is no filtering
 * step to get wrong.
 */
async function resolveCitations(
  db: any,
  orgId: string,
  orgSlug: string,
  rows: any[],
): Promise<Map<string, Citation>> {
  const labels = new Map<string, Citation>();

  const collect = (key: string) =>
    [...new Set(rows.flatMap((r) => (Array.isArray(r[key]) ? r[key].map(String) : [])))];

  const opportunityIds = collect("cited_opportunity_ids");
  const companyIds = collect("cited_company_ids");
  const sourceIds = collect("cited_source_ids");

  const [opportunities, companies, sources] = await Promise.all([
    opportunityIds.length
      ? db
          .from("opportunities")
          .select("id, companies(name)")
          .eq("org_id", orgId)
          .in("id", opportunityIds)
      : Promise.resolve({ data: [] }),
    companyIds.length
      ? db.from("companies").select("id, name").eq("org_id", orgId).in("id", companyIds)
      : Promise.resolve({ data: [] }),
    sourceIds.length
      ? db.from("sources").select("id, name").eq("org_id", orgId).in("id", sourceIds)
      : Promise.resolve({ data: [] }),
  ]);

  for (const row of (opportunities.data ?? []) as any[]) {
    const company = Array.isArray(row.companies) ? row.companies[0] : row.companies;
    labels.set(String(row.id), {
      id: String(row.id),
      label: String(company?.name ?? "An opportunity"),
      href: `/${orgSlug}/opportunities/${row.id}`,
    });
  }
  for (const row of (companies.data ?? []) as any[]) {
    labels.set(String(row.id), {
      id: String(row.id),
      label: String(row.name ?? "A company"),
      // Companies has a list screen but no per-company route today, so the
      // citation renders as a label rather than a link that 404s.
      href: null,
    });
  }
  for (const row of (sources.data ?? []) as any[]) {
    labels.set(String(row.id), {
      id: String(row.id),
      label: String(row.name ?? "A source"),
      href: `/${orgSlug}/sources`,
    });
  }

  return labels;
}

function mapFinding(row: any, labels: Map<string, Citation>): LearningFinding {
  const cited = [
    ...(Array.isArray(row.cited_opportunity_ids) ? row.cited_opportunity_ids : []),
    ...(Array.isArray(row.cited_company_ids) ? row.cited_company_ids : []),
    ...(Array.isArray(row.cited_source_ids) ? row.cited_source_ids : []),
  ].map(String);

  const citations: Citation[] = [];
  let missing = 0;
  for (const id of cited) {
    const found = labels.get(id);
    if (found) citations.push(found);
    else missing++;
  }

  return {
    id: String(row.id),
    runId: String(row.run_id),
    kind: row.kind as FindingKind,
    headline: String(row.headline ?? ""),
    detail: String(row.detail ?? ""),
    recommendation: String(row.recommendation ?? ""),
    confidence: row.confidence ?? null,
    supportingCount: Number(row.supporting_count ?? 0),
    contradictingCount: Number(row.contradicting_count ?? 0),
    proposal: (row.proposal ?? null) as FindingProposal | null,
    status: (["pending", "approved", "rejected"].includes(row.status)
      ? row.status
      : "pending") as FindingStatus,
    decidedAt: row.decided_at ?? null,
    appliedType: row.applied_type ?? null,
    citations,
    missingCitations: missing,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * A demo run.
 *
 * Deliberately includes a finding with a `null` proposal and one with more
 * contradicting records than a reviewer would want, because those are the two
 * cases the screen has to render honestly and the two a fixture built to look
 * impressive would leave out.
 */
const DEMO: LearningRun[] = [
  {
    id: "demo-run-1",
    status: "ready",
    trigger: "manual",
    windowStart: null,
    windowEnd: null,
    outcomesConsidered: 34,
    decisionsConsidered: 6,
    ratingsConsidered: 11,
    summary:
      "Thirty-four outcomes over ninety days. Replies cluster hard on recent triggers; one source has produced nothing at all.",
    error: null,
    createdAt: null,
    findings: [
      {
        id: "demo-finding-1",
        runId: "demo-run-1",
        kind: "scoring_adjustment",
        headline: "Triggers older than three weeks almost never reply",
        detail:
          "Of 21 opportunities contacted within 20 days of the trigger, 9 replied. Of 13 contacted later, 1 did.",
        recommendation:
          "Weight trigger freshness harder, or shorten the gap between discovery and first contact.",
        confidence: "medium",
        supportingCount: 22,
        contradictingCount: 3,
        proposal: null,
        status: "pending",
        decidedAt: null,
        appliedType: null,
        citations: [{ id: "demo-op-1", label: "Northwind Labs", href: null }],
        missingCitations: 0,
      },
      {
        id: "demo-finding-2",
        runId: "demo-run-1",
        kind: "source_performance",
        headline: "One source has found nothing in ninety days",
        detail:
          "The regulatory filings feed has produced 0 companies since it was added. Every other source has produced at least four.",
        recommendation:
          "This looks like a configuration problem rather than a quality one — check the URL before removing it.",
        confidence: "high",
        supportingCount: 1,
        contradictingCount: 0,
        proposal: null,
        status: "pending",
        decidedAt: null,
        appliedType: null,
        citations: [{ id: "demo-source-1", label: "Regulatory filings", href: null }],
        missingCitations: 0,
      },
    ],
  },
];
