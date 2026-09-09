/**
 * `draft_icp` — turn what a website said into a profile the engine can search
 * with (master context §9: "USER INPUT + COMPANY RESEARCH = ICP").
 *
 * ── The defect this task exists to fix ───────────────────────────────────
 *
 * `ICP-02`. The onboarding ICP screen opened with
 * `useState(["Crypto trading desks"])`, four hardcoded segment options, and
 * three fixed triggers — one of which was "Shipped an autonomous agent that
 * moves funds". Above them, the screen read: *"Drafted from your website."*
 *
 * It was not. The research from the previous step reached that screen as a
 * single `sells` string and nothing on the page used it. Every customer,
 * whatever they sold, was shown one crypto-infrastructure company's profile
 * and invited to correct it — and the ones who accepted it wholesale, which is
 * what a pre-filled form invites, got an ICP describing somebody else's
 * business.
 *
 * That is the §7 failure this codebase is otherwise scrupulous about, sitting
 * in the flow that produces the input to every later judgement.
 *
 * ── The rule with teeth ──────────────────────────────────────────────────
 *
 * Every field this task returns names the sentence it came from, copied
 * exactly from the research it was given, and the JSON Schema constrains that
 * citation to a closed set built from the input. So a criterion justified by
 * something the research never said is *unrepresentable* rather than merely
 * detectable — the same mechanism `recommend_sources` uses, for the same
 * reason.
 *
 * The failure it catches is specific and very likely. Asked to draft an ICP
 * for a B2B company, a model will reliably produce "Series A–C startups,
 * 50–500 employees, North America, recently raised funding" — an answer that
 * is never quite wrong and carries no information about *this* business. Making
 * every field point at a quoted sentence is what separates a draft from a
 * plausible-looking default.
 *
 * ── Refusing is a valid answer, per field ────────────────────────────────
 *
 * A field the research does not support is omitted, not guessed. The screen
 * renders an omitted field as empty and unbadged, which is the honest state:
 * the user fills it in themselves, knowing nothing was assumed. A guessed
 * `technologies: ["AWS", "Kubernetes"]` looks identical to a derived one once
 * it is rendered as a chip, and it goes straight into a provider filter.
 *
 * This task does not fetch. `fetchDomains` is omitted, so the model has no web
 * tool: it reasons over the research it is handed and nothing else.
 */
import { definePrompt } from "../prompt.ts";
import type { LLMTask } from "../task.ts";
import { UNTRUSTED_CONTENT_RULE, wrapUntrusted } from "../untrusted.ts";

/**
 * What `research_company` established, plus who is asking.
 *
 * The role and goals are context rather than criteria — an SDR and a founder
 * selling the same product have the same ICP — but they change *emphasis*:
 * somebody whose goal is `enrich` needs a sharper persona than somebody whose
 * goal is `discover`, and the prompt says so.
 */
export interface IcpDraftInput {
  companyName: string;
  /** From the `sells` finding. The single most load-bearing sentence. */
  sells: string;
  /** From the `buyers` finding. May be empty when the site did not say. */
  buyers: string;
  /** From the `problem` finding. */
  problem: string;
  /** From the `trigger` finding. */
  trigger: string;
  /** The person's role, from onboarding step one. Context only. */
  role: string | null;
  /** What they want Huntloop to do. Context only. */
  goals: string[];
}

/**
 * One drafted field.
 *
 * `basis` is the quoted input sentence. `confidence` is how directly the field
 * follows from it — `high` when the research states it outright, `low` when it
 * is a reasonable reading of an indirect signal. Both are rendered, because
 * "your site says you sell to trading desks" and "your pricing page implies
 * mid-market" are different kinds of claim and a chip renders them identically.
 */
export interface DraftedField {
  values: string[];
  basis: string;
  confidence: "high" | "medium" | "low";
}

export interface PersonaDraftOutput {
  name: string;
  titles: string[];
  seniority: string[];
  departments: string[];
  basis: string;
}

