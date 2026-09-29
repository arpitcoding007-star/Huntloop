# Pass 14 — full-system audit summary

**Date** 2026-09-29 · **Commit** `509a24e` (main) · **Method** `/audit full` (`.claude/commands/audit.md`): Phase 0 mechanical checks, five parallel read-only static sweeps, a runtime demo walk-through with Playwright, read-only production probes, and Phase 3 verification of the Critical/High findings. Full evidence for every finding is in [`areas/`](areas/).

**Not verified:** anything that needs a query against the production database (the auto-mode classifier blocked read-only PostgREST probes), live vendor calls (no keys exist anywhere), and Vercel, Supabase and GitHub dashboard settings beyond what `/api/health` and `gh` expose.

## A. What HuntLoop is today
A well-built multi-tenant Next.js 16 + Supabase monorepo with a Postgres job queue, a provider seam (Apollo/Hunter/ZeroBounce), HubSpot and Gmail/Outlook connectors, and about 12 AI tasks with an explicit fact/inference/unknown model. **In production it currently does nothing autonomously.** No model, provider, cron or encryption keys are set (`/api/health`), the tick workflow skips every run while reporting success, and the old personal-account deployment still serves stale code against the same database. The code also contains several defects that only show up against a live database and are hidden by demo fixtures: the dashboard enum, first-run ordering by a column that doesn't exist, and evidence upserts with no matching index.

## B–C. Architecture and features
See `areas/A_MAP_FLOW_TRUST.md` §1 (feature table, routes), §2 (loop by stage), §5 (mermaid data flow), and `areas/C_PROVIDERS_CRM_AI.md` §4 (integration map), `areas/D_JOBS_OUTREACH_PROD.md` §1–2 (jobs and tick chain), §4 (env inventory).

Feature status in short:
- **Working:** onboarding research, ICP drafting, first-run discovery and scoring, analyze-URL, scoring rules, learning proposals, and GDPR erase.
- **Partial:** scans, scheduled discovery, outreach, and reply sync (all waiting on the cron), CSV import (it dead-ends), and priority override (reverted by the next rescore).
- **Broken on a live database:** the Command Center, the first-run contacts and explain stages, and provider/hiring evidence writes.
- **Dead:** `enrich_person`, `resolve_entity`, `sync_hubspot`, `research_competitor`, `purge_contact_data`, and the audit-log reader.
- **Missing:** a "hunt now" control, next-best-action, merge review UI, billing, and a "what changed" feed.

## D–G. Severity counts (after verification)
| | Critical | High | Medium | Low |
|---|---|---|---|---|
| A map/flow/trust | 1 | 13 | 12 | 5 |
| B db/security | 0 | 6 | 9 | 11 |
| C providers/crm/ai | 0 | 9 | 16 | 5 |
| D jobs/outreach/prod | 1 | 5 | 15 | 8 |
| E perf/ux/tests/debt | 0 | 4 | 16 | 12 |
| R runtime/prod | 1 | 5 | 2 | 2 |

Several findings overlap across areas; the root-cause groups below are the de-duplicated view.

## H–I. Missing systems and broken connections (root causes)
1. **The engine has no working driver.** JOB-001, RT-004, RT-005: CRON_SECRET/HUNTLOOP_URL are unset, tick.yml exits 0, and Inngest isn't real.
2. **Jobs with no producer.** MAP-001, JOB-003, PROV-001, CRM-001, UX-002: enrichment, contacts, CRM sync, dedup and competitor research never run after onboarding.
3. **Live-database defects hidden by demo mode, with no DB-backed test.** FLOW-001, FLOW-002, TRUST-001, TEST-001.
4. **Provenance can be forged or blurred.** RT-001/RT-002/TRUST-007 (client-supplied verdicts saved as facts; the worked example is savable in production), AI-002, TRUST-002/003/004/006.
5. **Tenant-internal RLS is too permissive.** SEC-001 (job queue, global idempotency index), SEC-006 (definer function without an org check), PROV-009/SEC-007 (ledger, cache and provenance are member-writable), SEC-002 (admin can escalate to owner).
6. **Spend has no ceiling.** PROV-002, SEC-004, AI-001, AI-005: budget fails open, onboarding actions aren't rate-limited, and killed Opus runs are re-billed.
7. **Outreach safety gaps.** OUT-001 (double send), OUT-002, OUT-005, PROV-004 (unverified emails get sent), OUT-009 (legal identity PENDING).
8. **Delivery hygiene.** RT-006 (split-brain deployment), RT-007 (CI red for 5 pushes, no branch protection), DB-001 (0030 missing from the prod migration bundle).

