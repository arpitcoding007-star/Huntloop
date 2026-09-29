# Auditor E — perf · ux · tests · debt

Commit `509a24e` (main). Read-only static review. No server, build, test or DB command was run by this auditor
(lead is running typecheck/lint/test/build). "Queries" below = PostgREST/Auth round trips counted from source.
Latency is estimated in round trips (RTT) because nothing was measured; one Supabase RTT from Vercel is typically 20–80 ms
same-region and 150–300 ms cross-region (region pairing UNVERIFIED).

---

## 0. Cross-cutting request cost (applies to every `/[org]/*` route)

Every hard load / `router.refresh()` of an org page pays, before page-specific work:

| Step | Where | RTT | Notes |
|---|---|---|---|
| `supabase.auth.getUser()` | `apps/web/proxy.ts:306` | 1 (Auth server) | required, correct |
| schema probe | `proxy.ts:147-170` (30 s cache) + `lib/data/source.ts:75-98` (per-instance, cached forever) | 0–2 | |
| `currentViewer` → `resolveMembership` = `getUser` + orgs⋈memberships | `packages/db/src/server.ts:53-62` | 2 sequential | React-`cache`d |
| `getOnboardingState` = onboarding-schema probe + 5 parallel (incl. **another `getUser`** + profiles) | `lib/data/onboarding.ts:167-212` | 2 sequential | **not** `cache`d |
| `getShellChrome` = org + plans + **another `getUser`**, then `countOpportunities` | `lib/data/chrome.ts:48-73` | 2 sequential | cached |
| Layout ordering | `app/(app)/[org]/layout.tsx:33-61` | viewer → onboarding → chrome all awaited in series | onboarding ∥ chrome are independent |

So ≈ 7–8 sequential RTTs and **3–4 separate Auth `getUser` calls** before the shell can flush; the `[org]/loading.tsx`
skeleton sits *inside* this layout, so on a hard load it cannot show until the layout resolves.

---

## 1. Per-route table — `(app)` and other server-rendered routes

Legend: Q = queries in the page's own loader path (excluding the layout cost above). "Seq" = awaits that could be parallel.
Loading = nearest `loading.tsx`; Error = nearest `error.tsx` (there is only the **root** `app/error.tsx` — see UX-001).

| Route | Loader Q (page) | Sequential awaits that could be parallel | Loading / Error / Empty | Primary action works? |
|---|---|---|---|---|
| `/[org]/dashboard` | ~36: `getDashboard` ≈22 (10-way `Promise.all`, `dashboard.ts:103-115`) + `getOnboardingState` **again** (6, duplicate of layout) + `getNudge` 4 + `getIcpQuality` 1-2 + chrome (cached) | `attentionItems`: counts **then** threads (`dashboard.ts:381-407`, independent); `whyNowCards` opp→evidence (dependent, ok) | [org]/loading ✓ · root error only · EmptyState ✓ | Links only (Refresh, Sources, Analyze). No "hunt now" enqueue (H-1 still open) |
| `/[org]/opportunities` | 2 + layout: unbounded opps⋈companies⋈**all** company_triggers⋈scores, then `evidence.in(<all ids>)` (`opportunities.ts:90-113`) | — | own loading ✓ · root error · EmptyState ✓ (with exits) | Filter/select ✓; "Add to campaign" real (enroll) when campaigns exist |
| `/[org]/opportunities/[id]` | 5 loaders ‖ (`getOpportunity` 3, `listMembers` 3 seq, campaigns 1, `getConversation` 3 seq, viewer) **then** `getNudge` 4 | `getNudge` awaited after the `Promise.all` (`[id]/page.tsx:85`) | [org]/loading (generic) · root error · `notFound()` ✓ | Assign / status / override / add-to-campaign / agent panel wired to actions |
| `/[org]/companies` | 1 unbounded, embeds all `opportunities` + all `people` per company (`company.ts:43-58`) | — | ✓ · root · EmptyState ✓ | CRUD via `companies/actions.ts` |
| `/[org]/analyze` | 0 (viewer only) | — | ✓ · root · ErrorState ✓ | Analyze → AI; **Save as opportunity now real** (`saveQualificationAction`, `analyze/actions.ts:137`) |
| `/[org]/imports` | 1 (`listCompanies`, unbounded, reused only for domain dedupe) | — | ✓ · root · form | CSV import action |
| `/[org]/inbox` | 1 unbounded threads⋈**all messages incl. `body_text`**⋈events (`inbox.ts:67-79`) | — | ✓ · root · EmptyState ✓ | Reply gated with honest `pending` reason |
| `/[org]/pipeline` | `listAssignments`: getUser → opps (unbounded) → profiles (3 seq, dependent) | — | ✓ · root · per-column empty | status move action |
| `/[org]/outreach` | 2 ‖ (campaigns⋈enrollments(all)⋈sequences⋈steps; mailboxes) | `params` then `searchParams` awaited in series (trivial) | ✓ · root · EmptyState ✓ | Mailbox connect is `pending` when no provider configured (honest) |
| `/[org]/analytics` | 1 (`ai_runs` last 30 d, **`.limit(500)`**) | — | ✓ · root · EmptyState ✓ | read-only; totals silently truncated (PERF-005) |
| `/[org]/intelligence` | 3 ‖ (limit 50 each) | — | ✓ · root · EmptyState ✓ | read-only |
| `/[org]/learn` | runs(10) → findings → citations (3 seq, dependent) | — | ✓ · root · EmptyState ✓ | run/accept actions |
| `/[org]/memory` | 1 | — | ✓ · root · EmptyState ✓ | CRUD |
| `/[org]/ops` | `opsSnapshot` 3 ‖ **then** `lastTickAt` 1 (`ops/page.tsx:41-45`) | `lastTickAt` independent of snapshot | ✓ · root · EmptyState ✓ | Retry / cancel job RPCs (R-1 fixed) |
| `/[org]/sources` | sources → evidenceCounts → documentCounts → lastTickAt (4 seq) | evidence ∥ documents (`hunt-source.ts:89-90`); lastTickAt ∥ list (`sources/page.tsx:31-40`) | ✓ · root · inline empty | "Scan now" real when engine configured, honest `pending` otherwise |
| `/[org]/team` | members(3 seq) → invitations → joinRequests (series) | all three independent (`team/page.tsx:27-33`) | ✓ · root · inline | invite / role / remove actions |
| `/[org]/team/assignments` | 2 ‖ | — | ✓ · root · EmptyState ✓ | assign action |
| `/[org]/settings` (+ `/icp`, `/product`, `/scoring`, `/integrations`, `/privacy`) | 1–3 each; `/icp` 3 ‖ | — | ✓ · root · forms; scoring EmptyState | Save actions via `mutate()`; privacy RPCs real |
| `/orgs` | memberships → cookies → usage (dependent) | — | none (no loading.tsx under `(app)/orgs`) · root | switch workspace |
| `/welcome/*` (6 steps) | each step awaits `captureForViewer` (getUser + **PostHog flush over network**) before rendering (`welcome/*/page.tsx`, `lib/analytics.ts:124-176`) | analytics should be `after()` | `welcome/loading.tsx` ✓ · root error | step actions real |
| `/discover?d=` (public) | **LLM site research inside the GET render** (`(marketing)/discover/page.tsx:65` → `actions.ts:133`) | — | **no loading.tsx** in `(marketing)` · root error | gated by `PUBLIC_RESEARCH_ENABLED` + per-IP allowance |
| `/kitchen-sink` | 0 | — | — | 404 only when `VERCEL_ENV=production` (`proxy.ts:135,252`) |

