/**
 * The recipient's working day (P1-5).
 *
 * A cold email that lands at 3am sits under a night's worth of newer mail by
 * the time anyone reads it. Sequence sends wait for the recipient's business
 * hours — Monday to Friday, 08:00 to 18:00 — in a zone taken from the
 * company's country. One zone per country is an approximation (the US has
 * six); it is the right side of approximate, since the window is ten hours
 * wide. An unknown country does not hold anything.
 */

export const WINDOW_START_HOUR = 8;
export const WINDOW_END_HOUR = 18;

/* ISO 3166 alpha-2 and the common English names, to one representative zone. */
const ZONES: Record<string, string> = {
  us: "America/New_York", usa: "America/New_York", "united states": "America/New_York", "united states of america": "America/New_York",
  ca: "America/Toronto", canada: "America/Toronto",
  mx: "America/Mexico_City", mexico: "America/Mexico_City",
  br: "America/Sao_Paulo", brazil: "America/Sao_Paulo",
  ar: "America/Argentina/Buenos_Aires", argentina: "America/Argentina/Buenos_Aires",
  gb: "Europe/London", uk: "Europe/London", "united kingdom": "Europe/London", england: "Europe/London", scotland: "Europe/London",
  ie: "Europe/Dublin", ireland: "Europe/Dublin",
  fr: "Europe/Paris", france: "Europe/Paris",
  de: "Europe/Berlin", germany: "Europe/Berlin",
  nl: "Europe/Amsterdam", netherlands: "Europe/Amsterdam",
  be: "Europe/Brussels", belgium: "Europe/Brussels",
  es: "Europe/Madrid", spain: "Europe/Madrid",
  pt: "Europe/Lisbon", portugal: "Europe/Lisbon",
  it: "Europe/Rome", italy: "Europe/Rome",
  ch: "Europe/Zurich", switzerland: "Europe/Zurich",
  at: "Europe/Vienna", austria: "Europe/Vienna",
  se: "Europe/Stockholm", sweden: "Europe/Stockholm",
  no: "Europe/Oslo", norway: "Europe/Oslo",
  dk: "Europe/Copenhagen", denmark: "Europe/Copenhagen",
  fi: "Europe/Helsinki", finland: "Europe/Helsinki",
  pl: "Europe/Warsaw", poland: "Europe/Warsaw",
  il: "Asia/Jerusalem", israel: "Asia/Jerusalem",
  ae: "Asia/Dubai", uae: "Asia/Dubai", "united arab emirates": "Asia/Dubai",
  in: "Asia/Kolkata", india: "Asia/Kolkata",
  sg: "Asia/Singapore", singapore: "Asia/Singapore",
  jp: "Asia/Tokyo", japan: "Asia/Tokyo",
  kr: "Asia/Seoul", "south korea": "Asia/Seoul",
  cn: "Asia/Shanghai", china: "Asia/Shanghai",
  hk: "Asia/Hong_Kong", "hong kong": "Asia/Hong_Kong",
  au: "Australia/Sydney", australia: "Australia/Sydney",
  nz: "Pacific/Auckland", "new zealand": "Pacific/Auckland",
  za: "Africa/Johannesburg", "south africa": "Africa/Johannesburg",
  ng: "Africa/Lagos", nigeria: "Africa/Lagos",
  ke: "Africa/Nairobi", kenya: "Africa/Nairobi",
};

export function zoneForCountry(country: string | null | undefined): string | null {
  if (!country) return null;
  return ZONES[country.trim().toLowerCase().replace(/\./g, "")] ?? null;
}

function localParts(at: Date, zone: string): { weekday: number; hour: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    weekday: "short",
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(at);
  const day = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  return { weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(day), hour };
}

export function inBusinessHours(at: Date, zone: string): boolean {
  const { weekday, hour } = localParts(at, zone);
  return weekday >= 1 && weekday <= 5 && hour >= WINDOW_START_HOUR && hour < WINDOW_END_HOUR;
}

/** The first moment at or after `from` inside the window, to the quarter hour. */
export function nextBusinessWindow(from: Date, zone: string): Date {
  const step = 15 * 60_000;
  let t = new Date(Math.ceil(from.getTime() / step) * step);
  for (let i = 0; i < 4 * 24 * 8; i++) {
    if (inBusinessHours(t, zone)) return t;
    t = new Date(t.getTime() + step);
  }
  return t;
}
