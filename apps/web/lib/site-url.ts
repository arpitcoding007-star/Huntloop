/**
 * The deployment's own public origin.
 *
 * Needed by `metadataBase`, `robots.ts` and `sitemap.ts`, all of which have to
 * emit absolute URLs and none of which have a request object to read the host
 * from — they run at build time as often as not.
 *
 * Resolution order, most explicit first:
 *
 *   NEXT_PUBLIC_SITE_URL   Set this in production. It is the only one that
 *                          survives a custom domain.
 *   VERCEL_PROJECT_PRODUCTION_URL
 *                          Vercel's stable production host. Preferred over
 *                          VERCEL_URL, which is the *per-deployment* host and
 *                          would put a throwaway preview domain into canonical
 *                          tags and Open Graph URLs.
 *   localhost:3100         Development. Matches the port in package.json.
 *
 * Never throws. A missing origin should not fail a build — it should produce a
 * localhost URL that is obviously wrong in a preview rather than an outage.
 */
export function siteUrl(): URL {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;

  const raw = explicit ?? (vercel ? `https://${vercel}` : "http://localhost:3100");

  try {
    return new URL(raw);
  } catch {
    return new URL("http://localhost:3100");
  }
}
