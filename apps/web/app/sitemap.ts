import type { MetadataRoute } from "next";
import { siteUrl } from "../lib/site-url";

/**
 * Two URLs, and that is the honest number.
 *
 * Every other route in this app is either tenant-scoped (`/[org]/*`, which is
 * per-customer and behind RLS), part of an authenticated onboarding flow
 * (`/welcome/*`), or an endpoint rather than a page (`/auth/*`). None of those
 * belong in a sitemap, and padding the file with them would ask crawlers to
 * fetch a list of redirects to `/login`.
 *
 * `/` is not listed, and its absence is deliberate rather than an oversight.
 * It redirects to `/login` (see `app/page.tsx`), so listing it would submit a
 * URL that answers 307 — which Search Console reports as an error, and which
 * would in any case be a second entry for a page already below it.
 *
 * This stays a two-line sitemap until Huntloop has a public marketing surface.
 * When a landing page replaces the redirect, `/` becomes the highest-priority
 * entry here and the content half of audit Phase 8 becomes applicable for the
 * first time.
 */
/** Static for the same reason as robots.ts — see the note there. */
export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  const url = (path: string) => new URL(path, base).toString();

  return [
    { url: url("/signup"), changeFrequency: "yearly", priority: 0.8 },
    { url: url("/login"), changeFrequency: "yearly", priority: 0.5 },
  ];
}