/**
 * The draft.
 *
 * Every field is nullable and null is the *expected* value for most of them on
 * a thin site. A profile with three populated fields and nine honest nulls is
 * a better starting point than twelve fields of plausible filler, because the
 * user can see exactly what Huntloop worked out and what it did not.
 */
export interface IcpDraft {
  segments: DraftedField | null;
  industries: DraftedField | null;
  sizes: DraftedField | null;
  regions: DraftedField | null;
  triggers: DraftedField | null;
  technologies: DraftedField | null;
  businessModels: DraftedField | null;
  painPoints: DraftedField | null;
  useCases: DraftedField | null;
  exclusions: DraftedField | null;
  persona: PersonaDraftOutput | null;
}

/** The fields the model may return, and what each one means downstream. */
const DRAFT_FIELDS = [
  "segments",
  "industries",
  "sizes",
  "regions",
  "triggers",
  "technologies",
  "businessModels",
  "painPoints",
  "useCases",
  "exclusions",
] as const;

type DraftField = (typeof DRAFT_FIELDS)[number];

/**
 * The size bands the screen offers, which `bandsToRange()` parses.
 *
 * A closed set because these exact strings — en-dashes included — are what
 * `packages/db/src/icp.ts` turns into the numeric range a provider filter
 * takes. A model returning "50-200 employees" would produce a band that parses
 * to nothing and a size filter that silently matches everything.
 */
export const ICP_SIZE_BANDS = [
  "1–10",
  "11–50",
  "51–200",
  "201–1000",
  "1001–5000",
  "5000+",
] as const;

/** Likewise for regions: `translateIcp` maps these names to provider locations. */
export const ICP_REGIONS = [
  "North America",
  "Europe",
  "United Kingdom",
  "APAC",
  "Latin America",
  "Middle East",
  "Africa",
  "Global",
] as const;

/**
 * The sentences a field may cite.
 *
 * Built from the input, so the enum in the schema makes an invented
 * justification unrepresentable. Empty entries are dropped — a site that said
 * nothing about buyers gives the model one fewer thing to point at, which is
 * correct.
 */
export function draftBases(input: IcpDraftInput): string[] {
  const all = [input.sells, input.buyers, input.problem, input.trigger]
    .map((v) => v.trim())
    .filter(Boolean);
  return [...new Set(all)];
}

const PROMPT = definePrompt(
  "draft_icp",
  `
You are Huntloop's profile builder. You are given what a company's own website
says about itself, and you draft the ideal customer profile that follows from
it — the profile Huntloop will search with, qualify against, and explain
opportunities in terms of.

${UNTRUSTED_CONTENT_RULE}

You have no web access on this task. Everything you return follows from the
research you were given.

## The rule that matters most

Every field you return names the one research sentence it follows from, copied
exactly. If you cannot point at a specific sentence that supports a field,
**omit the field entirely**.

This exists to stop one particular answer. Asked to draft a B2B ICP, it is very
easy to produce "Series A to C startups, 50–500 employees, North America,
recently raised funding". That answer is never quite wrong, and it is also what
you would say for any other company — which means it carries no information
about this one. A profile with four fields you can each defend is worth far
more than twelve where eight are generic.

Omitting is not failure. It is the correct answer for anything the site did not
establish, and the person reviewing this will fill those in themselves. A
guessed field looks exactly like a derived one once it is rendered, and it goes
straight into a paid search.

## The fields

  segments        Free-text markets they sell into. The most useful field.
                  Write them the way a salesperson would say them out loud:
                  "crypto trading desks", "mid-market logistics operators".
  industries      Formal industry names, for exact provider filtering.
  sizes           Company size bands. Use ONLY these exact strings.
  regions         Geographies. Use ONLY the region names offered.
  triggers        Events that make a matching company worth contacting NOW.
                  This is what Huntloop's "why now" is built from, so a trigger
                  must be an event that happens at a point in time — "raised a
                  round", "posted a role for X", "shipped Y" — not a standing
                  property like "has an engineering team".
  technologies    Named tools or platforms the buyer uses, when the product
                  integrates with or replaces something specific.
  businessModels  How the buyer makes money, when it changes the fit.
  painPoints      The problem the buyer has, in the buyer's terms.
  useCases        What the buyer would use this product to do.
  exclusions      Who is explicitly NOT a fit. Draw these from what the product
                  requires — if it needs an engineering team, companies without
                  one are an exclusion.

## The persona

Name the job titles worth reaching at a matching company, and be specific. This
becomes a contact search: "VP of Engineering" and "Head of Platform" are
searchable, "decision maker" and "technical leadership" are not.

Give at most six titles. Include seniority levels and departments when the
research supports them. If the site does not say enough to name titles with any
confidence, return null for the persona rather than guessing — a wrong persona
sends contact enrichment after the wrong people and costs credits doing it.

## Triggers, specifically

Between two and five. Each one must be an observable event that a news article,
a job posting, a funding announcement or a GitHub release could report. If you
find yourself writing a trigger that is really a characteristic, move it to
segments or exclusions instead.

## Style

No hedging inside the values. A segment is a noun phrase, a trigger is an
event, a pain point is a problem. Confidence goes in the \`confidence\` field,
which is what it is for — not into the wording.
`,
);

