import "server-only";
import { requireOrgId } from "./org";
import { load, type Loaded } from "./source";

/**
 * Intelligence — `evidence`, `company_triggers` and `ai_decisions`.
 *
 * ── What this screen is for ──────────────────────────────────────────────
 *
 * The opportunity pages answer "why this company?" one company at a time.
 * This one answers the question across the whole account: what has Huntloop
 * actually observed, how much of it is fact rather than inference, and where
 * has a human overruled it.
 *
 * ── The fact/inference split is the headline, not a detail ───────────────
 *
 * §7 and §52 make the distinction the product's central claim, and `0002`
 * enforces it — `evidence_fact_needs_source` rejects a fact with no URL, and
 * `evidence_unknown_has_no_confidence` rejects "high confidence that we don't
 * know". A screen summarising intelligence that did not lead with the ratio
 * would be summarising the volume of claims and calling it knowledge.
 *
 * ── Overrides are the training signal ────────────────────────────────────
 *
 * `ai_decisions.human_override` is kept alongside the original output rather
 * than replacing it (plan §5), because the pair is the only labelled data the
 * learning loop gets for free. Surfacing the count is how a team notices it is
 * correcting the same judgement every week.
 */

export type ClaimKind = "fact" | "inference" | "unknown";

export interface EvidenceRow {
  id: string;
  claim: string;
  kind: ClaimKind;
  confidence: "low" | "medium" | "high" | null;
  sourceUrl: string | null;
  excerpt: string | null;
  eventDate: string | null;
  observedAt: string | null;
  subjectType: string;
}

export interface TriggerRow {
  id: string;
  company: string;
  triggerType: string;
  eventDate: string;
  strength: number | null;
}

export interface DecisionRow {
  id: string;
  decisionType: string;
  confidence: "low" | "medium" | "high" | null;
  createdAt: string | null;
  overridden: boolean;
  overriddenAt: string | null;
}

export interface Intelligence {
  evidence: EvidenceRow[];
  triggers: TriggerRow[];
  decisions: DecisionRow[];
  counts: { fact: number; inference: number; unknown: number };
}

/** Enough to see the shape of an account without paginating a settings screen. */
const LIMIT = 50;

export async function getIntelligence(orgSlug: string): Promise<Loaded<Intelligence>> {
  return load(
    async (db) => {
      const orgId = await requireOrgId(orgSlug, "getIntelligence");

      const [evidence, triggers, decisions] = await Promise.all([
        db
          .from("evidence")
          .select(
            "id, claim, kind, confidence, source_url, excerpt, event_date, observed_at, subject_type",
          )
          .eq("org_id", orgId)
          .is("deleted_at", null)
          // A superseded claim is history, not evidence — the same filter the
          // opportunity detail applies, for the same reason: showing a
          // corrected fact beside its correction reads as two findings.
          .is("superseded_by", null)
          .order("event_date", { ascending: false, nullsFirst: false })
          .limit(LIMIT),
        db
          .from("company_triggers")
          .select("id, trigger_type, event_date, strength, companies!inner(name)")
          .eq("org_id", orgId)
          .is("deleted_at", null)
          .order("event_date", { ascending: false })
          .limit(LIMIT),
        db
          .from("ai_decisions")
          .select("id, decision_type, confidence, created_at, human_override, overridden_at")
          .eq("org_id", orgId)
          .order("created_at", { ascending: false })
          .limit(LIMIT),
      ]);

      if (evidence.error) throw new Error(`getIntelligence evidence: ${evidence.error.message}`);
      if (triggers.error) throw new Error(`getIntelligence triggers: ${triggers.error.message}`);
      if (decisions.error) throw new Error(`getIntelligence decisions: ${decisions.error.message}`);

      const rows = (evidence.data ?? []).map(mapEvidence);

      return {
        evidence: rows,
        triggers: (triggers.data ?? []).map(mapTrigger),
        decisions: (decisions.data ?? []).map(mapDecision),
        counts: {
          fact: rows.filter((r) => r.kind === "fact").length,
          inference: rows.filter((r) => r.kind === "inference").length,
          unknown: rows.filter((r) => r.kind === "unknown").length,
        },
      };
    },
    () => DEMO,
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any --
   Supabase row types are generated from a live project's schema; see the same
   note in icp.ts. Confined to the mappers. */
function mapEvidence(row: any): EvidenceRow {
  return {
    id: String(row.id),
    claim: String(row.claim ?? ""),
    kind: (["fact", "inference", "unknown"] as const).includes(row.kind)
      ? row.kind
      : "inference",
    confidence: row.confidence ?? null,
    sourceUrl: row.source_url ?? null,
    excerpt: row.excerpt ?? null,
    eventDate: row.event_date ?? null,
    observedAt: row.observed_at ?? null,
    subjectType: String(row.subject_type ?? "company"),
  };
}

function mapTrigger(row: any): TriggerRow {
  const company = Array.isArray(row.companies) ? row.companies[0] : row.companies;
  return {
    id: String(row.id),
    company: String(company?.name ?? "Unknown company"),
    triggerType: String(row.trigger_type ?? ""),
    eventDate: String(row.event_date ?? ""),
    strength: typeof row.strength === "number" ? row.strength : null,
  };
}

function mapDecision(row: any): DecisionRow {
  return {
    id: String(row.id),
    decisionType: String(row.decision_type ?? ""),
    confidence: row.confidence ?? null,
    createdAt: row.created_at ?? null,
    // Presence of the override object, not a boolean column: the original
    // output is kept beside it, and that pair is the training signal.
    overridden: row.human_override !== null && row.human_override !== undefined,
    overriddenAt: row.overridden_at ?? null,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Demo intelligence.
 *
 * Deliberately mixed: a fact with a source, an inference without one, and an
 * unknown carrying no confidence. Those are the three states `0002` enforces
 * with check constraints, and a demo showing only facts would leave the
 * rendering for the other two — the part §7 is about — untested by eye.
 */
const DEMO: Intelligence = {
  evidence: [
    {
      id: "demo-evidence-1",
      claim: "Raised a $12M Series A in July 2026.",
      kind: "fact",
      confidence: "high",
      sourceUrl: "https://example.com/alphio-series-a",
      excerpt: "Alphio AI has raised $12M led by …",
      eventDate: "2026-07-14T00:00:00Z",
      observedAt: "2026-08-01T00:00:00Z",
      subjectType: "company",
    },
    {
      id: "demo-evidence-2",
      claim: "Likely building an internal policy layer rather than buying one.",
      kind: "inference",
      confidence: "medium",
      sourceUrl: null,
      excerpt: null,
      eventDate: null,
      observedAt: "2026-08-02T00:00:00Z",
      subjectType: "opportunity",
    },
    {
      id: "demo-evidence-3",
      claim: "Whether procurement sits with engineering or finance.",
      kind: "unknown",
      confidence: null,
      sourceUrl: null,
      excerpt: null,
      eventDate: null,
      observedAt: "2026-08-02T00:00:00Z",
      subjectType: "company",
    },
  ],
  triggers: [
    {
      id: "demo-trigger-1",
      company: "Alphio AI",
      triggerType: "funding_round",
      eventDate: "2026-07-14T00:00:00Z",
      strength: 82,
    },
    {
      id: "demo-trigger-2",
      company: "Northwind Logistics",
      triggerType: "hiring_platform_engineers",
      eventDate: "2026-06-30T00:00:00Z",
      strength: null,
    },
  ],
  decisions: [],
  counts: { fact: 1, inference: 1, unknown: 1 },
};