## L–O. Headlines
- **Security:** no leaked secrets in the tree or git history. No cross-tenant *read* was found. Cross-tenant *write* exists via SEC-001 and SEC-006 (production grants UNVERIFIED). CSP is still report-only.
- **Performance:** unbounded opportunity list with an `IN(...)` evidence query (PERF-002); spend total capped at 500 rows (PERF-005); serial layout loaders (PERF-001).
- **UX:** HubSpot UI promises a push that doesn't exist (UX-002); a single root error boundary (UX-001); slug collisions with public routes (UX-005).
- **Product integrity:** the evidence component is strong, but the evidence behind a score is never shown (TRUST-002), AI prose isn't marked as inference (TRUST-003), and the worked example can become a saved "fact" (RT-001).

## P. Implementation order
- **P0 (security, integrity, production):**
  - RT-004 and RT-006: set production env vars and retire the duplicate Vercel projects (manual).
  - RT-001/RT-002: save from a server-held run only.
  - SEC-001, SEC-006, SEC-002.
  - FLOW-001, FLOW-002, TRUST-001.
  - OUT-001.
  - RT-007: turn CI green and add branch protection.
  - DB-001: add 0030 to the migration bundle.
- **P1 (core loop):**
  - JOB-001: make tick fail loudly when unconfigured.
  - Producers for enrich/rank/sync (MAP-001).
  - FLOW-003, FLOW-004/005, FLOW-007/008 (plus hunt now).
  - PROV-002/SEC-004 spend ceiling; AI-001 timeouts.
  - TEST-001: add a live-database test lane.
- **P2 (trust and UX):** TRUST-002/003/004/006, FLOW-009 (next-best-action), PERF-002/005, UX-001/002/005, OUT-002/003/005, CRM-002/004.
- **P3:** the Low-severity cleanup in each area file.

## Q. Do not change
Each area file ends with its own list. Across all of them:
- the provider seam (cache → budget → breaker → ledger);
- the append-only `opportunity_scores` with `rule_trace`;
- `assertValidClaim` and `EvidenceList`;
- the request-seam pattern instead of Server Actions enqueueing jobs;
- the discovery failure taxonomy;
- the `/api/health` production gate;
- `scripts/audit.mjs` as the place where findings become checks.

## R. Target architecture
Keep the architecture. What's missing is connections, not a redesign:
- one resolve-or-create path for companies;
- a request seam plus sweeper for every job;
- evidence keyed on a plain `source_key` constraint;
- verdicts persisted server-side;
- a read-only next-best-action composer over existing scores;
- a DB-backed CI lane.

## System health
- **Architecture:** sound and deliberate.
- **Product functionality:** the loop is complete in code but not connected at runtime.
- **Data integrity:** real risks from client-supplied verdicts and member-writable provenance tables.
- **Security:** no secret leaks, but two cross-tenant write paths and one privilege escalation.
- **Performance:** fine at demo scale, with unbounded queries that won't scale.
- **UX:** polished, with honest demo labelling, but UI still promises actions that don't exist.
- **Integrations:** none has ever been called live.
- **Production readiness:** not ready; it's configuration-blocked.
- **Maintainability:** high, though CI is currently red and unprotected.

## Top 10 to fix first
| # | Problem | Evidence | Impact | Depends on | Action |
|---|---|---|---|---|---|
| 1 | Production has no model, provider, cron or encryption keys | `/api/health` on www.seefluence.com | Nothing runs | Vercel team access | Set env vars, redeploy, confirm `ok:true` |
| 2 | Split-brain deployment on the prod database | huntloop-web-mu.vercel.app CSP and `/kitchen-sink` 200 | Stale code writes prod data | — | Delete the personal and failing projects |
| 3 | Worked example and client-supplied verdicts saved as fact | `qualify.ts:64`, `analyze/actions.ts:137-290` | Fabricated sourced facts | — | Save from a server-held run; hide Save for examples |
| 4 | Member-writable job queue with global idempotency | `0004:340`, `0008:295` | Cross-tenant engine DoS | — | Revoke member writes; scope the index by org |
| 5 | Definer function with no org check | `0022:137-226` | Cross-tenant evidence writes | — | Revoke from anon/authenticated; add a membership check |
| 6 | Dashboard filters on `status='new'` | `dashboard.ts:107,212`, `0003:14` | Landing page errors | — | Use real enum values; add a DB smoke test |
| 7 | First-run orders by a missing column; evidence upsert has no matching index | `first-run.ts:467,520`; `0020:91` | No contacts; no provider evidence | — | Fix the queries; add a plain `source_key` constraint |
| 8 | Messages can be sent twice | `send-message.ts:273-316` | Duplicate outreach | — | Claim before send; check the update |
| 9 | Admin can escalate to owner | `team/actions.ts:46-107` | Owner lockout | — | Only owners may grant or revoke owner |
| 10 | CI red on main, no branch protection; tick reports green while idle | gh runs; `tick.yml:46-49` | Regressions ship; false heartbeat | — | Fix 2 E2E specs, protect main, fail the tick when unconfigured |
