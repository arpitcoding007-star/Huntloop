/**
 * `draft_scoring_rules` — propose a starting scoring policy from an ICP.
 *
 * ── The problem this solves ──────────────────────────────────────────────
 *
 * Every org begins with zero `scoring_rules`, which means every verdict is the
 * qualifier's unaided judgement against a profile somebody typed in five
 * minutes. That is a reasonable default and a poor destination: the things a
 * salesperson knows that never make it into an ICP — "under twenty people
 * cannot buy this", "if they mention SOC 2 we always win" — are exactly the
 * things a deterministic rule is for, and nobody writes them down unprompted
 * because there is no blank field labelled "what else do you know".
 *
 * So this task writes the first draft, and a person edits it. That is the same
 * shape as `recommend_sources` and for the same reason: a blank list produces
 * nothing, and a filled list produces corrections.
 *
 * ── What makes it safe to let a model write policy ───────────────────────
 *
 * Three things, in descending order of importance.
 *
 * **Nothing it proposes is active.** Every row lands `is_active = false` with
 * `origin = 'drafted'`, and a person activates it one at a time. The reference
 * system Huntloop is a second draft of got this backwards in two different
 * places at once — onboarding auto-approved every pending rule on the way out,
 * and the learning loop inserted its proposals as active on the first click.
 *
 * **The expression language is closed and small.** `RULE_FIELDS` and
 * `RULE_OPERATORS` come from `@huntloop/db/rules`, are compiled into this
 * task's JSON Schema, and are re-checked in `parse()` by the same
 * `validateExpression` the storage path uses. A rule about a field nothing
 * supplies is unrepresentable rather than merely wrong — which matters,
 * because a rule that never fires looks configured and does nothing, and
 * nobody discovers it.
 *
 * **`basis` is constrained to the ICP that was sent.** Same mechanism
 * `recommend_sources` uses, catching the same failure: asked to write scoring
 * rules for anybody, a model will reliably produce "prioritize companies that
 * recently raised funding" — never wrong, never specific, and carrying no
 * information about this customer.
 *
 * ── What it is NOT allowed to touch ──────────────────────────────────────
 *
 * `intent` is metadata. This task sets it, and nothing reads it except a
 * heading on the review screen. The *effect* is `effect`, `weight` and
 * `floorPriority`, stated explicitly, because a taxonomy that silently changes
 * behaviour is decoration that reads like configuration.
 */
import {
  RULE_FIELDS,
  RULE_INTENTS,
  RULE_OPERATORS,
  InvalidRuleError,
  describeRule,
  validateExpression,
  type RuleEffect,
  type RuleExpression,
  type RuleIntent,
  type RulePriority,
} from "@huntloop/db/rules";
import { definePrompt } from "../prompt.ts";
import type { LLMTask } from "../task.ts";
import { UNTRUSTED_CONTENT_RULE, wrapUntrusted } from "../untrusted.ts";
import { icpElements, type IcpSummary } from "./recommend-sources.ts";

export interface DraftRulesInput {
  icp: IcpSummary;
  /** Rules already on file, so the draft does not restate them. */
  existing: { name: string; description: string }[];
}

export interface DraftedRule {
  name: string;
  intent: RuleIntent;
  effect: RuleEffect;
  weight: number | null;
  floorPriority: RulePriority | null;
  expression: RuleExpression;
  /** Why this rule should exist, in a sentence somebody can disagree with. */
  rationale: string;
  /** The ICP element it comes from, verbatim. */
  basis: string;
  /** The rule read back in English, generated here rather than by the model. */
  summary: string;
}

/**
 * Upper bound on one draft.
 *
 * A review limit, exactly as in `recommend_sources`. Eight rules is already
 * more policy than most orgs have ever written down; twenty gets approved
 * wholesale, which is the same as not asking.
 */
export const MAX_DRAFTED_RULES = 8;

