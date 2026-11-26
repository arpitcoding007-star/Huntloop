import type { CompanyUnderstanding } from "@huntloop/ai";

/**
 * The worked example shown when no model is configured.
 *
 * Held to the same §7 rules as a real result — the facts carry sources, the
 * inferences carry confidence, and `business_model` is genuinely unknown. A
 * demo that cheats on the rules teaches everyone who reads it that the rules
 * are decorative, and these are the first screens a stranger sees.
 */
export function exampleUnderstanding(url: string, canonicalDomain: string): CompanyUnderstanding {
  return {
    url,
    canonicalDomain,
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
