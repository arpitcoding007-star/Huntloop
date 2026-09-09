/**
 * The ICP, as a type both sides import.
 *
 * ── Why this file exists ─────────────────────────────────────────────────
 *
 * `ICP-01` is the most instructive defect in this repo's history. The seed
 * wrote `criteria` as `{industries, employee_count, signals}`. The only reader
 * looked for `{segments, sizes, regions, triggers}`. jsonb accepted both, the
 * reader degraded every missing key to an empty list exactly as designed, and
 * so the qualifier judged every company against a profile asserting *nothing*
 * — in a tone that reads as a finding.
 *
 * That was fixed by making the two agree. This file exists because agreeing
 * is not a property that survives a third reader, and Apollo query
 * translation is the third reader. `0013` adds the CHECK that stops an
 * unrecognised key; this is the part that gives every reader the same answer
 * for a key that *is* recognised.
 *
 * ── Why it is hand-written rather than zod ───────────────────────────────
 *
 * Same reason `rules.ts` is. `packages/db` has no runtime dependencies and
 * both the web app and the job runner import it; adding zod here would put a
 * validation library in the job runner's dependency tree to check the shape
 * of an object. The parsing below is thirty lines of `Array.isArray` and it
 * is exhaustively tested, which is what actually matters.
 *
 * ── The one rule that governs every decision here ────────────────────────
 *
 * **A missing field and an empty field are different facts.**
 *
 * `parse` returns `null` for "not stated" and `[]` for "stated as none". A
 * profile that says nothing about geography must not be read as a profile
 * that excludes every country, and — the failure `ICP-01` actually caused —
 * must not be *presented* as a profile with criteria when it has none.
 * `isEmpty` is what a caller asks before spending a model call on it.
 */

/* ── The shape ─────────────────────────────────────────────────────────── */

/**
 * A numeric employee range.
 *
 * Separate from `sizes` on purpose, and the reason is worth stating because
 * it looks like duplication. `sizes` is a list of human bands — "11–50",
 * "51–200" — which is what a person writes and what a screen shows. A
 * provider filter takes numbers. Deriving the numbers from the bands is
 * possible and is what `parse` does when no explicit range is given; storing
 * only the numbers would throw away the labels the customer chose, and
 * storing only the labels would make the translation lossy in the other
 * direction the day somebody writes "SMB".
 */
export interface EmployeeRange {
  min: number | null;
  max: number | null;
}

export interface IcpCriteria {
  /** v1. Free-text market descriptions. The most-used field in practice. */
  segments: string[] | null;
  /** v1. Human size bands. */
  sizes: string[] | null;
  /** v1. Human geography names. */
  regions: string[] | null;
  /** v1. Events that make a company interesting now. */
  triggers: string[] | null;

  industries: string[] | null;
  employeeRange: EmployeeRange | null;
  revenueBands: string[] | null;
  technologies: string[] | null;
  businessModels: string[] | null;
  painPoints: string[] | null;
  useCases: string[] | null;
  buyingSignals: string[] | null;
  keywords: string[] | null;
  exampleCompanies: string[] | null;
  notes: string | null;
}

export interface IcpExclusions {
  /** v1. The single free-text list the original screen wrote. */
  exclusions: string[] | null;

  industries: string[] | null;
  regions: string[] | null;
  sizes: string[] | null;
  technologies: string[] | null;
  businessModels: string[] | null;
  employeeRange: EmployeeRange | null;
  keywords: string[] | null;
  /** Domains never to surface. The only exclusion that is exact rather than fuzzy. */
  domains: string[] | null;
  signals: string[] | null;
  notes: string | null;
}

export interface Icp {
  criteria: IcpCriteria;
  exclusions: IcpExclusions;
}

/**
 * Every key the database will accept, mirroring `0013`'s CHECK constraints.
 *
 * Exported so a test can compare the two in both directions. A key permitted
 * here and rejected there is a write that fails at runtime; a key permitted
 * there and missing here is `ICP-01` again, exactly.
 */
export const CRITERIA_KEYS = [
  "segments",
  "sizes",
  "regions",
  "triggers",
  "industries",
  "employeeRange",
  "revenueBands",
  "technologies",
  "businessModels",
  "painPoints",
  "useCases",
  "buyingSignals",
  "keywords",
  "exampleCompanies",
  "notes",
] as const;

export const EXCLUSION_KEYS = [
  "exclusions",
  "industries",
  "regions",
  "sizes",
  "technologies",
  "businessModels",
  "employeeRange",
  "keywords",
  "domains",
  "signals",
  "notes",
] as const;

