# Runtime / production findings (lead auditor, Phase 0 + 2)

## Mechanical checks (commit 509a24e, local)
| Check | Result |
|---|---|
| npm run typecheck | pass |
| npm run lint | pass |
| npm test | pass (vitest: 135 + 39 tests across workspaces shown; all green) |
| npm run audit:site | 44 checks, 0 failing, 2 warn: REPO-02 (NEXT_PUBLIC_HUNTLOOP_DEV_BYPASS, VERCEL_GIT_COMMIT_SHA not in .env.example), LEGAL-01 (7 legal facts PENDING in lib/legal.ts) |
| npm run build | pass; warnings: Edge Runtime deprecated; edge runtime disables static generation for a page |
| npm run audit:bundle | 245.7 kB of 275 kB shared client JS budget |
| npm audit --omit=dev | 0 vulnerabilities |
| db:doctor / check-queries | NOT RUN — would use the production secret key; UNVERIFIED locally (prod /api/health reports schema "complete") |
| CI on GitHub (ci.yml) | **failing on main for the last 5 pushes** (2026-09-28 07:18 → 2026-09-29 03:58). E2E: modules.spec.ts:125 "learn" strict-mode violation (2 headings named "Learn"), modules.spec.ts:47 "every settings tab leads somewhere real" (tab bar renders 0 elements) |

## Production (read-only, 2026-09-29)
- `https://seefluence.com/` → 307 → `https://www.seefluence.com/` (apex redirects to www while NEXT_PUBLIC_SITE_URL = apex).
- `https://www.seefluence.com/api/health` → `ok:false`, commit **509a24e** (= HEAD), database host hnoycsbdddpmsivtmrws, schema **complete**, serviceKey true, **cronSecret false, inngest false, credentialEncryption (MAILBOX_ENCRYPTION_KEY) false, anthropic/apollo/enrichment/emailVerification/gmail/outlook/sentry/posthog all false**.
- `/api/jobs/tick` unauthenticated → 503 (fails closed). `/kitchen-sink` → 404 (good).
- Security headers present: HSTS (2y, includeSubDomains), X-Frame-Options DENY, CSP `frame-ancestors 'none'` enforced, **full CSP still Report-Only**, Referrer-Policy, Permissions-Policy.
- **Split brain:** `https://huntloop-web-mu.vercel.app` (personal Vercel project, CLI-deployed, old code) is still live, its CSP `connect-src` points at the **same production Supabase project** (hnoycsbdddpmsivtmrws), `/kitchen-sink` returns **200**, `/api/health` redirects to login (predates the health route being public). It serves pre-fix code (e.g. before ICP-03 criteria-merge fix, onboarding fixes) against the production database.
- GitHub repo `arpitcoding007-star/Huntloop`: **public**, **no branch protection on main** (404 from protection API).
- `tick.yml`: runs every ~5 min in theory (GitHub throttles: 5 runs in the last ~22h), every run **"success" in 6s** while logging `CRON_SECRET or HUNTLOOP_URL is not configured; skipping.` → the heartbeat is green while nothing runs.

## Demo walk-through (huntloop-demo, localhost:3101)
- All 24 (app) routes, /login, /signup, /welcome render 200; unknown URL 404; /kitchen-sink 200 in dev (404 in prod — correct). No console errors, no server errors.
- Demo banner ("Demo data … Nothing here describes a real company") on every app screen — good.
- Opportunity detail (alphio-ai): evidence panel is strong — every claim labelled FACT/INFERENCE/UNKNOWN with source, observed date, confidence; "Do not assert these" list. But the narrative prose blocks ("Why this company", "Identified problem", "Why now", "Potential use case") are not per-claim labelled; fixture "Why now" says "Series A closed three days ago" and the score tooltip says "Series A closed this week" while the evidence is dated 1 month ago → relative-time text frozen at generation time goes stale with no timestamp.
- "Disagree" opens a correction form (priority + reason) — the prior H-9 "no user-correction capture" appears addressed. In demo mode submitting it shows "That opportunity reference isn't valid." rather than "demo mode — not saved" (confusing, demo-only).

## Findings