### Likely slowest routes (estimated, not measured)

1. **`/[org]/dashboard`** — ~36 page queries + ~8 layout RTTs; critical path ≈ layout (7–8 RTT) ∥ page (`whyNowCards` 2 RTT, `attentionItems` 2 RTT). Heaviest payloads: `threads⋈messages` for 200 threads (`dashboard.ts:400-407`, nested messages unbounded), `evidence⋈sources limit 1000` and `company_triggers limit 1000` aggregated in JS. Duplicate `getOnboardingState` (6 queries incl. an Auth call). Est. 0.6–1.5 s warm same-region.
2. **`/[org]/opportunities`** — cost is linear in tenant size: every opportunity with every trigger (incl. deleted ones, filtered in JS) and every score, then an `IN (…)` over all ids. Breaks rather than slows at scale (PERF-002).
3. **`/[org]/inbox`** — every thread with every message body and event, unbounded (PERF-003).
4. **`/[org]/opportunities/[id]`** — 3-deep sequential chains inside `listMembers`/`getConversation`, plus a trailing 4-query `getNudge`.
5. **`/discover`** — a model call (site fetch + LLM, seconds) on the render path with no loading UI (PERF-006).
6. **`/welcome/*`** — each step blocked on a PostHog flush round-trip (PERF-007).

---

## 2. Test inventory

Counts are test-case / assertion **call sites** counted statically (`grep`), not executed results — the prior pass's
"~950 assertions" figure counts runtime checks inside loops and is not directly comparable.

| Package | Runner (what `npm test` runs) | Files | Static count | Type | Notes |
|---|---|---|---|---|---|
| `packages/db` | `verify-migrations.ts` (PGlite) + `verify-rules.ts` + `verify-pure.ts` + `check-admin-imports.ts` | 4 scripts | ~109 ok/fail sites (migrations), ~98 (pure), ~24 (rules) | **DB / RLS** (in-process Postgres, non-superuser isolation), pure domain | Strongest suite. Tenant isolation proven at SQL layer only |
| `packages/jobs` | `verify-jobs.ts` | 1 script, 2 761 lines | ~81 expect sites (+loops) | unit/integration with fakes | Covers handlers **including the 4 that nothing enqueues** |
| `packages/providers` | `verify-providers.ts` | 1 | ~76 | unit (fake HTTP) | No live-vendor contract test |
| `packages/ai` | `verify-tasks.ts` | 1 | ~61 | unit (fake model) | |
| `packages/crm` | `verify-crm.ts` | 1 | ~19 | unit (fake HubSpot) | |
| `packages/ui` | vitest | 5 (`DataTable`, `HoverPanel`, `JumpTo`, `ScoreRing`, `Sidebar`) | 39 tests | component unit | 29 components, 5 tested |
| `apps/web` | vitest, `include: ["lib/**/*.test.ts"]` (`apps/web/vitest.config.ts`) | 10 | 115 tests | unit (validation, CSV, rate-limit, spend guard, opportunity-map, destination, safe-next, protected-routes, icp-step) | **Nothing under `app/**`** — no Server Action, route handler, or `mutate()` role-gate test |
| `e2e/` Playwright | Chromium desktop + Pixel 7, `next start` with **empty Supabase + Anthropic env** (`playwright.config.ts` webServer.env) | 7 specs | 93 tests (×2 projects) | E2E **demo mode only**; axe on 5 pages (`e2e/a11y.spec.ts:16-22`) | No auth, no DB, no write path, no onboarding persistence |
| `scripts/audit.mjs` | `npm run audit:site` | — | 23 check IDs (NAV-01..03, FEAT-DEMO, FEAT-FIXTURE, SEC-*, SEO-*, LEGAL-*, PRV-CHK, PERF-01, REPO-*) | static repo checks | No job-reachability / table-reachability / cron check |
| `scripts/bundle-budget.mjs` | `npm run audit:bundle` | — | 1 | shared client JS budget | |

**What CI actually runs** (`.github/workflows/ci.yml`): job `verify` = `npm ci` → typecheck → lint → `npm test` (all
workspaces above) → `audit:site` → `npm audit --audit-level=high` **with `continue-on-error: true`** → build (empty Supabase env)
→ bundle budget; job `e2e` = Playwright (demo mode). No migration step, no deploy, no post-deploy smoke, no live-DB job.
`tick.yml` is a scheduler, not a test.

**Coverage vs product risk (gaps):** unit/DB coverage is deep; the app layer between them — Server Actions, route handlers,
the proxy's live-mode branches, onboarding writes, and anything that needs a session — has **zero** automated coverage. The
last three commits before this audit (`3d7bdce`, `3d60dc5`, `0028b71`) were all onboarding/nav regressions in exactly that layer.

### Top 10 missing tests (by product risk)

1. **Live-DB E2E of the core path**: sign up (magic link via admin `generateLink`) → onboarding creates workspace via `create_organization()` → ICP saved → lands in `/[org]/dashboard` with live data, not fixtures. Would have caught `3d7bdce`/`0028b71`.
2. **Server Action authorization matrix**: for every exported action in `app/**/actions.ts`, a viewer / non-member / other-org caller is refused (`mutate()` in `lib/data/org.ts:219-265` and the actions that bypass it). Today only RLS in PGlite is tested.
3. **Job reachability check** (audit.mjs): every `JobName` in `packages/jobs/src/queue.ts` is in `SWEEPERS` or an `enqueue({name})` call site. Would fail today on `sync_hubspot`, `enrich_person`, `resolve_entity`, `purge_contact_data` (DEBT-001).
4. **`/api/jobs/tick` handler test**: rejects missing/wrong `CRON_SECRET`, runs one tick against PGlite, respects deadline and per-org scoping.
5. **Unsubscribe token + one-click POST against a DB**: token forgery rejected, valid token records suppression, `send_message` then refuses the address (E2E only covers the no-DB path, `e2e/routing.spec.ts:144-200`).
6. **Mailbox OAuth callback** (`app/api/mailboxes/[provider]/callback/route.ts`): state mismatch / replay refused, token stored encrypted.
7. **Proxy live-mode behaviour** with a stub Supabase: production + schema `none|partial` → 503 page; kitchen-sink 404 in prod; unauthenticated protected route → `/login?next=` path-only; public prefixes reachable.
8. **Loader scale test**: seed ≥1 500 opportunities / evidence rows in PGlite+PostgREST (or a local Supabase) and assert `/opportunities` renders and counts are exact (PERF-002/004).
9. **Axe on every screen class**: onboarding steps, opportunity detail, settings forms, imports, inbox, outreach — only 5 pages are scanned today (A11Y-002).
10. **Post-deploy smoke** against the Vercel preview/production URL: `/api/health` green, `/login` renders, `/` 200, protected route redirects — the class of failure where production was serving the wrong project/env (see memory: duplicate Vercel projects).

