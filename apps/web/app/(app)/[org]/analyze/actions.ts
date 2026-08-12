"use server";

import { qualify } from "../../../../lib/ai/qualify";
import type { QualifyResult } from "../../../../lib/ai/qualify";

/**
 * The analyze screen's one server action.
 *
 * Only the org and the URL cross from the client. The ICP is loaded here, from
 * the database, under the caller's own session — unlike onboarding, where the
 * profile genuinely only exists in the browser. A client-supplied ICP would
 * mean the answer to "is this a good lead?" depended on something the page
 * could rewrite, which is not a property this particular screen should have.
 *
 * Qualification fetches several pages and reasons over them, so this takes tens
 * of seconds. Until the job runner exists it is awaited inline — acceptable for
 * a user-initiated one-off, and not something that will survive a scan cycle.
 */

export interface AnalyzeState {
  result?: QualifyResult;
  error?: string;
}

export async function analyzeUrlAction(
  org: string,
  url: string,
): Promise<AnalyzeState> {
  const outcome = await qualify(org, url);
  return outcome.ok ? { result: outcome.result } : { error: outcome.error };
}
