"use server";

import { qualify } from "../../../../lib/ai/qualify";
import type { QualifyResult } from "../../../../lib/ai/qualify";
import { whyNow } from "../../../../lib/ai/why-now";
import type { WhyNowRequest, WhyNowResult } from "../../../../lib/ai/why-now";
import { toFailureState } from "../../../../lib/ai/outcome";
import { revalidatePath } from "next/cache";
import type { Qualification } from "@huntloop/ai";
import { fail, mutate, ok, type ActionResult } from "../../../../lib/data/org";
import {
  orgSlugSchema,
  parseInput,
  qualificationSchema,
  urlInputSchema,
  whyNowRequestSchema,
} from "../../../../lib/validation";

/**
 * The analyze screen's writes.
 *
 * Only the org and the URL cross from the client on the way in. The ICP is
 * loaded here, from the database, under the caller's own session — unlike
 * onboarding, where the profile genuinely only exists in the browser. A
 * client-supplied ICP would mean the answer to "is this a good lead?" depended
 * on something the page could rewrite, which is not a property this particular
 * screen should have.
 *
 * The verdict does cross back from the client on the way out, when it is
 * saved. That is a deliberate trade rather than an oversight, and the argument
 * for it sits beside `qualificationSchema` in lib/validation.ts: re-running the
 * model would mean the row saved is not the verdict the user read and approved.
 *
 * Qualification fetches several pages and reasons over them, so this takes tens
 * of seconds. It is awaited inline — acceptable for a user-initiated one-off,
 * and the reason a scan cycle goes through the job runner instead.
 */

export interface AnalyzeState {
  result?: QualifyResult;
  error?: string;
  /** Present when `error` is a rate-limit refusal. See lib/ai/outcome.ts. */
  rateLimited?: { retryAt: string | null };
}

export async function analyzeUrlAction(
  org: string,
  url: string,
): Promise<AnalyzeState> {
  /* Validated before anything else runs. These parameters are typed but not
     checked — this is a public POST endpoint and the types are gone by the
     time it executes. See lib/validation.ts. */
  const slug = parseInput(orgSlugSchema, org, "organisation");
  if (!slug.ok) return { error: slug.error };

  const target = parseInput(urlInputSchema, url, "address");
  if (!target.ok) return { error: target.error };

  const outcome = await qualify(slug.value, target.value);
  return outcome.ok ? { result: outcome.result } : toFailureState(outcome);
}

export interface WhyNowState {
  result?: WhyNowResult;
  error?: string;
  /** Present when `error` is a rate-limit refusal. See lib/ai/outcome.ts. */
  rateLimited?: { retryAt: string | null };
}

/**
 * §46 puts EXPLAIN WHY NOW immediately after qualification, and it is a
 * separate call for a reason: timing is a different question from fit, and a
 * user who has just been told a company is a poor fit should not be billed for
 * an answer about when to contact them.
 *
 * The evidence crosses back from the client because it is the evidence that was
 * just shown on screen — the answer is *about* what the user is looking at. It
 * is not trusted: `explain_why_now` constrains its reasoning to the claims it
 * is handed, so a rewritten list produces a why-now traceable to that list and
 * nothing more. There is no privileged read here to abuse, and the ICP — the
 * one input that is genuinely tenant data — is loaded server-side.
 *
 * The schema below is therefore not about trust — it is about cost. Untrusted
 * *shape* was always fine here; untrusted *size* was not. Without the bounds,
 * a caller could hand us 500 claims of 50 kB each and we would pay Opus to
 * read all of it.
 */
export async function whyNowAction(
  org: string,
  request: WhyNowRequest,
): Promise<WhyNowState> {
  const slug = parseInput(orgSlugSchema, org, "organisation");
  if (!slug.ok) return { error: slug.error };

  const parsed = parseInput(whyNowRequestSchema, request, "request");
  if (!parsed.ok) return { error: parsed.error };

  const outcome = await whyNow(slug.value, parsed.value);
  return outcome.ok ? { result: outcome.result } : toFailureState(outcome);
}

/**
 * Keep a qualification — the edge that turns four screens into a loop.
 *
 * Analyze could reach a verdict and had nowhere to put it: the result lived on
 * the page until you navigated away. Everything downstream — the opportunity
 * list, the detail page, enrolling into a campaign — begins with a row that
 * nothing was writing.
 *
 * ── Why it writes the same shape `score_opportunity` writes ──────────────
 *
 * Because they are the same act arriving two ways. The job qualifies a company
 * a scan found; this qualifies one a person pasted, and an opportunity that
 * remembers which door it came through would be two kinds of opportunity for
 * every screen downstream to handle. `discovered_via` records the difference,
 * which is the only part that genuinely differs.
 *
 * ── Why upsert, not insert ───────────────────────────────────────────────
 *
 * §60. The unique key is `(org_id, company_id, icp_id)` with NULLS NOT
 * DISTINCT, so analyzing the same company twice updates its verdict rather
 * than filing a second opinion beside the first — which is what would then
 * appear twice in every list and be counted twice on the dashboard.
 *
 * ── Why the evidence is retired rather than appended ─────────────────────
 *
 * A re-analysis is a fresh reading of the same site, so its claims replace the
 * previous ones rather than joining them. Appending would leave a corrected
 * fact and its correction side by side as two independent findings.
 *
 * Retired by `deleted_at`, not by `superseded_by`, and the difference is worth
 * stating: `superseded_by` names *which* claim replaced this one, and a
 * re-analysis produces a fresh set with no per-claim correspondence to the old
 * one. Filling it in would assert a lineage nobody established. The rows stay
 * — §58 keeps history — and both filters are applied by every reader.
 */
