# Pass 21 — raw E: Security, Prod, Perf, Tests, Debt

Branch `feat/pass-21-loop` @ `dab37db`. Read-only. One production GET (`/api/health`).
No build/verify run (concurrent run in progress). `npm audit --omit=dev`: 0 vulnerabilities.

## Highs: what I tried to disprove

| Candidate | Verdict | Evidence |
|---|---|---|
| SSRF via "Read the page" (`readSupplyPageAction`) | **Disproved.** | `apps/web/app/(app)/[org]/exchange/actions.ts:587-606` goes through `fetchPage` (`packages/jobs/src/fetch.ts:253`): scheme allow-list (178), every resolved address checked (206-214), manual redirects re-checked per hop (270-288), connect-time lookup guard against DNS rebinding (`guardedAgent`, 230-251), 1 MB cap. Membership and write role are checked by `mutate()`, and the rate limit is counted before the fetch (`apps/web/lib/ai/intake.ts` `readPage`). |
| SSRF via Memory "ingest URL" | **Disproved** (same `fetchPage`; see SEC-002 for the missing limit). | `apps/web/app/(app)/[org]/memory/actions.ts:218-232` |
| XSS through `dangerouslySetInnerHTML` | **Disproved.** Only 2 uses, both constant strings. | `apps/web/app/layout.tsx:174` (theme script, nonce'd), `apps/web/app/global-error.tsx:44` |
| Reflected XSS in hand-built HTML unsubscribe pages | **Disproved.** The token is HMAC-verified before it is reflected, and it is `encodeURIComponent`'d. | `apps/web/app/api/notifications/unsubscribe/route.ts` GET, `packages/jobs/src/email/digest-token.ts:38-46` |
| Unauthenticated job runner / webhook | **Disproved.** The tick route uses a constant-time Bearer compare and answers 404 on a wrong secret. Inngest uses HMAC with a ±5 min window. | `apps/web/app/api/jobs/tick/route.ts`, `apps/web/lib/inngest.ts:80-115` |
| Dev routes reachable in prod | **Disproved.** `/kitchen-sink` and `/dev/onboarded` answer 404 when `VERCEL_ENV=production`, and `/dev/onboarded` also checks `NODE_ENV`. | `apps/web/proxy.ts:151,269-271`, `apps/web/app/dev/onboarded/route.ts:30` |
| Secrets in git history | **No live secrets found.** Pattern scan (Anthropic, Supabase `sb_secret_`, Resend, JWT, AWS, GitHub, Google OAuth, PEM) matched only identifiers in build output. See SEC-005. | `git log --all -p -G…` |
| NEXT_PUBLIC_* leaks | **None.** Every `NEXT_PUBLIC_*` name is designed to be public. `NEXT_PUBLIC_HUNTLOOP_DEV_BYPASS` only takes effect when `NODE_ENV==="development"`. | `apps/web/app/(onboarding)/welcome/icp/IcpStep.tsx:37-39` |
| PII in Sentry | **Mitigated.** All collection is off: user info, cookies, headers, bodies, query params, genAI I/O. | `apps/web/lib/sentry-data-collection.ts`, all 3 `sentry.*.config.ts` |

No P0 survived.

---

### [P1] PROD-001: Production runs with no engine driver, no AI, no mail, no credential key and no error reporting
- **Confidence:** CONFIRMED (production `GET /api/health`, 503)
- **Where:** production environment. Checks are at `apps/web/app/api/health/route.ts` (`ok` computation; `integrations` block)
- **Evidence:** `ok:false`, `commit:1a59f5a`, `schema:complete`, `requiredMigration:0068`, `cronSecret:false`, `inngest:false`, `credentialEncryption:false`, all integrations `false` (anthropic, apollo, gmail, outlook, sentry, email…). `siteUrl` is `https://huntloop.pro`; the request went to `www.`.
- **Impact:**
  - `/api/jobs/tick` answers 503, so nothing in the queue ever runs.
  - Mailbox connect is refused (`api/mailboxes/[provider]/start/route.ts`: `isEncryptionConfigured`).
  - Every AI screen returns examples or "not configured".
  - Invites and digests are not sent.
  - Errors and CSP reports go nowhere, because Sentry has no DSN.
  - The site is live but the product loop is inert.
- **Root cause:** Vercel and GitHub environment variables were never set. `tick.yml` also needs `CRON_SECRET` and `HUNTLOOP_URL` on the repo.
- **Fix (smallest):** Set these on Vercel Production:
  - `CRON_SECRET`
  - `MAILBOX_ENCRYPTION_KEY`
  - `ANTHROPIC_API_KEY`
  - `RESEND_API_KEY` and `EMAIL_FROM`
  - `SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_DSN`

  Then set `CRON_SECRET` (secret) and `HUNTLOOP_URL` (variable) on GitHub Actions. Also confirm whether apex or www is canonical, and make `NEXT_PUBLIC_SITE_URL` match it.
- **Acceptance:** `/api/health` returns 200 with `ok:true` and a non-null `jobs.queue`. The next `tick.yml` run is green.
- **Test to add:** none in code. Add a post-deploy smoke step that fails on `ok:false`.
- **Effort:** S (configuration only)

### [P2] PROD-002: Migrations reach production on push to main without waiting for CI, and the deploy is not ordered against them
- **Confidence:** CONFIRMED (workflow config). The outage window is LIKELY.
- **Where:** `.github/workflows/migrate.yml:17-20` (`on: push: branches [main], paths migrations/**`, no `needs`/`workflow_run` on CI). `apps/web/lib/schema.ts:41` (`LATEST_MIGRATION = "0069"`). `apps/web/proxy.ts:291` (`partial` in production returns 503).
- **Evidence:** `migrate.yml` and `ci.yml` both trigger on the same push and run independently. `dab37db` raises the required marker to 0069. Production is at 0068.
- **Impact:**
  1. A migration that fails `verify-migrations` is still applied to the production database.
  2. When Vercel finishes before `migrate.yml` (or `migrate.yml` fails or `DATABASE_URL` is missing), every page except the `SERVED_WHILE_NOT_READY` list answers 503 "migrations-pending" until someone intervenes.
- **Root cause:** Two pipelines with no ordering between them.
- **Fix (smallest):** Change `migrate.yml` to `on: workflow_run: {workflows: [CI], types: [completed], branches: [main]}` with `if: github.event.workflow_run.conclusion == 'success'`. Either keep manual `workflow_dispatch`, or gate the Vercel promotion on the migrate job (Vercel "Ignored Build Step" or deploy hook).
- **Acceptance:** A red CI run on main never runs migrate. Merging a migration PR never yields a production 503 longer than about one minute.
- **Test to add:** none (workflow). Document it in `docs/operations`.
- **Effort:** S

### [P2] SEC-001: CSP is report-only by default, and production has no report sink
- **Confidence:** CONFIRMED in code. Production header state UNVERIFIED (no extra production call made).
- **Where:** `apps/web/lib/csp.ts` (`cspIsEnforced()` returns `process.env.CSP_ENFORCE === "true"`; the header is otherwise `Content-Security-Policy-Report-Only`). `apps/web/app/api/csp-report/route.ts` (forwards only to Sentry). `/api/health` does not report CSP state.
- **Evidence:** Production health shows `sentry:false`, so `Sentry.captureMessage` in csp-report is a no-op.
- **Impact:** The nonce + `strict-dynamic` policy gives no XSS protection in production, and the report-only phase it exists for collects nothing.
- **Root cause:** An opt-in flag with no visibility.
- **Fix (smallest):**
  1. Add `csp: cspIsEnforced() ? "enforced" : "report-only"` to the health report.
  2. Set Sentry DSNs (PROD-001), watch reports for one week, then set `CSP_ENFORCE=true`.
- **Acceptance:** `/api/health` shows `csp:"enforced"` in production. The `e2e/csp.spec.ts` enforced-mode case passes.
- **Test to add:** a health route unit test asserting the `csp` field follows `CSP_ENFORCE`.
- **Effort:** S

### [P2] SEC-002: Server-side URL fetch and document parsing have no rate limit (Memory ingest, `/api/memory/extract`)
- **Confidence:** CONFIRMED
- **Where:** `apps/web/app/(app)/[org]/memory/actions.ts:203-232` (`ingestMemoryAction` → `fetchPage(value.url)` with default 15 s / 4 MB and no `consumeRateLimit`). `apps/web/app/api/memory/extract/route.ts` (PDF/DOCX parse, `maxDuration=30`, no limit).
- **Evidence:** `grep consumeRateLimit|limitRefusal` finds nothing in either file. Compare `read_supply_page: {perUser:10, perOrg:40}` in `apps/web/lib/rate-limit.ts`, added in `dab37db` "to bound what the fetcher can be pointed at from a form".
- **Impact:**
  - Any member with write access can drive unbounded outbound requests from our egress IPs (scanning or harassing third-party sites under the HuntloopBot user agent, and getting the IPs blocklisted).
  - They can also burn function-seconds and memory with up to 4 MB per call, or with 30 s PDF parses.
- **Root cause:** The newer "Read the page" path received a limit. The older ingest path did not.
- **Fix (smallest):** Add `memory_ingest_url: {perUser: 30, perOrg: 120, windowSeconds: 3600}` and `memory_extract: {perUser: 30, perOrg: 120, windowSeconds: 3600}` to `LIMITS`. Call `limitRefusal(orgId, …)` inside `mutate` before `fetchPage`, and after `currentViewer` in the route. Pass `{maxBytes: 1_000_000, timeoutMs: 10_000}` to match the Exchange call.
- **Acceptance:** The 31st ingest in an hour returns the rate-limit refusal and no outbound request is made.
- **Test to add:** `memory/actions.test.ts` with a mocked `consumeRateLimit` returning denied. Assert `fetchPage` is never called.
- **Effort:** S

### [P2] PERF-001: The org layout, which runs on every workspace navigation, awaits four independent loaders in sequence
- **Confidence:** CONFIRMED (code). Latency impact LIKELY (not measured).
- **Where:** `apps/web/app/(app)/[org]/layout.tsx:33,40,54,61` (`resolveDataSource`, `currentViewer`, `getOnboardingState`, `getShellChrome`, each awaited in turn). The same pattern appears at `dashboard/page.tsx:124` (`getDefaultNeedsYou` after the big `Promise.all`), `opportunities/[id]/page.tsx:95,104` (`getNudge` then the timeline/intel batch) and `lib/data/outreach-log.ts:112-127` (a per-batch `await` loop).
- **Impact:** About 2–3 extra database round trips on every page view, stacked on the page's own waterfall.
- **Fix (smallest):** After `currentViewer`, run `const [onboarding, chrome] = await Promise.all([getOnboardingState(org), getShellChrome(org)])`. Fold `getDefaultNeedsYou` into the dashboard `Promise.all` and `getNudge` into the opportunity batch.
- **Acceptance:** A server timing log shows the layout cost as one round trip after membership. No behaviour change in e2e.
- **Test to add:** none (existing e2e covers rendering).
- **Effort:** S

### [P3] SEC-003: GitHub Actions are pinned by tag, and no workflow declares `permissions:`
- **Confidence:** CONFIRMED
- **Where:** `.github/workflows/ci.yml:18,20,94,96,120`, `migrate.yml:31,33` (`@v4` tags). No `permissions:` key in `ci.yml`, `migrate.yml` or `tick.yml`.
- **Impact:** `GITHUB_TOKEN` gets the repository default scope, which may be write-all on older repos (UNVERIFIED). A moved tag can change the code that runs next to `DATABASE_URL` in `migrate.yml`. All actions are first-party (`actions/*`), which lowers the risk.
- **Fix:** Add top-level `permissions: contents: read` to all three workflows. Pin `actions/checkout`, `setup-node` and `upload-artifact` to full SHAs with a version comment.
- **Acceptance:** `grep -L "permissions:" .github/workflows/*.yml` returns nothing.
- **Test to add:** an `audit.mjs` rule that fails when a workflow has no `permissions:` or a `uses:` without a 40-hex SHA.
- **Effort:** S

### [P3] SEC-004: `/api/csp-report` is an unauthenticated, unthrottled writer into Sentry with attacker-chosen fingerprints
- **Confidence:** CONFIRMED
- **Where:** `apps/web/app/api/csp-report/route.ts` (fingerprint `["csp", directive, blockedUri]`, both from the request body).
- **Impact:** Once Sentry is configured, anyone can create unlimited distinct issues, exhausting quota and burying real errors.
- **Fix:** Allow only known directive names (a fixed set of about 15). Fingerprint on the directive and the blocked URI's origin only. Sample 1 in 10 when the disposition is `report`.
- **Acceptance:** Posting 1000 reports with random `blocked-uri` yields at most about 15 fingerprints.
- **Test:** a unit test on the route handler with a mocked Sentry.
- **Effort:** S

### [P3] SEC-005: Committed dev build output in history, and `.next-verify` is not git-ignored
- **Confidence:** CONFIRMED
- **Where:** commit `edcc877` added 86 files under `apps/web/.next-verify/` (196k lines) and `15a0047` removed them. This includes `apps/web/.next-verify/dev/cache/.rscinfo`, which holds a dev-server server-action `encryption.key` (expired by its `expire_at`). `.gitignore:2` lists `.next/` only.
- **Impact:** Low. It was a dev-only key and has expired. The risk is a repeat that commits a production build manifest.
- **Fix:** Add `.next*/` to `.gitignore`. No history rewrite is needed.
- **Acceptance:** `git check-ignore apps/web/.next-verify/x` matches.
- **Effort:** S

### [P3] PROD-003: An empty `NEXT_PUBLIC_SITE_URL` silently becomes `http://localhost:3100`
- **Confidence:** CONFIRMED (code)
- **Where:** `apps/web/lib/site-url.ts` (`explicit ?? …`). `""` is not nullish, so `new URL("")` throws and the code falls back to localhost. `health/route.ts` uses `.trim() || null`, so health would report `siteUrl:null` while emails, Inngest registration and the sitemap use localhost.
- **Fix:** Use `process.env.NEXT_PUBLIC_SITE_URL?.trim() || undefined`. In production, throw or report instead of falling back to localhost.
- **Acceptance:** With `NEXT_PUBLIC_SITE_URL=""` and `VERCEL_PROJECT_PRODUCTION_URL=x.app`, `siteUrl()` returns `https://x.app`.
- **Test:** `site-url.test.ts`
- **Effort:** S

### [P3] SEC-006: Minor gaps in the private-range filter
- **Confidence:** LIKELY (theoretical; Vercel egress is mostly IPv4)
- **Where:** `packages/jobs/src/fetch.ts:93-142`. It does not cover `192.88.99.0/24` (6to4 relay), Teredo `2001::/32`, or `64:ff9b:1::/48`, where the IPv4 address is not always in the last 32 bits.
- **Fix:** Treat `2001:0000::/32` and the whole `64:ff9b:1::/48` as private, and add `192.88.99/24`.
- **Test:** add cases to `isPrivateAddress` in `verify-jobs.ts`.
- **Effort:** S

### [P3] SEC-007: The Resend error body is logged verbatim
- **Confidence:** LIKELY
- **Where:** `packages/jobs/src/email/resend.ts:87` (`console.error(... ${detail.slice(0,500)})`). Resend validation errors echo the `to` address, so the recipient's email can end up in Vercel logs.
- **Fix:** Log status plus `name`/`statusCode` only.
- **Effort:** S

### [P3] DEBT-001: Debt inventory
- **Confidence:** CONFIRMED
- `TODO|FIXME|HACK`: **0**.
- `@ts-ignore|@ts-expect-error`: **0**.
- `as unknown as`: **23**. Hot spots:
  - `apps/web/lib/data/exchange.ts` (5)
  - `lib/data/opportunities.ts` (4)
  - `packages/jobs/src/fetch.ts` (3)
  - `lib/data/onboarding.ts` (2)
- `eslint-disable`: **80**, of which 68 are `no-explicit-any`, 6 `no-control-regex` and 5 `jsx-a11y`. Hot spots:
  - `packages/jobs/src/mailbox/provider.ts` (5)
  - `handlers/advance-enrollments.ts` (5)
  - `lib/data/dashboard.ts` (4)
- `any`: **191**. Hot spots:
  - `packages/db/src/needs-you.ts` (14)
  - `lib/data/competitor-intel.ts` (13)
  - `lib/ai/workspace-context.ts` (12)
  - `lib/data/outreach.ts` (11)
  - `lib/data/learning.ts` (11)

  These are Supabase row types left untyped. Root fix: generate DB types (`supabase gen types`) and type `createTenantClient<Database>()`.
- **Dead or stale config:**
  - `.env.example` documents `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, which no code reads.
  - `packages/jobs/scripts/simulate.ts:24` sets `UNSUBSCRIBE_SECRET`, which nothing reads (the tokens are HKDF from the Supabase secret key).
  - `packages/crm/package.json` declares `@huntloop/db` but nothing imports it (UNVERIFIED for type-only use).
- **Effort:** M for the types, S for the rest.

### [P3] PERF-002: `listMemories` has no bound
- **Confidence:** CONFIRMED
- **Where:** `apps/web/lib/data/memory.ts:86-96`. It selects `content`, which can be up to 8,000 characters (`MAX_INGESTED_CHARS`), with no `.limit()`. PostgREST's default `max-rows` (1000) will also truncate silently. Other loaders with more selects than bounds: `learning.ts` (7/1), `outreach.ts` (3/0) and `team.ts` (4/1). Most of these are org-scoped, short lists or `.in(ids)` look-ups.
- **Fix:** `.limit(200)` plus "show more", or select `left(content, 400)` through a view.
- **Effort:** S

**Indexes:** the hot `activities` queries are covered by `(org_id, kind, occurred_at desc) where deleted_at is null` and related indexes (`0037_daily_loop.sql:155-170`). No missing index found on the paths sampled.

---

## Top 10 missing tests (one-line specs)

1. **Proxy in production mode.** Stub `VERCEL_ENV=production`. `/kitchen-sink` gives 404. Schema `partial` gives 503 with `x-huntloop-unavailable: migrations-pending` on `/x/dashboard` but 200 on `/api/health` and `/privacy`. The only proxy test today stubs `VERCEL_ENV=""` (`apps/web/lib/proxy-buyer-host.test.ts:7`).
2. **Memory ingest rate limit (after SEC-002).** A denied limit means `fetchPage` is never called. Today `ingestMemoryAction` has no test at all.
3. **`readSupplyPageAction` ordering.** A non-member gets fail with no fetch. A viewer gets fail. A denied limit means no fetch. `http://` is rejected. `FetchRefused` text is surfaced.
4. **`/api/health` `ok` truth table.** Each required piece missing flips `ok` to false and status to 503. No secret value appears in the body. No test exists today.
5. **Mailbox OAuth callback.** A state cookie mismatch, a missing cookie or a wrong provider means no token exchange, and the cookie is cleared on every path. No test exists today.
6. **`/api/jobs/tick` auth.** A missing secret gives 503. A wrong Bearer gives 404 with no `tick()` call. `limit` is clamped to 1–25.
7. **Inngest replay.** A body replayed inside the window with the same `t` is idempotent: a second `tick` claims no job twice. A `t` outside the window is refused.
8. **Exchange unsubscribe token.** It is a forged-signature or cross-org `ids` check alongside the digest-token tests in `verify-jobs.ts`.
9. **`discoverAction` (anonymous).** Path or query in the input never reaches the model URL (`https://${domain}/` only). Exhausted IP allowance means no `runTask`. `FREE_MAIL` is refused.
10. **`csp-report` route.** Oversized bodies (more than 8 KB) and non-JSON bodies get 204 with no Sentry call, and fingerprint cardinality is bounded (SEC-004).

Covered well already, so not listed: tenant isolation on PGlite (`verify-migrations.ts`, `verify-security-leads.ts`, `verify-exchange-security.ts`), send idempotency (`verify-jobs.ts:913-1070`, `sent_at` / OUT-001), AI budget (`lib/ai/budget.test.ts`), exchange quotas (`verify-migrations.ts`), SSRF and rebinding (`verify-jobs.ts:303`).

## What CI blocks

`ci.yml` gates on:
- typecheck
- lint, including `no-restricted-imports` on `@huntloop/db/admin` for `apps/**`
- `npm test`: migrations on PGlite, RLS, jobs and AI verify scripts, vitest
- `audit:site` (`scripts/audit.mjs`)
- `npm audit --audit-level=high`, which blocks on main only (`continue-on-error` on PRs)
- a build with empty credentials
- the bundle budget
- Playwright, both the demo run and the signed-in isolated backend run

It does not:
- scan for secrets (no gitleaks or trufflehog)
- run CodeQL or SAST
- run a production smoke check after deploy
- gate migrations (PROD-002) or the Vercel deploy on CI

## Env inventory

| Name | Req? | Behaviour when missing |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (legacy `…_ANON_KEY`) | **Required** | Demo or fixture mode. Production answers 503 for everything except `SERVED_WHILE_NOT_READY` and `/` (`proxy.ts:276-282`). |
| `SUPABASE_SECRET_KEY` (legacy `SUPABASE_SERVICE_ROLE_KEY`) | **Required** | Jobs, the queue, digest and exchange unsubscribe tokens and the public-research salt all fail. Health `ok:false`. |
| `CRON_SECRET` | **Required** (unless Inngest) | `/api/jobs/tick` gives 503 and nothing runs. Health `ok:false`. **Missing in production.** |
| `MAILBOX_ENCRYPTION_KEY` | **Required** | Mailbox connect is refused. Health `ok:false`. **Missing in production.** |
| `NEXT_PUBLIC_SITE_URL` | **Required** | Falls back to `VERCEL_PROJECT_PRODUCTION_URL`, then localhost. Health `ok:false`. An empty string goes to localhost (PROD-003). |
| `ANTHROPIC_API_KEY`, `HUNTLOOP_AI_TIMEOUT_MS` | Optional | AI screens return `live:false` or examples. |
| `APOLLO_API_KEY`, `ENRICHMENT_API_KEY`, `EMAIL_VERIFICATION_API_KEY` | Optional | The provider shows as unconfigured, and reach or enrichment are unavailable. |
| `GOOGLE_CLIENT_ID/SECRET`, `MICROSOFT_CLIENT_ID/SECRET` | Optional | That mailbox provider cannot be connected. |
| `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO`, `EXCHANGE_EMAIL_FROM` | Optional | Invites, digests and Exchange emails are not sent (`isEmailConfigured`). |
| `INNGEST_SIGNING_KEY`, `INNGEST_EVENT_KEY`, `INNGEST_ENV`, `INNGEST_BASE_URL`, `INNGEST_API_BASE_URL` | Optional | `/api/inngest` gives 404, and the engine relies on cron. |
| `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` | Optional (should be required in prod) | Errors and CSP reports are dropped. |
| `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` | Build-time, optional | No source-map upload. |
| `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST` | Optional | No analytics. |
| `CSP_ENFORCE` | Optional | The CSP is report-only (SEC-001). |
| `HUNTLOOP_EXCHANGE` | Optional | The Exchange is off unless set to `on`. |
| `HUNTLOOP_BUYER_HOST` | Optional | No buyer-domain routing. |
| `PUBLIC_RESEARCH_ENABLED`, `PUBLIC_RESEARCH_DAILY_LIMIT`, `PUBLIC_RESEARCH_SALT` | Optional | Anonymous `/discover` reading is off. The salt is HKDF-derived when unset. |
| `NEXT_PUBLIC_AUTH_GOOGLE`, `NEXT_PUBLIC_FEEDBACK_URL`, `NEXT_PUBLIC_HELP_URL` | Optional | Google sign-in button and links are hidden. |
| `NEXT_PUBLIC_HUNTLOOP_DEV_BYPASS` | Dev only | Ignored in production builds. |
| `DATABASE_URL`, `MIGRATIONS_BASELINE` | GitHub Actions (migrate) | `migrate.yml` fails red. |
| GitHub `CRON_SECRET` (secret), `HUNTLOOP_URL` and `ENGINE_DRIVER` (variables) | GitHub Actions (tick) | `tick.yml` fails red. |
| Platform: `VERCEL_ENV`, `NEXT_PUBLIC_VERCEL_ENV`, `VERCEL_GIT_COMMIT_SHA`, `VERCEL_REGION`, `VERCEL_PROJECT_PRODUCTION_URL`, `NODE_ENV`, `CI` | Auto | `VERCEL_ENV` decides production gating. |
| Stale: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (in `.env.example`, unused); `UNSUBSCRIBE_SECRET` (set in `simulate.ts`, unread) | — | — |
