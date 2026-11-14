# Pass 17 — audit plan

**Purpose.** Pass 16 (`/audit-system`) covered behaviour and backend at the code level. This pass audits everything it left open, using what this machine can run. It finishes with the list of items that only the owner's access can settle.

**Baseline.** `69c8d4c` (`feat/pass-15-audit-fixes`), plus the uncommitted HL-1604 work (migration 0051). Date 2026-11-14.

**Rules.** These are the rules of `.claude/commands/audit.md` and `audit-system.md`:
- Read-only on code, config and data. Report files go only under `audit/pass-17/`, and probe scripts only in the session scratchpad.
- Production is GET-only on `/api/health` and public pages. No sends, provider calls, migrations or sign-ins.
- Every finding carries evidence and a confidence label. Demo mode proves nothing about the backend.

**Environment limits (stated up front).**
- No Postgres server, no Docker, no `psql`. Database work runs on PGlite, which is in-process and has **one connection**, so true concurrent interleavings cannot be produced here.
- There are no provider, AI or mailbox keys.
- The UI is observed through the demo workspace (`huntloop-demo`, fixtures) in the built-in browser.

---

## Workstreams

| # | Workstream | What is checked | Method | Output |
|---|---|---|---|---|
| W1 | **Frontend, UX, design system** | First-use clarity, primary/secondary actions, empty/loading/error/success states, dead UI (looks like it works, does nothing), responsive layout at 375 px, light/dark parity, token use vs one-off styles, provenance on decision surfaces | Static read of `apps/web/app/**` and `packages/ui/src`; demo walk of every org page at desktop and mobile widths, both themes; console and network capture | `01_UX.md` |
| W2 | **Accessibility** | WCAG 2.1 A/AA floor on every distinct page (not just the 5 in `e2e/a11y.spec.ts`), keyboard path through the core loop, focus visibility, dialog focus trap and Escape, labels, reduced motion, touch targets, announced errors | axe-core injected per demo page from the browser pane; keyboard walk; read of `e2e/a11y.spec.ts` coverage; `npx playwright test e2e/a11y.spec.ts` | `02_A11Y.md` |
| W3 | **SEO (technical) and analytics** | `robots.ts`, `sitemap.ts`, metadata, canonical, OG, indexability of app vs marketing vs legal pages, prod headers. Analytics: what exists (`lib/analytics.ts`), consent, what a measurement plan needs | Code read; local and prod GET of `/robots.txt`, `/sitemap.xml`, `/` | `03_SEO_ANALYTICS.md` |
| W4 | **Unread backend modules** | `welcome/company/*`, `draftIcpAction`, `recommendSourcesAction`, `runStageAction`, `lib/data/directory.ts`, `lib/data/onboarding.ts` writers: auth, org scoping, validation, spend, error text | Line-by-line read | `04_MODULES.md` |
| W5 | **Failure injection** | Provider 500/429/timeout/malformed, AI failure, job killed mid-run, the same request twice, another org's IDs, no session, lower role | Inventory what the existing suites already inject; scratch probes on the existing fakes for the gaps (`verify-jobs`-style `fakeClient`, PGlite with all migrations as `authenticated`) | `05_FAILURE.md` |
| W6 | **Load, query plans, concurrency** | `EXPLAIN` of the hot queries (inbox, assignments, claim, schedule sweep, dashboard) at realistic row counts; PostgREST row-cap truncation; what concurrency proof is possible here | PGlite with 0001–0051 and seeded volumes; `EXPLAIN (ANALYZE)` with timings, labelled "PGlite, single connection" | `06_PERF.md` |
| W7 | **Fix re-verification and prod probe** | Each pass-16 fix holds at HEAD; production state unchanged or changed; migration 0051 reviewed adversarially | Re-run `npm run verify`; prod GETs; review of 0051 for bypasses | `07_RECHECK.md` |
| W8 | **Report** | Findings (pass-16 schema), counts, diff, access list | — | `README.md`, `08_FINDINGS.md`, `09_ACCESS_NEEDED.md` |

Order: W7 baseline checks first (so later findings sit on a known-green tree), then W4 (cheap and static), W5, W6, W1, W2, W3, then W8. Each workstream writes its file before the next starts.

## Explicitly out of reach in this pass (listed in `09_ACCESS_NEEDED.md`)

- Hosted Supabase grants, PITR/backups, `pg_cron`, Auth settings.
- Live vendors (Apollo, Hunter, ZeroBounce, Anthropic, HubSpot, Gmail/Graph).
- Vercel, GitHub, OAuth consoles, Sentry, DNS dashboards.
- True multi-connection concurrency and production-scale load.
- Any signed-in production flow; a post-deploy pass (pass 18) once 0048–0051 are live.

## Done means

Every workstream above has its file with either findings or a "checked, nothing found, here's how" section. Finding counts reconcile with `08_FINDINGS.md`. The audit README row is added. The chat summary names what the owner must provide.
