import type { MetadataRoute } from "next";
import { siteUrl } from "../lib/site-url";

/**
 * Huntloop is a product, not a content site, and the robots policy should say
 * so rather than being copied off a marketing template.
 *
 * Almost everything here is behind auth and would return a redirect to a
 * crawler anyway. The disallow list is not what keeps it private — RLS and the
 * middleware guard do that — it exists so that the handful of routes which are
 * *reachable* without a session stay out of the index:
 *
 *   /kitchen-sink   The design-system gallery. It is public on purpose (it has
 *                   no data in it) and it is emphatically not the page anyone
 *                   should reach from a search for "Huntloop".
 *   /auth/*         Callback and sign-out endpoints. Crawling sign-out is a
 *                   waste of everyone's time; the POST-only route already
 *                   refuses it.
 *   /welcome/*      Onboarding. Every URL under it is meaningless without the
 *                   session that created it.
 *
 * Tenant routes cannot be expressed as a prefix — the org slug is the first
 * path segment, so there is nothing fixed to match on. They are covered by the
 * wildcard-segment rule in the disallow list below instead. That rule is broad
 * on purpose: a new tenant route added later is disallowed by default, which
 * is the correct direction for a mistake to fail in.
 */
export default function robots(): MetadataRoute.Robots {
  const base = siteUrl();

  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/$", "/login", "/signup"],
        disallow: ["/kitchen-sink", "/auth/", "/welcome", "/*/"],
      },
    ],
    sitemap: new URL("/sitemap.xml", base).toString(),
    host: base.host,
  };
}