const PROMPT = definePrompt(
  "draft_scoring_rules",
  `
You draft a starting scoring policy for one company's prospecting, from their
ideal customer profile. A person reviews every rule you write and activates
them one at a time. Nothing you propose takes effect on its own.

${UNTRUSTED_CONTENT_RULE}

You have no web access on this task.

## What a rule is here

A rule is a condition plus one of three effects. It is evaluated by code, not
by a model, against facts already gathered about a company.

  veto    Never consider a company matching this. A hard exclusion — a policy,
          not a preference. Use it only for things that are genuinely absolute:
          "we cannot sell to companies under 10 people", "we do not work with
          defence". If a strong reason should be able to outweigh it, it is not
          a veto.

  floor   Treat a matching company as at least this priority. Use it where the
          profile names something that, on its own, makes a company worth a
          human look regardless of how the rest scores.

  adjust  Add or subtract points from the score. Signed, between -40 and 40,
          and never zero. Reserve large numbers for things you can defend: ±5
          is a nudge, ±20 is an opinion, ±40 decides the verdict by itself.

## The conditions you may write

Only these fields exist. A rule naming anything else cannot be stored, and
would never fire:

${RULE_FIELDS.map((f) => `  ${f}`).join("\n")}

Only these operators exist:

  equals    exact match, case-insensitive. On a list field, membership.
  includes  substring, case-insensitive. On a list field, a partial member.
  gte, lte  numeric.
  exists    the fact is known and non-empty.
  missing   the fact is not known.

Conditions combine with \`all\`, \`any\` and \`not\`. Keep them shallow — a rule
somebody cannot read back is a rule they cannot review, and an unreviewed rule
is worse than none because it looks deliberate.

## The rule about missing facts

A condition on a fact nobody has gathered is false, not true. Write rules that
say what to do when something IS known. A veto keyed on \`missing\` will exclude
every company Huntloop has not finished researching, which is most of them on
the day they are found.

## Justification

Every rule names the one ICP element it comes from, copied exactly from the
profile you were given. If you cannot point at a specific segment, size band,
region, trigger or exclusion, do not write the rule.

This exists to stop one particular answer. Asked to write scoring rules, it is
easy to produce the ones that are true of every B2B company — recently funded
is good, tiny is bad, hiring is a signal. They are also what you would have
written for any other customer, which means they say nothing about this one.
The rules worth having are the ones that would look strange on somebody else's
account.

## Exclusions are the best source of vetoes

The profile lists who is never a fit. Those are the sentences most likely to
deserve a \`veto\`, and they are the ones a person would otherwise have to
think to write down.

## How many

At most ${MAX_DRAFTED_RULES}. Four you can each defend beats eight where half
are filler. If the profile is thin, write only what it supports — returning
two rules is a valid answer and returning none is better than padding.

Do not restate a rule that already exists. You are given the current list.

## \`intent\`

Label each rule \`prioritize\`, \`reject\`, \`boost\` or \`penalty\`. This is for
grouping on the review screen and has no effect on anything. The effect is what
you put in \`effect\`.
`,
);