---

## 3. Dead / mock / bypass inventory

| Item | Kind | Evidence | Reachable in production? | Verdict |
|---|---|---|---|---|
| ICP "Continue anyway (dev)" | dev bypass | `app/(onboarding)/welcome/icp/IcpStep.tsx:37-39,729-736` — inline `process.env.NODE_ENV === "development" && NEXT_PUBLIC_HUNTLOOP_DEV_BYPASS !== "0"` in a `"use client"` module | **No.** `next build` inlines `NODE_ENV="production"` → constant `false` → branch removed. Even if rendered it calls the same `save` → same server action + schema; it skips only a client completeness gate | OK (verified by code; build output not inspected) |
| `lib/dev-bypass.ts`, "Skip to workspace (dev)" | dev bypass | added in `3d60dc5`, **deleted** by `0028b71` (`git log -- apps/web/lib/dev-bypass.ts`) | No (file gone; "Skip to workspace" → 0 hits) | Removed |
| Demo mode (fixtures, no auth) | mock state | `lib/data/source.ts:119-126` `load()` returns `fallback()` when no DB; `lib/fixtures/opportunities.ts`; `DEMO_ORG_SLUG="demo"` `lib/demo.ts:13` | **Production: no** — `proxy.ts:258-280` answers 503 when `VERCEL_ENV=production` and env/schema missing. **Preview deploys: yes**, publicly, no login (by design) | OK in prod; previews see DEBT-006 |
| `/kitchen-sink` | design gallery (`"use client"`, 857 lines) | `proxy.ts:135,252-254` 404 only when `VERCEL_ENV=production`; also in `PUBLIC_PREFIXES` | Prod: no. Previews: yes | Low (DEBT-006) |
| Google OAuth | hidden "for testing" | `app/(auth)/AuthForm.tsx:131-132` comment; `signInWithGoogle` `app/(auth)/actions.ts:120` has no importer | Not rendered; action unreferenced | DEBT-007 |
| `sync_hubspot`, `enrich_person`, `resolve_entity`, `purge_contact_data` | registered, tested, never enqueued | `packages/jobs/src/queue.ts:42,58,66,77`; zero `enqueue` call sites in `apps/web` / `packages/jobs/src`; `SWEEPERS` `runner.ts:171-196` excludes them; `schedule-syncs.ts:72` enqueues only `sync_mailbox`; no SQL enqueue | Dead | DEBT-001 → drives UX-002 |
| `ToastProvider` / `useToast` | built, mounted, unused | `app/layout.tsx:180` mounts provider; `useToast` 0 uses outside kitchen-sink | Mounted (client JS) but never fires | DEBT-003 |
| Unused exports in `lib/data` etc. | built-not-wired | `consumeQuota`, `allQuotas` (`usage.ts:67,137`), `getCompany` (`company.ts:68`), `requestResearch` (`engine.ts:85`), `latestRecompute` (`engine.ts:143`), `listAudit` (`audit.ts`), `resolveNames`; `validation.ts` `httpUrlSchema`, `qualityRatingSchema`, `describeCompanySchema`; `csp.ts` `cspIsEnforced` | n/a | DEBT-003 (`listAudit` = the audit-log reader H-7 asked for, still unwired; `requestResearch` = the missing "Re-research" verb) |
| Type-scale tokens `--hl-text-*` | dead tokens | defined `packages/ui/src/tokens.css:77-88`, not mapped in `theme.css`, 0 consumers | n/a | UX-007 |
| `scripts/dev-session.mjs` | dev tool that mints a real user session | `scripts/dev-session.mjs:27-60` | Runs against whatever `apps/web/.env.local` targets; **no production guard** | DEBT-002 |
| `scripts/check-queries.mjs` | hand-copied loader SELECTs | `scripts/check-queries.mjs:35-107` | dev only, not in CI | DEBT-004 (drifted) |
| `packages/db/scripts/seed.ts` | fixture org "Acme" + optional auth user | guard `seed.ts:128-145` = single hard-coded prod ref denylist | Only if run by a developer | DEBT-008 |
| Landing "worked example" companies | illustrative data | `(marketing)/page.tsx:250-262`, labelled "These companies are not real and the scores are invented" (`:360`) | Yes, honestly labelled | OK |
| `DataSourceBanner` / `DemoFigures` | honesty banners | `(app)/[org]/DataSourceBanner.tsx`, `DemoFigures.tsx` | Only when not live | OK (copy issue UX-006) |
| TODO / FIXME / HACK / XXX | markers | grep over apps, packages, scripts, e2e → **0** | — | Prior claim holds |
| `console.log` / `console.debug` in app, lib, packages src | debug code | 0 hits; 14 `console.error/warn` (intentional) | — | Clean |
| Root-level planning docs | doc clutter | tracked `New_Aud.md`, `PROJECT_AUDIT.md`, `explee.md`, `Migrate.md`, `checklist.md`, `Project_Creation.md`, `DELIVERY_PLAN.md`, `IMPLEMENTATION_PLAN.md`; untracked `Audit.md` | — | Low, noted only |

---

## 4. Status of prior findings (my areas)

