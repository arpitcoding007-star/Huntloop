/**
 * `analyze_performance` — gather what happened, ask the model what it means,
 * and store the answer as findings a person decides on one at a time.
 *
 * ── Where the work actually is ───────────────────────────────────────────
 *
 * Not in the model call. It is in assembling an input that can support a real
 * conclusion: outcomes joined to the opportunity they happened to, the
 * qualifier's own score from before any customer rule touched it, the source
 * each company came from, and every place a person corrected or rated the
 * product. Half of that is a join the schema was designed for and never had a
 * reader.
 *
 * ── The run row is written before the call ───────────────────────────────
 *
 * Same invariant as `ai_runs`, for a different reason. `ai_runs` is written
 * first so a crashed call still appears on the bill; `learning_runs` is written
 * first so a crashed call still appears on the *screen*. A synthesis that
 * silently produced nothing and a synthesis that was never triggered look
 * identical to a user, and the first one is a bug they should be able to see.
 *
 * ── Why it can refuse ────────────────────────────────────────────────────
 *
 * Below `MIN_LEARNING_SIGNALS` it stops before spending anything, and says
 * how many records it has and how many it needs. That refusal is the single
 * best-designed thing in the reference system this capability comes from: it
 * failed with an actionable instruction rather than a generic error, and it
 * failed *before* the model call rather than after paying for a set of
 * confident findings drawn from four replies.
 */
import {
  MIN_LEARNING_SIGNALS,
  analyzePerformance as analyzePerformanceTask,
  countSignals,
  type AnalyzeInput,
  type DecisionRecord,
  type OutcomeRecord,
  type SourcePerformance,
} from "@huntloop/ai";
import { embedded } from "../scope.ts";
import { AiUnavailable, runForOrg } from "../ai.ts";
import type { JobContext, JobOutcome } from "../registry.ts";

export interface AnalyzePayload {
  /** How far back to look. Defaults to 90 days. */
  windowDays?: number;
  /** Set by the scheduled sweep. Absent means a person pressed the button. */
  scheduled?: boolean;
  /**
   * An existing `learning_runs` row to adopt.
   *
   * Present when a person asked: the request path wrote the row in state
   * `requested` (it may not write to `job_executions` — see `schedule_learning`),
   * and this job takes it over rather than creating a second one. That is what
   * lets the button show "running" the moment it is pressed instead of showing
   * nothing until a worker gets to it.
   */
  runId?: string;
}

/**
 * The default window.
 *
 * Ninety days rather than thirty, because outreach outcomes are slow: a
 * meeting booked in week one becomes a win in week nine, and a thirty-day
 * window sees the meeting and never the result. Long enough to contain a
 * sales cycle, short enough that a conclusion is still about how the product
 * behaves now.
 */
const DEFAULT_WINDOW_DAYS = 90;

/** Caps on what one prompt carries. Newest first in every case. */
const MAX_OUTCOMES = 300;
const MAX_DECISIONS = 200;

