---
description: >-
  What the 19 Nov 2026 hardening pass changed, how each change was verified,
  and what is still open. Every result here comes from a command that was run.
---

# Pass 18: hardening status (19 Nov 2026)

> **Layer:** Internal · **Audience:** engineering, product · **Branch:** `feat/pass-15-audit-fixes`

## Scope

This pass did three things, in this order:

1. Verified and committed the uncommitted pass-15/16 work (migrations 0052,
   0053 and the code around them).
2. Fixed the pass-17 findings that were still open and could be fixed in code.
3. Wrote the [master system guide](../../HUNTLOOP_MASTER_SYSTEM_GUIDE.md) and
   the [Exchange demand-test kit](../product/exchange-demand-test.md).

Not in scope, by decision on 19 Nov 2026: **billing** (left for later, open
decision #1) and **any Exchange (buyer-side) code** (held until the demand test
passes).

## Commits

| Commit | What |
|---|---|
| `e75a1d4` | A11Y-301 contrast and labels; FLOW-301 first-name split |
| `16bdddc` | HL-1605/PROV-201 reserve a call's whole cost; PROV-301 reject unexpected 200s; 0052 also carries PERF-301 and SEC-302 |
| `d436477` | HL-1606 kill switch (0053) |
| `5c48ba0` | Readiness requires 0053; migration checks; schema reference |
| `8cf2acd` | Next.js 16.4.3 → 16.4.5 |
| *(this pass's final commits)* | 0054, why-now persistence, TRUST-301, PERF-302, ANL-301, UX-301, docs |

## Findings

| Finding | Status | How | Proof |
|---|---|---|---|
| **NEW: why-now never saved** | Fixed in code, ⚠️ not run against a live model | Nothing on the live path wrote `opportunities.why_now` (Analyze shows it but the save is sealed without it; no job writes it). New `refreshWhyNowAction` reads evidence from the database, runs `explain_why_now`, and saves the text with `why_now_written_at`. Only a live answer is saved; the unconfigured worked example is refused. Button: **Work out why now** on the opportunity page, for members who may spend AI. | `lib/data/why-now-action.test.ts` (5 cases: saves with date and org scope; refuses the worked example; saves nothing on a failed run; refuses another workspace's opportunity; refuses a malformed id). Browser check in demo mode: button renders, and the action answers "This deployment has no database connected". |
| TRUST-301 | Fixed | `why_now_written_at` (0054); the page shows "Written <date>"; `explain_why_now` and `qualify_opportunity` prompts forbid relative time (prompt versions change with the text); fixture and seed text no longer say "three days ago". | `verify-migrations.ts` 0054 block; typecheck; browser check |
| PERF-302 | Fixed (hot paths), ratchet added | 17 `*_fk_idx` indexes. The first draft reused names that already existed as `org_id`-leading composites, and `create index if not exists` skipped six of them silently; the probe caught it (131 instead of 125). A ratchet counts unindexed single-column FKs right after the migrations and fails above 125. | 0054 block: 17 indexes exist; "unindexed single-column FKs: 125 (ceiling 125)" |
| ANL-301 | Fixed (data), no screen yet | `org_activation` view, `security_invoker`: first warm opportunity, first send, first reply, first meeting, 30-day counts. | 0054 block: one row per workspace; a session sees only its own |
| UX-301 | Fixed | `/compare` and `/for` permanently redirect to `/`. | Browser: `/compare` lands on `/`; build lists both routes |
| SEO-302 | Won't fix, by design | `/discover` URLs carry company domains; `sitemap.ts` records why it stays out. | — |
| Next.js advisories | Fixed | 16.4.5. Both advisories concern `'use cache'` / `unstable_cache`, which the app does not use, but `next build` refused to run on the affected version. | Build passes |
| TEST-301 | Not reproduced | The two web tests that timed out under load in pass 17 passed in both full runs. | 301/301 web tests |
| DB-202 (rest) | Open | Five status columns still lack CHECK constraints. | — |
| JOB-301 | Open | Folds into JOB-202 fairness. | — |
| SEO-301 | Open, not code | TLS on the apex domain (PROD-001). | — |
| Sentry advisories | Open | `@sentry/nextjs` needs a major upgrade (11.x) to clear 5 moderate advisories. Its own change. | `npm audit` |

## Verification

Full `npm run verify` (typecheck, lint, every workspace's tests, site audit,
production build, bundle budget) **passed with exit 0** after the 0054 changes:

| Suite | Result |
|---|---|
| Web unit tests (vitest) | 301 / 301 in 31 files |
| UI tests | 42 / 42 in 6 files |
| Database migrations (PGlite) | 435 / 435, plus 9, 59 and 150 in the other db suites |
| Jobs | 485 / 485 |
| Providers | 101 / 101 |
| AI tasks | 243 / 243 |
| CRM | 20 / 20 |
| Site audit | 47 checks, 0 failing, 1 warning (`LEGAL-01`) |
| Build, bundle | Pass; 201.5 kB of 275 kB |

After that run, one small change moved the id check inside `mutate` in
`refreshWhyNowAction`; web tests (301/301) and the web typecheck were re-run
and pass.

**Not run:** Playwright e2e; anything against live vendors or hosted Supabase
(no keys or access on this machine).

## Deploy order

Apply **0048 → 0054** in order, then deploy. `LATEST_MIGRATION` is now `0054`,
so `/api/health` reports not-ready until 0054 is applied.
