---
description: Evidence-based, read-only end-to-end audit of HuntLoop — code, data, providers, AI, security, prod, UX — written as a new pass in audit/
argument-hint: "[full | area ...] [--since <git-ref>] [--no-runtime]"
---

# HuntLoop audit

Arguments: `$ARGUMENTS`

You are auditing HuntLoop, an AI-assisted B2B lead-discovery platform for founders, BD, sales and growth teams. Every finding is judged against the product's north star:

> **Who should I pursue next, why are they a good fit, what evidence supports that, and what should I do about it?**

Core loop: **Discover → Qualify → Enrich → Prioritize → Reach Out → Track → Learn**

This is an **audit, not a fix.** Do not edit application code, migrations, config or data. The only files you write are the report files under `audit/` (Phase 5). If you find something urgent, such as a leaked secret or an open tenant boundary, **stop and tell the user right away**, then continue the audit.

---

## Scope

Parse `$ARGUMENTS`:

- empty or `full`: audit every area in the table below.
- one or more area keys (for example `security db providers`): audit only those areas. Phase 0 and Phases 3–5 still run.
- `--since <ref>`: focus on code changed since `<ref>` (`git diff --stat <ref>...HEAD`). Still check how those changes affect the areas they touch.
- `--no-runtime`: skip Phase 2 (no dev server, no browser, no production requests).

