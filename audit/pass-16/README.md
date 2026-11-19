# Pass 16 — index

**Date** 2026-11-14 · **Commit audited** `7e09759` (`feat/pass-15-audit-fixes`, clean apart from the new command file) · **Command** `/audit-system full` (functional, backend and systems; no UI review)

**Counts:** Critical 1 · High 9 · Medium 38 · Low 26 (74). Start with [00_SUMMARY.md](00_SUMMARY.md).

| File | What it is |
|---|---|
| [CHECKLIST.md](CHECKLIST.md) | Every area and its state |
| [00_SUMMARY.md](00_SUMMARY.md) | Executive answers, maturity table, top 10 |
| [01_SYSTEM_MAP.md](01_SYSTEM_MAP.md) | Architecture, data flow, repo → DB → deploy drift, trust boundaries |
| [02_FLOWS.md](02_FLOWS.md) | Route/action inventory, flow tables, state machines, send safety chain |
| [03_FINDINGS.md](03_FINDINGS.md) | All findings by severity |
| [04_FEATURES.md](04_FEATURES.md) | Feature matrix and ops readiness |
| [05_VERIFICATION.md](05_VERIFICATION.md) | Tests run, verification by feature, 10 missing tests |
| [06_DB_AND_INVARIANTS.md](06_DB_AND_INVARIANTS.md) | Invariants, races, tables, functions, triggers |
| [07_SECURITY_PRIVACY.md](07_SECURITY_PRIVACY.md) | Confirmed vs needs-verification; lifecycle; provenance |
| [08_INTEGRATIONS_JOBS.md](08_INTEGRATIONS_JOBS.md) | Integration inventory, engine, AI tasks, jobs, queue, compliance claims, money |
| [09_OPS_AND_SCALE.md](09_OPS_AND_SCALE.md) | Deploy state and safe order, scale tiers, pipeline, observability, DR, perf |
| [10_MISSING_SYSTEMS.md](10_MISSING_SYSTEMS.md) | Missing systems, gaps, blind spots, manual-ops register |
| [11_DEBT.md](11_DEBT.md) | Debt register, simplify/remove, do-not-change |
| [12_ROADMAP.md](12_ROADMAP.md) | 7 phases and the HL-16xx backlog |
| [13_ENV.md](13_ENV.md) | Env inventory (names only) |
| [14_DIFF.md](14_DIFF.md) | Against pass 15 |
| [15_FIX_STATUS.md](15_FIX_STATUS.md) | What was fixed after the report, and how it was verified |
| `_raw/` | Reviewer reports A–E, disprove log, mechanical logs |

**Method.** In Phase 0, the lead ran the mechanical checks: typecheck, lint, all tests, site audit, build, bundle, `npm audit` and `db:doctor`. In Phase 1–2, five read-only reviewers worked in parallel: A flows/api/trust · B db/authz/lifecycle · C engine/providers/ai/crm · D jobs/outreach/money · E security/prod/perf/tests/debt. They used PGlite and fakes for probes, outside the repo. Phase 3 was a demo-mode walk, Playwright, and production GETs on `/api/health`. Phase 4 was a disprove pass on every Critical/High: one raised (OUT-201 → Critical), none dropped, and duplicates merged. The first set of reviewers stopped on an API spend limit before writing anything; they were restarted.

**Command deviations.** §6 of `audit-system.md` names the feature and verification matrices `02_FEATURES.md` and `08_VERIFICATION.md`. §7's file list names them `04_FEATURES.md` and `05_VERIFICATION.md`. This pass follows §7. Failure injection and load were not run (no safe harness), so every perf and scale number is labelled `not measured`.

## Not verified in this pass

| Item | Why | Exact access or action that settles it |
|---|---|---|
| DB-201 severity on real Supabase | No DB access | Read-only SQL on the configured project: `has_table_privilege('authenticated','public.suppressions','DELETE')`, same for `messages`, `opportunities` |
| DB-203 against PostgREST | No DB access | Apply 0049 to a staging Supabase, connect a test Gmail mailbox, read the PostgREST log for the upsert |
| OUT-201 end to end | No sends allowed | The verify-jobs case in HL-1601, or staging with a sandbox mailbox |
| Concurrency of 0050 lane/reserve and job claims | No two-connection Postgres | A disposable Postgres with 0001–0050 and two sessions (HL-1621) |
| Any live vendor (Apollo, Hunter, ZeroBounce, Anthropic, HubSpot, Gmail/Outlook) | No keys, no spend allowed | Owner runs `npm run live-check -- --spend`, a HubSpot test portal, a sandbox Workspace/M365 mailbox |
| Inngest protocol compatibility | Vendor tool | `npx inngest-cli dev` against a local build |
| `pg_cron` jobs (0006 prune, provider cache prune) | Dashboard | Supabase SQL editor: `select jobname, schedule, active from cron.job` |
| Backups, PITR, restore | Dashboard | Supabase → Database → Backups |
| Supabase Auth: Site URL, redirect URLs, JWT expiry, rate limits, CAPTCHA | Dashboard | Supabase → Authentication → URL Configuration / Settings / Attack Protection |
| Vercel topology, env per environment, Node version, deploy waits for checks | Dashboard | Vercel team `huntloop` → `huntloop-web` → Settings |
| Apex certificate and DNS | Dashboard | Vercel Domains + registrar DNS for `huntloop.pro` |
| GitHub: `CRON_SECRET`, `HUNTLOOP_URL`, `DATABASE_URL`; tick/migrate run history; branch protection; token permissions; repo visibility (JOB-204 severity) | Repo admin | GitHub → Settings → Secrets and variables / Branches / Actions → General |
| OAuth redirect URIs (Google, Entra) | Consoles | Google Cloud Console → Credentials; Entra → App registrations |
| Sentry project and alert rules | Not configured | Sentry org |
| Prod session cookie flags | Needs a signed-in prod session | Browser DevTools on www after PROD-001 |
| Inbox page on a 0047 DB (PROD-201 inbox half) | No non-demo run | Run the app against a DB at 0047 |
| All perf and scale numbers | Not measured | Seeded local DB, `EXPLAIN ANALYZE`, timed loaders (HL-1634) |
| History-wide `re_…` false-positive listing | The sandbox refused the extraction | Maintainer runs the `git log -p -G` command in `_raw/reviewer-E.md` §15 locally |
| Unread action modules: `welcome/company/*`, `draftIcpAction`, `recommendSourcesAction`, `runStageAction`, `lib/data/directory.ts`, `lib/data/onboarding.ts` writers | Time | Read them, or one non-member-slug refusal test per module |
