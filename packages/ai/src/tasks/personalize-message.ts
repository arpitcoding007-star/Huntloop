/**
 * `personalize_message` — write the email, and name the evidence behind every
 * claim in it.
 *
 * ── The one rule that shapes everything else ─────────────────────────────
 *
 * §62 rule 9, and `messages.evidence_ids` in `0004`: a personalized claim
 * names the evidence backing it, or the message does not send. That is not a
 * documentation convention — it is a `uuid[]` column, and this task's output
 * is what fills it.
 *
 * The consequence is that the model cannot write "I saw you're scaling the
 * platform team" unless one of the evidence items it was given says so. It has
 * a closed set of ids to cite from, built from the input, so a claim
 * attributed to evidence nobody gathered is *unrepresentable* rather than
 * merely detectable. The failure this prevents is the specific one that makes
 * AI outreach notorious: a fluent, specific, wrong first line, sent to
 * somebody who knows it is wrong.
 *
 * ── Why the customer-visible artifact runs on Opus ───────────────────────
 *
 * `models.ts` states it: a bad opener burns the prospect permanently. There is
 * no second first email, and the token delta against the cost of a burned
 * account is not close.
 */
import { definePrompt } from "../prompt.ts";
import type { LLMTask } from "../task.ts";
import { UNTRUSTED_CONTENT_RULE, wrapUntrusted } from "../untrusted.ts";

export interface MessageEvidence {
  /** The `evidence.id` this claim would cite. */
  id: string;
  claim: string;
  kind: "fact" | "inference" | "unknown";
  sourceUrl: string | null;
  eventDate: string | null;
}

export interface PersonalizeInput {
  companyName: string;
  /** Who it is going to. Null when only the company is known. */
  recipientName: string | null;
  recipientTitle: string | null;
  /** What we sell, one sentence, from the product record. */
  weSell: string;
  /** The angle the qualifier recommended. The message argues this. */
  angle: string;
  /** Where in the sequence this is. Step 0 is the first touch. */
  step: number;
  /** The subject and body the sequence step carries, as a starting point. */
  template: { subject: string | null; body: string | null };
  /** The claims that may be cited. A message may cite none. */
  evidence: MessageEvidence[];
  /** House style, from `memories`. Applied over everything below. */
  guidance: string[];
}

export interface PersonalizedMessage {
  subject: string;
  /** Plain text. Nothing in this product renders model output as markup. */
  body: string;
  /** `evidence.id` values. Every specific claim in the body appears here. */
  citedEvidenceIds: string[];
  /**
   * What the model chose not to say because it could not support it.
   *
   * Surfaced to the reviewer rather than discarded. It is the most useful
   * thing on the approval screen: it says what the message *would* have
   * claimed, which is exactly what a human might be able to confirm.
   */
  omitted: string[];
}

/**
 * A hard ceiling on length, enforced after generation.
 *
 * 900 characters is roughly 150 words. Cold emails that get replies are short,
 * and a model asked to be helpful will reliably write four paragraphs. This is
 * the constraint that survives that instinct.
 */
export const MAX_BODY_CHARS = 900;

/**
 * Phrases that fail the message rather than being asked about again.
 *
 * ── Why a deterministic check and not more prompt ────────────────────────
 *
 * The prompt below already says not to write most of these, and it mostly
 * works. "Mostly" is the problem: prompt compliance has no failure signal, so
 * the calls where it did not comply are indistinguishable from the calls where
 * there was nothing to comply about. Nobody finds out, because the output is
 * fluent and the phrase is only obviously wrong to the person receiving it.
 *
 * The reference system Huntloop is a second draft of had this check and got
 * three things wrong, each worth naming because the fix is the opposite of
 * each:
 *
 *   · It checked three of seven generated fields. The subject line — the part
 *     that decides whether anything is read — was never checked at all.
 *   · On a hit it silently re-ran the model once and returned whatever came
 *     back **without re-checking it**. A stubborn model shipped the phrase
 *     anyway, and the retry left no trace of having happened.
 *   · The retry cost a second Opus call that appeared in no accounting.
 *
 * So this one throws. A violation becomes a failed `ai_runs` row with the
 * offending phrase in `error`, attributable to a prompt version — which is
 * what makes the list tunable: an operator can see that "circle back" fires
 * twice a week and decide whether the prompt or the list is wrong. A silent
 * retry produces no such number, and the question never gets asked.
 *
 * ── Why the list is short and literal ────────────────────────────────────
 *
 * Every entry is a phrase whose presence is decisive on its own — nobody
 * writes "I hope this email finds you well" and means something else by it.
 * Substring matching, case-insensitive, no stemming and no fuzzy distance:
 * "touching base" is not caught by "touch base" and that is the correct
 * trade. A false positive here costs a real message and a confusing failure;
 * the cost of a miss is one mediocre email.
 */
