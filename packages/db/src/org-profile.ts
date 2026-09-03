/**
 * `organizations.settings`, given a shape.
 *
 * ── Why the column stayed opaque until now ───────────────────────────────
 *
 * `lib/data/organization.ts` says it plainly: nothing read a key out of
 * `settings`, and inventing a contract for a column no screen consumes is how
 * you end up with a shape the first real requirement contradicts. That was the
 * right call while it was true. It stopped being true when three things needed
 * org-level configuration at once — outreach tone, named competitors, and the
 * backlog cap `0010` added — and the alternative was three new columns on
 * `organizations` for values that are read once per message and never queried.
 *
 * So the shape is defined here, in one place, with a parser that treats every
 * key as optional and every malformed value as absent. Not in `apps/web`,
 * because the SQL in `0010` reads `settings -> 'engine' ->> 'backlogCap'` and
 * the job runner reads the voice block: three readers, one definition.
 *
 * ── The parsing rule ─────────────────────────────────────────────────────
 *
 * Never throw. A settings blob is written by a form and read by a scheduled
 * job that runs at three in the morning, and a job that dies on an unexpected
 * key would take an org's engine down for a value nothing depends on. Every
 * field falls back to its default independently, so one bad key costs that key
 * and nothing else.
 */

/**
 * How outreach should sound.
 *
 * A closed set rather than free text, because this is rendered into a prompt
 * as an instruction and free text there is an injection surface on a field an
 * admin fills in — small, but real, and there is no expressive loss: anything
 * more specific than these five belongs in `memories`, which is the freeform
 * house-style store and is already read into the same `guidance` array.
 */
export const ORG_TONES = ["direct", "warm", "formal", "technical", "plain"] as const;

export type OrgTone = (typeof ORG_TONES)[number];

export interface OrgVoice {
  tone: OrgTone | null;
  /** Named competitors. Context, not exclusions — see `OrgProfile` below. */
  competitors: string[];
  /** Where this org sells. Used as context, never as a hard filter. */
  targetRegions: string[];
}

export interface OrgEngineSettings {
  /**
   * Standing un-worked opportunities allowed before discovery pauses.
   *
   * Null means the org has not set one and `0010`'s default of 250 applies.
   * Zero means unlimited, which is a real answer an operator may want and is
   * deliberately distinguishable from "not set".
   */
  backlogCap: number | null;
}

export interface OrgProfile {
  voice: OrgVoice;
  engine: OrgEngineSettings;
}

export const EMPTY_ORG_PROFILE: OrgProfile = {
  voice: { tone: null, competitors: [], targetRegions: [] },
  engine: { backlogCap: null },
};

export function parseOrgProfile(settings: unknown): OrgProfile {
  const root = object(settings);
  const voice = object(root.voice);
  const engine = object(root.engine);

  const tone = typeof voice.tone === "string" && isOrgTone(voice.tone) ? voice.tone : null;

  return {
    voice: {
      tone,
      competitors: strings(voice.competitors),
      targetRegions: strings(voice.targetRegions),
    },
    engine: { backlogCap: cap(engine.backlogCap) },
  };
}

/**
 * The profile, back into the jsonb column.
 *
 * Empty values are omitted rather than stored as nulls, so `settings` stays a
 * record of what somebody actually configured. It matters for the backlog cap
 * specifically: `0010`'s SQL distinguishes an absent key (use the default of
 * 250) from an explicit `0` (unlimited), and writing `"backlogCap": null`
 * would make the two indistinguishable to a `->>` that returns SQL NULL for
 * both.
 */
export function serializeOrgProfile(profile: OrgProfile): Record<string, unknown> {
  const voice: Record<string, unknown> = {};
  if (profile.voice.tone) voice.tone = profile.voice.tone;
  if (profile.voice.competitors.length) voice.competitors = profile.voice.competitors;
  if (profile.voice.targetRegions.length) voice.targetRegions = profile.voice.targetRegions;

  const engine: Record<string, unknown> = {};
  if (profile.engine.backlogCap !== null) engine.backlogCap = profile.engine.backlogCap;

  const out: Record<string, unknown> = {};
  if (Object.keys(voice).length) out.voice = voice;
  if (Object.keys(engine).length) out.engine = engine;
  return out;
}

/**
 * The voice profile as guidance lines for `personalize_message`.
 *
 * Written as instructions rather than as data, because `guidance` is a
 * `string[]` that the task treats as house style overriding its own prompt.
 * Returning `["direct"]` would be a word with no verb attached, and the model
 * would have to guess what to do with it.
 *
 * Competitors are given as context and explicitly not as a prohibition. "Do
 * not mention Acme" is a rule somebody may want and is not one this field
 * implies — a salesperson naming a competitor the prospect already uses is
 * often the whole point of the email. Anything stronger belongs in `memories`,
 * where it is written as a sentence by the person who means it.
 */
export function voiceGuidance(voice: OrgVoice): string[] {
  const lines: string[] = [];

  if (voice.tone) lines.push(TONE_INSTRUCTION[voice.tone]);

  if (voice.competitors.length) {
    lines.push(
      `This company competes with ${list(voice.competitors)}. Do not claim to be ` +
        `better than any of them — that is a claim about a product you have no ` +
        `evidence for. Naming one is fine where the recipient plainly uses it.`,
    );
  }

  if (voice.targetRegions.length) {
    lines.push(
      `They sell into ${list(voice.targetRegions)}. Match spelling and date ` +
        `conventions to the recipient's region rather than to ours.`,
    );
  }

  return lines;
}

const TONE_INSTRUCTION: Record<OrgTone, string> = {
  direct: "Write plainly and get to the point in the first sentence. No preamble.",
  warm: "Write like a person who is genuinely interested, without flattery or exclamation marks.",
  formal: "Keep it formal: full sentences, no contractions, no slang. Still short.",
  technical:
    "Write for an engineer. Be concrete and specific about mechanism; skip anything that reads as marketing.",
  plain:
    "Use plain words. No jargon, no abstract nouns, nothing that would need explaining out loud.",
};

/* ── Parsing helpers ─────────────────────────────────────────────────────── */

export function isOrgTone(value: string): value is OrgTone {
  return (ORG_TONES as readonly string[]).includes(value);
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    const s = String(item).trim();
    // Deduped case-insensitively but stored as typed: a list rendered into a
    // prompt twice reads as emphasis the user did not intend.
    if (!s || seen.has(s.toLowerCase())) continue;
    seen.add(s.toLowerCase());
    out.push(s);
  }
  return out.slice(0, 20);
}

function cap(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

function list(values: string[]): string {
  if (values.length === 1) return values[0]!;
  return `${values.slice(0, -1).join(", ")} and ${values[values.length - 1]}`;
}
