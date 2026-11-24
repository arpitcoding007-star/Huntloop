/**
 * Exchange matching, deterministic half (build plan DN-50; spec §9).
 *
 * Hard filters decide who is a candidate at all; named dimensions say how
 * well each candidate fits. Pure, so every rule here is tested without a
 * database or a model.
 *
 * The repo's scoring rules apply unchanged:
 *   · A dimension nothing measured is null (UNKNOWN), never zero.
 *   · The score is the plain mean of the dimensions that *were* measured,
 *     shown with them. No invented weights. With fewer than two measured, the
 *     score itself is null: one number is not a ranking.
 *   · Stated availability expires: older than 30 days, it is UNKNOWN again.
 *
 * Money is compared only within one currency. There is no exchange-rate table
 * yet, so a EUR budget against a USD price is UNKNOWN, not guessed.
 *
 * `requirement` (DN-44) is the one dimension the model informs: the share of
 * the buyer's must-haves backed by the supplier's published evidence, counted
 * here from the model's citations (`applyExplanations`). Until a model has
 * judged it, it is UNKNOWN.
 */

export interface MatchNeed {
  id: string;
  org_id: string;
  category_id: string | null;
  quantity: number | null;
  budget_min: number | null;
  budget_max: number | null;
  currency: string | null;
  country: string | null;
}

export interface MatchOffering {
  id: string;
  org_id: string | null;
  category_id: string | null;
  price_from: number | null;
  price_to: number | null;
  currency: string | null;
  moq: number | null;
  availability: string | null;
  availability_as_of: string | null;
  serves_global: boolean;
  serves_countries: string[];
  provider: { claimed_at: string | null; verified_at: string | null } | null;
}

export type DimensionKey = "category" | "geography" | "budget" | "quantity" | "availability" | "trust" | "requirement";

export interface MatchResult {
  offeringId: string;
  score: number | null;
  dimensions: Record<DimensionKey, number | null>;
  explanation: string;
  /** Evidence ids the explanation rests on (closed set, from `explain_match`). */
  cited: string[];
}

export const AVAILABILITY_STALE_DAYS = 30;
export const MAX_MATCHES_PER_NEED = 50;

/** Who may be a candidate at all. */
export function eligible(need: MatchNeed, offering: MatchOffering): boolean {
  if (!need.category_id || offering.category_id !== need.category_id) return false;
  // Never matched to yourself (0060 enforces it too).
  if (offering.org_id && offering.org_id === need.org_id) return false;
  if (need.country && !offering.serves_global && offering.serves_countries.length > 0) {
    if (!offering.serves_countries.includes(need.country)) return false;
  }
  return true;
}

const DAY_MS = 86_400_000;

/**
 * The plain mean of the measured dimensions. `category` is a hard filter,
 * always 100, so it never counts as evidence of fit on its own.
 */
export function scoreOf(dimensions: Record<DimensionKey, number | null>): number | null {
  const measured = Object.values(dimensions).filter((v): v is number => v !== null);
  const informative = measured.length - 1;
  return informative >= 2 ? Math.round(measured.reduce((a, b) => a + b, 0) / measured.length) : null;
}

