## DR / backup / rollback

| Item | Documented | Reality |
|---|---|---|
| Backups | Supabase-provided and plan-dependent. The plan, backup type, retention and RPO table in `docs/OPERATIONS.md:245-250` is **empty** | `docs/OPERATIONS.md:24-25`: "A restore has never been rehearsed". `docs/security/privacy.md:139`: "Never rehearsed" |
| PITR | Undecided (`OPERATIONS.md:251-258`) | Unverified, dashboard |
| RPO / RTO | Not stated | — |
| Restore procedure | Written (`OPERATIONS.md:260-279`): stop the tick, restore in place, re-check migrations, rerun isolation | Never executed. The rehearsal checklist (`:280-285`) is all ☐ |
| App rollback | Vercel instant rollback (`deployment.md:112-117`) | Plausible. Older code against a newer schema relies on migrations staying additive, and nothing tests that |
| Migration rollback | Forward-only. "Additive by rule" (`migrations.md:124-135`) | Each file plus its ledger row is one transaction (`packages/db/scripts/migrate.ts:29,95`), so a failed file leaves nothing. A re-run applies nothing (ledger, tested by `verify-migrate.ts`, 9 cases) |
| Bad job batch | `cancel_job`/`retry_job` per job per org (`ops/actions.ts:36,64`) | No bulk cancel, no global pause (PROD-207) |
| Schema drift prod vs repo | `db:doctor` infers from objects; `schema_migrations` is the ledger | Configured DB: 0048–0050 MISSING; the 0006 cron is not visible (`db-doctor.log`) |

