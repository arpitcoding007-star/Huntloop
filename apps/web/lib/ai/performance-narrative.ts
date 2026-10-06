import {
  explainPerformance,
  isAiConfigured,
  ModelRefusalError,
  runTask,
  type PerformanceFact,
  type PerformanceNarrative,
} from "@huntloop/ai";
import { resolveRecorder } from "./recorder";
import { consumeRateLimit, refusal } from "../rate-limit";
import { budgetRefusal, countAiRun, withinAiBudget } from "./budget";
import type { AiFailure } from "./outcome";

/**
 * `explain_performance`, wrapped — the same guard order as every model call in
 * this app: resolve the org (refusing non-members), then the monthly ceiling,
 * then the rate limit, then the call, then count it.
 *
 * With no key configured it returns a worked example built from the facts
 * themselves — the top two, quoted — so the demo shows what a grounded summary
 * looks like rather than a canned paragraph that cites nothing.
 */
export interface NarrativeResult {
  source: "live" | "unconfigured";
  narrative: PerformanceNarrative;
}

export type NarrativeOutcome = { ok: true; result: NarrativeResult } | AiFailure;

export async function explain(
  orgSlug: string,
  periodLabel: string,
  facts: PerformanceFact[],
): Promise<NarrativeOutcome> {
  if (facts.length < 2) {
    return { ok: false, error: "There is not enough in this period to summarise yet." };
  }

  const resolved = await resolveRecorder(orgSlug);
  if (!resolved.ok) return { ok: false, error: resolved.error };
  const { recorder, orgId, db } = resolved;

  if (!isAiConfigured()) {
    return {
      ok: true,
      result: {
        source: "unconfigured",
        narrative: {
          summary: facts.slice(0, 2).map((f) => ({ text: f.text, factIds: [f.id] })),
          suggestions: [],
        },
      },
    };
  }

  if (db) {
    const allowance = await withinAiBudget(db, orgId);
    if (!allowance.allowed) return budgetRefusal(allowance);
  }
  const budget = await consumeRateLimit(orgId, "explain_performance");
  if (!budget.allowed) return refusal(budget);

  try {
    const { output } = await runTask(explainPerformance, { periodLabel, facts }, { orgId, recorder });
    if (db) await countAiRun(db, orgId);
    return { ok: true, result: { source: "live", narrative: output } };
  } catch (error) {
    if (error instanceof ModelRefusalError) return { ok: false, error: "The model declined to summarise this." };
    return {
      ok: false,
      error:
        error instanceof Error
          ? `The summary could not be written: ${error.message}`
          : "The summary could not be written.",
    };
  }
}
