"use server";

import { revalidatePath } from "next/cache";
import { InvalidRuleError, applyRules, validateExpression } from "@huntloop/db/rules";
import type { RuleExpression, RulePriority } from "@huntloop/db/rules";
import type { IcpSummary } from "@huntloop/ai";
import { draft } from "../../../../../lib/ai/rules";
import {
  currentUserId,
  fail,
  mutate,
  ok,
  type ActionResult,
} from "../../../../../lib/data/org";
import { parseForm, scoringRuleSchema, uuidSchema } from "../../../../../lib/validation";

/**
 * Scoring rules — the write side of `0003`'s table, made evaluable by `0010`.
 *
 * ── Nothing here activates anything by accident ──────────────────────────
 *
 * A drafted rule is stored inactive and stays inactive until somebody presses
 * a button whose only job is to activate it. That is one action, separate from
 * the one that created the row, and it is the whole design.
 *
 * The reference system Huntloop is a second draft of got this wrong twice in
 * the same product. Onboarding drafted rules as `pending_approval` and then
 * bulk-activated every remaining one when the user clicked Finish — so the
 * cheapest path through the screen approved everything. The learning loop
 * skipped the pending state entirely and inserted its proposals as active on
 * the first click. Both are the same failure: making "approve everything" the
 * default action of a screen whose purpose is to make somebody choose.
 *
 * ── Validation happens through the engine's own function ─────────────────
 *
 * `validateExpression` is the same code `score_opportunity` runs and the same
 * code the drafting task's `parse()` runs. There is deliberately no second
 * definition of "a valid rule" here, because the one that decides whether a
 * rule *fires* would not be it.
 */

export interface RuleInput {
  id?: string;
  name: string;
  effect: "adjust" | "veto" | "floor";
  weight: number | null;
  floorPriority: "hot" | "warm" | "watch" | null;
  intent: "prioritize" | "reject" | "boost" | "penalty" | null;
  rationale?: string;
  expression: unknown;
}

/**
 * Draft a starting policy.
 *
 * Writes every proposal inactive. Returns how many, rather than the rules
 * themselves, because the screen re-reads them from the database — which is
 * what makes them survive a navigation, and what makes the review screen and
 * the engine agree about what exists.
 */
export async function draftRulesAction(
  org: string,
): Promise<ActionResult<{ drafted: number; source: "live" | "unconfigured" }>> {
  return mutate(org, "draftRules", async ({ db, orgId }) => {
    /* Read inside `mutate` rather than through the loader above it, because
       the rules being written need the ICP's *id* to be scoped to it and
       `getActiveIcp` returns the flattened summary the model is given. One
       query answers both. */
    const { data: icpRow } = await db
      .from("icps")
      .select("id, criteria, negative_criteria, products(description)")
      .eq("org_id", orgId)
      .eq("is_active", true)
      .is("deleted_at", null)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!icpRow) {
      return fail(
        "There's no active ideal customer profile to draft from. Define one under Settings → ICP first.",
      );
    }

    const icp = { id: String(icpRow.id), ...toSummary(icpRow) };

    const { data: existingRows } = await db
      .from("scoring_rules")
      .select("name, rationale")
      .eq("org_id", orgId)
      .is("deleted_at", null)
      .limit(50);

    const existing = (existingRows ?? []).map((row) => ({
      name: String(row.name ?? ""),
      description: String(row.rationale ?? ""),
    }));

    const outcome = await draft(org, icp, existing);
    if (!outcome.ok) return fail(outcome.error);

    const rules = outcome.result.rules;
    if (!rules.length) {
      /* An empty draft is a real answer and the task's prompt says so twice.
         Reported as success with a count of zero rather than as a failure,
         because "your profile is too thin to support a specific rule" is
         information about the profile, not about the run. */
      return ok(
        { drafted: 0, source: outcome.result.source },
        "Nothing specific enough to propose. Add more detail to the ICP — segments, sizes, triggers — and try again.",
      );
    }

    const { error } = await db.from("scoring_rules").insert(
      rules.map((rule) => ({
        org_id: orgId,
        icp_id: icp.id,
        name: rule.name,
        expression: rule.expression,
        effect: rule.effect,
        weight: rule.weight,
        floor_priority: rule.floorPriority,
        intent: rule.intent,
        rationale: rule.rationale,
        basis: rule.basis,
        origin: "drafted",
        // The one line that matters most in this file.
        is_active: false,
        proposed_at: new Date().toISOString(),
      })),
    );

    if (error) return fail(`Those proposals could not be saved: ${error.message}`);

    revalidatePath(`/${org}/settings/scoring`);
    return ok(
      { drafted: rules.length, source: outcome.result.source },
      `${rules.length} rule${rules.length === 1 ? "" : "s"} proposed. None is active until you activate it.`,
    );
  });
}

