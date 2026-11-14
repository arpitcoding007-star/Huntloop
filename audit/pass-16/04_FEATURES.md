# Pass 16 — feature matrix

Status vocabulary from §6: `Verified` (ran or tested) · `Implemented, unverified` · `Partial` · `Broken` · `Mock/Demo-only` · `Dead (built, not connected)` · `Planned, not built` · `Missing, recommended` · `Obsolete`. "Not live" means implemented in the repo, with its migration (0048–0050) not applied to the configured database.

## Rollup by core-loop stage

| Stage | Status | Blocking findings |
|---|---|---|
| Discover | Implemented, unverified (fakes; Apollo shapes never seen live) | ENG-201 (onboarding misreports), PROV-201 |
| Qualify / score | Implemented, unverified | AI-202, AI-204 |
| Enrich | Implemented, unverified | ENG-202, PROV-202, PROV-204 |
| Prioritize | Implemented, unverified | ENG-203 |
| Reach out | **Broken / blocked**: Free plan sends 0 (MONEY-201); stop does not stop (OUT-201); transient refusals strand (OUT-202); HEAD + configured DB stalls all sends (PROD-201); connect breaks once 0049 is applied (DB-203); production origin fails TLS (PROD-001) | OUT-201, OUT-202, PROD-201, DB-203, MONEY-201, PROD-001 |
| Track (replies, bounces, CRM) | Partial | OUT-208, CRM-201, CRM-202 |
| Learn | Implemented, unverified | AI-205 |
| Platform: tenancy/RLS | **Verified** (PGlite, 383 checks) | DB-201 (within-tenant) |
| Platform: jobs/queue | Implemented, unverified | JOB-202, JOB-203 |
| Platform: billing | Missing | MONEY-201 |

## Flows, API, trust (reviewer A)


| Feature | Status | Evidence / test |
|---|---|---|
| Route guard (`proxy.ts`) | Verified | `lib/protected-routes.test.ts`, `lib/safe-next.test.ts`, Playwright `e2e/routing.spec.ts` (demo) |
| Server-action guard `mutate` | Implemented, unverified (real DB) | no test runs `mutate` against RLS; RLS itself Verified in PGlite (`verify-migrations.ts` tenant isolation) |
| Magic-link / Google sign-in | Implemented, unverified | — |
| Invite / accept | Working (DB function) · Implemented, unverified (action + email) | `packages/db/scripts/verify-migrations.ts:606-673, 3341-3354` |
| Role change / removal | Implemented, unverified (owner trigger Verified) | verify-migrations owner-guard cases |
| Org create / switch | Implemented, unverified | `lib/data/destination.test.ts` |
| Org delete | Implemented, unverified | — |
| Onboarding / ICP | Implemented, unverified | `icp-step.test.ts` |
| Analyze → save (seal) | Implemented, unverified (seal Verified) | `seal.test.ts` |
| CSV import | Partial | FLOW-203, FLOW-204, FLOW-206 |
| Performance export | Implemented, unverified | `csv-write.test.ts` (escaping) |
| Outreach approve → send | Implemented, unverified | `verify-jobs.ts` (scripted fakes) |
| Unsubscribe (link + one-click) | Working (DB half) · Broken in prod (origin, FLOW-201) | `verify-migrations.ts:909-942` |
| Digest off-switch | Implemented, unverified | — |
| Mailbox connect | Broken once 0049 is applied (FLOW-200) · Implemented, unverified today | PGlite reproduction (this pass) |
| Mailbox disconnect | Implemented, unverified | same reproduction: update shape OK |
| HubSpot connect / disconnect | Implemented, unverified | crm tests (fakes) |
| Memory document extract | Implemented, unverified | `document-text.test.ts` |
| Public `/discover` | Implemented, unverified | — |
| Job tick route | Implemented, unverified (auth branch by reading) | local 404 explained in §1 |
| Inngest route | Dead (built, not connected) | API-204 |
| Share links | Missing (no requirement found in files read) | — |
| Password reset | Missing by design (passwordless) | — |
| Import undo / import history | Missing, recommended | §2.22 |
| Support recovery (locked out) | Missing, recommended | §2.22 |
| Provenance enforcement | Verified (DB constraints) · Partial (task-level grounding, TRUST-202/203) | verify-migrations evidence checks; ai tests |


## DB, authz, lifecycle (reviewer B)

