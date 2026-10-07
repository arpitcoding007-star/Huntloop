import { QUESTIONS, type Question, type QuestionContext, type QuestionSurface } from "./catalog";

/**
 * Which question, if any, to ask on a screen (K4).
 *
 *   · one per screen — this returns one or none;
 *   · `DAILY_BUDGET` a day — counted as questions the person has dealt with
 *     today (answered, dismissed or snoozed), so ignoring a card never spends
 *     the budget and answering three ends the day's asking;
 *   · never again once answered or dismissed; a snooze waits until it ends;
 *   · never when the catalog's `skipIf` says it is known or irrelevant —
 *     including when the person already stated, or Huntloop learned, it.
 */

export const DAILY_BUDGET = 3;
export const SNOOZE_DAYS = 7;

export interface QuestionState {
  key: string;
  status: "asked" | "answered" | "dismissed" | "snoozed";
  snoozeUntil: string | null;
  updatedAt: string;
}

export function nextQuestion(
  surface: QuestionSurface,
  ctx: QuestionContext,
  states: QuestionState[],
  now: Date = new Date(),
  catalog: readonly Question[] = QUESTIONS,
): Question | null {
  const startOfDay = new Date(now);
  startOfDay.setUTCHours(0, 0, 0, 0);
  const handledToday = states.filter(
    (s) => s.status !== "asked" && new Date(s.updatedAt).getTime() >= startOfDay.getTime(),
  ).length;
  if (handledToday >= DAILY_BUDGET) return null;

  const byKey = new Map(states.map((s) => [s.key, s]));
  for (const q of catalog) {
    if (!q.surfaces.includes(surface)) continue;
    const state = byKey.get(q.key);
    if (state?.status === "answered" || state?.status === "dismissed") continue;
    if (state?.status === "snoozed" && state.snoozeUntil && new Date(state.snoozeUntil) > now) continue;
    if (q.skipIf(ctx)) continue;
    return q;
  }
  return null;
}
