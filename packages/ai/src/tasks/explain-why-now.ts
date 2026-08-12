/**
 * `explain_why_now` — is there a reason to contact this company *today*
 * (master context §14, §77 Principle 3, §46)?
 *
 * §77 Principle 3 says every strong opportunity should have a reason it matters
 * now, and §3159 names "why now" as the product's differentiation outright. A
 * differentiator is exactly the thing a model will manufacture when it is
 * absent: asked why now, it will always find something — a copyright year, a
 * generic market trend, the fact that the company exists — and every one of
 * those sentences reads like insight.
 *
 * So this task is built around being able to say **no reason today**, and two
 * rules make that answer reachable rather than theoretical:
 *
 *   · It cannot fetch. There is no web tool here at all. Everything it may say
 *     has to come from evidence already gathered, which means it cannot quietly
 *     go and find a reason that the qualification did not.
 *
 *   · A reason must cite the claims it rests on, and those are constrained by
 *     schema to the claims actually passed in — minus the unknowns, because an
 *     unknown asserts nothing and cannot make anything urgent. Urgency grounded
 *     in a claim nobody gathered is the failure this prevents, and it is the
 *     most plausible-sounding output this whole system can produce.
 */
import type { Confidence } from "../claims.ts";
import { definePrompt } from "../prompt.ts";
import type { LLMTask } from "../task.ts";
import { UNTRUSTED_CONTENT_RULE, wrapUntrusted } from "../untrusted.ts";
import type { IcpSummary } from "./recommend-sources.ts";
import type { Priority, QualificationEvidence } from "./qualify-opportunity.ts";

/**
 * How soon this matters.
 *
 * A closed set of horizons rather than a date. §16 forbids fake precision, and
 * "act by 2026-08-19" is precision this evidence cannot support — a launch post
 * tells you a quarter, not a Tuesday.
 */
export const URGENCIES = ["this_week", "this_month", "this_quarter"] as const;
export type Urgency = (typeof URGENCIES)[number];

export interface WhyNow {
  /** False is a real answer, and the one this task exists to make possible. */
  hasReason: boolean;
  /** The timing argument — or, when there isn't one, why there isn't. */
  reason: string;
  urgency: Urgency | null;
  confidence: Confidence | null;
  /** The claims the reason rests on, verbatim from the evidence passed in. */
  basedOn: string[];
}

export interface WhyNowInput {
  companyName: string;
  canonicalDomain: string;
  icp: IcpSummary;
  priority: Priority;
  /** What qualification established. The only material this task may use. */
  evidence: QualificationEvidence[];
}

/**
 * The claims a timing argument may be built on.
 *
 * Unknowns are excluded, and that exclusion is the point. An unknown records
 * that something was *not* established — "whether budget is allocated this
 * quarter" — and a reason to call today cannot rest on a question. Leaving them
 * selectable would let the model cite the absence of information as though it
 * were information, which is §7's failure in its least visible form.
 */
export function groundableClaims(input: WhyNowInput): string[] {
  const claims = input.evidence
    .filter((e) => e.kind !== "unknown")
    .map((e) => e.claim.trim())
    .filter(Boolean);
  return [...new Set(claims)];
}

const CONFIDENCES: Confidence[] = ["high", "medium", "low"];