export async function analyzePerformanceJob(ctx: JobContext): Promise<JobOutcome> {
  const { scope, payload } = ctx;

  const windowDays = clampWindow(payload.windowDays);
  const windowEnd = ctx.now;
  const windowStart = new Date(windowEnd.getTime() - windowDays * 24 * 60 * 60 * 1000);

  const [outcomes, decisions, sources, existingRules, existingGuidance] = await Promise.all([
    loadOutcomes(ctx, windowStart, windowEnd),
    loadDecisions(ctx, windowStart, windowEnd),
    loadSourcePerformance(ctx),
    loadExistingRules(ctx),
    loadGuidance(ctx),
  ]);

  const signals = countSignals({ outcomes, decisions });
  const counts = {
    outcomes_considered: outcomes.length,
    decisions_considered: decisions.filter((d) => d.overridden).length,
    ratings_considered: decisions.filter((d) => d.rating !== null).length,
  };

  const requestedRunId = payload.runId ? String(payload.runId) : null;

  if (signals < MIN_LEARNING_SIGNALS) {
    const reason =
      `There are ${signals} recorded outcomes and human decisions in the last ` +
      `${windowDays} days, and at least ${MIN_LEARNING_SIGNALS} are needed before ` +
      `a pattern means anything. Record outcomes on opportunities as they close, ` +
      `and rate the qualifications you disagree with.`;

    /* No spend, either way. A person who asked gets their row closed with the
       reason on it; a scheduled sweep leaves no row at all, because a weekly
       job quietly noting "still nothing" is history nobody wants.

       `insufficient` rather than `failed`: the customer has done nothing
       wrong, and a red state for "you have not sold anything yet" is a support
       ticket rather than information. */
    if (requestedRunId) {
      await scope.update("learning_runs", { status: "insufficient", error: reason, ...counts })
        .eq("id", requestedRunId);
    }

    return {
      ok: true,
      result: { skipped: reason, signals, needed: MIN_LEARNING_SIGNALS, run_id: requestedRunId },
    };
  }

  let runId: string;

  if (requestedRunId) {
    /* Adopting the row somebody's click created. The status move to `running`
       is what takes it out of `schedule_learning`'s requested query, so a
       second tick cannot enqueue the same analysis again. */
    const { data: adopted, error: adoptError } = await scope
      .update("learning_runs", { status: "running", ...counts })
      .eq("id", requestedRunId)
      .eq("status", "requested")
      .select("id")
      .maybeSingle();

    if (adoptError) return { ok: false, error: `analyze_performance: ${adoptError.message}` };
    if (!adopted) {
      /* Somebody else took it, or it was cancelled. Not an error: at-least-once
         delivery means this job can legitimately run twice, and the `.eq` on
         status is what makes the second one a no-op rather than a second Opus
         call against the same window. */
      return { ok: true, result: { skipped: "this analysis has already been started." } };
    }
    runId = requestedRunId;
  } else {
    const { data: run, error: runError } = await scope
      .insert("learning_runs", {
        status: "running",
        trigger: "scheduled",
        window_start: windowStart.toISOString(),
        window_end: windowEnd.toISOString(),
        ...counts,
      })
      .select("id")
      .maybeSingle();

    if (runError) {
      /* 23505 is `learning_runs_one_open_per_org`: a manual run is already
         outstanding for this org. The sweep stands down rather than competing
         with the person who asked. */
      if (runError.code === "23505") {
        return { ok: true, result: { skipped: "an analysis is already running for this org." } };
      }
      return { ok: false, error: `analyze_performance: ${runError.message}` };
    }
    if (!run) return { ok: false, error: "analyze_performance: the run row returned nothing." };
    runId = String(run.id);
  }

  const input: AnalyzeInput = {
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    outcomes,
    decisions,
    sources,
    existingRules,
    existingGuidance,
  };

  let analysis;
  try {
    const result = await runForOrg(scope, analyzePerformanceTask, input);
    analysis = result.output;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);

    /* The run row is updated either way, which is the whole reason it exists.
       An `AiUnavailable` is not this job's failure — it is a fact about the
       deployment — so the job reports ok and the run says why, rather than
       filling the queue with retries that cannot succeed. */
    await scope.update("learning_runs", { status: "failed", error: message })
      .eq("id", runId);

    if (e instanceof AiUnavailable) {
      return { ok: true, result: { run_id: runId, skipped: message } };
    }
    return { ok: false, error: `analyze_performance: ${message}` };
  }

  /* Findings first, then the run's status. The order matters on a crash
     between the two: a `ready` run with no findings reads as "we looked and
     found nothing", which would be a lie. A `running` run with findings
     already stored reads as unfinished, which is true, and the next run
     supersedes it. */
  if (analysis.findings.length) {
    const rows = analysis.findings.map((finding) => ({
      run_id: runId,
      kind: finding.kind,
      headline: finding.headline,
      detail: finding.detail,
      recommendation: finding.recommendation,
      confidence: finding.confidence,
      cited_opportunity_ids: finding.citedOpportunityIds,
      cited_company_ids: finding.citedCompanyIds,
      cited_source_ids: finding.citedSourceIds,
      supporting_count: finding.supportingCount,
      contradicting_count: finding.contradictingCount,
      proposal: finding.proposal,
      status: "pending",
    }));

    const { error: findingsError } = await scope.insert("learning_findings", rows);
    if (findingsError) {
      await scope.update("learning_runs", {
          status: "failed",
          error: `findings could not be stored: ${findingsError.message}`,
          summary: analysis.summary,
        })
        .eq("id", runId);
      return { ok: false, error: `analyze_performance: ${findingsError.message}` };
    }
  }

  await scope.update("learning_runs", { status: "ready", summary: analysis.summary })
    .eq("id", runId);

  /* An `events` row, because this is exactly the kind of moment `0004` added
     that table for and nothing has ever written to it. Cheap, and it is what a
     future activity feed reads. */
  await scope.insert("events", {
    name: "learning_run_completed",
    /* No `user_id`. The person who asked is on the run row as `triggered_by`;
       putting them here too would attribute the *completion* to them, and a
       scheduled run has nobody to attribute it to at all — the same reason
       `write_audit_log_internal` leaves `actor_id` null rather than
       substituting the owner. */
    properties: {
      run_id: runId,
      findings: analysis.findings.length,
      outcomes: outcomes.length,
      window_days: windowDays,
    },
  });

  return {
    ok: true,
    result: {
      run_id: runId,
      findings: analysis.findings.length,
      outcomes_considered: outcomes.length,
      signals,
    },
  };
}

