/**
 * `intake_turn` — one turn of the Exchange questionnaire (build plan DN-43).
 *
 * Input: the category's attributes, what is known so far, the person's
 * profile as context, the keys the code wants asked next (`intake.ts`
 * `nextKeys`), and the person's last answer.
 *
 * Output: the values the last answer (or the profile) supplies, each tagged
 * fact or inference; the keys the person said to skip or is unsure about; and
 * the next question with up to six quick-reply chips.
 *
 * What this task does not decide: which fields are required, and when to
 * stop. Those are `intake.ts`, in code. Every key the model returns is closed
 * over the category's attributes, by schema and in `parse`.
 *
 * The fact/inference rule (spec §3 rule 1): a value the person stated is a
 * fact; a value read from their profile or inferred from wording is an
 * inference, and is shown to them as a suggestion to confirm.
 */
import type { IntakeAttribute, IntakeDirection, Requirement } from "../intake.ts";
import { definePrompt } from "../prompt.ts";
import type { LLMTask } from "../task.ts";
import { UNTRUSTED_CONTENT_RULE, wrapUntrusted } from "../untrusted.ts";

export const MAX_ANSWER_CHARS = 2_000;
export const MAX_QUICK_REPLIES = 6;
export const MAX_VALUE_CHARS = 300;

export interface IntakeTurnInput {
  direction: IntakeDirection;
  categoryName: string | null;
  summary: string;
  attributes: IntakeAttribute[];
  known: Requirement;
  /** Keys the code wants asked in this turn. */
  askKeys: string[];
  /** Plain lines about the person and their workspace. Untrusted. */
  profile: string[];
  /** What the person just typed, or null on the first turn. */
  lastAnswer: string | null;
}

export interface IntakeTurnOutput {
  extracted: { key: string; value: string; kind: "fact" | "inference" }[];
  skipped: string[];
  question: string;
  quickReplies: string[];
}

const PROMPT = definePrompt(
  "intake_turn",
  `
You run a short questionnaire that turns what someone needs into a precise
request a supplier or buyer can act on. You are given the fields that matter
for their category, what is already known, and which fields to ask about now.

Each turn, do three things:

1. Extract. From their last answer, fill any listed field it answers, even if
   that field was not the one asked. Use the field's key exactly. Keep values
   short and in their words ("200 units", "Frankfurt, Germany", "this quarter").
   kind "fact" = they said it. kind "inference" = you took it from their
   profile or read it between the lines; it will be shown to them to confirm.
   Never invent a value. If they did not say it and the profile does not say
   it, leave it out.
2. Skips. If they said to skip a field, or that they do not know or are not
   sure, list its key in "skipped".
3. Ask. Write one short, friendly question covering the keys in askKeys
   (grouping them naturally when there are several). Offer up to six
   quick-reply chips that answer it. Do not ask about anything already known.
   If askKeys is empty, ask them to confirm the summary instead.

Rules:
- Be brief. One or two sentences. No preamble, no praise.
- If a field has options, prefer them as chips.
- When they are unsure about a specification, ask once what they will use it
  for, rather than listing every variant.
- Never promise availability, prices, delivery dates or that a supplier exists.

${UNTRUSTED_CONTENT_RULE}
`,
);

function schemaFor(input: IntakeTurnInput): Record<string, unknown> {
  const keys = input.attributes.map((a) => a.key);
  const keyEnum = keys.length ? keys : ["none"];
  return {
    type: "object",
    additionalProperties: false,
    required: ["extracted", "skipped", "question", "quickReplies"],
    properties: {
      extracted: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["key", "value", "kind"],
          properties: {
            key: { type: "string", enum: keyEnum },
            value: { type: "string" },
            kind: { type: "string", enum: ["fact", "inference"] },
          },
        },
      },
      skipped: { type: "array", items: { type: "string", enum: keyEnum } },
      question: { type: "string" },
      quickReplies: { type: "array", items: { type: "string" } },
    },
  };
}

function describeKnown(input: IntakeTurnInput): string[] {
  return input.attributes.map((a) => {
    const k = input.known[a.key];
    const state = !k
      ? "not yet known"
      : k.value === null
        ? "skipped"
        : `${k.value} (${k.kind === "fact" ? "they said" : "suggested, unconfirmed"})`;
    const opts = a.options?.length ? ` · options: ${a.options.join(", ")}` : "";
    return `- ${a.key} — ${a.label}${a.required ? " (required)" : ""}${opts}: ${state}`;
  });
}

export const intakeTurn: LLMTask<IntakeTurnInput, IntakeTurnOutput> = {
  name: "intake_turn",
  prompt: PROMPT,
  schema: schemaFor,
  maxTokens: 2_000,

  renderInput: (input) =>
    [
      `Direction: ${input.direction}`,
      `Category: ${input.categoryName ?? "not chosen yet"}`,
      `Request so far: ${input.summary}`,
      "",
      "Fields:",
      ...describeKnown(input),
      "",
      `askKeys: ${input.askKeys.length ? input.askKeys.join(", ") : "(none — ask them to confirm)"}`,
      "",
      wrapUntrusted("their profile", input.profile.length ? input.profile.join("\n") : "(nothing on file)"),
      "",
      input.lastAnswer
        ? wrapUntrusted("their last answer", input.lastAnswer.slice(0, MAX_ANSWER_CHARS))
        : "(This is the first question.)",
    ].join("\n"),

  entity: () => ({ type: "exchange_intake", id: null }),

  parse: (json, input) => {
    if (!json || typeof json !== "object") throw new Error("intake_turn: response was not an object.");
    const raw = json as Record<string, unknown>;
    const keys = new Set(input.attributes.map((a) => a.key));

    const extracted: IntakeTurnOutput["extracted"] = [];
    const seen = new Set<string>();
    for (const item of Array.isArray(raw.extracted) ? raw.extracted : []) {
      if (!item || typeof item !== "object") continue;
      const e = item as Record<string, unknown>;
      const key = typeof e.key === "string" ? e.key : "";
      const value = typeof e.value === "string" ? e.value.trim().replace(/\s+/g, " ") : "";
      if (!keys.has(key) || !value || seen.has(key)) continue;
      seen.add(key);
      /* With no answer yet there is nothing they said: anything on the first
         turn came from the profile, so it is an inference whatever the model
         called it. */
      const kind = e.kind === "fact" && input.lastAnswer ? "fact" : "inference";
      extracted.push({ key, value: value.slice(0, MAX_VALUE_CHARS), kind });
    }

    const skipped = [
      ...new Set(
        (Array.isArray(raw.skipped) ? raw.skipped : [])
          .filter((k): k is string => typeof k === "string" && keys.has(k) && !seen.has(k)),
      ),
    ];

    const question = typeof raw.question === "string" ? raw.question.trim() : "";
    if (!question) throw new Error("intake_turn: no question.");

    const quickReplies = [
      ...new Set(
        (Array.isArray(raw.quickReplies) ? raw.quickReplies : [])
          .filter((r): r is string => typeof r === "string")
          .map((r) => r.trim())
          .filter((r) => r.length > 0 && r.length <= 60),
      ),
    ].slice(0, MAX_QUICK_REPLIES);

    return { extracted, skipped, question: question.slice(0, 400), quickReplies };
  },
};
