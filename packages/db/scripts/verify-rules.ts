/**
 * The scoring-rule language, exercised without a database.
 *
 * `verify-migrations.ts` proves the *schema* enforces its own rules. This
 * proves the evaluator does — and the two are separate because the evaluator is
 * the half that can be wrong silently. A CHECK constraint that stops working
 * throws; a rule that stops firing does nothing, and nothing is what a rule
 * that never matched also does.
 *
 * The most important test in this file is the last one, and it is a negative:
 * `intent` must not affect evaluation. `0010` adds that column as metadata for
 * grouping rules on a review screen, and the entire justification for adding it
 * at all is that it is inert. A taxonomy that quietly changes behaviour is the
 * central defect of the system this feature was migrated from — six rule types
 * and signed weights that were never once used in arithmetic — and the failure
 * mode of getting it wrong here is the opposite and worse: a label that *does*
 * something nobody reading the rule would expect.
 *
 *   npm run test:rules --workspace @huntloop/db
 */
import {
  applyRules,
  describeRule,
  evaluate,
  validateExpression,
  validateRule,
  type RuleExpression,
  type RuleFacts,
  type ScoringRule,
} from "../src/rules.ts";

let failures = 0;
let checks = 0;

function ok(name: string) {
  checks++;
  console.log(`  ✓ ${name}`);
}

function fail(name: string, detail: unknown) {
  checks++;
  failures++;
  console.error(`  ✗ ${name}\n      ${String(detail).split("\n")[0]}`);
}

function expect(name: string, condition: boolean, detail = "expected true") {
  if (condition) ok(name);
  else fail(name, detail);
}

function expectEqual(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) ok(name);
  else fail(name, `got ${a}, wanted ${b}`);
}

function expectThrows(name: string, fn: () => unknown, matching?: RegExp) {
  try {
    fn();
    fail(name, "did not throw");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (matching && !matching.test(message)) fail(name, `threw the wrong thing: ${message}`);
    else ok(name);
  }
}

const rule = (overrides: Partial<ScoringRule> = {}): ScoringRule => ({
  id: "rule_1",
  name: "A rule",
  expression: { field: "company.industry", op: "equals", value: "fintech" },
  effect: "adjust",
  weight: 10,
  floorPriority: null,
  intent: null,
  rationale: null,
  basis: null,
  origin: "user",
  isActive: true,
  ...overrides,
});

const FACTS: RuleFacts = {
  "company.name": "Northwind Labs",
  "company.industry": "Fintech",
  "company.employee_count": 120,
  "company.tech_stack": ["Go", "Postgres", "MongoDB"],
  "company.description": "Payments infrastructure for marketplaces.",
  "evidence.claims": ["They are hiring platform engineers."],
  "signals.event_types": ["funding", "hiring"],
  "score.model_score": 70,
  "score.priority": "warm",
};

/* ── Operators ───────────────────────────────────────────────────────────── */

console.log("\nOperators — comparison is case-insensitive and never coerces silently");
{
  expect(
    "equals matches regardless of case",
    evaluate({ field: "company.industry", op: "equals", value: "fintech" }, FACTS),
  );
  expect(
    "equals does not match a substring",
    !evaluate({ field: "company.industry", op: "equals", value: "fin" }, FACTS),
  );
  expect(
    "includes does",
    evaluate({ field: "company.description", op: "includes", value: "payments" }, FACTS),
  );
  expect(
    "equals on a list is exact membership",
    evaluate({ field: "company.tech_stack", op: "equals", value: "go" }, FACTS),
  );
  expect(
    "so `go` does not match `mongo`",
    !evaluate({ field: "company.tech_stack", op: "equals", value: "mong" }, FACTS),
  );
  expect(
    "includes on a list does match a partial member",
    evaluate({ field: "company.tech_stack", op: "includes", value: "mong" }, FACTS),
  );
  expect(
    "a list of candidates matches any of them",
    evaluate(
      { field: "company.industry", op: "equals", value: ["insurtech", "fintech"] },
      FACTS,
    ),
  );
  expect("gte compares numerically", evaluate({ field: "company.employee_count", op: "gte", value: 100 }, FACTS));
  expect("lte too", evaluate({ field: "company.employee_count", op: "lte", value: 100 }, FACTS) === false);
  expect("exists is true for a known fact", evaluate({ field: "company.name", op: "exists" }, FACTS));
  expect("and false for an absent one", !evaluate({ field: "company.country", op: "exists" }, FACTS));
  expect("missing is its inverse", evaluate({ field: "company.country", op: "missing" }, FACTS));
}

console.log("\nAbsent facts are false, never true");
{
  /* The rule that decides how this language behaves on incomplete data, which
     is most data. "We do not know their headcount" has not satisfied "their
     headcount is under ten", and treating it as though it had would let a veto
     exclude every company Huntloop has not finished researching — which on the
     day a company is found is all of them. */
  expect(
    "a numeric comparison on an unknown fact is false",
    !evaluate({ field: "company.employee_count", op: "lte", value: 9 }, {}),
  );
  expect(
    "so is a string comparison",
    !evaluate({ field: "company.industry", op: "equals", value: "fintech" }, {}),
  );
  expect(
    "an empty string is absent, not empty",
    !evaluate({ field: "company.industry", op: "exists" }, { "company.industry": "   " }),
  );
  expect(
    "an empty list is absent too",
    !evaluate({ field: "company.tech_stack", op: "exists" }, { "company.tech_stack": [] }),
  );
  expect(
    "and `not` over an absent fact is true — negation of false, not a third state",
    evaluate({ not: { field: "company.industry", op: "equals", value: "fintech" } }, {}),
  );
}

