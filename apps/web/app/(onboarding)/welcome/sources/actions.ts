"use server";

import type { IcpSummary } from "@huntloop/ai";
import { recommend } from "../../../../lib/ai/sources";
import type { SourcesResult } from "../../../../lib/ai/sources";
import { toFailureState } from "../../../../lib/ai/outcome";
import { icpSchema, orgSlugSchema, parseInput } from "../../../../lib/validation";
import { captureForViewer } from "../../../../lib/analytics";

/**
 * The sources step's one server action.
 *
 * The ICP arrives from the client because that is where it currently lives —
 * see `lib/onboarding/draft.ts`. It is treated as input to be validated, not as
 * something to trust: `recommend_sources` constrains every recommendation's
 * basis to the elements of whatever profile it is handed, so a tampered ICP
 * produces recommendations traceable to that ICP and nothing more. There is
 * nothing here to escalate with, which is why passing it from the client is
 * acceptable rather than merely convenient.
 *
 * "Treated as input to be validated" is now literally true rather than an
 * argument about downstream behaviour: the schema below checks the shape and,
 * more to the point, bounds the size. Fifty segments of four hundred
 * characters is generous for a real ICP and a hard ceiling on what a caller
 * can make us tokenize.
 */

export interface SourcesState {
  result?: SourcesResult;
  error?: string;
  /** Present when `error` is a rate-limit refusal. See lib/ai/outcome.ts. */
  rateLimited?: { retryAt: string | null };
}

export async function recommendSourcesAction(
  org: string,
  icp: IcpSummary,
): Promise<SourcesState> {
  const slug = parseInput(orgSlugSchema, org, "organisation");
  if (!slug.ok) return { error: slug.error };

  const profile = parseInput(icpSchema, icp, "customer profile");
  if (!profile.ok) return { error: profile.error };

  const outcome = await recommend(slug.value, profile.value);

  // The last step of the funnel. No part of the ICP is sent — it is the
  // customer's description of who they sell to, which is close to the most
  // commercially sensitive thing they will type into this product.
  await captureForViewer(
    outcome.ok ? "onboarding_step_completed" : "onboarding_step_failed",
    {
      step: "sources",
      ...(outcome.ok
        ? { aiConfigured: outcome.result.source === "live" }
        : { reason: outcome.kind === "rate_limited" ? "rate_limited" : "model_refused" }),
    },
  );

  return outcome.ok ? { result: outcome.result } : toFailureState(outcome);
}
