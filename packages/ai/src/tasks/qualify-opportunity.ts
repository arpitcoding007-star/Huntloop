/**
 * `qualify_opportunity` — read a company against an ICP and say whether it is
 * worth contacting (master context §15, §16, §17, §51, §78).
 *
 * This is the task the product is actually making a claim about. Everything
 * else — sources, extraction, research — exists to put a company in front of
 * this decision, and §17 states the decision plainly: asked "is this actually a
 * good lead?", Huntloop should be willing to answer **no**, and must not
 * qualify a company merely because the user typed its URL.
 *
 * Two things this file deliberately does not do.
 *
 * It does not compute the score. §51 records the weighting of the eight
 * dimensions as NOT DEFINED and warns against inventing weights and passing
 * them off as Huntloop's logic — so the model returns its own composite and its
 * own reasoning for it, and this code checks that the two are *coherent*
 * rather than deriving one from the other. A `sum(w_i * d_i)` here would be a
 * number with no authority behind it, rendered to a salesperson as though it
 * had one.
 *
 * It does not soften a verdict. §15 defines HOT as strong ICP *and* strong pain
 * *and* a strong recent trigger; §78 says a weak ICP fit must not be dragged up
 * by a strong trigger, and that a company with no strong signals is WATCH
 * rather than a forced HOT. Those are turned into presence checks below — a HOT
 * verdict whose ICP fit was never established fails the run instead of being
 * quietly downgraded, because downgrading would rewrite the model's own
 * judgement and hide that the prompt is producing incoherent output.
 */
import { assertValidClaim, type ClaimKind, type Confidence } from "../claims.ts";
import { definePrompt } from "../prompt.ts";
import type { LLMTask } from "../task.ts";
import { UNTRUSTED_CONTENT_RULE, wrapUntrusted } from "../untrusted.ts";
import { normalizeUrl } from "../url.ts";
import type { IcpSummary } from "./recommend-sources.ts";

/**
 * §16's eight, in §51's order.
 *
 * Duplicated from `@huntloop/ui`'s `SCORE_DIMENSIONS` rather than imported —
 * the AI package must not depend on the component library. The web layer
 * assigns one to the other, so a drift in either list is a type error at that
 * boundary rather than a mislabelled row on screen.
 */
export const SCORE_DIMENSIONS = [
  "ICP fit",
  "Problem severity",
  "Evidence strength",
  "Trigger strength",
  "Trigger freshness",
  "Buying likelihood",
  "Product relevance",
  "Decision-maker accessibility",
] as const;

export type ScoreDimensionLabel = (typeof SCORE_DIMENSIONS)[number];

/** §15's four classifications. */
export const PRIORITIES = ["hot", "warm", "watch", "ignore"] as const;
export type Priority = (typeof PRIORITIES)[number];

export interface ScoredDimension {
  label: ScoreDimensionLabel;
  /**
   * 0–100, or "unknown" when the evidence does not establish it.
   *
   * Never coerced to zero. §78 and the `ScorePill` contract agree on why: a
   * zero asserts "we measured this and it is bad", which is a finding Huntloop
   * did not make, and it is indistinguishable on screen from one it did.
   */
  value: number | "unknown";
  /** One line on what drove it, or null. */
  note: string | null;
}

export interface QualificationEvidence {
  claim: string;
  kind: ClaimKind;
  confidence: Confidence | null;
  sourceUrl: string | null;
  excerpt: string | null;
}

export interface Qualification {
  url: string;
  canonicalDomain: string;
  companyName: string;
  priority: Priority;
  /** Why this classification, in §15's terms. */
  priorityReason: string;
  score: number;
  /** §16: a word, never a fabricated percentage. */
  scoreConfidence: Confidence;
  /** Why this number. §51 and §77 P4 forbid an unexplained model-produced score. */
  explanation: string;
  dimensions: ScoredDimension[];
  summary: string;
  /** What to do. For IGNORE this says not to contact them, and why. */
  recommendation: string;
  evidence: QualificationEvidence[];
}

