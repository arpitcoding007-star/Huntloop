/**
 * `analyze_performance` — read what actually happened, and say what to change.
 *
 * ── The stage this closes ────────────────────────────────────────────────
 *
 * Huntloop's loop is Discover → Understand → Qualify → Prioritize → Act →
 * Track → **Learn**. Every stage but the last has had an implementation since
 * the engine was written. `outcomes` has recorded replies, meetings and losses
 * from the beginning; `ai_decisions.human_override` has recorded every place a
 * person disagreed with the product, which `0004`'s own comment calls the only
 * labelled data this product gets for free. Nothing read either of them.
 *
 * A learning loop that only writes is not a loop. This is the read.
 *
 * ── Why the output is a list of findings and not a report ────────────────
 *
 * The reference system Huntloop is a second draft of produced one row per
 * analysis: eight arrays of free-text strings, approved or archived as a unit.
 * A report containing one good idea and four bad ones therefore offered a
 * choice between applying all five and applying none — and since approving
 * inserted every proposed rule as immediately active, the cheap option was to
 * approve. That is review theatre.
 *
 * So a finding here is a row. It is approved or rejected on its own, it says
 * what it rests on, and approving it produces exactly one thing: a scoring
 * rule, or a memory. Nothing else in the system changes.
 *
 * ── Citations are ids, not names ─────────────────────────────────────────
 *
 * The reference system wrote `best_sources: ["LinkedIn — Series B buyers"]`, a
 * string that matched a source's name by convention. Rename the source and the
 * finding silently became about nothing; delete it and the finding still read
 * as authoritative.
 *
 * Every citation here is constrained to a closed enum built from the ids that
 * were actually sent — the same mechanism `recommend_sources` uses for `basis`
 * and `personalize_message` uses for `citedEvidenceIds`. That makes a citation
 * to another tenant's row *unrepresentable* rather than merely detectable,
 * which matters more here than anywhere else in the product: a learning
 * finding is written to be read and acted on by a person, so a cross-tenant id
 * leaking into one would be laundered into a human decision before anybody
 * checked it.
 *
 * ── Why it is allowed to conclude nothing ────────────────────────────────
 *
 * An empty list is a valid answer and the prompt says so twice. The pressure
 * on a task like this is entirely one-way: a run that produces no findings
 * looks broken, so the tempting failure is to always produce three. Three
 * plausible findings drawn from eleven outcomes is not learning, it is
 * numerology with a citation format.
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

/* ── Input ───────────────────────────────────────────────────────────────── */

/** One thing that happened, with the opportunity it happened to. */
export interface OutcomeRecord {
  opportunityId: string;
  companyId: string;
  companyName: string;
  /** Where the company came from, when Huntloop knows. */
  sourceId: string | null;
  sourceName: string | null;
  kind: "reply" | "positive" | "meeting" | "proposal" | "won" | "lost";
  occurredAt: string;
  /** The verdict Huntloop gave before any of this happened. */
  priority: string | null;
  /** The qualifier's own number, before the customer's rules touched it. */
  modelScore: number | null;
  /** How stale the trigger was when the opportunity was created, in days. */
  triggerAgeDays: number | null;
  industry: string | null;
  employeeCount: number | null;
}

/** A place a person disagreed with the product, or rated it. */
export interface DecisionRecord {
  decisionType: string;
  opportunityId: string | null;
  companyId: string | null;
  /** Present when somebody corrected the output. */
  overridden: boolean;
  /** Present when somebody rated it without correcting it. */
  rating: "excellent" | "good" | "average" | "poor" | null;
  note: string | null;
  occurredAt: string;
}

/** A source, with what it has produced. Sources with nothing are included. */
export interface SourcePerformance {
  sourceId: string;
  name: string;
  kind: string;
  companiesFound: number;
  opportunitiesCreated: number;
  outcomes: number;
  wins: number;
}

export interface AnalyzeInput {
  windowStart: string;
  windowEnd: string;
  outcomes: OutcomeRecord[];
  decisions: DecisionRecord[];
  sources: SourcePerformance[];
  /** What the policy already says, so a finding does not propose it again. */
  existingRules: { name: string; description: string }[];
  /** House style already on file, for the same reason. */
  existingGuidance: string[];
}

/* ── Output ──────────────────────────────────────────────────────────────── */

