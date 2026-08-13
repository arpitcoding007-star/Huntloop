"use server";

import { qualify } from "../../../../lib/ai/qualify";
import type { QualifyResult } from "../../../../lib/ai/qualify";
import { whyNow } from "../../../../lib/ai/why-now";
import type { WhyNowRequest, WhyNowResult } from "../../../../lib/ai/why-now";
import { toFailureState } from "../../../../lib/ai/outcome";
import {
  orgSlugSchema,
  parseInput,
  urlInputSchema,
  whyNowRequestSchema,
} from "../../../../lib/validation";

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
