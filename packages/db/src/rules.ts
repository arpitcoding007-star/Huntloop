/**
 * Scoring rules — the expression language, and the thing that evaluates it.
 *
 * ── Why this file exists at all ──────────────────────────────────────────
 *
 * `scoring_rules` was added in `0003` with an `expression jsonb` column and
 * nothing anywhere that read it. That is a worse state than not having the
 * table: a screen listing rules, a form authoring them, and a column storing
 * them all assert that the product does something it does not do. The
 * reference system Huntloop is a second draft of shipped exactly this failure
 * in the other direction — six rule types, signed weights, a whole taxonomy —
 * where the weight was never once used in arithmetic. Rules were sentences
 * pasted into a prompt, re-interpreted from scratch on every call, and the
 * number beside them was decoration.
 *
 * So the choice here is not "which expression language". It is: either the
 * column is evaluated by code a person can read, or the column should not
 * exist. This file is the first option.
 *
 * ── Why it lives in packages/db ──────────────────────────────────────────
 *
 * Because it is about the shape of a row, and both sides need it: the engine
 * applies rules while scoring, and the review screen dry-runs a proposed rule
 * before anybody activates it. Putting it in `packages/jobs` would make the
 * web app import the job runner — and transitively the service-role client —
 * to answer a pure question about a JSON object. Nothing here imports a
 * client, or `server-only`, or anything at all.
 *
 * ── The deliberate smallness of the language ─────────────────────────────
 *
 * Six operators, four combinators, a closed field list. It is not a query
 * language and must not become one. Every addition has to survive the same
 * test: can a model propose it, can a person read it back and say whether it
 * is what they meant, and can it be evaluated with no I/O? A rule that needs a
 * database round trip to decide has stopped being a rule and become a query,
 * and it will be the thing that makes scoring slow and non-deterministic.
 *
 * ── What a rule may NOT do ───────────────────────────────────────────────
 *
 * Touch the eight dimensions of `opportunity_scores`. §51 states the
 * combination rule for those is NOT DEFINED and warns against inventing one
 * and presenting it as Huntloop's logic. A rule adjusts the single overall
 * score, vetoes, or floors — three effects, all visible, all recorded in
 * `opportunity_scores.rule_trace` beside the untouched `model_score`.
 */

/* ── The row ─────────────────────────────────────────────────────────────── */

export type RuleIntent = "prioritize" | "reject" | "boost" | "penalty";
export type RuleEffect = "adjust" | "veto" | "floor";

export const RULE_INTENTS: readonly RuleIntent[] = [
  "prioritize",
  "reject",
  "boost",
  "penalty",
];
export const RULE_EFFECTS: readonly RuleEffect[] = ["adjust", "veto", "floor"];

export type RulePriority = "hot" | "warm" | "watch" | "ignore";

export interface ScoringRule {
  id: string;
  name: string;
  expression: RuleExpression;
  effect: RuleEffect;
  /** Signed points, `adjust` only. Bounded to ±40 by a CHECK in `0010`. */
  weight: number | null;
  /** `floor` only. The priority this rule will not let an opportunity fall below. */
  floorPriority: RulePriority | null;
  /**
   * Grouping metadata. Read by the review screen, never by `applyRules`.
   *
   * If you find yourself wanting to branch on this, the thing you want to
   * express belongs in `effect` or in the expression — see the header, and the
   * negative test in `verify-migrations.ts` that asserts two rules with the
   * same effect and different intents behave identically.
   */
  intent: RuleIntent | null;
  rationale: string | null;
  basis: string | null;
  origin: "user" | "drafted" | "learned";
  isActive: boolean;
}

/* ── The facts a rule may ask about ──────────────────────────────────────── */

/**
 * Everything available at scoring time, flattened.
 *
 * A closed list, because a rule that names a field nobody supplies is a rule
 * that silently never fires — the failure mode that makes a rules engine
 * untrustworthy, since it looks configured and does nothing. `validateRule`
 * rejects an unknown field, and the JSON Schema handed to the drafting task is
 * built from this same array, so a model cannot propose one either.
 */
