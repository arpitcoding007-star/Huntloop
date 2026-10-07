/**
 * Writing style, measured — the deterministic half of learning from
 * corrections (K3, `0044`).
 *
 * `editFeatures` turns one person's edit of one AI draft into numbers and
 * short strings; the web app stores them on a `draft_edited` signal.
 * `styleCandidates` finds what repeats across those signals and proposes a
 * preference only when it has seen it at least `MIN_EXAMPLES` times on at
 * least two different drafts' subjects — one edit is a correction, three in
 * the same direction are a habit. No model is involved: a habit that can be
 * counted should be counted.
 *
 * What comes out is phrased as an instruction to the writer and always cites
 * the signals behind it. Edits in the opposite direction are returned as
 * contradictions, so the confidence the reader computes is honest.
 */

export const MIN_EXAMPLES = 3;

export interface EditFeatures {
  wordsBefore: number;
  wordsAfter: number;
  subjectWordsBefore: number;
  subjectWordsAfter: number;
  /** First word of a short opening line ("hi", "hey"), lowercased. */
  greetingBefore: string | null;
  greetingAfter: string | null;
  /** The closing line as written ("Best, Alex"), when it is short. */
  signoffBefore: string | null;
  signoffAfter: string | null;
  bulletsBefore: number;
  bulletsAfter: number;
  exclamationsBefore: number;
  exclamationsAfter: number;
  /** Three-word phrases the person deleted, at most five. */
  removedPhrases: string[];
}