/* ── Inputs ──────────────────────────────────────────────────────────────── */

function clampWindow(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_WINDOW_DAYS;
  // Floor of 7: a window shorter than a week cannot contain a sales cycle and
  // would produce findings about which day of the week it is.
  return Math.max(7, Math.min(365, Math.round(n)));
}

/**
 * Outcomes, joined to everything needed to say something about them.
 *
 * `model_score` comes from the most recent `opportunity_scores` row rather
 * than from `score`, and that distinction is the point of `0010` adding the
 * column: a customer's own rule adjusting a verdict downward tells you nothing
 * about whether the qualifier was right, and folding the two together would
 * make every finding about the model actually a finding about the rules.
 */
async function loadOutcomes(
  ctx: JobContext,
  start: Date,
  end: Date,
): Promise<OutcomeRecord[]> {
  const { data, error } = await ctx.scope.select(
    "outcomes",
    "id, kind, occurred_at, opportunity_id, " +
      "opportunities!inner(id, priority, first_seen_at, company_id, " +
      "companies!inner(id, name, industry, employee_count))",
  )
    .gte("occurred_at", start.toISOString())
    .lte("occurred_at", end.toISOString())
    .not("opportunity_id", "is", null)
    .order("occurred_at", { ascending: false })
    .limit(MAX_OUTCOMES);

  if (error || !data?.length) return [];

  const rows = data as Record<string, unknown>[];
  const opportunityIds = [
    ...new Set(
      rows
        .map((row) => String(embedded<Record<string, unknown>>(row.opportunities)?.id ?? ""))
        .filter(Boolean),
    ),
  ];

  const [scores, provenance] = await Promise.all([
    loadModelScores(ctx, opportunityIds),
    loadProvenance(ctx, opportunityIds),
  ]);

  const out: OutcomeRecord[] = [];
  for (const row of rows) {
    const opportunity = embedded<Record<string, unknown>>(row.opportunities);
    if (!opportunity) continue;
    const company = embedded<Record<string, unknown>>(opportunity.companies);
    if (!company) continue;

    const opportunityId = String(opportunity.id);
    const source = provenance.get(opportunityId) ?? { id: null, name: null };
    const firstSeen = opportunity.first_seen_at ? new Date(String(opportunity.first_seen_at)) : null;

    out.push({
      opportunityId,
      companyId: String(company.id),
      companyName: String(company.name ?? ""),
      sourceId: source.id,
      sourceName: source.name,
      kind: String(row.kind) as OutcomeRecord["kind"],
      occurredAt: String(row.occurred_at),
      priority: opportunity.priority ? String(opportunity.priority) : null,
      modelScore: scores.get(opportunityId) ?? null,
      /* How stale the trigger was when Huntloop first surfaced this, which is
         the one derived number worth computing here: §81 makes freshness
         load-bearing, and "did acting faster help" is the question a customer
         most wants an answer to and cannot get from any single column. */
      triggerAgeDays: firstSeen ? daysBetween(firstSeen, new Date(String(row.occurred_at))) : null,
      industry: company.industry ? String(company.industry) : null,
      employeeCount:
        company.employee_count === null || company.employee_count === undefined
          ? null
          : Number(company.employee_count),
    });
  }

  return out;
}

