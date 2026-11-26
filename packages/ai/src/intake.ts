/**
 * The questionnaire's deterministic half (build plan DN-43, exploration §4.2).
 *
 * The model decides *how* to ask; this file decides *what* is still needed
 * and *when to stop*. Keeping that out of the model is the design choice that
 * makes intake reliable: a model asked "do you have enough?" will sometimes
 * say yes with a required field empty, and the buyer's request then reaches
 * suppliers missing its quantity or delivery country.
 *
 * Pure and dependency-free, so the web app's plain-form fallback (no AI key,
 * or a refusal) asks the same questions in the same order as the chat.
 */

export type IntakeDirection = "buy" | "sell" | "partner";
export type FieldKind = "fact" | "inference" | "unknown";

export interface IntakeAttribute {
  key: string;
  label: string;
  type: string;
  required: boolean;
  options?: string[];
}

export interface KnownField {
  value: string | null;
  kind: FieldKind;
  /** Where it came from: the person's answer, their profile, or a skip. */
  source: "answer" | "profile" | "skipped";
}

export type Requirement = Record<string, KnownField>;

/** A buyer answers at most this many turns before the summary is shown. */
export const MAX_INTAKE_TURNS = 8;
/** Questions grouped into one turn (exploration §4.2: "small logical groups"). */
export const MAX_KEYS_PER_TURN = 3;

/** The attributes a category asks about: its own, or its parent's. */
export function attributesFor(
  own: unknown,
  parent: unknown,
): IntakeAttribute[] {
  const pick = (v: unknown): IntakeAttribute[] =>
    Array.isArray(v)
      ? v
          .filter((a): a is Record<string, unknown> => !!a && typeof a === "object")
          .filter((a) => typeof a.key === "string" && typeof a.label === "string")
          .map((a) => ({
            key: String(a.key),
            label: String(a.label),
            type: typeof a.type === "string" ? a.type : "text",
            required: a.required === true,
            options: Array.isArray(a.options) ? a.options.map(String) : undefined,
          }))
      : [];
  const mine = pick(own);
  return mine.length ? mine : pick(parent);
}

/** A field counts as answered when it has a value or was deliberately skipped. */
function settled(field: KnownField | undefined): boolean {
  return !!field && (field.value !== null || field.source === "skipped");
}

export interface Completeness {
  requiredMissing: string[];
  optionalMissing: string[];
  /** True when nothing required is open, or the turn cap was reached. */
  ready: boolean;
  /** Why it is ready, for the summary card's wording. */
  reason: "complete" | "turn_limit" | "incomplete";
}

export function completeness(
  attributes: IntakeAttribute[],
  known: Requirement,
  turns: number,
): Completeness {
  const requiredMissing = attributes.filter((a) => a.required && !settled(known[a.key])).map((a) => a.key);
  const optionalMissing = attributes.filter((a) => !a.required && !settled(known[a.key])).map((a) => a.key);
  if (requiredMissing.length === 0) return { requiredMissing, optionalMissing, ready: true, reason: "complete" };
  if (turns >= MAX_INTAKE_TURNS) return { requiredMissing, optionalMissing, ready: true, reason: "turn_limit" };
  return { requiredMissing, optionalMissing, ready: false, reason: "incomplete" };
}

/**
 * What to ask next: required fields first, then optional ones, at most
 * `MAX_KEYS_PER_TURN`. Optional fields are asked only once every required one
 * is settled, and the summary may be shown before any of them is — the
 * exploration's "allow skipping optional questions".
 */
export function nextKeys(attributes: IntakeAttribute[], known: Requirement): string[] {
  const open = attributes.filter((a) => !settled(known[a.key]));
  const required = open.filter((a) => a.required);
  const pool = required.length ? required : open;
  return pool.slice(0, MAX_KEYS_PER_TURN).map((a) => a.key);
}

/**
 * Merges one turn's extraction into the requirement. A person's answer
 * overrides a profile guess; a profile guess never overrides an answer; an
 * explicit skip settles the field as unknown.
 */
export function mergeTurn(
  known: Requirement,
  extracted: { key: string; value: string; kind: "fact" | "inference" }[],
  skipped: string[],
  attributes: IntakeAttribute[],
): Requirement {
  const keys = new Set(attributes.map((a) => a.key));
  const next: Requirement = { ...known };
  for (const e of extracted) {
    if (!keys.has(e.key)) continue;
    const current = next[e.key];
    if (current?.source === "answer" && e.kind === "inference") continue;
    next[e.key] = {
      value: e.value,
      kind: e.kind,
      source: e.kind === "fact" ? "answer" : "profile",
    };
  }
  for (const k of skipped) {
    if (!keys.has(k) || settled(next[k])) continue;
    next[k] = { value: null, kind: "unknown", source: "skipped" };
  }
  return next;
}
