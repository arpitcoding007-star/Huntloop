/**
 * The buyer domain (DN-73, EX-1): a second hostname on the same deployment
 * whose home page is `/find`. Off until `HUNTLOOP_BUYER_HOST` names it and the
 * Exchange is on, so the brand decision is a setting rather than a release.
 *
 * Compared exactly. It decides which page `/` shows and which of our two
 * origins a sign-in email links to, never what anybody may read.
 */
export function buyerHost(): string | null {
  if (process.env.HUNTLOOP_EXCHANGE?.trim().toLowerCase() !== "on") return null;
  const host = process.env.HUNTLOOP_BUYER_HOST?.trim().toLowerCase();
  return host && /^[a-z0-9.-]+(:\d+)?$/.test(host) ? host : null;
}

export function isBuyerHost(host: string | null | undefined): boolean {
  const configured = buyerHost();
  return configured !== null && host?.trim().toLowerCase() === configured;
}

/** Where a sign-in started on this host must come back to: cookies are per host. */
export function authOrigin(host: string | null | undefined, fallback: URL): URL {
  if (!isBuyerHost(host)) return fallback;
  return new URL(`${fallback.protocol}//${buyerHost()}`);
}

/** The seller site's own pages, which the buyer domain sends to the main one. */
export const SELLER_PAGES = ["/for", "/compare", "/discover"];