export async function saveQualificationAction(
  org: string,
  qualification: Qualification,
): Promise<ActionResult<{ opportunityId: string }>> {
  const parsed = qualificationSchema.safeParse(qualification);
  if (!parsed.success) {
    return fail(
      "That verdict could not be read back. Analyze the URL again and save from " +
        "the fresh result.",
    );
  }
  const q = parsed.data;

  return mutate(org, "saveQualification", async ({ db, orgId }) => {
    /* The ICP the verdict was reached against. Read here rather than passed
       from the client for the same reason `analyzeUrlAction` loads it: the
       answer to "is this a good lead" must not depend on something the page
       could rewrite. Null is a real state — an org that has not defined one —
       and the unique key's NULLS NOT DISTINCT handles it. */
    const { data: icp } = await db
      .from("icps")
      .select("id")
      .eq("org_id", orgId)
      .eq("is_active", true)
      .is("deleted_at", null)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

    const icpId = icp ? String(icp.id) : null;

    /* §59's entity-resolution key. The domain the qualifier canonicalised, not
       the URL the user typed — which is what makes acme.com, www.acme.com and
       acme.com/pricing one company. */
    const { data: company, error: companyError } = await db
      .from("companies")
      .upsert(
        {
          org_id: orgId,
          canonical_domain: q.canonicalDomain,
          name: q.companyName,
          website: q.url,
          discovered_via: "manual",
        },
        { onConflict: "org_id,canonical_domain" },
      )
      .select("id")
      .single();

    if (companyError) return fail(`That company could not be saved: ${companyError.message}`);

    const companyId = String(company.id);

    const { data: opportunity, error: opportunityError } = await db
      .from("opportunities")
      .upsert(
        {
          org_id: orgId,
          company_id: companyId,
          icp_id: icpId,
          priority: q.priority,
          priority_reason: q.priorityReason,
          why_this_company: q.summary,
          outreach_angle: q.recommendation,
          confidence: q.scoreConfidence,
          discovered_via: "manual",
          last_scored_at: new Date().toISOString(),
        },
        { onConflict: "org_id,company_id,icp_id" },
      )
      .select("id")
      .single();

    if (opportunityError) {
      return fail(`That opportunity could not be saved: ${opportunityError.message}`);
    }

    const opportunityId = String(opportunity.id);

    /* A dimension the model could not establish is NULL, never 0. `0003` makes
       every dimension column nullable for this reason, and §78 states it: a
       zero asserts "we measured this and it is bad", which is a finding nobody
       made. */
    const dimension = (label: string): number | null => {
      const found = q.dimensions.find((d) => d.label === label);
      return found && typeof found.value === "number" ? found.value : null;
    };

    const { error: scoreError } = await db.from("opportunity_scores").insert({
      org_id: orgId,
      opportunity_id: opportunityId,
      /* Named for the task and dated, matching `score_opportunity` — §58 keeps
         score history rather than clobbering, and a history whose rows cannot
         be told apart is not history. */
      model_version: `qualify_opportunity@${new Date().toISOString().slice(0, 10)}`,
      score: q.score,
      icp_fit: dimension("ICP fit"),
      problem_severity: dimension("Problem severity"),
      evidence_strength: dimension("Evidence strength"),
      trigger_strength: dimension("Trigger strength"),
      trigger_freshness: dimension("Trigger freshness"),
      buying_likelihood: dimension("Buying likelihood"),
      product_relevance: dimension("Product relevance"),
      decision_maker_accessibility: dimension("Decision-maker accessibility"),
      confidence: q.scoreConfidence,
      explanation: q.explanation,
    });

    if (scoreError) return fail(`That score could not be saved: ${scoreError.message}`);

    /* The previous reading is history and stays as history — what it must not
       do is render beside the new one. */
    await db
      .from("evidence")
      .update({ deleted_at: new Date().toISOString() })
      .eq("org_id", orgId)
      .eq("subject_type", "opportunity")
      .eq("subject_id", opportunityId)
      .is("deleted_at", null);

    /* Including the unknowns. §78: a verdict listing only what supports it is
       an argument rather than an assessment, and the unknowns are what tell a
       salesperson which question to ask first. */
    const evidence = q.evidence
      .filter((e) => e.claim.trim())
      .map((e) => ({
        org_id: orgId,
        subject_type: "opportunity",
        subject_id: opportunityId,
        claim: e.claim,
        kind: e.kind,
        confidence: e.confidence,
        source_url: e.sourceUrl,
        excerpt: e.excerpt,
      }));

    if (evidence.length > 0) {
      const { error: evidenceError } = await db.from("evidence").insert(evidence);
      if (evidenceError) {
        /* The verdict is stored and is the valuable part, so this is reported
           rather than rolled back — but it is reported, because an opportunity
           whose claims have no evidence behind them is the §7 failure and not
           a cosmetic one. */
        return fail(
          `The verdict was saved, but its evidence was not: ${evidenceError.message}. ` +
            "Analyze the URL again to attach it.",
        );
      }
    }

    revalidatePath(`/${org}/opportunities`);
    revalidatePath(`/${org}/companies`);
    revalidatePath(`/${org}/dashboard`);

    return ok(
      { opportunityId },
      `${q.companyName} saved as a ${q.priority.toUpperCase()} opportunity.`,
    );
  });
}