| Prior ID (doc) | Claim | Status | Evidence now |
|---|---|---|---|
| F-1 (16) | "hunt now", "push to CRM", "enrich contact" have no button | **Still open** (partial) | Analyze→Save now real (`analyze/actions.ts:137`), Sources "Scan now" real (`sources/actions.ts:321`); no `discover_companies` / `sync_hubspot` / `enrich_person` enqueue from `app/**` → UX-002, UX-003 |
| F-2 (16) | Command Center lacks "what changed since I last looked" | **Still open** (partial) | only "N new triggers in the last 24h" chip, `dashboard/page.tsx:508-512`; no last-seen marker → UX-010 |
| F-3 (16) | 19 destinations, Learn group empty-by-construction | **Still open** | `OrgShell.tsx:147-260` |
| F-4 (16) / UX-15 | no command palette | **Fixed** (pages only) | `JumpTo` via Sidebar `jumpTo`, Ctrl+K (`e2e/a11y.spec.ts:80`); no entity search |
| F-5 (16) | no notification/digest | **Still open** (partial) | nudges only (`lib/data/nudges.ts`) |
| F-6 (16) / L-2 (22) / 23 | kitchen-sink in prod build | **Fixed for production**, open on previews | `proxy.ts:135,252` → DEBT-006 |
| F-7 (16) / PF-3 (18) | no skeleton loaders | **Fixed** | `(app)/[org]/loading.tsx`, `opportunities/loading.tsx`, `welcome/loading.tsx` |
| F-8 (16) | behaviour at volume unverified | **Still open — now evidenced** | unbounded loaders → PERF-002/003/004 |
| PF-1 / M-4 | no load test | **Still open** | no k6/artillery/autocannon config |
| PF-4 / M-8 | `getStageLabels` extra call per sync | **Obsolete** | sync never runs (DEBT-001) |
| PF-5 | no caching layer | **Still open** (info) | plus duplicate uncached loaders → PERF-001 |
| 18: "Opportunity list — one query, no N+1" | | **Holds for N+1, incomplete** | unbounded; evidence `IN` grows with it → PERF-002 |
| R-1 / M-7 | no dead-letter surface | **Fixed** | `lib/data/ops.ts:80-91` `job_dead_letters`; `ops/actions.ts:36,64` `retry_job` / `cancel_job` |
| R-3 | no health endpoint | **Fixed** | `app/api/health/route.ts` |
| R-2, R-4 | alerting, rollback | Not re-checked (prod/jobs area) | — |
| T-1 (19) | `npm audit` step exits 1, CI red | **Obsolete → replaced by a new gap** | step now `continue-on-error: true` (`ci.yml`) → advisories never fail CI → TEST-002 |
| T-2 (19) / R-5 | no migration deployment step | **Still open** | none in `ci.yml` → TEST-004 |
| T-3 | no preview deploy / smoke | **Still open** | TEST-001 item 10 |
| T-5 | Playwright demo-only | **Still open** | `playwright.config.ts` webServer.env empties Supabase/Anthropic → TEST-001 |
| T-6 | no coverage reporting | Still open (deliberate) | — |
| 19 rec. 1–4 (job/cron/quota/table reachability checks) | | **Still open** (quota partial: `SEC-QUOTA` covers model wrappers only) | audit.mjs check IDs in §2 → TEST-003 |
| 23: zero TODO/FIXME | | **Holds** | 0 hits |
| 23 orphan jobs ×4 / 22 C-2, C-3, C-4, H-2 | never enqueued | **Still open** | DEBT-001 (GDPR erasure itself is now reachable via `erase_contact_for_org` RPC, `settings/privacy/actions.ts:52`; the job is still dead) |
| 23 / 22 H-7 | `audit_logs` write-only | **Still open** | reader `listAudit` exists, 0 importers → DEBT-003 |
| 22 H-1 | no in-app hunt | **Still open** | UX-003 |
| 22 L-4 | no manual `analyze_performance` | **Fixed** | `learn/actions.ts:48` inserts `learning_runs(status='requested')`, picked up by `schedule_learning` |
| UX-05 | Analyze discards output | **Fixed** | `saveQualificationAction` |
| UX-07 | onboarding ends on invented dashboard | **Fixed / obsolete** | ends at `/welcome/review` → dashboard, which reads live loaders |
| UX-08 | selection serves one unbuilt action | **Fixed** | enroll wired, honest pending reason (`OpportunityTable.tsx:330-340,488-500`) |
| UX-09 | duplicate stat cards + chips | **Fixed** (chips kept, `aria-pressed`) | `OpportunityTable.tsx:263-275` |
| UX-10 | URL true once | **Fixed** | `history.replaceState` `OpportunityTable.tsx:111-122` |
| UX-11 | "Needs you" below the fold | **Fixed** | `dashboard/page.tsx:592` `order-first min-[1440px]:order-none` |
| UX-12 | hard-coded ICP crumb | **Fixed** | 0 occurrences |
| UX-13 | HoverPanel unreachable by touch | **Fixed** | pinned state `HoverPanel.tsx:33-49`, 11 tests |
| UX-14 | no confirmation state | **Partially fixed** | `FormMessage` success; `Toast` built+mounted, never used → DEBT-003 |
| UX-01..04, UX-06 | inert controls | **Holds** (spot-check) | no `href="#"`, no empty `onClick`; disabled controls carry `pending` reasons; NAV-03 |

---

## 5. Findings

Counts: **Critical 0 · High 4 · Medium 16 · Low 12** (32). Each Critical/High was checked against the strongest disproof I could find; notes are inline.

### [High] UX-002 — HubSpot integration UI promises a push that nothing can trigger
- Confidence: CONFIRMED (static trace; no live HubSpot)
- Where: `apps/web/app/(app)/[org]/settings/integrations/IntegrationsForm.tsx:70,97-99`; `packages/jobs/src/queue.ts:77`; `packages/jobs/src/runner.ts:171-196`; `packages/jobs/src/handlers/schedule-syncs.ts:72`
- Evidence: card copy "Pushes an opportunity's company, primary contact and score out as a HubSpot deal, and reads its stage back as evidence." and, once connected, `"Not synced yet — push an opportunity to start."` No push control exists on `/opportunities/[id]` (`grep -rni hubspot "opportunities/[id]"` → 0) or anywhere in `app/**`; `sync_hubspot` has zero `enqueue` call sites, is not a sweeper, and `schedule_syncs` enqueues only `sync_mailbox`. No SQL enqueues it.
- Repro / trace: Settings → Integrations → paste token → `connectHubspotAction` verifies + stores encrypted token → "Connected … Not synced yet — push an opportunity to start" → user looks for "push" → none → `last_synced_at` stays null forever.
- Disproof attempted: searched jobs registry, sweepers, SQL migrations, dynamic `enqueue({name: var})` → none.
- Impact: every admin who connects HubSpot believes CRM sync is live; the CRM stage of the loop is faked by copy. Also stores a live CRM write-token for a feature that never uses it.
- Root cause: `sync_hubspot` built and tested without a trigger (DEBT-001); UI copy written against the handler, not the trigger.
- Fix: either add "Push to HubSpot" on opportunity detail (enqueue `sync_hubspot {opportunityId}` via `mutate`) and/or a status-change hook; until then change copy to say sync is not yet available and mark the card `pending`. Touches `opportunities/[id]/OpportunityActions.tsx`, `IntegrationsForm.tsx`.
- Effort: S · Depends on: DEBT-001 · Mechanizable: yes (JOB-REACH check in audit.mjs)
- Status vs last pass: Still open (H-2, F-1) — now with misleading UI copy

