"use server";

import { research } from "../../../../lib/ai/research";
import type { ResearchResult } from "../../../../lib/ai/research";

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
}

export async function researchCompanyAction(
  org: string,
  url: string,
): Promise<ResearchState> {
  const outcome = await research(org, url);
  return outcome.ok ? { result: outcome.result } : { error: outcome.error };
}
