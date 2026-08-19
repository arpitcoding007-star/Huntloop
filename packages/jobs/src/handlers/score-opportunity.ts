/**
 * `score_opportunity` — decide whether a company Huntloop found is worth
 * anybody's time, and record why.
 *
 * This is the step the scanner deliberately does not do. §78 forbids a strong
 * trigger lifting a poor-fit company, and the only way to honour that is for
 * the verdict to be made somewhere that has the ICP in front of it. The
 * scanner has a document; this has the profile.
 *
 * ── What it writes, and the order it matters in ──────────────────────────
 *
 *   opportunities        one per (company, ICP) — §60's unique key, so a
 *                        rescan updates rather than duplicating
 *   opportunity_scores   append-only. A new score is a new row, never an
 *                        update: §51's explanation is part of the score, and
 *                        overwriting it destroys the record of what the
 *                        product thought last week
 *   evidence             the claims the verdict rests on, including unknowns
 *
 * ── Why the score history is not compacted ───────────────────────────────
 *
 * Because the learning loop in `0004` compares outcomes against what was
 * predicted, and a table holding only the current opinion cannot answer "what
 * did we say before they replied?". `opportunity_scores_current_idx` orders by
 * `computed_at desc`, so reading the latest is one index scan; the cost of
 * keeping the rest is storage, and the value is the only labelled data this
 * product gets for free.
 */
import { qualifyOpportunity, type ObservedEvidence } from "@huntloop/ai";
import { AiUnavailable, runForOrg } from "../ai.ts";
import type { JobContext, JobOutcome } from "../registry.ts";

export interface ScorePayload {
  companyId: string;
  /** Optional. Defaults to the org's active ICP. */
  icpId?: string;
}

/**
 * How much prior evidence the qualifier is shown.
 *
 * Newest first, capped, because the prompt is the expensive part and the
 * fiftieth-most-recent claim about a company is not what decides a verdict.
 * §81's rule does the rest: old evidence stops counting as current, so
 * ordering by event date puts the claims that still mean something at the top.
 */
const MAX_OBSERVATIONS = 25;