### [High] PERF-002 — Opportunity list is unbounded and its evidence lookup grows an `IN (…)` over every id
- Confidence: LIKELY (code CONFIRMED; the breaking thresholds depend on project `max_rows` and gateway URL limits — UNVERIFIED; settle by listing a tenant with ≥1 500 opportunities or checking Supabase API settings)
- Where: `apps/web/lib/data/opportunities.ts:90-113` (no `.limit/.range`), `:138-146` (`.in("subject_id", opportunityIds)`); page `app/(app)/[org]/opportunities/page.tsx:58`
- Evidence:
  ```ts
  .from("opportunities").select(`… companies!inner(… company_triggers(trigger_type, event_date, deleted_at)), opportunity_scores(…)`)
  .eq("org_id", orgId).is("deleted_at", null).order(...)   // no limit
  const kinds = await evidenceKindsFor(db, orgId, rows.map((r) => r.id));  // .in(all ids)
  ```
- Repro / trace: org grows past ~1 000 opportunities (Growth plan allows 1 000/month, Scale 10 000 — `packages/db/migrations/0007…sql:368-370`). (a) Hosted PostgREST default `max_rows=1000` silently truncates the list, so the priority chip counts computed from it are wrong; (b) the second query's querystring is ~37 chars × N ids — at a few hundred to ~1 000 ids it exceeds common gateway URL limits, the request fails, the loader throws (`opportunities.ts:143`) and the whole screen falls to the root error page (UX-001). Every row also drags every trigger of its company, deleted ones included.
- Disproof attempted: no pagination in `DataTable`/`OpportunityTable`; plan quotas are monthly and (per prior pass C-6) `opportunities` is not enforced, so they do not bound the table.
- Impact: the product's primary decision surface degrades then fails for exactly the customers who use it most; counts shown as fact become wrong first, silently.
- Root cause: list loader written for seed-sized data; batching by id list instead of by join/filter.
- Fix: server-side pagination/keyset (`.range`) + filters in the query; replace `evidenceKindsFor` with an aggregate (view/RPC `opportunity_evidence_kinds(org)` or embed via FK) and priority counts via head counts (as the dashboard already does). Touches `OpportunityTable` filtering (move to URL-driven server filters).
- Effort: M · Depends on: — · Mechanizable: yes (lint rule/audit: every `from(...).select` in `lib/data` list loaders has `.limit`/`.range`)
- Status vs last pass: New (prior pass said "one query, no N+1")

### [High] PERF-005 — Spend screen states "every model call in the last 30 days" but sums only the latest 500 runs
- Confidence: CONFIRMED (code); magnitude UNVERIFIED (needs `select count(*) from ai_runs where created_at > now()-'30 days'` per org)
- Where: `apps/web/lib/data/spend.ts:63,144-155`; `app/(app)/[org]/analytics/page.tsx:95-110`
- Evidence: `const MAX_ROWS = 500;` … `.order("created_at", { ascending: false }).limit(MAX_ROWS);` → `summarise()` → StatCard "Total spend", header copy "Every model call this organisation has made in the last 30 days, and what it cost." No truncation indicator (`grep truncat|500` on the page → 0).
- Disproof attempted: plans allow 3 000 (`growth`) / 20 000 (`scale`) `ai_runs` per month (`0007…sql:369-370`), so >500 in 30 days is inside normal paid use; no other spend screen exists.
- Impact: admins under-read AI cost (and failed-run count, cache-hit rate, per-task split) exactly when spend is high — a calculated figure presented as complete on a cost decision surface.
- Root cause: a row cap used as a safety limit on data that is then aggregated as if complete.
- Fix: aggregate in SQL (view or RPC grouping by task/model over the 30-day window), keep the 500-row cap only for the recent-runs table and label it "latest 500".
- Effort: S · Depends on: — · Mechanizable: yes (flag `.limit(` in loaders whose result feeds a sum)
- Status vs last pass: New

### [High] TEST-001 — Nothing tests the app layer against a database: no Server Action, route handler, auth or onboarding-write test
- Confidence: CONFIRMED
- Where: `apps/web/vitest.config.ts` (`include: ["lib/**/*.test.ts"]`); `playwright.config.ts` webServer.env (`NEXT_PUBLIC_SUPABASE_URL: ""`, `…PUBLISHABLE_KEY: ""`, `ANTHROPIC_API_KEY: ""`); `.github/workflows/ci.yml`
- Evidence: 0 test files under `apps/web/app/**`; every Playwright test runs demo mode; the only authZ tests are SQL-level RLS in PGlite (`packages/db/scripts/verify-migrations.ts`).
- Repro / trace: the three most recent fixes (`3d7bdce` create workspace, `3d60dc5` ICP step blocked, `0028b71` users forced back into onboarding) are all in this untested layer and shipped with CI green.
- Disproof attempted: looked for a live-DB job, a Supabase-local service in CI, or action tests in any package — none.
- Impact: auth, onboarding, invites, mailbox OAuth, unsubscribe, tick and every write action can regress with CI green; the tenant boundary is proven only below the app.
- Root cause: E2E was designed around demo mode so it needs no credentials; no second tier was added once the DB became real.
- Fix: add a CI job with `supabase start` (or PGlite + PostgREST) seeded by `seed.ts`, run a `@live` Playwright project for the core path, plus vitest tests for `mutate()` gates and route handlers. See §2 top-10.
- Effort: M · Depends on: — · Mechanizable: yes
- Status vs last pass: Still open (T-5), escalated with regression evidence

### [Medium] PERF-001 — Org layout runs four loaders in series and pays 3–4 Auth round trips; dashboard re-runs the onboarding loader
- Confidence: CONFIRMED (code); latency LIKELY
- Where: `app/(app)/[org]/layout.tsx:33-61`; `lib/data/onboarding.ts:167-212` (not `cache`d; own `getUser` at :187); `lib/data/chrome.ts:48-73,118-121` (`getUser` again, `countOpportunities` after `Promise.all`); `packages/db/src/server.ts:53`; `app/(app)/[org]/dashboard/page.tsx:92-99` (calls `getOnboardingState` again)
- Evidence: `const viewer = await currentViewer(org); … const onboarding = await getOnboardingState(org); … const chrome = await getShellChrome(org);`
- Impact: ≈7–8 sequential RTTs before the shell (and the `[org]/loading.tsx` skeleton inside it) can stream on hard loads and `router.refresh()`; dashboard adds 6 duplicate queries per view.
- Root cause: layout loaders added one at a time; only some wrapped in React `cache`; auth user not shared.
- Fix: wrap `getOnboardingState` (and a shared `getAuthUser`) in `cache`; `Promise.all([getOnboardingState, getShellChrome])` after the viewer check; fold `countOpportunities` into the chrome `Promise.all`.
- Effort: S · Depends on: — · Mechanizable: partly (lint for `await` chains in layouts)
- Status vs last pass: New

