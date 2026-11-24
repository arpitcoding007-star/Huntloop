import { countryName } from "./requirement";

/**
 * What a matched supplier sees of a request — the TypeScript mirror of the
 * banding in 0062 (`exchange_magnitude_band`, `exchange_budget_band`,
 * `exchange_region`), used only for the preview on the summary card. The
 * database is the authority: suppliers read cards through
 * `exchange_matched_cards`, never through this file. The tests on both sides
 * pin the same examples, so the preview cannot quietly promise less than the
 * database shows.
 */

const REGIONS: Record<string, string[]> = {
  Europe: ["AT", "BE", "BG", "CH", "CZ", "DE", "DK", "ES", "FI", "FR", "GB", "GR", "HU", "IE", "IT", "NL", "NO", "PL", "PT", "RO", "RS", "SE", "UA"],
  "North America": ["US", "CA"],
  "Latin America": ["AR", "BR", "CL", "CO", "MX", "PE"],
  "Middle East & Africa": ["AE", "EG", "IL", "KE", "MA", "NG", "QA", "SA", "TR", "ZA"],
  "South Asia": ["BD", "IN", "LK", "PK"],
  "East Asia": ["CN", "HK", "JP", "KR", "TW"],
  "Southeast Asia": ["ID", "MY", "PH", "SG", "TH", "VN"],
  Oceania: ["AU", "NZ"],
};

export function region(country: string | null): string | null {
  if (!country) return null;
  for (const [name, codes] of Object.entries(REGIONS)) if (codes.includes(country)) return name;
  return "Elsewhere";
}

function compact(n: number): string {
  if (n >= 1e9) return `${Math.round(n / 1e9)}B`;
  if (n >= 1e6) return `${Math.round(n / 1e6)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}K`;
  return String(Math.round(n));
}

/** An order of magnitude: 200 → "100–1K". */
export function magnitudeBand(n: number | null): string | null {
  if (n === null || !(n > 0)) return null;
  if (n < 10) return "1–10";
  const lo = 10 ** Math.floor(Math.log10(n));
  return `${compact(lo)}–${compact(lo * 10)}`;
}

export function budgetBand(amount: number | null, currency: string | null): string | null {
  if (amount === null || !currency) return null;
  const band = magnitudeBand(amount);
  return band ? `${currency} ${band}` : null;
}

export interface CardPreview {
  visible: boolean;
  rows: { label: string; value: string }[];
  note: string;
}

/**
 * The card at a level. Place is shown as the database would show it with too
 * few requests to hide among: the region, or "Worldwide" — the preview never
 * promises the exact country, because that depends on how many others share it.
 */
export function previewCard(
  level: number,
  fields: {
    categoryPath: string | null;
    quantity: number | null;
    budgetMax: number | null;
    currency: string | null;
    country: string | null;
    timeline: string | null;
    summary: string;
    mustHaves: string | null;
  },
): CardPreview {
  if (level < 2) {
    return {
      visible: false,
      rows: [],
      note:
        level === 0
          ? "No supplier sees anything. The request is not matched."
          : "No supplier sees this request. It is matched, and counted only in totals of ten or more.",
    };
  }
  const rows: { label: string; value: string }[] = [
    { label: "Category", value: fields.categoryPath ?? "Uncategorised" },
    { label: "Quantity", value: magnitudeBand(fields.quantity) ?? "Unknown" },
    { label: "Budget", value: budgetBand(fields.budgetMax, fields.currency) ?? "Unknown" },
    {
      label: "Where",
      value: fields.country
        ? `${countryName(fields.country)} if 10 or more requests share it; otherwise ${region(fields.country)} or Worldwide`
        : "Unknown",
    },
    { label: "Timeline", value: fields.timeline ?? "Unknown" },
  ];
  if (level >= 3) {
    rows.push({ label: "Your words", value: fields.summary || "—" });
    if (fields.mustHaves) rows.push({ label: "Must-haves", value: fields.mustHaves });
  }
  return {
    visible: true,
    rows,
    note:
      level >= 3
        ? "Matched suppliers see this card, including your own words — check them for names or phone numbers. Never your name or workspace until you accept an introduction."
        : "Matched suppliers see only these bands. Never your name, workspace, exact amounts or your own words.",
  };
}
