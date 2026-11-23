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
| PANEL-301 | Merged to `main` (PR #7) | The engine parks with `CAMPAIGN_NOT_RUNNING` (`packages/jobs/src/enrollment-reasons.ts`, the same text as before, so rows parked by older builds are released too). `saveCampaignAction` re-activates exactly those rows when a save leaves the campaign active, and says how many | `verify-jobs.ts` "PANEL-301" block; `apps/web/lib/data/outreach-release.test.ts` |
| PANEL-302 | Merged to `main` (PR #7) | Cadence, frequency cap, daily ceiling, an unreadable check, a missing unsubscribe URL, a missing postal address and email quota now `defer()` (`not_before` + `wait_reason`) and never write `error`. `contactAllowedAfter` picks the wake-up time. Suppressed, invalid address and unknown org stay terminal. New inbox action **Try again** (`retrySendAction`) releases rows already stranded: it clears `error`/`not_before` on approved, never-attempted messages only, and every check runs again | `verify-jobs.ts` (send_message blocks rewritten); `outreach-release.test.ts` |
| PANEL-303 | Merged to `main` (PR #7) | `listThreads` selects `error`. The inbox shows **Not sent** with the reason in place of "Queued to send", plus Try again for members who can write | Typecheck; `/demo/inbox` renders without errors (the demo fixtures carry no not-sent message, so the new badge was not seen in a browser) |
| PANEL-401 | Merged to `main` (PR #7); 0057 applied to production 2026-11-23 | Migration `0057_icp_retires_discovery.sql`: `claim_due_discovery_queries` skips any query whose ICP is soft-deleted; a trigger disables an ICP's queries when it is removed; a backfill disables those already pointing at a removed ICP. `deleteIcpAction` refuses the active ICP on the server and stops its searches (for a database without 0057). `activateIcpAction` checks the target exists before clearing anything, checks the update hit a row, retires every other profile's search (`PROFILE_QUERY_NAME`), and says when the new ICP describes no search. `LATEST_MIGRATION` and `db:doctor` know 0057 | `verify-migrations.ts` "0057" block (6 checks); `apps/web/lib/data/icp-retire.test.ts` (6 cases) |
| PANEL-101 | Merged to `main` (PR #7) | `askAgentAction` refuses a result whose `source` is not `"live"`, as `refreshWhyNowAction` already did, so the worked example is never stored in `conversation_messages` | Typecheck and lint. Not run against a live database with no AI key |
| PANEL-406 | Merged to `main` (PR #7) | `draftRulesAction` refuses a non-live result, so template rules are never inserted as `origin: 'drafted'` | Typecheck and lint. Not run live |
| PANEL-102 | Merged to `main` (PR #7) | `contactFitFor` selects `reason` (the 0016 column) instead of the missing `explanation`, so live contact fit and fit ordering work | Columns checked against `docs/spec/generated/schema-reference.md`. Not run live |
| PANEL-115 | Merged to `main` (PR #7) | "Is it working?" reads `messages.scheduled_at` (set at approval by `approveMessageAction`) instead of the missing `approved_at`, and a failed drafts read now returns "unknown" instead of 0 | Same schema check. Not run live |
| PANEL-201 | Fixed on `feat/pass-20-p1`, not committed | Competitor links: `company-intel.ts` selects `claim_kind`/`confidence` and the brief renders `ClaimBadge` from them (unknown without evidence), so a phrase match reads as an inference. Demand board: `demand.ts` selects `claim_kind`; a paraphrased statement loses its quote marks and says "paraphrased from" | Typecheck. Not seen in a browser (demo fixtures carry no competitor links or demand statements) |
| PANEL-103 | Fixed on `feat/pass-20-p1`, not committed | Needs-you shows "Why now" with an inference badge and the `why_now_written_at` date. The opportunity page's outreach angle carries an inference badge, or says none was written | Typecheck. Not seen in a browser |
| PANEL-210 | Fixed on `feat/pass-20-p1`, not committed | The Competitors list inner-joins `companies` and skips removed ones, and reads "seen using them" instead of "use them" | Typecheck |
| PANEL-207 | Fixed on `feat/pass-20-p1`, not committed | "Seen in N sources" counts distinct `source_id`, or host when there is none, not distinct URLs (`sightingsOf` in `opportunity-map.ts`; the loader selects the citation rows) | `opportunity-map.test.ts` "counts distinct sources" |
| PANEL-212 | Fixed on `feat/pass-20-p1`, not committed | Intelligence evidence rows say which company they are about, with a link (company subjects directly, opportunity subjects through their company). `EvidenceList` gained optional `subject`/`subjectHref` | Typecheck |
| PANEL-202 | Fixed on `feat/pass-20-p1`, not committed | Analyze "Save" uses `resolveOrInsertCompany` (new `lib/data/company-resolve.ts`): an existing company keeps its name and `discovered_via`, a merged domain resolves to its survivor, a removed one is restored. The opportunity is updated, not upserted: scoring fields always, priority only when `priority_set_by` is not `user`; a removed opportunity is restored | `company-resolve.test.ts` (6 cases). The action itself is not unit-tested |
| PANEL-203 | Fixed on `feat/pass-20-p1`, not committed | CSV import resolves every domain including removed and merged rows (`resolveExistingCompanies`), restores removed ones, attaches people to merge survivors, and inserts the rest with `ignoreDuplicates`. Restored rows count as added | `company-resolve.test.ts` |
| PANEL-211 | Fixed on `feat/pass-20-p1`, not committed | `scan_source` follows `merged_into_id` to the live survivor, and files no evidence on a removed company (it does not restore it) | Jobs 508/508. No new scan test |
| PANEL-313 | Fixed on `feat/pass-20-p1`, not committed, **0058 not applied anywhere** | Migration `0058_activation_counts_real_replies.sql`: `org_activation` takes `first_reply_at`/`replies_30d` from `outcomes` of kind `reply`/`positive`, and `drafts_rejected_30d` filters on `ai_generated`. `LATEST_MIGRATION` and `db:doctor` know 0058 | `verify-migrations.ts` "0058" block (3 checks) |
| C1 | Added on `feat/pass-20-p1` | `scripts/audit.mjs` DATA-C1 (fail): every literal `.from("t").select("…")` and jobs `.select("t", "…")` is resolved against the generated schema reference, including embedded tables. It found one more bug, now fixed: `analyze_performance` read `source_events.source_id`, which does not exist, so learning provenance was always empty | Run against the pre-fix commit `06dfa61`, it reports PANEL-102, PANEL-115 and the `source_events` bug |

After these fixes: jobs 508/508, web 369/369, migrations 459/459, typecheck, lint and `audit:site` all pass (re-run 2026-11-23 after PANEL-101/406/102/115: typecheck, web 369/369, `audit:site` 47 checks, 0 failing).
