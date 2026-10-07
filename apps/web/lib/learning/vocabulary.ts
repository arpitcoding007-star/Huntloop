/**
 * The learning layer's words (K2, `0044`) — no dependencies, so the Settings →
 * You screen, the validation schemas and the server code all read one list.
 * Each set mirrors a CHECK in `0044`; the database is the last line.
 */

export const PREFERENCE_CATEGORY_VALUES = [
  "writing_style",
  "output_format",
  "research",
  "targeting",
  "workflow",
  "context",
  "interface",
] as const;

export type PreferenceCategoryValue = (typeof PREFERENCE_CATEGORY_VALUES)[number];

export const CATEGORY_LABELS: Record<PreferenceCategoryValue, string> = {
  writing_style: "Writing style",
  output_format: "How answers are laid out",
  research: "Research",
  targeting: "Who to go after",
  workflow: "How you work",
  context: "About you",
  interface: "The app",
};

/**
 * Categories whose learned conclusions are only ever *proposed*. Who to target
 * decides where money goes and who gets contacted, so a pattern Huntloop
 * noticed waits for a yes; style and format apply themselves, with undo.
 */
export const HIGH_RISK_CATEGORIES: readonly PreferenceCategoryValue[] = ["targeting"];

/** The tasks that read preferences, as a person would name them. */
export const PREFERENCE_TASKS = [
  { value: "personalize_message", label: "Emails Huntloop drafts" },
  { value: "workspace_assistant", label: "Ask Huntloop" },
  { value: "sales_agent", label: "The opportunity agent" },
] as const;

export type PreferenceTask = (typeof PREFERENCE_TASKS)[number]["value"];

export const PREFERENCE_TASK_VALUES = PREFERENCE_TASKS.map((t) => t.value) as [PreferenceTask, ...PreferenceTask[]];

/** What one observation was, in the past tense, for the evidence list. */
export function describeSignal(signal: {
  kind: string;
  note: string | null;
  features: Record<string, unknown>;
}): string {
  const f = signal.features;
  const before = typeof f.wordsBefore === "number" ? f.wordsBefore : null;
  const after = typeof f.wordsAfter === "number" ? f.wordsAfter : null;
  switch (signal.kind) {
    case "draft_edited":
      return before !== null && after !== null
        ? `You edited a draft from ${before} to ${after} words`
        : "You edited a draft";
    case "draft_rejected":
      return signal.note ? `You rejected a draft: "${signal.note}"` : "You rejected a draft";
    case "draft_regenerated":
      return signal.note ? `You asked for a redraft: "${signal.note}"` : "You asked for a redraft";
    case "assistant_correction":
      return signal.note ? `You told Ask Huntloop: "${signal.note}"` : "You corrected Ask Huntloop";
    case "score_override":
      return signal.note ? `You disagreed with a score: "${signal.note}"` : "You disagreed with a score";
    case "disqualified":
      return signal.note ? `You ruled a company out: "${signal.note}"` : "You ruled a company out";
    case "question_answered":
      return "You answered a question";
    case "applied_dismissed":
      return "You said not to use this on one output";
    case "task_instruction":
      return signal.note ? `You asked for: "${signal.note}"` : "You gave a one-off instruction";
    default:
      return "Something you did";
  }
}
