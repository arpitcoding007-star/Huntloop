# Pass 16 — runtime evidence (lead auditor)

Collected 2026-11-14 at `7e09759`.

## Mechanical
| Check | Result | Log |
|---|---|---|
| typecheck | exit 0 | typecheck.log |
| lint | exit 0 | lint.log |
| npm test | exit 0 — web 296 · ai 243 · providers 20 · db migrations 383 · migrator 9 · security leads 59 · rules 150 · admin-imports (353 app + 171 pkg files, service-role in 5 files) · schema-reference · jobs 434 · crm 86 · ui 42 | npm-test.log |
| audit:site | 46 checks · 0 fail · 1 warn (LEGAL-01) | audit-site.log |
| build | exit 0; warnings: Edge runtime deprecated; `withSentryConfig` import path deprecated in Sentry v11 | build.log |
| audit:bundle | 201.7 / 275 kB shared JS | bundle.log |
| playwright (demo) | 316 passed · 4 skipped | playwright.log |
| npm audit --omit=dev | 5 moderate, one chain: @sentry/nextjs → bundler-plugins → glob/minimatch; fix = major bump to 11.12.0 | npm-audit.json |
| db:doctor (configured Supabase) | 0001–0047 ok; **0048, 0049, 0050 MISSING**; 0006 cron not visible | db-doctor.log |

## Production (GET only)
| URL | Result |
|---|---|
| https://www.huntloop.pro/api/health | 503 · commit `8021d3f` · siteUrl `https://huntloop.pro` · schema "complete" (probe is table-only; misses 0048–0050) · cronSecret false · inngest false · credentialEncryption false · all integrations false |
| https://huntloop.pro/api/health | TLS failure `SEC_E_WRONG_PRINCIPAL` |
| http://huntloop.pro/ | 308 → failing https apex |
| https://www.huntloop.pro/ | 200; CSP script-src **report-only**; HSTS, XFO, nosniff, Referrer, Permissions present |

Unchanged since pass 15 (2026-11-01): production still serves `8021d3f`; nothing from commits 95175a5..7e09759 is deployed.

## Demo walk (`huntloop-demo`, port 3102)
- `/demo/companies`: 3 fixture companies, "Illustrative figures" banner. `/demo/companies/demo-company-1`: now shows "Hot · Qualified · score 91", consistent with the list (pass-15 RT-001 fixed).
- `/demo/dashboard`, `/demo/outreach`, `/demo/inbox`, `/demo/ops`: text extraction showed only the demo banner + "Loading…" (streamed content; not a finding by itself, Playwright smoke covers these routes).
- `/api/health` local: 503, schema "unconfigured" (expected without Supabase).
- `/api/jobs/tick` local GET without bearer: 404 "Not found".
- `/dev/onboarded` → redirect to `/demo/dashboard`.
- Console: only the 503/404 from the two API probes.
- Demo mode proves nothing about the real backend.

## Not run
- Failure injection against a test DB: no local Postgres harness beyond pglite migration tests; signed-in flows need a real Supabase project.
- Load/concurrency: not measured.
