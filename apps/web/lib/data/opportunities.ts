import type { Priority, ScoreDimension } from "@huntloop/ui";
import { OPPORTUNITIES, findOpportunity } from "../fixtures/opportunities";
import { load, type Loaded } from "./source";

/**
 * Opportunity loaders.
 *
 * The `live` branches are written against the real table and column names from
 * packages/db/migrations — they are the query this screen will run, not a
 * placeholder. They are unexercised until Supabase is connected, which is
 * stated plainly rather than implied by silence.
 *
 * Note the ordering in `listOpportunities`: priority first, then recency. Not
 * score. §78 requires that a strong trigger cannot lift a poor-fit company, so
 * the verdict orders the list and the score is detail within it — and that is
 * also the index the migration creates (`opportunities_priority_idx`), so the
 * UI default and the query plan agree instead of quietly fighting.
 */

export interface OpportunityRow {
  id: string;
  company: string;
  domain: string;
  priority: Priority;
  priorityReason: string;
  score: number;
  scoreExplanation: string;
  confidence: "high" | "medium" | "low";
  dimensions: ScoreDimension[];
  status: string;
  trigger: string;
  triggerDate: string;
  evidence: { kind: "fact" | "inference" | "unknown" }[];
  industry: string;
}

/** Postgres sorts enums by declaration order; this makes HOT sort first. */
const PRIORITY_ORDER: Priority[] = ["hot", "warm", "watch", "ignore"];

export async function listOpportunities(
  orgId: string,
): Promise<Loaded<OpportunityRow[]>> {
  return load(
    async (db) => {
      const { data, error } = await db
        .from("opportunities")
        .select(
          `id, priority, priority_reason, status, first_seen_at,
           companies!inner(name, canonical_domain, industry),
           opportunity_scores(score, explanation, confidence, computed_at,
             icp_fit, problem_severity, evidence_strength, trigger_strength,
             trigger_freshness, buying_likelihood, product_relevance,
             decision_maker_accessibility)`,
        )
        .eq("org_id", orgId)
        .is("deleted_at", null)
        .order("priority", { ascending: true })
        .order("first_seen_at", { ascending: false });

      if (error) throw new Error(`listOpportunities: ${error.message}`);
      return (data ?? []).map(mapRow).sort(byPriorityThenScore);
    },
    () =>
      [...OPPORTUNITIES]
        .map(toRow)
        .sort(byPriorityThenScore),
  );
}

export async function getOpportunity(
  orgId: string,
  id: string,
): Promise<Loaded<ReturnType<typeof findOpportunity>>> {
  return load(
    async (db) => {
      const { data, error } = await db
        .from("opportunities")
        .select("*, companies!inner(*)")
        .eq("org_id", orgId)
        .eq("id", id)
        .is("deleted_at", null)
        .maybeSingle();
      if (error) throw new Error(`getOpportunity: ${error.message}`);
      // Deliberately not implemented past the fetch: assembling the full §47
      // page needs evidence, triggers and buyers joined in, and writing that
      // blind — with no database to run it against — would produce a query
      // that reads as finished and has never returned a row.
      if (!data) return undefined;
      throw new Error(
        "getOpportunity: live mapping is not implemented yet. Connect Supabase " +
          "and finish this against real rows rather than trusting an unrun query.",
      );
    },
    () => findOpportunity(id),
  );
}

function byPriorityThenScore(a: OpportunityRow, b: OpportunityRow): number {
  const p = PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority);
  return p !== 0 ? p : b.score - a.score;
}

/** Fixture → row. Kept explicit so a drift in either shape is a type error. */
function toRow(o: (typeof OPPORTUNITIES)[number]): OpportunityRow {
  return {
    id: o.id,
    company: o.company,
    domain: o.domain,
    priority: o.priority,
    priorityReason: o.priorityReason,
    score: o.score,
    scoreExplanation: o.scoreExplanation,
    confidence: o.confidence,
    dimensions: o.dimensions,
    status: o.status,
    trigger: o.trigger,
    triggerDate: o.triggerDate,
    evidence: o.evidence.map((e) => ({ kind: e.kind })),
    industry: o.industry,
  };
}

/* eslint-disable @typescript-eslint/no-explicit-any --
   The Supabase response type for a nested select is generated from the
   project's schema, which requires a live project. Until the generated types
   exist this mapping is unavoidably untyped; it is isolated to this one
   function so the rest of the file stays checked. */
function mapRow(r: any): OpportunityRow {
  const score = (r.opportunity_scores ?? [])
    .slice()
    .sort(
      (a: any, b: any) =>
        Date.parse(b.computed_at) - Date.parse(a.computed_at),
    )[0];

  return {
    id: r.id,
    company: r.companies.name,
    domain: r.companies.canonical_domain,
    industry: r.companies.industry ?? "—",
    priority: r.priority,
    priorityReason: r.priority_reason,
    score: score?.score ?? 0,
    scoreExplanation: score?.explanation ?? "Not scored yet.",
    confidence: score?.confidence ?? "low",
    // NULL stays "unknown" — never coerced to 0. §78: a zero would assert
    // "we measured this and it is bad", a finding Huntloop never made.
    dimensions: [
      { label: "ICP fit", value: score?.icp_fit ?? "unknown" },
      { label: "Problem severity", value: score?.problem_severity ?? "unknown" },
      { label: "Evidence strength", value: score?.evidence_strength ?? "unknown" },
      { label: "Trigger strength", value: score?.trigger_strength ?? "unknown" },
      { label: "Trigger freshness", value: score?.trigger_freshness ?? "unknown" },
      { label: "Buying likelihood", value: score?.buying_likelihood ?? "unknown" },
      { label: "Product relevance", value: score?.product_relevance ?? "unknown" },
      {
        label: "Decision-maker accessibility",
        value: score?.decision_maker_accessibility ?? "unknown",
      },
    ],
    status: r.status,
    trigger: "—",
    triggerDate: r.first_seen_at,
    evidence: [],
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