/** Create or edit a rule by hand. Always lands inactive when it is new. */
export async function saveRuleAction(
  org: string,
  input: RuleInput,
): Promise<ActionResult<{ id: string }>> {
  const parsed = parseForm(scoringRuleSchema, input);
  if (!parsed.ok) return fail(parsed.error, parsed.fieldErrors);
  const value = parsed.value;

  let expression: RuleExpression;
  try {
    expression = validateExpression(value.expression);
  } catch (e) {
    if (e instanceof InvalidRuleError) {
      return fail("That condition isn't one this rule language can evaluate.", {
        expression: e.message,
      });
    }
    throw e;
  }

  /* The effect/argument pairing, checked here so the message names the field
     rather than the constraint. `scoring_rules_effect_arguments` in `0010` is
     what actually holds — this is what makes the refusal readable. */
  const pairing = checkPairing(value.effect, value.weight, value.floorPriority);
  if (pairing) return fail(pairing.message, pairing.fieldErrors);

  return mutate(org, "saveRule", async ({ db, orgId }) => {
    const row = {
      org_id: orgId,
      name: value.name,
      expression,
      effect: value.effect,
      weight: value.effect === "adjust" ? value.weight : null,
      floor_priority: value.effect === "floor" ? value.floorPriority : null,
      intent: value.intent,
      rationale: value.rationale || null,
    };

    if (value.id) {
      const { error } = await db
        .from("scoring_rules")
        .update(row)
        .eq("id", value.id)
        .eq("org_id", orgId)
        .is("deleted_at", null);
      if (error) return fail(`That rule could not be saved: ${error.message}`);

      revalidatePath(`/${org}/settings/scoring`);
      return ok({ id: value.id }, "Rule saved.");
    }

    const { data, error } = await db
      .from("scoring_rules")
      .insert({ ...row, origin: "user", is_active: false, proposed_at: new Date().toISOString() })
      .select("id")
      .single();

    if (error) return fail(`That rule could not be saved: ${error.message}`);

    revalidatePath(`/${org}/settings/scoring`);
    return ok(
      { id: String(data.id) },
      "Rule saved, and not yet active. Activate it when you're happy with what it says.",
    );
  });
}

/**
 * Activate or deactivate one rule.
 *
 * One rule per call, deliberately. There is no "activate all", and adding one
 * would recreate the reference system's central failure — a review screen
 * whose fastest path is to approve everything is not a review screen.
 */
export async function setRuleActiveAction(
  org: string,
  id: string,
  active: boolean,
): Promise<ActionResult<undefined>> {
  const parsed = uuidSchema.safeParse(id);
  if (!parsed.success) return fail("That rule reference isn't valid.");

  return mutate(org, "setRuleActive", async ({ db, orgId }) => {
    const userId = await currentUserId(db);

    const { error } = await db
      .from("scoring_rules")
      .update(
        active
          ? { is_active: true, approved_by: userId, approved_at: new Date().toISOString() }
          : /* Deactivating clears the approval, so `approved_at` always means
               "the moment this became live" rather than "the last time anybody
               looked at it". A rule reactivated later is a new decision. */
            { is_active: false, approved_by: null, approved_at: null },
      )
      .eq("id", parsed.data)
      .eq("org_id", orgId)
      .is("deleted_at", null);

    if (error) return fail(`That rule could not be changed: ${error.message}`);

    revalidatePath(`/${org}/settings/scoring`);
    return ok(
      undefined,
      active
        ? "Rule activated. It applies from the next time a company is scored."
        : "Rule deactivated. Existing scores are unchanged.",
    );
  });
}

