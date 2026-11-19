# Huntloop — Repository Audit

> **Audit date:** 2026-10-13 · **Code audited:** `main` @ `8021d3f` (= `origin/main`, working tree clean) · **Auditor:** Claude Code (read-only audit; no code, configuration or data was changed)
>
> **Scope:** every tracked file in the repository (729 files; ≈132,600 lines of TypeScript/TSX/SQL/MJS), the local test and build toolchain, the public production health endpoint, and the GitHub repository metadata visible to the local `gh` CLI.
>
> **Not in scope / not accessible:** the production database contents, the Vercel and Supabase dashboards, vendor accounts (Anthropic, Apollo, Hunter, ZeroBounce, Google, Microsoft, HubSpot, Resend, Sentry, PostHog), signed-in production flows, and DNS/mail configuration. Nothing in this report about those systems is verified unless it says so.

### How to read the status labels

| Label | Meaning |
|---|---|
| **VERIFIED** | Implemented, and exercised by a test or a check that ran green during this audit (2026-10-13). |
| **IMPL-UNVERIFIED** | Code exists and is wired to a reachable entry point, but nothing observed during this audit proves it works against real dependencies. |
| **PARTIAL** | Some of the path exists; a link in the chain (producer, UI, configuration, vendor) is missing. |
| **BROKEN** | Observed not to work in an environment it is supposed to work in. |
| **MOCK** | Renders fixtures / "worked example" output by design when a dependency is absent. |
| **PLANNED** | Documented intent, no implementation. |
| **MISSING** | Required or promised, neither implemented nor planned in code. |
| **DEAD** | Implemented but unreachable or unused. |

Evidence tags: **[C]** confirmed by reading code or running a command · **[R]** observed at runtime (test, build, HTTP) · **[I]** inferred risk (reasoned, not reproduced) · **[M]** requires manual verification.

---

## 1. Executive summary and overall project status

**Huntloop** is an AI-native B2B sales-intelligence web application. Its premise (README, Master Context) is that the unit of value is a *qualified opportunity with evidence* — "why is this company worth contacting now" — rather than a lead list. It discovers companies that fit a customer's ideal-customer profile (ICP), collects evidence and buying triggers, scores opportunities on eight explainable dimensions (with "unknown" never shown as zero), drafts and sends personalised outreach through the user's own mailbox, and learns from outcomes.

**Development stage:** late pre-launch / private beta-ready code, *not* yet operating in production. Version `0.1.0` (tagged `v0.1.0`), plus an `[Unreleased]` security release that is now merged and deployed.

### Headline findings

1. **The code base is large, coherent and unusually well tested.** Typecheck, lint, ≈1,520 unit/integration assertions, a 10-case security-regression suite, a 44-check repository audit, a production build, a bundle budget, and 316 Playwright tests (desktop + mobile, 4 skipped by design) all passed locally during this audit [R]. `npm audit` reports 0 vulnerabilities [R]. One vitest test timed out on a cold run and passed on re-run (flaky, §11).
2. **Production is deployed but not operational** [R]. `https://seefluence.com/api/health` (2026-10-13) reports commit `8021d3f`, schema `complete`, service key present — but `ok:false` / HTTP 503 because **no engine driver** (`cronSecret:false`, `inngest:false`), **no credential-encryption key**, and **no integration keys at all** (Anthropic, Apollo, Hunter, ZeroBounce, Gmail, Outlook, Sentry, PostHog, Resend). Consequence: nothing is discovered, scored, drafted, sent, synced or learned in production; AI screens show worked examples; mailboxes and HubSpot cannot be connected; no product email is sent.
3. **The background engine has no heartbeat anywhere.** `apps/web/vercel.json` contains no cron [C]; the GitHub Actions `Engine tick` workflow fails on every scheduled run because the repository has no `CRON_SECRET` secret or `HUNTLOOP_URL` variable [R].
4. **No AI task, data provider, mailbox provider or CRM call has ever been observed against a live vendor** — neither production nor the local environment has the keys [R][C]. All of these are tested only against scripted fakes.
5. **Known functional gaps:** no billing/checkout; legal pages are unpublished drafts (7 facts pending); entity de-duplication and person enrichment (Hunter/ZeroBounce) are dead code paths; a removed company cannot be re-added; the Free plan includes 0 emails while onboarding offers "Reach out".
6. **Documentation drift:** the repository holds a very large body of planning/audit documents; several top-level ones (README, COMMAND.md header, CHANGELOG "Unreleased", engine comments) contradict current code or production state (§17).

### Overall status by layer

| Layer | Status | Basis |
|---|---|---|
| Web UI (54 pages, 137 server actions) | IMPL-UNVERIFIED for signed-in flows; VERIFIED in demo mode | Playwright runs demo mode only [R] |
| Database schema (47 migrations, 81 tables, RLS on all) | VERIFIED (PGlite) | `npm test` (351 migration checks, tenant isolation, security leads) [R]; prod probe shows newest table present [R] |
| Job engine (34 handlers) | IMPL-UNVERIFIED; **BROKEN in prod** (no driver) | 316 job checks pass [R]; health/tick evidence [R] |
| AI layer (16 tasks) | IMPL-UNVERIFIED (never called live) | 229 scripted-client checks [R] |
| Providers (Apollo/Hunter/ZeroBounce), CRM (HubSpot), Mail (Gmail/Outlook/Resend) | IMPL-UNVERIFIED (never called live) | 81 + 20 checks [R]; adapter caveats in code [C] |
| Billing | MISSING | Stripe variables read by no code [C] |
| Production operations | BROKEN (configuration) | `/api/health` 503 [R] |

---

## 2. Project purpose, scope, architecture and technology stack

### 2.1 Identity

| Item | Value | Evidence |
|---|---|---|
| Name | Huntloop (served at `seefluence.com` → `www.seefluence.com`) | `package.json`, `/api/health` `siteUrl` |
| Author | Chandra Mani Sharma | `package.json`, `README.md`, `NOTICE` |
| Repository | `github.com/arpitcoding007-star/Huntloop` (public per project notes [M]) | `gh` |
| Version | `0.1.0` (tag `v0.1.0`) + merged unreleased security work | `CHANGELOG.md` |
| Governing product docs | `HuntLoop — Master Product, Technical & Engineering Context.md` > `Project_Creation.md` > `IMPLEMENTATION_PLAN.md` (precedence per README) | `README.md` |

### 2.2 Target users (from docs, consistent with code)

B2B founders and small sales teams prospecting accounts (roles in code: owner, admin, member, viewer). A "personal workspace" mode exists for individuals (`/welcome/start`, K-series). See `docs/product/audiences.md`.

### 2.3 Product principles enforced in code

- **Fact ≠ inference ≠ unknown.** Enforced by DB constraints (a fact needs a source; unmeasured score dimensions stay `NULL`) and by `packages/ai/src/claims.ts` [C][R].
- **Explainable scores** across eight named dimensions (`icp_fit`, `problem_severity`, `evidence_strength`, `trigger_strength`, `trigger_freshness`, `buying_likelihood`, `product_relevance`, `decision_maker_accessibility`) [C].
- **Human accepts durable AI output** (findings, rules, ICP proposals are proposals until accepted) [C].
- **Web content is untrusted data**: all 16 AI tasks use `wrapUntrusted` / `UNTRUSTED_CONTENT_RULE` (`packages/ai/src/untrusted.ts`) [C].

### 2.4 Architecture

```
Browser ──► Vercel (Next.js 16 App Router, apps/web)
             │  proxy.ts: session refresh · route guard · per-request CSP nonce · prod readiness gate (503)
             │  Server Components → lib/data/* loaders (RLS-scoped Supabase client)
             │  Server Actions (137) → mutate() → RLS-scoped writes / RPCs
             │  Route handlers (14): /api/jobs/tick, /api/inngest, /api/health, mailbox OAuth, unsubscribe…
             ▼
Supabase (Postgres + Auth) ── RLS on all 81 tables; SECURITY DEFINER RPCs for engine/quota/onboarding
             ▲
             │ service-role client (confined to 5 files; CI-enforced)
packages/jobs ── job_executions queue (claim … for update skip locked) ── 34 handlers
             ├─ packages/ai        (Anthropic SDK, 16 tasks, claim validation, run recording)
             ├─ packages/providers (Apollo / Hunter / ZeroBounce adapters, budget, cache, circuit breakers, ledger)
             ├─ packages/crm       (HubSpot adapter)
             ├─ mailbox/           (Gmail, Outlook OAuth + send/sync)
             └─ email/             (Resend product email + templates)
Heartbeat: GitHub Actions */5 → GET /api/jobs/tick (Bearer CRON_SECRET)  — or Inngest → POST /api/inngest
```

Key boundary decisions [C]: RLS is the tenant boundary (the proxy guard is a convenience); `OrgScope` (`packages/jobs/src/scope.ts`) binds every handler to one org; `check-admin-imports.ts` fails CI if `apps/` imports the service-role client; demo mode (no Supabase env or no schema) renders fixtures everywhere except on the production deployment, which answers 503.

### 2.5 Technology stack (installed versions, 2026-10-13)

| Area | Technology | Version |
|---|---|---|
| Runtime | Node.js (engines `>=22.6`; CI uses 24; local 24.19.0) | — |
| Framework | Next.js App Router + Turbopack, React | next 16.4.0, react 19.2.8 |
| Language | TypeScript | 5.9.3 |
| Styling | Tailwind CSS v4, custom tokens (`packages/ui/src/tokens.css`) | tailwindcss 4.3.3 |
| Database/Auth | Supabase (Postgres, Auth magic link + optional Google OAuth) | supabase-js 2.112.3, @supabase/ssr 0.5.2 |
| AI | Anthropic SDK; models `claude-opus-5`, `claude-sonnet-5`, `claude-haiku-4-5` (`packages/ai/src/models.ts`) | @anthropic-ai/sdk 0.116.0 |
| Validation | Zod | 4.4.3 |
| Documents | unpdf (PDF), DOCX parser in `lib/document-text.ts` | unpdf 1.8.1 |
| HTTP (engine fetch) | undici | 8.11.2 |
| Observability | Sentry (`@sentry/nextjs`), PostHog (`posthog-node`) | 10.70.0, 5.49.0 |
| Product email | Resend (HTTP API, no SDK) | — |
| Testing | Vitest, Testing Library, jsdom, PGlite (in-process Postgres), Playwright + axe-core | vitest 4.1.11, pglite 0.2.17, playwright 1.62.1 |
| Lint | ESLint 9 + typescript-eslint + jsx-a11y | eslint 9.39.5 |
| Hosting | Vercel (Root Directory `apps/web`) | — |
| CI | GitHub Actions (`ci.yml`, `tick.yml`) | — |

---

## 3. Repository and directory inventory

npm-workspaces monorepo (`apps/*`, `packages/*`).

