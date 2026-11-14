# Pass 16 — verification matrix

What was actually run in this pass (logs in `_raw/`), what each claim rests on, and the tests that are missing.

## Tests run (2026-11-14, `7e09759`)

| Command | Result | Log |
|---|---|---|
| `npm run typecheck` | pass | `typecheck.log` |
| `npm run lint` | pass | `lint.log` |
| `npm test` (all workspaces) | pass: web 296 · ai 243 · providers 20 · db migrations 383 · migrator 9 · security leads 59 · rules 150 · admin-imports · schema-reference · jobs 434 · crm 86 · ui 42 | `npm-test.log` |
| `npm run audit:site` | 46 checks, 0 fail, 1 warn (LEGAL-01) | `audit-site.log` |
| `npm run build` / `audit:bundle` | pass · 201.7 / 275 kB | `build.log`, `bundle.log` |
| `npx playwright test` (demo mode) | 316 passed · 4 skipped (viewport-conditional) | `playwright.log` |
| `npm audit --omit=dev` | 5 moderate, one chain via `@sentry/nextjs` | `npm-audit.json` |
| `npm run db:doctor` (configured DB) | 0048–0050 MISSING (exit 1) | `db-doctor.log` |
| Production GET | 503, `8021d3f`, apex TLS failure | `prod-get.log` |
| Reviewer probes (outside the repo, in memory) | B: all 50 migrations in PGlite + catalog read + `authenticated` repros (DB-201, DB-203, AUTHZ-201). A: DB-203 repro. C: budget fallback race (PROV-201). D: `sendMessage` against a fake DB (OUT-201) | reviewer files |

**What green does not mean.** All suites use PGlite or scripted fakes. None touch hosted Supabase, Gmail, Outlook, Apollo, Hunter, ZeroBounce, Anthropic or HubSpot. Playwright runs in demo mode, with no database, auth, sends or ticks. No test runs two Postgres connections at once (TEST-202), and no test covers the route handlers or the production proxy branch (TEST-201). The suite also could not see DB-203, because the harness re-grants table SELECT after migrating.

## Verification by feature

| Feature | Workflow | Expected | Actual | Automated test | Status | Known failure | Recommended test |
|---|---|---|---|---|---|---|---|
| Tenant isolation | read/write another org's rows | refused | refused (PGlite) | `verify-migrations.ts:316,3021` | Verified (PGlite) | DB-201 is within-tenant | real-Supabase grant check |
| Send at most once | crash/retry around send | ≤1 provider send | ≤1 (fakes) | `verify-jobs.ts:1413` | Verified (fakes) | OUT-203 (no UI) | — |
| Suppression at send | unsubscribed address | refused | refused | `verify-jobs.ts:1150`; `verify-migrations.ts:909-942` | Verified (code path) | DB-201 (row deletable) | member cannot delete suppression |
| Stop stops mail | stop/pause/archive/close | queued mail not sent | **sent** | none | Broken | OUT-201 | per parent state |
| Transient refusal retried | cap/cadence/quota | sent later | stranded | none | Broken | OUT-202 | retry after horizon |
| Mailbox connect | OAuth callback | mailbox stored | works today; fails after 0049 | none (harness re-grants) | Broken once migrated | DB-203 | callback shape as authenticated |
| Readiness | DB missing 0050 | 503 | "complete" | none | Broken | PROD-201 | probe tracks newest marker |
| Provider cap | parallel calls at cap | exactly cap | overshoot (fallback) | sequential only | Partial | PROV-201 | real-PG concurrency |
| First-run stages | no keys | "skipped/refused" | "done / 0 / Scored N" | none | Broken | ENG-201 | stageDiscover contract |
| HubSpot push retry | association fails | one deal | two deals | none | Broken (code) | CRM-201 | retry idempotency |
| Last owner | concurrent demotes | ≥1 owner | 0 possible | none | Partial | AUTHZ-201 | DB trigger case |
| Seats | invite past limit | refused | allowed | none | Broken | AUTHZ-202 | seats count |
| Erasure | erase contact | no PII left | 8 places keep it | partial (`verify-migrations` erasure block) | Partial | LIFE-201 | per-table residue |
| Tick auth | wrong/no bearer | 404/503 | 404 locally (by reading) | none | Implemented, unverified | — | tick-route test |
| CSP reports | Chromium report | recorded | dropped | `e2e/csp.spec.ts` (legacy shape only) | Broken | SEC-201 | Reporting-API body |