/** The qualifier's own number, most recent per opportunity. */
async function loadModelScores(
  ctx: JobContext,
  opportunityIds: string[],
): Promise<Map<string, number>> {
  const scores = new Map<string, number>();
  if (!opportunityIds.length) return scores;

  const { data } = await ctx.scope.select(
    "opportunity_scores",
    "opportunity_id, score, model_score, computed_at",
  )
    .in("opportunity_id", opportunityIds)
    .order("computed_at", { ascending: false });

  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const id = String(row.opportunity_id);
    // Ordered newest first, so the first row per opportunity wins.
    if (scores.has(id)) continue;
    /* `model_score` is null on every row written before `0010`. Falling back to
       `score` is right for those: no rules existed then, so the two were equal
       by construction. */
    const value = row.model_score ?? row.score;
    if (value !== null && value !== undefined) scores.set(id, Number(value));
  }

  return scores;
}

/**
 * Which source each opportunity's company came from.
 *
 * There is no `opportunities.source_id` — provenance lives on `source_events`,
 * one row per (source, company) sighting, because a company can legitimately
 * be found by three sources. The first sighting is the one that mattered: it
 * is the source that put the company in front of anybody, and the later ones
 * are corroboration.
 */
async function loadProvenance(
  ctx: JobContext,
  opportunityIds: string[],
): Promise<Map<string, { id: string | null; name: string | null }>> {
  const byOpportunity = new Map<string, { id: string | null; name: string | null }>();
  if (!opportunityIds.length) return byOpportunity;

  const { data: opportunities } = await ctx.scope.select("opportunities", "id, company_id")
    .in("id", opportunityIds);

  const companyToOpportunities = new Map<string, string[]>();
  for (const row of (opportunities ?? []) as Record<string, unknown>[]) {
    const companyId = String(row.company_id);
    const list = companyToOpportunities.get(companyId) ?? [];
    list.push(String(row.id));
    companyToOpportunities.set(companyId, list);
  }

  const companyIds = [...companyToOpportunities.keys()];
  if (!companyIds.length) return byOpportunity;

  const { data: events } = await ctx.scope.select(
    "source_events",
    "company_id, source_id, event_date, created_at, sources(id, name)",
  )
    .in("company_id", companyIds)
    .order("created_at", { ascending: true });

  const seen = new Set<string>();
  for (const row of (events ?? []) as Record<string, unknown>[]) {
    const companyId = String(row.company_id);
    if (seen.has(companyId)) continue;
    seen.add(companyId);

    const source = embedded<Record<string, unknown>>(row.sources);
    const value = {
      id: row.source_id ? String(row.source_id) : null,
      name: source?.name ? String(source.name) : null,
    };
    for (const opportunityId of companyToOpportunities.get(companyId) ?? []) {
      byOpportunity.set(opportunityId, value);
    }
  }

  return byOpportunity;
}

/**
 * Where a person disagreed with the product, or said what they thought of it.
 *
 * Both are loaded because they answer different questions and the synthesis
 * needs both: an override says the model was wrong about one company, and a
 * corpus of ratings says which *kind* of company it tends to be wrong about.
 * Rows that are neither overridden nor rated are excluded — an AI decision
 * nobody has touched carries no human judgement, and including it would let
 * volume look like agreement.
 */
