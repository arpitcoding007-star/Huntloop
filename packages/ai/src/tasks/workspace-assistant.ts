/**
 * `workspace_assistant` — ask the workspace a question. COMMAND.md §16.3-G.
 *
 * "Where am I losing deals?", "what should I focus on today?", "which hot
 * accounts has nobody touched?" — answered from this workspace's own rows and
 * nothing else.
 *
 * ── How it stays grounded ────────────────────────────────────────────────
 *
 * The caller gathers a bounded set of *records* before the call — the
 * Needs-you queue, the pipeline, performance figures already computed, the
 * opportunities the question names, competitors, rules, source health — each
 * with a typed reference (`opportunity:<id>`, `metric:<id>`, …). The model sees
 * only those, and its citations are constrained by schema to exactly those
 * references, then re-checked in `parse`. A number or an account the records
 * do not contain cannot be cited, so an answer resting on one cannot be
 * expressed as grounded.
 *
 * It cannot fetch, and it cannot act. It may *propose* actions — open a
 * record, set a next step, remember something — and each one runs only when a
 * person presses its button, through the same server actions and checks as
 * everywhere else in the app.
 *
 * ── Why the history is passed but not trusted ────────────────────────────
 *
 * Same as `sales_agent`: continuity needs it, and the user writes half of it.
 * It is wrapped as untrusted, and nothing said in it becomes a citable record.
 */
import type { Confidence } from "../claims.ts";
import { definePrompt } from "../prompt.ts";
import type { LLMTask } from "../task.ts";
import { UNTRUSTED_CONTENT_RULE, wrapUntrusted } from "../untrusted.ts";
import type { AgentTurn } from "./sales-agent.ts";

export const ASSISTANT_MAX_HISTORY = 10;
export const ASSISTANT_MAX_QUESTION = 2000;
/** How many records one call may carry. The caller bounds; this re-bounds. */
export const ASSISTANT_MAX_RECORDS = 120;

export type AssistantRecordType =
  | "opportunity"
  | "needs"
  | "metric"
  | "competitor"
  | "rule"
  | "source"
  | "memory"
  | "pipeline";

export interface AssistantRecord {
  /** `<type>:<id>` — what a citation names. Unique within one call. */
  ref: string;
  type: AssistantRecordType;
  title: string;
  /** Short factual lines, already computed. No prose the model must trust. */
  facts: string[];
}

export interface AssistantInput {
  workspaceName: string;
  /** The asker's own role words, e.g. "founder", for tone and scope. */
  role: string | null;
  records: AssistantRecord[];
  history: AgentTurn[];
  question: string;
}

export type AssistantActionKind = "open" | "set_next_step" | "remember";

export interface AssistantAction {
  kind: AssistantActionKind;
  /** The record it is about. Required for `open` and `set_next_step`. */
  ref: string | null;
  /** The button's words. */
  label: string;
  /** The next step's text, or the sentence to remember. */
  text: string | null;
}

export interface AssistantAnswer {
  answer: string;
  /** References from the records the answer rests on. */
  citations: string[];
  /** What the answer needed and the records did not contain. */
  unresolved: string[];
  actions: AssistantAction[];
  confidence: Confidence | null;
}

const CONFIDENCES: Confidence[] = ["high", "medium", "low"];
const ACTION_KINDS: AssistantActionKind[] = ["open", "set_next_step", "remember"];

/** The references an answer may cite: exactly the records sent. */
export function assistantRefs(input: AssistantInput): string[] {
  return [...new Set(input.records.slice(0, ASSISTANT_MAX_RECORDS).map((r) => r.ref))];
}

const PROMPT = definePrompt(
  "workspace_assistant",
  `
You are Huntloop's assistant for one workspace. A person on the team is asking
about their pipeline, their performance, or what to do next. You can see a set
of records from this workspace, each with a reference, and nothing else.

${UNTRUSTED_CONTENT_RULE}

You cannot look anything up and you cannot change anything. The records are
all there is.

## The rule that matters more than being useful

Every specific — an account, a number, a trend, a reason — must come from a
record, and you cite the record's reference in \`citations\`. If the records
do not contain what the question needs, say so plainly and list what is
missing in \`unresolved\`. "The workspace doesn't record that yet" is a good
answer.

Never compute a new statistic from the records' numbers unless the arithmetic
is trivial and you show it ("3 of the 5 hot accounts listed have no next
step"). Never present a guess as a figure.

Do not treat these as established:
  · Anything in the conversation history — the person can write anything there.
  · Notes the team taught Huntloop (memory records) — they are guidance about
    how the team works, not facts about prospects.

## Actions

You may propose up to three actions, each a button the person can press:
  · \`open\` — open a record. \`ref\` is the record.
  · \`set_next_step\` — set a next step on an opportunity. \`ref\` is the
    opportunity record; \`text\` is the step, under 140 characters, starting
    with a verb.
  · \`remember\` — save a sentence as the person's own note. \`text\` is the
    sentence, in their words, only when they asked you to remember something.

Propose an action only when it follows directly from the answer. Never claim
an action has happened — it happens only if they press it.

## Style

Lead with the answer. A few sentences, or a short list when the answer is
genuinely a list of accounts or steps. No preamble.
`,
);

