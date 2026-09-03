import "server-only";
import {
  describeRule,
  validateExpression,
  type RuleEffect,
  type RuleExpression,
  type RuleIntent,
  type RulePriority,
} from "@huntloop/db/rules";
import { requireOrgId } from "./org";
import { load, type Loaded } from "./source";

/**
 * Scoring rules — `0003`'s table, made real by `0010` and read here.
 *
 * ── Active and proposed are the same table ───────────────────────────────
 *
 * A drafted rule is a row with `is_active = false` and `origin = 'drafted'`.
 * It is not a separate "proposals" table, and it is not client-side state
 * waiting for a click.
 *
 * That is a deliberate departure from the audit's own suggestion, which was to
 * discard rejected proposals rather than keep them as inactive clutter. The
 * clutter concern is real and the fix for it is `deleted_at` — rejecting a
 * proposal soft-deletes it, which takes it out of every query here and out of
 * the partial index the engine reads. What persisting buys is the thing that
 * matters more: a person who drafts eight rules, approves three, and closes
 * the tab still has the other five when they come back. Proposals held in
 * component state are lost on a navigation, and the model call that produced
 * them is paid for again.
 *
 * ── Why the summary is computed here ─────────────────────────────────────
 *
 * `describeRule` renders the stored shape into a sentence. Generating it on
 * read rather than storing it means the sentence cannot drift from the rule —
 * a stored description edited independently of the expression is how a review
 * screen ends up showing something the engine does not do.
 */

export interface Rule {
  id: string;
  name: string;
  expression: RuleExpression;
  effect: RuleEffect;
  weight: number | null;
  floorPriority: RulePriority | null;
  intent: RuleIntent | null;
  rationale: string | null;
  basis: string | null;
  origin: "user" | "drafted" | "learned";
  isActive: boolean;
  icpId: string | null;
  createdAt: string | null;
  /** The rule in one sentence, derived from the shape rather than stored. */
  summary: string;
  /**
   * Set when the stored expression no longer parses.
   *
   * These rows are shown, flagged, and excluded from the engine — `applyRules`
   * skips what it cannot evaluate. Hiding them would be worse than either: a
   * rule a customer believes is running and is not is the exact failure the
   * whole evaluator exists to prevent, and it would be invisible on the one
   * screen built to inspect it.
   */
  malformed: string | null;
}

export interface RuleSet {
  active: Rule[];
  proposed: Rule[];
}

export async function listRules(orgSlug: string): Promise<Loaded<RuleSet>> {
  return load(
    async (db) => {
      const orgId = await requireOrgId(orgSlug, "listRules");

      const { data, error } = await db
        .from("scoring_rules")
        .select(
          "id, name, expression, effect, weight, floor_priority, intent, rationale, " +
            "basis, origin, is_active, icp_id, created_at",
        )
        .eq("org_id", orgId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false });

      if (error) throw new Error(`listRules: ${error.message}`);

      const rules = (data ?? []).map(mapRule);
      return {
        active: rules.filter((r) => r.isActive),
        proposed: rules.filter((r) => !r.isActive),
      };
    },
    () => DEMO,
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any --
   Supabase row types are generated from a live project's schema; see the same
   note in icp.ts. Confined to the mapper. */
function mapRule(row: any): Rule {
  const effect: RuleEffect = ["adjust", "veto", "floor"].includes(row.effect)
    ? row.effect
    : "adjust";
  const weight = row.weight === null || row.weight === undefined ? null : Number(row.weight);
  const floorPriority = (row.floor_priority ?? null) as RulePriority | null;

  let expression: RuleExpression;
  let malformed: string | null = null;
  try {
    expression = validateExpression(row.expression);
  } catch (e) {
    /* A placeholder that matches nothing, so the row still renders and the
       banner explains why it is not running. `applyRules` reaches the same
       conclusion independently — it skips what it cannot parse — so the screen
       and the engine agree without either trusting the other. */
    expression = { field: "company.name", op: "missing" };
    malformed = e instanceof Error ? e.message : String(e);
  }

  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    expression,
    effect,
    weight,
    floorPriority,
    intent: (row.intent ?? null) as RuleIntent | null,
    rationale: row.rationale ?? null,
    basis: row.basis ?? null,
    origin: ["user", "drafted", "learned"].includes(row.origin) ? row.origin : "user",
    isActive: Boolean(row.is_active),
    icpId: row.icp_id ?? null,
    createdAt: row.created_at ?? null,
    summary: malformed
      ? "This rule could not be read, so it is not running."
      : describeRule({ effect, weight, floorPriority, expression }),
    malformed,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Demo rules.
 *
 * One of each effect, because the three behave differently in ways the screen
 * has to make legible before anybody writes one — and one still-proposed, so
 * the review affordance is visible in demo mode rather than appearing only
 * after somebody connects a database and runs a model.
 */
const DEMO: RuleSet = {
  active: [
    {
      id: "demo-rule-1",
      name: "Too small to buy",
      expression: { field: "company.employee_count", op: "lte", value: 9 },
      effect: "veto",
      weight: null,
      floorPriority: null,
      intent: "reject",
      rationale: "Nobody under ten people has a budget line for this.",
      basis: "50–500 employees",
      origin: "user",
      isActive: true,
      icpId: null,
      createdAt: null,
      summary: "Never consider a company where employee count is at most 9.",
      malformed: null,
    },
    {
      id: "demo-rule-2",
      name: "Fresh funding",
      expression: { field: "signals.event_types", op: "equals", value: "funding" },
      effect: "floor",
      weight: null,
      floorPriority: "warm",
      intent: "prioritize",
      rationale: "A round closing is the one moment budget is genuinely unallocated.",
      basis: "Recently raised a round",
      origin: "user",
      isActive: true,
      icpId: null,
      createdAt: null,
      summary: "Treat a company where event types is “funding” as at least warm.",
      malformed: null,
    },
  ],
  proposed: [
    {
      id: "demo-rule-3",
      name: "Hiring platform engineers",
      expression: { field: "evidence.claims", op: "includes", value: "platform engineer" },
      effect: "adjust",
      weight: 12,
      floorPriority: null,
      intent: "boost",
      rationale: "Teams hiring platform engineers are the ones rebuilding, which is when they choose tools.",
      basis: "Hiring for platform or infrastructure roles",
      origin: "drafted",
      isActive: false,
      icpId: null,
      createdAt: null,
      summary: "Add 12 points where claims mentions “platform engineer”.",
      malformed: null,
    },
  ],
};
