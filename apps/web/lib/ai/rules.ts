import {
  ModelRefusalError,
  draftScoringRules,
  icpElements,
  isAiConfigured,
  runTask,
  type DraftedRule,
  type IcpSummary,
} from "@huntloop/ai";
import { describeRule } from "@huntloop/db/rules";
import { resolveRecorder } from "./recorder";
import { consumeRateLimit, refusal } from "../rate-limit";
import { budgetRefusal, countAiRun, withinAiBudget } from "./budget";
import type { AiFailure } from "./outcome";

/**
 * `draft_scoring_rules`, wrapped for the screen that calls it.
 *
 * Same two-state shape as `sources.ts` and `research.ts`: live, or a worked
 * example when no key is configured. There is no third "it failed, here is
 * something plausible" state anywhere in this directory, and this is the task
 * where inventing one would be worst.
 *
 * A fabricated source list is discovered weeks later as a hunt that surfaces
 * nothing. A fabricated *scoring rule* is never discovered at all: it silently
 * excludes companies or inflates others on every scan from then on, and its
 * effect is indistinguishable from the qualifier having an opinion. The
 * failure has no symptom, which is exactly why the honest states are two.
 *
 * ── The example is built from the user's own ICP ─────────────────────────
 *
 * For the same reason `sources.ts` does it: the real task refuses a rule whose
 * `basis` is not something this user wrote, and an example that violated that
 * rule would teach the shape of an answer the product does not accept. Every
 * example below cites a real ICP element, and the banner above it says no
 * model chose these.
 */

export type RulesSource = "live" | "unconfigured";

export interface DraftRulesResult {
  source: RulesSource;
  metered: boolean;
  rules: DraftedRule[];
}

export type DraftRulesOutcome = { ok: true; result: DraftRulesResult } | AiFailure;

export async function draft(
  orgSlug: string,
  icp: IcpSummary,
  existing: { name: string; description: string }[],
): Promise<DraftRulesOutcome> {
  if (!icpElements(icp).length) {
    return {
      ok: false,
      error:
        "There's no ideal customer profile to draft rules from yet. Describe " +
        "who you're selling to under Settings → ICP first.",
    };
  }

  if (!isAiConfigured()) {
    return {
      ok: true,
      result: { source: "unconfigured", metered: false, rules: example(icp) },
    };
  }

  const resolved = await resolveRecorder(orgSlug);
  if (!resolved.ok) return { ok: false, error: resolved.error };
  const { recorder, orgId, recorded, db } = resolved;

  /* The monthly ceiling before the rate limit, for the reason `sources.ts`
     gives: reading it costs nothing, and consuming a rate-limit unit for a
     request that is over quota charges somebody for being refused. */
  if (db) {
    const allowance = await withinAiBudget(db, orgId);
    if (!allowance.allowed) return budgetRefusal(allowance);
  }

  const budget = await consumeRateLimit(orgId, "draft_scoring_rules");
  if (!budget.allowed) return refusal(budget);

  try {
    const { output } = await runTask(draftScoringRules, { icp, existing }, { orgId, recorder });
    if (db) await countAiRun(db, orgId);
    return { ok: true, result: { source: "live", metered: recorded, rules: output } };
  } catch (error) {
    if (error instanceof ModelRefusalError) {
      return {
        ok: false,
        error:
          "The model declined to draft rules for this profile. That is an " +
          "answer about the request, not an outage.",
      };
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Drafting scoring rules failed.",
    };
  }
}

/**
 * The worked example shown when no key is configured.
 *
 * One of each effect, because the three are the thing a person has to
 * understand before writing one and a set of three adjustments would teach
 * that a rule is a number. Every `basis` is an element this user actually
 * wrote — see the note at the top.
 */
function example(icp: IcpSummary): DraftedRule[] {
  const elements = icpElements(icp);
  const pick = (values: string[]) => values.find((v) => v.trim()) ?? elements[0]!;
  const size = pick(icp.sizes);
  const trigger = pick(icp.triggers);
  const segment = pick(icp.segments);

  const rules: Omit<DraftedRule, "summary">[] = [
    {
      name: "Too small to have a budget",
      intent: "reject",
      effect: "veto",
      weight: null,
      floorPriority: null,
      expression: { field: "company.employee_count", op: "lte", value: 9 },
      rationale:
        "A company under ten people has nobody whose job it is to buy this. Excluded outright rather than scored down, so a strong trigger cannot outvote it.",
      basis: size,
    },
    {
      name: "A trigger we said we care about",
      intent: "prioritize",
      effect: "floor",
      weight: null,
      floorPriority: "warm",
      expression: { field: "signals.event_types", op: "equals", value: "funding" },
      rationale:
        "A profile that names a buying trigger is saying it is worth a human look on its own, whatever else the company scores.",
      basis: trigger,
    },
    {
      name: "In the segment, in their own words",
      intent: "boost",
      effect: "adjust",
      weight: 10,
      floorPriority: null,
      expression: { field: "company.description", op: "includes", value: segment.toLowerCase() },
      rationale:
        "A company that describes itself the way the profile describes the segment is a better match than one an analyst filed there.",
      basis: segment,
    },
  ];

  /* The summary is generated the same way the real task generates it — from
     the stored shape, never written separately — so the example cannot show a
     sentence that disagrees with the rule beside it. */
  return rules.map((rule) => ({
    ...rule,
    summary: describeRule({
      effect: rule.effect,
      weight: rule.weight,
      floorPriority: rule.floorPriority,
      expression: rule.expression,
    }),
  }));
}
