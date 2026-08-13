import {
  InvalidUrlError,
  isAiConfigured,
  ModelRefusalError,
  normalizeUrl,
  qualifyOpportunity,
  runTask,
  type Qualification,
} from "@huntloop/ai";
import { getActiveIcp } from "../data/icp";
import { resolveRecorder } from "./recorder";

/**
 * `qualify_opportunity`, wrapped for the §17 analyze screen.
 *
 * The same two states as the other AI wrappers, and the same refusal to invent
 * a third. What is different here is what the screen is for: the user pasted a
 * URL to find out whether a company is worth their time, and a fabricated
 * verdict is not a cosmetic failure — it is the product's one claim, answered
 * wrongly, in the place the user is most likely to believe it.
 */

export type AiSource = "live" | "unconfigured";

export interface QualifyResult {
  source: AiSource;
  /** True when a live run was also written to `ai_runs`. */
  metered: boolean;
  qualification: Qualification;
  /**
   * The domains the verdict could actually read.
   *
   * Rendered by the screen, because §78 asks for incomplete research to be
   * disclosed and this is the kind of incompleteness a reader would otherwise
   * never guess: the verdict rests on the company's own site, with no news,
   * funding, or hiring sources consulted — those need the scan pipeline, which
   * does not run yet. Derived from the fetch allow-list rather than asked of
   * the model, so it states what the system did, not what it believes it did.
   */
  readDomains: string[];
}

export type QualifyOutcome =
  | { ok: true; result: QualifyResult }
  | { ok: false; error: string };

export async function qualify(
  orgSlug: string,
  url: string,
): Promise<QualifyOutcome> {
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
      result: {
        source: "unconfigured",
        metered: false,
        qualification: example(normalized.url, normalized.canonicalDomain),
        readDomains: normalized.fetchDomains,
      },
    };
  }

  const resolved = await resolveRecorder(orgSlug);
  if (!resolved.ok) return { ok: false, error: resolved.error };
  const { recorder, orgId, recorded } = resolved;

  const { data: icp } = await getActiveIcp(orgId);
  if (!icp) {
    // Not a failure to hide behind a generic error. Without an ICP there is
    // nothing to judge against, and "good lead" is not a property a company
    // has on its own — it is a relation to who you sell to.
    return {
      ok: false,
      error:
        "No ideal customer profile is defined for this organisation yet. " +
        "A company can only be a good lead relative to one.",
    };
  }

  try {
    const { output } = await runTask(
      qualifyOpportunity,
      { url, icp },
      { orgId, recorder },
    );
    return {
      ok: true,
      result: {
        source: "live",
        metered: recorded,
        qualification: output,
        readDomains: normalized.fetchDomains,
      },
    };
  } catch (error) {
    if (error instanceof ModelRefusalError) {
      return {
        ok: false,
        error:
          "The model declined to assess that site. That is an answer about " +
          "the request, not an outage — try a different URL.",
      };
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Qualification failed.",
    };
  }
}

/**
 * The worked examples shown when no key is configured.
 *
 * There are two, and which one you get is decided by a regex on the URL. That
 * is a demo trick, but the reason for it is not: §17 says Huntloop must be
 * willing to answer **no**, and a screen that only ever renders a happy path
 * teaches everyone who works on it — designers, engineers, whoever writes the
 * next prompt — to treat the refusal as an edge case rather than a core output.
 * So the refusal is reachable, in the same layout, with its reasons spelled
 * out.
 *
 * Both obey every rule `qualify_opportunity` enforces: the facts cite the
 * pasted domain, the IGNORE verdict establishes nothing it does not need to,
 * and unmeasured dimensions are unknown rather than zero. An example that
 * cheats on the rules teaches that the rules are decorative.
 */
function example(url: string, domain: string): Qualification {
  const looksLikeAFund = /fund|capital|partners|ventures/i.test(domain);

  if (looksLikeAFund) {
    return {
      url,
      canonicalDomain: domain,
      companyName: domain,
      priority: "ignore",
      priorityReason:
        "Outside every active ICP. Matched on region only, which is not a reason to contact anyone.",
      score: 21,
      scoreConfidence: "high",
      explanation:
        "A regional investment fund. No product, no engineering org, and nothing this product applies to.",
      dimensions: [
        { label: "ICP fit", value: 12, note: "Not a software company." },
        { label: "Problem severity", value: "unknown", note: null },
        { label: "Evidence strength", value: 44, note: null },
        { label: "Trigger strength", value: "unknown", note: null },
        { label: "Trigger freshness", value: "unknown", note: null },
        { label: "Buying likelihood", value: "unknown", note: null },
        { label: "Product relevance", value: 9, note: null },
        { label: "Decision-maker accessibility", value: "unknown", note: null },
      ],
      summary:
        "A boutique investment fund. They do not build software, do not run infrastructure, and have no public engineering presence.",
      recommendation:
        "Don't contact. There is no version of this where the product is relevant, and a good opener cannot be written for a company that does not have the problem.",
      evidence: [
        {
          claim: "This is an investment fund with no software product.",
          kind: "fact",
          confidence: "high",
          sourceUrl: `https://${domain}/about`,
          excerpt: "We invest in mid-market European industrials.",
        },
        {
          claim: "Any problem this product solves.",
          kind: "unknown",
          confidence: null,
          sourceUrl: null,
          excerpt: null,
        },
      ],
    };
  }

  return {
    url,
    canonicalDomain: domain,
    companyName: domain,
    priority: "hot",
    priorityReason:
      "Strong ICP fit, a problem stated publicly on their own site, and a recent product trigger.",
    score: 91,
    scoreConfidence: "medium",
    explanation:
      "Fit and problem are both established on the site, and the launch post names the blocker this product removes.",
    dimensions: [
      { label: "ICP fit", value: 94, note: "Squarely in the stated segment." },
      { label: "Problem severity", value: 88, note: null },
      { label: "Evidence strength", value: 82, note: null },
      { label: "Trigger strength", value: 90, note: null },
      {
        label: "Trigger freshness",
        value: 96,
        note: "Dated on their own changelog.",
      },
      {
        label: "Buying likelihood",
        value: "unknown",
        note: "A website cannot establish this.",
      },
      { label: "Product relevance", value: 92, note: null },
      { label: "Decision-maker accessibility", value: 71, note: null },
    ],
    summary:
      "Autonomous trading agents for institutional desks. They have publicly named the blocker this product removes.",
    recommendation:
      "Worth contacting this week. Lead with the blocker they described, not with the company news.",
    evidence: [
      {
        claim: "They describe custody permissioning as an unsolved problem.",
        kind: "fact",
        confidence: "high",
        sourceUrl: `https://${domain}/blog`,
        excerpt: "Permissioning remains the hardest part of shipping agents that move funds.",
      },
      {
        claim:
          "They will need controlled signing authority before institutions onboard.",
        kind: "inference",
        confidence: "medium",
        sourceUrl: null,
        excerpt: null,
      },
      {
        claim: "Whether budget is allocated this quarter.",
        kind: "unknown",
        confidence: null,
        sourceUrl: null,
        excerpt: null,
      },
    ],
  };
}