/**
 * Discard a rule or a proposal.
 *
 * Soft, for the reason `deleteMemoryAction` gives: the partial index the
 * engine reads is `where is_active and deleted_at is null`, so this leaves the
 * evaluator immediately, and a rule removed by mistake is recoverable by
 * somebody with SQL access. What it is not is recoverable through the product,
 * which is the right level of friction for undoing a deletion nobody has
 * complained about yet.
 */
export async function deleteRuleAction(
  org: string,
  id: string,
): Promise<ActionResult<undefined>> {
  const parsed = uuidSchema.safeParse(id);
  if (!parsed.success) return fail("That rule reference isn't valid.");

  return mutate(org, "deleteRule", async ({ db, orgId }) => {
    const { error } = await db
      .from("scoring_rules")
      .update({ deleted_at: new Date().toISOString(), is_active: false })
      .eq("id", parsed.data)
      .eq("org_id", orgId);

    if (error) return fail(`That rule could not be removed: ${error.message}`);

    revalidatePath(`/${org}/settings/scoring`);
    return ok(undefined, "Rule removed.");
  });
}

/**
 * What a rule would do to a real opportunity, without activating it.
 *
 * The audit that specified this feature asked for "a dry-run evaluation
 * against a sample opportunity before allowing approval", and it is the single
 * most useful thing on the screen: a rule reads as obviously correct and fires
 * on nothing roughly as often as it reads wrong. A condition on
 * `company.industry` matches nothing at all on a deployment where nobody has
 * filled that column in, and no amount of reading the JSON reveals that.
 *
 * Runs against the org's most recently scored opportunities, through RLS,
 * evaluating the same `applyRules` the engine runs. Nothing is written.
 */
