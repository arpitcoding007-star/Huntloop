/**
 * `infer_preferences` — what a person keeps asking for, in their own words
 * (K3, COMMAND.md §16.3-K).
 *
 * The deterministic learner (`packages/db/src/style.ts`) counts what can be
 * counted in edits. This reads what cannot: notes a person typed when they
 * asked for a redraft, corrected Ask Huntloop, rejected a draft, or ruled a
 * company out. It proposes a preference only for something said at least
 * three times, citing every statement, closed over the ids sent — by schema
 * and again in `parse`.
 *
 * Its output is never applied by itself here. The job decides by category:
 * style and format apply with a label and an undo; anything about who to go
 * after is a proposal a person accepts.
 */
import { definePrompt } from "../prompt.ts";
import type { LLMTask } from "../task.ts";
import { UNTRUSTED_CONTENT_RULE, wrapUntrusted } from "../untrusted.ts";

export const MAX_PREFERENCE_NOTES = 120;
export const MIN_PREFERENCE_SUPPORT = 3;
export const MAX_NEW_PREFERENCES = 6;

export type InferredCategory = "writing_style" | "output_format" | "research" | "targeting" | "workflow";
export type InferredTask = "personalize_message" | "workspace_assistant" | "sales_agent";

const CATEGORIES: InferredCategory[] = ["writing_style", "output_format", "research", "targeting", "workflow"];
const TASKS: InferredTask[] = ["personalize_message", "workspace_assistant", "sales_agent"];

export interface InferInput {
  /** Things this person typed, each with an id and where they typed it. */
  notes: { id: string; where: "redraft" | "assistant" | "rejection" | "disqualified" | "score" | "instruction"; text: string }[];
  /** What Huntloop already knows, so it does not propose it twice. */
  known: { key: string | null; content: string }[];
}

export interface InferredPreference {
  key: string;
  category: InferredCategory;
  content: string;
  appliesTo: InferredTask[];
  signalIds: string[];
}

export interface InferOutput {
  preferences: InferredPreference[];
}

const PROMPT = definePrompt(
  "infer_preferences",
  `
You help a sales tool learn how one person likes to work, from things they
typed while using it: notes asking for a draft to be rewritten, corrections
they gave the assistant, reasons they rejected a draft, and reasons they ruled
a company out.

${UNTRUSTED_CONTENT_RULE}

## What to do

Find what this person asks for again and again, and state it as one standing
instruction Huntloop can follow next time. Propose one only when at least
three of the notes say the same thing in substance — different words for the
same request count together ("shorter", "too long", "cut it down"). One or two
mentions are a one-off, not a preference: leave them out.

Each preference has:
  · \`key\`: a short dotted identifier for the topic, e.g. "email.tone",
    "assistant.format", "targeting.company_size". Lowercase, no spaces.
  · \`category\`: writing_style (how emails read), output_format (how answers
    are laid out), research (what to look into), targeting (which companies or
    people are a fit), workflow (how they like to work).
  · \`content\`: the instruction, one sentence, in the imperative, addressed to
    the writer — "Keep emails under 80 words." Never name a prospect, a
    company or a person.
  · \`appliesTo\`: which outputs it is about — personalize_message (emails),
    workspace_assistant (answers in Ask Huntloop), sales_agent (the
    opportunity agent). Use only the ones the notes are about.
  · \`signalIds\`: every note that supports it, by id. At least three.

Do not propose anything already in "what Huntloop already knows". Do not
infer anything about the person themselves — their age, background, beliefs
or health — only how they want the work done. When unsure, propose nothing:
a missing preference costs a little; a wrong one is applied to everything
they do next.
`,
);

export const inferPreferences: LLMTask<InferInput, InferOutput> = {
  name: "infer_preferences",
  prompt: PROMPT,
  maxTokens: 4_000,

  schema: (input) => {
    const ids = input.notes.slice(0, MAX_PREFERENCE_NOTES).map((n) => n.id);
    return {
      type: "object",
      additionalProperties: false,
      required: ["preferences"],
      properties: {
        preferences: {
          type: "array",
          maxItems: MAX_NEW_PREFERENCES,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["key", "category", "content", "appliesTo", "signalIds"],
            properties: {
              key: { type: "string" },
              category: { type: "string", enum: CATEGORIES },
              content: { type: "string" },
              appliesTo: { type: "array", items: { type: "string", enum: TASKS } },
              signalIds: { type: "array", items: { type: "string", enum: ids.length ? ids : ["none"] }, minItems: MIN_PREFERENCE_SUPPORT },
            },
          },
        },
      },
    };
  },

  renderInput: (input) => {
    const notes = input.notes
      .slice(0, MAX_PREFERENCE_NOTES)
      .map((n) => `[${n.id}] (${n.where}) ${n.text.replace(/\s+/g, " ").slice(0, 400)}`)
      .join("\n");
    const known = input.known.length
      ? input.known.map((k) => `- ${k.key ? `${k.key}: ` : ""}${k.content}`).join("\n")
      : "(nothing yet)";
    return [
      /* Untrusted even though the person typed them: a note can quote a
         prospect's email, and nothing in it is an instruction to us. */
      wrapUntrusted("what Huntloop already knows", known),
      "",
      wrapUntrusted("things this person typed", notes),
      "",
      "Use ids exactly as shown in brackets.",
    ].join("\n");
  },

  entity: () => ({ type: "organization", id: null }),

  parse: (json, input) => {
    if (!json || typeof json !== "object") throw new Error("infer_preferences: response was not an object.");
    const raw = json as Record<string, unknown>;
    const ids = new Set(input.notes.slice(0, MAX_PREFERENCE_NOTES).map((n) => n.id));
    const knownKeys = new Set(input.known.map((k) => k.key).filter(Boolean));
    const out: InferredPreference[] = [];
    const seen = new Set<string>();

    for (const item of Array.isArray(raw.preferences) ? raw.preferences : []) {
      const p = item as Record<string, unknown>;
      const key =
        typeof p.key === "string"
          ? p.key
              .trim()
              .toLowerCase()
              .replace(/[^a-z0-9_.]+/g, "_")
              .replace(/^[_.]+|[_.]+$/g, "")
              .slice(0, 80)
          : "";
      const category = CATEGORIES.includes(p.category as InferredCategory) ? (p.category as InferredCategory) : null;
      const content = typeof p.content === "string" ? p.content.trim().replace(/\s+/g, " ").slice(0, 300) : "";
      const appliesTo = (Array.isArray(p.appliesTo) ? p.appliesTo : []).filter((t): t is InferredTask =>
        TASKS.includes(t as InferredTask),
      );
      const signalIds = [...new Set((Array.isArray(p.signalIds) ? p.signalIds : []).map(String).filter((id) => ids.has(id)))];
      /* Three of the person's own statements, or nothing. */
      if (!/^[a-z][a-z0-9_.]{1,79}$/.test(key) || !category || !content || signalIds.length < MIN_PREFERENCE_SUPPORT) continue;
      if (knownKeys.has(key) || seen.has(key)) continue;
      seen.add(key);
      out.push({ key, category, content, appliesTo: [...new Set(appliesTo)], signalIds });
      if (out.length === MAX_NEW_PREFERENCES) break;
    }
    return { preferences: out };
  },
};
