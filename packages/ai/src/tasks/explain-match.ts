/**
 * `explain_match` — the model half of Exchange matching (build plan DN-44,
 * marketplace spec §9).
 *
 * Code has already decided who is a candidate and scored the measurable
 * dimensions (category, place, budget, quantity, availability, trust). This
 * task does the two things code cannot:
 *
 *   1. For each of the buyer's must-haves, says which piece of the supplier's
 *      published evidence backs it, if any — citing evidence ids from a
 *      closed set. That becomes the `requirement` dimension, computed in code
 *      from the citations, never a number the model picks.
 *   2. Writes one plain sentence on why the offering fits or falls short,
 *      from the text it was given.
 *
 * Offering ids and evidence ids are closed by schema and again in `parse`,
 * so a fabricated supplier or citation is unrepresentable. Every text field
 * from the buyer or the supplier is untrusted.
 */
import { definePrompt } from "../prompt.ts";
import type { LLMTask } from "../task.ts";
import { UNTRUSTED_CONTENT_RULE, wrapUntrusted } from "../untrusted.ts";

export const MAX_EXPLAIN_CANDIDATES = 20;
export const MAX_MUST_HAVES = 8;
export const MAX_EVIDENCE_PER_CANDIDATE = 8;
export const MAX_REASON_CHARS = 240;

export interface ExplainEvidence {
  id: string;
  claim: string;
  kind: "fact" | "inference" | "unknown";
  sourceUrl: string | null;
}

export interface ExplainMatchInput {
  needId: string;
  need: {
    summary: string;
    categoryPath: string | null;
    /** What the buyer confirmed, as label → value. Unknowns are left out. */
    facts: { label: string; value: string }[];
    mustHaves: string[];
  };
  candidates: {
    offeringId: string;
    title: string;
    description: string | null;
    provider: string;
    evidence: ExplainEvidence[];
  }[];
}

export interface ExplainedCandidate {
  offeringId: string;
  reason: string;
  /** One entry per must-have the model judged: the evidence that backs it, or null. */
  backing: { mustHave: string; evidenceId: string | null }[];
}

export interface ExplainMatchOutput {
  candidates: ExplainedCandidate[];
}

const PROMPT = definePrompt(
  "explain_match",
  `
You check how well suppliers' offerings fit one buyer's request on a business
exchange. A program has already filtered and scored location, budget, quantity,
availability and trust; do not repeat those judgements.

For every candidate:
1. backing — for each of the buyer's must-haves, the id of the one evidence
   item of THAT candidate which shows the offering meets it, or null when none
   of its evidence does. An offering's own title or description is not
   evidence. Never cite another candidate's evidence.
2. reason — one sentence, at most 200 characters, on why this offering fits
   or falls short of the request, using only the text given. Say plainly what
   is not known. Do not invent prices, stock, certifications or locations.

Return every candidate exactly once.

${UNTRUSTED_CONTENT_RULE}
`,
);

function candidatesOf(input: ExplainMatchInput) {
  return input.candidates.slice(0, MAX_EXPLAIN_CANDIDATES);
}

function mustHavesOf(input: ExplainMatchInput) {
  return input.need.mustHaves.slice(0, MAX_MUST_HAVES);
}

function schemaFor(input: ExplainMatchInput): Record<string, unknown> {
  const ids = candidatesOf(input).map((c) => c.offeringId);
  const evidenceIds = candidatesOf(input).flatMap((c) => c.evidence.slice(0, MAX_EVIDENCE_PER_CANDIDATE).map((e) => e.id));
  const mustHaves = mustHavesOf(input);
  return {
    type: "object",
    additionalProperties: false,
    required: ["candidates"],
    properties: {
      candidates: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["offeringId", "reason", "backing"],
          properties: {
            offeringId: { type: "string", enum: ids.length ? ids : ["none"] },
            reason: { type: "string" },
            backing: mustHaves.length
              ? {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["mustHave", "evidenceId"],
                    properties: {
                      mustHave: { type: "string", enum: mustHaves },
                      evidenceId: evidenceIds.length
                        ? { anyOf: [{ type: "string", enum: evidenceIds }, { type: "null" }] }
                        : { type: "null" },
                    },
                  },
                }
              : { type: "array", maxItems: 0, items: { type: "object" } },
          },
        },
      },
    },
  };
}