export async function previewRuleAction(
  org: string,
  input: RuleInput,
): Promise<ActionResult<{ matched: number; considered: number; examples: string[] }>> {
  const parsed = parseForm(scoringRuleSchema, input);
  if (!parsed.ok) return fail(parsed.error, parsed.fieldErrors);
  const value = parsed.value;

  let expression: RuleExpression;
  try {
    expression = validateExpression(value.expression);
  } catch (e) {
    if (e instanceof InvalidRuleError) {
      return fail("That condition isn't one this rule language can evaluate.", {
        expression: e.message,
      });
    }
    throw e;
  }

  return mutate(org, "previewRule", async ({ db, orgId }) => {
    const { data, error } = await db
      .from("opportunities")
      .select(
        "id, priority, companies!inner(id, name, industry, country, region, " +
          "business_model, description, employee_count, tech_stack, canonical_domain)",
      )
      .eq("org_id", orgId)
      .is("deleted_at", null)
      .order("last_scored_at", { ascending: false, nullsFirst: false })
      .limit(50);

    if (error) return fail(`That rule could not be tested: ${error.message}`);

    const rows = data ?? [];
    if (!rows.length) {
      return ok(
        { matched: 0, considered: 0, examples: [] },
        "There are no scored opportunities to test this against yet.",
      );
    }

    const rule = {
      id: "preview",
      name: value.name || "Preview",
      expression,
      effect: value.effect,
      weight: value.effect === "adjust" ? value.weight : null,
      floorPriority: (value.effect === "floor" ? value.floorPriority : null) as RulePriority | null,
      intent: null,
      rationale: null,
      basis: null,
      origin: "user" as const,
      isActive: true,
    };

    const examples: string[] = [];
    let matched = 0;

    /* eslint-disable @typescript-eslint/no-explicit-any --
       PostgREST types an embed as object-or-array depending on whether it can
       prove the relationship is to-one, and widens the whole row to a union
       with its error shape without a generated schema. Both are the notes in
       `packages/jobs/src/scope.ts` and `lib/data/icp.ts`; confined to this
       loop, which reads rows and writes nothing. */
    for (const row of rows as any[]) {
      const raw = row.companies;
      const company = (Array.isArray(raw) ? raw[0] : raw) ?? {};

      /* The evidence and signal fields are deliberately absent rather than
         faked. A preview that invented claims would report a match the engine
         will not make, and the honest consequence — a rule about evidence
         matching nothing here — is itself worth knowing before activating it.
         The copy on the screen says so. */
      const outcome = applyRules(
        [rule],
        {
          "company.name": company.name ?? null,
          "company.domain": company.canonical_domain ?? null,
          "company.industry": company.industry ?? null,
          "company.country": company.country ?? null,
          "company.region": company.region ?? null,
          "company.business_model": company.business_model ?? null,
          "company.description": company.description ?? null,
          "company.employee_count":
            company.employee_count === null || company.employee_count === undefined
              ? null
              : Number(company.employee_count),
          "company.tech_stack": Array.isArray(company.tech_stack)
            ? company.tech_stack.map(String)
            : [],
          "score.priority": String(row.priority ?? ""),
        },
        { score: 50, priority: (row.priority ?? "watch") as RulePriority },
      );

      if (outcome.trace.length) {
        matched++;
        if (examples.length < 5) examples.push(String(company.name ?? "A company"));
      }
    }
    /* eslint-enable @typescript-eslint/no-explicit-any */

    return ok(
      { matched, considered: rows.length, examples },
      matched === 0
        ? `This rule matches none of your ${rows.length} most recent opportunities. That may be right, or it may be a condition on a field nothing fills in.`
        : `Matches ${matched} of your ${rows.length} most recent opportunities.`,
    );
  });
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */

/**
 * The ICP row, flattened the way the model is given it.
 *
 * A local copy of `mapIcp` from `lib/data/icp.ts` rather than an import,
 * because that one is private to a `server-only` loader that resolves its own
 * client and this needs to run on a row already in hand. Small, and the
 * duplication is a shape rather than logic — `IcpSummary` is what makes a
 * divergence a type error.
 */
/* eslint-disable-next-line @typescript-eslint/no-explicit-any --
   the nested select's type comes from a live project's schema; see icp.ts. */
function toSummary(row: any): IcpSummary {
  const criteria = (row.criteria ?? {}) as Record<string, unknown>;
  const negative = (row.negative_criteria ?? {}) as Record<string, unknown>;
  const product = Array.isArray(row.products) ? row.products[0] : row.products;

  const strings = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

  return {
    sells: typeof product?.description === "string" ? product.description : "",
    segments: strings(criteria.segments),
    sizes: strings(criteria.sizes),
    regions: strings(criteria.regions),
    triggers: strings(criteria.triggers),
    exclusions: strings(negative.exclusions),
  };
}

/* ── The effect/argument pairing, in the screen's own words ──────────────── */

function checkPairing(
  effect: "adjust" | "veto" | "floor",
  weight: number | null,
  floorPriority: string | null,
): { message: string; fieldErrors: Record<string, string> } | null {
  if (effect === "adjust" && (weight === null || weight === 0)) {
    return {
      message: "An adjusting rule needs a weight.",
      fieldErrors: {
        weight:
          "How many points to add or subtract. Zero is a rule that does nothing while looking like it does something.",
      },
    };
  }
  if (effect === "floor" && !floorPriority) {
    return {
      message: "A floor rule needs a priority to floor to.",
      fieldErrors: { floorPriority: "The priority a matching company will not fall below." },
    };
  }
  return null;
}
