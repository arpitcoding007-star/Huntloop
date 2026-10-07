/**
 * The questions Huntloop may ask, and only these (K4, COMMAND.md §16.3-K).
 *
 * A typed catalog rather than questions a model makes up: each one has a
 * reason to exist (an output it improves), a place it is asked (the surface
 * where the answer matters), a way to know it is already answered, and a
 * fixed translation of the answer into a stated preference. That is what
 * keeps the product from interrogating people, and what makes it testable.
 *
 * No dependencies: the planner, the server loader and the card all read it.
 */

export type QuestionSurface = "dashboard" | "inbox" | "assistant" | "analyze";

export interface QuestionContext {
  /** Keys of the person's own memories (any status but deleted). */
  memoryKeys: ReadonlySet<string>;
  workspaceKind: "company" | "personal";
  hasProduct: boolean;
  hasIcp: boolean;
}

export interface QuestionChoice {
  value: string;
  label: string;
  /** The preference this choice becomes; null = answered, nothing to store. */
  preference: string | null;
}

export interface Question {
  key: string;
  surfaces: QuestionSurface[];
  ask: string;
  /** Why it is being asked — always shown. */
  why: string;
  input: { kind: "text"; placeholder: string; maxLength: number } | { kind: "choice"; choices: QuestionChoice[] };
  /** Already known, or not relevant here: do not ask. */
  skipIf: (ctx: QuestionContext) => boolean;
  writes: {
    key: string;
    category: "writing_style" | "output_format" | "research" | "context" | "workflow";
    appliesTo: string[];
    /** For a text answer. */
    template?: (answer: string) => string;
  };
}

export const QUESTIONS: readonly Question[] = [
  {
    key: "outreach.signoff",
    surfaces: ["inbox"],
    ask: "How do you sign your emails?",
    why: "So drafts end the way you would end them, and you stop fixing the last line.",
    input: { kind: "text", placeholder: "Cheers,\nAlex", maxLength: 80 },
    skipIf: (c) => c.memoryKeys.has("email.signoff"),
    writes: {
      key: "email.signoff",
      category: "writing_style",
      appliesTo: ["personalize_message"],
      template: (a) => `Sign off exactly as: "${a.replace(/\s+/g, " ").trim()}".`,
    },
  },
  {
    key: "outreach.length",
    surfaces: ["inbox"],
    ask: "How long should a first email be?",
    why: "Length is the edit people make most. Telling Huntloop once saves trimming every draft.",
    input: {
      kind: "choice",
      choices: [
        { value: "short", label: "Short — under 80 words", preference: "Keep emails under 80 words." },
        { value: "medium", label: "Medium — 80 to 150 words", preference: "Keep emails between 80 and 150 words." },
        { value: "any", label: "Whatever the message needs", preference: null },
      ],
    },
    skipIf: (c) => c.memoryKeys.has("email.length"),
    writes: { key: "email.length", category: "writing_style", appliesTo: ["personalize_message"] },
  },
  {
    key: "assistant.format",
    surfaces: ["assistant"],
    ask: "How do you like answers laid out?",
    why: "Ask Huntloop will answer that way from now on. You can still ask for anything else in the moment.",
    input: {
      kind: "choice",
      choices: [
        { value: "lead", label: "The answer first, then the detail", preference: "Lead with a one-sentence answer, then the detail." },
        { value: "bullets", label: "Short bullet points", preference: "Answer in short bullet points." },
        { value: "table", label: "A table whenever there are numbers", preference: "Use a table whenever the answer compares numbers." },
      ],
    },
    skipIf: (c) => c.memoryKeys.has("assistant.format"),
    writes: { key: "assistant.format", category: "output_format", appliesTo: ["workspace_assistant"] },
  },
  {
    key: "research.focus",
    surfaces: ["analyze"],
    ask: "When you look into a company, what matters most to you?",
    why: "So Huntloop leads with it — in the opportunity agent and in Ask Huntloop.",
    input: { kind: "text", placeholder: "Recent funding, who they're hiring, and what they use today", maxLength: 300 },
    skipIf: (c) => c.memoryKeys.has("research.focus"),
    writes: {
      key: "research.focus",
      category: "research",
      appliesTo: ["sales_agent", "workspace_assistant"],
      template: (a) => `When describing a company, lead with: ${a.trim()}.`,
    },
  },
  {
    key: "context.offer",
    surfaces: ["dashboard"],
    ask: "In a sentence, what do you sell — or what are you working on?",
    why: "Huntloop hasn't been told yet. It uses this to judge what matters in research and answers, without setting up a full profile.",
    input: { kind: "text", placeholder: "Payroll software for restaurants in the UK", maxLength: 300 },
    skipIf: (c) => c.hasProduct || c.memoryKeys.has("context.offer"),
    writes: {
      key: "context.offer",
      category: "context",
      appliesTo: [],
      template: (a) => `What I sell or work on: ${a.trim()}`,
    },
  },
  {
    key: "context.focus",
    surfaces: ["dashboard"],
    ask: "What are you focused on this quarter?",
    why: "So answers and suggestions point at what you are actually trying to do.",
    input: { kind: "text", placeholder: "Twenty meetings with fintechs in Germany", maxLength: 300 },
    skipIf: (c) => c.memoryKeys.has("context.focus"),
    writes: {
      key: "context.focus",
      category: "context",
      appliesTo: ["workspace_assistant", "sales_agent"],
      template: (a) => `What I'm focused on right now: ${a.trim()}`,
    },
  },
];

export function questionByKey(key: string): Question | undefined {
  return QUESTIONS.find((q) => q.key === key);
}
