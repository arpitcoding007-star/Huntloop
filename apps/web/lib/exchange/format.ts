import { countryName, TIMELINE_LABEL, VISIBILITY, type Timeline } from "./requirement";

/** "EUR 6,000,000", or null when there is no currency to say it in. */
export function formatMoney(amount: number | null, currency: string | null): string | null {
  if (amount === null || !currency) return null;
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString("en")}`;
  }
}

export function formatPriceRange(from: number | null, to: number | null, currency: string | null): string | null {
  const a = formatMoney(from, currency);
  const b = formatMoney(to, currency);
  if (a && b && from !== to) return `${a} – ${b}`;
  return a ?? b;
}

export function visibilityLabel(level: number): string {
  return VISIBILITY.find((v) => v.level === level)?.label ?? "Counted";
}

export function timelineLabel(t: Timeline | null): string | null {
  return t ? TIMELINE_LABEL[t] : null;
}

export function placeLabel(country: string | null): string | null {
  return country ? countryName(country) : null;
}

export const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  open: "Open",
  paused: "Paused",
  fulfilled: "Fulfilled",
  expired: "Expired",
  withdrawn: "Withdrawn",
};

export const AVAILABILITY_LABEL: Record<string, string> = {
  in_stock: "In stock",
  made_to_order: "Made to order",
  available: "Available",
  limited: "Limited",
  unavailable: "Unavailable",
};