const words = (text: string) => (text.match(/[\p{L}\p{N}'’-]+/gu) ?? []).length;

const lines = (text: string) =>
  text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

function greeting(body: string): string | null {
  const first = lines(body)[0];
  if (!first || words(first) > 6 || !/[,!:]$/.test(first)) return null;
  const word = first.match(/^[\p{L}]+/u)?.[0];
  return word ? word.toLowerCase() : null;
}

function signoff(body: string): string | null {
  const all = lines(body);
  if (all.length < 2) return null;
  /* "Best,\nAlex" is two lines and one sign-off. */
  const last = all[all.length - 1]!;
  const prev = all[all.length - 2]!;
  const joined = /,$/.test(prev) && words(prev) <= 3 && words(last) <= 3 ? `${prev} ${last}` : last;
  if (words(joined) > 6 || joined.length > 60) return null;
  return joined.replace(/\s+/g, " ");
}

const bullets = (body: string) => lines(body).filter((l) => /^([-*•]|\d+[.)])\s+/.test(l)).length;

function trigrams(body: string): Set<string> {
  const toks = (body.toLowerCase().match(/[\p{L}'’]+/gu) ?? []).filter((t) => t.length > 1);
  const out = new Set<string>();
  for (let i = 0; i + 2 < toks.length; i++) out.add(`${toks[i]} ${toks[i + 1]} ${toks[i + 2]}`);
  return out;
}

export function editFeatures(
  before: { subject?: string | null; body: string },
  after: { subject?: string | null; body: string },
): EditFeatures {
  const kept = trigrams(after.body);
  const removedPhrases = [...trigrams(before.body)].filter((p) => !kept.has(p)).slice(0, 5);
  return {
    wordsBefore: words(before.body),
    wordsAfter: words(after.body),
    subjectWordsBefore: words(before.subject ?? ""),
    subjectWordsAfter: words(after.subject ?? ""),
    greetingBefore: greeting(before.body),
    greetingAfter: greeting(after.body),
    signoffBefore: signoff(before.body),
    signoffAfter: signoff(after.body),
    bulletsBefore: bullets(before.body),
    bulletsAfter: bullets(after.body),
    exclamationsBefore: (before.body.match(/!/g) ?? []).length,
    exclamationsAfter: (after.body.match(/!/g) ?? []).length,
    removedPhrases,
  };
}

export interface StyleSignal {
  id: string;
  /** The draft (or other subject) it was about — habits need ≥ 2 of them. */
  subjectId: string | null;
  features: Partial<EditFeatures>;
}

export interface StyleCandidate {
  key: string;
  category: "writing_style";
  content: string;
  appliesTo: ["personalize_message"];
  signalIds: string[];
  contradictingIds: string[];
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown) => (typeof v === "string" && v ? v : null);

function enough(signals: StyleSignal[]): boolean {
  return signals.length >= MIN_EXAMPLES && new Set(signals.map((s) => s.subjectId ?? s.id)).size >= 2;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function styleCandidates(signals: StyleSignal[]): StyleCandidate[] {
  const out: StyleCandidate[] = [];
  const add = (key: string, content: string, support: StyleSignal[], against: StyleSignal[] = []) => {
    if (!enough(support) || support.length <= against.length * 2) return;
    out.push({
      key,
      category: "writing_style",
      content,
      appliesTo: ["personalize_message"],
      signalIds: support.map((s) => s.id),
      contradictingIds: against.map((s) => s.id),
    });
  };

  /* Length: cut by a quarter or more, against lengthened by a quarter. */
  const sized = signals.filter((s) => (num(s.features.wordsBefore) ?? 0) >= 20 && num(s.features.wordsAfter) !== null);
  const ratio = (s: StyleSignal) => num(s.features.wordsAfter)! / num(s.features.wordsBefore)!;
  const shorter = sized.filter((s) => ratio(s) <= 0.75);
  const longer = sized.filter((s) => ratio(s) >= 1.25);
  if (shorter.length) {
    const target = Math.max(30, Math.ceil(median(shorter.map((s) => num(s.features.wordsAfter)!)) / 10) * 10);
    add("email.length", `Keep emails to about ${target} words or fewer.`, shorter, longer);
  }

  /* The same sign-off, written in by hand, again and again. */
  /* Compared without case; quoted as the person last wrote it. */
  const signoffs = new Map<string, StyleSignal[]>();
  for (const s of signals) {
    const after = str(s.features.signoffAfter);
    if (after && after.toLowerCase() !== str(s.features.signoffBefore)?.toLowerCase()) {
      const key = after.toLowerCase();
      signoffs.set(key, [...(signoffs.get(key) ?? []), s]);
    }
  }
  const topSignoff = [...signoffs.entries()].sort((a, b) => b[1].length - a[1].length)[0];
  if (topSignoff) {
    const against = [...signoffs.entries()].filter(([k]) => k !== topSignoff[0]).flatMap(([, v]) => v);
    const asWritten = str(topSignoff[1][topSignoff[1].length - 1]!.features.signoffAfter)!;
    add("email.signoff", `Sign off exactly as: "${asWritten}".`, topSignoff[1], against);
  }

  /* The same greeting word. */
  const greetings = new Map<string, StyleSignal[]>();
  for (const s of signals) {
    const after = str(s.features.greetingAfter);
    if (after && after !== str(s.features.greetingBefore)) greetings.set(after, [...(greetings.get(after) ?? []), s]);
  }
  const topGreeting = [...greetings.entries()].sort((a, b) => b[1].length - a[1].length)[0];
  if (topGreeting) {
    const against = [...greetings.entries()].filter(([k]) => k !== topGreeting[0]).flatMap(([, v]) => v);
    add("email.greeting", `Open with "${capitalise(topGreeting[0])}" and the person's first name.`, topGreeting[1], against);
  }

  /* Bullets added, against bullets taken out. */
  const added = signals.filter((s) => (num(s.features.bulletsAfter) ?? 0) > (num(s.features.bulletsBefore) ?? 0));
  const removed = signals.filter((s) => (num(s.features.bulletsAfter) ?? 0) < (num(s.features.bulletsBefore) ?? 0));
  add("email.bullets", "Put the main points in a short bulleted list.", added, removed);

  /* Exclamation marks taken out. */
  const calmer = signals.filter(
    (s) => (num(s.features.exclamationsBefore) ?? 0) > 0 && (num(s.features.exclamationsAfter) ?? 0) === 0,
  );
  add("email.exclamations", "Don't use exclamation marks.", calmer);

  /* A phrase deleted from three different drafts. */
  const phrases = new Map<string, StyleSignal[]>();
  for (const s of signals) {
    const list = Array.isArray(s.features.removedPhrases) ? s.features.removedPhrases : [];
    for (const p of new Set(list.map(String))) {
      if (/\d/.test(p)) continue;
      phrases.set(p, [...(phrases.get(p) ?? []), s]);
    }
  }
  [...phrases.entries()]
    .filter(([, v]) => enough(v))
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 3)
    .forEach(([phrase, v]) => add(`email.avoid.${phrase.replace(/[^a-z]+/g, "_")}`, `Don't write "${phrase}".`, v));

  return out;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
