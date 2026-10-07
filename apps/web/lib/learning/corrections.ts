/**
 * Is this follow-up a correction of the last answer? (K3, `0044`)
 *
 * A person who replies "shorter", "as bullets" or "from now on, lead with the
 * number" to Ask Huntloop is telling it how they like answers. That is worth
 * a signal; "and what about Acme?" is not. Deliberately narrow — a missed
 * correction costs one signal, a question mistaken for one puts noise into
 * what Huntloop learns about the person.
 */

const PATTERNS: RegExp[] = [
  /^\s*(make it |keep it |be )?(shorter|longer|briefer|simpler|more concise)\b/i,
  /\btoo (long|short|wordy|vague|detailed)\b/i,
  /\b(less|more) (detail|detailed|words|context)\b/i,
  /\b(as|in|use|with) (a )?(bullets?|bullet points|a table|table form|numbered list)\b/i,
  /\bno (bullets|tables|preamble|intro)\b/i,
  /\b(just|only) (the )?(numbers|names|answer|list)\b/i,
  /\b(from now on|next time|in future|going forward)\b/i,
  /^\s*(always|never|stop|don'?t|do not)\b/i,
];

export function isCorrection(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 300) return false;
  return PATTERNS.some((p) => p.test(t));
}