| Feature | Status | Evidence / test |
|---|---|---|
| Tenant isolation (RLS on all tables, same-org FK triggers) | Verified | `verify-migrations.ts` cross-tenant + same-org blocks (lead: 383 pass); catalog review here |
| Role enforcement viewer/member/admin/owner | Verified (DB) | `verify-migrations.ts` role block; exceptions DB-201, AUTHZ-201 |
| Owner-role protection (grant/remove owner) | Verified | verify-migrations "an admin cannot make themselves owner…" |
| Last-owner protection | Partial | app-only, racy; DB permits (AUTHZ-201, repro) |
| Invite → accept | Implemented, unverified end-to-end | SQL verified (verify-migrations invitation block); magic-link round trip needs live Supabase Auth |
| Join request → approve | Implemented, unverified | SQL path verified in verify-migrations; no seats check (AUTHZ-202) |
| Seats plan limit | Broken | never binds (AUTHZ-202) |
| Magic-link login / signup | Implemented, unverified | vendor flow; enumeration-safe copy confirmed by reading |
| Google OAuth (PKCE) | Implemented, unverified | needs live provider config |
| Sign-out | Implemented, unverified | POST-only route read; no test found |
| Account deletion (`delete_own_account`) | Partial | sole-owner check has soft-delete bug; leaves user memories (AUTHZ-201, LIFE-203) |
| Workspace deletion | Partial | soft only; no purge/restore (LIFE-204); verify-migrations "the owner deletes the workspace" |
| Contact erasure (Settings → Data & privacy) | Partial | works for the tables it names (verify-migrations erasure block); misses 8 places (LIFE-201) |
| Contact export | Implemented, unverified (UI) / Verified (SQL) | verify-migrations export block |
| Workspace export | Partial | counts-only for evidence/messages/people/ai_runs, by design |
| `purge_contact_data` job | Dead (built, not connected) | no producer (`grep`) |
| `enforce_retention` (contact retention) | Implemented, unverified | jobs tests with fakes; no live driver; 50-org cap without cursor |
| Anonymous research purge | Dead (built, not connected) | `purge_expired_research` never called (LIFE-202) |
| pg_cron prunes (rate limits, provider cache) | Implemented, unverified | cron not visible to doctor |
| Soft-delete propagation (company → opps → outreach) | Implemented in repo, not live | 0049; bypassable by hard DELETE (DB-201) |
| Mailbox token column protection | Implemented in repo, not live; breaks connect | 0049; DB-203 |
| Mailbox safety-column guard | Implemented in repo, not live | 0049 trigger; verify-migrations warm-up test |
| Atomic provider spend / per-address lanes (DB side) | Implemented in repo, not live | 0050 (advisory lock; `on conflict` lane) |
| Migration runner with ledger | Implemented, unverified against real DB | `verify-migrate.ts` (lead: 9 pass) uses a fake executor |


## Engine, providers, AI, CRM (reviewer C)

| Feature | Status | Evidence |
|---|---|---|
| Provider seam (cache → budget → retries → ledger → cache) | Implemented, unverified (fakes only; vendors never called) | `call.ts`; verify-providers.ts |
| Atomic provider spend (0050) | Partial — code in repo, migration not applied | PROV-201 |
| Apollo adapter | Implemented, unverified (request shapes never seen live) | PROV-005 |
| Hunter / ZeroBounce adapters | Implemented, unverified | adapters |
| Provider breaker | Implemented, unverified; per-org | PROV-204 |
| Discovery (provider) | Implemented, unverified | discover-companies.ts; verify-jobs.ts |
| First-run onboarding stages | Broken (status reporting) | ENG-201 |
| Company enrichment | Implemented, unverified; refusal loop | ENG-202 |
| Person enrichment | Implemented, unverified | PROV-202 |
| Research (web_fetch) | Implemented, unverified | AI-204 |
| Qualify / score | Implemented, unverified (model output; parse tested) | AI-202 |
| Score recompute | Implemented, unverified | recompute-scores.ts |
| Entity resolution / site profile on every create | Partial (0050 trigger not live; discovery path only) | FLOW-106 |
| Org learning (analyze_performance) | Implemented, unverified; proposals only | analyze-performance.ts |
| Personal preferences | Implemented, unverified | AI-205 |
| AI run ledger / cost | Implemented, unverified | AI-201, AI-203 |
| AI budget | Partial (run count, fails open in jobs) | AI-201 |
| HubSpot connect (private-app token) | Implemented, unverified | integrations/actions.ts |
| HubSpot OAuth / token refresh | Missing (not needed for private-app tokens; not planned in code) | — |
| HubSpot push | Implemented, unverified; idempotency gap | CRM-201, CRM-202 |
| HubSpot inbound sync / webhooks / cursor | Missing | none in repo |
| Live check script | Implemented, unverified (not run, by rule) | ENG-204 |


## Jobs, outreach, money (reviewer D)