console.log("\nCombinators");
{
  const all: RuleExpression = {
    all: [
      { field: "company.industry", op: "equals", value: "fintech" },
      { field: "company.employee_count", op: "gte", value: 100 },
    ],
  };
  expect("all requires every branch", evaluate(all, FACTS));
  expect(
    "and fails when one does not hold",
    !evaluate(all, { ...FACTS, "company.employee_count": 20 }),
  );
  expect(
    "any requires one",
    evaluate(
      {
        any: [
          { field: "company.industry", op: "equals", value: "insurtech" },
          { field: "signals.event_types", op: "equals", value: "funding" },
        ],
      },
      FACTS,
    ),
  );
}

/* ── Validation ──────────────────────────────────────────────────────────── */

console.log("\nValidation — a rule that cannot fire is refused rather than stored");
{
  expectThrows(
    "a field nothing supplies",
    () => validateExpression({ field: "company.vibes", op: "equals", value: "good" }),
    /not something a rule can ask about/,
  );
  expectThrows(
    "an operator this language does not have",
    () => validateExpression({ field: "company.name", op: "regex", value: "x" }),
    /not an operator/,
  );
  expectThrows(
    "a comparison with nothing to compare against",
    () => validateExpression({ field: "company.name", op: "equals" }),
    /needs something to compare/,
  );
  expectThrows(
    "a numeric comparison given a word",
    () => validateExpression({ field: "company.employee_count", op: "gte", value: "many" }),
    /needs a number/,
  );
  expectThrows(
    "an empty `all`",
    () => validateExpression({ all: [] }),
    /at least one condition/,
  );
  expectThrows(
    "nesting deeper than anybody reviewing it can follow",
    () =>
      validateExpression({
        all: [{ any: [{ not: { all: [{ any: [{ field: "company.name", op: "exists" }] }] } }] }],
      }),
    /nobody reviewing it can tell what it does/,
  );

  const parsed = validateExpression({ field: "company.employee_count", op: "gte", value: "50" });
  expectEqual(
    "a numeric string is normalised to a number, so the rule reads correctly everywhere",
    parsed,
    { field: "company.employee_count", op: "gte", value: 50 },
  );
}

console.log("\nValidation — an effect and its arguments have to agree");
{
  expectThrows(
    "an adjusting rule with no weight does nothing",
    () => validateRule(rule({ weight: null })),
    /needs a weight/,
  );
  expectThrows("a zero weight is the same", () => validateRule(rule({ weight: 0 })), /does nothing/);
  expectThrows(
    "a weight past ±40 would decide every verdict alone",
    () => validateRule(rule({ weight: 500 })),
    /outside ±40/,
  );
  expectThrows(
    "a floor rule with nothing to floor to",
    () => validateRule(rule({ effect: "floor", weight: null, floorPriority: null })),
    /needs a priority/,
  );
  expectThrows(
    "flooring at `ignore` is not a floor — that rule is a veto",
    () => validateRule(rule({ effect: "floor", weight: null, floorPriority: "ignore" })),
    /effect `veto`/,
  );
  expectThrows(
    "a veto carrying a weight is confused about what it does",
    () => validateRule(rule({ effect: "veto", weight: 10 })),
    /takes no weight/,
  );
  try {
    validateRule(rule({ effect: "floor", weight: null, floorPriority: "warm" }));
    ok("a coherent floor rule is accepted");
  } catch (e) {
    fail("a coherent floor rule is accepted", e);
  }
}

/* ── Application ─────────────────────────────────────────────────────────── */

console.log("\nApplying rules — the model's number survives alongside the customer's");
{
  const outcome = applyRules([rule({ weight: 12 })], FACTS, { score: 70, priority: "warm" });
  expectEqual("the adjustment is applied", outcome.score, 82);
  expectEqual("and the model's own score is kept untouched", outcome.modelScore, 70);
  expectEqual("the trace names the rule that did it", outcome.trace.length, 1);
  expectEqual("with the amount", outcome.trace[0]!.weight, 12);
}
{
  const outcome = applyRules([rule({ weight: 40 }), rule({ id: "r2", weight: 40 })], FACTS, {
    score: 70,
    priority: "warm",
  });
  expectEqual("adjustments accumulate, and the result is clamped to 100", outcome.score, 100);
}
{
  const outcome = applyRules([rule({ weight: -40 }), rule({ id: "r2", weight: -40 })], FACTS, {
    score: 30,
    priority: "warm",
  });
  expectEqual("and clamped at zero on the way down", outcome.score, 0);
}
{
  const inactive = applyRules([rule({ isActive: false, weight: 30 })], FACTS, {
    score: 50,
    priority: "warm",
  });
  expectEqual("an inactive rule does nothing", inactive.score, 50);
  expectEqual("and does not appear in the trace", inactive.trace, []);
}
{
  const nonMatching = applyRules(
    [rule({ expression: { field: "company.industry", op: "equals", value: "insurtech" } })],
    FACTS,
    { score: 50, priority: "warm" },
  );
  expectEqual("a rule that does not match leaves the score alone", nonMatching.score, 50);
}

