import type { Completeness, IntakeAttribute, IntakeDirection, Requirement } from "@huntloop/ai";

/**
 * What the questionnaire screen holds between turns. Returned by every
 * intake Server Action, so it is plain data that crosses the boundary.
 *
 * `mode`:
 *   · chat — the model is asking; `question` is set unless `ready`.
 *   · form — no model (no key, a refusal, an outage, the budget): the same
 *     fields as a plain form. `notice` says why, in words a person can act on.
 *   · sell — the person is offering, not asking; the screen sends them to the
 *     supplier profile instead of filing a request.
 */
export interface IntakeState {
  sessionId: string | null;
  mode: "chat" | "form" | "sell";
  direction: IntakeDirection;
  summary: string;
  categoryId: string | null;
  categoryPath: string | null;
  attributes: IntakeAttribute[];
  known: Requirement;
  question: string | null;
  quickReplies: string[];
  /** The asked fields, so "Skip" settles exactly those. */
  askKeys: string[];
  ready: boolean;
  reason: Completeness["reason"];
  turns: number;
  notice: string | null;
  transcript: { role: "user" | "assistant"; text: string }[];
}

export interface NeedSubmission {
  sessionId: string | null;
  kind: "buy" | "partner";
  summary: string;
  categoryId: string | null;
  fields: Record<string, string>;
  country: string | null;
  currency: string | null;
  budgetMax: number | null;
  visibility: number;
}