export const RULE_FIELDS = [
  "company.name",
  "company.domain",
  "company.industry",
  "company.country",
  "company.region",
  "company.business_model",
  "company.description",
  "company.employee_count",
  "company.tech_stack",
  /** The claim texts Huntloop has observed about this company. */
  "evidence.claims",
  /** `fact` / `inference` / `unknown`, one per observation. */
  "evidence.kinds",
  /** Normalized event types from `source_events` — `funding`, `hiring`, … */
  "signals.event_types",
  /** The qualifier's own verdict, before any rule ran. */
  "score.model_score",
  "score.priority",
] as const;

export type RuleField = (typeof RULE_FIELDS)[number];

/** The value a field resolves to. Arrays are membership-tested, not compared. */
export type FactValue = string | number | string[] | null;

export type RuleFacts = Partial<Record<RuleField, FactValue>>;

/* ── The language ────────────────────────────────────────────────────────── */

export const RULE_OPERATORS = [
  /** Case-insensitive equality. On an array, exact membership. */
  "equals",
  /** Substring on a string; membership on an array. Case-insensitive. */
  "includes",
  "gte",
  "lte",
  /** Present and non-empty. An empty array and an empty string are absent. */
  "exists",
  /** The negation of `exists`. Written out so a rule reads as a sentence. */
  "missing",
] as const;

export type RuleOperator = (typeof RULE_OPERATORS)[number];

export interface RuleCondition {
  field: RuleField;
  op: RuleOperator;
  /** Omitted for `exists`/`missing`. A list means "any of these". */
  value?: string | number | string[];
}

export type RuleExpression =
  | RuleCondition
  | { all: RuleExpression[] }
  | { any: RuleExpression[] }
  | { not: RuleExpression };

/* ── Validation ──────────────────────────────────────────────────────────── */

export class InvalidRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidRuleError";
  }
}

/**
 * Depth limit on nesting.
 *
 * Not a safety bound — the evaluator is a pure recursive walk over a JSON
 * object and cannot loop. It is a *reviewability* bound. A five-deep nest of
 * any/all/not is not something a person approving a proposal can hold in their
 * head, and a rule nobody can read is a rule nobody should activate.
 */
const MAX_DEPTH = 4;

/** How many conditions one rule may contain, for the same reason. */
const MAX_CONDITIONS = 12;

/**
 * Parses and checks an expression, or throws with the reason.
 *
 * Used in three places, and it matters that it is the same function in all
 * three: the drafting task's `parse()`, the server action that stores a rule,
 * and the evaluator's own entry point. A shape that is accepted on the way in
 * and rejected on the way out is how a stored rule becomes a runtime error
 * during a scan.
 */
