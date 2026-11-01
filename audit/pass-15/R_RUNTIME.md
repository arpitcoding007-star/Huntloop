# Pass 15 — runtime and production evidence

Collected 2026-11-01 against the working tree on `main` @ `8021d3f` with this session's uncommitted changes.

## Mechanical checks (all run, all read-only)

| Check | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` | pass |
| `npm test` (all workspaces) | pass — web 281 · ai 232 · providers 20 · db migrations 360 · migrator 9 · security leads 59 · rules 150 · admin-imports · schema reference · jobs 393 · crm 81 · ui 42 |
| `npm run audit:site` | pass, one warning: `LEGAL-01` (7 legal facts not supplied) |
| `npm run build` + `audit:bundle` | pass — shared client JS 201.7 kB of 275 kB |
| `npx playwright test` (demo mode, desktop + mobile) | 316 passed · 4 skipped by design. First run failed 285 tests only because Chromium for Playwright 1.62.1 was not downloaded; `npx playwright install chromium` fixed it |
| `npm audit` | 18 moderate (dev tooling: `@vitest/mocker`, `glob`/`minimatch` via Sentry's build plugin). The 2 critical + 2 high present at the start of the session (`next` 16.4.0, `@sentry/nextjs` 10.70.0, `undici` 8.11.2, `zod` 4.4.3) were fixed in this session |
| `npm run db:doctor` (configured DB) | 0001–0047 applied; **0048 missing** (new this session) |

## Demo walk-through (`huntloop-demo`, port 3101)

Visited `/demo/companies`, `/demo/companies/demo-company-1`, `/demo/dashboard`, `/demo/opportunities`, `/demo/needs-you`, `/demo/outreach`, `/demo/inbox`, `/demo/pipeline`, `/demo/performance`, `/demo/ops`, `/welcome/*`. No console errors, no server errors. First compile of `/demo/companies` took 8.7 s (dev compile); warm 544 ms.

Observed: the companies list shows Alphio AI with "1 open" opportunity while its detail page says "Not qualified yet" — demo fixtures disagree (RT-001 in 03_FINDINGS.md). The merge-review panel is never visible in demo mode (the loader's fallback is `[]`), so no runtime check of it was possible.

## Production (read-only GETs)

| URL | Result |
|---|---|
| `https://www.huntloop.pro/api/health` | 503 · commit `8021d3f` · `siteUrl: https://huntloop.pro` · schema complete · service key present · `cronSecret:false`, `inngest:false`, `credentialEncryption:false`, every integration `false` |
| `https://huntloop.pro/` (apex) | **TLS failure** — `SEC_E_WRONG_PRINCIPAL`: the certificate served does not cover `huntloop.pro`. `http://huntloop.pro/` 308-redirects to that failing HTTPS URL. DNS: `76.76.21.21` (Vercel) |
| `https://www.seefluence.com/api/health` | 404 — the domain now serves a different project |
| `https://huntloop-web-mu.vercel.app/api/health` | 404 `DEPLOYMENT_NOT_FOUND` |

The deployed commit `8021d3f` predates every change in this session.