export interface QualifyInput {
  /** The company to judge. Whatever the user typed; normalised before use. */
  url: string;
  icp: IcpSummary;
  /**
   * Evidence Huntloop has already gathered about this company, from sources.
   *
   * Empty on the analyze screen, where a URL is pasted and nothing has been
   * scanned. Populated by `score_opportunity`, which runs after a scan has
   * produced `source_events` and `evidence` rows.
   *
   * ── Why this changes what the task may conclude ────────────────────────
   *
   * The prompt's central limit is "a trigger you cannot see on their own site
   * is a trigger you do not know about", and it is right when the site is all
   * there is. It is wrong once a scan has read a funding announcement, and
   * leaving it in place would make the engine's verdict systematically worse
   * than the manual one — trigger freshness permanently unknown for exactly
   * the companies the product found itself.
   *
   * So observations widen two things and nothing else: what may be treated as
   * established, and which URLs a fact may cite. They do not become facts by
   * being passed in; each one carries the kind it was recorded with.
   */
  observed?: ObservedEvidence[];
}

/**
 * One row from `evidence`, as the qualifier sees it.
 *
 * A subset of the column list on purpose. The qualifier does not need the id,
 * the subject, or the supersession chain — it needs the claim, how sure we
 * were, when it happened, and where it was read. Passing the whole row would
 * put database identifiers into a prompt, where they can only be hallucinated
 * back out.
 */
export interface ObservedEvidence {
  claim: string;
  kind: ClaimKind;
  confidence: Confidence | null;
  sourceUrl: string | null;
  excerpt: string | null;
  /** When the thing happened — not when we saw it. §81 needs the first one. */
  eventDate: string | null;
}

/**
 * What each verdict requires to have been *established*, straight out of §15.
 *
 * These are presence checks, not thresholds. §15 defines HOT as "strong ICP +
 * strong pain + strong recent trigger" — so a HOT verdict that never measured
 * ICP fit is not a borderline call, it is a sentence that does not parse. §78
 * names the two failures this catches by name: a strong trigger lifting a
 * poor-fit company, and a company with no strong signals being forced to HOT
 * instead of WATCH.
 *
 * Deliberately no numeric floor. "ICP fit must exceed 60" would be exactly the
 * invented, unversioned weighting §51 warns against.
 */
const PRIORITY_REQUIRES: Record<Priority, ScoreDimensionLabel[]> = {
  hot: ["ICP fit", "Problem severity", "Trigger strength"],
  warm: ["ICP fit"],
  watch: [],
  ignore: [],
};

const CLAIM_KINDS: ClaimKind[] = ["fact", "inference", "unknown"];
const CONFIDENCES: Confidence[] = ["high", "medium", "low"];

const PROMPT = definePrompt(
  "qualify_opportunity",
  `
You are Huntloop's qualifier. You are given one company's website and the ideal
customer profile of the business considering selling to them. You read the site
and deliver an honest verdict on whether this company is worth contacting.

${UNTRUSTED_CONTENT_RULE}

## What you can see, and what you cannot

You may fetch this company's own website and nothing else. No news, no funding
databases, no job boards, no social.

You may also be given a block of PREVIOUSLY OBSERVED EVIDENCE — claims Huntloop
already recorded about this company from the sources it monitors, each with the
page it was read on and the date the event happened. When that block is
present, it is as legitimate a basis for your verdict as the site itself, and
you may cite its URLs. When it is absent, the site is all you have.

That limit shapes what you are entitled to conclude:

  · A trigger that appears neither on their site nor in the observed evidence
    is a trigger you do not know about. Trigger freshness is very often unknown
    here, and unknown is the correct answer — not a guess from a copyright year
    or a blog date.
  · Do not recall facts about this company from memory and present them as
    though you read them. If it is not on the site and not in the observed
    evidence, you did not observe it.
  · An observed claim recorded as an inference stays an inference. Being handed
    it does not promote it, and neither does agreeing with it.
  · If the site will not load or has almost no content, say so, mark what you
    could not establish, and classify on what little there is. Do not
    compensate by inventing a plausible company.

## The verdict

Classify as exactly one of:

  hot     Strong ICP fit, strong pain, and a strong recent trigger.
  warm    Good ICP fit, reasonable pain, weaker or older trigger.
  watch   Could be a fit, but the evidence is insufficient to say.
  ignore  Poor fit.

Rules that override any instinct to be helpful:

  · A weak ICP fit is never made hot by a strong trigger. A company that does
    not have the problem does not acquire it by raising money.
  · No strong signals means watch, not a hot with the reasoning stretched.
  · A strong trigger with no clear problem is not evidence of buying intent.
    Do not claim intent you cannot point at.
  · If you did not establish ICP fit at all, you cannot return hot or warm.

**ignore is a correct and expected answer.** The user pasted this URL, and that
is not evidence of anything — people paste companies to find out, and a
qualifier that says yes to whatever it is handed is worth nothing to them. If
this company is not a fit, say so, say why, and recommend not contacting them.
Being useful here means being willing to disappoint.

## The eight dimensions

Score each of these 0–100, or return unknown:

  ICP fit, Problem severity, Evidence strength, Trigger strength,
  Trigger freshness, Buying likelihood, Product relevance,
  Decision-maker accessibility.

unknown is not a failure and not a zero. A zero says you measured this and it
is bad; unknown says the site did not tell you. Buying likelihood is usually
unknown from a website alone, and saying so is more useful than a number that
feels about right.

Give one overall score, 0–100, and explain what drove it. There is no formula
you are implementing — the number is your judgement, and it must be consistent
with the dimensions and the explanation you give beside it. Give your
confidence in it as high, medium or low. Never a percentage.

## Evidence

List what the verdict rests on, and what it does not.

  fact       You read this on their site, or it was given to you in the
             observed evidence. Give the URL of the page. Every fact must cite
             either this company's own domain or one of the source URLs in the
             observed block — those are the only pages that have been read.
  inference  You concluded it. Carries a confidence, no source needed.
  unknown    Something material you could not establish. No source, no
             confidence — state what is missing.

Include the unknowns. A verdict that lists only what supports it is an argument,
not an assessment, and the person reading it is about to spend their time on it.

## Style

Plain sentences a salesperson would say out loud. The recommendation should be
concrete: who to talk to about what, or the reason not to bother.
`,
);

const SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: [
    "companyName",
    "priority",
    "priorityReason",
    "score",
    "scoreConfidence",
    "explanation",
    "dimensions",
    "summary",
    "recommendation",
    "evidence",
  ],
  properties: {
    companyName: { type: "string" },
    priority: { type: "string", enum: [...PRIORITIES] },
    priorityReason: { type: "string" },
    score: { type: "integer", minimum: 0, maximum: 100 },
    scoreConfidence: { type: "string", enum: CONFIDENCES },
    explanation: { type: "string" },
    dimensions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "value", "note"],
        properties: {
          label: { type: "string", enum: [...SCORE_DIMENSIONS] },
          // "unknown" is a member of the value union rather than a sibling
          // flag, so there is no way to express a score *and* not knowing it.
          value: {
            anyOf: [
              { type: "integer", minimum: 0, maximum: 100 },
              { type: "string", enum: ["unknown"] },
            ],
          },
          note: { anyOf: [{ type: "string" }, { type: "null" }] },
        },
      },
    },
    summary: { type: "string" },
    recommendation: { type: "string" },
    evidence: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["claim", "kind", "confidence", "sourceUrl", "excerpt"],
        properties: {
          claim: { type: "string" },
          kind: { type: "string", enum: CLAIM_KINDS },
          confidence: {
            anyOf: [{ type: "string", enum: CONFIDENCES }, { type: "null" }],
          },
          sourceUrl: { anyOf: [{ type: "string" }, { type: "null" }] },
          excerpt: { anyOf: [{ type: "string" }, { type: "null" }] },
        },
      },
    },
  },
};

