/**
 * The two facts a "Needs you" item carries beyond the ranker's sentence: the
 * opportunity's own why-now, and who to reach. COMMAND.md §6.6.
 *
 * The ranker says why an item is in the queue ("hot, untouched for 3 days").
 * These say what to do with it without opening the opportunity: what the
 * reason to talk is, and whether there is anyone to talk to yet. Pure, so the
 * rules about which person to name are tested rather than assumed.
 */

export interface ItemContext {
  /** The qualifier's why-now sentence, or null when none was written. */
  whyNow: string | null;
  /** Who to reach, or null when nobody is on file yet. */
  buyer: { name: string; title: string | null } | null;
}

export interface ContextPerson {
  first_name: string | null;
  last_name: string | null;
  title: string | null;
  is_decision_maker: boolean | null;
  deleted_at: string | null;
}

/**
 * A decision maker first; otherwise anyone named at the company. A person with
 * no name is not someone you can reach out to by name, so they do not count —
 * "nobody on file" is the truer thing to say about them.
 */
export function pickBuyer(people: readonly ContextPerson[]): ItemContext["buyer"] {
  const named = people
    .filter((p) => p.deleted_at === null)
    .map((p) => ({
      name: [p.first_name, p.last_name].filter((s) => s && s.trim()).join(" ").trim(),
      title: p.title?.trim() || null,
      dm: p.is_decision_maker === true,
    }))
    .filter((p) => p.name !== "");
  const chosen = named.find((p) => p.dm) ?? named[0];
  return chosen ? { name: chosen.name, title: chosen.title } : null;
}

/** One line: whitespace collapsed, empty treated as absent. */
export function oneLine(text: string | null | undefined): string | null {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  return t === "" ? null : t;
}

/**
 * The daily share of a weekly reach-out goal, over five working days and
 * rounded up — a goal of 12 a week is 3 a day, not 2.4.
 */
export function dailyGoal(touchesPerWeek: number | null): number | null {
  if (touchesPerWeek === null || !Number.isFinite(touchesPerWeek) || touchesPerWeek <= 0) return null;
  return Math.ceil(touchesPerWeek / 5);
}