console.log("\nApplying rules — a veto is a policy, and policies are not outvoted");
{
  const outcome = applyRules(
    [
      rule({ id: "boost", weight: 40 }),
      rule({ id: "floor", effect: "floor", weight: null, floorPriority: "hot" }),
      rule({ id: "veto", effect: "veto", weight: null, name: "Never fintech" }),
    ],
    FACTS,
    { score: 60, priority: "watch" },
  );
  expectEqual("the veto wins outright", outcome.priority, "ignore");
  expectEqual("and names itself, so the reason can say which rule", outcome.vetoedBy, "Never fintech");
  expectEqual(
    "every rule that fired is still traced, including the ones it overrode",
    outcome.trace.length,
    3,
  );
  expectEqual(
    "the score is still computed — the verdict changed, the arithmetic did not vanish",
    outcome.score,
    100,
  );
}
{
  const outcome = applyRules(
    [rule({ effect: "floor", weight: null, floorPriority: "hot" })],
    FACTS,
    { score: 40, priority: "watch" },
  );
  expectEqual("a floor raises the priority", outcome.priority, "hot");
}
{
  const outcome = applyRules(
    [rule({ effect: "floor", weight: null, floorPriority: "watch" })],
    FACTS,
    { score: 90, priority: "hot" },
  );
  expectEqual("and never lowers it — it is a floor, not a setting", outcome.priority, "hot");
}
{
  /* A stored rule whose expression no longer parses is skipped rather than
     throwing. The scan that produced the verdict is the expensive part and has
     already happened; one malformed row must not turn into an outage. */
  const broken = { ...rule(), expression: { field: "nope", op: "equals", value: "x" } as unknown as RuleExpression };
  const outcome = applyRules([broken], FACTS, { score: 50, priority: "warm" });
  expectEqual("a malformed rule is skipped, not thrown", outcome.score, 50);
  expectEqual("and its absence from the trace is the signal", outcome.trace, []);
}

/* ── The one that matters ────────────────────────────────────────────────── */

console.log("\n`intent` is inert — the negative test this column's existence depends on");
{
  const base = {
    expression: { field: "company.industry", op: "equals", value: "fintech" } as RuleExpression,
    effect: "adjust" as const,
    weight: 15,
    floorPriority: null,
  };

  const outcomes = (["prioritize", "reject", "boost", "penalty", null] as const).map((intent) =>
    applyRules([rule({ ...base, intent })], FACTS, { score: 50, priority: "warm" }),
  );

  const scores = outcomes.map((o) => o.score);
  const priorities = outcomes.map((o) => o.priority);

  expectEqual(
    "five rules with identical effects and different intents produce identical scores",
    scores,
    [65, 65, 65, 65, 65],
  );
  expectEqual("and identical priorities", priorities, ["warm", "warm", "warm", "warm", "warm"]);
  expect(
    "a `reject` intent does not reject anything",
    outcomes[1]!.vetoedBy === null,
    String(outcomes[1]!.vetoedBy),
  );
  expect(
    "and a `penalty` intent does not subtract",
    outcomes[3]!.score === 65,
    String(outcomes[3]!.score),
  );

  /* The description too. If `intent` leaked into the sentence on the review
     screen, two rules that behave identically would read differently — which
     is the same defect one layer up, where a person makes the decision. */
  const described = (["prioritize", "penalty"] as const).map((intent) =>
    describeRule(rule({ ...base, intent })),
  );
  expectEqual("and it does not change how the rule reads back either", described[0], described[1]);
}

console.log("\nDescriptions — the sentence is generated from the shape, so it cannot drift");
{
  expectEqual(
    "a veto",
    describeRule({
      effect: "veto",
      weight: null,
      floorPriority: null,
      expression: { field: "company.employee_count", op: "lte", value: 9 },
    }),
    "Never consider a company where employee count is at most 9.",
  );
  expectEqual(
    "a floor",
    describeRule({
      effect: "floor",
      weight: null,
      floorPriority: "warm",
      expression: { field: "signals.event_types", op: "equals", value: "funding" },
    }),
    "Treat a company where event types is “funding” as at least warm.",
  );
  expectEqual(
    "a negative adjustment reads as a subtraction rather than as adding a negative",
    describeRule({
      effect: "adjust",
      weight: -15,
      floorPriority: null,
      expression: { field: "company.industry", op: "equals", value: "retail" },
    }),
    "Subtract 15 points where industry is “retail”.",
  );
}

console.log(
  `\n${failures === 0 ? "PASS" : "FAIL"} — ${checks - failures}/${checks} checks passed\n`,
);
process.exit(failures === 0 ? 0 : 1);
