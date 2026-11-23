/**
 * `intake_classify` — "describe what you need" to a direction and a category
 * (build plan DN-42).
 *
 * Input: what the person typed, and the active categories as `{id, path}`.
 * Output: buy / sell / partner, one category id *from the list sent* or null,
 * and a one-line restatement.
 *
 * The category is closed over the ids sent, by schema and again in `parse`,
 * so the model cannot invent a category; "none fits" is a valid answer and
 * the need is then saved uncategorised, as stated (0060).
 */
import { CONFIDENCES, type Confidence } from "../claims.ts";
import type { IntakeDirection } from "../intake.ts";
import { definePrompt } from "../prompt.ts";
import type { LLMTask } from "../task.ts";
import { UNTRUSTED_CONTENT_RULE, wrapUntrusted } from "../untrusted.ts";

export const MAX_INTAKE_TEXT = 2_000;
export const MAX_INTAKE_CATEGORIES = 200;

export interface ClassifyIntakeInput {
  text: string;
  categories: { id: string; path: string }[];
}

export interface ClassifyIntakeOutput {
  direction: IntakeDirection;
  categoryId: string | null;
  confidence: Confidence;
  /** The need restated in one plain line, in the person's own terms. */
  summary: string;
}

const DIRECTIONS: IntakeDirection[] = ["buy", "sell", "partner"];

const PROMPT = definePrompt(
  "intake_classify",
  `
You sort a short request someone typed into a business discovery service.

Decide:
1. direction — "buy" if they want to find or purchase a product or service,
   "sell" if they want customers, buyers or leads for what they offer,
   "partner" if they want a business partner, distributor or collaborator.
2. categoryId — the single category from the list that best fits what is
   being bought, sold or partnered on. Use null when none genuinely fits;
   a wrong category sends the request to the wrong suppliers, which is worse
   than none.
3. confidence — high only when the request names the thing clearly.
4. summary — one line, at most 160 characters, restating the request in the
   person's own terms. Do not add details they did not give.

${UNTRUSTED_CONTENT_RULE}
`,
);

function schemaFor(input: ClassifyIntakeInput): Record<string, unknown> {
  const ids = input.categories.slice(0, MAX_INTAKE_CATEGORIES).map((c) => c.id);
  return {
    type: "object",
    additionalProperties: false,
    required: ["direction", "categoryId", "confidence", "summary"],
    properties: {
      direction: { type: "string", enum: DIRECTIONS },
      categoryId: { anyOf: [{ type: "string", enum: ids.length ? ids : ["none"] }, { type: "null" }] },
      confidence: { type: "string", enum: [...CONFIDENCES] },
      summary: { type: "string" },
    },
  };
}

export const classifyIntake: LLMTask<ClassifyIntakeInput, ClassifyIntakeOutput> = {
  name: "intake_classify",
  prompt: PROMPT,
  schema: schemaFor,
  maxTokens: 2_000,

  renderInput: (input) =>
    [
      "Categories (id — path):",
      ...input.categories.slice(0, MAX_INTAKE_CATEGORIES).map((c) => `${c.id} — ${c.path}`),
      "",
      wrapUntrusted("the request", input.text.slice(0, MAX_INTAKE_TEXT)),
    ].join("\n"),

  entity: () => ({ type: "exchange_intake", id: null }),

  parse: (json, input) => {
    if (!json || typeof json !== "object") throw new Error("intake_classify: response was not an object.");
    const raw = json as Record<string, unknown>;

    const direction = raw.direction;
    if (typeof direction !== "string" || !DIRECTIONS.includes(direction as IntakeDirection)) {
      throw new Error(`intake_classify: ${JSON.stringify(direction)} is not a direction.`);
    }
    const confidence = raw.confidence;
    if (typeof confidence !== "string" || !CONFIDENCES.includes(confidence as Confidence)) {
      throw new Error(`intake_classify: ${JSON.stringify(confidence)} is not a confidence.`);
    }
    const ids = new Set(input.categories.map((c) => c.id));
    const categoryId =
      typeof raw.categoryId === "string" && ids.has(raw.categoryId) ? raw.categoryId : null;
    const summary = typeof raw.summary === "string" ? raw.summary.trim().replace(/\s+/g, " ").slice(0, 160) : "";
    if (!summary) throw new Error("intake_classify: no summary.");

    return {
      direction: direction as IntakeDirection,
      categoryId,
      /* A guess at the category is never "high" when there is none to be
         sure about. */
      confidence: categoryId ? (confidence as Confidence) : "low",
      summary,
    };
  },
};