| Path | Purpose | Size | Notes |
|---|---|---|---|
| `apps/web` | Next.js app: marketing site, auth, onboarding, workspace (`[org]`), API routes | 54 pages, 14 route handlers, 39 action files, 54 data-loader modules (+3 tests) | `proxy.ts`, `next.config.ts`, Sentry configs, `vitest.config.mts` |
| `apps/web/app/(marketing)` | `/`, `/discover`, `/for/[useCase]`, `/compare/[approach]`, legal pages | 15 files | Landing page is 1,168 lines |
| `apps/web/app/(auth)` | `/login`, `/signup`, `AuthForm`, magic-link/Google actions | 6 files | |
| `apps/web/app/(onboarding)/welcome` | 8-step onboarding | 25 files | |
| `apps/web/app/(app)/[org]` | 33 workspace screens + shell | ≈140 files | Guarded by `layout.tsx` membership check |
| `apps/web/app/api` | Machine endpoints | 10 files | |
| `apps/web/lib` | Data loaders (`data/`), AI wrappers (`ai/`), validation, CSP, rate limit, CSV, legal, learning, performance | ≈125 files | |
| `packages/ui` | Design system: 29 components, tokens, theme | 45 files | 42 component tests |
| `packages/db` | 47 migrations (+1 combined paste bundle), typed clients, domain logic (ICP, rules, identity, contact, needs-you, preferences), scripts (doctor, seed, schema reference, verification suites) | 76 files | |
| `packages/jobs` | Queue, runner, 34 handlers, mailbox providers, Resend email, public research, first-run | 57 files | 3,508-line verification suite |
| `packages/ai` | 16 LLM tasks, client, model routing/pricing, claims validation | 29 files | 2,363-line verification suite |
| `packages/providers` | Provider contract, registry, budget, cache, ledger, Apollo/Hunter/ZeroBounce | 13 files | |
| `packages/crm` | HubSpot adapter + contract | 6 files | |
| `e2e/` | Playwright specs (8 files, 160 tests × 2 projects) | | Demo mode only |
| `scripts/` | Repo audit (`audit.mjs`), bundle budget, demo/dev helpers, query helpers | 7 files | |
| `.github/workflows` | `ci.yml` (verify + e2e), `tick.yml` (engine heartbeat) | 2 files | |
| `docs/` | GitBook-style docs (architecture, developer, operations, product, security, status, decisions) and the **spec pack** `docs/spec/` (PRD, TRD, App Flow, Design Brief, Schema, Plan, Gap Report, generated schema reference) | ≈60 files | Several status pages are bannered as stale |
| `audit/` | Historical audit passes 11–14 and a 28-file "full-system" audit | ≈50 files | Historical |
| `design/` | Meridian design hand-off (HTML/CSS) | 4 files | |
| `HuntLoop_SVGs/` | Brand SVGs | 3 files | |
| Root docs | `README.md`, `SETUP.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, `COMMAND.md` (1,920-line interaction map), `PROJECT_AUDIT.md`, `IMPLEMENTATION_PLAN.md`, `DELIVERY_PLAN.md`, `Project_Creation.md`, Master Context, `Migrate.md` (319 KB), `New_Aud.md`, `explee.md`, `checklist.md`, `NOTICE` | | See §17 on sprawl |
| Untracked local | `.env.local` (root), `apps/web/.env.local`, `.vercel/`, `.brand-tmp/`, `test-results/`, `.next/` | | Git-ignored; values not inspected |

---

## 4. Feature and functionality inventory

Status reflects production reality where it differs from local. "Prod" column: what a real user at seefluence.com experiences today given `/api/health`.

| ID | Feature | Main locations | Local status | Prod status | Notes |
|---|---|---|---|---|---|
| F-01 | Magic-link sign-in / sign-up (enumeration-safe, rate-limited) | `app/(auth)/actions.ts:62`, `app/auth/callback/route.ts` | IMPL-UNVERIFIED (demo E2E covers forms) | IMPL-UNVERIFIED [M] | Product email domain auth (SPF/DKIM/DMARC) unknown [M] |
| F-02 | Google OAuth sign-in | `app/(auth)/actions.ts:120`, `AuthForm.tsx:53` | IMPL-UNVERIFIED | Hidden unless `NEXT_PUBLIC_AUTH_GOOGLE=true` [M] | |
| F-03 | Workspace creation & picker, last-workspace cookie | `welcome/actions.ts` (`createWorkspace`, `provision`), `app/(app)/orgs/page.tsx`, `proxy.ts:362` | IMPL-UNVERIFIED | IMPL-UNVERIFIED | `create_organization` RPC (0030) |
| F-04 | Onboarding (you → first job → company → goals → ICP → sources → building → review) | `app/(onboarding)/welcome/**`, `lib/onboarding/steps.ts`, `packages/jobs/src/first-run.ts` | IMPL-UNVERIFIED (state persisted, 0024) | Company research = worked example (no AI key) | |
| F-05 | Personal mode / start from a task | `welcome/start`, `PersonalStartCard.tsx` | IMPL-UNVERIFIED | same | K1 |
| F-06 | Command Center dashboard, alert chips, nudges, "Needs you" rail, Hunt now | `dashboard/page.tsx` (670), `lib/data/dashboard.ts`, `nudges.ts` | VERIFIED (demo E2E) | Renders; "Hunt now" enqueues work nothing runs | |
| F-07 | Needs-you queue (ranked, snooze, reach-out goal, log touch, draft) | `needs-you/*`, `packages/db/src/needs-you.ts` | VERIFIED (unit + demo E2E) | IMPL-UNVERIFIED | |
| F-08 | Opportunities list (filters, product filter, stale view, bulk archive/enroll) | `opportunities/OpportunityTable.tsx`, `opportunities/actions.ts` | VERIFIED (demo) | No new opportunities without engine | |
| F-09 | Opportunity detail (evidence, scores, brief sections, agent Q&A, activity, next step, deal value, disagree/override, assign, CRM push) | `opportunities/[id]/*` (11 files) | VERIFIED (demo render); actions IMPL-UNVERIFIED | AI agent = unavailable; CRM push enqueues only | |
| F-10 | Companies list + detail | `companies/*` | VERIFIED (demo) | IMPL-UNVERIFIED | **Bug B-03/B-04** |
| F-11 | Analyze a URL (qualify + why-now, seal-and-save) | `analyze/*`, `lib/ai/qualify.ts`, `lib/ai/why-now.ts`, `lib/ai/seal.ts` | IMPL-UNVERIFIED (spend guard tests) | MOCK (no AI key) | |
| F-12 | CSV imports | `imports/*`, `lib/csv.ts` | VERIFIED (csv unit tests) | IMPL-UNVERIFIED | Invalid email cells not stored (0047 fix) |
| F-13 | Outreach: campaigns, sequences, steps, autonomy, enrollments, mailbox connect/disconnect | `outreach/*` (958-line manager), `api/mailboxes/**` | IMPL-UNVERIFIED | **BROKEN**: mailbox connect refused (`MAILBOX_ENCRYPTION_KEY`, OAuth creds absent) | |
| F-14 | Outreach log (all channels, outcomes) | `outreach/log/*`, `lib/outreach-log/outcome.ts` | VERIFIED (unit + demo E2E) | IMPL-UNVERIFIED | |
| F-15 | Inbox (threads, approve/edit/reject/redraft drafts, reply, assign) | `inbox/*` (700 + 570 lines) | VERIFIED (demo E2E) | Empty without mailbox sync | |
| F-16 | Pipeline board (stages, values, last touch) | `pipeline/*` | VERIFIED (demo) | IMPL-UNVERIFIED | |
| F-17 | Performance analytics (funnel, cohorts, breakdowns, goals, AI narrative, CSV export, printable share report) | `performance/**`, `lib/performance/compute.ts` (710) | VERIFIED (compute unit tests, demo E2E) | Narrative MOCK (no AI) | |
| F-18 | AI spend dashboard | `analytics/*`, `lib/data/spend.ts` | VERIFIED (demo) | Shows zero real runs | |
| F-19 | Intelligence (fact vs inference ratio, evidence) | `intelligence/page.tsx` | VERIFIED (demo E2E) | IMPL-UNVERIFIED | Read-only by design |
| F-20 | Learn (performance analysis runs, findings → rules/memories) | `learn/*`, `jobs/handlers/analyze-performance.ts` | IMPL-UNVERIFIED | Analysis never runs (no engine/AI) | |
| F-21 | Memory (house notes, pages, PDF/DOCX ingest) | `memory/*`, `api/memory/extract`, `lib/document-text.ts` | VERIFIED (document-text tests) | IMPL-UNVERIFIED | PDF bomb/page limits (0047 lead 13) |
| F-22 | Ask Huntloop (workspace assistant, multi-conversation, citations, "What it can see") | `assistant/*`, `lib/ai/workspace-assistant.ts`, `lib/ai/workspace-context.ts` | IMPL-UNVERIFIED | MOCK/unavailable (no AI) | |
| F-23 | Prospect demand themes (cluster, rename, merge, assign) | `demand/*`, `jobs/handlers/{schedule,cluster}-demand.ts` | IMPL-UNVERIFIED | No signals (no mailbox sync) | |
| F-24 | Competitors (add, research, evidence, prospect their customers) | `competitors/**`, `jobs/handlers/research-competitor.ts`, `prospect-competitor-customers.ts` | IMPL-UNVERIFIED | Research requested but never runs | |
| F-25 | Products (multi-product, draft from website) | `settings/product/*` | IMPL-UNVERIFIED | Draft = unavailable (no AI) | |
| F-26 | ICP editor, personas, ICP proposals, look-alike preview, search preview | `settings/icp/*` (794-line editor), `packages/db/src/icp.ts` | VERIFIED (ICP unit tests) | Look-alike/reach need Apollo | |
| F-27 | Scoring rules (AI draft, preview, activate, recompute) | `settings/scoring/*`, `packages/db/src/rules.ts` | VERIFIED (59 rule checks) | Recompute never runs | |
| F-28 | Sources (add, enable, scan now, interval, suggest, restore) | `sources/*`, `jobs/handlers/scan-source.ts` | IMPL-UNVERIFIED | Scans never run | |
| F-29 | Integrations: HubSpot connect/disconnect + sync | `settings/integrations/*`, `packages/crm`, `jobs/handlers/sync-hubspot.ts` | IMPL-UNVERIFIED (never against a live portal, per `hubspot.ts` header) | **BROKEN**: token cannot be encrypted (no key) [I] | |
| F-30 | Data & privacy (erase contact, export contact/org, delete org, delete account, retention) | `settings/privacy/*`, `jobs/handlers/enforce-retention.ts` | VERIFIED (DB-level tests) | IMPL-UNVERIFIED | `purge_contact_data` job DEAD |
| F-31 | Settings → You (personal learning: correct, pause, forget, share, export) | `settings/you/*`, `lib/data/personal-learning.ts` | IMPL-UNVERIFIED | inference never runs | |
| F-32 | Just-in-time questions | `QuestionCard.tsx`, `questions-actions.ts`, `lib/questions/*` | VERIFIED (planner tests) | IMPL-UNVERIFIED | |
| F-33 | Team: roles, remove, invite (seat quota, Resend email), join requests, assignments | `team/**`, `invite/[token]/*` | VERIFIED (DB tests for roles/joins) | Invitation email not sent (no Resend); copy-link works [I] | |
| F-34 | Engine (ops) board: queue pressure, retry/cancel jobs | `ops/*`, `lib/data/ops.ts`, `0019_ops_views.sql` | IMPL-UNVERIFIED | Shows no activity | |
| F-35 | Notifications & daily digest email | `settings/NotificationsForm.tsx`, `jobs/handlers/send-{notifications,digests}.ts`, `api/notifications/unsubscribe` | IMPL-UNVERIFIED | No email (no Resend, no engine) | |
| F-36 | Unsubscribe (page + RFC 8058 one-click) | `unsubscribe/[token]/*`, `api/unsubscribe/[token]/route.ts` | VERIFIED (security-leads case) | IMPL-UNVERIFIED | Tokens moved to `message_unsubscribe_tokens` (0047) |
| F-37 | Anonymous domain research `/discover` | `(marketing)/discover/*`, `packages/jobs/src/public-research.ts` | VERIFIED (reservation case) | Off unless `PUBLIC_RESEARCH_ENABLED=true` [M] | |
| F-38 | Marketing site, use-case & comparison pages, SEO (sitemap, robots, OG) | `(marketing)/**`, `app/sitemap.ts`, `app/robots.ts`, `opengraph-image.tsx` | VERIFIED (site audit, E2E) | Live | |
| F-39 | Legal pages (privacy, terms, acceptable use) | `(marketing)/{privacy,terms,acceptable-use}`, `lib/legal.ts` | PARTIAL | Draft, noindex, unlinked (7 facts PENDING) [R] | |
| F-40 | Billing / plans / checkout | `plans` table, `lib/data/plans.ts`, `.env.example` Stripe vars | **MISSING** | MISSING | Quotas enforced; no way to upgrade |
| F-41 | Usage quotas (opportunities, ai_runs, emails, enrich, seats) | `check_quota_internal`, `lib/ai/budget.ts` | VERIFIED (DB) | Enforced where reachable | Fail-open paths (B-06, B-07) |
| F-42 | Rate limiting | `lib/rate-limit.ts`, `0005_rate_limits.sql` | VERIFIED (unit + DB) | IMPL-UNVERIFIED (no load test) | |
| F-43 | Record search (⌘K) | `packages/ui/src/components/JumpTo.tsx` | PARTIAL | Navigation jump-to only, by design | |
| F-44 | Entity de-duplication / company merge | `jobs/handlers/resolve-entity.ts`, `merge_companies_for_org`, `merge_candidates`, `company_merges` | **DEAD** | DEAD | No producer, no caller, no UI |
| F-45 | Person enrichment + email verification (Hunter, ZeroBounce) | `jobs/handlers/enrich-person.ts` | **DEAD** | DEAD | `ENRICHMENT_API_KEY` / `EMAIL_VERIFICATION_API_KEY` have no effect |
| F-46 | Design-system gallery `/kitchen-sink` | `app/kitchen-sink/page.tsx` | VERIFIED (a11y E2E) | 404 in production by design | |
| F-47 | MFA / SSO / SCIM / session management | — | MISSING | MISSING | "Recommended" in Master Context |
| F-48 | Profile edit (email, avatar) | `profiles.avatar_url` | MISSING | MISSING | |
| F-49 | In-app notification centre / toasts | `Toast.tsx` (provider mounted in `app/layout.tsx`) | DEAD | DEAD | `useToast` used only by `/kitchen-sink` |

---

## 5. Pages, routes, navigation and UI component inventory

### 5.1 Request pipeline (applies to every route)

`apps/web/proxy.ts` (matcher excludes static assets, images, `robots.txt`, `humans.txt`, `sitemap.xml`):

1. Mints a CSP nonce, sets CSP (report-only unless `CSP_ENFORCE=true`) and `Reporting-Endpoints` on every branch (`proxy.ts:228-253`).
2. In production: `/kitchen-sink`, `/dev/onboarded` → 404 (`proxy.ts:268`).
3. No Supabase env → demo mode; in production → 503 page except `/` and `SERVED_WHILE_NOT_READY` (`proxy.ts:133`, `:283`).
4. Probes schema via PostgREST (`lib/schema.ts`): `organizations` (0001) and `LATEST_TABLE = message_unsubscribe_tokens` (0047). `none` → demo/503; `partial` in production → 503 (`proxy.ts:287-293`). Network error fails closed to `complete`.
5. `supabase.auth.getUser()` (verified, not `getSession`).
6. Anonymous + non-public + `/`-excluded: unknown path → rewritten 404; known protected shape (`lib/protected-routes.ts`) → redirect to `/login?next=` (or `/signup` for `/invite/*`).
7. Signed in + workspace path → sets `huntloop.org` cookie (slug-shape validated).

Static security headers (`next.config.ts`): HSTS (no preload), `nosniff`, `X-Frame-Options: DENY`, `frame-ancestors 'none'`, strict referrer, restrictive Permissions-Policy; `poweredByHeader:false`.

### 5.2 Workspace navigation (`app/(app)/[org]/OrgShell.tsx:150-300`)

| Group | Items (route) |
|---|---|
| Home | Command Center (`/dashboard`) |
| Hunt | Opportunities · Companies · Analyze a URL · Imports |
| Engage | Needs you (count badge) · Outreach · Outreach log · Inbox · Pipeline |
| Learn | Performance · Ask Huntloop (AI) · Intelligence (AI) · What we've learned (`/learn`, AI) · Memory · Prospect demand (`/demand`) |
| Company | Product · ICP (AI) · Sources · Competitors |
| Team | Members · Assignments |
| Operate | Engine (`/ops`) · AI spend (`/analytics`) |
| Settings | General · You · Product · ICP · Scoring · Integrations · Data & privacy |

Also: TopBar with ⌘K jump-to (navigation only), account menu (`AccountMenu.tsx`), theme toggle, `/orgs` workspace switch, skip link to `#main`. Not in the nav (reached by links): `/opportunities/{id}`, `/companies/{id}`, `/competitors/{id}`, `/performance/report`. There is **no** `/{org}` index page — a bare workspace URL renders 404 [C] (nothing in the code links to it [C]).

Shared shell elements rendered by `app/(app)/[org]/layout.tsx`: `DataSourceBanner` (demo/unmigrated), `SetupCard` (unfinished onboarding), membership guard (`currentViewer` → `notFound()`).

### 5.3 Page inventory (54 pages)

Columns: route · page file (lines) · data loaders (`apps/web/lib/data/*`) · main client components · server-action files in the same folder. All workspace pages live under `apps/web/app/(app)/[org]/`.

| Route | Page file (lines) | Loaders | Client components | Actions |
|---|---|---|---|---|
| `/` | `(marketing)/page.tsx` (1168) | destination, plans | MobileNav, DomainInput, LoopDiagram | — |
| `/discover` | `(marketing)/discover/page.tsx` (241) | destination | DomainInput | `discover/actions.ts` |
| `/for/{useCase}` | `(marketing)/for/[useCase]/page.tsx` (212) | destination | — | — |
| `/compare/{approach}` | `(marketing)/compare/[approach]/page.tsx` (210) | destination | — | — |
| `/privacy` · `/terms` · `/acceptable-use` | `(marketing)/{privacy,terms,acceptable-use}/page.tsx` (280/205/147) | — (`lib/legal.ts`) | LegalPage | — |
| `/login` · `/signup` | `(auth)/login/page.tsx` (75), `(auth)/signup/page.tsx` (116) | — | AuthForm | `(auth)/actions.ts` |
| `/welcome` | `(onboarding)/welcome/page.tsx` (115) | destination, source | YouForm | `welcome/actions.ts` |
| `/welcome/start` | `…/start/page.tsx` (75) | destination, source | StartStep | (parent actions) |
| `/welcome/company` | `…/company/page.tsx` (80) | directory, onboarding-schema, source | CompanyStep, JoinExisting | `company/actions.ts` |
| `/welcome/goals` | `…/goals/page.tsx` (34) | onboarding | GoalsStep | (parent) |
| `/welcome/icp` | `…/icp/page.tsx` (27) | onboarding | IcpStep (876) | `icp/actions.ts` |
| `/welcome/sources` | `…/sources/page.tsx` (18) | — | SourcesStep | `sources/actions.ts` |
| `/welcome/building` | `…/building/page.tsx` (19) | engine | BuildingStep | `building/actions.ts` |
| `/welcome/review` | `…/review/page.tsx` (258) | onboarding, opportunities, scoring | FinishButton | (parent) |
| `/orgs` | `(app)/orgs/page.tsx` (199) | destination, directory | — | — |
| `/invite/{token}` | `invite/[token]/page.tsx` (105) | source | AcceptInvite | `invite/[token]/actions.ts` |
| `/unsubscribe/{token}` | `unsubscribe/[token]/page.tsx` (64) | — | UnsubscribeForm | `unsubscribe/[token]/actions.ts` |
| `/kitchen-sink` | `kitchen-sink/page.tsx` (914) | — | all UI components | — (404 in prod) |
| `/{org}/dashboard` | `dashboard/page.tsx` (670) | chrome, dashboard, icp-quality, membership, needs-you, nudges, onboarding, personal-learning, personalization, questions | HuntNowButton, PersonalStartCard, LearningNewsCard, IcpQualityCard, LearningNudge | `dashboard/actions.ts` |
| `/{org}/needs-you` | `needs-you/page.tsx` (132) | membership, needs-you, onboarding, personalization | NeedsYouList, ClearSnoozesButton, ReachOutGoal | `needs-you/actions.ts` |
| `/{org}/opportunities` | `opportunities/page.tsx` (118) | membership, onboarding, opportunities, outreach, personalization | OpportunityTable (692) | `opportunities/actions.ts` |
| `/{org}/opportunities/{id}` | `opportunities/[id]/page.tsx` (491) | activity, company-intel, conversation, membership, nudges, opportunities, outreach, team | AgentPanel, ActivityPanel, NextStepBar, OpportunityActions, BriefSections, DealValue, ResearchThisButton | `actions.ts`, `activity-actions.ts`, `brief-actions.ts` |
| `/{org}/companies` | `companies/page.tsx` (37) | company, membership | CompanyManager (483) | `companies/actions.ts` |
| `/{org}/companies/{id}` | `companies/[id]/page.tsx` (226) | activity, company, company-intel, company-page, membership, opportunity-map | — | — |
| `/{org}/analyze` | `analyze/page.tsx` (58) | membership, questions | Analyzer (487) | `analyze/actions.ts` |
| `/{org}/imports` | `imports/page.tsx` (55) | company, membership | ImportForm | `imports/actions.ts` |
| `/{org}/outreach` | `outreach/page.tsx` (103) | membership, outreach | OutreachManager (958) | `outreach/actions.ts` |
| `/{org}/outreach/log` | `outreach/log/page.tsx` (89) | membership, outreach-log | OutreachLogTable | — |
| `/{org}/inbox` | `inbox/page.tsx` (66) | inbox, membership, questions, team | InboxView (700) | `inbox/actions.ts` |
| `/{org}/pipeline` | `pipeline/page.tsx` (81) | competitors, membership, pipeline, team | PipelineBoard | `pipeline/actions.ts` |
| `/{org}/performance` | `performance/page.tsx` (395) | membership, onboarding, performance, personalization | Breakdowns, GoalsCard, Narrative | `performance/actions.ts` |
| `/{org}/performance/report` | `performance/report/page.tsx` (245) | chrome, competitor-intel, membership, performance | PrintButton | — |
| `/{org}/analytics` | `analytics/page.tsx` (195) | membership, spend | SpendTable | — |
| `/{org}/intelligence` | `intelligence/page.tsx` (214) | intelligence, membership | — (server only) | — |
| `/{org}/learn` | `learn/page.tsx` (68) | engine, learning, membership, source | LearningReview (464) | `learn/actions.ts` |
| `/{org}/memory` | `memory/page.tsx` (57) | membership, memory, memory-subjects | MemoryManager (769) | `memory/actions.ts` |
| `/{org}/assistant` | `assistant/page.tsx` (143) | assistant, membership, product, questions, source | AssistantChat, WhatItCanSee | `assistant/actions.ts` |
| `/{org}/demand` | `demand/page.tsx` (47) | demand, membership | DemandBoard | `demand/actions.ts` |
| `/{org}/competitors` | `competitors/page.tsx` (48) | competitor-intel, membership | CompetitorList | `competitors/actions.ts` |
| `/{org}/competitors/{id}` | `competitors/[id]/page.tsx` (266) | competitor-intel, membership | CompetitorEditor | (parent) |
| `/{org}/sources` | `sources/page.tsx` (105) | engine, hunt-source, membership, org | SourceManager (709) | `sources/actions.ts` |
| `/{org}/team` | `team/page.tsx` (69) | directory, membership, org, team | MemberList, JoinRequests | `team/actions.ts` |
| `/{org}/team/assignments` | `team/assignments/page.tsx` (58) | membership, team | AssignmentBoard | (parent) |
| `/{org}/ops` | `ops/page.tsx` (62) | engine, membership, ops, org | OpsBoard | `ops/actions.ts` |
| `/{org}/settings` | `settings/page.tsx` (66) | membership, notifications, organization | OrgSettingsForm, OrgVoiceForm, NotificationsForm | `settings/actions.ts`, `notification-actions.ts` |
| `/{org}/settings/you` | `settings/you/page.tsx` (34) | membership, personal-learning | YouManager | `settings/you/actions.ts` |
| `/{org}/settings/product` | `settings/product/page.tsx` (40) | membership, product | ProductList, ProductForm | `settings/product/actions.ts` |
| `/{org}/settings/icp` | `settings/icp/page.tsx` (62) | discovery-preview, icp, icp-proposal, membership, product | IcpEditor (794), SearchPreview, ProfileProposal | `settings/icp/actions.ts` |
| `/{org}/settings/scoring` | `settings/scoring/page.tsx` (37) | membership, scoring | ScoringRules (683) | `settings/scoring/actions.ts` |
| `/{org}/settings/integrations` | `settings/integrations/page.tsx` (38) | integrations, membership | IntegrationsForm | `settings/integrations/actions.ts` |
| `/{org}/settings/privacy` | `settings/privacy/page.tsx` (55) | membership, organization | PrivacyControls | `settings/privacy/actions.ts` |

Shared states: `app/(app)/[org]/error.tsx`, `[org]/loading.tsx`, `opportunities/loading.tsx`, `welcome/loading.tsx`, `app/error.tsx`, `app/global-error.tsx`, `app/not-found.tsx`. Most workspace pages have no route-specific loading skeleton (they inherit `[org]/loading.tsx`).

Generated/metadata routes: `app/opengraph-image.tsx`, `app/apple-icon.tsx`, `app/icon.svg`, `app/email-mark.png/route.tsx`, `app/robots.ts`, `app/sitemap.ts`, `public/humans.txt`.

### 5.4 UI component inventory (`packages/ui/src/components`, 29 components)

| Component | Used by app? | Notes |
|---|---|---|
| Badge, PriorityBadge, ClaimBadge, ScorePill, ScoreRing | Yes | Encode fact/inference/unknown and priority; unknown score renders "Unknown"/"?" never 0 (tested) |
| Button, ConfirmButton (armed "click again" destructive) | Yes | |
| Card, StatCard, BreakdownList, QuotaBar, EvidenceList, Freshness, Note, States (Empty/Error/Loading) | Yes | |
| DataTable (sortable), FilterBar, Form (`Field`, `Input`, `Textarea`, `Select`, `ListInput`, `FormMessage`) | Yes | DataTable has tests |
| Menu, Modal, HoverPanel (used inside PriorityBadge/ScorePill), ScrollRegion | Yes | |
| Sidebar, TopBar, JumpTo (⌘K), ThemeToggle, BrandMark | Yes | Sidebar/JumpTo tested |
| **Toast** (`ToastProvider`, `useToast`) | **Provider only** | Mounted in `app/layout.tsx`; `useToast` called only in `/kitchen-sink` → no toast ever appears in the product [C] |
| **ActionRail** | **No** | Not referenced anywhere in `apps/` (not even `/kitchen-sink`) [C] — dead component |

Tokens: `tokens.css` (778 lines), `theme.css`; light/dark themes; Geist fonts. Design rules recorded in `docs/spec/04-design-brief.md` §15.

---

## 6. User interactions and end-to-end workflows

Normative, element-by-element detail lives in [COMMAND.md](COMMAND.md) §0–§15. Below are the traced chains with their current status.

### W-01 Sign up / sign in
`AuthForm` → `sendMagicLink` (`(auth)/actions.ts:62`: Zod-validated, rate-limited, `shouldCreateUser` only on sign-up, enumeration-safe messages) → Supabase sends email → `GET /auth/callback?code&next` (`app/auth/callback/route.ts`, `lib/safe-next.ts` prevents open redirects) → `resolveDestination` (`lib/data/destination.ts:194`) → `/welcome…` or last workspace. Google: `signInWithGoogle` (`:120`) when enabled. Sign-out: `POST /auth/signout`.
**Status:** IMPL-UNVERIFIED on a real project; `safe-next` and protected-routes VERIFIED by unit tests.

### W-02 Onboarding → first opportunities
`YouForm.saveYou` → `StartStep.startFirstJob` (personal or company path) → `CompanyStep.researchCompanyAction` (`welcome/company/actions.ts:50`) → `createWorkspace` → `provision` (`welcome/actions.ts:276`, `create_organization` RPC) → `lib/ai/research.ts` → `research_company` task (Opus) → `saveCompanyAction` (sealed "live" flag, `lib/ai/seal.ts`) → `GoalsStep.saveGoals` → `IcpStep` (`draftIcpAction`, `estimateReachAction` → Apollo via `packages/jobs/src/reach.ts`, `previewLookAlikesAction`, `saveIcp`) → `SourcesStep` (`recommendSourcesAction` → `recommend_sources`, `saveSources`) → `BuildingStep.runStageAction` drives `first-run.ts` stages (discover → enrich → contacts → score → explain) or `continueInBackgroundAction` → `/welcome/review` → `finishOnboarding` → dashboard.
**Status:** IMPL-UNVERIFIED. In production without AI/Apollo keys the research and ICP steps fall back to worked examples, and "building" cannot discover anything. `createNamedWorkspace` (`welcome/actions.ts:252`, the "describe it yourself" path) is exported but **no UI calls it** [C] (DEAD, B-10).

### W-03 Background discovery and scoring (the engine)
Heartbeat (`tick.yml` → `GET /api/jobs/tick`, Bearer `CRON_SECRET`; or `POST /api/inngest`) → `sweep()` enqueues 14 sweepers (`packages/jobs/src/runner.ts:171-220`) → `tick()` claims ≤5 jobs, runs each in an `OrgScope`, requeues stalled jobs first.

| Sweeper | Fans out to | External |
|---|---|---|
| `schedule_discovery` | `discover_companies` → `research_company` → `score_opportunity` | Apollo company search; Anthropic |
| `schedule_scans` | `scan_source` → `extract_signals` → evidence/triggers → `resolve_competitor_mentions`, `score_opportunity` | Fetch (SSRF-guarded `fetch.ts`); Anthropic |
| `schedule_signal_fetches` | `fetch_company_signals` | Apollo signals |
| `schedule_followups` | `enrich_company`, `rank_contacts`, `research_company`, `research_competitor`, `prospect_competitor_customers`, `sync_hubspot` | Apollo, Anthropic, HubSpot |
| `schedule_recomputes` | `recompute_scores` → `score_opportunity` | Anthropic |
| `schedule_syncs` | `sync_mailbox` → `classify_reply`, `sales_agent`/why-now grounding, demand signals | Gmail/Outlook, Anthropic |
| `advance_enrollments` | drafts via `personalize_message`; `send_message` | Anthropic, Gmail/Outlook |
| `schedule_sends` | `send_message` | Gmail/Outlook |
| `schedule_learning` (hourly key) | `analyze_performance` | Anthropic |
| `schedule_demand` (hourly key) | `cluster_demand` | Anthropic |
| `schedule_preferences` (hourly key) | `learn_preferences` → `infer_preferences` | Anthropic |
| `send_notifications`, `send_digests` (hourly key) | — | Resend |
| `enforce_retention` (daily key) | — | — |

**Unreachable handlers** (registered, no producer) [C]: `enrich_person` (only caller of Hunter/ZeroBounce), `resolve_entity`, `purge_contact_data`. CI's reachability check allow-lists exactly these three.
**Status:** handlers VERIFIED against fakes (316 checks); **BROKEN in production** (no driver, no keys).

### W-04 Analyze a URL
`Analyzer` → `analyzeUrlAction` (`analyze/actions.ts:52`) → `lib/ai/qualify.ts` (`resolveRecorder` → membership + `canSpend`; rate limit; `withinAiBudget`; records `ai_runs`) → fetch + `qualify_opportunity` → sealed verdict → `saveQualificationAction` (`:151`, `mutate`) → opportunity + evidence. `whyNowAction` (`:102`) similarly.
**Status:** IMPL-UNVERIFIED (MOCK without AI key). Spend-guard VERIFIED by unit tests and the site-audit SEC-SPEND/SEC-QUOTA checks.

### W-05 Outreach: enroll → draft → approve → send → reply
`OutreachManager` (`saveCampaignAction`, `createSequenceAction`, `saveStepAction`) → mailbox connect (W-06) → `OpportunityTable.enrollOpportunitiesAction` → `enrollments` → `advance_enrollments` drafts with `personalize_message` (house style + sender preferences + memories as reference material) → Inbox `approveMessageAction` / `editDraftAction` / `rejectDraftAction` / `redraftAction` → `schedule_sends` → `send_message` (claim-before-send, one message per step (0035), quota `emails`, unsubscribe link + postal address required, header-injection-safe MIME (0047 lead 8)) → `message_events` → `sync_mailbox` → `classify_reply` → threads, outcomes, demand signals → Inbox `replyToThreadAction`.
**Status:** IMPL-UNVERIFIED; **BROKEN in prod** (mailbox cannot connect, no engine). Free plan allows 0 emails (B-08).

### W-06 Mailbox connection (Gmail / Outlook OAuth)
`GET /api/mailboxes/{provider}/start?org=` (membership, `canWrite`, provider configured, encryption key present; state nonce cookie) → provider consent → `GET /api/mailboxes/{provider}/callback` (state check, token exchange, `encryptSecret`) → `mailboxes` row → redirect to `/{org}/outreach?mailbox_connected=`.
**Status:** IMPL-UNVERIFIED; refused in prod (`MAILBOX_ENCRYPTION_KEY`, OAuth creds absent) [R via health].

### W-07 Learning loop
Organisational: `learn/actions.requestAnalysisAction` → `learning_runs` → `schedule_learning` → `analyze_performance` → `learning_findings` → `approveFindingAction` creates inactive scoring rules or memories → Settings → Scoring "Turn on" → `recomputeScoresAction`.
Personal: edits/rejections/redraft notes/assistant corrections → `preference_signals` → `schedule_preferences` → `learn_preferences` → Settings → You (`savePreferenceAction`, `forgetPreferenceAction`, `setLearningPausedAction`, …) and "Written with" disclosure on outputs.
**Status:** IMPL-UNVERIFIED (logic tested; never run with real data).

### W-08 Ask Huntloop (workspace assistant)
`AssistantChat.askAssistantAction` (`assistant/actions.ts:39`) → `lib/ai/workspace-assistant.ts` → `workspace_assistant` task (Sonnet) with workspace-scoped context (`lib/ai/workspace-context.ts`), citations checked against tool results → `conversations` / `conversation_messages` (0041, 0045).
**Status:** IMPL-UNVERIFIED; unavailable without AI key.

### W-09 Team membership
`inviteMemberAction` (seat quota; Resend email when configured; copy-link fallback) → `/invite/{token}` → `acceptInvitationAction` (confirmed email required, 0047 lead 12). Join requests: `requestJoinAction` (onboarding) → `approveJoinAction` / `declineJoinAction` (approved requester emailed). Roles: `setMemberRoleAction`, `removeMemberAction`; assignments: `assignOpportunityAction`.
**Status:** DB rules VERIFIED; UI IMPL-UNVERIFIED.

### W-10 Data rights
Settings → Data & privacy: `eraseContactAction` (`erase_contact_for_org`), `exportContactAction`, `exportOrganizationAction`, `deleteOrganizationAction` (owner, scheduled deletion), `deleteOwnAccountAction`; retention days → `enforce_retention` daily (refuses messaged contacts and live opportunities' contacts).
**Status:** DB functions VERIFIED; `purge_contact_data` job DEAD.

### W-11 Unsubscribe and digest opt-out
Prospect: `/unsubscribe/{token}` (form) and `POST /api/unsubscribe/{token}` (RFC 8058 one-click) → `record_unsubscribe` → suppression + stop sequences; tokens in `message_unsubscribe_tokens`, unreadable by any session role. User digest: `/api/notifications/unsubscribe` with signed token (`email/digest-token.ts`).
**Status:** VERIFIED at DB level (security-leads case); HTTP path IMPL-UNVERIFIED.

### W-12 CRM push
`requestCrmPushAction` (`opportunities/[id]/actions.ts:339`, checks `org_has_hubspot`) → request marker → `schedule_followups` → `sync_hubspot` → HubSpot v3 search-then-write, v4 associations → `external_ids`.
**Status:** IMPL-UNVERIFIED; adapter header states it has never run against a live portal [C].

### W-13 Competitors and demand
Competitors: `addCompetitorAction` → `requestCompetitorResearchAction` sets `research_requested_at` → `schedule_followups` → `research_competitor` (Opus) → evidence; optional `prospect_competitor_customers`. Demand: `sync_mailbox` writes `demand_signals` → `schedule_demand` → `cluster_demand` (Sonnet) → `demand_themes`; `DemandBoard` actions rename/merge/create/assign/request grouping.
**Status:** IMPL-UNVERIFIED.

### W-14 Anonymous `/discover`
`DomainInput` → `/discover?d=` → `discoverAction` (`(marketing)/discover/actions.ts:60`) → `publicResearchEnabled()` (`PUBLIC_RESEARCH_ENABLED === "true"`) → cache lookup → `reserve_public_research` (per-source + daily budget, before the model call) → `research_company` on `https://{domain}/` only → `public_research` cache → CTA to `/signup?d=`.
**Status:** reservation VERIFIED (DB); feature off unless the env flag is set [M].

---

## 7. API, backend, services and data-flow inventory

### 7.1 HTTP route handlers (14)

| Route | Methods | Auth | Purpose | Status |
|---|---|---|---|---|
| `/api/jobs/tick` | GET, POST | Bearer `CRON_SECRET` (constant-time compare; 503 if unset, 404 on mismatch) | `sweep()` + `tick()` | IMPL-UNVERIFIED; prod 503 (no secret) |
| `/api/inngest` | GET, POST | HMAC `x-inngest-signature`, 5-min window; 404 if unconfigured | Same tick via Inngest | IMPL-UNVERIFIED; hand-written protocol, never registered with Inngest [I][M] |
| `/api/health` | GET | Public | Config booleans, commit, schema state; 200/503 | VERIFIED [R] |
| `/api/csp-report` | POST | Public, rate-limited | CSP violation sink (forwards to Sentry when configured) | IMPL-UNVERIFIED; no sink in prod |
| `/api/mailboxes/{provider}/start` | GET | Session + `canWrite` | OAuth start | IMPL-UNVERIFIED |
| `/api/mailboxes/{provider}/callback` | GET | Session + state cookie | OAuth callback, encrypt tokens | IMPL-UNVERIFIED |
| `/api/memory/extract` | POST | Session + `canWrite` | PDF/DOCX → text (4 MB, page/expansion limits) | VERIFIED (unit) |
| `/api/unsubscribe/{token}` | GET, POST | Token | One-click unsubscribe (POST, RFC 8058) | IMPL-UNVERIFIED (DB VERIFIED) |
| `/api/notifications/unsubscribe` | GET/POST | Signed token | Digest opt-out | IMPL-UNVERIFIED |
| `/auth/callback` | GET | Supabase code | Exchange + destination | IMPL-UNVERIFIED |
| `/auth/signout` | POST | Session | Sign out | IMPL-UNVERIFIED |
| `/{org}/performance/export` | GET | Membership | CSV export (formula-injection neutralised, `lib/csv-write.ts`) | VERIFIED (unit) |
| `/dev/onboarded` | GET | Dev only (404 outside `next dev`, hidden in prod) | Developer jump | N/A |
| `/email-mark.png` | GET | Public | Email header image | VERIFIED (build) |

### 7.2 Server actions (137 in 39 files)

Every exported function in a `"use server"` file is a public POST endpoint. Inventory by file (line numbers are definitions):

| File (`apps/web/app/…`) | Actions |
|---|---|
| `(auth)/actions.ts` | `sendMagicLink`:62, `signInWithGoogle`:120 |
| `(marketing)/discover/actions.ts` | `discoverAction`:60 |
| `(onboarding)/welcome/actions.ts` | `saveYou`:76, `startFirstJob`:131, `createWorkspace`:230, **`createNamedWorkspace`:252 (unused)**, `saveGoals`:366, `saveIcp`:390, `saveSources`:447, `advanceStep`:469, `finishOnboarding`:482 |
| `welcome/company/actions.ts` | `researchCompanyAction`:50, `saveCompanyAction`:157, `requestJoinAction`:255 |
| `welcome/icp/actions.ts` | `draftIcpAction`:64, `estimateReachAction`:137, `previewLookAlikesAction`:197 |
| `welcome/sources/actions.ts` | `recommendSourcesAction`:41 |
| `welcome/building/actions.ts` | `runStageAction`:134, `continueInBackgroundAction`:202 |
| `invite/[token]/actions.ts` | `acceptInvitationAction`:26 |
| `unsubscribe/[token]/actions.ts` | `unsubscribeAction`:24 |
| `[org]/questions-actions.ts` | `answerQuestionAction`:19, `declineQuestionAction`:93 |
| `[org]/dashboard/actions.ts` | `huntNowAction`:19 |
| `[org]/needs-you/actions.ts` | `snoozeAttentionAction`:23, `clearSnoozesAction`:65, `unsnoozeAttentionAction`:86 |
| `[org]/opportunities/actions.ts` | `archiveOpportunitiesAction`:60, `enrollOpportunitiesAction`:94 |
| `[org]/opportunities/[id]/actions.ts` | `askAgentAction`:44, `overridePriorityAction`:244, `requestCrmPushAction`:339 |
| `[org]/opportunities/[id]/activity-actions.ts` | `logActivityAction`:114, `setNextStepAction`:206, `clearNextStepAction`:243, `disqualifyAction`:295, `deleteActivityAction`:352 |
| `[org]/opportunities/[id]/brief-actions.ts` | `askResearchAction`:19, `setDealValueAction`:79 |
| `[org]/companies/actions.ts` | `saveCompanyAction`:39, `deleteCompanyAction`:121 |
| `[org]/analyze/actions.ts` | `analyzeUrlAction`:52, `whyNowAction`:102, `saveQualificationAction`:151 |
| `[org]/imports/actions.ts` | `importCsvAction`:88 |
| `[org]/outreach/actions.ts` | `saveCampaignAction`:41, `deleteCampaignAction`:110, `createSequenceAction`:144, `saveStepAction`:181, `deleteStepAction`:243, `disconnectMailboxAction`:273, `listEnrollmentsAction`:319, `setEnrollmentStatusAction`:364 |
| `[org]/inbox/actions.ts` | `setThreadStatusAction`:40, `assignThreadAction`:73, `replyToThreadAction`:136, `approveMessageAction`:274, `editDraftAction`:360, `rejectDraftAction`:427, `redraftAction`:494 |
| `[org]/pipeline/actions.ts` | `setOpportunityStatusAction`:25 |
| `[org]/performance/actions.ts` | `explainPerformanceAction`:26, `saveGoalsAction`:52 |
| `[org]/learn/actions.ts` | `requestAnalysisAction`:49, `approveFindingAction`:114, `rejectFindingAction`:257 |
| `[org]/memory/actions.ts` | `saveMemoryAction`:46, `deleteMemoryAction`:140, `ingestMemoryAction`:203 |
| `[org]/assistant/actions.ts` | `askAssistantAction`:39, `deleteConversationAction`:168 |
| `[org]/demand/actions.ts` | `setThemeStatusAction`:22, `renameThemeAction`:76, `mergeThemeAction`:92, `createThemeAction`:137, `assignStatementAction`:169, `requestGroupingAction`:190 |
| `[org]/competitors/actions.ts` | `addCompetitorAction`:37, `updateCompetitorAction`:76, `setCompetitorStatusAction`:115, `requestCompetitorResearchAction`:147, `deleteCompetitorAction`:185 |
| `[org]/sources/actions.ts` | `saveSourceAction`:45, `setSourceEnabledAction`:98, `deleteSourceAction`:133, `suggestSourcesAction`:167, `scanSourceNowAction`:277, `setScanIntervalAction`:353, `restoreSourceAction`:408 |
| `[org]/team/actions.ts` | `setMemberRoleAction`:49, `removeMemberAction`:132, `assignOpportunityAction`:211, `inviteMemberAction`:336, `resendInvitationAction`:439, `revokeInvitationAction`:481, `approveJoinAction`:527, `declineJoinAction`:539 |
| `[org]/ops/actions.ts` | `retryJobAction`:25, `cancelJobAction`:53 |
| `[org]/settings/actions.ts` | `saveOrgSettingsAction`:43, `saveOrgProfileAction`:125 |
| `[org]/settings/notification-actions.ts` | `saveNotificationPreferencesAction`:26 |
| `[org]/settings/you/actions.ts` | `savePreferenceAction`:31, `setPreferenceStatusAction`:95, `forgetPreferenceAction`:142, `dismissAppliedAction`:188, `sharePreferenceAction`:232, `promotePreferenceAction`:272, `setLearningPausedAction`:329, `resetLearnedAction`:351, `exportMyLearningAction`:380, `acknowledgeLearningAction`:402 |
| `[org]/settings/product/actions.ts` | `draftProductFromWebsiteAction`:40, `saveProductAction`:84, `deleteProductAction`:136 |
| `[org]/settings/icp/actions.ts` | `saveIcpAction`:57, `applyIcpProposalAction`:186, `activateIcpAction`:256, `deleteIcpAction`:297, `savePersonaAction`:328, `deletePersonaAction`:376, `previewLookAlikesAction`:417 |
| `[org]/settings/scoring/actions.ts` | `draftRulesAction`:62, `saveRuleAction`:145, `setRuleActiveAction`:230, `recomputeScoresAction`:286, `deleteRuleAction`:325, `previewRuleAction`:359 |
| `[org]/settings/integrations/actions.ts` | `connectHubspotAction`:28, `disconnectHubspotAction`:85 |
| `[org]/settings/privacy/actions.ts` | `eraseContactAction`:41, `exportContactAction`:84, `exportOrganizationAction`:121, `deleteOrganizationAction`:151, `deleteOwnAccountAction`:190 |

Authorization pattern: workspace actions go through `mutate()` (`lib/data/org.ts:83`): demo-mode refusal → `currentViewer` membership → viewer read-only refusal → optional `minRole` admin/owner → run with RLS client; Postgres error messages are returned to the user verbatim (`org.ts:131`). AI actions authorize through `resolveRecorder` (`lib/ai/recorder.ts:69`: org readable + `canSpend`). The repo audit's `SEC-VAL` check asserts every action validates input at runtime [R]. The 2026-10-11 security audit deferred a manual review of 11 action files (project notes) — still open.

All 137 exported actions are referenced by UI code except `createNamedWorkspace` [C].

### 7.3 Data layer

- `apps/web/lib/data/*` (54 modules + 3 test files): server-only loaders returning `Loaded<T>` with demo fallbacks (`lib/fixtures/opportunities.ts`), plus `source.ts` (`resolveDataSource`: `unconfigured` / `unmigrated` / `live`), `membership.ts` (`currentViewer`, `canWrite`, `canAdmin`, `canOwn`, `canSpend`), `destination.ts` (post-sign-in routing).
- `packages/db/src/*`: typed clients (`server.ts`, `browser.ts`, `admin.ts` — service role), crypto (`encryptSecret`), and domain modules (ICP, rules, identity/canonicalisation, contact selection, discovery, activity, memory, preferences, style, needs-you ranking).
- `packages/jobs/src/scope.ts`: `OrgScope` — the only holder of the service-role client at runtime besides four other named files (CI: "service-role client is confined to 5 named files") [R].

### 7.4 AI tasks (16) — `packages/ai/src/tasks`

| Task | Model / effort | Called from | Status |
|---|---|---|---|
| `research_company` | Opus / high | `lib/ai/research.ts`, `/discover`, job `research_company` | IMPL-UNVERIFIED |
| `recommend_sources` | Opus / medium | `lib/ai/sources.ts`, onboarding sources | IMPL-UNVERIFIED |
| `extract_signals` | Haiku / medium | job `scan_source` | IMPL-UNVERIFIED |
| `qualify_opportunity` | Opus / high | `lib/ai/qualify.ts`, job `score_opportunity` | IMPL-UNVERIFIED |
| `explain_why_now` | Opus / medium | `lib/ai/why-now.ts` | IMPL-UNVERIFIED |
| `personalize_message` | Opus / medium | job `advance_enrollments` | IMPL-UNVERIFIED |
| `classify_reply` | Haiku / low | job `sync_mailbox` | IMPL-UNVERIFIED |
| `sales_agent` | Opus / medium | `lib/ai/agent.ts` (opportunity Q&A) | IMPL-UNVERIFIED |
| `draft_scoring_rules` | Opus / high | `lib/ai/rules.ts` | IMPL-UNVERIFIED |
| `analyze_performance` | Opus / high | job `analyze_performance` | IMPL-UNVERIFIED |
| `research_competitor` | Opus / high | job `research_competitor` | IMPL-UNVERIFIED |
| `draft_icp` | Opus / high | `lib/ai/icp-draft.ts` | IMPL-UNVERIFIED |
| `explain_performance` | Sonnet / medium | `lib/ai/performance-narrative.ts` | IMPL-UNVERIFIED |
| `workspace_assistant` | Sonnet / medium | `lib/ai/workspace-assistant.ts` | IMPL-UNVERIFIED |
| `cluster_demand` | Sonnet / medium | job `cluster_demand` | IMPL-UNVERIFIED |
| `infer_preferences` | Sonnet / medium | job `learn_preferences` | IMPL-UNVERIFIED |

AI safeguards present [C][R]: claim schema validation (fact requires source URL; violations recorded as failed runs), untrusted-content wrapping on all tasks, citation checking against tool output (assistant, sales agent), sealed "live" verdicts (HMAC) so a client cannot promote a worked example to a live result, per-org rate limits and monthly `ai_runs` quota, every run recorded in `ai_runs` with tokens/cost/latency/prompt version, request timeout inside the function limit with SDK retries disabled, memories from URLs/files passed as reference material rather than house style (0047 lead 9).
AI risks: model IDs and pricing in `models.ts` have never been exercised against the live API [M]; the untrusted-block delimiter uses `Math.random()` (guessable, low impact) [I]; AI quota check fails open on RPC error (B-06).

### 7.5 External providers

| Integration | Package / file | Capability | Configured locally? | Configured in prod? | Status |
|---|---|---|---|---|---|
| Anthropic | `packages/ai/src/client.ts` | All AI | No | No | Never called live |
| Apollo | `packages/providers/src/adapters/apollo.ts` | Company search, person match, signals | No | No | Never called live |
| Hunter | `…/adapters/hunter.ts` | Person match (email finder) | No | No | DEAD (only via `enrich_person`) |
| ZeroBounce | `…/adapters/zerobounce.ts` | Email verification | No | No | DEAD (only via `enrich_person`) |
| HubSpot | `packages/crm/src/hubspot.ts` | CRM sync | — (per-org token) | Needs encryption key | Never run against a live portal (header) |
| Gmail / Outlook | `packages/jobs/src/mailbox/{gmail,outlook}.ts` | OAuth, send, sync | No | No | Never called live |
| Resend | `packages/jobs/src/email/resend.ts` | Product email (invites, joins, digest) | No | No | Never called live |
| Sentry | `instrumentation*.ts`, `sentry.*.config.ts` | Errors (no tracing, no replay) | No | No | Inert |
| PostHog | `lib/analytics.ts` (server-side `posthog-node`) | Onboarding funnel events only | No | No | Inert |
| Supabase | `packages/db` | DB/Auth | Yes | Yes | Live |

Provider safety mechanisms [C][R]: per-org credit budgets and an admin ceiling that can only lower the plan's (0047 lead 6), response cache, circuit breakers, call ledger (`provider_calls`), "empty vs partial vs failed" distinction, conservative verification mapping.

---

## 8. Database schemas, migrations and data integrity

### 8.1 Shape (generated reference, re-checked during this audit [R])

`docs/spec/generated/schema-reference.md` (regenerated by `npm test`'s `check:schema-reference`, which passed: "81 tables, 9 views, 105 functions"):
**81 tables · 9 views · 105 public functions · 10 enum types · 141 RLS policies · 237 indexes · 123 triggers · RLS enabled on 81/81 tables.**

Table groups: identity & tenancy (`organizations`, `memberships`, `profiles`, `invitations`, `join_requests`, `plans`, `subscriptions`, `usage_counters`, `rate_limits`, `audit_logs`); ICP & sources (`icps`, `icp_versions`, `personas`, `products`, `sources`, `source_events`, `source_documents`, `discovery_*`); entities (`companies`, `company_domains`, `external_ids`, `people`, `contact_points`, `contact_fit_scores`, `merge_candidates`, `company_merges`); evidence (`evidence`, `evidence_citations`, `company_triggers`, `company_problems`, `company_gaps`, `company_competitor_signals`, `competitors`, `competitor_profiles`, `competitor_evidence`); opportunities (`opportunities`, `opportunity_scores`, `scoring_rules`, `score_recompute_requests`, `human_overrides`, `ai_decisions`, `outcomes`, `activities`, `attention_snoozes`); outreach (`campaigns`, `sequences`, `sequence_steps`, `enrollments`, `messages`, `message_events`, `message_unsubscribe_tokens`, `threads`, `mailboxes`, `suppressions`, `contact_frequency`); learning & memory (`learning_runs`, `learning_findings`, `memories`, `memory_evidence`, `preference_signals`, `preference_state`, `user_questions`, `demand_signals`, `demand_themes`, `demand_state`); assistant (`conversations`, `conversation_messages`); engine & providers (`job_executions`, `ai_runs`, `provider_accounts`, `provider_breakers`, `provider_cache`, `provider_calls`, `enrichment_records`, `public_research`, `public_research_attempts`); integrations (`hubspot_connections`, `notification_preferences`); misc (`events`).

### 8.2 Migrations

`packages/db/migrations/0001_identity.sql` … `0047_security_leads.sql` (47 files) plus `COMBINED-0024-0027.sql`, a single-transaction paste bundle that `verify-migrations.ts` checks is equivalent [C]. Migrations are forward-only and applied by hand (Supabase SQL editor / `npm run db:doctor -- --bundle`). `db:doctor` probes one object per migration (`packages/db/scripts/doctor.ts:73-118`, covers 0046/0047) and asserts its list covers every file.

| Range | Theme |
|---|---|
| 0001–0010 | Identity, ICP/sources/evidence, companies/opportunities, outreach/memory/learning, rate limits, pruning, profiles/invites/accounting (plans seed), engine columns, service-role surface, learning loop |
| 0011–0023 | Providers, entity identity, ICP v2, discovery, competitors, contacts/scoring v2, outreach safety, learning targets, ops views, evidence v2, competitor evidence, evidence dedupe, score recompute |
| 0024–0030 | Onboarding state, anonymous research, product research, org directory, signals & CRM, data rights, `create_organization` |
| 0031–0039 | Tenant write hardening, evidence keys/provenance, send claim & provider ceiling, follow-up requests, one message per step, research requests, daily loop (activity ledger), discovery backpressure, competitor requests |
| 0040–0045 | Brief/value/notifications, workspace assistant, demand intelligence, learning over competitors/demand, personal learning (private memories), assistant conversations |
| 0046–0047 | `usage_limit` privilege revocation; security-audit leads 1–7, 11, 12 (cross-tenant FK guards, plan/trial self-edit block, usage metering limits, unsubscribe token table, activity author immutability, `reserve_public_research`, confirmed-email invitations) |

**Production migration state** [R][M]: `/api/health` reports `schema: complete` probing `message_unsubscribe_tokens`, so **0047's table exists in production**. Whether 0046 (a privilege change with no new table) is applied cannot be determined from the health probe — run `npm run db:doctor` against production. This contradicts `COMMAND.md`'s header and `CHANGELOG.md` `[Unreleased]`, which say 0046–0047 are not applied (§17).

### 8.3 Data integrity — findings

| ID | Finding | Evidence | Severity |
|---|---|---|---|
| D-01 | Fact-needs-source, unknown-stays-NULL, scoped-memory-needs-subject, tenant isolation (org A cannot read/write org B under a non-superuser role) | `verify-migrations.ts` 351/351 [R] | Strength |
| D-02 | Cross-tenant foreign keys blocked by `*_same_org` triggers on session-writable tables; regression case fails on a new unguarded FK | `verify-security-leads.ts` 10/10 [R] | Strength |
| D-03 | **Soft-deleted rows remain readable under RLS** — no RLS policy references `deleted_at`; every loader must filter manually | grep of migrations: 0 policy/USING clauses mention `deleted_at` [C] | Medium |
| D-04 | **Removed company cannot be re-added**: `deleteCompanyAction` soft-deletes; `unique (org_id, canonical_domain)` (0003:44) is not partial; insert returns "already on your list… edit the existing one", which is hidden | `companies/actions.ts:107,121-136` [C] | Medium (B-03) |
| D-05 | Quota fail-open: `usage_limit` NULL ⇒ unlimited; `organizations.plan_id` nullable (default `'free'`, not `NOT NULL`); `plans.limits` shape unchecked | `0007:367-379`, `check_quota_internal` [C] | Medium |
| D-06 | Schema gate checks two sentinel tables only; a partially applied privilege/function migration passes | `lib/schema.ts:503` [C] | Medium |
| D-07 | Orphan schema: `company_merges`, `evidence_citations`, `subscriptions` have no TypeScript reader or writer; `merge_candidates` written only by the unreachable `resolve_entity`; `events` written (by `analyze_performance`) but never read | grep [C] | Low |
| D-08 | No retention for operational tables (`job_executions`, `ai_runs`, `provider_calls`, `audit_logs`, …) | Gap report MIS-10; no prune job for them [C] | Low → Medium at scale |
| D-09 | No migration ledger table; applied state is inferred from probes | `doctor.ts` design [C] | Medium (ops) |
| D-10 | Backups/PITR and restore never rehearsed | `docs/OPERATIONS.md` "not yet verified" [M] | High (ops) |

---

## 9. Authentication, authorization, roles and permissions

| Aspect | Implementation | Status |
|---|---|---|
| Identity | Supabase Auth: email magic link (OTP), optional Google OAuth | IMPL-UNVERIFIED |
| Session | Cookie session refreshed in `proxy.ts` with `getUser()` (server-verified) | VERIFIED (E2E routing) |
| Route guard | `proxy.ts` + `lib/protected-routes.ts` (fails closed; test compares list to folders) | VERIFIED |
| Tenant boundary | Postgres RLS on all tables; membership via `memberships`; org layout returns 404 to non-members | VERIFIED (PGlite non-superuser role) |
| Roles | `owner`, `admin`, `member`, `viewer` (`lib/data/membership.ts:80-135`): viewer read-only (except self-scoped writes), admin for org settings/rules/integrations, owner for deletion/ownership | VERIFIED at DB level |
| Spend permission | `canSpend` gate before any model call (`recorder.ts`) | VERIFIED (spend-guard tests) |
| Service role | Confined to 5 named files; CI fails otherwise | VERIFIED [R] |
| Personal data | User-scoped memories/preferences private to their subject (0044) | VERIFIED (migration tests) |
| Machine auth | Tick: Bearer secret; Inngest: HMAC; unsubscribe/digest: tokens | VERIFIED (unit) / IMPL-UNVERIFIED (HTTP) |
| Access model | Every member sees/edits every opportunity, rule, source, campaign (ownership is workflow only) | By design (Gap Report DEC-15) |
| Missing | MFA, SSO/SAML, SCIM, session/device management, profile edit | MISSING |

---

## 10. Integrations, dependencies and configuration requirements

### 10.1 Environment variables (names only — no values were read)

Referenced in code (≥1 read), with requirement level:

| Variable | Required for | Prod set? (`/api/health`) |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (alias `NEXT_PUBLIC_SUPABASE_ANON_KEY`) | Anything beyond demo | Yes |
| `SUPABASE_SECRET_KEY` (alias `SUPABASE_SERVICE_ROLE_KEY`) | Engine, onboarding provisioning, public research | Yes |
| `NEXT_PUBLIC_SITE_URL` | Canonical/OG URLs, email links | Yes |
| `CRON_SECRET` | `/api/jobs/tick` | **No** |
| `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` | Inngest driver (alternative) | **No** |
| `MAILBOX_ENCRYPTION_KEY` | Storing mailbox OAuth and HubSpot tokens | **No** |
| `ANTHROPIC_API_KEY`, `HUNTLOOP_AI_TIMEOUT_MS` | All AI | **No** |
| `APOLLO_API_KEY` | Discovery, reach, contacts, signals | **No** |
| `ENRICHMENT_API_KEY` (Hunter), `EMAIL_VERIFICATION_API_KEY` (ZeroBounce) | `enrich_person` only (unreachable) | **No** (no effect anyway) |
| `GOOGLE_CLIENT_ID/SECRET`, `MICROSOFT_CLIENT_ID/SECRET` | Mailbox OAuth | **No** |
| `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO` | Product email | **No** |
| `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ORG/PROJECT/AUTH_TOKEN` | Errors, CSP reports, source maps | **No** |
| `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST` | Funnel analytics | **No** |
| `PUBLIC_RESEARCH_ENABLED`, `PUBLIC_RESEARCH_DAILY_LIMIT`, `PUBLIC_RESEARCH_SALT` | Anonymous `/discover` | Unknown [M] |
| `NEXT_PUBLIC_AUTH_GOOGLE` | Show Google sign-in | Unknown [M] |
| `CSP_ENFORCE` | Enforcing CSP | Unknown (assumed off) [M] |
| `NEXT_PUBLIC_FEEDBACK_URL`, `NEXT_PUBLIC_HELP_URL` | Shell links | Unknown |
| `NEXT_PUBLIC_HUNTLOOP_DEV_BYPASS` | Dev-only ICP gate bypass (compiled out of production builds) | N/A |
| Platform: `VERCEL_ENV`, `VERCEL_GIT_COMMIT_SHA`, `VERCEL_REGION`, `VERCEL_PROJECT_PRODUCTION_URL`, `NEXT_PUBLIC_VERCEL_ENV`, `NODE_ENV`, `NEXT_RUNTIME`, `CI` | Automatic | — |

In `.env.example` but read by **no code**: `DATABASE_URL` (manual migration use only), `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` [C].
GitHub Actions needs secret `CRON_SECRET` and variable `HUNTLOOP_URL` — `gh secret list` / `gh variable list` returned nothing [R].

Local environment (names only): `apps/web/.env.local` sets Supabase URL/keys, `SUPABASE_SECRET_KEY`, `DATABASE_URL`, `MAILBOX_ENCRYPTION_KEY`, `CRON_SECRET`; all vendor keys empty [C]. Project notes indicate this points at the **production** Supabase project and that the database password was due for rotation — **[M] confirm and rotate if still true**.

### 10.2 Dependency health

`npm audit`: **0 vulnerabilities** [R]. Notable lag (`npm outdated`): `@supabase/ssr` 0.5.2 (latest 0.12.x — pre-1.0, many minors behind), `@electric-sql/pglite` 0.2.17 (0.5.x; test-only), `@anthropic-ai/sdk` 0.116 (0.133), `@sentry/nextjs` 10.70 (11.x major), `lucide-react` 0.469 (1.x major), ESLint 9 (10.x). None is a known vulnerability today.

---

## 11. Testing, quality assurance and verification results

All commands below were run during this audit on Windows, Node 24.19.0.

| Check | Command | Result |
|---|---|---|
| Typecheck (all workspaces) | `npm run typecheck` | **PASS** |
| Lint (ESLint + jsx-a11y) | `npm run lint` | **PASS** |
| Web unit tests | vitest (`apps/web`) | **272/273** — `lib/ai/spend-guard.test.ts` "is refused by qualify()" **timed out (30 s) on a cold run; passed 6/6 on immediate re-run** → flaky on cold transform (import phase took 51 s) |
| UI component tests | vitest (`packages/ui`) | **PASS 42/42** |
| AI tasks | `verify-tasks.ts` | **PASS 229/229** |
| CRM | `verify-crm.ts` | **PASS 20/20** |
| DB migrations + tenant isolation | `verify-migrations.ts` (PGlite) | **PASS 351/351** |
| Security-leads regression | `verify-security-leads.ts` | **PASS 10/10 cases** |
| Scoring rules | `verify-rules.ts` | **PASS 59/59** |
| Pure domain logic | `verify-pure.ts` | **PASS 150/150** |
| Service-role confinement | `check-admin-imports.ts` | **PASS** (5 files) |
| Schema-reference drift | `schema-reference.ts --check` | **PASS** |
| Jobs engine | `verify-jobs.ts` | **PASS 316/316** (includes reachability allow-list) |
| Providers | `verify-providers.ts` | **PASS 81/81** |
| Repository audit | `npm run audit:site` | **44 checks, 0 failing, 1 warning** (`LEGAL-01`: 7 legal facts pending) |
| Dependency advisories | `npm audit` | **0 vulnerabilities** |
| Production build | via Playwright `webServer` (`next build`) | **PASS** |
| Bundle budget | `npm run audit:bundle` | **244.4 kB of 275 kB** shared client JS |
| End-to-end | `npx playwright test` (desktop + Pixel 7) | **316 passed, 4 skipped** (device-specific skips by design), 4.0 min |
| CI on `main` | GitHub Actions `CI` for `8021d3f` | **success** [R] |

Coverage gaps:
- **E2E runs only in demo mode** (empty Supabase credentials). No signed-in, real-database, multi-tenant browser test exists.
- No test exercises a live vendor; every integration test uses a scripted client.
- No load/performance test (rate limiter proven at DB level only).
- Automated accessibility scan (axe) covers 5 pages (`/`, `/login`, `/demo/dashboard`, `/demo/opportunities`, `/kitchen-sink`) plus the jump-to palette and contrast in both themes.
- No code-coverage measurement is configured.
- Test for the hourly/daily sweep keys asserts the key format, not that a completed sweep suppresses re-enqueue (see B-09).

---

## 12. Security, privacy, accessibility, UX, performance and reliability

### 12.1 Security

Strengths [C][R]: RLS-first tenancy with non-superuser isolation tests; service-role confinement enforced in CI; 2026-10-11 security audit's 13 leads fixed with a regression suite; SECURITY DEFINER review (0046); SSRF guard on engine fetches (`packages/jobs/src/fetch.ts`, private-address refusal); OAuth state nonce cookies; encrypted third-party tokens; constant-time secret compare; HMAC-sealed AI verdicts; formula-injection-safe CSV; header-injection-safe MIME; open-redirect-safe `next`; enumeration-safe auth messages; nonce-based CSP (report-only); strict security headers; secret scan of git history clean (per Gap Report, 2026-10-09).

Open items:

| ID | Item | Type | Severity |
|---|---|---|---|
| S-01 | CSP is report-only, and prod has no report sink (Sentry unset) | [C][R] | Medium |
| S-02 | AI quota check fails **open** when the `check_quota` RPC errors (`lib/ai/budget.ts`: `if (error) return { allowed: true … }`) | [C] | Medium |
| S-03 | `mutate()` returns raw Postgres error text to users (`lib/data/org.ts:131`) — leaks constraint/table names | [C] | Low |
| S-04 | `createNamedWorkspace` is a callable server action with no UI | [C] | Low |
| S-05 | Security audit deferred units never reviewed: 11 server-action files, AI wrappers outside `mutate()`, 15 job handlers + erase/prune lifecycle, 9 ingesting LLM tasks (project notes) | [M] | Medium |
| S-06 | No branch protection on `main` (API 404 — either unprotected or insufficient permission) | [R][M] | Medium |
| S-07 | Local `.env.local` holds production-grade credentials (service key, `DATABASE_URL`) per project notes | [M] | Medium |
| S-08 | `/api/jobs/tick?limit=` is unvalidated (`NaN` → 500; very large → claims many jobs and gives them back, each consuming an attempt). Bearer-authenticated, so only an operator can trigger it | [C] | Low |
| S-09 | No MFA/SSO for an app that holds mailbox tokens and prospect PII | [C] | Medium (enterprise) |
| S-10 | Untrusted-content delimiter id is `Math.random()` | [C][I] | Low |

### 12.2 Privacy and compliance

Implemented: contact erasure, contact and organisation export, org deletion, own-account deletion, configurable contact retention, unsubscribe on every outreach email with postal address, suppression list, personal memories private (0044), Sentry `sendDefaultPii:false` and no session replay, analytics receives no ICP content.
Gaps: legal pages unpublished (7 facts pending: entity name, registered address, jurisdiction, privacy contact, contact email, Art. 27 decision, lawful basis for prospect data) [R]; mail authentication records (SPF/DKIM/DMARC) not verified [M]; no DPA/sub-processor list in repo; no retention for operational logs (D-08).

### 12.3 Accessibility

`eslint-plugin-jsx-a11y` passes; axe A/AA scans pass on 5 pages + palette; contrast rules documented (`meridian` design decisions); skip link; nothing conveyed by colour alone (badges carry words). Gaps: axe coverage is narrow relative to 54 pages; no screen-reader or keyboard-only manual pass recorded; no declared conformance target (Gap Report DEC-12) [M].

### 12.4 UX consistency, loading/empty/error states

Strengths: every screen states demo vs live (`DataSourceBanner`, `DemoFigures`), "unknown" shown honestly, empty states and errors carry next actions, role-aware refusals explain who can act.
Gaps: Toast system never used (success feedback inline only); most workspace routes share one generic loading state; a bare `/{org}` URL is a 404; onboarding offers "Reach out" while Free allows 0 emails (B-08); many "on the engine's next run" messages are untrue while no driver exists (B-01).

### 12.5 Responsive behaviour

Mobile (Pixel 7) and desktop Playwright projects pass the full suite [R]; drawer navigation below `lg`; the Needs-you rail overflow at <1440 px was fixed. Tablet layout is not specifically designed (Gap Report).

### 12.6 Performance

Shared client JS 244.4 kB / 275 kB budget [R]. Opportunity list query capped (`LIST_LIMIT`) and index-aligned ordering. Sweepers run every tick rather than hourly/daily (B-09) — extra cross-tenant queries. No RUM, no load test, no query-plan monitoring.

### 12.7 Reliability and error handling

Queue: `for update skip locked` claims, stalled-job requeue, deadline-aware runner that gives back unstarted jobs, permanent vs retryable failures, idempotency keys, one-message-per-step guarantee, claim-before-send. Provider circuit breakers. Gaps: no driver in prod; no last-tick-age alert; GitHub scheduled runs are sparse in practice (observed runs hours apart, e.g. 2026-10-12 01:17, 07:31, 16:58, 23:35 UTC) and pause after 60 days of repository inactivity [R]; Inngest route unproven [I].

---

## 13. Deployment, infrastructure and operational readiness

| Item | Finding | Evidence |
|---|---|---|
| Hosting | Vercel, Root Directory `apps/web`; production at `seefluence.com` (apex 307 → `www`) | `/api/health`, curl [R] |
| Serving commit | `8021d3f` = `main` HEAD | `/api/health` [R] |
| Health | `ok:false`, HTTP 503 | [R] |
| Database | Supabase, schema `complete` (0047 table present), service key present | [R] |
| Engine driver | None. `vercel.json` has no `crons`; `tick.yml` fails each run (secrets missing) | [C][R] |
| Encryption key | Missing in prod | [R] |
| Integrations | All missing in prod | [R] |
| CI | `ci.yml`: typecheck, lint, test, site audit, `npm audit --audit-level=high` (blocking on main), build with empty creds, bundle budget; parallel E2E job. Latest `main` run green | [C][R] |
| CD gates | No migration gate, no staging, no post-deploy smoke test | [C] |
| Migrations | Manual; doctor + bundle tooling | [C] |
| Observability | Sentry/PostHog code present but unconfigured; no log drain, uptime or tick alert | [R] |
| Vercel topology | Project notes record duplicate Vercel projects (one always failing, one stale CLI copy holding env values) | [M] |
| DNS / mail | Apex/www pairing differs from `SITE_URL` history; no MX/SPF/DMARC recorded at last check | [M] |
| Production readiness | **Not ready for users**: core loop cannot run, AI absent, no billing, legal unpublished | — |

---

## 14. Implementation-status matrix (summary with evidence)

| Capability | Status | Primary evidence |
|---|---|---|
| Marketing site, SEO, OG, sitemap/robots | VERIFIED | site audit, E2E [R] |
| Legal pages | PARTIAL | `LEGAL-01` warning [R] |
| Auth (magic link, Google, callback, sign-out) | IMPL-UNVERIFIED | code; demo E2E of forms |
| Route guard / CSP / headers / prod 503 gate | VERIFIED | E2E `routing`, `csp` [R]; prod 503 [R] |
| Tenant isolation (RLS) | VERIFIED | 351 migration checks [R] |
| Onboarding (8 steps, persisted) | IMPL-UNVERIFIED | code, unit tests |
| Workspace screens (33) render & navigate | VERIFIED (demo) | 316 E2E [R] |
| Workspace writes (137 actions) | IMPL-UNVERIFIED | `SEC-VAL` check; no signed-in E2E |
| Engine queue/runner | VERIFIED (fakes); BROKEN in prod | 316 job checks; health [R] |
| Discovery, scans, signals, scoring | IMPL-UNVERIFIED | handler tests |
| AI tasks (16) | IMPL-UNVERIFIED / MOCK without key | 229 checks [R] |
| Outreach sending/sync | IMPL-UNVERIFIED; BROKEN in prod | tests; health |
| HubSpot sync | IMPL-UNVERIFIED | adapter caveat [C] |
| Product email (Resend) | IMPL-UNVERIFIED | tests |
| Learning (org + personal) | IMPL-UNVERIFIED | tests |
| Assistant | IMPL-UNVERIFIED | tests |
| Demand intelligence, competitors | IMPL-UNVERIFIED | tests |
| Data rights | VERIFIED (DB) / IMPL-UNVERIFIED (UI) | tests |
| Quotas & rate limits | VERIFIED (DB); fail-open edges | tests; code |
| Entity dedup / merge | DEAD | no producer [C] |
| Person enrichment (Hunter/ZeroBounce) | DEAD | no producer [C] |
| `purge_contact_data` job | DEAD | no producer [C] |
| Toast, ActionRail | DEAD | grep [C] |
| Billing | MISSING | [C] |
| Record search | PARTIAL (nav only) | [C] |
| MFA/SSO/SCIM, profile edit, notification centre | MISSING | [C] |
| Web3 signal packs (Master Context audience) | PLANNED | Gap Report MIS-11 |

---

## 15. Confirmed bugs, incomplete features and missing functionality

| ID | Type | Description | Location | Evidence | Severity |
|---|---|---|---|---|---|
| B-01 | Broken (config) | Engine never runs in production: no `CRON_SECRET`, no Inngest keys, GitHub tick workflow fails every run | `/api/health`, `.github/workflows/tick.yml` | [R] | **Critical** |
| B-02 | Broken (config) | Production lacks `MAILBOX_ENCRYPTION_KEY` and every integration key → AI shows worked examples; mailbox and HubSpot connections refused; no product email | `/api/health` | [R] | **Critical** |
| B-03 | Bug | A soft-deleted company cannot be re-added; the error tells the user to edit a row they cannot see | `apps/web/app/(app)/[org]/companies/actions.ts:96-136`; `0003_companies_opportunities.sql:44` | [C] (not reproduced at runtime) | Medium |
| B-04 | Inconsistency | Opportunities of a removed company stay in the opportunity list (list filters `opportunities.deleted_at`, not the company's) | `apps/web/lib/data/opportunities.ts:104-118` | [C][I] — intended behaviour undocumented [M] | Medium |
| B-05 | Dead code | `enrich_person`, `resolve_entity`, `purge_contact_data` have no producer; `merge_companies_for_org` has no caller; `company_merges`, `evidence_citations`, `subscriptions` unused | `packages/jobs/src/registry.ts`, migrations | [C] | Medium |
| B-06 | Fail-open | `withinAiBudget` treats an RPC error as "allowed" | `apps/web/lib/ai/budget.ts` | [C] | Medium |
| B-07 | Fail-open | NULL limit or NULL `plan_id` means unlimited | `check_quota_internal`, `0007:367-379` | [C] | Medium |
| B-08 | Product conflict | Free plan has `emails: 0`; new workspaces start on Free; onboarding offers the `reach_out` goal and "Connect a mailbox" | `0007:368`, `apps/web/lib/onboarding/steps.ts:152` | [C] | High (first-user experience) |
| B-09 | Inefficiency + doc mismatch | "Hourly"/"daily" sweepers are not limited to once per hour/day: the idempotency index only covers `queued`/`running`, so after a sweep completes the next tick enqueues it again. Handlers' own guards (`last_digest_on`, staleness checks) prevent duplicate effects | `packages/jobs/src/runner.ts:222-254`; `0031_tenant_write_hardening.sql:71-73` | [C] | Low |
| B-10 | Dead code | `createNamedWorkspace` exported, never called | `apps/web/app/(onboarding)/welcome/actions.ts:252` | [C] | Low |
| B-11 | Dead code | `ToastProvider` mounted but no product screen calls `useToast`; `ActionRail` unused | `packages/ui/src/components/{Toast,ActionRail}.tsx` | [C] | Low |
| B-12 | Flaky test | `spend-guard.test.ts` times out on cold runs (30 s limit vs 51 s import phase on Windows) | `apps/web/lib/ai/spend-guard.test.ts:92` | [R] | Low |
| B-13 | Unproven | Inngest endpoint implements its own protocol (GET introspection, POST tick); compatibility with Inngest's app sync has not been demonstrated | `apps/web/app/api/inngest/route.ts` | [I][M] | Low (unless chosen as driver) |
| B-14 | Validation | `?limit=` on the tick route is unbounded/unvalidated | `apps/web/app/api/jobs/tick/route.ts` | [C] | Low |
| B-15 | Missing | Billing / checkout / plan change UI | — | [C] | High (before charging) |
| B-16 | Missing | Legal facts (7) — pages unpublished | `apps/web/lib/legal.ts` | [R] | High (before sending to real prospects) |
| B-17 | Missing | Signed-in / real-DB E2E; live-vendor verification | `e2e/`, `playwright.config.ts` | [C] | High |

---

## 16. Technical debt, architectural concerns and project risks

1. **Production-verification debt outweighs code debt.** Every vendor adapter, prompt and model ID is unproven live; the first live run will surface contract drift (API paths, property names, pricing, model names) [I].
2. **Single heartbeat dependency on GitHub's scheduler** (best-effort, delayed, auto-pausing) for an engine that spends money and sends email [C][R].
3. **Manual migrations without a ledger** and a two-sentinel readiness gate (D-06, D-09).
4. **Soft-delete semantics enforced only in application code** (D-03, B-03, B-04).
5. **Fail-open quota edges** (B-06, B-07) in a product with real per-call costs.
6. **Raw database errors surfaced to users** (S-03) — also a UX consistency issue.
7. **Very large files:** `(marketing)/page.tsx` 1,168 lines, `lib/data/onboarding.ts` 1,284, `OutreachManager.tsx` 958, `IcpStep.tsx` 876, `IcpEditor.tsx` 794, `MemoryManager.tsx` 769; verification suites 2,000–3,800 lines each.
8. **Documentation sprawl** (120 tracked Markdown files, several hundred KB at the root alone) with hand-maintained counts that drift (§17).
9. **Pre-1.0 dependency lag**: `@supabase/ssr` 0.5.2 sits on the session-refresh path in `proxy.ts`.
10. **Comment drift in code**: the tick route and `packages/jobs/src/index.ts` describe Vercel Cron in `vercel.json` as the default driver, which no longer exists; runner comments say "the next tick is thirty seconds away" (actual cadence ≥ 5 minutes).
11. **Access model**: all members can edit all records — fine for small teams, a risk for larger ones (DEC-15).
12. **Dormant capability** (dedup, person enrichment) that the schema itself says must precede provider volume (0012) — currently inverted.

---

## 17. Documentation gaps and items requiring manual verification

### 17.1 Documentation that contradicts the code or production (confirmed)

| Document | Statement | Reality |
|---|---|---|
| `README.md` "The heartbeat" | `apps/web/vercel.json` schedules `/api/jobs/tick` every minute | `vercel.json` is `{"$schema": …}` only; heartbeat is `tick.yml` */5 |
| `README.md` Stack | Jobs "Inngest / Trigger.dev"; Billing "Stripe" | No Trigger.dev; no Stripe code |
| `README.md` Layout/Status | 3 packages; "ten screens", "four AI tasks", "68 browser tests"; green/violet palette | 7 workspaces; 54 pages; 16 AI tasks; 160 E2E tests × 2 projects; blue brand (`tokens.css`) |
| `COMMAND.md` header | "Last full sync … on `feat/personal-learning` … production has through 0045; 0046–0047 not applied" | Merged to `main`; prod serves `8021d3f` with 0047's table present |
| `CHANGELOG.md` `[Unreleased]` | "Needs database migrations 0046 and 0047" | 0047 present in prod; 0046 unknown; the release is deployed but not versioned |
| `docs/spec/07-specification-gap-report.md` | Prod on `14cf749`, PR #2 open, CI red, unpushed branch | PR #2 merged; `main` pushed and green; prod on `8021d3f` |
| `apps/web/app/api/jobs/tick/route.ts`, `packages/jobs/src/index.ts` comments | Vercel Cron via `vercel.json` is the default | Removed (commit `59f7942` per `tick.yml`) |
| `packages/jobs/src/runner.ts` HOURLY/DAILY comments | "the rest collapse into it" | Only while queued/running (B-09) |
| `docs/status/*`, `docs/architecture/{database,data-model,design-system}.md` | Older counts and claims | Already bannered as stale; still in the published book |