| Risk | Test exists? | Path | Caveat |
|---|---|---|---|
| Tenant isolation / RLS | **Yes** | `packages/db/scripts/verify-migrations.ts:316` (cross-tenant as non-superuser), `:1636`, `:3021` (every tenant table has RLS on), `:3184` (write hardening) | PGlite, not hosted Supabase. Does not cover service-role code paths (SEC-205) |
| Send idempotency | **Yes (fakes)** | `verify-jobs.ts:1023`, `:1413` ("OUT-001: at most once"), `:1292`; DB `verify-migrations.ts:3474` (one message per step) | Scripted fakes prove the path, not Gmail or Outlook |
| Per-address lane | Yes, sequential | `verify-migrations.ts:1772`, `verify-jobs.ts:1271` | Single connection (TEST-202) |
| Spend cap | Yes, sequential | `verify-migrations.ts:1735` (0050 reserve), `apps/web/lib/ai/spend-guard.test.ts`, `budget.test.ts` | Not concurrent (TEST-202) |
| Rate limit | Yes | `verify-migrations.ts:396`, `rate-limit.test.ts` | — |
| Webhook / unsubscribe replay | Partial | `record_unsubscribe` twice (`verify-migrations.ts:909-942`). No inbound vendor webhooks exist. **Inngest signature: no test** | — |
| Migrations apply, twice | Yes | `verify-migrations.ts:116` (all in order), `verify-migrate.ts` (ledger, baseline, re-run) | Not against a hosted DB |
| Job retry / claim / deadline | Yes (fakes) | `verify-jobs.ts:499` ("claim, dispatch, record, and stop before being killed"), `:453`, `:721`; DB queue `verify-migrations.ts:1201` | `skip locked` is never exercised by two connections |
| Cron auth / route handlers / proxy prod branch | **No** | — | TEST-201 |
| Open redirect | Yes | `apps/web/lib/safe-next.test.ts` | — |
| SSRF | Yes | `verify-jobs.ts:254` | — |
| Header injection, escaping | Yes | `verify-jobs.ts:1088`, `:3605` | — |

**What e2e (demo mode, 316 passed) does NOT assert:** anything with a database, real auth or RLS. Any send, enqueue or tick. The production branch of the proxy (`VERCEL_ENV=production`: the 503 not-ready page, the 404 on `/kitchen-sink` and `/dev/onboarded`). CSP in enforcing mode (only by hand, `SETUP.md:463`). Reporting-API CSP bodies (`e2e/csp.spec.ts:100-125` posts only the legacy `application/csp-report` shape). Mailbox OAuth. Unsubscribe against a DB. Health semantics. The 4 skips are viewport-conditional (`app-shell.spec.ts:93,268,476,498`).

### The 10 missing tests that would catch the most damage

1. `apps/web/test/tick-route.test.ts`: tick returns 503 with no `CRON_SECRET`, 404 for a wrong or prefix bearer, and runs `sweep`/`tick` only for an exact match.
2. `apps/web/test/proxy-production.test.ts`: with `VERCEL_ENV=production`, no Supabase → 503 on `/demo/dashboard`; `/kitchen-sink` → 404; `/api/health` is still served.
3. `packages/db/scripts/verify-migrations.ts`: **the schema probe tracks the newest required object.** It fails when any migration creates a table or function the app calls and `LATEST_TABLE` (`lib/schema.ts:38`) is not bumped (PROD-201).
4. `packages/jobs/scripts/verify-jobs.ts`: `send_message` against a DB **without** `claim_contact_lane` (42883) neither defers forever nor reports ok. It must fail loudly (PROD-201).
5. `packages/db/scripts/verify-concurrency.ts` (real Postgres, two connections): two concurrent `reserve_provider_credit` calls with one credit left → exactly one allowed. Two `claim_contact_lane` calls → one winner. Two `claim_jobs` calls → disjoint sets (TEST-202).
6. `apps/web/test/csp-report.test.ts`: a Reporting-API array body (`type: "csp-violation"`, camelCase `body`) reaches Sentry with its directive (SEC-201).
7. `apps/web/test/inngest-route.test.ts`: a request signed by the official Inngest SDK verifies; a stale timestamp or altered body is refused (SEC-202).
8. `apps/web/test/mailbox-oauth.test.ts`: the callback refuses a missing or mismatched state cookie, a provider mismatch, and a viewer role. `redirect_uri` equals the registered origin (PROD-001).
9. `packages/jobs/scripts/verify-jobs.ts`: `sync_hubspot` with `NEXT_PUBLIC_SITE_URL` unset refuses to push rather than writing a placeholder host (DEBT-201).
10. `apps/web/test/health.test.ts`: `/api/health` returns 503 when the last tick is older than N minutes or a required migration (0050) is missing (OBS-202).