export async function scoreOpportunity(ctx: JobContext): Promise<JobOutcome> {
  const { scope, payload } = ctx;
  const companyId = String(payload.companyId ?? "");
  if (!companyId) {
    return { ok: false, permanent: true, error: "score_opportunity: no companyId in payload." };
  }

  const { data: company, error: companyError } = await scope.select("companies", "id, name, canonical_domain, website")
    .eq("id", companyId)
    .is("deleted_at", null)
    .maybeSingle();

  if (companyError) return { ok: false, error: `score_opportunity: ${companyError.message}` };
  if (!company) return { ok: true, result: { skipped: "the company no longer exists" } };

  /* The ICP is what makes this a qualification rather than a description.
     Without one there is nothing to be a fit *for*, and scoring anyway would
     produce a number with no referent — which would then rank a list. */
  const icp = await loadIcp(ctx, payload.icpId ? String(payload.icpId) : null);
  if (!icp) {
    return {
      ok: true,
      result: {
        skipped:
          "this organisation has no active ICP, so there is nothing to qualify against. " +
          "Define one under Settings → ICP.",
      },
    };
  }

  const observed = await loadObservations(ctx, companyId);

  let qualification;
  try {
    const run = await runForOrg(scope, qualifyOpportunity, {
      url: String(company.website || `https://${company.canonical_domain}`),
      icp: icp.summary,
      observed,
    });
    qualification = run.output;
  } catch (e) {
    if (e instanceof AiUnavailable) {
      // Not a failure of this job — a fact about the deployment. Reported as a
      // skip so the queue does not fill with retries that cannot succeed.
      return { ok: true, result: { skipped: e.message } };
    }
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  /* §60's unique key is (org_id, company_id, icp_id) with NULLS NOT DISTINCT,
     so this is an upsert rather than an insert — a company rescanned next week
     updates its verdict instead of duplicating the row. `priority_reason` is
     NOT NULL in `0003`, which the qualifier's own parse already guarantees. */
  const { data: opportunity, error: upsertError } = await scope
    .upsert(
      "opportunities",
      {
        company_id: companyId,
        icp_id: icp.id,
        priority: qualification.priority,
        priority_reason: qualification.priorityReason,
        why_this_company: qualification.summary,
        outreach_angle: qualification.recommendation,
        confidence: qualification.scoreConfidence,
        discovered_via: "scan",
        last_scored_at: new Date().toISOString(),
      },
      { onConflict: "org_id,company_id,icp_id" },
    )
    .select("id, status")
    .maybeSingle();

  if (upsertError) {
    return { ok: false, error: `score_opportunity: ${upsertError.message}` };
  }
  if (!opportunity) {
    return { ok: false, error: "score_opportunity: the opportunity upsert returned no row." };
  }

  const opportunityId = String(opportunity.id);

  /* A dimension the model could not establish is NULL, never 0. `0003` makes
     every dimension column nullable for this reason, and §78 states it: a zero
     asserts "we measured this and it is bad", which is a finding nobody made. */
  const dimension = (label: string): number | null => {
    const found = qualification.dimensions.find((d) => d.label === label);
    return found && found.value !== "unknown" ? found.value : null;
  };

  const { error: scoreError } = await scope.insert("opportunity_scores", {
    opportunity_id: opportunityId,
    model_version: `qualify_opportunity@${new Date().toISOString().slice(0, 10)}`,
    score: qualification.score,
    icp_fit: dimension("ICP fit"),
    problem_severity: dimension("Problem severity"),
    evidence_strength: dimension("Evidence strength"),
    trigger_strength: dimension("Trigger strength"),
    trigger_freshness: dimension("Trigger freshness"),
    buying_likelihood: dimension("Buying likelihood"),
    product_relevance: dimension("Product relevance"),
    decision_maker_accessibility: dimension("Decision-maker accessibility"),
    confidence: qualification.scoreConfidence,
    explanation: qualification.explanation,
  });

  if (scoreError) return { ok: false, error: `score_opportunity: ${scoreError.message}` };

  /* Evidence, including the unknowns. §78: a verdict that lists only what
     supports it is an argument rather than an assessment, and the unknowns are
     what tell a salesperson which question to ask first. */
  const rows = qualification.evidence
    .filter((e) => e.claim.trim())
    .map((e) => ({
      subject_type: "opportunity",
      subject_id: opportunityId,
      claim: e.claim,
      kind: e.kind,
      confidence: e.confidence,
      source_url: e.sourceUrl,
      excerpt: e.excerpt,
    }));

  if (rows.length) {
    const { error: evidenceError } = await scope.insert("evidence", rows);
    if (evidenceError) {
      /* The verdict is already stored and is the valuable part. Losing the
         evidence is a real defect and is reported as one, but reporting the
         whole job as failed would retry the model call — paying twice for a
         qualification that already landed. */
      return {
        ok: true,
        result: {
          opportunity_id: opportunityId,
          priority: qualification.priority,
          score: qualification.score,
          evidence_error: evidenceError.message,
        },
      };
    }
  }

  /* Status follows the verdict, but only forward. An opportunity that has
     already been contacted or has replied must not be dragged back to
     `qualified` by a rescan — the pipeline would then lie about where the work
     is, which is the same defect the assignment action guards against. */
  if (["discovered", "researching"].includes(String(opportunity.status))) {
    await scope.update("opportunities", { status: "qualified" })
      .eq("id", opportunityId);
  }

  return {
    ok: true,
    result: {
      opportunity_id: opportunityId,
      priority: qualification.priority,
      score: qualification.score,
      evidence: rows.length,
      observations_used: observed.length,
    },
  };
}

/* ── Inputs ──────────────────────────────────────────────────────────────── */

async function loadIcp(
  ctx: JobContext,
  icpId: string | null,
): Promise<{ id: string; summary: Parameters<typeof qualifyOpportunity.renderInput>[0]["icp"] } | null> {
  const { scope } = ctx;

  let query = scope.select("icps", "id, name, criteria, negative_criteria, products(description, value_props)")
    .is("deleted_at", null);

  query = icpId ? query.eq("id", icpId) : query.eq("is_active", true);

  const { data } = await query.order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!data) return null;

  const criteria = (data.criteria ?? {}) as Record<string, unknown>;
  const negative = (data.negative_criteria ?? {}) as Record<string, unknown>;
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any --
     The embedded row's type comes from a generated schema this package does
     not have; confined to this one read. */
  const product = Array.isArray((data as any).products)
    ? (data as any).products[0]
    : (data as any).products;

  return {
    id: String(data.id),
    summary: {
      sells: String(product?.description ?? "").trim() || String(data.name ?? ""),
      segments: strings(criteria.segments),
      sizes: strings(criteria.sizes),
      regions: strings(criteria.regions),
      triggers: strings(criteria.triggers),
      exclusions: strings(negative.exclusions ?? negative.segments),
    },
  };
}

/**
 * What Huntloop has already observed about this company.
 *
 * Ordered by `event_date`, newest first, with rows that have no event date
 * last — an undated claim is not necessarily old, but it cannot be shown to be
 * recent either, and §81 only lets recency count when it is established.
 *
 * Superseded and deleted rows are excluded, which is the whole point of
 * `evidence.superseded_by` existing: a corrected claim must not be re-argued
 * from alongside its correction.
 */
async function loadObservations(ctx: JobContext, companyId: string): Promise<ObservedEvidence[]> {
  const { data } = await ctx.scope.select("evidence", "claim, kind, confidence, source_url, excerpt, event_date")
    .eq("subject_type", "company")
    .eq("subject_id", companyId)
    .is("deleted_at", null)
    .is("superseded_by", null)
    .order("event_date", { ascending: false, nullsFirst: false })
    .limit(MAX_OBSERVATIONS);

  return (data ?? []).map((row: Record<string, unknown>) => ({
    claim: String(row.claim),
    kind: row.kind as ObservedEvidence["kind"],
    confidence: (row.confidence ?? null) as ObservedEvidence["confidence"],
    sourceUrl: row.source_url ?? null,
    excerpt: row.excerpt ?? null,
    eventDate: row.event_date ?? null,
  }));
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v).trim()).filter(Boolean);
}