async function loadDecisions(
  ctx: JobContext,
  start: Date,
  end: Date,
): Promise<DecisionRecord[]> {
  const { data, error } = await ctx.scope.select(
    "ai_decisions",
    "decision_type, entity_type, entity_id, human_override, quality_rating, " +
      "quality_note, overridden_at, rated_at, created_at",
  )
    .gte("created_at", start.toISOString())
    .lte("created_at", end.toISOString())
    .or("human_override.not.is.null,quality_rating.not.is.null")
    .order("created_at", { ascending: false })
    .limit(MAX_DECISIONS);

  if (error) return [];

  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    decisionType: String(row.decision_type ?? "unknown"),
    opportunityId: row.entity_type === "opportunity" && row.entity_id ? String(row.entity_id) : null,
    companyId: row.entity_type === "company" && row.entity_id ? String(row.entity_id) : null,
    overridden: row.human_override !== null && row.human_override !== undefined,
    rating: (row.quality_rating ?? null) as DecisionRecord["rating"],
    note: row.quality_note ? String(row.quality_note) : null,
    occurredAt: String(row.overridden_at ?? row.rated_at ?? row.created_at),
  }));
}

/**
 * Every source and what it has produced, including the ones that have produced
 * nothing.
 *
 * The zeroes are the point. A source that found forty companies of which none
 * converted is a quality signal; a source that found nothing at all is a
 * configuration problem, and the two demand opposite responses. A query that
 * only returned sources with outcomes would make the second invisible — which
 * is the more common and more fixable failure.
 */
async function loadSourcePerformance(ctx: JobContext): Promise<SourcePerformance[]> {
  const { data: sources } = await ctx.scope.select("sources", "id, name, kind")
    .is("deleted_at", null)
    .limit(100);

  const rows = (sources ?? []) as Record<string, unknown>[];
  if (!rows.length) return [];

  const performance: SourcePerformance[] = [];

  for (const source of rows) {
    const sourceId = String(source.id);

    const { data: events } = await ctx.scope.select("source_events", "company_id")
      .eq("source_id", sourceId)
      .not("company_id", "is", null)
      .limit(1000);

    const companyIds = [
      ...new Set(((events ?? []) as Record<string, unknown>[]).map((e) => String(e.company_id))),
    ];

    let opportunitiesCreated = 0;
    let outcomes = 0;
    let wins = 0;

    if (companyIds.length) {
      const { data: opportunities } = await ctx.scope.select("opportunities", "id")
        .in("company_id", companyIds)
        .is("deleted_at", null);

      const opportunityIds = ((opportunities ?? []) as Record<string, unknown>[]).map((o) =>
        String(o.id),
      );
      opportunitiesCreated = opportunityIds.length;

      if (opportunityIds.length) {
        const { data: outcomeRows } = await ctx.scope.select("outcomes", "kind")
          .in("opportunity_id", opportunityIds);
        const list = (outcomeRows ?? []) as Record<string, unknown>[];
        outcomes = list.length;
        wins = list.filter((o) => o.kind === "won").length;
      }
    }

    performance.push({
      sourceId,
      name: String(source.name ?? ""),
      kind: String(source.kind ?? "custom"),
      companiesFound: companyIds.length,
      opportunitiesCreated,
      outcomes,
      wins,
    });
  }

  return performance;
}

/** The policy already in force, so a finding does not propose it again. */
async function loadExistingRules(
  ctx: JobContext,
): Promise<{ name: string; description: string }[]> {
  const { data } = await ctx.scope.select("scoring_rules", "name, rationale, effect, weight, floor_priority")
    .eq("is_active", true)
    .is("deleted_at", null)
    .limit(50);

  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    name: String(row.name ?? ""),
    description: String(row.rationale ?? describeEffect(row)),
  }));
}

function describeEffect(row: Record<string, unknown>): string {
  if (row.effect === "veto") return "excludes matching companies";
  if (row.effect === "floor") return `floors matching companies at ${row.floor_priority}`;
  return `adjusts the score by ${row.weight}`;
}

/** House style already on file. Same shape `advance_enrollments` reads. */
async function loadGuidance(ctx: JobContext): Promise<string[]> {
  const { data } = await ctx.scope.select("memories", "content")
    .eq("scope", "organization")
    .eq("kind", "durable")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(20);

  return ((data ?? []) as Record<string, unknown>[])
    .map((row) => String(row.content ?? "").trim())
    .filter(Boolean);
}

function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)));
}