export const BANNED_PHRASES: readonly string[] = [
  "hope this email finds you well",
  "hope this finds you well",
  "i wanted to reach out",
  "i'm reaching out",
  "just reaching out",
  "in today's fast-paced",
  "circle back",
  "touch base",
  "synergy",
  "game-changer",
  "game changer",
  "revolutionize",
  "revolutionise",
  "quick question for you",
  "picking your brain",
  "bumping this to the top",
  "just following up",
  "per my last email",
  "low-hanging fruit",
  "move the needle",
];

/**
 * The first banned phrase in a piece of text, or null.
 *
 * Exported so the same list can be applied to a human-edited draft on the
 * approval screen. One list, checked in both places — a second copy is how the
 * screen ends up permitting what the task refuses.
 */
export function findBannedPhrase(value: string): string | null {
  const haystack = value.toLowerCase();
  return BANNED_PHRASES.find((phrase) => haystack.includes(phrase)) ?? null;
}

const PROMPT = definePrompt(
  "personalize_message",
  `
You write one cold email. It is short, it is specific, and every specific
thing in it is traceable to evidence you were given.

${UNTRUSTED_CONTENT_RULE}

## The rule

Every claim about the recipient's company must cite one of the evidence items
you were given, by id. If you cannot cite it, you may not write it.

This is not a style guideline. A claim with no evidence behind it is how these
emails become the thing everyone deletes: fluent, specific, and wrong — sent to
somebody who knows exactly how wrong it is. When you want to say something and
have nothing to support it, put it in \`omitted\` and leave it out of the body.

Evidence marked \`unknown\` establishes nothing and cannot be cited as though it
did. Evidence marked \`inference\` is a conclusion, not an observation, so write
it as one: "it looks like", "I'd guess", not "I saw that".

## What to write

One observation, one reason it matters to them, one question. In that order.

The observation comes from the evidence and is the reason you are writing
today. The reason it matters connects it to what we sell — briefly, without
describing the product. The question is answerable in one line and is not
"do you have 15 minutes".

Do not open with a compliment. Do not say "I hope this finds you well". Do not
use the word "solution". Do not describe your own email ("I'm reaching out
because"). Do not stack three questions and call it one.

## Length

Under ${MAX_BODY_CHARS} characters. Shorter is better. If the evidence supports
only one sentence, send one sentence — a short email with one true specific
thing outperforms a long one with three vague ones.

## The subject

Four words or fewer, lower case, no punctuation at the end. It should read like
something a colleague would type, not like a campaign. Never a question, never
the company's own name alone.

## Follow-ups

If this is not the first step, do not repeat the first message's argument.
Add one thing: a different angle from a different piece of evidence, or a
genuinely shorter nudge. Never "just bumping this to the top of your inbox".

## Style guidance

Anything under "house style" comes from the sender and overrides the
instructions above where they conflict — except the citation rule, which
nothing overrides.
`,
);

