"use server";

import { research } from "../../../../lib/ai/research";
import type { ResearchResult } from "../../../../lib/ai/research";
import { toFailureState } from "../../../../lib/ai/outcome";
import { orgSlugSchema, parseInput, urlInputSchema } from "../../../../lib/validation";
import { captureForViewer } from "../../../../lib/analytics";

/**
 * The onboarding step's one server action.
 *
 * Research can take tens of seconds — it fetches several pages and reasons over
 * them — so this is deliberately a plain action the client awaits rather than
 * anything that pretends to be instant. §68 puts this at the top of the
 * pipeline; getting it wrong is not recoverable by a later step.
 */

export interface ResearchState {
  result?: ResearchResult;
  error?: string;
  /** Present when `error` is a rate-limit refusal. See lib/ai/outcome.ts. */
  rateLimited?: { retryAt: string | null };
}

export async function researchCompanyAction(
  org: string,
  url: string,
): Promise<ResearchState> {
  const slug = parseInput(orgSlugSchema, org, "organisation");
  if (!slug.ok) return { error: slug.error };

  const target = parseInput(urlInputSchema, url, "address");
  if (!target.ok) return { error: target.error };

  const outcome = await research(slug.value, target.value);

  /*
   * Completed *or* failed, both recorded.
   *
   * A funnel built only from successes cannot distinguish "people stop here"
   * from "this step breaks here", and those call for opposite responses — one
   * is a copy problem, the other is an outage. `aiConfigured` separates a real
   * research run from the worked example, so a deployment with no key does not
   * quietly inflate the completion rate.
   *
   * The URL the user pasted is never sent. It is their own company's address
   * during onboarding, and it is exactly the kind of thing that ends up in a
   * telemetry pipeline by accident.
   */
  await captureForViewer(
    outcome.ok ? "onboarding_step_completed" : "onboarding_step_failed",
    {
      step: "product",
      ...(outcome.ok
        ? { aiConfigured: outcome.result.source === "live" }
        : { reason: outcome.kind === "rate_limited" ? "rate_limited" : "model_refused" }),
    },
  );

  return outcome.ok ? { result: outcome.result } : toFailureState(outcome);
}