export function validateExpression(value: unknown, depth = 0): RuleExpression {
  if (depth > MAX_DEPTH) {
    throw new InvalidRuleError(
      `This rule nests conditions ${depth} deep. Past ${MAX_DEPTH}, nobody ` +
        `reviewing it can tell what it does, which is the only reason to have ` +
        `a rule rather than a judgement.`,
    );
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidRuleError("A rule condition must be an object.");
  }

  const node = value as Record<string, unknown>;

  for (const key of ["all", "any"] as const) {
    if (key in node) {
      const branches = node[key];
      if (!Array.isArray(branches) || branches.length === 0) {
        throw new InvalidRuleError(`\`${key}\` needs at least one condition.`);
      }
      return { [key]: branches.map((b) => validateExpression(b, depth + 1)) } as RuleExpression;
    }
  }

  if ("not" in node) {
    return { not: validateExpression(node.not, depth + 1) };
  }

  const field = node.field;
  if (typeof field !== "string" || !isRuleField(field)) {
    throw new InvalidRuleError(
      `\`${String(field)}\` is not something a rule can ask about. A rule ` +
        `naming a field nothing supplies never fires, and looks configured ` +
        `while doing nothing.`,
    );
  }

  const op = node.op;
  if (typeof op !== "string" || !isRuleOperator(op)) {
    throw new InvalidRuleError(`\`${String(op)}\` is not an operator this language has.`);
  }

  if (op === "exists" || op === "missing") {
    return { field, op };
  }

  const raw = node.value;
  if (raw === undefined || raw === null) {
    throw new InvalidRuleError(`\`${field} ${op}\` needs something to compare against.`);
  }

  if (op === "gte" || op === "lte") {
    const numeric = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(numeric)) {
      throw new InvalidRuleError(`\`${field} ${op}\` needs a number, not ${JSON.stringify(raw)}.`);
    }
    return { field, op, value: numeric };
  }

  if (Array.isArray(raw)) {
    const values = raw.map((v) => String(v).trim()).filter(Boolean);
    if (!values.length) {
      throw new InvalidRuleError(`\`${field} ${op}\` was given an empty list to match against.`);
    }
    return { field, op, value: values };
  }

  const single = String(raw).trim();
  if (!single) {
    throw new InvalidRuleError(`\`${field} ${op}\` was given nothing to match against.`);
  }
  return { field, op, value: single };
}

/** Full row validation, including the effect/argument pairing `0010` enforces. */
export function validateRule(
  rule: Omit<ScoringRule, "id" | "expression"> & { expression: unknown },
): void {
  const expression = validateExpression(rule.expression);
  const conditions = countConditions(expression);
  if (conditions > MAX_CONDITIONS) {
    throw new InvalidRuleError(
      `This rule has ${conditions} conditions. Past ${MAX_CONDITIONS} it is a ` +
        `query, and it should be two rules or a judgement.`,
    );
  }

  if (rule.effect === "adjust") {
    if (rule.weight === null || !Number.isFinite(rule.weight)) {
      throw new InvalidRuleError("An adjusting rule needs a weight, or it does nothing.");
    }
    if (rule.weight < -40 || rule.weight > 40) {
      throw new InvalidRuleError(
        `A weight of ${rule.weight} is outside ±40. Past that, one rule decides ` +
          `every verdict on its own, which is the failure an unvalidated weight ` +
          `produces.`,
      );
    }
    if (rule.weight === 0) {
      throw new InvalidRuleError("A weight of zero is a rule that does nothing.");
    }
    if (rule.floorPriority !== null) {
      throw new InvalidRuleError("An adjusting rule does not set a priority floor.");
    }
  }

  if (rule.effect === "floor") {
    if (!rule.floorPriority) {
      throw new InvalidRuleError("A floor rule needs a priority to floor to.");
    }
    if (rule.floorPriority === "ignore") {
      throw new InvalidRuleError(
        "Flooring at `ignore` floors at the bottom, which is not a floor. A rule " +
          "that means `never consider these` has effect `veto`.",
      );
    }
    if (rule.weight !== null) {
      throw new InvalidRuleError("A floor rule does not carry a weight.");
    }
  }

  if (rule.effect === "veto" && (rule.weight !== null || rule.floorPriority !== null)) {
    throw new InvalidRuleError("A veto takes no weight and no floor — it excludes.");
  }
}

function countConditions(expression: RuleExpression): number {
  if ("all" in expression) return expression.all.reduce((n, e) => n + countConditions(e), 0);
  if ("any" in expression) return expression.any.reduce((n, e) => n + countConditions(e), 0);
  if ("not" in expression) return countConditions(expression.not);
  return 1;
}

export function isRuleField(value: string): value is RuleField {
  return (RULE_FIELDS as readonly string[]).includes(value);
}

export function isRuleOperator(value: string): value is RuleOperator {
  return (RULE_OPERATORS as readonly string[]).includes(value);
}

/* ── Evaluation ──────────────────────────────────────────────────────────── */