export const draftScoringRules: LLMTask<DraftRulesInput, DraftedRule[]> = {
  name: "draft_scoring_rules",
  prompt: PROMPT,
  // No fetching; the output is a short structured list. Headroom for adaptive
  // thinking over a profile, which is where the work is.
  maxTokens: 20_000,

  schema: (input) => {
    const elements = icpElements(input.icp);
    if (!elements.length) {
      /* Same refusal `recommend_sources` makes, for the same reason: an enum
         with no members is a 400 with nothing useful in it, and the real
         problem is that there is no profile to draft from. */
      throw new Error(
        "draft_scoring_rules: the ICP is empty. There is nothing to draft rules from.",
      );
    }

    /* The condition schema, one level deep, then referenced recursively. JSON
       Schema `$ref` into `$defs` is what keeps this from being written out
       four times for four nesting levels — and the depth bound is enforced in
       `validateExpression`, not here, because a schema cannot count depth. */
    const condition = {
      type: "object",
      additionalProperties: false,
      required: ["field", "op"],
      properties: {
        field: { type: "string", enum: [...RULE_FIELDS] },
        op: { type: "string", enum: [...RULE_OPERATORS] },
        value: {
          anyOf: [
            { type: "string" },
            { type: "number" },
            { type: "array", items: { type: "string" } },
          ],
        },
      },
    };

    const expression = {
      anyOf: [
        condition,
        {
          type: "object",
          additionalProperties: false,
          required: ["all"],
          properties: { all: { type: "array", minItems: 1, items: condition } },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["any"],
          properties: { any: { type: "array", minItems: 1, items: condition } },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["not"],
          properties: { not: condition },
        },
      ],
    };

    return {
      type: "object",
      additionalProperties: false,
      required: ["rules"],
      properties: {
        rules: {
          type: "array",
          maxItems: MAX_DRAFTED_RULES,
          items: {
            type: "object",
            additionalProperties: false,
            required: [
              "name",
              "intent",
              "effect",
              "weight",
              "floorPriority",
              "expression",
              "rationale",
              "basis",
            ],
            properties: {
              name: { type: "string" },
              intent: { type: "string", enum: [...RULE_INTENTS] },
              effect: { type: "string", enum: ["adjust", "veto", "floor"] },
              weight: { anyOf: [{ type: "number" }, { type: "null" }] },
              floorPriority: {
                anyOf: [{ type: "string", enum: ["hot", "warm", "watch"] }, { type: "null" }],
              },
              expression,
              rationale: { type: "string" },
              // The closed set that makes an invented justification
              // unrepresentable rather than merely detectable.
              basis: { type: "string", enum: elements },
            },
          },
        },
      },
    };
  },

  renderInput: (input) => {
    const list = (values: string[]) =>
      values.length ? values.map((v) => `  - ${v}`).join("\n") : "  (none given)";

    const profile = [
      `What they sell: ${input.icp.sells || "(not stated)"}`,
      "",
      "Segments:",
      list(input.icp.segments),
      "",
      "Company sizes:",
      list(input.icp.sizes),
      "",
      "Regions:",
      list(input.icp.regions),
      "",
      "Buying triggers:",
      list(input.icp.triggers),
      "",
      "Never a fit:",
      list(input.icp.exclusions),
    ].join("\n");

    const existing = input.existing.length
      ? input.existing.map((r) => `  - ${r.name}: ${r.description}`).join("\n")
      : "  (none yet)";

    return [
      "Draft a starting scoring policy for this ideal customer profile.",
      "",
      /* Wrapped as untrusted for the reason `recommend_sources` gives: `sells`
         is written by a model that read a website, and the ICP step pre-fills
         from the same place. Text that has been through a fetched page stays
         untrusted however many people have edited it since. */
      wrapUntrusted("ideal customer profile", profile),
      "",
      "Rules that already exist — do not restate these:",
      existing,
      "",
      "Copy each `basis` exactly from the segments, sizes, regions, triggers, " +
        "exclusions, or the what-they-sell line above.",
    ].join("\n");
  },

  // No fetchDomains: this task gets no web tool at all.

  entity: () => ({ type: "icp", id: null }),

  parse: (json, input) => {
    if (!json || typeof json !== "object") {
      throw new Error("draft_scoring_rules: response was not an object.");
    }
    const raw = (json as { rules?: unknown }).rules;
    if (!Array.isArray(raw)) {
      throw new Error("draft_scoring_rules: response carried no rules array.");
    }
    if (raw.length > MAX_DRAFTED_RULES) {
      throw new Error(
        `draft_scoring_rules: ${raw.length} rules, more than the ` +
          `${MAX_DRAFTED_RULES} a person will actually review.`,
      );
    }

    const allowed = new Map(
      icpElements(input.icp).map((element) => [normalize(element), element]),
    );
    if (!allowed.size) {
      throw new Error(
        "draft_scoring_rules: the ICP is empty. There is nothing to draft rules from.",
      );
    }

    const seen = new Set<string>();
    const drafted: DraftedRule[] = [];

    for (const item of raw as RawRule[]) {
      const name = typeof item.name === "string" ? item.name.trim() : "";
      if (!name) throw new Error("draft_scoring_rules: a rule has no name.");
      if (seen.has(normalize(name))) {
        throw new Error(`draft_scoring_rules: two rules are both called ${JSON.stringify(name)}.`);
      }
      seen.add(normalize(name));

      const rationale = typeof item.rationale === "string" ? item.rationale.trim() : "";
      if (!rationale) {
        /* A rule with no stated reason cannot be reviewed, only trusted — and
           this one, unlike a source recommendation, then runs against every
           company the org ever sees. */
        throw new Error(
          `draft_scoring_rules: ${name} carries no reason. A rule the user cannot ` +
            `evaluate is one they can only accept on faith, and it will decide ` +
            `verdicts long after they have forgotten approving it.`,
        );
      }

      const basisRaw = typeof item.basis === "string" ? item.basis.trim() : "";
      const basis = allowed.get(normalize(basisRaw));
      if (!basis) {
        throw new Error(
          `draft_scoring_rules: ${name} is justified by ${JSON.stringify(basisRaw)}, ` +
            `which is not in this ICP. A rule citing a criterion the user never ` +
            `wrote is not traceable to anything.`,
        );
      }

      const intent = item.intent;
      if (typeof intent !== "string" || !(RULE_INTENTS as readonly string[]).includes(intent)) {
        throw new Error(
          `draft_scoring_rules: ${name} has an unknown intent ${JSON.stringify(intent)}.`,
        );
      }

      const effect = item.effect;
      if (effect !== "adjust" && effect !== "veto" && effect !== "floor") {
        throw new Error(
          `draft_scoring_rules: ${name} has an unknown effect ${JSON.stringify(effect)}.`,
        );
      }

      let expression: RuleExpression;
      try {
        expression = validateExpression(item.expression);
      } catch (error) {
        if (error instanceof InvalidRuleError) {
          throw new Error(`draft_scoring_rules: ${name} — ${error.message}`);
        }
        throw error;
      }

      /* The effect and its arguments are checked here rather than left to the
         CHECK constraint in `0010`. The constraint is what makes it true; this
         is what makes the failure say which rule and why, in a run somebody can
         attribute to a prompt version — rather than a 23514 during an insert
         three screens later. */
      let weight: number | null = null;
      let floorPriority: RulePriority | null = null;

      if (effect === "adjust") {
        const value = typeof item.weight === "number" ? item.weight : Number(item.weight);
        if (!Number.isFinite(value)) {
          throw new Error(`draft_scoring_rules: ${name} adjusts the score by no amount.`);
        }
        const rounded = Math.round(value);
        if (rounded === 0) {
          throw new Error(
            `draft_scoring_rules: ${name} adjusts by zero, which is a rule that ` +
              `does nothing while appearing to do something.`,
          );
        }
        if (rounded < -40 || rounded > 40) {
          throw new Error(
            `draft_scoring_rules: ${name} adjusts by ${rounded}, outside ±40. ` +
              `Past that one rule decides every verdict on its own — which is ` +
              `exactly what an unvalidated weight produces.`,
          );
        }
        weight = rounded;
      }

      if (effect === "floor") {
        const priority = item.floorPriority;
        if (priority !== "hot" && priority !== "warm" && priority !== "watch") {
          throw new Error(
            `draft_scoring_rules: ${name} floors at ${JSON.stringify(priority)}, ` +
              `which is not a priority a floor can raise to.`,
          );
        }
        floorPriority = priority;
      }

      drafted.push({
        name,
        intent: intent as RuleIntent,
        effect,
        weight,
        floorPriority,
        expression,
        rationale,
        basis,
        /* Generated here, from the stored shape, rather than taken from the
           model. A summary the model writes is a second description that can
           disagree with the rule — and the disagreement would be invisible on
           the review screen, which is the one place it must not be. */
        summary: describeRule({ effect, weight, floorPriority, expression }),
      });
    }

    return drafted;
  },
};

interface RawRule {
  name?: unknown;
  intent?: unknown;
  effect?: unknown;
  weight?: unknown;
  floorPriority?: unknown;
  expression?: unknown;
  rationale?: unknown;
  basis?: unknown;
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}