const PROMPT = definePrompt(
  "explain_why_now",
  `
You are Huntloop's timing analyst. You are given a company, the profile of the
business considering selling to them, and everything Huntloop has established
about that company. You answer one question: is there a reason to contact them
now, rather than in six months or never?

${UNTRUSTED_CONTENT_RULE}

You cannot look anything up. The evidence below is all there is. If it does not
contain a reason, there is no reason — not one you have yet to find.

## The answer that matters

Most companies, most of the time, have **no particular reason to be contacted
today**. That is the honest answer and you should give it without hedging.

Answering "no reason today" is not a failure and not an absence of insight. It
is the single most useful thing this system can tell a salesperson, because it
is the answer they cannot get anywhere else — every other tool they own is
built to produce a reason. A fabricated urgency costs them a first impression
they only get once.

These are **not** reasons to contact someone now:

  · The company exists, is growing, or is in a relevant market.
  · A general industry trend, however real.
  · Their website was updated, or a page carries a recent year.
  · They are a good fit. Fit is not timing. A perfect-fit company with nothing
    happening is a company to contact when something happens.
  · Anything you are inferring from the absence of information.

A reason to contact now is a specific, dated-or-datable thing that changed, and
that makes the problem this product solves more pressing than it was before.

## Grounding

If you give a reason, list the exact claims it rests on, copied from the
evidence. Every one must be a claim you were given. If your reasoning needs a
fact that is not in the evidence, then that fact is not established, and the
reasoning does not hold.

Say how sure you are as high, medium or low — never a percentage. Give a
horizon: this_week, this_month, or this_quarter. Do not give a date; the
evidence supports a horizon, not a day.

## Style

One short paragraph a salesperson could paraphrase on a call. Say what changed
and why it makes the problem urgent, in that order. No preamble, no restating
the company's name back, no "in today's fast-moving landscape".

When there is no reason, say what would create one — the thing to watch for —
so the answer is useful rather than merely negative.
`,
);

