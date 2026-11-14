# Pass 16 — missing systems, functional gaps, blind spots

## Missing systems

| System | State | Consequence | Finding |
|---|---|---|---|
| Billing / plan change | Missing. No writer of `organizations.plan_id`; default Free plan has `emails: 0` | Reach Out is unusable for every self-serve workspace until someone runs SQL | MONEY-201 |
| Kill switch (global and per org) for sends, AI and provider spend | Missing | The only emergency stop is unsetting `CRON_SECRET`, which halts every job | PROD-207 |
| Send-time eligibility from parent state | Missing | Stop, pause, archive, won/lost and org delete do not stop queued mail | OUT-201 |
| Deploy ↔ migrate coupling | Missing | HEAD on a 0047 database stalls every send while health stays green | PROD-201, PROD-202 |
| Structured logging + job-failure alerting | Missing | A failed job is visible only in `/ops`, per org, if someone looks | OBS-201, JOB-203 |
| Deep health (tick recency, lag, failures, migration ledger) | Partial | Health says "complete" on a DB missing three migrations | OBS-202, PROD-201 |
| Cross-tenant operator view; `audit_logs` reader | Missing | Triage requires SQL | OBS-203 |
| Per-tenant queue fairness | Missing | One org's backlog delays every other org | JOB-202 |
| Complaint handling; unthreaded bounce parsing | Missing | Complaints never suppress; some bounces never suppress | OUT-208 |
| Workspace purge and restore | Missing | Deleted workspaces are soft-deleted forever | LIFE-204 |
| Complete erasure | Partial | Address and PII stay in eight places | LIFE-201 |
| Key rotation procedure | Missing | The service key is the HKDF root for three other secrets | SEC-203 |
| Backup restore rehearsal; RPO/RTO; PITR decision | Planned, not built | Recovery is untested | PROD-206 |
| Concurrency tests on real Postgres | Missing | Lane, reserve and claim guarantees are proven only sequentially | TEST-202 |
| Route-handler and production-proxy tests | Missing | Cron auth, OAuth callback and the 503 page are untested | TEST-201 |
| Generated DB types | Missing | `types.ts` is hand-written, the root of 195 `any`s | DEBT-202 |
| Billing-grade cost ceiling (currency, not run counts) | Missing | AI spend is capped by run count; failed billed runs are uncounted | AI-201 |

## Functional gaps inside existing features

| Feature | Gap | Finding |
|---|---|---|
| Onboarding first run | Reports counts and "done" for work that did not happen | ENG-201 |
| First run scoring | Up to ten Opus calls inside one 60 s request | ENG-203 |
| Transient send refusals | Stranded permanently after three job attempts | OUT-202 |
| Crash after send claim | Re-enqueued forever, never shown as "delivery unknown" | OUT-203 |
| `max_contacts_per_company` | Documented, enforced nowhere | OUT-204 |
| Seats limit | Reads a counter nothing writes | AUTHZ-202 |
| Last-owner rule | App-only, racy | AUTHZ-201 |
| CSV import | A removed or merged domain fails the whole file; not atomic | FLOW-203, FLOW-204 |
| HubSpot push | Duplicate deals on retry; overwrites fields; ignores removal and erasure | CRM-201, CRM-202, CRM-203 |
| Enrichment | Refusals re-enqueue every tick; bad verdicts can be overwritten by "unknown" | ENG-202, PROV-202 |
| Score provenance | No model id, no observation ids | AI-202 |
| CSP enforcement gate | Blind: Chromium reports dropped, Sentry off | SEC-201 |

## Blind spots (could not be checked in this pass)

Each item says exactly what would settle it in `README.md` § "Not verified in this pass". The largest ones:

1. **Nothing has run against hosted Supabase, a real mailbox or a real vendor.** Every green suite uses PGlite or fakes.
2. **Concurrency has not been measured.** No two-connection Postgres harness exists.
3. **Load and perf numbers do not exist.** Every scale-tier row is `not measured`.
4. **Dashboard state is unread:** Vercel env and topology, Supabase backups and Auth settings, GitHub secrets and branch protection, OAuth consoles, Sentry.

## Manual-operations register

Every on-call action that today needs a dashboard, manual SQL or a person outside the app (source: reviewer E §10, `_raw/_manualops.md`). M1, M3, M4 and M12 block a live run.

| # | Action | How today | Who / access | Risk |
|---|---|---|---|---|
| M1 | **Apply 0048, 0049, 0050** to the configured DB | Run `migrate.yml` by `workflow_dispatch` with `MIGRATIONS_BASELINE=0047` (`first-live-run.md:30-45`), or paste into the Supabase SQL editor (`migrations.md:59`, doctor output). The docs disagree. Not automatic, because the push trigger fires only on `main` and these sit on the branch | GitHub admin (secret) or Supabase SQL editor | Until applied, every pass-15 fix in 0048–0050 is not live. Deploying HEAD first stalls sends (PROD-201) |
| M2 | Confirm the 0006 `pg_cron` prune schedule | `select * from cron.job` in the SQL editor (`db-doctor.log`) | Supabase SQL editor | Retention or prune silently not running |
| M3 | Set prod env (`CRON_SECRET`, `MAILBOX_ENCRYPTION_KEY`, provider and AI keys, Sentry) | Vercel → Settings → Environment Variables, then redeploy | Team `huntloop` owner | Engine is dead in prod (health) |
| M4 | Fix the apex TLS, or switch `NEXT_PUBLIC_SITE_URL` to www | Vercel Domains + GoDaddy DNS | Team owner + registrar | PROD-001 |
| M5 | Register OAuth redirect URIs (Google, Entra) and Supabase Site/Redirect URLs | Three dashboards (domain doc §D) | Each console owner | OAuth mismatch |
| M6 | Set GitHub `CRON_SECRET` secret and `HUNTLOOP_URL` variable; `DATABASE_URL` | Repo settings | Repo admin | No heartbeat or migrations |
| M7 | Stop all sending / AI / provider spend in an emergency | No switch. Unset `CRON_SECRET` (halts **all** jobs) and redeploy, or disable `tick.yml`, or SQL `update` on `job_executions`/`messages` | Vercel/GitHub admin, or SQL | PROD-207 |
| M8 | Cross-tenant triage (which org's jobs are failing, dead letters across orgs) | SQL on `job_executions`; `/ops` shows only orgs you belong to | Supabase SQL editor | OBS-203 |
| M9 | Bulk-cancel a bad job batch | Per job `cancel_job` in `/ops`, or SQL | Org admin or SQL | — |
| M10 | Restore from backup | Supabase dashboard; procedure `OPERATIONS.md:260-279`; never rehearsed | Supabase owner | PROD-206 |
| M11 | Rotate any key | No procedure. Encryption-key rotation forces reconnects; service-key rotation breaks digest links, seals and IP hashes | Vercel + Supabase | SEC-203 |
| M12 | Grant a plan, quota or provider credit limit to an org | No billing. `provider_accounts.monthly_credit_limit` and plan rows are set by SQL or seed (`verify-migrations.ts:1739` shows the shape) | SQL editor | Spend controls depend on hand-set rows (money detail: reviewer D) |
| M13 | Read the audit trail | SQL on `audit_logs` (no reader) | SQL editor | — |
| M14 | Clean up the duplicate Vercel projects | Dashboard (`deployment.md:86-94`) | Both team owners | Split-brain deploys |
| M15 | Enforce CSP | Set `CSP_ENFORCE=true` and redeploy, after reports that cannot arrive (SEC-201) | Vercel | — |

