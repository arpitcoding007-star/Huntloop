import { REGION_OPTIONS, SIZE_BANDS } from "./onboarding/steps";

/**
 * A tighter customer profile, proposed from what the workspace has already
 * decided — the promise the "tighten my profile" nudge makes (M-12).
 *
 * Deterministic on purpose. The question is "what do the companies you took
 * on have in common that your profile does not say", and that is a count, not
 * an opinion: no model call, nothing to cite but the companies themselves, and
 * the same answer every time it is asked of the same rows.
 *
 * Two kinds of suggestion, each with the companies behind it:
 *
 *   · **add** — an industry, size band or region shared by a real share of
 *     the accepted companies and absent from the profile.
 *   · **exclude** — an industry that keeps being declined and was never
 *     accepted, proposed for "Not a fit".
 *
 * Each says what it would have changed: how many declined companies an
 * exclusion would have kept off the list, and how many accepted companies an
 * addition describes.
 */

export interface ProposalCompany {
  id: string;
  name: string;
  industry: string | null;
  employeeCount: number | null;
  region: string | null;
  outcome: "accepted" | "declined";
}

export interface ProfileForProposal {
  industries: string[];
  segments: string[];
  sizes: string[];
  regions: string[];
  exclusions: string[];
}

export type ProposalField = "industries" | "sizes" | "regions" | "exclusions";

export interface ProposalItem {
  field: ProposalField;
  value: string;
  /** Accepted companies with this value. */
  accepted: number;
  /** Declined companies with this value. */
  declined: number;
  /** Up to five company names, so the suggestion can be checked. */
  examples: string[];
}

export interface IcpProposal {
  basis: { accepted: number; declined: number };
  items: ProposalItem[];
}

/** Below this many accepted companies a "pattern" is noise. */
export const MIN_ACCEPTED = 10;
/** An addition must describe at least this share of accepted companies… */
const ADD_SHARE = 0.3;
/** …and at least this many of them. */
const ADD_MIN = 3;
/** Declines of one industry, never accepted, before suggesting it is not a fit. */
const EXCLUDE_MIN = 3;

const norm = (v: string) => v.trim().toLowerCase();

/** The onboarding size band an employee count falls in, or null. */
export function sizeBand(count: number | null): string | null {
  if (count === null || !Number.isFinite(count) || count < 1) return null;
  if (count <= 10) return SIZE_BANDS[0];
  if (count <= 50) return SIZE_BANDS[1];
  if (count <= 200) return SIZE_BANDS[2];
  if (count <= 1000) return SIZE_BANDS[3];
  if (count <= 5000) return SIZE_BANDS[4];
  return SIZE_BANDS[5];
}

/** A company's region, only when it is one of the regions a search can act on. */
function regionOf(region: string | null): string | null {
  if (!region) return null;
  return REGION_OPTIONS.find((r) => norm(r) === norm(region)) ?? null;
}

export function proposeTighterProfile(
  companies: ProposalCompany[],
  profile: ProfileForProposal,
): IcpProposal | null {
  const accepted = companies.filter((c) => c.outcome === "accepted");
  const declined = companies.filter((c) => c.outcome === "declined");
  if (accepted.length < MIN_ACCEPTED) return null;

  const has = (list: string[], v: string) => list.some((x) => norm(x) === norm(v));
  // An industry already named as a segment is already said, in other words.
  const statedIndustries = [...profile.industries, ...profile.segments];

  const items: ProposalItem[] = [];

  const tally = (
    field: Exclude<ProposalField, "exclusions">,
    valueOf: (c: ProposalCompany) => string | null,
    stated: string[],
  ) => {
    const groups = new Map<string, { label: string; acc: ProposalCompany[]; dec: number }>();
    for (const c of companies) {
      const v = valueOf(c);
      if (!v) continue;
      const key = norm(v);
      const g = groups.get(key) ?? { label: v, acc: [], dec: 0 };
      if (c.outcome === "accepted") g.acc.push(c);
      else g.dec += 1;
      groups.set(key, g);
    }
    for (const g of groups.values()) {
      if (has(stated, g.label)) continue;
      if (g.acc.length < Math.max(ADD_MIN, Math.ceil(accepted.length * ADD_SHARE))) continue;
      items.push({
        field,
        value: g.label,
        accepted: g.acc.length,
        declined: g.dec,
        examples: g.acc.slice(0, 5).map((c) => c.name),
      });
    }
  };

  tally("industries", (c) => c.industry?.trim() || null, statedIndustries);
  tally("sizes", (c) => sizeBand(c.employeeCount), profile.sizes);
  tally("regions", (c) => regionOf(c.region), profile.regions);

  // Industries that keep being declined and were never accepted.
  const declinedByIndustry = new Map<string, { label: string; dec: ProposalCompany[] }>();
  for (const c of declined) {
    const v = c.industry?.trim();
    if (!v) continue;
    const g = declinedByIndustry.get(norm(v)) ?? { label: v, dec: [] };
    g.dec.push(c);
    declinedByIndustry.set(norm(v), g);
  }
  for (const [key, g] of declinedByIndustry) {
    if (g.dec.length < EXCLUDE_MIN) continue;
    if (accepted.some((c) => c.industry && norm(c.industry) === key)) continue;
    if (has(profile.exclusions, g.label)) continue;
    items.push({
      field: "exclusions",
      value: g.label,
      accepted: 0,
      declined: g.dec.length,
      examples: g.dec.slice(0, 5).map((c) => c.name),
    });
  }

  items.sort((a, b) => b.accepted + b.declined - (a.accepted + a.declined));
  return { basis: { accepted: accepted.length, declined: declined.length }, items };
}