### [Medium] PERF-003 — Inbox, companies and outreach embed unbounded child collections
- Confidence: LIKELY (code CONFIRMED; size effects need data)
- Where: `lib/data/inbox.ts:67-79` (all threads ⋈ all messages incl. `body_text` ⋈ `message_events`); `lib/data/company.ts:43-58` (all companies ⋈ all `opportunities` ⋈ all `people`); `lib/data/outreach.ts:77-88` (campaigns ⋈ all `enrollments`); `lib/data/dashboard.ts:400-407` (200 threads ⋈ all their messages to find "last is inbound")
- Evidence: none of these selects bound the parent or the embedded child set; they are mapped to counts or "last item" in JS.
- Impact: payload and render time grow with message volume and enrollments; also subject to the 1 000-row cap (parent level) → silent truncation.
- Root cause: counts and "latest" computed client-side because PostgREST lacks aggregates without views/RPCs.
- Fix: paginate lists; use `count` on embeds (`enrollments(count)`), a `last_direction` column / view on threads, and fetch message bodies only for the opened thread.
- Effort: M · Depends on: — · Mechanizable: yes (same check as PERF-002)
- Status vs last pass: New

### [Medium] PERF-004 — Counts shown as fact are computed by fetching rows, so they cap silently
- Confidence: LIKELY (code CONFIRMED; cap = project `max_rows`, UNVERIFIED)
- Where: `lib/data/hunt-source.ts:117-160` (`evidenceCounts`, `documentCounts` select every row then count in JS); `lib/data/dashboard.ts:328-356` (`company_triggers` / `evidence` `.limit(1000)` then tallied into "signals by type" / "source performance")
- Evidence: `.from("evidence").select("source_id").in("source_id", sourceIds)` → `counts.set(id, (counts.get(id) ?? 0) + 1)`
- Impact: Sources screen's "N claims / N documents" per source (the diagnostic its own comment relies on) and dashboard breakdowns under-count once the totals exceed the cap, with no indication.
- Root cause: same as PERF-003 — aggregation in JS.
- Fix: `count: "exact", head: true` per source (small N) or one grouped RPC; label windowed dashboard breakdowns with their bound.
- Effort: S · Depends on: — · Mechanizable: yes
- Status vs last pass: New

### [Medium] PERF-006 — `/discover` runs site research + an LLM call inside the GET render, with no loading state
- Confidence: CONFIRMED (code)
- Where: `app/(marketing)/discover/page.tsx:65` → `discover/actions.ts:60-160` (`runTask(researchCompany, …)` at ~:133); no `loading.tsx` under `app/(marketing)`
- Evidence: `const state = await discoverAction(d);` executed during render.
- Impact: the top-of-funnel visitor who typed a domain on the landing page sees the old page for the full fetch+model latency (seconds) with no feedback; any prefetch/crawler hit on `/discover?d=` spends allowance.
- Root cause: server-action logic reused as a render-time loader.
- Fix: render the shell immediately and stream the result inside `<Suspense>` (or add `discover/loading.tsx`), keep the call server-side.
- Effort: S · Depends on: — · Mechanizable: no
- Status vs last pass: New

### [Medium] PERF-007 — Every onboarding step blocks render on an Auth call plus a PostHog network flush
- Confidence: CONFIRMED (code); latency LIKELY
- Where: `app/(onboarding)/welcome/{page,company,goals,sources,building,review}/page.tsx` (`await captureForViewer(...)` before rendering); `lib/analytics.ts:124-138,166-176` (`flushAt: 1, flushInterval: 0` then `await posthogClient.flush()`)
- Impact: first-use flow pays an extra `getUser` + an HTTP round trip to `eu.i.posthog.com` per step; a slow PostHog stalls onboarding.
- Root cause: analytics awaited on the render path.
- Fix: wrap in `after(() => captureForViewer(...))` from `next/server`.
- Effort: S · Depends on: — · Mechanizable: yes (grep for awaited `capture` in `page.tsx`)
- Status vs last pass: New

### [Medium] UX-001 — Only a root `error.tsx`: any loader failure inside a workspace replaces the whole app shell
- Confidence: CONFIRMED (file inventory; Next boundary semantics)
- Where: `apps/web/app/error.tsx` is the only segment error boundary; `(app)/[org]` has none; 36 `throw new Error` sites in `lib/data/*.ts`
- Impact: a failed query on one screen (e.g. PERF-002) removes sidebar, nav and account menu; the user sees a bare "This screen failed to load" and can only retry the same thing.
- Root cause: error boundary placed above the org layout only.
- Fix: add `app/(app)/[org]/error.tsx` (inside `OrgShell`) using `ErrorState`, keeping navigation; optional per-heavy-route boundaries.
- Effort: S · Depends on: — · Mechanizable: yes (audit check: each route group with a layout has an `error.tsx`)
- Status vs last pass: New (prior table claimed error coverage via root files only)

### [Medium] UX-003 — Core verbs still absent: hunt now, enrich contact, re-research
- Confidence: CONFIRMED
- Where: no `discover_companies` / `enrich_person` enqueue under `apps/web/app`; `lib/data/engine.ts:85` `requestResearch` has no importer; dashboard "hunt" affordance links to `/sources` and `/analyze` (`dashboard/page.tsx:468-490`)
- Impact: discovery runs only on schedule (`schedule_discovery`) and onboarding; users cannot act on a promising company beyond Analyze/Save.
- Root cause: handlers without in-app triggers (DEBT-001).
- Fix: "Find more like these" (enqueue `discover_companies` for the active ICP through the existing budget guards) and "Re-research" (wire `requestResearch`) on opportunity detail.
- Effort: S–M · Depends on: DEBT-001 · Mechanizable: yes (JOB-REACH)
- Status vs last pass: Still open (F-1, H-1)

### [Medium] UX-004 — Companies list shows sourced/inferred facts with no provenance or freshness
- Confidence: CONFIRMED
- Where: `app/(app)/[org]/companies/CompanyManager.tsx:68-128`; `lib/data/company.ts:35,131` (`lastResearchedAt` loaded, never rendered)
- Evidence: Industry / "People" (= `employee_count`) / Region rendered as plain text or "Unknown"; no `ClaimBadge`/`Freshness` on this screen (they are used on dashboard, detail, intelligence).
- Impact: users cannot tell provider data from AI research from their own edits, or how old it is — against the product's evidence/provenance identity. "People" also collides with the contacts entity.
- Root cause: list built before provenance columns were plumbed.
- Fix: add `Freshness` for `last_researched_at` and a source chip per field (or a row-level "provider/AI/manual" badge); rename column "Headcount".
- Effort: S · Depends on: — · Mechanizable: no
- Status vs last pass: New

