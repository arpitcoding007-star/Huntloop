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
 *
 * ── The customer's own rules, applied after the model's ──────────────────
 *
 * `scoring_rules` existed from `0003` with nothing anywhere that read it. That
 * is a worse state than not having the table, because a column that stores
 * policy and a screen that lists it both assert a capability the product does
 * not have — which is the §7 failure aimed at ourselves. `0010` gave rules an
 * effect and `@huntloop/db/rules` gave them an evaluator; this is where they
 * run.
 *
 * They run *after* the qualifier and are recorded separately from it:
 * `model_score` keeps what the model said, `score` is what the org's policy
 * made of it, and `rule_trace` names every rule that fired. Folding the two
 * together would be cheaper and would destroy the only thing the learning loop
 * can actually ask — whether the *model* was right — because a customer's rule
 * being wrong is not evidence about the model.
 */
import { qualifyOpportunity, type ObservedEvidence } from "@huntloop/ai";
import {
  applyRules,
  validateExpression,
  type RuleFacts,
  type RulePriority,
  type ScoringRule,
} from "@huntloop/db/rules";
import { embedded } from "../scope.ts";
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

  /* The extra columns are the facts `scoring_rules` may ask about. Selected
     unconditionally rather than only when rules exist: a second query keyed on
     "does this org have rules" would make the common path two round trips to
     save a few columns on the rare one. */
  const { data: company, error: companyError } = await scope.select(
    "companies",
    "id, name, canonical_domain, website, industry, country, region, " +
      "business_model, description, employee_count, tech_stack",
  )
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

  /* The org's own policy, applied to the model's verdict. `applyRules` is a
     pure function over facts already in hand — no I/O, no second model call —
     so a saturated rule set costs nothing measurable here. */
  const rules = await loadRules(ctx, icp.id);
  const ruled = applyRules(
    rules,
    ruleFacts(company, observed, await loadEventTypes(ctx, companyId), qualification),
    { score: qualification.score, priority: qualification.priority as RulePriority },
  );

  /* A veto is a customer policy statement, and the reason has to say so. The
     qualifier's own reason is kept after it: "excluded by <rule>" alone would
     leave a reader unable to tell whether the model agreed, which is exactly
     the question somebody looking at an ignored opportunity is asking. */
  const priorityReason = ruled.vetoedBy
    ? `Excluded by your rule “${ruled.vetoedBy}”. Huntloop's own read: ` +
      qualification.priorityReason
    : qualification.priorityReason;

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
        priority: ruled.priority,
        priority_reason: priorityReason,
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
    score: ruled.score,
    /* Kept separately and deliberately. Everything sorts and renders by
       `score`; the learning loop reads `model_score`, because a rule the
       customer wrote being wrong says nothing about the qualifier. */
    model_score: ruled.modelScore,
    rule_trace: ruled.trace,
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
      priority: ruled.priority,
      score: ruled.score,
      model_score: ruled.modelScore,
      rules_fired: ruled.trace.length,
      vetoed_by: ruled.vetoedBy,
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
  const product = embedded(data.products);

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

/**
 * The org's active rules, for this ICP and org-wide.
 *
 * `icp_id` null means "applies to every profile". Both are loaded and applied
 * together: an exclusion like "never under ten people" is a fact about the
 * business, not about one ICP, and forcing a customer to restate it per
 * profile is how it ends up stated in three places and updated in one.
 *
 * A row whose expression no longer parses is dropped here with the reason
 * logged, rather than failing the scan. The scan is the expensive part and has
 * already happened; one malformed rule row must not become an outage. Dropping
 * it is visible in the trace by its absence, and it cannot fire silently —
 * which is the failure that would matter.
 */
async function loadRules(ctx: JobContext, icpId: string): Promise<ScoringRule[]> {
  const { data, error } = await ctx.scope.select(
    "scoring_rules",
    "id, name, expression, effect, weight, floor_priority, intent, rationale, basis, origin, is_active, icp_id",
  )
    .eq("is_active", true)
    .is("deleted_at", null)
    .or(`icp_id.is.null,icp_id.eq.${icpId}`);

  if (error) {
    console.error(`score_opportunity: rules could not be read (${error.message}); scoring unruled.`);
    return [];
  }

  const rules: ScoringRule[] = [];
  for (const row of data ?? []) {
    try {
      rules.push({
        id: String(row.id),
        name: String(row.name ?? ""),
        expression: validateExpression(row.expression),
        effect: row.effect,
        weight: row.weight === null || row.weight === undefined ? null : Number(row.weight),
        floorPriority: (row.floor_priority ?? null) as RulePriority | null,
        intent: row.intent ?? null,
        rationale: row.rationale ?? null,
        basis: row.basis ?? null,
        origin: row.origin ?? "user",
        isActive: true,
      });
    } catch (e) {
      console.error(
        `score_opportunity: rule ${row.id} was skipped — ` +
          `${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  return rules;
}

/**
 * The normalized event types seen for this company.
 *
 * `source_events` is where §33's normalized events land, and "has this company
 * had a funding event" is one of the few things a deterministic rule can ask
 * that a model cannot answer more cheaply. Capped, because a rule asking
 * whether a type is present does not get a better answer from four hundred
 * rows than from the most recent hundred.
 */
async function loadEventTypes(ctx: JobContext, companyId: string): Promise<string[]> {
  const { data } = await ctx.scope.select("source_events", "event_type")
    .eq("company_id", companyId)
    .order("event_date", { ascending: false, nullsFirst: false })
    .limit(100);

  const rows = (data ?? []) as Record<string, unknown>[];
  return [...new Set(rows.map((row) => String(row.event_type)))];
}

/**
 * Everything a rule may ask about, in one flat object.
 *
 * Built here rather than passed around as the raw rows, so that the closed
 * field list in `@huntloop/db/rules` has exactly one place that satisfies it.
 * A field named there and not supplied here is a rule that never fires — which
 * looks configured and does nothing, the failure the closed list exists to
 * prevent.
 *
 * Exported for exactly one reason: `verify-jobs.ts` asserts that every member
 * of `RULE_FIELDS` is a key this produces. That check cannot be written against
 * the handler, because reaching it needs a model call — and it is the check
 * that matters most, since the failure it catches is invisible. A rule on a
 * field nobody supplies does not error; it quietly matches nothing forever,
 * and the customer who wrote it believes it is running.
 */
export function ruleFacts(
  company: Record<string, unknown>,
  observed: ObservedEvidence[],
  eventTypes: string[],
  qualification: { score: number; priority: string },
): RuleFacts {
  return {
    "company.name": str(company.name),
    "company.domain": str(company.canonical_domain),
    "company.industry": str(company.industry),
    "company.country": str(company.country),
    "company.region": str(company.region),
    "company.business_model": str(company.business_model),
    "company.description": str(company.description),
    "company.employee_count":
      company.employee_count === null || company.employee_count === undefined
        ? null
        : Number(company.employee_count),
    "company.tech_stack": strings(company.tech_stack),
    "evidence.claims": observed.map((e) => e.claim),
    "evidence.kinds": [...new Set(observed.map((e) => String(e.kind)))],
    "signals.event_types": eventTypes,
    "score.model_score": qualification.score,
    "score.priority": qualification.priority,
  };
}

function str(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s || null;
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v).trim()).filter(Boolean);
}