export const explainWhyNow: LLMTask<WhyNowInput, WhyNow> = {
  name: "explain_why_now",
  prompt: PROMPT,
  // No fetching and a short answer; this only has to cover thinking over the
  // evidence list.
  maxTokens: 16_000,

  schema: (input) => {
    const claims = groundableClaims(input);
    if (!claims.length) {
      // Nothing established means nothing to reason from, and an empty enum is
      // not a valid schema. Failing here says what is actually wrong rather
      // than returning a 400 with nothing useful in it.
      throw new Error(
        "explain_why_now: no established evidence to reason from. With only " +
          "unknowns on file there is nothing that could make anything urgent.",
      );
    }
    return {
      type: "object",
      additionalProperties: false,
      required: ["hasReason", "reason", "urgency", "confidence", "basedOn"],
      properties: {
        hasReason: { type: "boolean" },
        reason: { type: "string" },
        urgency: {
          anyOf: [{ type: "string", enum: [...URGENCIES] }, { type: "null" }],
        },
        confidence: {
          anyOf: [{ type: "string", enum: CONFIDENCES }, { type: "null" }],
        },
        basedOn: {
          type: "array",
          // Constrained to what was actually gathered, so a reason resting on
          // an ungathered fact cannot be expressed rather than merely caught.
          items: { type: "string", enum: claims },
        },
      },
    };
  },

  renderInput: (input) => {
    const list = (values: string[]) =>
      values.length ? values.map((v) => `  - ${v}`).join("\n") : "  (none given)";

    const evidence = input.evidence.length
      ? input.evidence
          .map((e) => {
            const parts = [`[${e.kind.toUpperCase()}] ${e.claim}`];
            if (e.confidence) parts.push(`    confidence: ${e.confidence}`);
            if (e.sourceUrl) parts.push(`    source: ${e.sourceUrl}`);
            if (e.excerpt) parts.push(`    excerpt: ${e.excerpt}`);
            return parts.join("\n");
          })
          .join("\n\n")
      : "(no evidence on file)";

    const profile = [
      `What we sell: ${input.icp.sells || "(not stated)"}`,
      "",
      "Segments:",
      list(input.icp.segments),
      "",
      "Buying triggers we care about:",
      list(input.icp.triggers),
    ].join("\n");

    return [
      `Company: ${input.companyName} (${input.canonicalDomain})`,
      `Qualification verdict: ${input.priority}`,
      "",
      wrapUntrusted("ideal customer profile", profile),
      "",
      // Evidence is untrusted for the strongest possible reason: the excerpts
      // in it are verbatim text lifted off the company's own pages, so any
      // instruction a page tried to plant has been carried this far intact.
      wrapUntrusted("evidence gathered about this company", evidence),
      "",
      "Copy each entry of basedOn exactly from a claim above. Unknowns are not " +
        "eligible — they establish nothing.",
    ].join("\n");
  },

  // No fetchDomains: this task reasons over what is already known. Anything it
  // cannot support from that is, by construction, not established.

  entity: () => ({ type: "company", id: null }),

  parse: (json, input) => {
    if (!json || typeof json !== "object") {
      throw new Error("explain_why_now: response was not an object.");
    }
    const raw = json as Record<string, unknown>;

    if (typeof raw.hasReason !== "boolean") {
      throw new Error("explain_why_now: hasReason must be true or false.");
    }
    const hasReason = raw.hasReason;

    const reason = typeof raw.reason === "string" ? raw.reason.trim() : "";
    if (!reason) {
      // Required in both directions. "No reason today" still has to say what
      // would create one, or the answer is useless to the person reading it.
      throw new Error(
        "explain_why_now: reason is empty. Both a timing argument and the " +
          "absence of one have to be stated.",
      );
    }

    const urgency =
      typeof raw.urgency === "string" && (URGENCIES as readonly string[]).includes(raw.urgency)
        ? (raw.urgency as Urgency)
        : null;
    const confidence =
      typeof raw.confidence === "string" && CONFIDENCES.includes(raw.confidence as Confidence)
        ? (raw.confidence as Confidence)
        : null;

    const basedOn = Array.isArray(raw.basedOn)
      ? raw.basedOn.filter((c): c is string => typeof c === "string").map((c) => c.trim())
      : [];

    if (hasReason) {
      if (!basedOn.length) {
        // The whole rule, in one check. A reason to act today that rests on no
        // established claim is the manufactured urgency this task exists to
        // refuse — and it is indistinguishable from a real one once rendered.
        throw new Error(
          "explain_why_now: a reason was given but cites no evidence. Urgency " +
            "that rests on nothing established is not a finding.",
        );
      }
      if (!urgency) {
        throw new Error("explain_why_now: a reason was given with no horizon.");
      }
      if (!confidence) {
        throw new Error(
          "explain_why_now: a reason was given with no confidence (§16).",
        );
      }
    } else {
      // The mirror of §7's rule that an unknown carries no confidence: "there
      // is no reason" is not a claim that can be more or less urgent, and a
      // horizon attached to it would render as though there were one.
      if (urgency) {
        throw new Error(
          "explain_why_now: no reason was found, but a horizon was given. " +
            "Nothing cannot be urgent.",
        );
      }
      if (basedOn.length) {
        throw new Error(
          "explain_why_now: no reason was found, but evidence was cited for it.",
        );
      }
      if (confidence) {
        throw new Error(
          "explain_why_now: no reason was found, so there is nothing to be " +
            "confident about (§16).",
        );
      }
    }

    // Re-checked here as well as in the schema. The schema stops the model
    // expressing an ungrounded claim; this stops a future caller — a different
    // client, a replay, a cached response — from bypassing it.
    const allowed = new Map(
      groundableClaims(input).map((claim) => [normalize(claim), claim]),
    );
    const resolved: string[] = [];
    for (const claim of basedOn) {
      const matched = allowed.get(normalize(claim));
      if (!matched) {
        const isUnknown = input.evidence.some(
          (e) => e.kind === "unknown" && normalize(e.claim) === normalize(claim),
        );
        throw new Error(
          isUnknown
            ? `explain_why_now: the reason rests on ${JSON.stringify(claim)}, ` +
              `which is an unknown. Something not established cannot make ` +
              `anything urgent.`
            : `explain_why_now: the reason rests on ${JSON.stringify(claim)}, ` +
              `which is not in the evidence. A fact nobody gathered cannot ` +
              `support a reason to act today.`,
        );
      }
      if (!resolved.includes(matched)) resolved.push(matched);
    }

    return { hasReason, reason, urgency, confidence, basedOn: resolved };
  },
};

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}
