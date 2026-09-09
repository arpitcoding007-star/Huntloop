/**
 * `research_competitor` — read a competitor's own site and report what it
 * actually establishes.
 *
 * ── Why this task is stricter than `research_company` ────────────────────
 *
 * `research_company` reads the *customer's* site to understand what they
 * sell. A wrong answer there is a wrong field on a screen the customer can
 * correct, about themselves.
 *
 * This reads a *third party's* site, and its output becomes sentences a
 * salesperson repeats out loud, to a prospect, about a named company that is
 * not in the room. A hallucinated weakness — "they have no SOC 2", "their
 * pricing jumps at 50 seats" — is a false statement about another business,
 * made by a person who believed it because this system told them.
 *
 * So three things are tightened:
 *
 *   1. **Weaknesses require a first-party source.** Not a review site, not an
 *      inference from what a page does not mention. A competitor's site not
 *      mentioning a feature is not evidence the feature is absent, and that
 *      is the single most tempting bad inference available here.
 *   2. **Every field may be UNKNOWN, and the prompt asks for it by name.** A
 *      model that learns guessing scores better will guess.
 *   3. **Pricing is fact-or-nothing.** "Probably enterprise-priced" is worse
 *      than silence: it is the kind of claim a salesperson will state as
 *      given, and it is unfalsifiable.
 *
 * ── What it is deliberately not asked ────────────────────────────────────
 *
 * "Who wins" and "how do we beat them". Those are positioning, they belong to
 * the customer, and `competitors.our_advantage` is a column a person fills
 * in. A model asked to compare two products it has only read the marketing
 * for will produce a confident comparison of two marketing pages.
 */
import { assertValidClaim, type ClaimKind, type Confidence } from "../claims.ts";
import { definePrompt } from "../prompt.ts";
import type { LLMTask } from "../task.ts";
import { UNTRUSTED_CONTENT_RULE, wrapUntrusted } from "../untrusted.ts";
import { normalizeUrl } from "../url.ts";

/**
 * The questions asked of a competitor's site. A closed set, and each one is
 * something a salesperson uses in a specific moment.
 */
export const COMPETITOR_FIELDS = [
  "positioning",
  "value_prop",
  "target_markets",
  "products",
  "differentiators",
  "pricing_model",
  "customer_examples",
  "strengths",
] as const;

export type CompetitorField = (typeof COMPETITOR_FIELDS)[number];

export const COMPETITOR_FIELD_LABELS: Record<CompetitorField, string> = {
  positioning: "How they position themselves",
  value_prop: "Their headline promise",
  target_markets: "Who they say they sell to",
  products: "What they sell",
  differentiators: "What they claim sets them apart",
  pricing_model: "How they charge",
  customer_examples: "Customers they name",
  strengths: "What they demonstrably do well",
};

export function isCompetitorField(value: string): value is CompetitorField {
  return (COMPETITOR_FIELDS as readonly string[]).includes(value);
}

export interface CompetitorFinding {
  field: CompetitorField;
  kind: ClaimKind;
  value: string;
  sourceUrl: string | null;
  confidence: Confidence | null;
}

export interface CompetitorProfile {
  competitorName: string;
  findings: CompetitorFinding[];
}

export interface ResearchCompetitorInput {
  url: string;
  /** The name the customer knows them by, which may differ from the site's. */
  knownAs: string | null;
}

const PROMPT = definePrompt(
  "research_competitor",
  `
You are reading a company's own website to describe how they present
themselves to the market. The person reading your answer sells against this
company and will repeat what you write to their prospects.

${UNTRUSTED_CONTENT_RULE}

## What you are answering

- positioning        The category they place themselves in, in their words.
- value_prop         The single promise their homepage leads with.
- target_markets     Who they say they sell to. Segments, industries, sizes.
- products           What they sell, as named offerings.
- differentiators    What they claim sets them apart. Their claim, labelled.
- pricing_model      How they charge, only if a pricing page says so.
- customer_examples  Customers they name publicly on their own site.
- strengths          What the site demonstrates rather than asserts — a
                     published certification, a documented integration count,
                     a named enterprise customer.

## The rules that matter most here

**This is a third party.** What you write becomes sentences a salesperson says
out loud to a prospect about a company that is not present to correct them. A
wrong claim here is not a wrong field on a screen; it is a false statement
about another business.

**Marketing copy is a claim, not a fact.** "The fastest platform in its
category" is something the site says about itself. Report it as
kind=inference and phrase it as their claim: "They position themselves as the
fastest in the category." Never restate it as though it were established.

**Absence is not evidence.** A site that does not mention SOC 2 is not a site
that establishes they lack it. If you did not read it, the answer is unknown.

**Pricing is fact-or-nothing.** If a pricing page states the model, report it
with the URL. If there is no pricing page, the answer is unknown. Never infer
a price point, a tier structure, or that they are "enterprise-priced" from the
absence of published pricing.

**unknown is a correct answer**, and for several of these fields it is the
expected one. A site with no customer logos genuinely has no customer_examples
to report. Do not reach for an adjacent fact and present it as the answer.

## What you are NOT asked

Do not say who is better, do not compare them to anyone, and do not suggest
how to sell against them. You are reading one website. The person reading your
answer knows their own product and you do not.

## Style

One plain sentence per finding, in the register a salesperson would use.
Specific beats broad: "Charges per seat with a 10-seat minimum, published"
beats "has seat-based pricing". For competitorName, give the company's own
name for itself.
`,
);