export const FINDING_KINDS = [
  "source_performance",
  "scoring_adjustment",
  "style_guidance",
  "icp_refinement",
] as const;

export type FindingKind = (typeof FINDING_KINDS)[number];

/** A scoring rule a finding proposes. Same language the engine evaluates. */
export interface RuleProposal {
  type: "scoring_rule";
  name: string;
  intent: RuleIntent;
  effect: RuleEffect;
  weight: number | null;
  floorPriority: RulePriority | null;
  expression: RuleExpression;
  /** The rule read back in English. Generated here, never by the model. */
  summary: string;
}

/** A durable note for the org. Lands in `memories`, scope `organization`. */
export interface MemoryProposal {
  type: "memory";
  key: string | null;
  content: string;
}

export type FindingProposal = RuleProposal | MemoryProposal;

export interface Finding {
  kind: FindingKind;
  headline: string;
  detail: string;
  recommendation: string;
  confidence: "low" | "medium" | "high";
  citedOpportunityIds: string[];
  citedCompanyIds: string[];
  citedSourceIds: string[];
  supportingCount: number;
  contradictingCount: number;
  /** Null where a finding is worth reading and not worth automating. */
  proposal: FindingProposal | null;
}

export interface PerformanceAnalysis {
  /** What the window looked like overall. Shown above the findings. */
  summary: string;
  findings: Finding[];
}

/**
 * How much has to have happened before this runs at all.
 *
 * A signal is an outcome, a human override, or a quality rating. Eight is not
 * a statistical threshold — nothing here is doing statistics — it is the point
 * below which a model asked for patterns will find them anyway, and a
 * confidently-worded finding drawn from three replies is worse than silence
 * because somebody will change a rule on the strength of it.
 *
 * The reference system got this right and it is the one thing worth copying
 * from it verbatim: it refused below three feedback rows, with a specific and
 * actionable message rather than a generic error.
 */
export const MIN_LEARNING_SIGNALS = 8;

export const MAX_FINDINGS = 10;

export function countSignals(input: {
  outcomes: unknown[];
  decisions: DecisionRecord[];
}): number {
  return (
    input.outcomes.length +
    input.decisions.filter((d) => d.overridden || d.rating !== null).length
  );
}

const PROMPT = definePrompt(
  "analyze_performance",
  `
You read what happened to one company's prospecting over a period, and you say
what should change. A person reviews each of your findings on its own and
accepts or rejects it. Nothing you write takes effect by itself.

${UNTRUSTED_CONTENT_RULE}

You have no web access on this task. Everything you conclude comes from the
records you were given.

## What you are looking for

Patterns that connect something Huntloop *decided* to something that then
*happened*. The decisions are the priority it assigned, the score it gave, the
source a company came from, and the places a person overrode or rated the
output. The outcomes are replies, meetings, proposals, wins and losses.

The useful shape is always the same: "opportunities with property X converted
at a visibly different rate to the rest, and here are the ones I mean."

## The rule that matters most

Every finding cites the actual records it rests on, by id, from the ids you
were given. Not the company's name — the id. If you cannot point at specific
opportunities, companies or sources, you have not found a pattern; you have
written a plausible sentence.

Say how many records support the finding and how many contradict it. A pattern
with nine supporting and eight contradicting is not a pattern, and reporting
both numbers is what makes that visible to the person reviewing it.

## When to conclude nothing

Often. Return an empty findings list when the period does not support a real
conclusion, and say so in the summary.

This is the answer under the most pressure, so it is worth being direct about:
a run that finds nothing looks like a broken feature, and the way that failure
expresses itself is three confident findings drawn from a handful of records.
Do not do that. Nobody is harmed by "not enough happened yet to tell". Somebody
is harmed by a scoring rule derived from four replies.

## Confidence

  high    Many records, one direction, an obvious mechanism.
  medium  A real pattern with exceptions, or a small but unambiguous one.
  low     Worth a person looking at. Not worth changing a rule over.

Most findings are medium or low. A first analysis producing three \`high\`
findings is a report about the model's confidence, not about the customer.

## Kinds

  source_performance  A source produces outcomes, or has produced none at all.
                      A source with zero companies found is a configuration
                      problem, not a quality signal — say which you think it is.
  scoring_adjustment  Something Huntloop scores should be scored differently.
  style_guidance      Something about how outreach is written, drawn from
                      replies and overrides — not from taste.
  icp_refinement      The profile itself is off: a segment that never converts,
                      or one that does and is not in it.

## Proposals

A finding may carry a proposal, which is what accepting it will actually do.
Two kinds, and a finding may carry neither:

  scoring_rule  A condition and an effect, in the language below. Propose one
                only where the pattern is mechanical enough to be a rule. "Deals
                go better when we mention their migration" is real and is not a
                rule; it is guidance.

  memory        A durable note added to the org's context, which every future
                message and qualification reads. Keep it to one or two
                sentences that change what somebody does.

Leave \`proposal\` null when the finding is worth knowing and not worth
automating. That is a common and correct answer — a finding whose only honest
recommendation is "look at this" should say so and propose nothing.

### The scoring-rule language

Fields, and nothing else:

${RULE_FIELDS.map((f) => `  ${f}`).join("\n")}

Operators: equals, includes, gte, lte, exists, missing. Combine with \`all\`,
\`any\`, \`not\`. Keep it shallow enough to read back.

Effects:

  veto    Never consider a matching company. Absolute. Almost never the right
          conclusion from an analysis — an exclusion belongs in the profile,
          decided by a person, not inferred from a quarter of outcomes.
  floor   Treat a matching company as at least this priority.
  adjust  Add or subtract points. Between -40 and 40, never zero. From this
          data, ±5 to ±15 is the defensible range: you are reading tens of
          records, not thousands.

A condition on a fact nobody gathers is false, not true, so a rule keyed on
\`missing\` will fire on every company Huntloop has not finished researching.

## What you must not do

Do not propose a rule that already exists. You are given the current policy.
Do not restate guidance already on file.

Do not explain an outcome by something you were not shown. You do not know what
was said on the calls, who else they were talking to, or what the market did.
"They went quiet because of budget freezes" is a story; "seven of nine losses
were companies under 50 people" is a finding.

Do not treat \`score\` as the model's opinion where a customer's rule changed it.
The score you are given is the qualifier's own, before any rule ran — that is
deliberate, and it is what lets you say whether the qualifier was right.
`,
);

