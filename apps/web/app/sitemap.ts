import type { MetadataRoute } from "next";
import { siteUrl } from "../lib/site-url";

/**
 * Three URLs, and that is the honest number.
 *
 * Every other route in this app is either tenant-scoped (`/[org]/*`, which is
 * per-customer and behind RLS), part of an authenticated onboarding flow
 * (`/welcome/*`), or an endpoint rather than a page (`/auth/*`). None of those
 * belong in a sitemap, and padding the file with them would ask crawlers to
 * fetch a list of redirects to `/login`.
 *
 * Worth stating plainly: this stays a three-line sitemap until Huntloop has a
 * public marketing surface. Right now `/` redirects to the design-system
 * gallery, so even the root entry is a placeholder for a page that does not
 * exist yet — see the SEO section of the audit.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  const url = (path: string) => new URL(path, base).toString();

  return [
    { url: url("/"), changeFrequency: "monthly", priority: 1 },
    { url: url("/login"), changeFrequency: "yearly", priority: 0.5 },
    { url: url("/signup"), changeFrequency: "yearly", priority: 0.8 },
  ];
}
