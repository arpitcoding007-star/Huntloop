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

export type DimensionKey = "category" | "geography" | "budget" | "quantity" | "availability" | "trust";

export interface MatchResult {
  offeringId: string;
  score: number | null;
  dimensions: Record<DimensionKey, number | null>;
  explanation: string;
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
  };
  const measured = Object.values(dimensions).filter((v): v is number => v !== null);
  // `category` is a hard filter, always 100, so it never counts as evidence.
  const informative = measured.length - 1;
  const score = informative >= 2 ? Math.round(measured.reduce((a, b) => a + b, 0) / measured.length) : null;

  return {
    offeringId: offering.id,
    score,
    dimensions,
    explanation: reasons.length ? reasons.join(" · ") : "Same category; nothing else is known yet.",
  };
}

/** Ranks scored candidates: scored before unscored, then by score. */
export function rankMatches(results: MatchResult[]): MatchResult[] {
  return [...results]
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
    .slice(0, MAX_MATCHES_PER_NEED);
}
