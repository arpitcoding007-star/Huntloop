import type { MetadataRoute } from "next";
import { legalIsComplete } from "../lib/legal";
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
 *
 * The public marketing prefixes are opened back up explicitly against that
 * wildcard — see the note on the `allow` list, which is the whole reason it
 * has five entries rather than three.
 */
/**
 * Opts back out of the root layout's `force-dynamic`.
 *
 * That setting exists so every page carries a CSP nonce (see `app/layout.tsx`).
 * This response ships no scripts, so it needs no nonce — and it is one of the
 * two responses in the app most worth serving from a cache rather than
 * rendering per crawler.
 */
export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  const base = siteUrl();

  return {
    rules: [
      {
        userAgent: "*",
        // `/for/` and `/compare/` are listed here because of the
        // wildcard-segment rule below, not in spite of it.
        //
        // That rule matches any path with a second segment, which is every
        // tenant route — and was also every marketing page. The eight URLs
        // `sitemap.ts` submits (four use cases, four comparisons, both
        // enumerated from the same lists that render them, both linked from
        // the landing page footer) were all disallowed by it. The site was
        // asking to be indexed and refusing to be crawled in one breath.
        //
        // Robots.txt resolves a conflict by the length of the rule's path,
        // so `/for/` (5) and `/compare/` (9) beat the wildcard (3), and the
        // two prefixes become crawlable while everything else with a second
        // segment stays shut. That keeps the property the wildcard was
        // written for: a tenant route added later is disallowed by default,
        // because opening a prefix is now an explicit line in this file.
        //
        // Checked by SEO-AGREE in scripts/audit.mjs, which fails the build
        // if the two files disagree again.
        allow: [
          "/$",
          "/login",
          "/signup",
          "/for/",
          "/compare/",
          /* The legal pages, once they are actually in force. While any fact
             in `lib/legal.ts` is still PENDING they stay out of the index —
             a draft policy that a search engine has cached and is serving to
             somebody looking for our privacy terms is the one way a
             deliberately-unpublished document still gets published. Each
             page carries `robots: noindex` as well, for crawlers that read
             the page rather than this file. */
          ...(legalIsComplete() ? ["/privacy", "/terms", "/acceptable-use"] : []),
        ],
        disallow: [
          "/kitchen-sink",
          "/auth/",
          "/welcome",
          "/*/",
          ...(legalIsComplete() ? [] : ["/privacy", "/terms", "/acceptable-use"]),
        ],
      },
    ],
    sitemap: new URL("/sitemap.xml", base).toString(),
    host: base.host,
  };
}
