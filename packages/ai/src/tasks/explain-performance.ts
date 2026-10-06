/**
 * `explain_performance` — a short narrative over figures Huntloop already
 * computed. COMMAND.md §16.3-E.
 *
 * ── What this task may and may not do ────────────────────────────────────
 *
 * The Performance screen's numbers, and the insights that interpret them, are
 * computed deterministically (`apps/web/lib/performance/compute.ts`). This task
 * does not touch either. It is given those results as a closed list of FACTS,
 * each with an id, and asked to say in a few sentences what they add up to and
 * what is worth doing — the paragraph a manager would otherwise write for a
 * weekly update.
 *
 * Three rules make it safe to show:
 *
 *   1. Every sentence cites fact ids, from a schema enum built from the facts
 *      that were sent. A sentence about something not in the list cannot be
 *      expressed.
 *   2. **Every number in a sentence must appear in one of the facts it cites.**
 *      Checked in `parse`, after the schema. The model may connect figures; it
 *      may not produce one. "Reply rate doubled" when the facts say 6% and 12%
 *      is allowed only if a cited fact states the doubling.
 *   3. Suggestions are labelled as suggestions, cite facts too, and are never
 *      applied — the screen renders them as text a person may act on.
 *
 * With fewer than two facts there is nothing to connect, and the task refuses
 * before spending a call.
 */
import { definePrompt } from "../prompt.ts";
import type { LLMTask } from "../task.ts";
import { UNTRUSTED_CONTENT_RULE, wrapUntrusted } from "../untrusted.ts";

export interface PerformanceFact {
  /** Stable within one call, e.g. "f3". */
  id: string;
  /** One sentence, with its numbers, written by Huntloop — not by a model. */
  text: string;
}

export interface ExplainPerformanceInput {
  periodLabel: string;
  facts: PerformanceFact[];
}

export interface NarrativeLine {
  text: string;
  factIds: string[];
}

export interface PerformanceNarrative {
  summary: NarrativeLine[];
  suggestions: NarrativeLine[];
}

export const MAX_FACTS = 24;

const PROMPT = definePrompt(
  "explain_performance",
  `
You write the short summary at the top of a sales team's performance report.

${UNTRUSTED_CONTENT_RULE}

You are given FACTS that Huntloop computed from the team's own records. They
are the only thing you know. You cannot look anything up.

Write:
  · summary — two to four sentences on what the period adds up to, most
    important first. Connect facts; do not restate them one by one.
  · suggestions — up to three concrete next moves the facts justify. A
    suggestion is a recommendation, not a fact; write it as one ("Consider…",
    "Try…"). If the facts justify none, return an empty list.

Rules you must follow:
  · Cite, for every sentence, the ids of the facts it rests on.
  · Use a number only if it appears in a fact you cite. Do not compute new
    figures, percentages or ratios.
  · If the facts say the data is too thin to compare groups, say that plainly
    and do not draw conclusions about groups.
  · No praise, no filler, no exclamation marks. Write for a busy founder.
`.trim(),
);

/** Every run of digits (with decimals and %), as written. */
function numbersIn(text: string): string[] {
  return (text.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(",", "."));
}

export const explainPerformance: LLMTask<ExplainPerformanceInput, PerformanceNarrative> = {
  name: "explain_performance",
  prompt: PROMPT,
  maxTokens: 900,

  schema: (input) => {
    if (input.facts.length < 2) {
      throw new Error("explain_performance: fewer than two facts — there is nothing to connect.");
    }
    const ids = input.facts.map((f) => f.id);
    const line = {
      type: "object",
      additionalProperties: false,
      required: ["text", "factIds"],
      properties: {
        text: { type: "string" },
        factIds: { type: "array", items: { type: "string", enum: ids } },
      },
    };
    return {
      type: "object",
      additionalProperties: false,
      required: ["summary", "suggestions"],
      properties: {
        summary: { type: "array", items: line },
        suggestions: { type: "array", items: line },
      },
    };
  },

  renderInput: (input) =>
    [
      `Period: ${input.periodLabel}`,
      "",
      // Facts are built from company names and reasons people typed, so they
      // are wrapped like any other content the model must not take orders from.
      wrapUntrusted(
        "facts computed by Huntloop",
        input.facts.slice(0, MAX_FACTS).map((f) => `${f.id}: ${f.text}`).join("\n"),
      ),
    ].join("\n"),

  entity: () => ({ type: "organization", id: null }),

  parse: (json, input) => {
    if (!json || typeof json !== "object") throw new Error("explain_performance: response was not an object.");
    const raw = json as Record<string, unknown>;
    const byId = new Map(input.facts.map((f) => [f.id, f.text]));

    const lines = (value: unknown, field: string, max: number): NarrativeLine[] => {
      if (!Array.isArray(value)) throw new Error(`explain_performance: ${field} must be a list.`);
      return value.slice(0, max).map((item, i) => {
        const entry = item as Record<string, unknown>;
        const text = typeof entry.text === "string" ? entry.text.trim() : "";
        if (!text) throw new Error(`explain_performance: ${field}[${i}] is empty.`);
        const factIds = Array.isArray(entry.factIds)
          ? [...new Set(entry.factIds.filter((id): id is string => typeof id === "string"))]
          : [];
        if (factIds.length === 0) {
          throw new Error(`explain_performance: ${field}[${i}] cites no fact. Every sentence must rest on one.`);
        }
        for (const id of factIds) {
          if (!byId.has(id)) throw new Error(`explain_performance: ${field}[${i}] cites ${JSON.stringify(id)}, which was not sent.`);
        }
        // Rule 2: no number the cited facts do not contain.
        const allowed = new Set(factIds.flatMap((id) => numbersIn(byId.get(id)!)));
        for (const n of numbersIn(text)) {
          if (!allowed.has(n)) {
            throw new Error(
              `explain_performance: ${field}[${i}] states ${n}, which none of its cited facts contain. ` +
                "A narrative may connect figures; it may not produce them.",
            );
          }
        }
        return { text, factIds };
      });
    };

    const summary = lines(raw.summary, "summary", 4);
    if (summary.length === 0) throw new Error("explain_performance: the summary is empty.");
    return { summary, suggestions: lines(raw.suggestions, "suggestions", 3) };
  },
};