const CLAIM_KINDS: ClaimKind[] = ["fact", "inference", "unknown"];

const SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["competitorName", "findings"],
  properties: {
    competitorName: { type: "string" },
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["field", "kind", "value", "sourceUrl", "confidence"],
        properties: {
          field: { type: "string", enum: [...COMPETITOR_FIELDS] },
          kind: { type: "string", enum: CLAIM_KINDS },
          value: { type: "string" },
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

export const researchCompetitor: LLMTask<ResearchCompetitorInput, CompetitorProfile> = {
  name: "research_competitor",
  prompt: PROMPT,
  schema: SCHEMA,
  maxTokens: 24_000,

  renderInput: (input) => {
    const { url } = normalizeUrl(input.url);
    const lines = [
      `Read this company's website and describe how they present themselves: ${url}`,
      "",
      wrapUntrusted("URL supplied by the user", url),
    ];
    if (input.knownAs) {
      lines.push(
        "",
        wrapUntrusted("The name our customer knows them by", input.knownAs),
        "",
        "Use the company's own name for itself in competitorName, even if it " +
          "differs from the name above.",
      );
    }
    return lines.join("\n");
  },

  fetchDomains: (input) => normalizeUrl(input.url).fetchDomains,

  entity: () => ({ type: "competitor", id: null }),

  parse: (json, input) => {
    const { canonicalDomain } = normalizeUrl(input.url);
    if (!json || typeof json !== "object") {
      throw new Error("research_competitor: response was not an object.");
    }
    const raw = json as { competitorName?: unknown; findings?: unknown };

    const competitorName =
      typeof raw.competitorName === "string" && raw.competitorName.trim()
        ? raw.competitorName.trim()
        : (input.knownAs ?? canonicalDomain);

    if (!Array.isArray(raw.findings)) {
      throw new Error("research_competitor: response carried no findings array.");
    }

    const byField = new Map<CompetitorField, CompetitorFinding>();

    for (const item of raw.findings as RawFinding[]) {
      const field = item.field;
      if (typeof field !== "string" || !isCompetitorField(field)) {
        throw new Error(`research_competitor: unexpected field ${JSON.stringify(field)}.`);
      }
      if (byField.has(field)) {
        throw new Error(`research_competitor: ${field} was answered twice.`);
      }

      const kind = item.kind;
      if (typeof kind !== "string" || !CLAIM_KINDS.includes(kind as ClaimKind)) {
        throw new Error(
          `research_competitor: ${field} has an unknown kind ${JSON.stringify(kind)}.`,
        );
      }

      const value = typeof item.value === "string" ? item.value.trim() : "";
      if (!value) {
        throw new Error(`research_competitor: ${field} has no value.`);
      }

      const sourceUrl =
        typeof item.sourceUrl === "string" && item.sourceUrl.trim()
          ? item.sourceUrl.trim()
          : null;
      const confidence =
        typeof item.confidence === "string" ? (item.confidence as Confidence) : null;

      const finding: CompetitorFinding = {
        field: field as CompetitorField,
        kind: kind as ClaimKind,
        value,
        sourceUrl,
        confidence,
      };

      /* The shared §7 check: a fact needs a source, an unknown carries no
         confidence. Re-run here as well as in the schema because the schema
         constrains *shape* and this constrains *meaning* — and the meaning is
         what `evidence`'s CHECK constraints will enforce one layer down. */
      assertValidClaim({
        kind: finding.kind,
        claim: finding.value,
        sourceUrl: finding.sourceUrl,
        confidence: finding.confidence,
      });

      /* The task-specific rule, and the reason this task exists separately
         from `research_company`.

         `pricing_model` may only be a fact. An inference about a competitor's
         pricing is unfalsifiable, is the claim a salesperson is most likely
         to state as given, and is the one a prospect is most likely to check.
         Degraded rather than rejected: the finding is still worth keeping as
         "we looked and could not tell", and rejecting the whole response
         because one field over-reached would throw away seven good ones. */
      if (finding.field === "pricing_model" && finding.kind === "inference") {
        byField.set(field as CompetitorField, {
          field: "pricing_model",
          kind: "unknown",
          value:
            "No published pricing was found. The model inferred one, which is " +
            "not reliable enough to repeat: " +
            value,
          sourceUrl: null,
          confidence: null,
        });
        continue;
      }

      /* `strengths` must rest on something the site demonstrates. An inferred
         strength is marketing copy with a compliment attached. */
      if (finding.field === "strengths" && finding.kind === "fact" && !finding.sourceUrl) {
        throw new Error("research_competitor: a strength stated as fact must cite a page.");
      }

      byField.set(field as CompetitorField, finding);
    }

    return { competitorName, findings: [...byField.values()] };
  },
};
