/**
 * `extract_signals` — turn one fetched document into §33's normalized events.
 *
 * This is the narrowest task in the product and it is deliberately the dullest.
 * §33's abstraction is that the intelligence engine consumes `source_events`
 * and never needs to know whether the origin was Reddit, GitHub or a press
 * release. That only holds if extraction is *mechanical*: the moment this task
 * starts reasoning about whether an event matters, the engine downstream is
 * reading a judgement it cannot see the basis of.
 *
 * So the contract is: what happened, to whom, when, and where it says so.
 * Whether it is worth acting on is `qualify_opportunity`'s question, and it
 * has the ICP to answer it with. This one does not.
 *
 * ── The two failure modes it is written against ──────────────────────────
 *
 * **Inventing a company.** An article about "the funding environment for
 * fintech" names no company, and the useful-sounding answer is to attach the
 * event to whichever company the reader has in mind. `companyName` and
 * `companyDomain` are therefore both nullable, and an event with neither is
 * discarded by the caller rather than guessed at.
 *
 * **Promoting the article's framing into a fact.** A press release saying
 * "Acme is transforming logistics" is a fact about the press release and an
 * inference about Acme. Every event carries `kind`, and the prompt is explicit
 * that the only facts are things the document states as having happened.
 *
 * Routed to Haiku (see `models.ts`): closed-set classification over text that
 * is already in front of it, at the highest volume of any task here.
 */
import { definePrompt } from "../prompt.ts";
import type { LLMTask } from "../task.ts";
import { UNTRUSTED_CONTENT_RULE, wrapUntrusted } from "../untrusted.ts";
import { CONFIDENCES, type Confidence } from "../claims.ts";

/**
 * The event vocabulary.
 *
 * Closed, and short. `source_events.event_type` is free text in the schema, so
 * nothing stops a hundred one-off types accumulating there — at which point
 * "signals by type" on the Command Center becomes a histogram with a hundred
 * bars of one, and the scoring rules cannot match on anything.
 *
 * `other` is the escape hatch and is meant to be used: an event that is real
 * but does not fit is better recorded as `other` with a description than
 * squeezed into `product_launch` because that was the closest word.
 */
