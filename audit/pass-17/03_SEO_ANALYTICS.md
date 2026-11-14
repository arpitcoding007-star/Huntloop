# W3 — technical SEO and analytics

Scope note (from `audit/README.md`): there is no content surface, so this is *technical* SEO (crawl policy, canonicals, metadata, indexability) and, for analytics, what exists against what a measurement plan needs.

## Technical SEO

What is in the repo, and sound:
- `app/robots.ts`: indexes `/`, `/login`, `/signup`, `/for/*`, `/compare/*`; blocks `/kitchen-sink`, `/auth/`, `/welcome` and every org path (`/*/`). Legal pages are allowed only once `legalIsComplete()`, and each legal page also carries `noindex, nofollow` (verified on prod `/privacy`).
- `app/sitemap.ts` is generated from the same `USE_CASES`/`APPROACHES` arrays the pages render, so it cannot drift.
- `metadataBase`, per-page `alternates.canonical`, `<title>`, a description, and Open Graph image routes (`opengraph-image.tsx`, `apple-icon.tsx`).

### [Medium] SEO-301: Every canonical, the sitemap and `robots` point at the apex, which fails TLS, so the live site is effectively unindexable
- Confidence: CONFIRMED (prod GETs, 2026-11-14).
- Evidence: `https://www.huntloop.pro/` serves `<link rel="canonical" href="https://huntloop.pro">` and `og:url https://huntloop.pro`. `robots.txt` says `Host: huntloop.pro` and `Sitemap: https://huntloop.pro/sitemap.xml`. All 11 `<loc>` entries in the sitemap are on `https://huntloop.pro/…`. That host fails TLS (PROD-001).
- Impact: crawlers are told the real URL of every page is one they cannot fetch. Social shares unfurl to a broken `og:url`. Nothing marketing does reaches search until this is fixed.
- Root cause: same as PROD-001. `siteUrl()` is the apex, and the apex certificate is missing.
- Fix: PROD-001's fix (certificate on the apex plus www → apex 308, or `NEXT_PUBLIC_SITE_URL=https://www.huntloop.pro`). Nothing in the code changes.
- Acceptance: a strict-TLS fetch of every sitemap `<loc>` returns 200, and the canonical equals the URL served.
- Test to add: extend `scripts/live-check.ts` to fetch the sitemap and every `<loc>` with strict TLS.
- Effort: S (config) · Depends on: PROD-001 · Mechanizable: yes · Status: New (an SEO consequence of PROD-001)

### Low / Info
- **SEO-302 (Low):** `/discover` (the anonymous research page) is in neither the sitemap nor the robots allow list. It is allowed by default (it doesn't match `/*/`), but is not submitted. Production currently 307s it to `/` because prod runs old code. Decide whether it should be indexed and list it either way.
- **Info:** `/compare` has no index page (404) while `/compare/*` pages exist. That is fine for crawlers (the sitemap lists the children), but a user trimming the URL lands on a 404.

## Analytics

What exists (`apps/web/lib/analytics.ts`):
- Server-side PostHog (`posthog-node`), no client SDK. The reasons are written down: bundle budget, and no autocapture or session recording of prospecting.
- A closed union of event names, a properties type that excludes emails, company names, URLs and ICP text, and `distinctId` = Supabase user uuid.
- Events actually emitted: `onboarding_step_viewed` (7 call sites), `onboarding_step_completed` (7), `onboarding_step_failed`. That is the onboarding funnel only.
- In production `integrations.posthog = false` (health). Nothing is collected today.

### [Medium] ANL-301: Nothing measures whether the product works for a customer after onboarding
- Confidence: CONFIRMED (grep of every `capture`/`captureForViewer` call).
- Impact: the north-star question ("who should I pursue next, and did it work?") has no metric. There is no event or derived measure for: first opportunity reviewed, draft approved, first send, first reply, meeting booked, weekly active review, or time from signup to first qualified opportunity. Product decisions after launch would be made blind, and so would billing (MONEY-201) and pricing.
- Fix (a measurement plan, not code yet):

| Metric | Definition | Source (preferred: already in the DB, no new tracking) |
|---|---|---|
| Activation | signup → first opportunity marked reviewed or contacted within 7 days | `opportunities.status` history / `activities` |
| Time to value | signup → first opportunity scored ≥ warm | `opportunity_scores.created_at` |
| Outreach yield | replies ÷ sent, per org per week | `messages`, `message_events`, `threads.classification` |
| Meetings | `outcomes.kind = 'meeting'` per org per month | `outcomes` |
| Approval friction | drafts rejected ÷ drafted; median approval delay | `messages.rejected_at`, `approved_by`, `scheduled_at - created_at` |
| Retention | orgs with any review action in week N after signup | `activities` |
| Cost per qualified lead | provider + AI spend ÷ opportunities ≥ warm | `provider_calls`, `ai_runs`, `opportunities` |

  Most of this is derivable server-side from tables that already exist, which keeps to the file's own privacy rule. An internal SQL view or the operator console (pass-16 OBS-203) would be the place for it. Only "page reviewed" style events would need new `capture` calls.
- Effort: M · Mechanizable: no · Status: New

## Checked, fine
- No analytics or third-party script reaches the browser (no client SDK; CSP `connect-src` lists only Supabase).
- Legal pages stay unpublished while LEGAL-01 has 7 pending facts: `noindex` in prod, disallowed in robots, unlinked.
