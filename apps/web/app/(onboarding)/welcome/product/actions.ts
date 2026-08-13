"use server";

import { research } from "../../../../lib/ai/research";
import type { ResearchResult } from "../../../../lib/ai/research";
import { toFailureState } from "../../../../lib/ai/outcome";
import { orgSlugSchema, parseInput, urlInputSchema } from "../../../../lib/validation";

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
  return outcome.ok ? { result: outcome.result } : toFailureState(outcome);
}