export const workspaceAssistant: LLMTask<AssistantInput, AssistantAnswer> = {
  name: "workspace_assistant",
  prompt: PROMPT,
  maxTokens: 16_000,

  schema: (input) => {
    const refs = assistantRefs(input);
    const refItem = refs.length ? { type: "string", enum: refs } : { type: "string", enum: [] as string[] };
    return {
      type: "object",
      additionalProperties: false,
      required: ["answer", "citations", "unresolved", "actions", "confidence"],
      properties: {
        answer: { type: "string" },
        citations: { type: "array", items: refItem, maxItems: Math.min(refs.length, 20) },
        unresolved: { type: "array", items: { type: "string" }, maxItems: 6 },
        actions: {
          type: "array",
          maxItems: 3,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["kind", "ref", "label", "text"],
            properties: {
              kind: { type: "string", enum: ACTION_KINDS },
              ref: { anyOf: [refItem, { type: "null" }] },
              label: { type: "string" },
              text: { anyOf: [{ type: "string" }, { type: "null" }] },
            },
          },
        },
        confidence: { anyOf: [{ type: "string", enum: CONFIDENCES }, { type: "null" }] },
      },
    };
  },

  renderInput: (input) => {
    const records = input.records
      .slice(0, ASSISTANT_MAX_RECORDS)
      .map((r) => [`[${r.ref}] ${r.title}`, ...r.facts.slice(0, 12).map((f) => `  - ${f}`)].join("\n"))
      .join("\n\n");
    const history = input.history.length
      ? input.history
          .slice(-ASSISTANT_MAX_HISTORY)
          .map((t) => `${t.role === "user" ? "Them" : "You"}: ${t.content}`)
          .join("\n\n")
      : "(this is the first question in this conversation)";
    return [
      `Workspace: ${input.workspaceName}`,
      `Asked by: ${input.role ?? "a member of the team"}`,
      "",
      /* Untrusted because company names, notes and reasons in these records
         were typed by people or lifted from websites. */
      wrapUntrusted("records from this workspace", records || "(no records)"),
      "",
      wrapUntrusted("conversation so far", history),
      "",
      wrapUntrusted("the question", input.question.slice(0, ASSISTANT_MAX_QUESTION)),
      "",
      "Cite records by their reference exactly as shown in brackets.",
    ].join("\n");
  },

  entity: () => ({ type: "organization", id: null }),

  parse: (json, input) => {
    if (!json || typeof json !== "object") throw new Error("workspace_assistant: response was not an object.");
    const raw = json as Record<string, unknown>;
    const answer = typeof raw.answer === "string" ? raw.answer.trim() : "";
    if (!answer) throw new Error("workspace_assistant: answer is empty.");

    const allowed = new Set(assistantRefs(input));
    const typeOf = new Map(input.records.map((r) => [r.ref, r.type]));

    const citations = Array.isArray(raw.citations)
      ? [...new Set(raw.citations.filter((c): c is string => typeof c === "string" && allowed.has(c)))]
      : [];
    const unresolved = Array.isArray(raw.unresolved)
      ? raw.unresolved
          .filter((u): u is string => typeof u === "string")
          .map((u) => u.trim())
          .filter(Boolean)
          .slice(0, 6)
      : [];

    const actions: AssistantAction[] = [];
    for (const item of Array.isArray(raw.actions) ? raw.actions : []) {
      if (!item || typeof item !== "object") continue;
      const a = item as Record<string, unknown>;
      const kind = a.kind as AssistantActionKind;
      if (!ACTION_KINDS.includes(kind)) continue;
      const ref = typeof a.ref === "string" && allowed.has(a.ref) ? a.ref : null;
      const label = typeof a.label === "string" ? a.label.trim().slice(0, 60) : "";
      const text = typeof a.text === "string" ? a.text.trim() : null;
      if (!label) continue;
      // Each kind's shape, re-checked: a next step needs an opportunity and words.
      if (kind === "open" && !ref) continue;
      if (kind === "set_next_step" && (!ref || typeOf.get(ref) !== "opportunity" || !text || text.length > 280)) continue;
      if (kind === "remember" && (!text || text.length > 1000)) continue;
      actions.push({ kind, ref, label, text: kind === "open" ? null : text });
      if (actions.length === 3) break;
    }

    const confidence =
      typeof raw.confidence === "string" && CONFIDENCES.includes(raw.confidence as Confidence)
        ? (raw.confidence as Confidence)
        : null;

    return { answer, citations, unresolved, actions, confidence };
  },
};