export const personalizeMessage: LLMTask<PersonalizeInput, PersonalizedMessage> = {
  name: "personalize_message",
  prompt: PROMPT,
  maxTokens: 8_000,

  schema: (input) => {
    const ids = input.evidence.map((e) => e.id);
    return {
      type: "object",
      additionalProperties: false,
      required: ["subject", "body", "citedEvidenceIds", "omitted"],
      properties: {
        subject: { type: "string" },
        body: { type: "string" },
        citedEvidenceIds: {
          type: "array",
          /* The closed set that makes a fabricated citation unrepresentable.
             When there is no evidence the array is empty and the enum would be
             illegal, so the constraint becomes maxItems: 0 — which says the
             same thing and is a valid schema. */
          ...(ids.length
            ? { items: { type: "string", enum: ids } }
            : { maxItems: 0, items: { type: "string" } }),
        },
        omitted: { type: "array", items: { type: "string" }, maxItems: 5 },
      },
    };
  },

  renderInput: (input) => {
    const evidence = input.evidence.length
      ? input.evidence
          .map((e) =>
            [
              `id: ${e.id}`,
              `kind: ${e.kind}`,
              `claim: ${e.claim}`,
              e.eventDate ? `happened: ${e.eventDate.slice(0, 10)}` : null,
              e.sourceUrl ? `source: ${e.sourceUrl}` : null,
            ]
              .filter(Boolean)
              .join("\n"),
          )
          .join("\n\n")
      : "(no evidence was gathered for this company)";

    return [
      input.step === 0
        ? "Write the first email in this sequence."
        : `Write step ${input.step + 1} of this sequence. Earlier steps have been sent.`,
      "",
      `To: ${input.recipientName ?? "the buyer"}${
        input.recipientTitle ? `, ${input.recipientTitle}` : ""
      } at ${input.companyName}`,
      `We sell: ${input.weSell}`,
      `The angle: ${input.angle}`,
      "",
      wrapUntrusted("evidence you may cite", evidence),
      "",
      input.template.subject || input.template.body
        ? wrapUntrusted(
            "the sequence step's template, as a starting point",
            [input.template.subject, input.template.body].filter(Boolean).join("\n\n"),
          )
        : "(this step has no template — write it from the evidence)",
      "",
      input.guidance.length
        ? wrapUntrusted("house style", input.guidance.map((g) => `- ${g}`).join("\n"))
        : "(no house style recorded)",
      "",
      "Cite by id. Anything you cannot cite goes in `omitted`, not in the body.",
    ].join("\n");
  },

  // No web tool. Everything this task may assert is already in front of it,
  // and a drafting task that can browse is one that can be walked onto an
  // arbitrary host by a page it was reading.

  entity: () => ({ type: "message", id: null }),

  parse: (json, input) => {
    if (!json || typeof json !== "object") {
      throw new Error("personalize_message: response was not an object.");
    }
    const raw = json as Record<string, unknown>;

    const subject = typeof raw.subject === "string" ? raw.subject.trim() : "";
    const body = typeof raw.body === "string" ? raw.body.trim() : "";
    if (!subject) throw new Error("personalize_message: the message has no subject.");
    if (!body) throw new Error("personalize_message: the message has no body.");

    if (body.length > MAX_BODY_CHARS * 1.2) {
      /* A 20% tolerance over the stated ceiling, then a hard stop. Truncating
         instead would send a message that ends mid-sentence, which is worse
         than one that has to be regenerated. */
      throw new Error(
        `personalize_message: the body is ${body.length} characters. The ` +
          `limit is ${MAX_BODY_CHARS}, and a long cold email is not a ` +
          `stylistic preference — it is the reason it is not read.`,
      );
    }

    /* Every generated field, not just the body. The subject is what decides
       whether the body is read, and it was the field the reference system's
       version never looked at. Checked before the citation rules because a
       message that opens "I hope this email finds you well" is not worth
       validating the citations of. */
    for (const [field, value] of [
      ["subject", subject],
      ["body", body],
    ] as const) {
      const phrase = findBannedPhrase(value);
      if (phrase) {
        throw new Error(
          `personalize_message: the ${field} contains “${phrase}”. That phrase ` +
            `is the reason cold email is deleted unread, and it is the one part ` +
            `of the message the recipient is certain to have seen before.`,
        );
      }
    }

    if (!Array.isArray(raw.citedEvidenceIds)) {
      throw new Error("personalize_message: response carried no citation array.");
    }

    const allowed = new Set(input.evidence.map((e) => e.id));
    const cited: string[] = [];
    for (const id of raw.citedEvidenceIds) {
      if (typeof id !== "string" || !allowed.has(id)) {
        throw new Error(
          `personalize_message: the message cites ${JSON.stringify(id)}, which is ` +
            `not evidence this company has. §62 rule 9 makes a claim without ` +
            `evidence a message that does not send.`,
        );
      }
      if (!cited.includes(id)) cited.push(id);
    }

    /* An `unknown` establishes nothing, so citing one is citing an absence.
       Checked here rather than left to the schema, because the schema can only
       constrain the id — not what the evidence behind it says. */
    const unknowns = input.evidence.filter((e) => e.kind === "unknown").map((e) => e.id);
    const citedUnknown = cited.find((id) => unknowns.includes(id));
    if (citedUnknown) {
      throw new Error(
        `personalize_message: the message cites evidence ${citedUnknown}, which ` +
          `is an unknown. Citing "we don't know this" as support for a claim ` +
          `is the §7 failure in its most persuasive form.`,
      );
    }

    return {
      subject,
      body,
      citedEvidenceIds: cited,
      omitted: Array.isArray(raw.omitted)
        ? raw.omitted.filter((o): o is string => typeof o === "string" && o.trim().length > 0)
        : [],
    };
  },
};