/**
 * Whether one expression holds against one set of facts.
 *
 * Missing facts are false, never an error. A rule about `company.employee_count`
 * on a company whose headcount nobody knows has not been violated — it has not
 * been established, and treating "we don't know" as "the condition is met" is
 * the §7 failure with a boolean instead of a sentence. The consequence is
 * deliberate and worth stating: a `veto` rule cannot exclude on absent data.
 */
export function evaluate(expression: RuleExpression, facts: RuleFacts): boolean {
  if ("all" in expression) return expression.all.every((e) => evaluate(e, facts));
  if ("any" in expression) return expression.any.some((e) => evaluate(e, facts));
  if ("not" in expression) return !evaluate(expression.not, facts);

  const actual = facts[expression.field] ?? null;

  switch (expression.op) {
    case "exists":
      return present(actual);
    case "missing":
      return !present(actual);
    case "gte":
    case "lte": {
      const n = numeric(actual);
      if (n === null) return false;
      const bound = Number(expression.value);
      return expression.op === "gte" ? n >= bound : n <= bound;
    }
    case "equals":
      return candidates(expression.value).some((wanted) => matches(actual, wanted, true));
    case "includes":
      return candidates(expression.value).some((wanted) => matches(actual, wanted, false));
  }
}

function present(value: FactValue): boolean {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.some((v) => String(v).trim().length > 0);
  if (typeof value === "string") return value.trim().length > 0;
  return true;
}

function numeric(value: FactValue): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function candidates(value: RuleCondition["value"]): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v));
  return [String(value ?? "")];
}

/**
 * One comparison.
 *
 * `exact` distinguishes `equals` from `includes`, and the array case is where
 * the difference matters: `tech_stack equals "go"` asks whether Go is in the
 * stack, while `tech_stack includes "go"` would also match "mongo". Both are
 * useful and only one of them is what somebody usually means, so the exact
 * form is the one spelled `equals`.
 */
function matches(actual: FactValue, wanted: string, exact: boolean): boolean {
  const needle = wanted.trim().toLowerCase();
  if (!needle) return false;

  if (Array.isArray(actual)) {
    return actual.some((item) => {
      const hay = String(item).trim().toLowerCase();
      return exact ? hay === needle : hay.includes(needle);
    });
  }
  if (actual === null || actual === undefined) return false;

  const hay = String(actual).trim().toLowerCase();
  if (!hay) return false;
  return exact ? hay === needle : hay.includes(needle);
}

/* ── Applying a rule set ─────────────────────────────────────────────────── */

export interface RuleTraceEntry {
  ruleId: string;
  name: string;
  effect: RuleEffect;
  /** Points added, for `adjust`. */
  weight?: number;
  /** The floor imposed, for `floor`. */
  floorPriority?: RulePriority;
}

export interface RuleOutcome {
  /** The qualifier's number, untouched. */
  modelScore: number;
  /** After every adjustment, clamped to 0–100. */
  score: number;
  priority: RulePriority;
  /** Set when a veto fired, naming the rule. Becomes the priority reason. */
  vetoedBy: string | null;
  trace: RuleTraceEntry[];
}

/** Highest first. `floor` compares against this, and so does a veto. */
const PRIORITY_ORDER: RulePriority[] = ["hot", "warm", "watch", "ignore"];

function rank(priority: RulePriority): number {
  const index = PRIORITY_ORDER.indexOf(priority);
  return index === -1 ? PRIORITY_ORDER.length : index;
}

/**
 * Applies every active rule to one verdict.
 *
 * Order of resolution, and why it is this order:
 *
 *   1. Adjustments accumulate. Additive, not multiplicative — a customer
 *      reading "+10 for fintech, −15 for under 20 people" can predict the
 *      result, and cannot predict a product of factors.
 *   2. Floors raise the priority. Applied before the veto so that a floor and
 *      a veto on the same opportunity resolve the way a person expects:
 *   3. A veto wins outright. "We never sell to companies in this category" is
 *      a policy, not a preference, and a policy that a strong trigger can
 *      outvote is not one. This is the exact asymmetry §78 asks for, applied
 *      to the customer's own rules rather than to the model's.
 *
 * Every rule that fires appears in the trace, including ones whose effect was
 * then overridden by a veto. A verdict whose explanation omits the rules that
 * nearly changed it is an argument rather than an account.
 */