export const analyzePerformance: LLMTask<AnalyzeInput, PerformanceAnalysis> = {
  name: "analyze_performance",
  prompt: PROMPT,
  /* The largest budget in the product. The input is the biggest — up to a few
     hundred records — and the reasoning is the point rather than a step on the
     way to something. */
  maxTokens: 32_000,

  schema: (input) => {
    const opportunityIds = unique(input.outcomes.map((o) => o.opportunityId));
    const companyIds = unique(input.outcomes.map((o) => o.companyId));
    const sourceIds = unique([
      ...input.sources.map((s) => s.sourceId),
      ...input.outcomes.map((o) => o.sourceId).filter((id): id is string => Boolean(id)),
    ]);

    /* An empty enum is not a valid schema, so a citation array with no
       candidates is declared as an always-empty array instead. That is the
       honest encoding: there is genuinely nothing to cite, and the alternative
       — omitting the constraint — would let the one case with no valid ids be
       the one case where any id is accepted. */
    const citations = (ids: string[]) =>
      ids.length
        ? { type: "array", items: { type: "string", enum: ids } }
        : { type: "array", maxItems: 0, items: { type: "string" } };

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

    const ruleProposal = {
      type: "object",
      additionalProperties: false,
      required: ["type", "name", "intent", "effect", "weight", "floorPriority", "expression"],
      properties: {
        type: { type: "string", enum: ["scoring_rule"] },
        name: { type: "string" },
        intent: { type: "string", enum: [...RULE_INTENTS] },
        effect: { type: "string", enum: ["adjust", "veto", "floor"] },
        weight: { anyOf: [{ type: "number" }, { type: "null" }] },
        floorPriority: {
          anyOf: [{ type: "string", enum: ["hot", "warm", "watch"] }, { type: "null" }],
        },
        expression,
      },
    };

    const memoryProposal = {
      type: "object",
      additionalProperties: false,
      required: ["type", "key", "content"],
      properties: {
        type: { type: "string", enum: ["memory"] },
        key: { anyOf: [{ type: "string" }, { type: "null" }] },
        content: { type: "string" },
      },
    };

    return {
      type: "object",
      additionalProperties: false,
      required: ["summary", "findings"],
      properties: {
        summary: { type: "string" },
        findings: {
          type: "array",
          maxItems: MAX_FINDINGS,
          items: {
            type: "object",
            additionalProperties: false,
            required: [
              "kind",
              "headline",
              "detail",
              "recommendation",
              "confidence",
              "citedOpportunityIds",
              "citedCompanyIds",
              "citedSourceIds",
              "supportingCount",
              "contradictingCount",
              "proposal",
            ],
            properties: {
              kind: { type: "string", enum: [...FINDING_KINDS] },
              headline: { type: "string" },
              detail: { type: "string" },
              recommendation: { type: "string" },
              confidence: { type: "string", enum: ["low", "medium", "high"] },
              citedOpportunityIds: citations(opportunityIds),
              citedCompanyIds: citations(companyIds),
              citedSourceIds: citations(sourceIds),
              supportingCount: { type: "integer", minimum: 0 },
              contradictingCount: { type: "integer", minimum: 0 },
              proposal: { anyOf: [ruleProposal, memoryProposal, { type: "null" }] },
            },
          },
        },
      },
    };
  },

  renderInput: (input) => {
    const outcomes = input.outcomes.length
      ? input.outcomes
          .map(
            (o) =>
              `  opportunity=${o.opportunityId} company=${o.companyId} "${o.companyName}" ` +
              `outcome=${o.kind} on=${o.occurredAt.slice(0, 10)} ` +
              `huntloop_said=${o.priority ?? "?"}/${o.modelScore ?? "?"} ` +
              `source=${o.sourceId ?? "none"}${o.sourceName ? ` "${o.sourceName}"` : ""} ` +
              `industry=${o.industry ?? "?"} headcount=${o.employeeCount ?? "?"} ` +
              `trigger_age_days=${o.triggerAgeDays ?? "?"}`,
          )
          .join("\n")
      : "  (nothing recorded)";

    const decisions = input.decisions.length
      ? input.decisions
          .map(
            (d) =>
              `  ${d.decisionType} on=${d.occurredAt.slice(0, 10)} ` +
              `opportunity=${d.opportunityId ?? "none"} ` +
              `${d.overridden ? "corrected-by-a-person" : `rated=${d.rating ?? "?"}`}` +
              (d.note ? ` note="${d.note.replace(/"/g, "'")}"` : ""),
          )
          .join("\n")
      : "  (nothing recorded)";

    const sources = input.sources.length
      ? input.sources
          .map(
            (s) =>
              `  source=${s.sourceId} "${s.name}" kind=${s.kind} ` +
              `companies=${s.companiesFound} opportunities=${s.opportunitiesCreated} ` +
              `outcomes=${s.outcomes} wins=${s.wins}`,
          )
          .join("\n")
      : "  (none configured)";

    const rules = input.existingRules.length
      ? input.existingRules.map((r) => `  - ${r.name}: ${r.description}`).join("\n")
      : "  (none yet)";

    const guidance = input.existingGuidance.length
      ? input.existingGuidance.map((g) => `  - ${g}`).join("\n")
      : "  (none yet)";

    /* Company names and notes are the untrusted part: a name comes from a
       fetched page, and a note is typed by a user who may not be the one
       reading the findings. Everything else in this block is ids and numbers
       this system generated, but the block is fenced as a whole because
       splitting it into trusted and untrusted halves would put the fence where
       an injected line could be written to look like the boundary. */
    const records = [
      `Period: ${input.windowStart.slice(0, 10)} to ${input.windowEnd.slice(0, 10)}`,
      "",
      `Outcomes (${input.outcomes.length}):`,
      outcomes,
      "",
      `Human decisions and ratings (${input.decisions.length}):`,
      decisions,
      "",
      `Sources (${input.sources.length}):`,
      sources,
    ].join("\n");

    return [
      "Analyse this period and report what should change.",
      "",
      wrapUntrusted("prospecting records", records),
      "",
      "Scoring policy already in force — do not propose these again:",
      rules,
      "",
      "House style already on file — do not restate these:",
      guidance,
      "",
      "Cite every finding with ids from the records above. An empty findings " +
        "list is a valid answer.",
    ].join("\n");
  },

  // No fetchDomains: no web tool at all.

  entity: () => ({ type: "learning_run", id: null }),

  parse: (json, input) => {
    if (!json || typeof json !== "object") {
      throw new Error("analyze_performance: response was not an object.");
    }
    const raw = json as { summary?: unknown; findings?: unknown };

    const summary = typeof raw.summary === "string" ? raw.summary.trim() : "";
    if (!summary) {
      /* A run with no summary and no findings is indistinguishable from a run
         that failed silently, and this is the screen where "nothing to report"
         has to be stated rather than inferred from an empty list. */
      throw new Error(
        "analyze_performance: the analysis has no summary. A period that " +
          "supports no findings still has to say so.",
      );
    }

    if (!Array.isArray(raw.findings)) {
      throw new Error("analyze_performance: response carried no findings array.");
    }
    if (raw.findings.length > MAX_FINDINGS) {
      throw new Error(
        `analyze_performance: ${raw.findings.length} findings, more than the ` +
          `${MAX_FINDINGS} a person will review in one sitting.`,
      );
    }

    /* The closed sets, rebuilt here rather than trusted from the schema. The
       schema makes a foreign id a 400; this makes it a named failure on a run
       that is attributable to a prompt version — and it is the check that
       still holds if a future model or a future SDK stops enforcing enums the
       way this one does. */
    const opportunityIds = new Set(input.outcomes.map((o) => o.opportunityId));
    const companyIds = new Set(input.outcomes.map((o) => o.companyId));
    const sourceIds = new Set([
      ...input.sources.map((s) => s.sourceId),
      ...input.outcomes.map((o) => o.sourceId).filter((id): id is string => Boolean(id)),
    ]);

    const existingRuleNames = new Set(
      input.existingRules.map((r) => r.name.trim().toLowerCase()),
    );

    const findings: Finding[] = [];

    for (const item of raw.findings as RawFinding[]) {
      const kind = item.kind;
      if (typeof kind !== "string" || !(FINDING_KINDS as readonly string[]).includes(kind)) {
        throw new Error(`analyze_performance: unknown finding kind ${JSON.stringify(kind)}.`);
      }

      const headline = text(item.headline);
      const detail = text(item.detail);
      const recommendation = text(item.recommendation);
      if (!headline) throw new Error("analyze_performance: a finding has no headline.");
      if (!detail) {
        throw new Error(
          `analyze_performance: "${headline}" states a conclusion with no working. ` +
            `A finding a person cannot check is one they can only believe.`,
        );
      }
      if (!recommendation) {
        throw new Error(
          `analyze_performance: "${headline}" recommends nothing. An observation ` +
            `with no consequence is not something to approve or reject.`,
        );
      }

      const confidence = item.confidence;
      if (confidence !== "low" && confidence !== "medium" && confidence !== "high") {
        throw new Error(
          `analyze_performance: "${headline}" carries confidence ` +
            `${JSON.stringify(confidence)}.`,
        );
      }

      const citedOpportunityIds = citedFrom(
        item.citedOpportunityIds,
        opportunityIds,
        headline,
        "opportunity",
      );
      const citedCompanyIds = citedFrom(item.citedCompanyIds, companyIds, headline, "company");
      const citedSourceIds = citedFrom(item.citedSourceIds, sourceIds, headline, "source");

      if (!citedOpportunityIds.length && !citedCompanyIds.length && !citedSourceIds.length) {
        throw new Error(
          `analyze_performance: "${headline}" cites nothing. A finding with no ` +
            `records behind it is a plausible sentence, and it is about to be ` +
            `offered to somebody as a reason to change a rule.`,
        );
      }

      const supportingCount = count(item.supportingCount);
      const contradictingCount = count(item.contradictingCount);
      if (supportingCount === 0) {
        throw new Error(
          `analyze_performance: "${headline}" is supported by zero records ` +
            `while citing ${citedOpportunityIds.length + citedCompanyIds.length + citedSourceIds.length}.`,
        );
      }

      const proposal = parseProposal(item.proposal, headline, existingRuleNames);

      findings.push({
        kind: kind as FindingKind,
        headline,
        detail,
        recommendation,
        confidence,
        citedOpportunityIds,
        citedCompanyIds,
        citedSourceIds,
        supportingCount,
        contradictingCount,
        proposal,
      });
    }

    return { summary, findings };
  },
};

