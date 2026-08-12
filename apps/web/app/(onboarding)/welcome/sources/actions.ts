"use server";

import type { IcpSummary } from "@huntloop/ai";
import { recommend } from "../../../../lib/ai/sources";
import type { SourcesResult } from "../../../../lib/ai/sources";

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
 */

export interface SourcesState {
  result?: SourcesResult;
  error?: string;
}

export async function recommendSourcesAction(
  org: string,
  icp: IcpSummary,
): Promise<SourcesState> {
  const outcome = await recommend(org, icp);
  return outcome.ok ? { result: outcome.result } : { error: outcome.error };
}
