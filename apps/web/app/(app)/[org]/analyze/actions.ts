"use server";

import { qualify } from "../../../../lib/ai/qualify";
import type { QualifyResult } from "../../../../lib/ai/qualify";
import { whyNow } from "../../../../lib/ai/why-now";
import type { WhyNowRequest, WhyNowResult } from "../../../../lib/ai/why-now";

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

export interface WhyNowState {
  result?: WhyNowResult;
  error?: string;
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
 */
export async function whyNowAction(
  org: string,
  request: WhyNowRequest,
): Promise<WhyNowState> {
  const outcome = await whyNow(org, request);
  return outcome.ok ? { result: outcome.result } : { error: outcome.error };
}