export const EVENT_TYPES = [
  "funding",
  "hiring",
  "product_launch",
  "technology_adoption",
  "leadership_change",
  "expansion",
  "partnership",
  "acquisition",
  "regulatory",
  "outage_or_incident",
  "layoffs",
  "public_complaint",
  "other",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export interface SignalDocument {
  url: string;
  title: string | null;
  /** When the document says it was published. Null is common and is honest. */
  publishedAt: string | null;
  text: string;
}

export interface ExtractedSignal {
  eventType: EventType;
  /** One sentence, in Huntloop's voice, saying what happened. */
  description: string;
  /** As written in the document. Null when the document names nobody. */
  companyName: string | null;
  /**
   * The company's own domain, when the document gives it.
   *
   * This is the §59 entity-resolution key, so a wrong one is worse than none:
   * it attaches an event to the wrong company's record permanently. The prompt
   * asks for it only when the document contains the address.
   */
  companyDomain: string | null;
  /** ISO date. Null when the document does not say when. */
  eventDate: string | null;
  kind: "fact" | "inference";
  confidence: Confidence;
  /** Verbatim from the document. What makes the claim checkable. */
  excerpt: string;
}

/** Upper bound per document. A page yielding more than this is a listing. */
export const MAX_SIGNALS = 8;

const PROMPT = definePrompt(
  "extract_signals",
  `
You read one document and list the business events it reports. Nothing else.

${UNTRUSTED_CONTENT_RULE}

## What an event is

Something that happened to a specific, named company, at a point in time:
raised money, hired for a named role, shipped something, adopted a technology,
changed leadership, opened a market, partnered, acquired or was acquired,
cleared or failed a regulator, had an outage, cut staff, or was publicly
complained about.

A trend is not an event. An opinion is not an event. A company being described
favourably is not an event. If the document is analysis, commentary, or a
listicle with no specific occurrence in it, return an empty list — that is a
correct and common answer, not a failure.

## Which company

Name the company exactly as the document does. Give its domain ONLY if the
document contains the address — in a link, a byline, or the text. Do not
reconstruct a domain from a company name: "Northwind Logistics" is not
necessarily northwind.com, and attaching an event to the wrong company's record
is worse than attaching it to none.

If the document names no company, return an empty list. Do not attribute an
event to the publication that reported it.

## fact or inference

  fact       The document states it happened. "Acme raised a $12M Series A."
  inference  You concluded it from what the document says. "Acme is expanding
             into Europe" from a job posting for a Berlin office.

A company's own description of itself is a fact about what they said, and an
inference about the world. "Acme says it is the market leader" is a fact;
"Acme is the market leader" is not.

## When

Use the date the document gives for the event. If it gives none, use null —
not the publication date, which is when it was written about, and not today.
A six-month-old event reported yesterday is still six months old.

## The excerpt

Copy the sentence from the document that supports the event, verbatim. Not a
paraphrase, not a summary. It is what lets a person check the claim without
re-reading the page, and a reworded excerpt cannot be found by searching for it.

## Confidence

high    stated plainly and unambiguously
medium  stated, but with hedging, or assembled from two places in the document
low     a defensible reading that another careful reader might not share

Return at most ${MAX_SIGNALS} events. If the document reports more than that,
return the ones stated most plainly.
`,
);

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["events"],
  properties: {
    events: {
      type: "array",
      maxItems: MAX_SIGNALS,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "eventType",
          "description",
          "companyName",
          "companyDomain",
          "eventDate",
          "kind",
          "confidence",
          "excerpt",
        ],
        properties: {
          eventType: { type: "string", enum: [...EVENT_TYPES] },
          description: { type: "string" },
          companyName: { anyOf: [{ type: "string" }, { type: "null" }] },
          companyDomain: { anyOf: [{ type: "string" }, { type: "null" }] },
          eventDate: { anyOf: [{ type: "string" }, { type: "null" }] },
          // `unknown` is absent on purpose. An event that did not happen is
          // not an event; the way to say "nothing here" is an empty array.
          kind: { type: "string", enum: ["fact", "inference"] },
          confidence: { type: "string", enum: [...CONFIDENCES] },
          excerpt: { type: "string" },
        },
      },
    },
  },
} as const;

/**
 * How much of a document is sent.
 *
 * 24,000 characters is roughly 6k tokens — comfortably the whole of any
 * article, and a hard stop on the homepage that came back as 300 kB of link
 * text. Truncating from the front keeps the part that carries the news; a
 * document whose event is only in the last quarter of a 24k-character page is
 * not a document, it is a listing, and the source should point at the feed.
 */
const MAX_CHARS = 24_000;

