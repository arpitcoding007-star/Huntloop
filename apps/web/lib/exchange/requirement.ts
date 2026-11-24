import type { IntakeAttribute, Requirement } from "@huntloop/ai";

/**
 * From a questionnaire's answers to an `exchange_needs` row (0060).
 *
 * The questionnaire stores every answer as text in `requirement`, tagged fact,
 * inference or unknown. A few of those answers are also the columns matching
 * reads — quantity, budget, currency, country, timeline — and this file is the
 * one place that turns one into the other. Pure, so the rules are tested.
 *
 * The rule throughout is the repo's: a value that cannot be read with
 * confidence is left null (UNKNOWN), never guessed. "About 200" is 200;
 * "a few hundred" is not a number, so quantity stays empty and the text stays
 * in the requirement for a person to read.
 */

/** Spec §5. What each level lets a supplier see. */
export const VISIBILITY = [
  {
    level: 0,
    label: "Private",
    detail: "Only your workspace sees it. It is not matched and no supplier is told it exists.",
  },
  {
    level: 1,
    label: "Counted",
    detail: "Matched, and counted in category demand totals. No supplier sees the request itself.",
  },
  {
    level: 2,
    label: "Anonymous card",
    detail: "Matched suppliers see an anonymous card: category, rough quantity and budget, region and timeline. Never your name, workspace or your own words.",
  },
  {
    level: 3,
    label: "Open to introductions",
    detail: "The anonymous card plus your own words, and matched suppliers may ask to be introduced. You approve every introduction.",
  },
] as const;

export type Visibility = (typeof VISIBILITY)[number]["level"];

export function isVisibility(v: unknown): v is Visibility {
  return v === 0 || v === 1 || v === 2 || v === 3;
}

export const NEED_STATUSES = ["open", "paused", "fulfilled", "withdrawn"] as const;
export type NeedStatus = (typeof NEED_STATUSES)[number];

export const TIMELINES = ["this_month", "this_quarter", "later", "exploring"] as const;
export type Timeline = (typeof TIMELINES)[number];

export const TIMELINE_LABEL: Record<Timeline, string> = {
  this_month: "This month",
  this_quarter: "This quarter",
  later: "Later",
  exploring: "Just exploring",
};

/** Common settlement currencies. Any ISO 4217 code is valid in the column; these are the picker. */
export const CURRENCIES = [
  "USD", "EUR", "GBP", "INR", "JPY", "CNY", "AUD", "CAD", "CHF", "SGD", "AED", "SAR", "HKD", "KRW", "BRL",
  "MXN", "ZAR", "SEK", "NOK", "DKK", "PLN", "TRY", "IDR", "THB", "MYR", "VND", "PHP", "NZD", "ILS", "NGN",
] as const;

/**
 * ISO 3166-1 alpha-2, for the country pickers, with fixed English names.
 * Not `Intl.DisplayNames`: Node and the browser ship different ICU data
 * ("Hong Kong" against "Hong Kong SAR China"), and a name that differs
 * between server and client render breaks hydration.
 */
export const COUNTRY_NAMES: Record<string, string> = {
  AE: "United Arab Emirates",
  AR: "Argentina",
  AT: "Austria",
  AU: "Australia",
  BD: "Bangladesh",
  BE: "Belgium",
  BG: "Bulgaria",
  BR: "Brazil",
  CA: "Canada",
  CH: "Switzerland",
  CL: "Chile",
  CN: "China",
  CO: "Colombia",
  CZ: "Czechia",
  DE: "Germany",
  DK: "Denmark",
  EG: "Egypt",
  ES: "Spain",
  FI: "Finland",
  FR: "France",
  GB: "United Kingdom",
  GR: "Greece",
  HK: "Hong Kong",
  HU: "Hungary",
  ID: "Indonesia",
  IE: "Ireland",
  IL: "Israel",
  IN: "India",
  IT: "Italy",
  JP: "Japan",
  KE: "Kenya",
  KR: "South Korea",
  LK: "Sri Lanka",
  MA: "Morocco",
  MX: "Mexico",
  MY: "Malaysia",
  NG: "Nigeria",
  NL: "Netherlands",
  NO: "Norway",
  NZ: "New Zealand",
  PE: "Peru",
  PH: "Philippines",
  PK: "Pakistan",
  PL: "Poland",
  PT: "Portugal",
  QA: "Qatar",
  RO: "Romania",
  RS: "Serbia",
  SA: "Saudi Arabia",
  SE: "Sweden",
  SG: "Singapore",
  TH: "Thailand",
  TR: "Türkiye",
  TW: "Taiwan",
  UA: "Ukraine",
  US: "United States",
  VN: "Vietnam",
  ZA: "South Africa",
};

export const COUNTRY_CODES = Object.keys(COUNTRY_NAMES);

const SYMBOLS: Record<string, string> = { $: "USD", "€": "EUR", "£": "GBP", "₹": "INR", "¥": "JPY" };