| Key | Area | Start here (confirm the paths still exist; don't trust this list) |
|---|---|---|
| `map` | Architecture and system map | `apps/web/app/**`, `apps/web/proxy.ts`, `packages/*/src/index.ts`, `docs/architecture/` |
| `db` | Database, RLS, migrations | `packages/db/migrations/`, `packages/db/pending-migrations.sql`, `packages/db/scripts/`, `packages/db/src/` |
| `flow` | Core loop and lead intelligence | `packages/jobs/src/handlers/*`, `packages/jobs/src/{first-run,look-alike,reach}.ts`, `apps/web/app/(app)/**` |
| `providers` | Apollo, Hunter, ZeroBounce and other providers | `packages/providers/src/{adapters,budget,cache,ledger,call,registry}.ts` |
| `crm` | HubSpot | `packages/crm/src/`, `packages/jobs/src/handlers/sync-hubspot.ts`, `schedule-syncs.ts` |
| `ai` | Every model call | `packages/ai/src/**` (`tasks/`, `claims.ts`, `untrusted.ts`, `runs.ts`, `models.ts`), `packages/jobs/src/ai.ts` |
| `jobs` | Queue, tick, cron, workers | `packages/jobs/src/{queue,runner,registry,scope}.ts`, `apps/web/app/api/{jobs,inngest}`, `.github/workflows/tick.yml` |
| `outreach` | Mailboxes, sending, compliance | `packages/jobs/src/mailbox/`, `send-message.ts`, `advance-enrollments.ts`, `apps/web/app/api/{mailboxes,unsubscribe}`, `docs/security/outreach-compliance.md` |
| `security` | AuthN/Z, tenancy, secrets, input handling | `apps/web/proxy.ts`, `apps/web/app/(auth)`, `apps/web/app/auth`, `apps/web/app/invite`, RLS policies, `docs/security/*` |
| `prod` | Deploy, env, observability | `apps/web/vercel.json`, `apps/web/next.config.ts`, `.vercel/`, `sentry.*.config.ts`, `instrumentation*.ts`, `.env.example`, `.github/workflows/` |
| `perf` | Performance | server components and loaders under `apps/web/app/(app)`, `scripts/bundle-budget.mjs` |
| `ux` | UX, design system, a11y | `apps/web/app/**`, `packages/ui/src/`, `docs/architecture/design-system.md`, `e2e/a11y.spec.ts` |
| `trust` | Provenance: "every claim has a source" | every place a factual statement reaches the UI |
| `tests` | Tests and CI | `**/*.test.ts`, `apps/web/test/`, `e2e/`, `playwright.config.ts`, `.github/workflows/ci.yml` |
| `debt` | Dead code, mocks, bypasses | `apps/web/app/kitchen-sink`, `scripts/dev-*.mjs`, seed/demo data, `TODO/FIXME/HACK`, dev-only flags |

---

## Non-negotiable rules

1. **Read-only.** No code, schema, config or data changes. No writes to any database, provider, CRM or mailbox. No `db:seed`, no migrations, no sends, no syncs.
2. **Code existing doesn't mean it works.** A feature counts as working only after you trace UI → action or route → logic → table or provider → back to UI, and nothing breaks along the way.
3. **Docs are claims to check, not evidence.** This includes `README.md`, `docs/status/*`, earlier `audit/` passes and code comments. When a doc disagrees with the code, record it as a finding.
4. **Evidence for every finding.** Each one cites `path:line`, a table or migration name, a route, or command output you actually ran. Findings without evidence don't go in the report.
5. **Label confidence honestly:**
   - `CONFIRMED`: you traced the path or reproduced the behavior.
   - `LIKELY`: the code strongly suggests it, but you haven't run it.
   - `UNVERIFIED`: you can't tell from here (it needs prod access, credentials, or a dashboard). Say exactly what would settle it.
6. **Never print secret values.** Refer to variables by name. If a secret appears in code, git history or logs, report where it is, not what it is.
7. **Demo data, mocks and AI inference don't count as working functionality or verified fact.**
8. **Root causes over symptoms.** When ten findings share one cause, report the cause once and list the ten places it shows up.
9. **Recommend a rewrite only when the evidence forces it.** Keep what works. Every pass needs a "do not change" list.

---

## Phase 0: Orient (do this before judging anything)

1. Read the existing audit program and treat it as the baseline to compare against: `audit/README.md`, `audit/FINDINGS.md`, `audit/BACKLOG.md`, the highest-numbered `audit/PASS-*.md` and `audit/PLAN-*.md`, `audit/full-system/00_EXECUTIVE_SUMMARY.md` and `22_PRODUCT_GAPS.md`, and `docs/status/*`.
2. Record `git rev-parse HEAD`, the branch, `git status --short`, and `git log --oneline` since the last pass's date. This fixes the audited commit.
3. Run the mechanical checks. They're read-only, so run them all and capture pass or fail with the key output. Keep going if one fails; the failure is itself a finding.
   ```
   npm run typecheck
   npm run lint
   npm test
   npm run audit:site
   npm run build && npm run audit:bundle
   npm run db:doctor            # read-only report; skip if it needs creds you don't have → UNVERIFIED
   node scripts/check-queries.mjs   # only if Supabase creds are present in the env; SELECT-only
   npm audit --omit=dev --json  # summarize, don't paste
   ```
   Read each script before running it and confirm it doesn't write. If one does, don't run it.
4. Build the **env inventory** from `.env.example`, `process.env.*` / `env.ts` usage, `vercel.json` and workflow files. Use names only.

## Phase 1: Static sweep, in parallel

Split the in-scope areas across **parallel subagents** (general-purpose, read-only), 3–5 areas each, grouped by shared code: `map+flow+trust`, `db+security`, `providers+crm+ai`, `jobs+outreach+prod`, `perf+ux+tests+debt`. Give each agent:

- its areas, the start paths above, and the Phase 0 baseline (the earlier findings in those areas, so it can say fixed, still open or regressed);
- the rules above, word for word;
- the checklists for its areas from the **Area checklists** section;
- an instruction to return findings **only** in the Finding schema, plus a short feature-status table for its areas.

If you can't run subagents, do the areas yourself one at a time. Write each area's findings to disk (Phase 5 layout) before starting the next, so nothing is lost when context gets compacted.

## Phase 2: Runtime verification (skip with `--no-runtime`)

Static reading misses things that break at runtime. Use the preview tools, not Bash, to run servers:

1. `preview_start {name: "huntloop-demo"}` (a local demo workspace; see `.claude/launch.json`). Walk the core loop as a new user: sign-in → onboarding (ICP) → Discover → open a company/person → qualify/score → enrich → draft outreach → track → learning surfaces. At each stage, record:
   - what the user sees, the data behind it, the action available, where the result is stored, and whether it can be undone;
   - whether the next stage receives the right data;
   - how it behaves with no results, missing data, and a failed provider call (look for how the code handles these; don't break real providers to find out).
   Record console errors, failed network requests, server log errors and slow requests (over ~1s). Take a screenshot of anything that looks functional but isn't.
2. Run `npx playwright test` against the local server. Report failures and what the suite doesn't cover.
3. **Production, read-only.** GET `/api/health` on the production origin(s) found in config or `.vercel/`, and compare what's deployed against the repo: commit, which migrations are applied vs `packages/db/migrations/`, and which env vars are present. Look specifically for split-brain setups: several Vercel projects or domains pointing at different code or databases, and the tick workflow targeting a different origin than the app. Don't sign in to production and don't trigger jobs. Anything that needs a dashboard is `UNVERIFIED`, with the exact place to look.

## Phase 3: Verify findings (required)

Before anything goes in the report, re-open every `Critical` and `High` finding and **try to disprove it**. Check for a guard in a caller, an RLS policy, middleware in `proxy.ts`, a later migration, or a flag that makes the path unreachable. If you disprove it, drop it. If it only partly holds, downgrade it. If it holds, mark it `CONFIRMED` and add a one-line repro. Also remove duplicates and group findings that share a root cause.

## Phase 4: Synthesize

- **Feature inventory:** every capability gets one status: `Working` · `Partial` · `Broken` · `Mock/Demo-only` · `Dead (built, not connected)` · `Missing`, with its entry point, backend, tables, providers and the evidence.
- **Diff against the previous pass:** mark each earlier finding `Fixed` · `Still open` · `Regressed` · `Obsolete`, and list the new ones.
- **What can move into scripts:** list findings a script could catch from now on, and say what `scripts/audit.mjs` should check for each. That's how this program closes findings (see `audit/README.md`).
- **Implementation order:** P0 → P1 → P2 → P3, ordered by concrete factors (security, data integrity, production breakage, how much of the core loop depends on it, user-blocking impact, reliability, performance), never by taste. Show dependencies between fixes.

## Phase 5: Write the report

Pick the next pass number `N` from the existing `audit/PASS-*.md` files. Write:

```
audit/pass-N/
  README.md            index, commit audited, scope, method, what was not verified
  00_SUMMARY.md        A–R summary + SYSTEM HEALTH + TOP 10 (see below)
  01_SYSTEM_MAP.md     architecture + data-flow + integration map (mermaid diagrams)
  02_FEATURES.md       feature inventory table
  03_FINDINGS.md       every finding, by severity, in the Finding schema
  04_DIFF.md           vs previous pass
  05_ENV.md            env inventory
  06_PLAN.md           P0–P3 order + mechanizable checks + do-not-change list
```

Then add a single row for this pass to the table in `audit/README.md`. Change nothing else there.

`00_SUMMARY.md` covers:

- **A.** What HuntLoop is today (describe what the code actually does, not what the pitch says)
- **B.** Architecture (frontend → backend → DB → providers → jobs → deploy)
- **C.** Feature inventory rollup
- **D–G.** Counts and headlines for Critical / High / Medium / Low
- **H.** Missing systems · **I.** Broken connections (exactly where the chain breaks)
- **J–K.** Links to the data-flow and integration maps
- **L–O.** Security, performance, UX and product-integrity headlines
- **P.** Implementation order · **Q.** Do-not-change list · **R.** Target architecture, built from the current codebase
- **SYSTEM HEALTH:** a few sentences each, no scores, for architecture, product functionality, data integrity, security, performance, UX, integrations, production readiness and maintainability.
- **TOP 10 TO FIX FIRST:** problem · evidence · impact · depends on · recommended action.

Finish with a **short chat message**: the audited commit, the 3–5 most important findings with links, the counts by severity, what stayed `UNVERIFIED` and what the user has to provide to settle it, and the path to `00_SUMMARY.md`. Keep the report in the files and out of chat. **Don't start fixing anything until the user has reviewed the report.**

---

## Finding schema

```
### [SEV] AREA-NNN — short title
- Confidence: CONFIRMED | LIKELY | UNVERIFIED (what would verify it)
- Where: path:line, route, table/migration, job
- Evidence: what you saw or ran (quote ≤5 lines of code/output; never secrets)
- Repro / trace: steps or the call chain
- Impact: who is affected and how (user, tenant, data, cost, prod)
- Root cause: one sentence
- Fix: the smallest change that fixes the root cause; note what else it touches
- Effort: S | M | L  ·  Depends on: IDs  ·  Mechanizable: yes (check idea) | no
- Status vs last pass: New | Still open (old ID) | Regressed (old ID)
```

**Severity**, defined by consequence:

- **Critical:** cross-tenant data access, secret exposure, auth bypass, data loss or corruption, production down, the core loop unusable, or email sent or CRM written without the user's consent.
- **High:** a core-loop stage broken or faked; unsourced or inferred data shown as fact on a decision surface; unbounded provider or AI spend; a missing retry or idempotency guarantee on anything that writes or sends; a missing index on a hot path.
- **Medium:** degraded UX or reliability, missing states, maintainability problems that will cause bugs.
- **Low:** cleanup, consistency, cosmetic issues.

---

## Area checklists

Treat these as prompts. Report only what you find evidence for; don't answer every item for the sake of it.

**map:** every route, server action and API route, with its auth requirement. For each major feature: entry point → UI → action/route → logic → tables → providers → response. Loading, empty and error states. **List everything that exists in code but isn't wired to anything.**

**db:** every table, relation, index, constraint, enum, trigger, function and RLS policy. Duplicate concepts, dead tables, missing foreign keys or indexes (compare to the actual query patterns in loaders and handlers), unsafe `ON DELETE CASCADE`, nullability errors, migration ordering or idempotency problems, drift between `migrations/` and `pending-migrations.sql` and production. Where the service role is used and whether each use is justified (`check-admin-imports.ts`). Whether seed or demo data can reach production. Produce a **table → feature dependency map**.

**flow:** how exactly a lead becomes Discovered → Qualified → Enriched → Prioritized → Recommended. For every score, rank, filter, fit, signal and recommendation, give: inputs, formula/rules/model, source, confidence, timestamp, whether it's deterministic or AI, whether the user can inspect the reasoning, whether stale values stay visible, and whether an unsupported claim can get in. Does the loop actually close? Do outcomes (replies, meetings, CRM stages) feed back into scoring (`analyze-performance`, `schedule-learning`)?

**providers:** for Apollo and every other adapter: auth and key handling, request shape, pagination, filters, dedupe and entity resolution (`resolve-entity`), rate limits, retries, timeouts, normalization and field mapping, the cache (`cache.ts`), budget and ledger enforcement (`budget.ts`, `ledger.ts`) and whether it can be bypassed, cost per core-loop run, source attribution on stored data, how staleness is handled, and behavior when a field is missing. Spell out what HuntLoop owns and what the provider owns.

**crm:** OAuth (state/PKCE, token storage, refresh), which entities sync and in which direction, field mapping, duplicates, conflict resolution, retries and failed-sync visibility, webhooks and their verification, rate limits, what happens on disconnect, data deletion, and permissions. Anything the UI presents as connected that doesn't work.

**ai:** for **every** model call: model, provider, purpose, inputs (including untrusted web or provider text; check `untrusted.ts`), prompt, structured-output schema and validation, fallback, timeout, retry, cost, privacy (what PII leaves the system), whether and where output is persisted, and whether it's shown as fact or as inference with its basis. Look for prompt injection paths, unvalidated output reaching the DB, duplicate or redundant calls, expensive models used for simple tasks, and missing `runs.ts` or claims provenance.

**jobs:** how the queue works: claiming, locking, idempotency, retries and backoff, dead-letter handling, per-tenant scoping (`scope.ts`). How the tick is triggered (`tick.yml` → `/api/jobs/tick` → `CRON_SECRET`), whether Inngest is live or a dead path, what happens when a tick is missed, overlaps another, or a job runs twice. Handlers registered but never enqueued, and the reverse.

**outreach:** mailbox OAuth and token storage, send path, rate limits and warm-up, idempotency (can a message go out twice?), unsubscribe (signed links, honored everywhere), suppression, retention and purge jobs (`enforce-retention`, `purge-contact-data`), reply classification, and the compliance claims in `docs/security/outreach-compliance.md` checked against the code.

**security:** authN/session/cookies, authZ on every server action and route (not just the page that calls it), IDOR, privilege escalation (roles, invites), RLS coverage and service-role bypasses, tenant isolation in jobs and caches, CSRF, XSS (including `dangerouslySetInnerHTML` and rendered AI or provider HTML), SQLi, SSRF (user-controlled URLs in fetch or research; check `packages/ai/src/url.ts` and `packages/jobs/src/fetch.ts`), command injection, file uploads, webhook signature checks, OAuth state, rate limiting and abuse of expensive endpoints, CSP (`/api/csp-report`), secrets in `NEXT_PUBLIC_*`, client bundles, logs, Sentry or git history.

**prod:** repo → Vercel project(s) → domain(s) → Supabase project → providers all point at the same production setup. Env vars across production, preview and local; pooled vs direct DB connections; Node version vs `engines`; Edge vs Node runtimes; whether production migrations are applied; build config; Sentry/logging/monitoring; health checks; what CI actually gates.

**perf:** slow server components, N+1 and duplicate queries, sequential awaits that could run in parallel, AI or provider calls that block rendering, missing caching, large client bundles or needless `"use client"`, slow queries or missing indexes. Name the **slowest routes** with measured or estimated latency and the reason.

**ux:** for each major page (onboarding, discover/search/filters, company/person views, qualification, enrichment, signals, prioritization, outreach, tracking, CRM, settings, integrations, profile, billing if any): first-use clarity, primary and secondary actions, empty, loading, error and success states, mobile and responsive layout, keyboard use, hierarchy and consistency. **UI that looks like it works but doesn't do anything.** Design system: tokens vs one-off styles (type, color, spacing, radius, shadow, borders, icons), consistency across components (buttons, inputs, tables, cards, dialogs, drawers, tooltips, toasts, nav, sidebar), light/dark parity, and whether evidence, confidence and provenance are clear on screen. The look should read as premium B2B intelligence, not a generic AI dashboard. Accessibility: semantics, focus order and visibility, labels, contrast, dialog focus trap and Escape, reduced motion, touch targets, announced errors.

**trust:** classify every user-visible factual statement as **Verified · Provider-sourced · User-provided · AI-inferred · Calculated · Unknown**. Find where these get blurred, especially inferred data displayed or stored as fact. For each decision surface, can the user see what we know, where it came from, when it was last verified, what's inferred, and how confident we are? Stale data shown without a timestamp is a finding.

**tests:** what's actually covered (unit, integration, DB/RLS, API, E2E, auth, production smoke) vs where the product risk is. The 10 missing tests that would catch the most damaging failures.

**debt:** unused files, components, routes and endpoints; duplicate implementations; deprecated integrations; temporary or dev-only bypasses (confirm they're unreachable in production); debug code; TODO/FIXME/HACK; hardcoded values; placeholder or fake responses; mock states reachable in production. Anything that makes the UI look functional when the backend isn't comes first.
