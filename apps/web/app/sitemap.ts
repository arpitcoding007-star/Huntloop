import type { MetadataRoute } from "next";
import { siteUrl } from "../lib/site-url";
import { USE_CASES } from "./(marketing)/for/use-cases";
import { APPROACHES } from "./(marketing)/compare/approaches";

/**
 * The public surface, and only the public surface.
 *
 * Every other route in this app is either tenant-scoped (`/[org]/*`, which is
 * per-customer and behind RLS), part of an authenticated onboarding flow
 * (`/welcome/*`), or an endpoint rather than a page (`/auth/*`). None of those
 * belong in a sitemap, and padding the file with them would ask crawlers to
 * fetch a list of redirects to `/login`.
 *
 * ── `/` is here now, and was deliberately absent before ──────────────────
 *
 * This file used to carry two URLs and a note explaining that `/` was excluded
 * because it answered 307 to `/login` — a redirect in a sitemap is an error in
 * Search Console, and it would have been a second entry for a page already
 * listed below it.
 *
 * `app/(marketing)/page.tsx` is a real landing page now, so `/` is the
 * highest-priority entry rather than an omission. That note was also the
 * marker for when the content half of audit Phase 8 became applicable; it has.
 *
 * ── `/discover` is still absent, and must stay that way ──────────────────
 *
 * Every URL under it carries somebody's company domain in a query string, so a
 * crawlable index of them is a public list of who has been evaluating
 * Huntloop. The page sets `robots: { index: false }` as well; this is the
 * other half of the same decision.
 */
/** Static for the same reason as robots.ts — see the note there. */
export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  const url = (path: string) => new URL(path, base).toString();

  return [
    { url: url("/"), changeFrequency: "weekly", priority: 1 },
    /* The four use-case pages, enumerated from the same list that renders
       them — so a page added there appears here without anybody remembering,
       and a page removed there stops being submitted. */
    ...USE_CASES.map((useCase) => ({
      url: url(`/for/${useCase.slug}`),
      changeFrequency: "monthly" as const,
      priority: 0.7,
    })),
    /* The comparison pages, enumerated from the same list that renders them,
       for the same reason as the use cases above. */
    ...APPROACHES.map((approach) => ({
      url: url(`/compare/${approach.slug}`),
      changeFrequency: "monthly" as const,
      priority: 0.6,
    })),
    { url: url("/signup"), changeFrequency: "yearly", priority: 0.8 },
    { url: url("/login"), changeFrequency: "yearly", priority: 0.5 },
  ];
}
