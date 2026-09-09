"use server";

import type { IcpCriteria } from "@huntloop/db/icp";
import { translateIcp } from "@huntloop/db/discovery";
import { estimateReach } from "@huntloop/jobs";
import { draft } from "../../../../lib/ai/icp-draft";
import type { IcpDraftResult } from "../../../../lib/ai/icp-draft";
import { toFailureState } from "../../../../lib/ai/outcome";
import {
  getOnboardingState,
  getStoredResearch,
} from "../../../../lib/data/onboarding";
import { fail, mutate, ok, type ActionResult } from "../../../../lib/data/org";
import {
  icpStepSchema,
  orgSlugSchema,
  parseForm,
  parseInput,
} from "../../../../lib/validation";
import { captureForViewer } from "../../../../lib/analytics";

/**
 * The ICP step's three actions.
 *
 * Drafting, counting, and — via `../actions.ts` — saving. The first two are
 * the ones that make this screen honest: one produces a profile that genuinely
 * follows from the user's own site, the other tells them how big the market
 * they just described actually is.
 */

export interface DraftState {
  result?: IcpDraftResult;
  /** True when the research is the labelled worked example, not a real reading. */
  researchWasExample?: boolean;
  error?: string;
  rateLimited?: { retryAt: string | null };
}

/**
 * Drafts the profile from the research already on disk.
 *
 * ── Why it reads the research rather than taking it from the client ──────
 *
 * Because the previous screen saved it, and re-sending it would make the two
 * screens' notions of "the research" able to disagree. It also means this
 * action works on a fresh tab, on another device, and a month later — which is
 * the difference between a wizard and a workspace.
 *
 * `0026` is what makes it possible: before that column existed only two of the
 * five research sentences survived the previous step, and `draft_icp` closes
 * its citations to exactly those sentences.
 */
export async function draftIcpAction(org: string): Promise<DraftState> {
  const slug = parseInput(orgSlugSchema, org, "organisation");
  if (!slug.ok) return { error: slug.error };

  const [research, state] = await Promise.all([
    getStoredResearch(slug.value),
    getOnboardingState(slug.value),
  ]);

  if (!research || !research.sells) {
    return {
      error:
        "We don't have a reading of your website to build a profile from. Go " +
        "back a step and let Huntloop read it, or describe what you sell.",
    };
  }

  const outcome = await draft(slug.value, {
    companyName: research.companyName,
    sells: research.sells,
    buyers: research.buyers,
    problem: research.problem,
    trigger: research.trigger,
    role: state?.role ?? null,
    goals: state?.goals ?? [],
  });

  await captureForViewer(
    outcome.ok ? "onboarding_step_viewed" : "onboarding_step_failed",
    {
      step: "icp",
      ...(outcome.ok
        ? { aiConfigured: outcome.result.source === "live" }
        : { reason: outcome.kind === "rate_limited" ? "rate_limited" : "model_refused" }),
    },
  );

  if (!outcome.ok) return toFailureState(outcome);

  return {
    result: outcome.result,
    /* Surfaced separately from the draft's own `source`. Two different things
       can be an example here — the research and the drafting — and a screen
       that conflated them would tell a user with a real site reading that
       nothing about their profile was real. */
    researchWasExample: !research.isLive,
  };
}

export interface ReachState {
  total: number | null;
  provider: string | null;
  configured: boolean;
  error: string | null;
  /** Criteria no provider can express, with what handles them instead. */
  unmapped: Array<{ field: string; values: string[]; reason: string; handledElsewhere: string | null }>;
}

/**
 * How many companies match, per the provider.
 *
 * ── Why the unmapped criteria come back with it ──────────────────────────
 *
 * `translateIcp` already reports every criterion no configured provider can
 * express, and whether something else handles it. Rendering that is not an
 * apology — it is the difference between a customer knowing their "hiring a VP
 * of Data" trigger is applied at *qualification* rather than at search, and a
 * customer quietly believing the count honours it.
 *
 * The count is the number they would otherwise reason from. Handing it over
 * without saying what it does and does not include would be the most
 * consequential omission on this screen.
 */
export async function estimateReachAction(
  org: string,
  input: unknown,
): Promise<ActionResult<ReachState>> {
  const slug = parseInput(orgSlugSchema, org, "organisation");
  if (!slug.ok) return fail(slug.error);

  const parsed = parseForm(icpStepSchema, input);
  if (!parsed.ok) return fail(parsed.error, parsed.fieldErrors);
  const v = parsed.value;

  /* Written out rather than spread, for the reason `../actions.ts` gives: the
     ICP type distinguishes "not stated" (null) from "stated as none" ([]) and
     a spread would turn every unrendered field into `undefined`. */
  const criteria: IcpCriteria = {
    segments: v.segments ?? null,
    sizes: v.sizes ?? null,
    regions: v.regions ?? null,
    triggers: v.triggers ?? null,
    industries: v.industries ?? null,
    employeeRange: v.employeeRange ?? null,
    revenueBands: null,
    technologies: v.technologies ?? null,
    businessModels: v.businessModels ?? null,
    painPoints: v.painPoints ?? null,
    useCases: v.useCases ?? null,
    buyingSignals: null,
    keywords: null,
    exampleCompanies: v.exampleCompanies ?? null,
    notes: null,
  };

  const translation = translateIcp({
    criteria,
    exclusions: {
      exclusions: v.exclusions ?? null,
      industries: null,
      regions: null,
      sizes: null,
      technologies: null,
      businessModels: null,
      employeeRange: null,
      keywords: null,
      domains: v.excludeDomains ?? null,
      signals: null,
      notes: null,
    },
  });

  const unmapped = translation.unmapped.map((u) => ({
    field: String(u.field),
    values: u.values,
    reason: u.reason,
    handledElsewhere: u.handledElsewhere,
  }));

  /* `mutate` rather than a bare read, because this spends a provider credit.
     It resolves the org id from a *verified membership* — which is what makes
     it safe to hand that id to `estimateReach`, which runs under the
     service-role client and would otherwise be a way to bill another tenant. */
  return mutate(slug.value, "estimateReach", async ({ orgId }) => {
    if (translation.empty) {
      return ok({
        total: null,
        provider: null,
        configured: true,
        error:
          "There's nothing here a search can act on yet. Add a segment, an " +
          "industry or a size band and we'll count what matches.",
        unmapped,
      });
    }

    const estimate = await estimateReach(orgId, translation.filters);
    return ok({ ...estimate, unmapped });
  });
}
