"use server";

import { translateIcp } from "@huntloop/db/discovery";
import { estimateReach } from "@huntloop/jobs";
import {
  previewLookAlikes,
  type LookAlikePreview,
} from "../../../../lib/data/look-alike-preview";
import { stepIcp } from "../../../../lib/onboarding/icp-step";
import { draft } from "../../../../lib/ai/icp-draft";
import type { IcpDraftResult } from "../../../../lib/ai/icp-draft";
import { toFailureState } from "../../../../lib/ai/outcome";
import {
  getOnboardingState,
  getStoredResearch,
} from "../../../../lib/data/onboarding";
import {
  fail,
  mutate,
  ok,
  resolveDataSource,
  type ActionResult,
} from "../../../../lib/data/org";
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

  const translation = translateIcp(stepIcp(v));

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

/**
 * What the example companies would add, before anything is saved.
 *
 * ── Why this is a button and the reach counter is not (`ONB-22`) ─────────
 *
 * The reach count is debounced and automatic because a provider's search
 * endpoint returns a total for one row — it is cheap, and a number that
 * changes as you type is the whole point of it. This is not that. Each
 * example is a metered enrichment, so running it on a pause in typing would
 * spend five credits every time somebody thought about their third domain.
 * A press is the honest interface for a call that costs something.
 *
 * It writes nothing. The expansion happens at discovery time from the saved
 * profile; this only shows what that will do.
 */
export async function previewLookAlikesAction(
  org: string,
  input: unknown,
): Promise<ActionResult<LookAlikePreview>> {
  const slug = parseInput(orgSlugSchema, org, "organisation");
  if (!slug.ok) return fail(slug.error);

  const parsed = parseForm(icpStepSchema, input);
  if (!parsed.ok) return fail(parsed.error, parsed.fieldErrors);
  const v = parsed.value;

  if (!v.exampleCompanies?.length) {
    return fail(
      "Add a company or two first — as domains, like stripe.com — and we'll " +
        "read them and show you what they'd change.",
    );
  }

  /* `mutate` would refuse this anyway, with "there is nothing to save to" —
     which is the wrong sentence for an action that saves nothing. A reader
     walking the demo deserves the actual reason, and the actual reason is
     that a provider call has to be metered against a workspace that exists. */
  const { db } = await resolveDataSource();
  if (!db) {
    return fail(
      "This deployment has no database connected, so the example companies " +
        "can't be read: looking one up is a metered provider call, and there " +
        "is nowhere to meter it.",
    );
  }

  /* `mutate` for the reason `estimateReachAction` gives: this spends a
     provider credit, and the org id must come from a verified membership
     before it reaches code running under the service-role client. */
  return mutate(slug.value, "previewLookAlikes", async ({ orgId }) =>
    ok(await previewLookAlikes(orgId, stepIcp(v))),
  );
}