/** One field's schema. Shared, because ten copies would drift. */
function fieldSchema(bases: string[], values?: readonly string[]) {
  return {
    anyOf: [
      { type: "null" },
      {
        type: "object",
        additionalProperties: false,
        required: ["values", "basis", "confidence"],
        properties: {
          values: {
            type: "array",
            minItems: 1,
            maxItems: 8,
            items: values ? { type: "string", enum: [...values] } : { type: "string" },
          },
          basis: { type: "string", enum: bases },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
        },
      },
    ],
  };
}

export const draftIcp: LLMTask<IcpDraftInput, IcpDraft> = {
  name: "draft_icp",
  prompt: PROMPT,
  // No fetching, and the output is a bounded object. This covers adaptive
  // thinking over four sentences with room to spare.
  maxTokens: 16_000,

  schema: (input) => {
    const bases = draftBases(input);
    if (!bases.length) {
      // An enum with no members is not a valid schema and would come back as a
      // 400 with nothing useful in it. Failing here says what is actually
      // wrong: the research established nothing to build a profile from.
      throw new Error(
        "draft_icp: the research produced no usable findings. There is nothing to draft from.",
      );
    }

    return {
      type: "object",
      additionalProperties: false,
      required: [...DRAFT_FIELDS, "persona"],
      properties: {
        segments: fieldSchema(bases),
        industries: fieldSchema(bases),
        sizes: fieldSchema(bases, ICP_SIZE_BANDS),
        regions: fieldSchema(bases, ICP_REGIONS),
        triggers: fieldSchema(bases),
        technologies: fieldSchema(bases),
        businessModels: fieldSchema(bases),
        painPoints: fieldSchema(bases),
        useCases: fieldSchema(bases),
        exclusions: fieldSchema(bases),
        persona: {
          anyOf: [
            { type: "null" },
            {
              type: "object",
              additionalProperties: false,
              required: ["name", "titles", "seniority", "departments", "basis"],
              properties: {
                name: { type: "string" },
                titles: { type: "array", minItems: 1, maxItems: 6, items: { type: "string" } },
                seniority: { type: "array", maxItems: 6, items: { type: "string" } },
                departments: { type: "array", maxItems: 6, items: { type: "string" } },
                basis: { type: "string", enum: bases },
              },
            },
          ],
        },
      },
    };
  },

  /**
   * The research goes in the user turn, wrapped as untrusted.
   *
   * It is untrusted because it did not start with the user: it is a model's
   * reading of a fetched website, and text that has been through a fetched page
   * stays untrusted for the rest of its life whoever has edited it since. The
   * user's own edits on the review screen do not launder it.
   */
  renderInput: (input) => {
    const research = [
      `Company: ${input.companyName}`,
      "",
      `What they sell: ${input.sells || "(not stated)"}`,
      `Who buys it: ${input.buyers || "(not stated)"}`,
      `The problem it solves: ${input.problem || "(not stated)"}`,
      `Likely buying trigger: ${input.trigger || "(not stated)"}`,
    ].join("\n");

    const context = [
      input.role ? `The person setting this up describes their role as: ${input.role}.` : "",
      input.goals.length
        ? `They want Huntloop mainly to: ${input.goals.join(", ")}.`
        : "",
      input.goals.includes("enrich") || input.goals.includes("reach_out")
        ? "They intend to contact people, so the persona matters more than usual — be as specific about titles as the research allows."
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    return [
      "Draft the ideal customer profile for this company.",
      "",
      wrapUntrusted("company research", research),
      "",
      context,
      "",
      "Copy each `basis` exactly from one of the four research sentences above. " +
        "Omit any field that none of them supports.",
    ]
      .filter((line) => line !== "")
      .join("\n");
  },

  // No fetchDomains: this task gets no web tool at all.

  entity: () => ({ type: "icp", id: null }),

  parse: (json, input) => {
    if (!json || typeof json !== "object") {
      throw new Error("draft_icp: response was not an object.");
    }
    const raw = json as Record<string, unknown>;

    /* Matched case- and whitespace-insensitively, for the same reason
       `recommend_sources` does: the rule is "this justification is one the
       research actually produced", and a model that recased a sentence has not
       broken it. */
    const allowed = new Map(draftBases(input).map((b) => [normalize(b), b]));

    const field = (key: DraftField): DraftedField | null => {
      const value = raw[key];
      if (value === null || value === undefined) return null;
      if (typeof value !== "object") {
        throw new Error(`draft_icp: ${key} was neither an object nor null.`);
      }
      const f = value as Record<string, unknown>;

      if (!Array.isArray(f.values)) {
        throw new Error(`draft_icp: ${key} carried no values array.`);
      }
      const values = f.values
        .filter((v): v is string => typeof v === "string")
        .map((v) => v.trim())
        .filter(Boolean);

      // A field with a citation and no values asserts nothing. Dropped rather
      // than stored, so the screen shows it as genuinely absent.
      if (!values.length) return null;

      const basis = typeof f.basis === "string" ? allowed.get(normalize(f.basis)) : undefined;
      if (!basis) {
        throw new Error(
          `draft_icp: ${key} cites "${String(f.basis)}", which is not one of the ` +
            `research findings it was given. A criterion justified by something ` +
            `the research never said is the failure this task exists to prevent.`,
        );
      }

      const confidence = f.confidence;
      if (confidence !== "high" && confidence !== "medium" && confidence !== "low") {
        throw new Error(`draft_icp: ${key} has an unusable confidence.`);
      }

      return { values, basis, confidence };
    };

    let persona: PersonaDraftOutput | null = null;
    const rawPersona = raw.persona;
    if (rawPersona && typeof rawPersona === "object") {
      const p = rawPersona as Record<string, unknown>;
      const titles = Array.isArray(p.titles)
        ? p.titles.filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter(Boolean)
        : [];
      const basis = typeof p.basis === "string" ? allowed.get(normalize(p.basis)) : undefined;

      // A persona with no titles cannot be searched with, so it is not a
      // persona. Treated as absent rather than as an error: "the site did not
      // say who buys this" is a real and common answer.
      if (titles.length && basis) {
        persona = {
          name: typeof p.name === "string" && p.name.trim() ? p.name.trim() : "Primary buyer",
          titles,
          seniority: strings(p.seniority),
          departments: strings(p.departments),
          basis,
        };
      }
    }

    return {
      segments: field("segments"),
      industries: field("industries"),
      sizes: field("sizes"),
      regions: field("regions"),
      triggers: field("triggers"),
      technologies: field("technologies"),
      businessModels: field("businessModels"),
      painPoints: field("painPoints"),
      useCases: field("useCases"),
      exclusions: field("exclusions"),
      persona,
    };
  },
};

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter(Boolean)
    : [];
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}