/* ── Reading ───────────────────────────────────────────────────────────── */

export class InvalidIcpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidIcpError";
  }
}

/**
 * A list of non-empty strings, or null.
 *
 * Null for absent, `[]` for present-and-empty. Callers that treat those the
 * same are free to; callers that need the distinction have it. Whitespace-only
 * entries are dropped rather than kept, because a trailing comma in a form
 * field is not a criterion.
 */
function stringList(value: unknown, field: string): string[] | null {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) {
    throw new InvalidIcpError(`${field} must be a list of text, not ${typeof value}.`);
  }
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      throw new InvalidIcpError(`${field} contains a ${typeof item}; every entry must be text.`);
    }
    const trimmed = item.trim();
    if (trimmed) out.push(trimmed);
  }
  return out;
}

function text(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new InvalidIcpError(`${field} must be text, not ${typeof value}.`);
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function range(value: unknown, field: string): EmployeeRange | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidIcpError(`${field} must be an object with min and max.`);
  }
  const raw = value as Record<string, unknown>;
  const num = (v: unknown, name: string): number | null => {
    if (v === undefined || v === null) return null;
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
      throw new InvalidIcpError(`${field}.${name} must be a non-negative number.`);
    }
    return Math.floor(v);
  };
  const min = num(raw.min, "min");
  const max = num(raw.max, "max");
  if (min !== null && max !== null && min > max) {
    throw new InvalidIcpError(`${field}.min (${min}) is greater than ${field}.max (${max}).`);
  }
  if (min === null && max === null) return null;
  return { min, max };
}

/**
 * Human size bands to a numeric range.
 *
 * Handles the shapes the product's own screens produce and the two or three a
 * person types by hand. Deliberately conservative: a band it does not
 * recognise contributes nothing rather than a guess, because a guessed range
 * becomes a provider filter and silently narrows the market.
 *
 * The en-dash matters. The seed writes "11–50" with U+2013 and a person types
 * "11-50" with a hyphen, and a parser that handles only one of those works
 * perfectly until the day somebody edits the field.
 */
const NAMED_BANDS: Record<string, EmployeeRange> = {
  solo: { min: 1, max: 1 },
  micro: { min: 1, max: 10 },
  smb: { min: 1, max: 200 },
  "small business": { min: 1, max: 50 },
  startup: { min: 1, max: 50 },
  "mid-market": { min: 201, max: 1000 },
  midmarket: { min: 201, max: 1000 },
  enterprise: { min: 1001, max: null },
};

export function bandsToRange(bands: readonly string[]): EmployeeRange | null {
  /* Several bands are a union, not an intersection: a profile listing "11–50"
     and "51–200" wants companies in either, which is 11..200. So the result
     is the widest span any band contributes.

     `openEnded` is tracked separately rather than as `max = null`, because
     "null so far" and "explicitly unbounded" are different states and folding
     them together is what made the first version of this wrong. "enterprise"
     plus "11–50" is 11..∞; a version that took Math.max of the two would
     return 11..50 and quietly filter out every company the profile most
     wanted. */
  let min: number | null = null;
  let max: number | null = null;
  let openEnded = false;
  let matched = false;

  /* `string | undefined` because `noUncheckedIndexedAccess` is on and a
     capture group is an index. Every call site below has already been proved
     to have matched, so the coalesce is unreachable — but writing it is
     cheaper than eight non-null assertions. */
  const num = (s: string | undefined) => Number((s ?? "").replace(/[,\s]/g, ""));
  const widen = (lo: number | null, hi: number | null, open: boolean) => {
    matched = true;
    if (lo !== null) min = min === null ? lo : Math.min(min, lo);
    if (open) openEnded = true;
    else if (hi !== null) max = max === null ? hi : Math.max(max, hi);
  };

  for (const raw of bands) {
    const band = raw.trim().toLowerCase();
    if (!band) continue;

    const named = NAMED_BANDS[band];
    if (named) {
      widen(named.min, named.max, named.max === null);
      continue;
    }

    // "500+", "1000 +"
    const open = /^(\d[\d,\s]*)\s*\+$/.exec(band);
    if (open) {
      widen(num(open[1]), null, true);
      continue;
    }

    // "11-50", "11–50", "11 to 50"
    const span = /^(\d[\d,\s]*)\s*(?:-|–|—|to)\s*(\d[\d,\s]*)$/.exec(band);
    if (span) {
      widen(num(span[1]), num(span[2]), false);
      continue;
    }

    // "under 100", "<100", "up to 100"
    const under = /^(?:under|below|<|up to)\s*(\d[\d,\s]*)$/.exec(band);
    if (under) {
      widen(1, num(under[1]), false);
      continue;
    }

    // "over 500", ">500"
    const over = /^(?:over|above|>|more than)\s*(\d[\d,\s]*)$/.exec(band);
    if (over) {
      widen(num(over[1]), null, true);
      continue;
    }

    // A bare number is a point, not a range: "50" means about fifty people.
    if (/^\d[\d,\s]*$/.test(band)) {
      const n = num(band);
      widen(n, n, false);
      continue;
    }

    /* Unrecognised. Contributes nothing — see the note above. A guessed
       range becomes a provider filter and silently narrows the market. */
  }

  if (!matched) return null;
  return { min, max: openEnded ? null : max };
}