/* ── Parsing helpers ─────────────────────────────────────────────────────── */

interface RawFinding {
  kind?: unknown;
  headline?: unknown;
  detail?: unknown;
  recommendation?: unknown;
  confidence?: unknown;
  citedOpportunityIds?: unknown;
  citedCompanyIds?: unknown;
  citedSourceIds?: unknown;
  supportingCount?: unknown;
  contradictingCount?: unknown;
  proposal?: unknown;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function count(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

/**
 * Citations, checked against what was sent.
 *
 * The error names the id and the finding, because the one failure this must
 * never be vague about is a citation that does not belong to this org — see
 * the note at the top of the file.
 */
function citedFrom(
  value: unknown,
  allowed: Set<string>,
  headline: string,
  label: string,
): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new Error(`analyze_performance: "${headline}" gave a non-list of ${label} citations.`);
  }

  const out: string[] = [];
  for (const id of value) {
    if (typeof id !== "string" || !allowed.has(id)) {
      throw new Error(
        `analyze_performance: "${headline}" cites ${label} ${JSON.stringify(id)}, ` +
          `which was not in the records for this organisation.`,
      );
    }
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

function parseProposal(
  value: unknown,
  headline: string,
  existingRuleNames: Set<string>,
): FindingProposal | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object") {
    throw new Error(`analyze_performance: "${headline}" carries a malformed proposal.`);
  }

