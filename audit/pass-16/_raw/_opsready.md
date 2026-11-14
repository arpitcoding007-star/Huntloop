## Ops-readiness table

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

