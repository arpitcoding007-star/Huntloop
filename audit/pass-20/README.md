# Pass 20 — dashboard and panel wiring audit

- **Commit audited:** `32b0c6f5f4727e30eac755882f711df59c043a6c`, branch `feat/pass-19-debt`, clean working tree, 20 Nov 2026.
- **Numbering:** pass 18 is `docs/status/pass-18-status.md`, and pass 19 is the debt work on this branch, so this is pass 20.
- **Scope:** `/audit` with focus *dashboard and panels*: every panel under `apps/web/app/(app)/[org]/` (34 pages, 25 action files), the shell, `/orgs`, and the API routes those panels depend on. Areas covered: `map`, `flow`, `ux`, `trust` and `debt` as they apply to panels. Providers, DB-wide and production were checked only where a panel touches them.

| File | Contents |
|---|---|
| [00_SUMMARY.md](00_SUMMARY.md) | A–R, system health, top 10 |
| [01_SYSTEM_MAP.md](01_SYSTEM_MAP.md) | Request path, where the chain breaks, panel → table → producer |
| [02_FEATURES.md](02_FEATURES.md) | About 95 panel features with status |
| [03_FINDINGS.md](03_FINDINGS.md) | 59 findings (0 Critical, 9 High, 31 Medium, 19 Low) |
| [04_DIFF.md](04_DIFF.md) | Changes since pass 17 and the pass 18/19 debt claims |
| [05_ENV.md](05_ENV.md) | Env inventory, names only |
| [06_PLAN.md](06_PLAN.md) | P0–P3, ten mechanizable checks, the do-not-change list |

## Method
1. **Mechanical checks.** All passed:
   - `npm run typecheck`
   - `npm run lint`
   - `npm test`: web 354, ui 42, ai 243, crm 20, db 453 + 9 + 59 + 150, jobs 493, providers 109
   - `npm run audit:site`: 47 checks, 0 failing, 1 warning (LEGAL-01)
   - build (via Playwright)
   - `npm run audit:bundle`: 205.9 kB of 275 kB
2. **Static sweep.** Four parallel read-only agents traced UI → action → loader → table/RPC/job → UI, one group of panels each:
   - Command Center, Needs-you, Opportunities, Pipeline, shell
   - Companies, Competitors, Intelligence, Sources, Imports, Analyze, Demand
   - Outreach, Inbox, Assistant, Memory, Learn, Performance, Analytics
   - Settings, Team, Ops, endpoints
3. **Runtime** in demo mode (`huntloop-demo`, no database):
   - all 31 `/demo/*` routes return 200, with no console errors and no server errors;
   - Hunt now honestly refuses ("no database connected");
   - `npx playwright test`: 388 passed, 4 skipped.
4. **Verification.** I re-read every High against the code (callers, RLS, later migrations, triggers) before it went in. Two were downgraded to Medium: PANEL-313 and PANEL-204.
5. **Cross-check.** A repo-wide scan found no exported server action without a caller other than `unsnoozeAttentionAction`. Every shell nav href resolves to a page.

## Not verified, and what would settle it
- **Anything live.** Runtime ran in demo mode only, and demo branches don't prove live wiring. The findings rest on code and schema traces. A seeded staging Supabase project plus a test sign-in would let the panels be walked live, and would settle PANEL-107, 110, 208, 209, 311 and the PANEL-202 attach case.
- **PostgREST `max_rows`.** Settles PANEL-208, 109 and 311. Check Supabase → Settings → API → Max rows.
- **Production.** The only recorded production URL (`huntloop-web-mu.vercel.app`) returns `DEPLOYMENT_NOT_FOUND`, and the local `NEXT_PUBLIC_SITE_URL` is empty. Settling it needs the current production domain, or access to the Vercel project `huntloop-web` (deployments, domains, env) and the `HUNTLOOP_URL` GitHub variable. Then GET `/api/health`, which reports the commit, the latest migration and the queue.
- **Not run:** `db:doctor` and `check-queries.mjs`. The local env holds credentials for a real Supabase project. The audit is read-only, and pointing scripts at an unidentified project without your go-ahead was not justified.

## Fix status
| Finding | Status | How | Proof |
|---|---|---|---|
| PANEL-301 | Committed (`9c150ff`), not pushed | The engine parks with `CAMPAIGN_NOT_RUNNING` (`packages/jobs/src/enrollment-reasons.ts`, the same text as before, so rows parked by older builds are released too). `saveCampaignAction` re-activates exactly those rows when a save leaves the campaign active, and says how many | `verify-jobs.ts` "PANEL-301" block; `apps/web/lib/data/outreach-release.test.ts` |
| PANEL-302 | Committed (`9c150ff`), not pushed | Cadence, frequency cap, daily ceiling, an unreadable check, a missing unsubscribe URL, a missing postal address and email quota now `defer()` (`not_before` + `wait_reason`) and never write `error`. `contactAllowedAfter` picks the wake-up time. Suppressed, invalid address and unknown org stay terminal. New inbox action **Try again** (`retrySendAction`) releases rows already stranded: it clears `error`/`not_before` on approved, never-attempted messages only, and every check runs again | `verify-jobs.ts` (send_message blocks rewritten); `outreach-release.test.ts` |
| PANEL-303 | Committed (`9c150ff`), not pushed | `listThreads` selects `error`. The inbox shows **Not sent** with the reason in place of "Queued to send", plus Try again for members who can write | Typecheck; `/demo/inbox` renders without errors (the demo fixtures carry no not-sent message, so the new badge was not seen in a browser) |
| PANEL-401 | Fixed in code, not committed, **0057 not applied anywhere** | Migration `0057_icp_retires_discovery.sql`: `claim_due_discovery_queries` skips any query whose ICP is soft-deleted; a trigger disables an ICP's queries when it is removed; a backfill disables those already pointing at a removed ICP. `deleteIcpAction` refuses the active ICP on the server and stops its searches (for a database without 0057). `activateIcpAction` checks the target exists before clearing anything, checks the update hit a row, retires every other profile's search (`PROFILE_QUERY_NAME`), and says when the new ICP describes no search. `LATEST_MIGRATION` and `db:doctor` know 0057 | `verify-migrations.ts` "0057" block (6 checks); `apps/web/lib/data/icp-retire.test.ts` (6 cases) |
| PANEL-101 | Fixed in code, not committed | `askAgentAction` refuses a result whose `source` is not `"live"`, as `refreshWhyNowAction` already did, so the worked example is never stored in `conversation_messages` | Typecheck and lint. Not run against a live database with no AI key |
| PANEL-406 | Fixed in code, not committed | `draftRulesAction` refuses a non-live result, so template rules are never inserted as `origin: 'drafted'` | Typecheck and lint. Not run live |
| PANEL-102 | Fixed in code, not committed | `contactFitFor` selects `reason` (the 0016 column) instead of the missing `explanation`, so live contact fit and fit ordering work | Columns checked against `docs/spec/generated/schema-reference.md`. Not run live |
| PANEL-115 | Fixed in code, not committed | "Is it working?" reads `messages.scheduled_at` (set at approval by `approveMessageAction`) instead of the missing `approved_at`, and a failed drafts read now returns "unknown" instead of 0 | Same schema check. Not run live |

After these fixes: jobs 508/508, web 369/369, migrations 459/459, typecheck, lint and `audit:site` all pass (re-run 2026-11-23 after PANEL-101/406/102/115: typecheck, web 369/369, `audit:site` 47 checks, 0 failing).