/**
 * Parse a `criteria` blob.
 *
 * Throws on a shape that cannot be read, rather than degrading to empty. That
 * is the entire lesson of `ICP-01`: the old reader's graceful degradation is
 * what made a total failure invisible for four passes of review.
 */
export function parseCriteria(value: unknown): IcpCriteria {
  if (value === null || value === undefined) value = {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidIcpError("criteria must be an object.");
  }
  const raw = value as Record<string, unknown>;

  for (const key of Object.keys(raw)) {
    if (!(CRITERIA_KEYS as readonly string[]).includes(key)) {
      throw new InvalidIcpError(
        `criteria has an unrecognised key "${key}". Known keys: ${CRITERIA_KEYS.join(", ")}.`,
      );
    }
  }

  const sizes = stringList(raw.sizes, "criteria.sizes");
  const explicitRange = range(raw.employeeRange, "criteria.employeeRange");

  return {
    segments: stringList(raw.segments, "criteria.segments"),
    sizes,
    regions: stringList(raw.regions, "criteria.regions"),
    triggers: stringList(raw.triggers, "criteria.triggers"),
    industries: stringList(raw.industries, "criteria.industries"),
    /* Explicit wins; bands are the fallback. An admin who wants a range the
       bands cannot express sets it directly, and an existing profile becomes
       searchable without anybody editing it. */
    employeeRange: explicitRange ?? (sizes ? bandsToRange(sizes) : null),
    revenueBands: stringList(raw.revenueBands, "criteria.revenueBands"),
    technologies: stringList(raw.technologies, "criteria.technologies"),
    businessModels: stringList(raw.businessModels, "criteria.businessModels"),
    painPoints: stringList(raw.painPoints, "criteria.painPoints"),
    useCases: stringList(raw.useCases, "criteria.useCases"),
    buyingSignals: stringList(raw.buyingSignals, "criteria.buyingSignals"),
    keywords: stringList(raw.keywords, "criteria.keywords"),
    exampleCompanies: stringList(raw.exampleCompanies, "criteria.exampleCompanies"),
    notes: text(raw.notes, "criteria.notes"),
  };
}

export function parseExclusions(value: unknown): IcpExclusions {
  if (value === null || value === undefined) value = {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidIcpError("negative_criteria must be an object.");
  }
  const raw = value as Record<string, unknown>;

  for (const key of Object.keys(raw)) {
    if (!(EXCLUSION_KEYS as readonly string[]).includes(key)) {
      throw new InvalidIcpError(
        `negative_criteria has an unrecognised key "${key}". Known keys: ${EXCLUSION_KEYS.join(", ")}.`,
      );
    }
  }

  return {
    exclusions: stringList(raw.exclusions, "negative_criteria.exclusions"),
    industries: stringList(raw.industries, "negative_criteria.industries"),
    regions: stringList(raw.regions, "negative_criteria.regions"),
    sizes: stringList(raw.sizes, "negative_criteria.sizes"),
    technologies: stringList(raw.technologies, "negative_criteria.technologies"),
    businessModels: stringList(raw.businessModels, "negative_criteria.businessModels"),
    employeeRange: range(raw.employeeRange, "negative_criteria.employeeRange"),
    keywords: stringList(raw.keywords, "negative_criteria.keywords"),
    /* Domains are normalized on the way in, because they are compared exactly
       and "Acme.COM" never matching "acme.com" would be an exclusion that
       silently does nothing. */
    domains: stringList(raw.domains, "negative_criteria.domains")?.map((d) =>
      d.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, ""),
    ) ?? null,
    signals: stringList(raw.signals, "negative_criteria.signals"),
    notes: text(raw.notes, "negative_criteria.notes"),
  };
}

export function parseIcp(criteria: unknown, negative: unknown): Icp {
  return { criteria: parseCriteria(criteria), exclusions: parseExclusions(negative) };
}