  const node = value as Record<string, unknown>;

  if (node.type === "memory") {
    const content = text(node.content);
    if (!content) {
      throw new Error(`analyze_performance: "${headline}" proposes an empty memory.`);
    }
    if (content.length > 1000) {
      /* `memories.content` is read into every future qualification and every
         message. A thousand characters of derived guidance is already a
         paragraph in every prompt this org runs, forever. */
      throw new Error(
        `analyze_performance: "${headline}" proposes ${content.length} characters of ` +
          `guidance. Anything this long is a document, and it will be prepended ` +
          `to every prompt this organisation runs.`,
      );
    }
    const key = text(node.key);
    return { type: "memory", key: key || null, content };
  }

  if (node.type !== "scoring_rule") {
    throw new Error(
      `analyze_performance: "${headline}" proposes ${JSON.stringify(node.type)}, ` +
        `which is not something approving a finding can produce.`,
    );
  }

  const name = text(node.name);
  if (!name) throw new Error(`analyze_performance: "${headline}" proposes a rule with no name.`);
  if (existingRuleNames.has(name.toLowerCase())) {
    throw new Error(
      `analyze_performance: "${headline}" proposes a rule called ${JSON.stringify(name)}, ` +
        `which already exists. Approving it would create a second rule with the ` +
        `same name and a different body.`,
    );
  }