export const extractSignals: LLMTask<SignalDocument, ExtractedSignal[]> = {
  name: "extract_signals",
  prompt: PROMPT,
  schema: SCHEMA,
  // Eight events with an excerpt each. Haiku has no adaptive thinking, so this
  // is output budget only.
  maxTokens: 8_000,

  renderInput: (doc) => {
    const body = doc.text.length > MAX_CHARS ? `${doc.text.slice(0, MAX_CHARS)}\n…[truncated]` : doc.text;
    return [
      "List the business events reported in this document.",
      "",
      `Source URL: ${doc.url}`,
      `Published: ${doc.publishedAt ?? "not stated"}`,
      "",
      wrapUntrusted("document", [doc.title ? `# ${doc.title}` : "", body].filter(Boolean).join("\n\n")),
    ].join("\n");
  },

  // No fetching. The document is already here, and giving a web tool to the
  // highest-volume task in the system would multiply both the bill and the
  // set of hosts an injected page could walk us to.

  entity: () => ({ type: "source_document", id: null }),

  parse: (json, doc) => {
    if (!json || typeof json !== "object") {
      throw new Error("extract_signals: response was not an object.");
    }
    const raw = (json as { events?: unknown }).events;
    if (!Array.isArray(raw)) {
      throw new Error("extract_signals: response carried no events array.");
    }
    if (raw.length > MAX_SIGNALS) {
      throw new Error(`extract_signals: ${raw.length} events, more than the ${MAX_SIGNALS} asked for.`);
    }

    const haystack = normalizeForMatch(`${doc.title ?? ""} ${doc.text}`);
    const signals: ExtractedSignal[] = [];

    for (const item of raw as Record<string, unknown>[]) {
      const eventType = item.eventType;
      if (typeof eventType !== "string" || !isEventType(eventType)) {
        throw new Error(`extract_signals: ${JSON.stringify(eventType)} is not an event type.`);
      }

      const description = text(item.description);
      if (!description) {
        throw new Error("extract_signals: an event has no description.");
      }

      const excerpt = text(item.excerpt);
      if (!excerpt) {
        throw new Error(`extract_signals: "${description}" carries no excerpt.`);
      }

      /* The excerpt is checked against the document rather than trusted.
         This is the one place a hallucination in this task would be both
         invisible and damaging: an invented quotation renders in the evidence
         list looking exactly like a real one, and it is the thing a user
         checks *instead of* re-reading the page.

         Matched on normalised text — the extractor collapses whitespace and
         decodes entities, so a byte comparison would reject correct quotes.
         Truncated to 120 characters because a long excerpt spanning a block
         boundary legitimately differs in its interior whitespace. */
      const needle = normalizeForMatch(excerpt).slice(0, 120);
      if (needle.length >= 24 && !haystack.includes(needle)) {
        throw new Error(
          `extract_signals: the excerpt for "${description}" is not in the ` +
            `document. An invented quotation is indistinguishable from a real ` +
            `one once it reaches the evidence list.`,
        );
      }

      const kind = item.kind;
      if (kind !== "fact" && kind !== "inference") {
        throw new Error(`extract_signals: ${JSON.stringify(kind)} is not fact or inference.`);
      }

      const confidence = item.confidence;
      if (typeof confidence !== "string" || !CONFIDENCES.includes(confidence as Confidence)) {
        throw new Error(`extract_signals: ${JSON.stringify(confidence)} is not a confidence.`);
      }

      const companyName = text(item.companyName);
      const companyDomain = domain(item.companyDomain);

      /* An event about nobody cannot be attached to a company, and the whole
         point of source_events is that it can. Dropped rather than raised:
         "this article names no company" is the single most common honest
         outcome, and failing the run for it would make general news sources
         look broken. */
      if (!companyName && !companyDomain) continue;

      signals.push({
        eventType,
        description,
        companyName,
        companyDomain,
        eventDate: isoDate(item.eventDate),
        kind,
        confidence: confidence as Confidence,
        excerpt,
      });
    }

    return signals;
  },
};

function isEventType(value: string): value is EventType {
  return (EVENT_TYPES as readonly string[]).includes(value);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * A bare hostname, or null.
 *
 * Anything that is not obviously a domain becomes null rather than being
 * cleaned up into one. This value is an entity-resolution key: a domain
 * salvaged from a mangled string points at the wrong company for good.
 */
function domain(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const trimmed = raw
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    ?.split("?")[0]
    ?.trim();
  if (!trimmed) return null;
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(trimmed) ? trimmed : null;
}

function isoDate(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  // A future event date is a parse artefact or a hallucinated year; either way
  // it would make the freshness score say the trigger is maximally fresh.
  if (parsed.getTime() > Date.now() + 7 * 24 * 3600_000) return null;
  return parsed.toISOString();
}

function normalizeForMatch(value: string): string {
  return value
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}