/**
 * Back to a blob, omitting everything absent.
 *
 * Omitting rather than writing nulls keeps the stored object small and — more
 * importantly — keeps "never stated" and "explicitly cleared" distinguishable
 * on the way back in.
 */
export function serializeCriteria(criteria: IcpCriteria): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of CRITERIA_KEYS) {
    const value = criteria[key as keyof IcpCriteria];
    if (value === null || value === undefined) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    out[key] = value;
  }
  return out;
}

export function serializeExclusions(exclusions: IcpExclusions): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of EXCLUSION_KEYS) {
    const value = exclusions[key as keyof IcpExclusions];
    if (value === null || value === undefined) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    out[key] = value;
  }
  return out;
}

/* ── Quality ───────────────────────────────────────────────────────────── */

/**
 * How complete a profile is, 0–100, deterministically.
 *
 * ── Why this is not an AI call ───────────────────────────────────────────
 *
 * Because "ICP quality: 72" from a model is a number with no method behind
 * it, and §16 is the rule against exactly that. This one is a weighted count
 * of populated fields, so the screen can show the working and a customer can
 * see precisely what would raise it. That makes it *actionable*, which a
 * model's opinion would not be.
 *
 * ── The weights ─────────────────────────────────────────────────────────
 *
 * They are not arbitrary but they are also not measured, and the difference
 * matters. They encode one claim: the fields that make discovery and
 * qualification work are worth more than the fields that make a profile read
 * nicely. Segments, industries, size and geography are what a provider query
 * is built from — a profile without them cannot search. Triggers and buying
 * signals are what "why now" is built from. Exclusions are what stops the
 * result set being useless. Everything else is context for the writer.
 *
 * If a measured weighting ever exists it replaces this, versioned, the same
 * way §51 says a real scoring weight would.
 */
interface QualityFactor {
  key: string;
  label: string;
  weight: number;
  present: boolean;
  hint: string;
}

export interface IcpQuality {
  score: number;
  factors: QualityFactor[];
  /** The highest-weight missing factors, best-first. What the screen shows. */
  suggestions: string[];
}

export function scoreIcp(icp: Icp): IcpQuality {
  const c = icp.criteria;
  const x = icp.exclusions;
  const has = (v: string[] | null) => Array.isArray(v) && v.length > 0;

  const factors: QualityFactor[] = [
    {
      key: "segments",
      label: "Market segments",
      weight: 15,
      present: has(c.segments) || has(c.industries),
      hint: "Name the markets you sell into. Without one, discovery has nothing to search for.",
    },
    {
      key: "size",
      label: "Company size",
      weight: 15,
      present: has(c.sizes) || c.employeeRange !== null,
      hint: "Give a size band. It is the single most effective discovery filter.",
    },
    {
      key: "geography",
      label: "Geography",
      weight: 10,
      present: has(c.regions),
      hint: "Say where. An unbounded geography returns companies you cannot sell to.",
    },
    {
      key: "triggers",
      label: "Triggers",
      weight: 15,
      present: has(c.triggers) || has(c.buyingSignals),
      hint: "List what makes a company worth contacting this month. This is what 'why now' is built from.",
    },
    {
      key: "pain",
      label: "Pain points",
      weight: 10,
      present: has(c.painPoints) || has(c.useCases),
      hint: "Describe the problem you solve, so qualification can look for evidence of it.",
    },
    {
      key: "exclusions",
      label: "Exclusions",
      weight: 15,
      present: has(x.exclusions) || has(x.industries) || has(x.regions) || has(x.keywords) || has(x.domains),
      hint: "Say who is NOT a fit. An ICP with no exclusions surfaces everything that vaguely matches.",
    },
    {
      key: "technologies",
      label: "Technologies",
      weight: 8,
      present: has(c.technologies),
      hint: "Name the stack, if it matters. It is a precise filter when it applies.",
    },
    {
      key: "examples",
      label: "Example companies",
      weight: 7,
      present: has(c.exampleCompanies),
      hint: "Name a few companies that are obviously right. They are the check on everything else.",
    },
    {
      key: "models",
      label: "Business model",
      weight: 5,
      present: has(c.businessModels) || has(c.revenueBands),
      hint: "Add the business model or revenue band if it changes the fit.",
    },
  ];

  const total = factors.reduce((sum, f) => sum + f.weight, 0);
  const earned = factors.reduce((sum, f) => sum + (f.present ? f.weight : 0), 0);

  return {
    score: Math.round((earned / total) * 100),
    factors,
    suggestions: factors
      .filter((f) => !f.present)
      .sort((a, b) => b.weight - a.weight)
      .map((f) => f.hint),
  };
}