  const intent = node.intent;
  if (typeof intent !== "string" || !(RULE_INTENTS as readonly string[]).includes(intent)) {
    throw new Error(`analyze_performance: "${headline}" proposes an unknown intent.`);
  }

  const effect = node.effect;
  if (effect !== "adjust" && effect !== "veto" && effect !== "floor") {
    throw new Error(`analyze_performance: "${headline}" proposes an unknown effect.`);
  }

  let expression: RuleExpression;
  try {
    expression = validateExpression(node.expression);
  } catch (error) {
    if (error instanceof InvalidRuleError) {
      throw new Error(`analyze_performance: "${headline}" — ${error.message}`);
    }
    throw error;
  }

  let weight: number | null = null;
  let floorPriority: RulePriority | null = null;

  if (effect === "adjust") {
    const parsed = typeof node.weight === "number" ? node.weight : Number(node.weight);
    if (!Number.isFinite(parsed) || Math.round(parsed) === 0) {
      throw new Error(
        `analyze_performance: "${headline}" proposes a rule that adjusts by nothing.`,
      );
    }
    const rounded = Math.round(parsed);
    if (rounded < -40 || rounded > 40) {
      throw new Error(
        `analyze_performance: "${headline}" proposes an adjustment of ${rounded}, ` +
          `outside ±40 — one rule deciding every verdict on its own, inferred ` +
          `from a few dozen records.`,
      );
    }
    weight = rounded;
  }

  if (effect === "floor") {
    const priority = node.floorPriority;
    if (priority !== "hot" && priority !== "warm" && priority !== "watch") {
      throw new Error(
        `analyze_performance: "${headline}" proposes a floor at ` +
          `${JSON.stringify(priority)}, which is not a priority a floor raises to.`,
      );
    }
    floorPriority = priority;
  }

  return {
    type: "scoring_rule",
    name,
    intent: intent as RuleIntent,
    effect,
    weight,
    floorPriority,
    expression,
    summary: describeRule({ effect, weight, floorPriority, expression }),
  };
}