### 17.2 Gaps

- No single current "operations runbook" that matches today's topology (OPERATIONS/SETUP describe older Vercel layouts).
- No API reference for server actions beyond `docs/developer/server-actions.md` (hand-written; counts drift).
- No documented intended behaviour for removing a company (B-04).
- Design boards 05 (product screens) and 06 (flows) were never supplied (Gap Report MIS-15).
- `AUDIT.md` (this file) now coexists with `PROJECT_AUDIT.md`, `audit/**` and `docs/spec/07`; they should be reconciled into one current status source.

### 17.3 Requires manual verification

1. `npm run db:doctor` against production — is **0046** applied? (0047's table is.)
2. Signed-in production flows: sign-up email delivery, callback, onboarding, workspace creation.
3. Supabase backups/PITR and a rehearsed restore.
4. Which Vercel project(s) serve/hold env for `seefluence.com`; retire duplicates.
5. Whether `apps/web/.env.local` points at the production Supabase project; rotate the database password if it was shared.
6. Branch protection status on `main` (API returned 404).
7. Mail DNS (SPF/DKIM/DMARC) for whichever sender domain is chosen.
8. First live call of each vendor (Anthropic model IDs/pricing, Apollo, Gmail, Outlook, HubSpot, Resend) on a throw-away workspace with low caps.
9. Inngest compatibility, if Inngest is chosen as the driver.
10. Values of `PUBLIC_RESEARCH_ENABLED`, `NEXT_PUBLIC_AUTH_GOOGLE`, `CSP_ENFORCE` in production.

---

## 18. Prioritized recommendations

### Critical
1. **Give the engine a heartbeat**: set `CRON_SECRET` on Vercel and the repo secret + `HUNTLOOP_URL` variable (or move to a minute-cron plan / Inngest), then confirm a recorded tick in `job_executions` and `/api/health` `cronSecret:true`. Add a last-tick-age alert.
2. **Provision production configuration in dependency order**: `MAILBOX_ENCRYPTION_KEY` → `ANTHROPIC_API_KEY` (with low org caps) → `APOLLO_API_KEY` → Google/Microsoft OAuth → `RESEND_API_KEY`/`EMAIL_FROM` → Sentry/PostHog. Verify each with `/api/health` and one live action.
3. **Run the live-verification pass** (P-3 in the spec pack) on a throw-away workspace: one call per AI task and vendor; fix contract drift before any real user.

### High
4. Resolve the **Free-plan email conflict** (B-08): allow a small Free email allowance or explain the limit where "Reach out" is chosen.
5. **Supply the legal facts** and set up mail authentication before any outbound send to real prospects.
6. Add a **signed-in E2E suite** against a disposable Supabase project (seeded with `db:seed`), including two tenants.
7. **Confirm backups/PITR and rehearse a restore**; run `db:doctor` against prod and record the result.
8. Enable **branch protection** on `main` with required CI.
9. Decide and, if wanted, build **billing** before advertising paid plans.

### Medium
10. Fix **company re-add** (B-03) and decide whether a removed company's opportunities should hide (B-04) — together with an RLS/partial-unique **soft-delete policy** (D-03).
11. Close **fail-open quota edges**: fail closed on RPC error in `withinAiBudget`; make `organizations.plan_id` `NOT NULL`; CHECK the `plans.limits` shape.
12. Map database errors to user messages in `mutate()` instead of returning raw text.
13. Complete the **deferred security-audit units** (S-05) and enforce CSP after a quiet report period with Sentry configured.
14. Decide the fate of **dedup** and **`enrich_person`** (wire or delete), then remove the CI allow-list entries accordingly.
15. Add a **migration ledger** and a CD gate comparing applied vs repository migrations; extend the readiness probe beyond two sentinels.
16. Update **README, COMMAND.md header, CHANGELOG** to current reality; version and tag the deployed security release.

### Low
17. Make hourly/daily sweepers actually skip (e.g., include completed rows in the dedupe window or check last run), and correct the comments (B-09).
18. Remove or use `createNamedWorkspace`, `ActionRail` and the Toast system (B-10, B-11).
19. Raise the timeout or warm imports for `spend-guard.test.ts` (B-12).
20. Validate/clamp the tick `limit` parameter (B-14).
21. Upgrade `@supabase/ssr` and other lagging packages in a dedicated change.
22. Broaden automated axe coverage to every workspace page in demo mode.
23. Add retention for operational tables; consolidate the documentation set.

---

## 19. Final completeness checklist and suggested next steps

### 19.1 Coverage cross-check against the repository

| Area discovered | Covered in |
|---|---|
| 54 pages, layouts, error/loading states, metadata routes | §5.3 |
| Workspace navigation (8 groups, 33 destinations) | §5.2 |
| 29 UI components | §5.4 |
| 137 server actions (39 files) | §7.2 |
| 14 route handlers | §7.1 |
| 54 data-loader modules / demo mode | §7.3 |
| 34 job handlers, 14 sweepers, 3 unreachable | §6 W-03, §15 |
| 16 AI tasks | §7.4 |
| Providers, CRM, mailboxes, email, observability | §7.5 |
| 47 migrations + combined bundle; 81 tables; RLS | §8 |
| Auth, roles, permissions | §9 |
| Environment variables (code vs `.env.example`) | §10.1 |
| CI workflows, tests, scripts, E2E | §11, §13 |
| Docs, audits, design hand-off | §3, §17 |
| Production state | §1, §13 |

Not individually documented here (covered normatively by `COMMAND.md` §0–§15): every button, menu item, modal and form field. This audit verified COMMAND.md's route list and action wiring against the code, not each of its ≈1,200 interaction rows.

### 19.2 Limitations of this audit

- **Not exhaustive.** Breadth-first over 132k lines; deep line-by-line review was limited to the request pipeline, job runner/queue, authorization helpers, quota/budget paths, OAuth start, upload, export, company actions and selected migrations. Previously reported findings were re-checked against current code where cited.
- No signed-in session, real database contents, vendor account or hosting dashboard was accessed; production facts come only from the public `/api/health` endpoint and HTTP status codes.
- Local `.env` files were inspected for variable **names** and empty/non-empty state only; no values were read or recorded.
- Runtime results are from one Windows machine on 2026-10-13.

### 19.3 Suggested next steps

1. Owner decisions (below), then Critical items 1–3.
2. A short "release hygiene" commit: README/COMMAND.md/CHANGELOG corrections, version + tag for the deployed security release.
3. Signed-in E2E + live-verification evidence recorded in `docs/spec/02-technical-requirements.md` §16.
4. Integrity migration batch (soft delete, plan_id, limits CHECK) after a backup point.

### 19.4 Decisions only the owner can make

| Decision | Why it blocks |
|---|---|
| Engine driver (GitHub Actions vs Vercel paid cron vs Inngest) and setting the secrets | Nothing in the product runs without it (B-01) |
| Provisioning vendor accounts/keys and spend caps | AI, discovery, mail, CRM are inert (B-02) |
| Free-plan email allowance / plan packaging / billing timeline | B-08, B-15 |
| Legal identity and lawful-basis facts; sender domain + DNS | B-16; any real outreach |
| Removed-company semantics and soft-delete policy | B-03, B-04, D-03 |
| Wire or retire dedup and person enrichment | B-05 |
| Enable anonymous `/discover` in production (cost exposure) | F-37 |
| Retire duplicate Vercel projects; branch protection | Ops hygiene, S-06 |