| Feature | Status | Evidence / why not higher |
|---|---|---|
| Job queue (enqueue, claim, retry, stall requeue, release) | Implemented, unverified | Traced; `verify-jobs.ts` runs runner/queue against a scripted client (`:587` JOB-010 etc.), SQL claim tested in PGlite migrations suite; no concurrent-claim test against real Postgres; not run in prod (prod tick 503) |
| Tick driver (GitHub Actions → `/api/jobs/tick`) | Implemented, unverified | Route fail-closed verified by reading; whether the repo has `CRON_SECRET`/`HUNTLOOP_URL` set is UNVERIFIED; prod `cronSecret:false` ⇒ not running |
| Inngest driver | Dead (built, not connected) | 404 without keys; protocol unverified |
| Sweepers / periodic work | Implemented, unverified | — |
| Dead letter / ops visibility | Partial | failed rows + ops board; no alerting (JOB-203) |
| Per-tenant fairness | Missing, recommended | JOB-202 |
| Draft → approve → send | Partial | Works in fake-backed tests; stranding (OUT-202), parent-state gap (OUT-201); blocked by Free plan (MONEY-201); blocked entirely in configured DB at HEAD (OUT-205) |
| At-most-once send | Verified (code path, fakes) | `verify-jobs.ts:1413-1488`; not vendor-verified |
| Suppression / unsubscribe gate at send | Verified (code path) | `verify-jobs.ts:1150`, `verify-migrations.ts:909-942,2210-2262` |
| One-click unsubscribe endpoint | Implemented, unverified | route traced; no route test found; e2e `routing.spec.ts` mentions unsubscribe (demo mode) |
| Reply detection stops sequence | Implemented, unverified | AI-009 + send-time hold; fail-open on read error (OUT-206) |
| Bounce handling | Partial | threaded DSNs only (OUT-208) |
| Complaint handling | Missing, recommended | OUT-208 |
| Per-mailbox daily cap | Verified (code path) | `verify-jobs.ts:1292-1340` |
| Warm-up ramp | Implemented, unverified — not live | 0048 missing |
| Domain readiness check | Implemented, unverified — not live | 0048 missing |
| Per-address send lane | Implemented, unverified — not live (and blocks all sends while missing) | 0050 |
| Removed-company stop | Implemented, unverified — not live | 0049 |
| Stop/pause propagation to queued mail | Missing, recommended | OUT-201 |
| Business-hours window | Implemented, unverified | partial coverage (OUT-209) |
| `max_contacts_per_company` | Dead (built, not connected) | OUT-204 |
| Emergency stop | Missing, recommended | OUT-207 |
| Billing / payments / plan change | Missing (decision open, `docs/status/roadmap.md:92`) | MONEY-201 |
| Plan quotas | Implemented, unverified | fail-open, count-based (MONEY-202) |
| Provider budget (atomic reserve) | Implemented, unverified — not live | 0050 |
| AI request-path rate limits | Implemented, unverified | `lib/rate-limit.ts` |


## Operations readiness (reviewer E)

| Capability | Status (§6 vocabulary) | Evidence |
|---|---|---|
| Engine heartbeat (`tick.yml`) | Implemented, unverified (GitHub `HUNTLOOP_URL` unset per domain doc; prod `cronSecret:false`) | `tick.yml` |
| Inngest driver | Dead (built, not connected); likely incompatible | SEC-202 |
| Vercel Cron driver | Obsolete (removed; docs still say committed) | PROD-203 |
| Migration pipeline | Implemented, unverified (never run; 0048–0050 missing) | `migrate.yml`, `db-doctor.log` |
| Readiness probe / health | Partial (stale probe, shallow) | PROD-201, OBS-202 |
| Error tracking | Implemented, not configured in prod | OBS-201 |
| Alerting | Partial (tick red only) | OBS-201 |
| Structured logging | Missing, recommended | OBS-201 |
| Backups / restore | Planned, not built (never rehearsed) | PROD-206 |
| App rollback | Implemented, unverified (Vercel) | `deployment.md:112` |
| Migration rollback | Forward-only by design | `migrations.md:124` |
| Kill switch | Missing, recommended | PROD-207 |
| Secret rotation | Missing, recommended | SEC-203 |
| CSP | Partial (report-only, blind) | SEC-201 |
| Rate limiting | Verified (unit and PGlite tests) | `rate-limit.test.ts`, `verify-migrations.ts:396` |
| SSRF guard | Verified (tests) | `verify-jobs.ts:254` |
| Dependency gate | Verified (CI step) | `ci.yml` |
| Domain / TLS | Broken | PROD-001 |
| Env inventory documented | Implemented (`docs/developer/environment-variables.md`); 3 dead names | DEBT-203 |