### [High] RT-001 — Worked-example verdict can be saved as a real opportunity with a fabricated, sourced "fact"
- Confidence: CONFIRMED (code trace + demo run); production exposure LIKELY (prod has DB configured and `anthropic:false`)
- Where: `apps/web/lib/ai/qualify.ts:64-70` (returns `example()` when `!isAiConfigured()`), `qualify.ts:~236-246` (evidence `kind:"fact"`, `confidence:"high"`, `sourceUrl: https://${domain}/blog`, invented excerpt), `apps/web/app/(app)/[org]/analyze/Analyzer.tsx:~407-433` (Save shown for any non-ignore verdict), `apps/web/app/(app)/[org]/analyze/actions.ts:137-290` (`saveQualificationAction` persists client-supplied qualification)
- Evidence: analyzing `https://example.com` in demo returned HOT 91, "FACT · HIGH — They describe custody permissioning as an unsolved problem", quoted and attributed to the typed domain. The banner says "worked example", but the Save button is still offered, and the save path writes companies, opportunities, opportunity_scores and evidence rows with `kind: e.kind` straight from the client payload.
- Impact: in any deployment with a database but no model key — which is production today — a user can put an invented HOT opportunity, with a fabricated quote attributed to a real company's URL, into their workspace as FACT. This breaks the product's first rule ("never silently convert inferred into verified fact"). Future scoring, outreach drafting and CRM sync then treat the invented row as real.
- Root cause: the verdict round-trips through the browser. The server re-validates its shape (`qualificationSchema`) but not where it came from (no server-side record of a live model run to save from), and `source:"unconfigured"` isn't checked on save.
- Fix: persist the qualification server-side at analyze time (or sign it) and have save reference that ID; refuse to save when `source !== "live"`; hide Save for worked examples. Also make the example's `sourceUrl` a non-resolvable placeholder rather than the user's domain.
- Effort: S–M · Depends on: — · Mechanizable: yes (unit test: save rejects an unconfigured-source verdict; audit check: no example builder uses the caller's domain in sourceUrl)

### [High] RT-002 — Any workspace member can forge "fact" evidence via saveQualificationAction
- Confidence: CONFIRMED (code)
- Where: `apps/web/app/(app)/[org]/analyze/actions.ts:137-150, 259-271`
- Evidence: the action takes `qualification: Qualification` from the client and inserts `evidence` rows with `kind`, `confidence`, `source_url`, `excerpt` as supplied. Nothing ties them to a model run or a fetched page.
- Impact: this is not a tenant breach, but the provenance guarantee ("every fact traces to an observed source") can be bypassed by anyone with member access, using a crafted server-action call. `evidence` is what the "every claim has a source" UI renders as verified.
- Root cause and fix: same as RT-001. Save should reference a server-held run, not trust the client payload.
- Effort: S–M · Depends on: RT-001 fix · Mechanizable: yes

### [Medium] RT-003 — Save path is multi-step and non-transactional
- Confidence: CONFIRMED (code)
- Where: `analyze/actions.ts` save: upsert company → upsert opportunity → insert score → soft-delete old evidence → insert evidence, each a separate PostgREST call
- Impact: a failure part-way (for example, the evidence insert) leaves an opportunity whose previous evidence is already soft-deleted and whose new evidence was never written. The code reports this but can't roll it back.
- Fix: move it into one `SECURITY INVOKER` RPC or transaction.
- Effort: M · Mechanizable: no

### [Critical] RT-004 — Production is deployed but cannot do its job: no model, provider, cron, or encryption keys
- Confidence: CONFIRMED (`/api/health` on www.seefluence.com)
- Evidence: `jobs.cronSecret:false`, `credentialEncryption:false`, `anthropic:false`, `apollo:false`, `enrichment:false`, `emailVerification:false`, `gmail:false`, `outlook:false`, `sentry:false`.
- Impact: no discovery, enrichment, qualification (worked examples only, see RT-001), mailbox connection (encryption key missing), or scheduled jobs; there's also no error monitoring. The live product is the demo branch attached to a real database.
- Fix: a human sets the env vars on Vercel team `huntloop` → project `huntloop-web` (copy MAILBOX_ENCRYPTION_KEY and CRON_SECRET from the retired personal project), then redeploys and re-checks `/api/health` for `ok:true`.
- Effort: S (manual) · Depends on: owner access to the Vercel team · Mechanizable: yes (uptime monitor on /api/health, which already returns 503)

### [High] RT-005 — Engine heartbeat reports success while doing nothing
- Confidence: CONFIRMED (gh run logs)
- Where: `.github/workflows/tick.yml` skip branch; repo has 0 Actions secrets/variables
- Evidence: every scheduled run concludes `success` after logging "CRON_SECRET or HUNTLOOP_URL is not configured; skipping."
- Impact: anyone looking at Actions sees a green engine, but no job has ever been ticked in production.
- Fix: make the skip branch fail (or emit a warning annotation and fail) once the repo is meant to be live; the owner adds the `CRON_SECRET` secret and `HUNTLOOP_URL` variable.
- Effort: XS · Mechanizable: yes

### [High] RT-006 — Split brain: old personal-account deployment still serves stale code against the production database
- Confidence: CONFIRMED (headers + CSP connect-src + /kitchen-sink 200 on huntloop-web-mu.vercel.app)
- Impact: users or links hitting the old URL run pre-fix code (known data-loss bug ICP-03, old onboarding) against production data, and it exposes /kitchen-sink. Two code versions write to one database.
- Fix: delete or disable the personal project `cmbatmans-projects/huntloop-web` after copying its env values, and delete the always-failing team project `huntloop`.
- Effort: XS (manual) · Mechanizable: partially (health check comparing commits across known origins)

### [High] RT-007 — CI red on main for 5 consecutive pushes; main is unprotected
- Confidence: CONFIRMED
- Evidence: `gh run list --workflow ci.yml`: failures from 8ab269c through 509a24e; failing E2E specs `e2e/modules.spec.ts:125` (duplicate "Learn" heading) and `:47` (settings tab bar missing). No branch protection.
- Impact: the verification gate the whole audit program relies on (`audit/README.md`: "a failing build step") is being bypassed; regressions ship straight to seefluence.com via Git-connected deploys.
- Fix: fix the two specs or the regressions they caught (nav redesign 3d7292a is the likely cause), then enable branch protection requiring CI.
- Effort: S · Mechanizable: yes (branch protection)

### [Medium] RT-008 — Full CSP still Report-Only in production
- Confidence: CONFIRMED (response headers)
- Status vs last pass: Still open (M-1)

### [Low] RT-009 — Apex redirects to www while NEXT_PUBLIC_SITE_URL is the apex
- Confidence: CONFIRMED
- Impact: canonical URLs, OAuth redirect URIs and email links use the apex, so every visit takes an extra 307 hop; there's also a risk of OAuth redirect URI mismatch.
- Fix: pick one host and align SITE_URL, the Vercel primary domain and the OAuth redirect URIs.

### [Low] RT-010 — Demo-mode actions fail with a misleading validation error
- Where: correction form on /demo/opportunities/alphio-ai → "That opportunity reference isn't valid."
- Fix: have demo mode short-circuit mutations with "Demo workspace — nothing is saved."

## Playwright (local, production build, demo env)
264 passed, 4 failed, 4 skipped (2.3 min). Same failures as CI (desktop + mobile):
- `e2e/modules.spec.ts:47` settings tab bar renders 0 `role=tab`. The sidebar redesign (3d7292a) changed `settings/layout.tsx`, and settings sub-navigation no longer exposes tabs. The spec is stale or the tab bar was dropped. Either way, "every settings tab leads somewhere real" is no longer tested.
- `e2e/modules.spec.ts:125` `getByRole('heading',{name:'Learn'})` matches 2 elements: the page `<h1>Learn</h1>` (`learn/page.tsx:39`) and the new sidebar group title "Learn" (`OrgShell.tsx:180`) rendered as a heading. This is a real, if minor, a11y ambiguity: two same-named headings, and the nav group label is exposed as a document heading.
Both are regressions from 3d7292a that CI caught and that shipped anyway (RT-007).