export function applyRules(
  rules: ScoringRule[],
  facts: RuleFacts,
  verdict: { score: number; priority: RulePriority },
): RuleOutcome {
  const trace: RuleTraceEntry[] = [];
  let score = verdict.score;
  let priority = verdict.priority;
  let vetoedBy: string | null = null;

  const active = rules.filter((rule) => rule.isActive);

  for (const rule of active) {
    let fired: boolean;
    try {
      fired = evaluate(rule.expression, facts);
    } catch {
      /* A stored rule whose expression no longer parses is skipped rather than
         failing the scan. The scan is the expensive part and has already
         happened; losing it because a rule row is malformed would make one bad
         rule an outage. The rule's absence from the trace is the signal. */
      continue;
    }
    if (!fired) continue;

    if (rule.effect === "adjust" && rule.weight !== null) {
      score += rule.weight;
      trace.push({ ruleId: rule.id, name: rule.name, effect: "adjust", weight: rule.weight });
      continue;
    }

    if (rule.effect === "floor" && rule.floorPriority) {
      trace.push({
        ruleId: rule.id,
        name: rule.name,
        effect: "floor",
        floorPriority: rule.floorPriority,
      });
      if (rank(rule.floorPriority) < rank(priority)) priority = rule.floorPriority;
      continue;
    }

    if (rule.effect === "veto") {
      trace.push({ ruleId: rule.id, name: rule.name, effect: "veto" });
      // First veto wins and is the one named. A second would be equally true
      // and reporting a list of them tells the user nothing more about what to
      // do, which is what a priority reason is for.
      vetoedBy ??= rule.name;
    }
  }

  if (vetoedBy) priority = "ignore";

  return {
    modelScore: verdict.score,
    score: Math.max(0, Math.min(100, Math.round(score))),
    priority,
    vetoedBy,
    trace,
  };
}

/**
 * A rule in one English sentence.
 *
 * Rendered on the review screen beside the JSON rather than instead of it. A
 * proposal a person approves on the strength of a summary they cannot check
 * against the thing being stored is the review theatre this whole feature
 * exists to avoid — but a wall of JSON with no gloss is reviewed just as badly,
 * by being skimmed.
 */
export function describeRule(rule: Pick<ScoringRule, "effect" | "weight" | "floorPriority" | "expression">): string {
  const when = describeExpression(rule.expression);
  switch (rule.effect) {
    case "veto":
      return `Never consider a company where ${when}.`;
    case "floor":
      return `Treat a company where ${when} as at least ${rule.floorPriority}.`;
    case "adjust": {
      const w = rule.weight ?? 0;
      return `${w > 0 ? "Add" : "Subtract"} ${Math.abs(w)} points where ${when}.`;
    }
  }
}

export function describeExpression(expression: RuleExpression): string {
  if ("all" in expression) {
    return expression.all.map(describeExpression).join(" and ");
  }
  if ("any" in expression) {
    return `(${expression.any.map(describeExpression).join(" or ")})`;
  }
  if ("not" in expression) {
    return `not (${describeExpression(expression.not)})`;
  }

  const field = expression.field.replace(/^[a-z]+\./, "").replace(/_/g, " ");
  const value = Array.isArray(expression.value)
    ? expression.value.map((v) => `“${v}”`).join(" or ")
    : `“${expression.value}”`;

  switch (expression.op) {
    case "exists":
      return `${field} is known`;
    case "missing":
      return `${field} is not known`;
    case "gte":
      return `${field} is at least ${expression.value}`;
    case "lte":
      return `${field} is at most ${expression.value}`;
    case "equals":
      return `${field} is ${value}`;
    case "includes":
      return `${field} mentions ${value}`;
  }
}
