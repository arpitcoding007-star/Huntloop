## Manual-operations register

Every on-call action that today needs a dashboard, manual SQL, or a human outside the app:

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

