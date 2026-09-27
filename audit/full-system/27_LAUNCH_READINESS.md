# Launch readiness

HuntLoop is **not** production-ready today. Below is what "ready" means, gate by gate, with the current verdict.

Legend: ✅ pass · 🟡 partial · 🔴 fail

---

## Gate 1 — Authentication & tenancy ✅

- [x] Magic link + Google OAuth working
- [x] Route guard, 404-not-403 on non-membership
- [x] RLS on every `org_id` table, proven by a non-superuser test
- [x] Roles enforced in Postgres, not only in the app
- [x] Service-role client confined to 5 named files, checked in CI

**Verdict: pass.** The strongest area of the product.

## Gate 2 — Onboarding ✅

- [x] Every step persists (`saveYou`, `createWorkspace`, `saveGoals`, `saveIcp`, `saveSources`, `finishOnboarding`)
- [x] Resumable (`0024`)
- [x] Every answer has a downstream consumer — verified in `04_ONBOARDING_AUDIT.md`
- [ ] First-run verified against live models 🟡

## Gate 3 — Discovery 🔴

- [x] Provider search, resumable, cost-capped
- [x] ICP → filter translation with unmappable criteria reported
- [ ] **Runs on a schedule** 🔴 (cron never configured)
- [ ] **Can be started by a user** 🔴 (no in-app trigger)
- [ ] Verified against live Apollo 🔴

## Gate 4 — Enrichment 🔴

- [x] Company enrichment writes sourced evidence
- [x] Cache, budget, breaker, ledger
- [ ] **Person enrichment reachable** 🔴 (`enrich_person` unenqueued)
- [ ] Provider fallback 🔴 (one adapter per capability)
- [ ] Verified live 🔴

## Gate 5 — Qualification 🟡

- [x] 8-dimension explainable score, no invented weights
- [x] Rule layer with trace
- [x] Contact-fit ranking drives the buyer list
- [ ] Recomputation runs on a schedule 🔴 (cron)
- [ ] Verified against live models 🔴

## Gate 6 — Opportunity management ✅

- [x] List, detail, filters, priority, evidence, owner, status
- [x] Deep links, honest empty states

## Gate 7 — Outreach & CRM 🔴

- [x] Campaigns, sequences, autonomy ladder, suppression, unsubscribe
- [x] Idempotent send with proof (`sent_at` + provider id)
- [ ] **Sends/advances on a schedule** 🔴 (cron)
- [ ] **CRM push has a trigger** 🔴
- [ ] `emails` quota enforced 🔴
- [ ] Verified live 🔴

## Gate 8 — Signals 🟡

- [x] Hiring signals become cited evidence
- [ ] Fetched on a schedule 🔴 (cron)
- [ ] Signal → recommended action 🔴

## Gate 9 — Learning 🟡

- [x] Schema, jobs and screen exist
- [ ] Outcome volume to learn from 🔴 (gated on gates 3/7)
- [ ] User corrections captured 🔴

## Gate 10 — Data quality 🔴

- [x] Domain canonicalisation, `external_ids`, merge machinery
- [ ] **Resolution actually runs** 🔴 — the defining failure of this gate
- [ ] Merge review UI 🔴

## Gate 11 — Security 🔴

- [x] Security headers, nonce CSP, input validation on every Server Action
- [x] Credentials encrypted at rest (mailbox + CRM)
- [x] Rate limiting per user *and* per org
- [x] SSRF guard on source fetching
- [ ] CSP enforced rather than report-only 🟡
- [ ] **Dependency advisories clean** 🔴 — **see below, this is a launch blocker**

### 🔴 Critical: unpatched RCE in the pinned Next.js range

`npm audit --audit-level=high` **exits 1 today**, which means the CI step "Audit — dependency advisories" (`.github/workflows/ci.yml`) is currently failing:

```
next  16.0.0 - 16.3.2     Severity: critical
  Unauthenticated Remote Code Execution on windows-hosted servers   GHSA-p293-qw3h-jr36
  Unauthenticated RCE in the Image Optimization API (AVIF)          GHSA-2xp9-vwfh-vxw4
sharp <0.35.4             Severity: high
  libheif vulnerabilities                                           GHSA-rgj7-g3m4-5g8c
6 vulnerabilities (2 moderate, 3 high, 1 critical)
```

`apps/web/package.json` pins `next: ^16.3.1`, which sits inside the vulnerable range. The repo's previous audit pass (`SEC-07`) cleared Next advisories at 16.3.1 — these are **newer CVEs published since**, so this is drift, not a regression in judgement.

`npm audit fix` reports a non-breaking fix is available. It was deliberately **not applied during this audit** (audit first, change second), but nothing should deploy until it is, and the fix must be followed by the full `npm run verify` before it is trusted.

## Gate 12 — Compliance 🔴

- [x] Suppression, unsubscribe, retention policy SQL
- [ ] **Erasure triggerable** 🔴
- [ ] Data export 🔴
- [ ] Legal review of enrichment lawful basis 🔴 (see `26` Phase 2; needs counsel, not code)

## Gate 13 — Migrations ✅

- [x] 28 migrations apply cleanly from empty on PGlite, 236 assertions
- [x] `db:doctor` detects a partially-applied schema
- [ ] Applied to the production project ❓ (manual step — see `28_MANUAL_ACTIONS_REQUIRED.md`)

## Gate 14 — Monitoring & error handling 🟡

- [x] Sentry (server, edge, client), PostHog, structured job ledger, `/ops` health
- [x] Error boundaries, 404/500 pages
- [ ] Dead-letter surface 🔴
- [ ] Alerting on repeated job failure 🔴

## Gate 15 — Tests ✅

- [x] 236 migration/RLS · 121 pure · 59 rules · 199 jobs · 81 providers · 20 CRM · 22 UI · 108 web unit · 68 Playwright
- [x] CI runs all of it plus audit, `npm audit`, build, bundle budget
- [ ] A test that would fail if a job stopped being reachable 🔴 — *this audit's central finding had no test that could catch it*

## Gate 16 — Performance 🟡

- [x] Bundle budget enforced (245 kB of 275 kB)
- [x] `next/link` throughout, server-side analytics
- [ ] Load test 🔴
- [ ] N+1 review of the opportunity detail query ❓

## Gate 17 — Responsive & accessible ✅

- [x] Mobile drawer, keyboard dismissal, skip link, no colour-only meaning
- [x] Desktop + mobile Playwright runs

## Gate 18 — Deployment 🟡

- [x] Vercel settings documented; monorepo root directory documented
- [x] Cron now defined
- [ ] Deployed with cron + secrets and observed running 🔴
- [ ] Rollback procedure documented 🔴

---

## Summary

| Gate | Status |
|---|---|
| Auth & tenancy, onboarding, opportunities, migrations, tests, responsive | ✅ 6 |
| Qualification, signals, learning, security, monitoring, performance, deployment | 🟡 7 |
| Discovery, enrichment, outreach/CRM, data quality, compliance | 🔴 5 |

**Nothing in the red column is a design problem.** Every one of them is either a missing trigger or an unverified vendor call. That is the whole distance between here and a launchable product.