### [Medium] UX-005 — Custom workspace slugs can collide with public route prefixes
- Confidence: LIKELY (route precedence not executed)
- Where: `apps/web/lib/slug.ts:39-56` (`RESERVED_SLUGS` lacks `for`, `compare`, `discover`, `privacy`, `terms`, `acceptable-use`, `demo`, `opengraph-image`, `apple-icon`); `app/(onboarding)/welcome/actions.ts:199-241` (custom slug added in `27b2fb6`, auto slug from domain root label); `proxy.ts:60-100` (`PUBLIC_PREFIXES`)
- Evidence/trace: slug `for` or `compare` → `/for/dashboard` matches `(marketing)/for/[useCase]` before `[org]/dashboard` → workspace unreachable. Any public-prefix slug (e.g. auto-derived `discover` from discover.com) → proxy treats `/discover/*` as public, so a signed-out user gets the 404 page instead of the sign-in redirect.
- Impact: a customer can create a workspace they cannot open, or that loses its login redirect.
- Root cause: reserved list maintained by hand, separate from the route tree and `PUBLIC_PREFIXES`.
- Fix: derive reserved slugs from top-level `app/` segments + `PUBLIC_PREFIXES` (audit check), and add the missing names now; enforce in SQL `create_organization` too.
- Effort: S · Depends on: — · Mechanizable: yes
- Status vs last pass: New (regression risk introduced by `27b2fb6`)

### [Medium] UX-010 — Command Center still cannot answer "what changed since I last looked"
- Confidence: CONFIRMED
- Where: `app/(app)/[org]/dashboard/page.tsx:508-512` (fixed 24 h trigger chip only); no last-seen state anywhere (`grep last_seen|lastSeen` → 0)
- Impact: daily users re-scan the whole page; nudges cover only three special cases.
- Fix: persist per-user `last_viewed_at` and show deltas (new opportunities, priority changes, replies) since then.
- Effort: M · Depends on: — · Mechanizable: no
- Status vs last pass: Still open (F-2)

### [Medium] A11Y-002 / TEST-007 — Automated a11y scanning covers 5 pages
- Confidence: CONFIRMED
- Where: `e2e/a11y.spec.ts:16-22` (landing, login, dashboard, opportunities, kitchen-sink) + JumpTo dialog
- Impact: onboarding (first-use), opportunity detail (agent panel, hover panels), settings forms, imports (see A11Y-001), inbox, outreach are never axe-checked; the lint plugin catches only static JSX patterns.
- Fix: iterate axe over the smoke route list already in `e2e/smoke.spec.ts`.
- Effort: S · Depends on: — · Mechanizable: yes
- Status vs last pass: New

### [Medium] TEST-002 — Dependency-advisory step can never fail CI
- Confidence: CONFIRMED
- Where: `.github/workflows/ci.yml` step "Audit — dependency advisories": `continue-on-error: true`; no `.github/dependabot.yml`
- Impact: the prior pass's Critical (Next.js RCE advisory) class of issue now produces a yellow annotation only; nothing schedules or assigns a fix.
- Fix: keep non-blocking on PRs but add a scheduled workflow (or Dependabot) that fails/opens an issue on high/critical; or block only on `critical`.
- Effort: S · Depends on: — · Mechanizable: yes
- Status vs last pass: Regressed from T-1 (gate removed rather than satisfied)

### [Medium] TEST-003 — No reachability checks; the "exists but nothing reaches it" class is still unguarded
- Confidence: CONFIRMED
- Where: `scripts/audit.mjs` check IDs (NAV-01..03, FEAT-*, SEC-*, SEO-*, LEGAL-*, PRV-CHK, PERF-01, REPO-*) — no job, table, cron or UI-copy reachability check
- Impact: DEBT-001 / UX-002 persisted a full pass after being reported.
- Fix: JOB-REACH (every `JobName` in `SWEEPERS` or a literal `enqueue({ name })`), TABLE-REACH (allow-list), CRON (tick workflow or cron references `/api/jobs/tick`).
- Effort: S · Depends on: — · Mechanizable: yes
- Status vs last pass: Still open (19 rec. 1–4)

### [Medium] TEST-004 — CI has no migration apply/drift step
- Confidence: CONFIRMED
- Where: `.github/workflows/ci.yml` (no DB deploy step); migrations applied by hand (prior T-2); memory notes migrations 0011–0029 pending in one project
- Impact: code that needs a migration can deploy before it; `proxy.ts` then 503s production ("migrations-pending").
- Fix: a CI/CD job that runs `db:doctor` against the target and blocks deploy on drift; eventually `supabase db push` on merge.
- Effort: M · Depends on: prod auditor findings · Mechanizable: yes
- Status vs last pass: Still open (T-2)

### [Medium] DEBT-001 — Four job handlers are registered, tested, and unreachable
- Confidence: CONFIRMED
- Where: `packages/jobs/src/queue.ts:42,58,66,77`; `runner.ts:171-196`; tests in `packages/jobs/scripts/verify-jobs.ts:2172-2746`
- Evidence: `grep 'name: "(sync_hubspot|enrich_person|resolve_entity|purge_contact_data)"'` → 0; SQL → 0.
- Impact: root cause of UX-002 and UX-003; dedup (`resolve_entity`) never runs while discovery creates companies; tests give false confidence.
- Fix: wire triggers (see UX-002/UX-003; enqueue `resolve_entity` at end of `discover_companies`, `enrich_person` after `rank_contacts`), or delete handlers + tests.
- Effort: S · Depends on: — · Mechanizable: yes (TEST-003)
- Status vs last pass: Still open (23, C-2, C-4, H-2)

### [Medium] DEBT-002 — `dev-session.mjs` mints and prints a real session for an arbitrary member, with no production guard
- Confidence: CONFIRMED (code; not run)
- Where: `scripts/dev-session.mjs:27-60`
- Evidence: `admin.auth.admin.listUsers()` → first user that has *any* membership → `generateLink` → `verifyOtp` → prints the `sb-<ref>-auth-token` cookie. Unlike `seed.ts:137` there is no `PRODUCTION_REFS` check; the repo notes the production project is "the only project there is".
- Impact: running it locally with prod env impersonates a real customer user and writes a live bearer token to terminal/scrollback/agent transcripts.
- Root cause: dev tool assumes a dev project.
- Fix: refuse unless URL is localhost or ref is in an allow-list of dev projects; select the seeded owner by `--email`, never "first member".
- Effort: S · Depends on: — · Mechanizable: yes
- Status vs last pass: New

### [Low] PERF-008 — Independent awaits run in series on several routes
- Confidence: CONFIRMED
- Where: `lib/data/hunt-source.ts:89-90`; `app/(app)/[org]/sources/page.tsx:31-40`; `team/page.tsx:27-33`; `ops/page.tsx:41-45`; `opportunities/[id]/page.tsx:85`; `lib/data/dashboard.ts:381-407`
- Fix: `Promise.all` each group. Effort: S · Mechanizable: partly · Status: New

### [Low] UX-006 — Operator/developer instructions shown to end users
- Confidence: CONFIRMED
- Where: `sources/SourceManager.tsx:187-192` (pending reason names `CRON_SECRET`, `/api/jobs/tick`, Inngest); `DataSourceBanner.tsx` ("Run them from packages/db/migrations in order")
- Fix: user-facing sentence ("Automatic scanning isn't running on this workspace yet — we've been notified") + operator detail on `/ops`. Effort: S · Status: New