export function scoreMatch(need: MatchNeed, offering: MatchOffering, now: Date): MatchResult {
  const reasons: string[] = [];

  // Geography: listed explicitly beats "serves everywhere"; silence is unknown.
  let geography: number | null = null;
  if (need.country) {
    if (offering.serves_countries.includes(need.country)) {
      geography = 100;
      reasons.push(`serves ${need.country}`);
    } else if (offering.serves_global) {
      geography = 70;
      reasons.push("serves worldwide");
    } else if (offering.serves_countries.length === 0) {
      geography = null;
    }
  }

  // Budget: only within one currency.
  let budget: number | null = null;
  const hasBudget = need.budget_min !== null || need.budget_max !== null;
  const hasPrice = offering.price_from !== null || offering.price_to !== null;
  if (hasBudget && hasPrice && need.currency && need.currency === offering.currency) {
    const lo = offering.price_from ?? offering.price_to!;
    const hi = offering.price_to ?? offering.price_from!;
    const bMin = need.budget_min ?? 0;
    const bMax = need.budget_max ?? Number.POSITIVE_INFINITY;
    budget = lo <= bMax && hi >= bMin ? 100 : 30;
    reasons.push(budget === 100 ? "price fits the budget" : "price is outside the budget");
  }

  // Quantity against minimum order.
  let quantity: number | null = null;
  if (need.quantity !== null && offering.moq !== null) {
    quantity = need.quantity >= offering.moq ? 100 : 40;
    reasons.push(quantity === 100 ? "meets the minimum order" : `below the minimum order of ${offering.moq}`);
  }

  // Availability, only while fresh.
  let availability: number | null = null;
  const asOf = offering.availability_as_of ? new Date(offering.availability_as_of).getTime() : NaN;
  const fresh = Number.isFinite(asOf) && now.getTime() - asOf <= AVAILABILITY_STALE_DAYS * DAY_MS;
  if (offering.availability && fresh) {
    availability =
      ({ in_stock: 100, available: 100, made_to_order: 70, limited: 50, unavailable: 0 } as Record<string, number>)[
        offering.availability
      ] ?? null;
    if (availability !== null) reasons.push(`stated ${offering.availability.replace(/_/g, " ")}`);
  }

  // Trust: verified by the platform, claimed by the company, or a public listing.
  const trust = offering.provider?.verified_at ? 100 : offering.provider?.claimed_at ? 60 : 30;
  reasons.push(offering.provider?.verified_at ? "verified supplier" : offering.provider?.claimed_at ? "claimed profile" : "unclaimed listing");

  const dimensions: Record<DimensionKey, number | null> = {
    category: 100,
    geography,
    budget,
    quantity,
    availability,
    trust,
    requirement: null,
  };

  return {
    offeringId: offering.id,
    score: scoreOf(dimensions),
    dimensions,
    explanation: reasons.length ? reasons.join(" · ") : "Same category; nothing else is known yet.",
    cited: [],
  };
}

/** Ranks scored candidates: scored before unscored, then by score. */
export function rankMatches(results: MatchResult[]): MatchResult[] {
  return [...results]
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
    .slice(0, MAX_MATCHES_PER_NEED);
}

/**
 * What `exchange_matches.explained` holds (0066): the model's answer for one
 * candidate and a key of everything it read. `candidate` is null when the
 * model returned nothing for it, which is also an answer.
 */
export interface StoredExplanation {
  key: string;
  candidate: Explained | null;
}

/**
 * The stored answers for exactly these candidates, or null when any of them
 * was judged against something else — then all of them are judged again,
 * because the model saw them together.
 */
export function reusableExplanations(
  key: string,
  offeringIds: string[],
  stored: Map<string, StoredExplanation | null>,
): Explained[] | null {
  const out: Explained[] = [];
  for (const id of offeringIds) {
    const s = stored.get(id);
    if (!s || s.key !== key) return null;
    if (s.candidate) out.push(s.candidate);
  }
  return out;
}

/** The model's judgement for one candidate (shape of `ExplainedCandidate`). */
export interface Explained {
  offeringId: string;
  reason: string;
  backing: { mustHave: string; evidenceId: string | null }[];
}

/**
 * Folds `explain_match` into the deterministic results: the requirement
 * dimension from the citations (UNKNOWN when there were no must-haves or the
 * supplier published no evidence), the reason in front of the measured
 * reasons, the cited ids, and the score recomputed with the new dimension.
 * Candidates the model did not return are left exactly as they were.
 */
export function applyExplanations(
  results: MatchResult[],
  explained: Explained[],
  mustHaves: number,
  evidenceCount: Map<string, number>,
): MatchResult[] {
  const byId = new Map(explained.map((e) => [e.offeringId, e]));
  return results.map((r) => {
    const e = byId.get(r.offeringId);
    if (!e) return r;
    const evidence = evidenceCount.get(r.offeringId) ?? 0;
    const backed = e.backing.filter((b) => b.evidenceId !== null);
    const requirement = mustHaves === 0 || evidence === 0 ? null : Math.round((backed.length / mustHaves) * 100);
    const dimensions = { ...r.dimensions, requirement };
    const measured = r.explanation;
    const requirementNote =
      requirement === null ? null : `${backed.length} of ${mustHaves} must-haves backed by published evidence`;
    return {
      ...r,
      dimensions,
      score: scoreOf(dimensions),
      explanation: [e.reason || null, requirementNote, measured].filter(Boolean).join(" · "),
      cited: [...new Set(backed.map((b) => b.evidenceId!))],
    };
  });
}

/** Must-haves as the buyer wrote them: one per line, comma or semicolon. */
export function splitMustHaves(text: string | null | undefined): string[] {
  if (!text) return [];
  return [...new Set(text.split(/[\n,;]+/).map((s) => s.trim()).filter((s) => s.length > 1))].slice(0, 8);
}
