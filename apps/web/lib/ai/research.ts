import {
  InvalidUrlError,
  isAiConfigured,
  ModelRefusalError,
  normalizeUrl,
  researchCompany,
  runTask,
  type CompanyUnderstanding,
} from "@huntloop/ai";
import { resolveRecorder } from "./recorder";
import { consumeRateLimit, refusal } from "../rate-limit";
import { budgetRefusal, countAiRun, withinAiBudget } from "./budget";
import type { AiFailure } from "./outcome";

/**
 * `research_company`, wrapped for the screens that call it.
 *
 * The three-state honesty of `lib/data/source.ts` applies here for the same
 * reason it applies there, and arguably more so: a fabricated pipeline number
 * is a bad dashboard, but a fabricated *company profile* is the thing every
 * later decision is built on. So the source travels with the result and the
 * screen renders it.
 *
 *   live          A model read the site.
 *   unconfigured  No ANTHROPIC_API_KEY. A worked example, labelled as one.
 *
 * There is no third "it failed so here's a demo" state on purpose. Silently
 * substituting the example for a real failure would put invented findings in
 * front of someone who believes a model produced them — §7's failure aimed at
 * our own user.
 */

export type AiSource = "live" | "unconfigured";

export interface ResearchResult {
  source: AiSource;
  /** True when a live run was also written to `ai_runs`. */
  metered: boolean;
  understanding: CompanyUnderstanding;
}

export type ResearchOutcome =
  | { ok: true; result: ResearchResult }
  | AiFailure;

export async function research(
  orgSlug: string,
  url: string,
): Promise<ResearchOutcome> {
  let normalized;
  try {
    normalized = normalizeUrl(url);
  } catch (error) {
    if (error instanceof InvalidUrlError) {
      return { ok: false, error: "That doesn't look like a website address." };
    }
    throw error;
  }

  if (!isAiConfigured()) {
    return {
      ok: true,
      result: { source: "unconfigured", metered: false, understanding: example(normalized.url) },
    };
  }

  const resolved = await resolveRecorder(orgSlug);
  // Refused before the call, not after: a run that cannot be attributed to an
  // org the caller belongs to is not a run we pay for. See recorder.ts.
  if (!resolved.ok) return { ok: false, error: resolved.error };
  const { recorder, orgId, recorded, db } = resolved;

  // The most expensive task in the product: ~8 page fetches plus Opus at high
  // effort. Consumed before the call for the reason given in rate-limit.ts.
  /* ANL-04. The monthly ceiling, checked before the rate limit: reading it
     costs nothing, and consuming a rate-limit unit for a request that is
     over quota charges somebody for being refused. Skipped in demo mode,
     where there is no counter to read and nothing is metered. */
  if (db) {
    const allowance = await withinAiBudget(db, orgId);
    if (!allowance.allowed) return budgetRefusal(allowance);
  }

  const budget = await consumeRateLimit(orgId, "research_company");
  if (!budget.allowed) return refusal(budget);

  try {
    const { output } = await runTask(researchCompany, { url }, { orgId, recorder });

    /* Counted after the fact. A refused or crashed call has not produced
       anything the org asked for, and its cost is already in `ai_runs`. */
    if (db) await countAiRun(db, orgId);
    return {
      ok: true,
      result: { source: "live", metered: recorded, understanding: output },
    };
  } catch (error) {
    if (error instanceof ModelRefusalError) {
      return {
        ok: false,
        error:
          "The model declined to research that site. That is an answer about " +
          "the request, not an outage — try a different URL.",
      };
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Research failed.",
    };
  }
}

/**
 * The worked example shown when no key is configured.
 *
 * Held to the same §7 rules as a real result — the facts carry sources, the
 * inferences carry confidence, and `business_model` is genuinely unknown. A
 * demo that cheats on the rules teaches everyone who reads it that the rules
 * are decorative, and the onboarding screen is where most people meet them.
 */
function example(url: string): CompanyUnderstanding {
  return {
    url,
    canonicalDomain: normalizeUrl(url).canonicalDomain,
    companyName: "Example Co",
    findings: [
      {
        field: "sells",
        label: "What you sell",
        kind: "fact",
        value:
          "Policy and permissioning infrastructure for autonomous agents that hold or move funds.",
        sourceUrl: "https://example.com/product",
        confidence: "high",
      },
      {
        field: "buyers",
        label: "Who you sell to",
        kind: "inference",
        value: "Crypto trading desks, funds, and AI infrastructure companies.",
        sourceUrl: null,
        confidence: "medium",
      },
      {
        field: "business_model",
        label: "Business model",
        kind: "unknown",
        value: "No pricing is published anywhere on the site.",
        sourceUrl: null,
        confidence: null,
      },
      {
        field: "problem",
        label: "The problem you solve",
        kind: "fact",
        value:
          "Institutions will not let software hold unconstrained signing authority over capital.",
        sourceUrl: "https://example.com/",
        confidence: "high",
      },
      {
        field: "trigger",
        label: "Likely buying trigger",
        kind: "inference",
        value:
          "Shipping an autonomous agent that touches real funds, especially just after raising.",
        sourceUrl: null,
        confidence: "low",
      },
    ],
  };
}
