/**
 * `read_supply_page` — what a supplier's own web page says they offer
 * (build plan DN-46), and what it proves (DN-45).
 *
 * The caller fetches the page; the model sees only its text. Every value comes
 * with the words it was read from, and `parse` drops any whose quote is not in
 * the page, or whose number is not in its quote. So the model can leave things
 * out, but cannot put things in. What survives is a suggestion a person saves
 * or does not; nothing is listed by this task.
 */
import type { IntakeAttribute } from "../intake.ts";
import { definePrompt } from "../prompt.ts";
import type { LLMTask } from "../task.ts";
import { UNTRUSTED_CONTENT_RULE, wrapUntrusted } from "../untrusted.ts";

export const MAX_SUPPLY_PAGE_CHARS = 24_000;
export const MAX_SUPPLY_EVIDENCE = 8;

export interface ReadSupplyPageInput {
  url: string;
  text: string;
  /** Closed list the category must come from. */
  categories: { id: string; path: string }[];
  attributes: IntakeAttribute[];
}

interface Quoted<T> {
  value: T;
  quote: string;
}

export interface ReadSupplyPageOutput {
  title: Quoted<string> | null;
  description: Quoted<string> | null;
  categoryId: string | null;
  moq: Quoted<number> | null;
  priceFrom: Quoted<number> | null;
  currency: string | null;
  evidence: { claim: string; quote: string; partner: boolean }[];
}

const PROMPT = definePrompt(
  "read_supply_page",
  `
You read one page of a supplier's website and report what it offers, for the
supplier to check before anything is listed.

Every value you give carries "quote": the exact words on the page it comes
from, copied character for character, at most 200 characters. A value without
such words must be null. Do not round, convert or combine numbers: give the
number as it is written in the quote.

- title: the product or service, in the page's words.
- description: one or two plain sentences; quote the sentence it rests on.
- categoryId: the id that fits best from the list, or null.
- moq: the minimum order quantity. priceFrom and currency: the lowest stated
  price and its ISO code.
- evidence: up to eight short claims a buyer would check: certifications,
  warranties, stock, regions served, capabilities. "partner": true only when
  the page says this business is an authorised or certified partner, reseller
  or distributor of a named brand.

Leave out what the page does not say. An empty answer is a good answer.

${UNTRUSTED_CONTENT_RULE}
`,
);

const normal = (s: string) => s.toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/\s+/g, " ").trim();

/** The number is written in the quote, as "1,000", "1.000" or "1000". */
export function numberInQuote(n: number, quote: string): boolean {
  if (!Number.isFinite(n) || n <= 0) return false;
  return (quote.match(/\d[\d.,\u00a0 ]*/g) ?? []).some((raw) => {
    const t = raw.replace(/[\u00a0 ]/g, "").replace(/[.,]+$/, "");
    /* Groups of three are thousands; otherwise the last separator is the point. */
    if (/^[0-9]{1,3}([.,][0-9]{3})+$/.test(t)) return Number(t.replace(/[.,]/g, "")) === n;
    const at = Math.max(t.lastIndexOf("."), t.lastIndexOf(","));
    return Number(at < 0 ? t : t.slice(0, at).replace(/[.,]/g, "") + "." + t.slice(at + 1)) === n;
  });
}

const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: "null" }] });
const quoted = (type: "string" | "number") =>
  nullable({ type: "object", additionalProperties: false, required: ["value", "quote"], properties: { value: { type }, quote: { type: "string" } } });

export const readSupplyPage: LLMTask<ReadSupplyPageInput, ReadSupplyPageOutput> = {
  name: "read_supply_page",
  prompt: PROMPT,
  maxTokens: 4_000,

  schema: (input) => ({
    type: "object",
    additionalProperties: false,
    required: ["title", "description", "categoryId", "moq", "priceFrom", "currency", "evidence"],
    properties: {
      title: quoted("string"),
      description: quoted("string"),
      categoryId: nullable({ type: "string", enum: input.categories.length ? input.categories.map((c) => c.id) : ["none"] }),
      moq: quoted("number"),
      priceFrom: quoted("number"),
      currency: nullable({ type: "string" }),
      evidence: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["claim", "quote", "partner"],
          properties: { claim: { type: "string" }, quote: { type: "string" }, partner: { type: "boolean" } },
        },
      },
    },
  }),

  renderInput: (input) =>
    [
      `Page: ${input.url}`,
      "",
      "Categories:",
      ...input.categories.map((c) => `- ${c.id} — ${c.path}`),
      "",
      input.attributes.length ? `Buyers in this category ask about: ${input.attributes.map((a) => a.label).join(", ")}` : "",
      "",
      wrapUntrusted("the page", input.text.slice(0, MAX_SUPPLY_PAGE_CHARS)),
    ].join("\n"),

  entity: () => ({ type: "exchange_offering", id: null }),

  parse: (json, input) => {
    if (!json || typeof json !== "object") throw new Error("read_supply_page: response was not an object.");
    const raw = json as Record<string, unknown>;
    const page = normal(input.text.slice(0, MAX_SUPPLY_PAGE_CHARS));
    const onPage = (q: unknown): q is string => typeof q === "string" && normal(q).length >= 3 && q.length <= 300 && page.includes(normal(q));
    const pair = (v: unknown) => (v && typeof v === "object" ? (v as { value?: unknown; quote?: unknown }) : null);
    const text = (v: unknown, max: number): Quoted<string> | null => {
      const p = pair(v);
      const value = typeof p?.value === "string" ? p.value.trim().replace(/\s+/g, " ") : "";
      return p && value && onPage(p.quote) ? { value: value.slice(0, max), quote: p.quote.trim() } : null;
    };
    const num = (v: unknown): Quoted<number> | null => {
      const p = pair(v);
      return p && typeof p.value === "number" && onPage(p.quote) && numberInQuote(p.value, p.quote) ? { value: p.value, quote: p.quote.trim() } : null;
    };

    const priceFrom = num(raw.priceFrom);
    const currency = typeof raw.currency === "string" && /^[A-Z]{3}$/.test(raw.currency) ? raw.currency : null;
    const seen = new Set<string>();
    const evidence: ReadSupplyPageOutput["evidence"] = [];
    for (const item of Array.isArray(raw.evidence) ? raw.evidence : []) {
      const e = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const claim = typeof e.claim === "string" ? e.claim.trim().replace(/\s+/g, " ").slice(0, 300) : "";
      if (claim.length < 3 || !onPage(e.quote) || seen.has(normal(claim))) continue;
      seen.add(normal(claim));
      /* A partner claim needs the page to say so in words, not in tone. */
      const partner = e.partner === true && /partner|reseller|distributor|dealer|authori[sz]ed|certified/i.test(e.quote);
      evidence.push({ claim, quote: e.quote.trim(), partner });
      if (evidence.length === MAX_SUPPLY_EVIDENCE) break;
    }
    return {
      title: text(raw.title, 200),
      description: text(raw.description, 1_000),
      categoryId: input.categories.some((c) => c.id === raw.categoryId) ? String(raw.categoryId) : null,
      moq: num(raw.moq),
      /* An amount without a currency is not a price. */
      priceFrom: priceFrom && currency ? priceFrom : null,
      currency: priceFrom ? currency : null,
      evidence,
    };
  },
};