export function countryName(code: string): string {
  return COUNTRY_NAMES[code] ?? code;
}

/**
 * A plain number from an answer: "200", "200 units", "1,500", "about 200",
 * "2.5k", "3 million". Null for anything that is not one number — a range, a
 * vague amount, or two numbers.
 */
export function parseAmount(text: string | null | undefined): number | null {
  if (!text) return null;
  const s = text.toLowerCase().replace(/(\d),(?=\d{3}\b)/g, "$1");
  const nums = s.match(/\d+(?:\.\d+)?/g);
  if (!nums || nums.length !== 1) return null;
  const m = s.match(/(\d+(?:\.\d+)?)\s*(k|thousand|m|mn|million|b|bn|billion|lakh|crore)?\b/);
  if (!m) return null;
  const base = Number(m[1]);
  const mult: Record<string, number> = {
    k: 1e3, thousand: 1e3, m: 1e6, mn: 1e6, million: 1e6, b: 1e9, bn: 1e9, billion: 1e9, lakh: 1e5, crore: 1e7,
  };
  const value = base * (m[2] ? mult[m[2]]! : 1);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** A currency named in an answer: an ISO code or a symbol. Null when none or several. */
export function parseCurrency(text: string | null | undefined): string | null {
  if (!text) return null;
  const codes = new Set<string>();
  for (const m of text.toUpperCase().matchAll(/\b([A-Z]{3})\b/g)) {
    if ((CURRENCIES as readonly string[]).includes(m[1]!)) codes.add(m[1]!);
  }
  for (const [sym, code] of Object.entries(SYMBOLS)) if (text.includes(sym)) codes.add(code);
  return codes.size === 1 ? [...codes][0]! : null;
}

/** The timeline enum from an answer, when the wording is clear. */
export function parseTimeline(text: string | null | undefined): Timeline | null {
  if (!text) return null;
  const s = text.toLowerCase().trim();
  if ((TIMELINES as readonly string[]).includes(s)) return s as Timeline;
  if (/\b(asap|urgent|immediately|this week|next week|this month|within (a|one|two|2|1) weeks?|days?)\b/.test(s)) {
    return "this_month";
  }
  if (/\b(this quarter|next month|(1|2|3|one|two|three) months?|within (a|the) quarter|q[1-4])\b/.test(s)) {
    return "this_quarter";
  }
  if (/\b(exploring|just looking|researching|no rush|not sure)\b/.test(s)) return "exploring";
  if (/\b(later|next year|this year|(6|six|9|nine|12|twelve) months?)\b/.test(s)) return "later";
  return null;
}

function text(req: Requirement, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = req[k]?.value;
    if (v && v.trim()) return v.trim();
  }
  return null;
}

export interface NeedExtras {
  /** Chosen on the summary card; ISO 3166-1 alpha-2. */
  country: string | null;
  /** Chosen on the summary card; ISO 4217. */
  currency: string | null;
  /** Chosen on the summary card, in `currency`. */
  budgetMax: number | null;
  visibility: Visibility;
}

export interface NeedColumns {
  quantity: number | null;
  unit: string | null;
  budget_min: null;
  budget_max: number | null;
  currency: string | null;
  country: string | null;
  deliver_to: string | null;
  timeline: Timeline | null;
  visibility: Visibility;
}

/**
 * The columns matching reads. The summary card's explicit choices win over
 * anything read from the answers; a budget with no currency is dropped
 * (0060 refuses one, and a number with no currency is not a budget).
 */
export function needColumns(req: Requirement, extras: NeedExtras): NeedColumns {
  const budgetText = text(req, "budget");
  const currency = extras.currency ?? parseCurrency(budgetText);
  const budgetMax = extras.budgetMax ?? parseAmount(budgetText);
  return {
    quantity: parseAmount(text(req, "quantity", "seats")),
    unit: text(req, "unit")?.slice(0, 40) ?? null,
    budget_min: null,
    budget_max: currency && budgetMax !== null ? budgetMax : null,
    currency: currency && budgetMax !== null ? currency : null,
    country: extras.country && /^[A-Z]{2}$/.test(extras.country) ? extras.country : null,
    deliver_to: text(req, "deliver_to", "location")?.slice(0, 200) ?? null,
    timeline: parseTimeline(text(req, "timeline", "start")),
    visibility: extras.visibility,
  };
}

/**
 * The requirement as the person confirmed it on the summary card. A value
 * they submitted is their answer (a fact): confirming a suggestion is what
 * makes it one. An empty field is UNKNOWN. Keys outside the category's
 * attributes are dropped.
 */
export function confirmedRequirement(
  attributes: IntakeAttribute[],
  submitted: Record<string, string>,
): Requirement {
  const out: Requirement = {};
  for (const a of attributes) {
    const v = (submitted[a.key] ?? "").trim().slice(0, 300);
    out[a.key] = v
      ? { value: v, kind: "fact", source: "answer" }
      : { value: null, kind: "unknown", source: "skipped" };
  }
  return out;
}