export const explainMatch: LLMTask<ExplainMatchInput, ExplainMatchOutput> = {
  name: "explain_match",
  prompt: PROMPT,
  schema: schemaFor,
  maxTokens: 6_000,

  renderInput: (input) => {
    const need = [
      `Category: ${input.need.categoryPath ?? "uncategorised"}`,
      ...input.need.facts.map((f) => `${f.label}: ${f.value}`),
      `Must-haves: ${mustHavesOf(input).length ? mustHavesOf(input).join(" | ") : "none stated"}`,
    ].join("\n");
    const blocks = candidatesOf(input).map((c) => {
      const evidence = c.evidence.slice(0, MAX_EVIDENCE_PER_CANDIDATE);
      const text = [
        `title: ${c.title}`,
        c.description ? `description: ${c.description.slice(0, 1_500)}` : null,
        `supplier: ${c.provider}`,
        evidence.length
          ? "evidence:\n" +
            evidence.map((e) => `- id ${e.id} (${e.kind}): ${e.claim}${e.sourceUrl ? ` [${e.sourceUrl}]` : ""}`).join("\n")
          : "evidence: none published",
      ]
        .filter(Boolean)
        .join("\n");
      return `Candidate ${c.offeringId}\n${wrapUntrusted("the offering", text)}`;
    });
    return [
      wrapUntrusted("the buyer's request", `${input.need.summary.slice(0, 500)}\n${need}`),
      "",
      ...blocks,
    ].join("\n");
  },

  entity: (input) => ({ type: "exchange_need", id: input.needId }),

  parse: (json, input) => {
    if (!json || typeof json !== "object") throw new Error("explain_match: response was not an object.");
    const raw = (json as { candidates?: unknown }).candidates;
    if (!Array.isArray(raw)) throw new Error("explain_match: no candidates array.");

    const byId = new Map(candidatesOf(input).map((c) => [c.offeringId, c]));
    const mustHaves = new Set(mustHavesOf(input));
    const seen = new Set<string>();
    const out: ExplainedCandidate[] = [];

    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const r = item as Record<string, unknown>;
      const id = typeof r.offeringId === "string" ? r.offeringId : "";
      const candidate = byId.get(id);
      if (!candidate || seen.has(id)) continue;
      seen.add(id);
      const own = new Set(candidate.evidence.slice(0, MAX_EVIDENCE_PER_CANDIDATE).map((e) => e.id));
      const judged = new Set<string>();
      const backing: ExplainedCandidate["backing"] = [];
      for (const b of Array.isArray(r.backing) ? r.backing : []) {
        if (!b || typeof b !== "object") continue;
        const m = (b as Record<string, unknown>).mustHave;
        const e = (b as Record<string, unknown>).evidenceId;
        if (typeof m !== "string" || !mustHaves.has(m) || judged.has(m)) continue;
        judged.add(m);
        /* Another candidate's evidence is a citation this offering does not
           have: read it as "not backed", never as backed. */
        backing.push({ mustHave: m, evidenceId: typeof e === "string" && own.has(e) ? e : null });
      }
      const reason =
        typeof r.reason === "string" ? r.reason.trim().replace(/\s+/g, " ").slice(0, MAX_REASON_CHARS) : "";
      out.push({ offeringId: id, reason, backing });
    }
    return { candidates: out };
  },
};

/**
 * The `requirement` dimension from the model's citations, in code: the share
 * of must-haves backed by evidence. UNKNOWN (null) when the buyer stated no
 * must-haves, or the supplier published no evidence to judge against.
 */
export function requirementFit(mustHaves: number, evidence: number, backing: ExplainedCandidate["backing"]): number | null {
  if (mustHaves === 0 || evidence === 0) return null;
  const backed = backing.filter((b) => b.evidenceId !== null).length;
  return Math.round((backed / mustHaves) * 100);
}
