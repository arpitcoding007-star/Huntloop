/**
 * `research_company` — read a company's website and report what is actually
 * established there (master context §8, §12).
 *
 * This is the first thing Huntloop learns and everything downstream is built on
 * it: the ICP is derived from it, source recommendation from the ICP,
 * opportunities from the sources. An error here does not stay one screen wide —
 * it propagates, and it gets harder to spot at every step. Which is why the
 * output is five named fields the onboarding screen renders as *editable*
 * claims rather than a prose profile that reads as settled.
 *
 * The §7 distinction is the whole design. "Sells policy infrastructure for
 * autonomous agents" read off the homepage is a FACT with a URL. "Sells to
 * crypto trading desks" concluded from three logos in a customer strip is an
 * INFERENCE. "Business model" on a site with no pricing page is UNKNOWN — and
 * UNKNOWN is a correct answer that the prompt asks for by name, because a model
 * that learns guessing scores better will guess.
 */
import { assertValidClaim, type ClaimKind, type Confidence } from "../claims.ts";
import { definePrompt } from "../prompt.ts";
import type { LLMTask } from "../task.ts";
import { UNTRUSTED_CONTENT_RULE, wrapUntrusted } from "../untrusted.ts";
import { normalizeUrl } from "../url.ts";

/** The five questions §8 asks of a company's own site. A closed set. */
export const RESEARCH_FIELDS = [
  "sells",
  "buyers",
  "business_model",
  "problem",
  "trigger",
] as const;

export type ResearchField = (typeof RESEARCH_FIELDS)[number];

/** Labels the onboarding review step renders. Kept beside the field union so
 *  adding a field without labelling it is a type error, not a blank heading. */
export const FIELD_LABELS: Record<ResearchField, string> = {
  sells: "What you sell",
  buyers: "Who you sell to",
  business_model: "Business model",
  problem: "The problem you solve",
  trigger: "Likely buying trigger",
};

export interface ResearchFinding {
  field: ResearchField;
  label: string;
  kind: ClaimKind;
  /** The claim, or — when `unknown` — what the site did not establish. */
  value: string;
  sourceUrl: string | null;
  confidence: Confidence | null;
}

export interface CompanyUnderstanding {
  url: string;
  canonicalDomain: string;
  companyName: string;
  findings: ResearchFinding[];
}

export interface ResearchCompanyInput {
  /** Whatever the user typed. Normalised before use. */
  url: string;
}

const PROMPT = definePrompt(
  "research_company",
  `
You are Huntloop's company researcher. You are given one company website. You
read it and report what it establishes about the company — no more.

${UNTRUSTED_CONTENT_RULE}

Fetch the given URL. Follow at most a few links on the same site where they
clearly answer one of the questions below — an about, product, pricing, or
customers page. Do not fetch anything else.

Answer exactly these five questions, once each:

  sells           What this company sells.
  buyers          Who buys it.
  business_model  How they charge for it.
  problem         The problem their product removes for a buyer.
  trigger         What tends to make a buyer need this now.

## The rule that matters most

Every answer carries a kind, and the kinds are not interchangeable:

  fact       The site states this. You must give the URL of the page that
             states it. If you cannot name that page, it is not a fact.
  inference  You concluded it from what the site shows. Say what you concluded,
             not what you assume the reader will fill in. Carries a confidence
             of high, medium or low.
  unknown    The site does not establish this. Say plainly what is missing —
             "no pricing is published anywhere on the site" — and give neither
             a source nor a confidence.

unknown is a correct, expected answer, and a site that does not publish pricing
should produce an unknown business_model. Do not reach for an adjacent fact and
present it as the answer. Do not restate marketing copy as though its claims
were verified: "the fastest platform in its category" is a claim the site makes
about itself, and reporting it as a fact about the world is the exact error
this system exists to avoid. You may report that the site makes the claim.

## Style

Write each value as one plain sentence a salesperson would say out loud. No
marketing register, no hedging stacks ("appears to possibly indicate"), no
restating the question. Be specific: "policy and permissioning infrastructure
for agents that move funds" beats "AI infrastructure".

For companyName, give the company's own name for itself, not the domain.
`,
);

const CLAIM_KINDS: ClaimKind[] = ["fact", "inference", "unknown"];

const SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["companyName", "findings"],
  properties: {
    companyName: { type: "string" },
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["field", "kind", "value", "sourceUrl", "confidence"],
        properties: {
          field: { type: "string", enum: [...RESEARCH_FIELDS] },
          kind: { type: "string", enum: CLAIM_KINDS },
          value: { type: "string" },
          // Nullable is expressed as anyOf rather than `type: [...]`; the
          // structured-output schema subset supports the former.
          sourceUrl: { anyOf: [{ type: "string" }, { type: "null" }] },
          confidence: {
            anyOf: [{ type: "string", enum: ["high", "medium", "low"] }, { type: "null" }],
          },
        },
      },
    },
  },
};

interface RawFinding {
  field?: unknown;
  kind?: unknown;
  value?: unknown;
  sourceUrl?: unknown;
  confidence?: unknown;
}

export const researchCompany: LLMTask<ResearchCompanyInput, CompanyUnderstanding> = {
  name: "research_company",
  prompt: PROMPT,
  schema: SCHEMA,
  // Generous, because adaptive thinking and the response share this budget on
  // Opus 5 and a truncated answer costs a full re-run. Streaming means the
  // ceiling costs nothing when it is not used.
  maxTokens: 32_000,

  renderInput: (input) => {
    const { url } = normalizeUrl(input.url);
    return [
      `Research this company: ${url}`,
      "",
      wrapUntrusted("URL supplied by the user", url),
    ].join("\n");
  },

  fetchDomains: (input) => normalizeUrl(input.url).fetchDomains,

  // The company row does not exist yet at research time — resolution (§59) is
  // a later step — so the run is attributed to the entity *type* only.
  entity: () => ({ type: "company", id: null }),

  parse: (json, input) => {
    const { url, canonicalDomain } = normalizeUrl(input.url);
    if (!json || typeof json !== "object") {
      throw new Error("research_company: response was not an object.");
    }
    const raw = json as { companyName?: unknown; findings?: unknown };

    const companyName =
      typeof raw.companyName === "string" && raw.companyName.trim()
        ? raw.companyName.trim()
        : canonicalDomain;

    if (!Array.isArray(raw.findings)) {
      throw new Error("research_company: response carried no findings array.");
    }

    const byField = new Map<ResearchField, ResearchFinding>();
    for (const item of raw.findings as RawFinding[]) {
      const field = item.field;
      if (typeof field !== "string" || !isResearchField(field)) {
        throw new Error(
          `research_company: unexpected field ${JSON.stringify(field)}.`,
        );
      }
      if (byField.has(field)) {
        // Two answers to one question is not something to silently pick from.
        throw new Error(`research_company: ${field} was answered twice.`);
      }

      const kind = item.kind;
      if (typeof kind !== "string" || !CLAIM_KINDS.includes(kind as ClaimKind)) {
        throw new Error(
          `research_company: ${field} has an unknown kind ${JSON.stringify(kind)}.`,
        );
      }

      const finding: ResearchFinding = {
        field,
        label: FIELD_LABELS[field],
        kind: kind as ClaimKind,
        value: typeof item.value === "string" ? item.value.trim() : "",
        sourceUrl: typeof item.sourceUrl === "string" && item.sourceUrl.trim()
          ? item.sourceUrl.trim()
          : null,
        confidence:
          typeof item.confidence === "string" &&
          ["high", "medium", "low"].includes(item.confidence)
            ? (item.confidence as Confidence)
            : null,
      };

      // §7, at the boundary. A fact with no URL never becomes a finding.
      assertValidClaim({
        kind: finding.kind,
        claim: finding.value,
        sourceUrl: finding.sourceUrl,
        confidence: finding.confidence,
      });

      byField.set(field, finding);
    }

    const missing = RESEARCH_FIELDS.filter((f) => !byField.has(f));
    if (missing.length) {
      // Not filled in with a synthesised `unknown`: that would put words in the
      // model's mouth about a question it never answered, and the whole point
      // of the kinds is that we can tell those apart.
      throw new Error(
        `research_company: no answer for ${missing.join(", ")}. Expected all ` +
          `${RESEARCH_FIELDS.length} fields, including unknowns.`,
      );
    }

    return {
      url,
      canonicalDomain,
      companyName,
      // Fixed order, so the review screen does not reshuffle between runs.
      findings: RESEARCH_FIELDS.map((f) => byField.get(f)!),
    };
  },
};

function isResearchField(value: string): value is ResearchField {
  return (RESEARCH_FIELDS as readonly string[]).includes(value);
}
