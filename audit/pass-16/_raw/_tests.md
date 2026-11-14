## Tests by risk (reviewer E §8)

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

