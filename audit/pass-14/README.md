# Pass 14 — index

**Date** 2026-09-29 · **Commit audited** `509a24e` (main) · **Command** `/audit full` ([.claude/commands/audit.md](../../.claude/commands/audit.md))

| File | What it is |
|---|---|
| [00_SUMMARY.md](00_SUMMARY.md) | A–R summary, severity counts, root-cause groups, system health, top 10 |
| [areas/A_MAP_FLOW_TRUST.md](areas/A_MAP_FLOW_TRUST.md) | Feature and route map, the loop stage by stage, every score, trust classification, data-flow diagram |
| [areas/B_DB_SECURITY.md](areas/B_DB_SECURITY.md) | Table/RLS map, authZ matrix, service-role usage, security and DB findings |
| [areas/C_PROVIDERS_CRM_AI.md](areas/C_PROVIDERS_CRM_AI.md) | Provider matrix, HubSpot trace, every AI call, integration map |
| [areas/D_JOBS_OUTREACH_PROD.md](areas/D_JOBS_OUTREACH_PROD.md) | Job table, tick chain, send path, **env inventory** |
| [areas/E_PERF_UX_TESTS_DEBT.md](areas/E_PERF_UX_TESTS_DEBT.md) | Per-route cost, test inventory, dead/mock/bypass inventory |
| [areas/R_RUNTIME_PROD.md](areas/R_RUNTIME_PROD.md) | Mechanical checks, production probes, demo walk-through, Playwright |

**Method:** Phase 0 mechanical checks, then five parallel read-only static sweeps, then a runtime demo walk-through with Playwright and read-only production GETs, then Phase 3 verification of every Critical/High finding.

**Not verified:** queries against the production database (blocked during the audit), live vendor calls (no keys configured anywhere), and Vercel, Supabase and GitHub dashboard settings beyond `/api/health` and `gh`.
