import type { IntakeAttribute, Requirement } from "@huntloop/ai";
import type { Timeline } from "./requirement";

/**
 * How ready a buyer is to act (build plan DN-51) — named dimensions from what
 * the buyer confirmed, never from a guess:
 *
 *   · specificity — share of the category's required fields they answered
 *   · budget      — 100 when a budget with a currency was stated
 *   · timeline    — this month 100, this quarter 70, later 30, exploring 10
 *
 * A dimension nobody answered is null (UNKNOWN), not low. The band is the
 * mean of the measured ones, and null with fewer than two: a buyer who
 * answered one question is not "cool", they are unknown.
 */

export type IntentBand = "hot" | "warm" | "cool";

export interface Intent {
  dimensions: { specificity: number | null; budget: number | null; timeline: number | null };
  band: IntentBand | null;
}

const TIMELINE_SCORE: Record<Timeline, number> = {
  this_month: 100,
  this_quarter: 70,
  later: 30,
  exploring: 10,
};

export function scoreIntent(
  attributes: IntakeAttribute[],
  requirement: Requirement,
  columns: { budget_max: number | null; currency: string | null; timeline: Timeline | null },
): Intent {
  const required = attributes.filter((a) => a.required);
  const answered = required.filter((a) => requirement[a.key]?.value);
  const specificity = required.length ? Math.round((answered.length / required.length) * 100) : null;
  const budget = columns.budget_max !== null && columns.currency ? 100 : null;
  const timeline = columns.timeline ? TIMELINE_SCORE[columns.timeline] : null;

  const dimensions = { specificity, budget, timeline };
  const measured = Object.values(dimensions).filter((v): v is number => v !== null);
  if (measured.length < 2) return { dimensions, band: null };
  const mean = measured.reduce((a, b) => a + b, 0) / measured.length;
  return { dimensions, band: mean >= 75 ? "hot" : mean >= 50 ? "warm" : "cool" };
}

export const INTENT_LABEL: Record<IntentBand, string> = {
  hot: "Ready to buy",
  warm: "Actively looking",
  cool: "Early stage",
};