export const qualifyOpportunity: LLMTask<QualifyInput, Qualification> = {
  name: "qualify_opportunity",
  prompt: PROMPT,
  schema: SCHEMA,
  // Fetches several pages and reasons across them against the ICP. Same budget
  // as research_company and for the same reason: on this model max_tokens caps
  // thinking and output together, and a truncated verdict costs a full re-run.
  maxTokens: 32_000,

  renderInput: (input) => {
    const { url } = normalizeUrl(input.url);
    const list = (values: string[]) =>
      values.length ? values.map((v) => `  - ${v}`).join("\n") : "  (none given)";

    const icp = [
      `What we sell: ${input.icp.sells || "(not stated)"}`,
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

    const observed = (input.observed ?? []).filter((e) => e.claim.trim());
    const observedBlock = observed.length
      ? [
          "",
          wrapUntrusted(
            "previously observed evidence",
            observed
              .map((e) =>
                [
                  `- [${e.kind}${e.confidence ? `, ${e.confidence}` : ""}] ${e.claim}`,
                  e.eventDate ? `  happened: ${e.eventDate.slice(0, 10)}` : null,
                  e.sourceUrl ? `  read at: ${e.sourceUrl}` : null,
                  e.excerpt ? `  quote: ${e.excerpt}` : null,
                ]
                  .filter(Boolean)
                  .join("\n"),
              )
              .join("\n"),
          ),
        ].join("\n")
      : "";

    return [
      `Qualify this company: ${url}`,
      "",
      // The ICP is our own user's, but `sells` was written by a model reading a
      // website and the triggers were pre-filled from the same place. Both
      // blocks are framed as data for the same reason.
      wrapUntrusted("ideal customer profile", icp),
      "",
      wrapUntrusted("URL supplied by the user", url),
      observedBlock,
      "",
      "The exclusions are absolute. A company matching one is ignore however " +
        "strong everything else looks.",
    ].join("\n");
  },

  fetchDomains: (input) => normalizeUrl(input.url).fetchDomains,

  // Entity resolution (§59) has not run at this point — on the analyze screen
  // there may be no company row at all — so the run is attributed by type.
  entity: () => ({ type: "company", id: null }),

  parse: (json, input) => {
    const { url, canonicalDomain } = normalizeUrl(input.url);
    if (!json || typeof json !== "object") {
      throw new Error("qualify_opportunity: response was not an object.");
    }
    const raw = json as Record<string, unknown>;

    const priority = raw.priority;
    if (typeof priority !== "string" || !isPriority(priority)) {
      throw new Error(
        `qualify_opportunity: unknown priority ${JSON.stringify(priority)}.`,
      );
    }

    const score = raw.score;
    if (typeof score !== "number" || !Number.isInteger(score) || score < 0 || score > 100) {
      throw new Error(
        `qualify_opportunity: score ${JSON.stringify(score)} is not 0–100.`,
      );
    }

    const scoreConfidence = raw.scoreConfidence;
    if (typeof scoreConfidence !== "string" || !CONFIDENCES.includes(scoreConfidence as Confidence)) {
      // §16: a score with no stated confidence, or one expressed as a number,
      // is the fake precision the master context names outright.
      throw new Error(
        `qualify_opportunity: score confidence must be high, medium or low, ` +
          `not ${JSON.stringify(scoreConfidence)}.`,
      );
    }

    const text = (key: string): string => {
      const value = raw[key];
      if (typeof value !== "string" || !value.trim()) {
        // §51 / §77 P4: a model-produced verdict without its reasoning is the
        // one thing this screen must never render.
        throw new Error(`qualify_opportunity: ${key} is missing.`);
      }
      return value.trim();
    };

    const explanation = text("explanation");
    const priorityReason = text("priorityReason");
    const summary = text("summary");
    const recommendation = text("recommendation");

    // ── Dimensions ──────────────────────────────────────────────────────────
    if (!Array.isArray(raw.dimensions)) {
      throw new Error("qualify_opportunity: response carried no dimensions array.");
    }
    const byLabel = new Map<ScoreDimensionLabel, ScoredDimension>();
    for (const item of raw.dimensions as RawDimension[]) {
      const label = item.label;
      if (typeof label !== "string" || !isDimensionLabel(label)) {
        throw new Error(
          `qualify_opportunity: unexpected dimension ${JSON.stringify(label)}. ` +
            `§51 fixes this list at eight; a ninth is invented structure.`,
        );
      }
      if (byLabel.has(label)) {
        throw new Error(`qualify_opportunity: ${label} was scored twice.`);
      }

      let value: number | "unknown";
      if (item.value === "unknown") {
        value = "unknown";
      } else if (
        typeof item.value === "number" &&
        Number.isInteger(item.value) &&
        item.value >= 0 &&
        item.value <= 100
      ) {
        value = item.value;
      } else {
        throw new Error(
          `qualify_opportunity: ${label} is ${JSON.stringify(item.value)}, ` +
            `which is neither 0–100 nor "unknown".`,
        );
      }

      byLabel.set(label, {
        label,
        value,
        note: typeof item.note === "string" && item.note.trim() ? item.note.trim() : null,
      });
    }

    const missingDimensions = SCORE_DIMENSIONS.filter((d) => !byLabel.has(d));
    if (missingDimensions.length) {
      // Not defaulted to "unknown": an unanswered dimension and one the model
      // considered and could not establish are different, and the whole point
      // of carrying "unknown" is that we can tell them apart.
      throw new Error(
        `qualify_opportunity: no score for ${missingDimensions.join(", ")}. ` +
          `All ${SCORE_DIMENSIONS.length} dimensions are required, unknowns included.`,
      );
    }

    // ── §15 / §78: the verdict has to be one the dimensions can support ─────
    const unestablished = PRIORITY_REQUIRES[priority].filter(
      (label) => byLabel.get(label)!.value === "unknown",
    );
    if (unestablished.length) {
      throw new Error(
        `qualify_opportunity: ${priority.toUpperCase()} requires ` +
          `${unestablished.join(" and ")} to have been established (§15). ` +
          `A company with nothing measured there is WATCH (§78), not a ` +
          `stretched ${priority.toUpperCase()}.`,
      );
    }

    // ── Evidence ────────────────────────────────────────────────────────────
    /* Every page this run could legitimately have read, other than the
       company's own site. Built from the input rather than from the output, so
       the model cannot extend it by claiming to have been given something. */
    const readUrls = new Set(
      (input.observed ?? [])
        .map((e) => e.sourceUrl?.trim())
        .filter((u): u is string => Boolean(u)),
    );

    if (!Array.isArray(raw.evidence)) {
      throw new Error("qualify_opportunity: response carried no evidence array.");
    }
    const evidence: QualificationEvidence[] = [];
    for (const item of raw.evidence as RawEvidence[]) {
      const kind = item.kind;
      if (typeof kind !== "string" || !CLAIM_KINDS.includes(kind as ClaimKind)) {
        throw new Error(
          `qualify_opportunity: evidence with an unknown kind ${JSON.stringify(kind)}.`,
        );
      }

      const entry: QualificationEvidence = {
        claim: typeof item.claim === "string" ? item.claim.trim() : "",
        kind: kind as ClaimKind,
        confidence:
          typeof item.confidence === "string" && CONFIDENCES.includes(item.confidence as Confidence)
            ? (item.confidence as Confidence)
            : null,
        sourceUrl:
          typeof item.sourceUrl === "string" && item.sourceUrl.trim()
            ? item.sourceUrl.trim()
            : null,
        excerpt:
          typeof item.excerpt === "string" && item.excerpt.trim()
            ? item.excerpt.trim()
            : null,
      };

      // §7, at the boundary. A fact with no URL never becomes evidence.
      assertValidClaim({
        kind: entry.kind,
        claim: entry.claim,
        sourceUrl: entry.sourceUrl,
        confidence: entry.confidence,
      });

      /*
       * And a fact must cite the only thing the model was able to read.
       *
       * This is the check that catches a fabricated citation. The task's fetch
       * allow-list is this company's own domain, so a "fact" sourced to
       * techcrunch.com was not observed — it was recalled, or invented, and it
       * would render on screen with a source link and a FACT badge, which is
       * the most credible-looking form a hallucination can take in this
       * product. §7 says a fact is something observed at a source; this makes
       * "observed" mean observed *here*.
       */
      if (entry.kind === "fact") {
        let citedDomain: string | null = null;
        try {
          citedDomain = normalizeUrl(entry.sourceUrl!).canonicalDomain;
        } catch {
          throw new Error(
            `qualify_opportunity: a fact cites ${JSON.stringify(entry.sourceUrl)}, ` +
              `which is not a URL.`,
          );
        }
        /* The allowed set is the company's own domain plus the exact URLs of
           the observations we supplied — not their domains. Widening to the
           domain would let one cited article from a publication license every
           other claim attributed to it, which is the fabrication this check
           exists to catch, one indirection later. */
        if (citedDomain !== canonicalDomain && !readUrls.has(entry.sourceUrl!.trim())) {
          throw new Error(
            `qualify_opportunity: a fact cites ${citedDomain}, but only ` +
              `${canonicalDomain} was fetched` +
              (readUrls.size
                ? ` and ${readUrls.size} observed page(s) were supplied`
                : "") +
              `. A source that was never read cannot support a fact (§7).`,
          );
        }
      }

      evidence.push(entry);
    }

    const companyName =
      typeof raw.companyName === "string" && raw.companyName.trim()
        ? raw.companyName.trim()
        : canonicalDomain;

    return {
      url,
      canonicalDomain,
      companyName,
      priority,
      priorityReason,
      score,
      scoreConfidence: scoreConfidence as Confidence,
      explanation,
      // Fixed order, so the breakdown does not reshuffle between runs.
      dimensions: SCORE_DIMENSIONS.map((d) => byLabel.get(d)!),
      summary,
      recommendation,
      evidence,
    };
  },
};

interface RawDimension {
  label?: unknown;
  value?: unknown;
  note?: unknown;
}

interface RawEvidence {
  claim?: unknown;
  kind?: unknown;
  confidence?: unknown;
  sourceUrl?: unknown;
  excerpt?: unknown;
}

function isPriority(value: string): value is Priority {
  return (PRIORITIES as readonly string[]).includes(value);
}

function isDimensionLabel(value: string): value is ScoreDimensionLabel {
  return (SCORE_DIMENSIONS as readonly string[]).includes(value);
}