/**
 * Whether this profile says enough to act on.
 *
 * The guard in front of every model call and every paid search. A profile
 * with nothing in it produces a search for "all companies" and a
 * qualification against no criteria, and both cost money to learn nothing.
 */
export function isEmpty(icp: Icp): boolean {
  const c = icp.criteria;
  return (
    !c.segments?.length &&
    !c.industries?.length &&
    !c.sizes?.length &&
    c.employeeRange === null &&
    !c.regions?.length &&
    !c.technologies?.length &&
    !c.keywords?.length &&
    !c.triggers?.length
  );
}

/* ── Exclusions, applied ───────────────────────────────────────────────── */

export interface ExclusionSubject {
  name: string | null;
  domain: string | null;
  industry: string | null;
  country: string | null;
  region: string | null;
  employeeCount: number | null;
  businessModel: string | null;
  techStack: readonly string[] | null;
  description: string | null;
}

export interface ExclusionVerdict {
  excluded: boolean;
  /** Which rule fired, in the user's own words. Never a code. */
  reason: string | null;
}

/**
 * Does this company match a negative criterion?
 *
 * Deterministic, no I/O, and applied *before* anything is enriched or scored
 * — which is the point. Excluding after a model call means paying to reject.
 *
 * Case-insensitive substring matching for the text fields, exact for domains.
 * Substring is the right choice here despite being loose: a customer who
 * excludes "staffing" means to exclude "Staffing Solutions Ltd", and a
 * false exclusion is visible on the discovery screen (with this reason
 * attached) while a false inclusion is a wasted model call nobody sees.
 */
export function isExcluded(subject: ExclusionSubject, exclusions: IcpExclusions): ExclusionVerdict {
  const lower = (s: string | null | undefined) => (s ?? "").toLowerCase();

  if (exclusions.domains?.length && subject.domain) {
    const domain = lower(subject.domain);
    for (const excluded of exclusions.domains) {
      if (domain === excluded || domain.endsWith(`.${excluded}`)) {
        return { excluded: true, reason: `The domain ${excluded} is on your exclusion list.` };
      }
    }
  }

  const haystacks: Array<[string, string]> = [
    ["industry", lower(subject.industry)],
    ["business model", lower(subject.businessModel)],
    ["country", lower(subject.country)],
    ["region", lower(subject.region)],
    ["name", lower(subject.name)],
    ["description", lower(subject.description)],
  ];
  const tech = (subject.techStack ?? []).map(lower);

  const matchIn = (terms: string[] | null, fields: string[]): string | null => {
    if (!terms?.length) return null;
    for (const term of terms) {
      const needle = term.toLowerCase().trim();
      if (!needle) continue;
      for (const [label, hay] of haystacks) {
        if (!fields.includes(label) || !hay) continue;
        if (hay.includes(needle)) return term;
      }
    }
    return null;
  };

  const industry = matchIn(exclusions.industries, ["industry", "description", "name"]);
  if (industry) return { excluded: true, reason: `Excluded industry: ${industry}.` };

  const region = matchIn(exclusions.regions, ["country", "region"]);
  if (region) return { excluded: true, reason: `Excluded geography: ${region}.` };

  const model = matchIn(exclusions.businessModels, ["business model", "description"]);
  if (model) return { excluded: true, reason: `Excluded business model: ${model}.` };

  if (exclusions.technologies?.length && tech.length) {
    for (const term of exclusions.technologies) {
      const needle = term.toLowerCase().trim();
      if (needle && tech.some((t) => t.includes(needle))) {
        return { excluded: true, reason: `Uses an excluded technology: ${term}.` };
      }
    }
  }

  /* `keywords` and the v1 `exclusions` list are the catch-alls, checked
     against every text field. They are last because they are the loosest and
     a more specific reason is a better one to show. */
  const keyword = matchIn(
    [...(exclusions.keywords ?? []), ...(exclusions.exclusions ?? [])],
    ["industry", "business model", "country", "region", "name", "description"],
  );
  if (keyword) return { excluded: true, reason: `Matches your exclusion "${keyword}".` };

  if (exclusions.employeeRange && subject.employeeCount !== null) {
    const { min, max } = exclusions.employeeRange;
    const aboveMin = min === null || subject.employeeCount >= min;
    const belowMax = max === null || subject.employeeCount <= max;
    if (aboveMin && belowMax) {
      const band = `${min ?? 0}–${max ?? "∞"}`;
      return { excluded: true, reason: `Employee count ${subject.employeeCount} is in your excluded band ${band}.` };
    }
  }

  return { excluded: false, reason: null };
}
