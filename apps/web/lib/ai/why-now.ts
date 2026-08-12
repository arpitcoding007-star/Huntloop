import {
  explainWhyNow,
  groundableClaims,
  isAiConfigured,
  ModelRefusalError,
  runTask,
  type Priority,
  type QualificationEvidence,
  type WhyNow,
} from "@huntloop/ai";
import { getActiveIcp } from "../data/icp";
import { resolveRecorder } from "./recorder";

/**
 * `explain_why_now`, wrapped for the screens that ask it.
 *
 * Runs on the evidence a qualification already gathered rather than going back
 * to the web, which is what makes its answer checkable: everything it says has
 * to trace to a claim that was passed in, and the task refuses anything that
 * does not.
 */

export type AiSource = "live" | "unconfigured";

export interface WhyNowResult {
  source: AiSource;
  metered: boolean;
  whyNow: WhyNow;
}

export type WhyNowOutcome =
  | { ok: true; result: WhyNowResult }
  | { ok: false; error: string };

export interface WhyNowRequest {
  companyName: string;
  canonicalDomain: string;
  priority: Priority;
  evidence: QualificationEvidence[];
}

export async function whyNow(
  orgSlug: string,
  request: WhyNowRequest,
): Promise<WhyNowOutcome> {
  const { recorder, orgId, recorded } = isAiConfigured()
    ? await resolveRecorder(orgSlug)
    : { recorder: null, orgId: orgSlug, recorded: false };

  const { data: icp } = await getActiveIcp(orgId);
  if (!icp) {
    return {
      ok: false,
      error:
        "No ideal customer profile is defined for this organisation yet. " +
        "Whether something matters now depends on what you are selling.",
    };
  }

  const input = { ...request, icp };

  // Checked before the call rather than after: with nothing established there
  // is no material for a timing argument, and the honest response is to say so
  // instead of billing for a model call that can only fail.
  if (!groundableClaims(input).length) {
    return {
      ok: true,
      result: {
        source: isAiConfigured() ? "live" : "unconfigured",
        metered: false,
        whyNow: {
          hasReason: false,
          reason:
            "Nothing has been established about this company yet, so there is " +
            "nothing that could make contacting them urgent today.",
          urgency: null,
          confidence: null,
          basedOn: [],
        },
      },
    };
  }

  if (!recorder) {
    return {
      ok: true,
      result: { source: "unconfigured", metered: false, whyNow: example(input) },
    };
  }

  try {
    const { output } = await runTask(explainWhyNow, input, { orgId, recorder });
    return { ok: true, result: { source: "live", metered: recorded, whyNow: output } };
  } catch (error) {
    if (error instanceof ModelRefusalError) {
      return {
        ok: false,
        error: "The model declined to assess timing for this company.",
      };
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Timing analysis failed.",
    };
  }
}

/**
 * The worked example shown when no key is configured.
 *
 * Grounded in the evidence actually in front of the user, so it obeys the rule
 * the real task enforces rather than merely resembling its output. A demo that
 * cites a claim nobody gathered would be modelling the exact failure this task
 * exists to refuse.
 *
 * Non-HOT verdicts get "no reason today", which is both the commoner real
 * answer and the one worth putting in front of whoever is evaluating this.
 */
function example(input: WhyNowRequest & { icp: unknown }): WhyNow {
  const claims = groundableClaims(input as Parameters<typeof groundableClaims>[0]);

  if (input.priority !== "hot") {
    return {
      hasReason: false,
      reason:
        "Nothing here has changed recently enough to justify contacting them " +
        "this week. Watch for a funding round, a senior hire in this area, or " +
        "a public post naming the problem.",
      urgency: null,
      confidence: null,
      basedOn: [],
    };
  }

  return {
    hasReason: true,
    reason:
      "They have named the blocker publicly, which moves it from something " +
      "they might eventually address to something they are working on now. " +
      "The window is while it is still unsolved.",
    urgency: "this_month",
    confidence: "medium",
    basedOn: claims.slice(0, 1),
  };
}