### [Low] UX-007 — Type scale defined as tokens but bypassed: ~650 arbitrary `text-[Npx]`, 30 distinct sizes
- Confidence: CONFIRMED
- Where: `packages/ui/src/tokens.css:77-88` (`--hl-text-*`, 0 consumers, not in `theme.css`); counts: `text-[13px]` 223, `text-[12px]` 183, `text-[11px]` 71 … plus fractional `13.5/12.5/11.5/10.5/14.5/15.5px`
- Impact: typography drifts per screen; tokens cannot be tuned centrally. Colour discipline, by contrast, is good (0 arbitrary `[#hex]` classes; hex only in comments and `global-error.tsx`).
- Fix: expose `--text-*` in `theme.css`, codemod the six common sizes, add an audit check for new `text-[` literals. Effort: M · Mechanizable: yes · Status: New

### [Low] UX-008 — `docs/architecture/design-system.md` describes a different system
- Confidence: CONFIRMED
- Where: doc lines 2, 13-16, 82-88, 103-122 vs `tokens.css:466` (`--hl-brand: #1f58f0`, blue), 29 component files (Modal, Menu, Toast, ConfirmButton, JumpTo, ScoreRing, ScrollRegion, Note, BrandMark unlisted), type sizes differ, "gallery needs no login" but prod 404s it
- Fix: regenerate component table from `packages/ui/src/index.ts`. Effort: S · Status: New

### [Low] A11Y-001 — Visually hidden CSV file input is focusable and unlabeled
- Confidence: LIKELY (axe not run on /imports)
- Where: `app/(app)/[org]/imports/ImportForm.tsx:138-146` (`className="sr-only"`, no `aria-label`, no `tabIndex={-1}`)
- Fix: `tabIndex={-1} aria-hidden` (the visible Button triggers it) or a label. Effort: S · Status: New

### [Low] TEST-005 — ESLint has no React Hooks or Next rules
- Confidence: CONFIRMED
- Where: `eslint.config.mjs` (js, typescript-eslint, jsx-a11y only; 48 `"use client"` files)
- Fix: add `eslint-plugin-react-hooks` (rules-of-hooks, exhaustive-deps) and `@next/eslint-plugin-next`. Effort: S · Status: New

### [Low] DEBT-003 — Built-but-unused UI and loader exports
- Confidence: CONFIRMED
- Where: `ToastProvider` mounted `app/layout.tsx:180`, `useToast` unused; `lib/data` exports `consumeQuota`, `allQuotas`, `getCompany`, `requestResearch`, `latestRecompute`, `listAudit`, `resolveNames`; `validation.ts` `httpUrlSchema`, `qualityRatingSchema`, `describeCompanySchema`; `csp.ts` `cspIsEnforced`
- Fix: wire (`listAudit` → an audit-log view for admins; `requestResearch` → UX-003) or delete. Effort: S · Status: Still open (H-7) / New

### [Low] DEBT-004 — `check-queries.mjs` checks stale hand-copied SELECTs and is not in CI
- Confidence: CONFIRMED
- Where: `scripts/check-queries.mjs:35-107` — `getOrganization` lacks `contact_retention_days` (loader `organization.ts:312`); `listOpportunities`, dashboard, learning, conversation, spend, ops, nudges selects absent
- Fix: export SELECT constants from loaders and import them, or delete the script in favour of TEST-001. Effort: S · Status: New

### [Low] DEBT-005 — Per-instance schema probes cache "missing" forever
- Confidence: CONFIRMED (code); prod impact low because `proxy.ts` 503s production until schema is complete
- Where: `lib/data/source.ts:73-98` (`schemaReady=false` never re-probed), `lib/data/onboarding-schema.ts` (`applied=false` cached) vs `proxy.ts:147-170` (re-probes every 30 s)
- Impact: on previews/dev, a warm instance keeps showing demo data and refusing writes after migrations are applied, while the proxy already treats the app as live.
- Fix: same 30 s re-probe policy as the proxy. Effort: S · Status: New

### [Low] DEBT-006 — Demo mode and `/kitchen-sink` are public on preview deployments
- Confidence: CONFIRMED (code) · Where: `proxy.ts:135,252-280` gate on `VERCEL_ENV === "production"` only; `/kitchen-sink` in `PUBLIC_PREFIXES`
- Impact: a preview URL shared externally shows an unauthenticated fixture product; acceptable by design, but combined with the memory note that one Vercel project has *no env*, a mis-promoted deployment would look like the product. Fix: Vercel deployment protection on previews. Effort: S · Status: Still open (F-6, narrowed)

### [Low] DEBT-007 — Google sign-in hidden "temporarily for testing"; `AuthForm` ignores the anon-key fallback
- Confidence: CONFIRMED
- Where: `app/(auth)/AuthForm.tsx:131-132` (hidden), `app/(auth)/actions.ts:120` (`signInWithGoogle`, no importer); `AuthForm.tsx:37-40` checks only `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, while `lib/data/source.ts:36-40`, `lib/schema.ts:58-63`, `packages/db/src/env.ts:28-30` accept `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- Impact: a deployment configured with only the anon key serves live data behind a login page that says "Sign-in isn't available here yet". Fix: use `supabaseEnv()`; decide on Google and remove the comment or re-enable. Effort: S · Status: New

### [Low] DEBT-008 — Seed's production guard is a one-entry denylist
- Confidence: LIKELY · Where: `packages/db/scripts/seed.ts:128-145` (`PRODUCTION_REFS = new Set(["hnoycsbdddpmsivtmrws"])`); memory records two duplicate production projects
- Impact: seeding "Acme" fixtures into a second prod project is not blocked. Fix: allow-list dev refs instead. Effort: S · Status: New

---

## 6. Do not change

- `pending` on `Button` + NAV-03, and the honest pending reasons on every disabled control.
- `mutate()` / `load()` / `requireOrgId()` seam in `lib/data/org.ts` / `source.ts` (single place for demo/viewer/admin refusals).
- Native `<dialog>` `Modal`, pinned `HoverPanel`, `Menu` keyboard model, `prefers-reduced-motion` handling (`tokens.css:242`, `globals.css:80`), `aria-live` in `States`/`Toast`/`Form`.
- Colour-token discipline (no arbitrary colour classes) and `DataSourceBanner` / `DemoFigures` honesty banners; the production 503 instead of demo (`proxy.ts:258-280`).
- Dashboard's head-count pattern (`countRows`, `dashboard.ts:153-163`) — extend it, don't replace it.
- PGlite RLS isolation suite and bundle budget in CI.

## 7. Could not verify

- Actual latencies (no server run); Supabase `max_rows` setting and gateway URL limit (PERF-002/004); build output confirming the dev-bypass branch is eliminated; axe results on unscanned pages; region pairing Vercel↔Supabase; current `npm audit` result (left to lead).
