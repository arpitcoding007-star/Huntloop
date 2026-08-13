import {
  icpElements,
  isAiConfigured,
  ModelRefusalError,
  recommendSources,
  runTask,
  type IcpSummary,
  type SourceRecommendation,
} from "@huntloop/ai";
import { resolveRecorder } from "./recorder";
import { consumeRateLimit, refusal } from "../rate-limit";
import type { AiFailure } from "./outcome";

/**
 * `recommend_sources`, wrapped for the onboarding step that calls it.
 *
 * The same two states as `research.ts`, for the same reason, and there is still
 * no third "it failed so here's a demo" state. What differs is what a
 * fabricated answer costs. A made-up company profile is at least visibly about
 * the user's own company, and they will notice. A made-up *source list* looks
 * right to everyone — the names are real publications — and its wrongness only
 * shows up weeks later as a hunt that never surfaces anything, by which time
 * nobody suspects the source list.
 */

export type AiSource = "live" | "unconfigured";

export interface SourcesResult {
  source: AiSource;
  /** True when a live run was also written to `ai_runs`. */
  metered: boolean;
  recommendations: SourceRecommendation[];
}

export type SourcesOutcome =
  | { ok: true; result: SourcesResult }
  | AiFailure;

export async function recommend(
  orgSlug: string,
  icp: IcpSummary,
): Promise<SourcesOutcome> {
  if (!icpElements(icp).length) {
    return {
      ok: false,
      error:
        "There's no ideal customer profile to recommend from yet. Go back a " +
        "step and describe who you're selling to.",
    };
  }

  if (!isAiConfigured()) {
    return {
      ok: true,
      result: { source: "unconfigured", metered: false, recommendations: example(icp) },
    };
  }

  const resolved = await resolveRecorder(orgSlug);
  if (!resolved.ok) return { ok: false, error: resolved.error };
  const { recorder, orgId, recorded } = resolved;

  const budget = await consumeRateLimit(orgId, "recommend_sources");
  if (!budget.allowed) return refusal(budget);

  try {
    const { output } = await runTask(recommendSources, icp, { orgId, recorder });
    return {
      ok: true,
      result: { source: "live", metered: recorded, recommendations: output },
    };
  } catch (error) {
    if (error instanceof ModelRefusalError) {
      return {
        ok: false,
        error:
          "The model declined to recommend sources for this profile. That is " +
          "an answer about the request, not an outage.",
      };
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Source recommendation failed.",
    };
  }
}

/**
 * The worked example shown when no key is configured.
 *
 * Built from the ICP actually in front of the user rather than from a fixed
 * fictional one, so it obeys the rule the real task enforces: every `basis`
 * here is a criterion this user wrote. That keeps the example honest about the
 * *shape* of the answer while the banner is unambiguous that no model chose
 * these — and it means the example cannot drift into violating a rule the rest
 * of the system treats as non-negotiable.
 */
function example(icp: IcpSummary): SourceRecommendation[] {
  const elements = icpElements(icp);
  // Falls back to the first element when a category is empty, so the example
  // never cites something the user did not write.
  const pick = (values: string[]) => values.find((v) => v.trim()) ?? elements[0]!;
  const segment = pick(icp.segments);
  const trigger = pick(icp.triggers);

  return [
    {
      name: "Industry news publications",
      kind: "news",
      url: null,
      canonicalDomain: null,
      why: `Where funding and launches in ${segment.toLowerCase()} are reported first.`,
      basis: segment,
    },
    {
      name: "Job boards and career pages",
      kind: "jobs",
      url: null,
      canonicalDomain: null,
      // The trigger is not interpolated into the sentence. It reads naturally
      // for a hiring trigger and badly for any other, and the basis line under
      // it already names which one put this here.
      why: "Hiring is public before almost anything else, so a trigger tends to show here first.",
      basis: trigger,
    },
    {
      name: "Company engineering blogs",
      kind: "blog",
      url: null,
      canonicalDomain: null,
      why: "Where your buyers describe the problem in their own words, before they shop for a solution.",
      basis: segment,
    },
  ];
}
