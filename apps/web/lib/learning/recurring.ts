/**
 * Questions a person keeps asking (K5, `0044`).
 *
 * Computed from their own Ask Huntloop turns each time, not stored: a
 * question asked on at least `MIN_DAYS` different days is offered back as a
 * one-click suggestion, with how often it was asked. Nothing is inferred
 * about the person; the suggestion is their own words, and clearing the
 * conversation clears it.
 */

export const MIN_DAYS = 2;
const MAX_SUGGESTIONS = 3;

export interface AskedTurn {
  content: string;
  at: string;
}

export interface RecurringQuestion {
  text: string;
  days: number;
}

const normalise = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

export function recurringQuestions(turns: AskedTurn[]): RecurringQuestion[] {
  const groups = new Map<string, { latest: AskedTurn; days: Set<string> }>();
  for (const t of turns) {
    const key = normalise(t.content);
    if (key.split(" ").length < 3 || key.length > 200) continue;
    const g = groups.get(key) ?? { latest: t, days: new Set<string>() };
    g.days.add(t.at.slice(0, 10));
    if (t.at > g.latest.at) g.latest = t;
    groups.set(key, g);
  }
  return [...groups.values()]
    .filter((g) => g.days.size >= MIN_DAYS)
    .sort((a, b) => b.days.size - a.days.size || b.latest.at.localeCompare(a.latest.at))
    .slice(0, MAX_SUGGESTIONS)
    .map((g) => ({ text: g.latest.content.trim(), days: g.days.size }));
}
