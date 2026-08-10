# Huntloop — Implementation Plan

**Version** 1.0 · **Date** 2026-08-10 · **Source of truth for product scope** [Project_Creation.md](Project_Creation.md)

Design references: **Supabase dashboard** (color system, chrome, density, data tables) + **Kima BD OS / kimacrm.xyz** (dashboard information architecture, stat grid, quota bars, action rail).

---

## 0. Scope, assumptions, and what I'm deliberately not doing

### Assumptions (correct me and I'll adjust)

| # | Assumption | Why |
|---|---|---|
| A1 | Backend is **Supabase** (Postgres + Auth + Storage + Realtime) | You already run Supabase in production (`TruChat`), so the auth flow, RLS mental model, and dashboard are known quantities. Fastest path to a secure multi-tenant Phase 0. |
| A2 | **Next.js 15 (App Router) + TypeScript + Tailwind v4** on the frontend | The reference designs are both dense dark-mode dashboards; this stack + a hand-rolled token layer reproduces them closely with no design-system fighting. |
| A3 | Target is a **real product build**, not a design clone | The plan includes schema, jobs, RLS, and billing, not just screens. If you only want the UI shell, say so and I'll cut Phases 2–4. |
| A4 | Solo/small team, want to ship an MVP, not Phase 4 enterprise | Phase 0+1 is scoped to ~6–8 weeks of focused work; everything past that is explicitly deferred. |
| A5 | Sending is via **connected user mailboxes** (Gmail/Outlook OAuth), not a shared Huntloop sending domain | Deliverability liability stays with the customer's own domain reputation; avoids Huntloop becoming a spam-blast platform (Part 22 of the spec explicitly forbids this). |

### One concern with the spec, stated once

`Project_Creation.md` Part 5 claims the learning loop as the moat. That loop needs **outcome volume** — replies, meetings, closed deals — and a new tenant produces roughly zero of it for the first 60–90 days. So the learning layer cannot be the wedge; it's the retention mechanism. **Phase 1 must be independently valuable without any learning at all** (good discovery + good enrichment + working sending + honest analytics). Phase 3 turns that accumulated data into the differentiator. The plan below is sequenced on that basis. Everything else in the spec I'm building as written.

### Not in this plan

LinkedIn automation (Part 5 of the spec flags the platform-policy risk and I agree — it's a ToS violation that can get customers' accounts banned; treat as a manual-assist feature at most), scraping infrastructure (buy enrichment, don't build a crawler for MVP), and Phase 4 enterprise (SSO/SAML, warehouse, advanced RBAC).

---

## 1. Design system

Everything here is derived from the two screenshots. This section is the contract between design and code — build `packages/ui` against it before building any page.

### 1.1 Color tokens

Supabase's chrome is near-black with a single saturated green accent and hairline borders — no shadows, no gradients. Kima adds a violet accent for AI-attributed elements. I'm keeping both, with a semantic split that earns its place:

> **Green = system state and primary action. Violet = "an AI produced this."**
> A user should be able to tell at a glance which numbers on the dashboard came from a model versus a database count.

```css
/* packages/ui/src/tokens.css */
:root {
  /* ── Surfaces (Supabase: near-black, layered by 3–4% lightness) ── */
  --hl-canvas:            #171717;  /* page background */
  --hl-panel:             #1c1c1c;  /* sidebar, topbar, drawers */
  --hl-surface:           #1f1f1f;  /* cards, table headers */
  --hl-surface-hover:     #242424;
  --hl-surface-active:    #2a2a2a;
  --hl-overlay:           #0a0a0acc; /* modal scrim */

  /* ── Borders (hairline, never shadows) ── */
  --hl-border-subtle:     #262626;  /* card edges, table row dividers */
  --hl-border-default:    #343434;  /* inputs, buttons, dropdowns */
  --hl-border-strong:     #4a4a4a;  /* focus-adjacent, hovered inputs */

  /* ── Text ── */
  --hl-text:              #ededed;  /* primary */
  --hl-text-secondary:    #a1a1a1;  /* supporting copy, table cells */
  --hl-text-muted:        #6f6f6f;  /* labels, timestamps, placeholders */
  --hl-text-inverse:      #0f0f0f;  /* on brand-filled buttons */

  /* ── Brand green (Supabase #3ECF8E) ── */
  --hl-brand:             #3ecf8e;
  --hl-brand-hover:       #4ae0a0;
  --hl-brand-active:      #34b87c;
  --hl-brand-surface:     #0e2a1e;  /* filled chip / selected nav bg */
  --hl-brand-border:      #1f5a3f;
  --hl-brand-text:        #6ee7b0;  /* green text on dark surface */

  /* ── AI violet (Kima) ── */
  --hl-ai:                #8b5cf6;
  --hl-ai-surface:        #1e1633;
  --hl-ai-border:         #3f2d6b;
  --hl-ai-text:           #b79dfb;

  /* ── Status ── */
  --hl-success:           #3ecf8e;  --hl-success-surface: #0e2a1e;
  --hl-warning:           #f5a623;  --hl-warning-surface: #2b1f08;
  --hl-danger:            #e5484d;  --hl-danger-surface:  #2b1113;
  --hl-info:              #3b9eff;  --hl-info-surface:    #0d1f33;

  /* ── Data-viz ramp (score pills, charts, breakdown bars) ── */
  --hl-score-poor:        #e5484d;  /* 0–39  */
  --hl-score-fair:        #f5a623;  /* 40–69 */
  --hl-score-good:        #3ecf8e;  /* 70–89 */
  --hl-score-excellent:   #22d3a6;  /* 90+   */
  --hl-chart-1: #3ecf8e; --hl-chart-2: #8b5cf6; --hl-chart-3: #3b9eff;
  --hl-chart-4: #f5a623; --hl-chart-5: #e5484d; --hl-chart-6: #64748b;

  /* ── Focus ring (accessibility, non-negotiable) ── */
  --hl-focus:             #3ecf8e;
  --hl-focus-ring:        0 0 0 2px var(--hl-canvas), 0 0 0 4px var(--hl-brand);
}
```

**Light mode is deferred.** Both references are dark-only; shipping a half-tuned light theme costs more than it returns pre-PMF. Structure tokens as CSS variables now so light mode is a `:root[data-theme="light"]` block later, never a refactor.

### 1.2 Typography

| Role | Token | Spec |
|---|---|---|
| UI sans | `--hl-font-sans` | `"Inter var", system-ui, -apple-system, sans-serif` |
| Mono | `--hl-font-mono` | `"JetBrains Mono", "Source Code Pro", ui-monospace, monospace` — IDs, domains, API keys, token counts |

| Style | Size / line-height / weight | Where |
|---|---|---|
| `display` | 30 / 36 / 600 | Page title ("Cmbatman's Project" → "BD Command Center") |
| `h1` | 20 / 28 / 600 | Section headers |
| `h2` | 16 / 24 / 600 | Card titles |
| `body` | 14 / 20 / 400 | Default — **this is the workhorse size, matching both references** |
| `body-sm` | 13 / 18 / 400 | Table cells, dense lists |
| `caption` | 12 / 16 / 400 | Timestamps, helper text |
| `label` | 11 / 16 / 500, `letter-spacing: 0.06em`, `text-transform: uppercase`, color `--hl-text-muted` | **The Supabase signature.** `STATUS`, `COMPUTE`, `LAST MIGRATION`, `PIPELINE OVERVIEW`. Use on every stat card and section header. |
| `metric` | 32 / 36 / 600, `font-variant-numeric: tabular-nums` | The big numbers in the stat grid (Kima's `54`, `90`, `180`) |
| `metric-sm` | 20 / 24 / 600, tabular | Inline counts, quota numerators |

Always `tabular-nums` on anything that updates in place — otherwise polling makes numbers jitter.

### 1.3 Spacing, radius, motion

- **Space scale (4px base):** `1=4 2=8 3=12 4=16 5=20 6=24 8=32 10=40 12=48 16=64`
- **Radius:** `sm=4` (badges, pills) · `md=6` (buttons, inputs, cards — the Supabase default) · `lg=8` (modals, drawers) · `full` (avatars, score pills)
- **Elevation:** **none.** Depth is expressed with 1px borders and surface lightness, exactly as Supabase does. The only `box-shadow` in the system is the focus ring and the dropdown/popover (`0 8px 24px #00000066` + a 1px border).
- **Motion:** `120ms ease-out` for hover/color, `180ms cubic-bezier(0.16,1,0.3,1)` for drawers and dropdowns. Respect `prefers-reduced-motion`.
- **Density:** table rows `44px`, nav items `32px`, buttons `32px` (default) / `28px` (sm) / `40px` (lg). Both references are dense; do not pad up.

### 1.4 Component inventory (`packages/ui`)

Build in this order — the first six unblock the dashboard.

| # | Component | Spec notes drawn from the references |
|---|---|---|
| 1 | `StatCard` | Icon in a 40px rounded-square tile (`--hl-surface-active` bg, colored icon) · uppercase `label` · `metric` number · optional `Click to view →` affordance in `--hl-text-muted` · optional corner `↗` link glyph. This is the Kima pipeline card, rendered with Supabase's border/label treatment. |
| 2 | `Card` | `--hl-surface` bg, 1px `--hl-border-subtle`, radius 6, header row with `h2` + right-slot actions, `--hl-border-subtle` divider, body padding 20. |
| 3 | `Badge` | Variants: `neutral` `brand` `ai` `success` `warning` `danger` · sizes `sm`/`md` · filled (`*-surface` bg + `*-border` + `*-text`) or dot-only. Covers `FREE`, `PRODUCTION`, `NEW`, `BETA`, `AI`. |
| 4 | `ScorePill` | Circular/rounded pill, background from the score ramp at 15% alpha, text at full color, tabular numerals. Kima's `42` / `52` score column. **Must expose the score's reason on hover/focus** — never show an unexplained number (spec Part 7 §7, "explainable AI decisions"). |
| 5 | `DataTable` | Checkbox col · muted uppercase header row on `--hl-surface` · 44px rows with `--hl-border-subtle` bottom border · row hover `--hl-surface-hover` · sticky header · horizontal scroll inside its own container · server-side sort/filter/cursor-paginate. Modeled directly on the Supabase Auth → Users table. |
| 6 | `FilterBar` | Left: search input with leading icon + column-scope dropdown. Right: refresh icon button + primary green action. Exactly the Supabase Users toolbar. |
| 7 | `QuotaBar` | Label · `used / limit` · thin 4px track, fill colored by utilization (`brand` <80%, `warning` 80–99%, `danger` at 100%) · `FULL` badge at cap. Kima's "Lead Queue Quotas". |
| 8 | `BreakdownList` | Label + right-aligned count + horizontal bar, bar color cycling the chart ramp. Kima's "By Customer Type" / "By Product". |
| 9 | `ActionRail` | Right-side stack of dismissible action cards (title, source badge, overdue duration, primary + secondary action, `+N more` footer). Kima's follow-up queue. Collapsible; **must never overlay content on <1440px** — becomes a tab below the fold instead. |
| 10 | `Sidebar` | Grouped nav (`COMPANY` / `INTELLIGENCE` / `PIPELINE` / `REPORTS` / `SETTINGS`) with uppercase `label` group headers · 32px items, icon + text · active item gets `--hl-brand-surface` bg + 2px left `--hl-brand` bar · trailing `AI`/`NEW`/`BETA` badges · collapsible to icon rail. Kima's grouping, Supabase's active treatment. |
| 11 | `TopBar` | Breadcrumb switchers (org → workspace → campaign) each with a `⌄` combobox, mirroring Supabase's org/project/branch chain · `⌘K` search · Feedback · help · avatar. |
| 12 | `Drawer` / `Modal` / `Toast` / `Tooltip` / `Popover` | Standard; radius 8, 1px border, scrim `--hl-overlay`. Destructive modals require typed confirmation for org/campaign deletion. |
| 13 | `Chart` | Wrap a single lib. **Load the `dataviz` skill before writing the first chart** — it defines the palette validation and mark specs. Bar/line/funnel/sparkline only for MVP. |
| 14 | `EmptyState` / `LoadingSkeleton` / `ErrorState` / `PermissionDenied` / `RateLimited` | Spec Part 25 requires all of these per feature. Building them as components (not per-page one-offs) is what makes Part 25 achievable. |

### 1.5 Accessibility floor (enforced in CI)

- Contrast ≥ 4.5:1 for body text, ≥ 3:1 for UI borders and large text. **`--hl-text-muted` (#6f6f6f) on `--hl-canvas` is ~4.6:1 — it passes, but only just; never use it for anything actionable.**
- Every interactive element reachable by keyboard with a visible `--hl-focus-ring`.
- **Score and status are never communicated by color alone** — pills carry the number, status dots carry text labels.
- `axe-core` in the Playwright suite; a violation fails the build.

---

## 2. Dashboard information architecture

Kima's `BD Command Center` maps onto Huntloop's loop almost one-to-one. Here's the translation:

```
┌─ TopBar ────────────────────────────────────────────────────────────┐
│ Huntloop · Acme Inc ⌄ · Q3 Outbound ⌄  │ ⌘K Search  Feedback ? [av] │
├──────────────┬──────────────────────────────────────┬───────────────┤
│              │  Command Center            Aug 10    │  NEEDS YOU    │
│  COMPANY     │  ● Live · 3 campaigns running        │  ┌──────────┐ │
│   Product    │                                      │  │ 12 replies│ │
│   ICP     AI │  ⚠ 61 leads awaiting review →        │  │ unread    │ │
│              │  ⚡ 88 leads scored 70+ →             │  └──────────┘ │
│  INTELLIGENCE│                                      │  ┌──────────┐ │
│   Co-Pilot AI│  ── PIPELINE OVERVIEW ──             │  │ 5 msgs    │ │
│   Today's    │  ┌────┐ ┌────┐ ┌────┐ ┌────┐        │  │ need appr.│ │
│   Command  ● │  │ 0  │ │ 54 │ │ 5  │ │ 90 │        │  └──────────┘ │
│   Intelligence│ │New │ │Qual│ │Appr│ │Sent│        │  ┌──────────┐ │
│              │  └────┘ └────┘ └────┘ └────┘        │  │ mailbox   │ │
│  PIPELINE    │  ┌────┐ ┌────┐ ┌────┐ ┌────┐        │  │ health ⚠  │ │
│   Leads      │  │ 5  │ │ 2  │ │ 2  │ │180 │        │  └──────────┘ │
│   Campaigns  │  │Repl│ │Meet│ │Rej │ │Tot │        │   +5 more →   │
│   Inbox   ● 12│ └────┘ └────┘ └────┘ └────┘        │               │
│              │                                      │               │
│  REPORTS     │  ── SENDING CAPACITY ──              │               │
│   Analytics  │  founder@acme.co  38/50  ▓▓▓▓▓░ 76% │               │
│   Learning AI│  sales@acme.co    50/50  ▓▓▓▓▓▓ FULL│               │
│   Exports    │                                      │               │
│              │  ┌── RECENT LEADS ───┐ ┌─ BY ICP ──┐│               │
│  SETTINGS    │  │ Co. Score Status  │ │ SaaS  67 ▓▓││               │
│              │  │ Alphio  42  New   │ │ Fin   43 ▓ ││               │
│              │  └───────────────────┘ └───────────┘│               │
└──────────────┴──────────────────────────────────────┴───────────────┘
```

### Adaptations from Kima, with reasons

| Kima element | Huntloop version | Why the change |
|---|---|---|
| "Lead Queue Quotas · agent pauses when full" | **Sending Capacity** (per-mailbox daily send limits) | Lead-count quotas are an artificial constraint. Mailbox send limits are a *real* one — exceeding them destroys deliverability, which is the actual failure mode this UI should prevent. Same visual component, load-bearing meaning. |
| Notification rail showing "37d overdue" follow-ups | **Needs You** rail: unread positive replies → messages awaiting approval → mailbox health → failed enrichments | "37 days overdue" on five separate cards is a UI that has already failed the user. The rail should surface *what blocks the loop right now*, capped at 5 with a count-link for the rest, and each item must be resolvable inline. |
| "Powered by GPT-4o + Tavily + Hunter.io" in the header | Removed | Naming your vendors in the product chrome is free advertising for them and a switching cost for you. Provider health belongs in Settings → Integrations and the internal admin console. |
| 8 stat cards, all equal weight | 8 cards, **first row = loop stages, second row = outcomes** | The spec's north-star candidate is qualified pipeline, not activity. Outcomes (replies/meetings/opportunities/revenue) get their own visually distinct row so activity metrics can't masquerade as results. |
| "Discovery runs on manual click only" footer | **Autonomy level indicator** (L0–L5, spec Part 44) with an inline control | Same information, but framed as the product's autonomy ladder rather than a limitation. |

### Route map

```
(marketing)   /  /product  /pricing  /use-cases/[slug]  /compare/[slug]  /blog/*  /docs/*
(auth)        /login  /signup  /forgot  /accept-invite/[token]
(onboarding)  /welcome/{org,product,icp,mailbox,persona,first-campaign}
(app)         /[org]/
                dashboard                      ← Command Center (above)
                leads                          ← DataTable + FilterBar + saved views
                leads/[id]                     ← profile, signals, score-explanation, timeline
                discovery                      ← ICP builder, search, results, bulk add
                campaigns  campaigns/[id]  campaigns/[id]/edit
                inbox  inbox/[threadId]
                analytics  analytics/{funnel,campaigns,messages,attribution}
                intelligence                   ← what Huntloop learned, why scores moved
                settings/{general,members,mailboxes,integrations,billing,usage,api,security,data}
(admin)       /admin/{orgs,providers,jobs,ai-usage,flags,abuse}
```

---

## 3. Architecture decisions

Format per spec Part 67: **Decision → Reason → Trade-off → Risk → Alternative.**

### D1 — Modular monolith on Next.js + Supabase Postgres

**Reason:** One deployable, one datastore, one auth context. Multi-tenancy is enforced once (RLS) rather than in N services. **Trade-off:** Compute for API routes and background workers can't scale independently. **Risk:** Long AI/enrichment work doesn't fit in serverless request timeouts. **Mitigation:** all long work goes to a durable job runner (D3) from day one — that boundary is the thing that makes the monolith survivable. **Alternative:** NestJS + separate services; rejected as premature (spec Part 13: "Do not introduce microservices prematurely").

### D2 — Supabase Auth + Postgres Row Level Security as the tenant boundary

**Reason:** RLS makes cross-tenant leakage a database-level impossibility rather than an application-level discipline. Given that leads and inboxes are the most sensitive data in the product, defense-in-depth here is worth the ergonomic cost. **Trade-off:** Every table needs `org_id` + policies; RLS-aware queries are harder to reason about and can hide performance cliffs. **Risk:** The service-role key bypasses RLS entirely — one misplaced admin client in a request path and the boundary is gone. **Mitigation:** service-role client lives in exactly one module (`packages/db/src/admin.ts`), is import-restricted by ESLint, is never importable from `apps/web`, and every use site carries an explicit `org_id` filter *plus* a comment justifying the bypass. A cross-tenant Playwright test (org A cannot read org B's leads through any route) runs on every PR. **Alternative:** app-layer scoping only; rejected — one forgotten `WHERE org_id` is a breach.

### D3 — Durable job runner (Inngest or Trigger.dev), not Supabase Edge Functions

**Reason:** Enrichment, AI research, sequence sending, and reply sync are long-running, retryable, rate-limited, and must be fair across tenants. Edge Functions have short timeouts and no first-class retry/DLQ/concurrency semantics. **Trade-off:** A third vendor and another dashboard. **Risk:** Vendor lock-in on workflow definitions. **Mitigation:** all business logic lives in `packages/jobs/src/handlers/*` as plain functions; the vendor SDK only supplies triggering, retry, and concurrency. Swapping runners means rewriting ~200 lines of registration, not the pipeline. **Alternative:** self-hosted BullMQ + Redis (more ops), or pg-boss on the existing Postgres (fewer vendors, weaker observability, competes with the app for DB connections — a reasonable fallback if you want zero new vendors).

### D4 — Enrichment via provider abstraction with a cache-first waterfall

**Reason:** Enrichment is the single largest variable cost and the least reliable dependency. A `ProviderRegistry` with per-field confidence scoring, ordered fallback, and a shared normalized cache is what keeps both the bill and the outage blast radius down. **Trade-off:** More upfront abstraction than a single-provider integration. **Risk:** Over-abstracting before knowing which providers actually matter. **Mitigation:** ship the interface with **one** provider behind it in Phase 1; the interface is ~80 lines and the second provider proves it. **Alternative:** hardcode one vendor; rejected — provider outage becomes total product outage, and every data-quality rule in spec Part 42 becomes unimplementable.

### D5 — Claude for the AI layer, with explicit per-task model routing

**Reason:** Structured outputs, prompt caching (large shared ICP/product context reused across every lead), and long context fit this pipeline. Caching matters disproportionately here — the ICP + product description + messaging guidelines are identical across thousands of leads in a campaign. **Trade-off:** Single-provider dependency. **Risk:** Cost blowout at volume. **Mitigation:** the routing table and budget enforcement in §7. **Alternative:** multi-provider abstraction on day one; deferred — build the internal `LLMTask` interface so the swap is possible, but don't pay the abstraction cost before you have a reason.

### D6 — Marketing site in the same Next.js app, not a separate CMS

**Reason:** Programmatic SEO pages (`/compare/[slug]`, `/use-cases/[slug]`) share the design system and deploy pipeline. **Trade-off:** Marketing deploys are coupled to app deploys. **Risk:** Content edits require a PR. **Mitigation:** MDX in-repo for Phase 1; move to a headless CMS when a non-engineer needs to publish. **Alternative:** separate Astro site; better isolation, but duplicates the token layer.

---

## 4. Repository structure

```
huntloop/
├─ apps/
│  ├─ web/                        # Next.js 15 App Router — marketing + app + admin
│  │  ├─ app/(marketing)/ (auth)/ (onboarding)/ (app)/ (admin)/
│  │  ├─ app/api/                 # thin route handlers → packages/core
│  │  └─ middleware.ts            # org resolution, auth guard, rate limit
│  └─ workers/                    # job runner entrypoint (registers packages/jobs)
├─ packages/
│  ├─ ui/                         # design system — tokens.css + §1.4 components
│  │  ├─ src/tokens.css
│  │  ├─ src/components/
│  │  └─ src/patterns/            # StatGrid, LeadTable, ScoreExplanation
│  ├─ db/                         # Drizzle schema, migrations, RLS policies, seeds
│  │  ├─ schema/                  # one file per domain (§5)
│  │  ├─ migrations/
│  │  ├─ policies/                # RLS, versioned alongside schema
│  │  └─ src/admin.ts             # ⚠ service-role client — import-restricted
│  ├─ core/                       # domain services: leads, scoring, campaigns, sending
│  ├─ ai/                         # LLMTask interface, prompts, model routing, evals
│  │  ├─ prompts/                 # versioned, git-tracked, hash-pinned
│  │  ├─ tasks/                   # research, qualify, personalize, classify-reply
│  │  └─ evals/                   # golden sets + regression runner
│  ├─ providers/                  # enrichment/email/CRM adapters behind one interface
│  ├─ jobs/                       # handlers (plain fns) + runner registration
│  ├─ analytics/                  # event taxonomy, typed emitters
│  └─ config/                     # eslint, tsconfig, tailwind preset
├─ e2e/                           # Playwright: critical flows + tenant-isolation suite
└─ docs/                          # ADRs, runbooks, API reference
```

---

## 5. Data model (Phase 0 + 1)

Every tenant-scoped table carries `org_id uuid not null references organizations(id) on delete cascade`, `created_at`, `updated_at`, `deleted_at` (soft delete), and an RLS policy. Abbreviated to essential columns.

```
── Identity & billing ──────────────────────────────────────────────
organizations       id, name, slug(uniq), plan_id, trial_ends_at, settings jsonb
memberships         org_id, user_id, role(owner|admin|member|viewer), invited_by
                    UNIQUE(org_id, user_id)
plans               id, name, price_cents, limits jsonb
subscriptions       org_id, stripe_sub_id, status, current_period_end
usage_counters      org_id, period, metric(leads|enrich|ai_tokens|emails), used, limit
                    UNIQUE(org_id, period, metric)
audit_logs          org_id, actor_id, action, target_type, target_id, meta jsonb, ip

── ICP & product ───────────────────────────────────────────────────
products            org_id, name, description, value_props jsonb, proof_points jsonb
icps                org_id, product_id, name, criteria jsonb, negative_criteria jsonb,
                    is_active, version
personas            org_id, icp_id, title_patterns text[], seniority[], pain_points jsonb

── Leads ───────────────────────────────────────────────────────────
companies           org_id, domain, name, industry, employee_count, revenue_band,
                    country, region, tech_stack text[], funding jsonb,
                    UNIQUE(org_id, domain)
people              org_id, company_id, first_name, last_name, title, seniority,
                    linkedin_url, source
contact_points      org_id, person_id, kind(email|phone|linkedin), value,
                    verification_status, confidence numeric, verified_at, provider
                    UNIQUE(org_id, kind, value)      ← dedup key
leads               org_id, person_id, company_id, icp_id, status, score int,
                    score_version, stage, owner_id, source, first_seen_at,
                    UNIQUE(org_id, person_id)
lead_signals        org_id, lead_id, kind(hiring|funding|tech|news|intent|web),
                    payload jsonb, strength numeric, observed_at, expires_at
enrichment_records  org_id, entity_type, entity_id, provider, field, value,
                    confidence, cost_cents, fetched_at, raw jsonb
                    ← never overwrite higher-confidence data (spec Part 42)

── Qualification ───────────────────────────────────────────────────
scoring_rules       org_id, icp_id, name, expression jsonb, weight, is_active
lead_scores         org_id, lead_id, model_version, score, breakdown jsonb,
                    explanation text, computed_at
                    ← breakdown/explanation power ScorePill's hover. Required.

── Campaigns & outreach ────────────────────────────────────────────
mailboxes           org_id, provider(gmail|outlook|smtp), email, display_name,
                    oauth_token_enc, refresh_token_enc, daily_limit, sent_today,
                    health_score, warmup_stage, status
campaigns           org_id, name, icp_id, product_id, status, autonomy_level(0-5),
                    schedule jsonb, sending_config jsonb, started_at
sequences           org_id, campaign_id, name, version
sequence_steps      org_id, sequence_id, position, kind(email|wait|condition),
                    delay_hours, template jsonb, conditions jsonb
enrollments         org_id, campaign_id, lead_id, status, current_step, next_action_at,
                    UNIQUE(org_id, campaign_id, lead_id)   ← prevents double-enrollment
messages            org_id, enrollment_id, step_id, mailbox_id, direction,
                    subject, body_html, body_text, ai_generated bool, approved_by,
                    scheduled_at, sent_at, provider_message_id, thread_id
message_events      org_id, message_id, kind(delivered|bounced|opened|clicked|
                    replied|complained|unsubscribed), payload jsonb, occurred_at
threads             org_id, lead_id, mailbox_id, subject, last_message_at,
                    status(open|snoozed|won|lost), classification, assignee_id
suppressions        org_id, kind(email|domain), value, reason, source
                    UNIQUE(org_id, kind, value)     ← checked before EVERY send

── AI & learning ───────────────────────────────────────────────────
ai_runs             org_id, task, model, prompt_version, input_hash,
                    input_tokens, output_tokens, cache_read_tokens, cost_cents,
                    latency_ms, status, error, entity_type, entity_id
ai_decisions        org_id, run_id, decision_type, output jsonb, confidence,
                    human_override jsonb, overridden_by, overridden_at
                    ← the human-override record IS the training signal
outcomes            org_id, lead_id, campaign_id, kind(reply|positive|meeting|
                    opportunity|customer), value_cents, occurred_at
                    ← the join target for the entire learning loop

── Events & jobs ───────────────────────────────────────────────────
events              org_id, user_id, name, properties jsonb, occurred_at
                    ← partition by month from day one; this table grows fastest
job_executions      org_id, job_name, status, attempts, payload jsonb, error,
                    started_at, finished_at
```

### Indexes that are not optional

```sql
create index on leads (org_id, status, score desc);           -- lead table default sort
create index on leads (org_id, icp_id, score desc);           -- ICP-filtered views
create index on enrollments (org_id, next_action_at)
  where status = 'active';                                    -- the send scheduler's hot path
create index on message_events (org_id, message_id, kind);
create index on lead_signals (org_id, lead_id, observed_at desc);
create index on contact_points (org_id, kind, value);         -- dedup lookups
create index on ai_runs (org_id, task, created_at desc);      -- cost dashboards
create index on events (org_id, name, occurred_at desc);
```

### RLS pattern (applied to every tenant table)

```sql
alter table leads enable row level security;

create policy tenant_isolation on leads
  for all
  using  (org_id in (select org_id from memberships where user_id = auth.uid()))
  with check (org_id in (select org_id from memberships where user_id = auth.uid()));
```

Write-heavy tables additionally get a role check via a `has_org_role(org_id, min_role)` SQL function so `viewer` cannot mutate.

---

## 6. Background jobs

| Job | Trigger | Concurrency | Retry | Idempotency key |
|---|---|---|---|---|
| `discovery.run` | manual / schedule | 2 per org | 3× exp | `(search_id, cursor)` |
| `lead.dedupe` | after discovery | 5 global | 3× | `(org_id, email\|domain+name)` |
| `enrich.lead` | after dedupe | 10 per org, provider rate-limited | 5× exp + provider fallback | `(lead_id, provider, field)` |
| `verify.email` | after enrich | 20 global | 3× | `(contact_point_id)` |
| `ai.research` | after enrich | 5 per org | 2× | `(lead_id, prompt_version)` |
| `ai.qualify` | after research | 5 per org | 2× | `(lead_id, icp_version, prompt_version)` |
| `ai.personalize` | on enrollment | 5 per org | 2× | `(enrollment_id, step_id, prompt_version)` |
| `send.step` | scheduler, 1-min tick | **1 per mailbox** | 3× then park | `(enrollment_id, step_id)` |
| `inbox.sync` | 5-min poll + webhook | 1 per mailbox | 5× | `(mailbox_id, history_id)` |
| `ai.classify_reply` | on inbound message | 10 global | 2× | `(message_id, prompt_version)` |
| `analytics.rollup` | hourly | 1 per org | 3× | `(org_id, period)` |
| `learning.recompute` | nightly | 1 per org | 2× | `(org_id, date)` |

**Non-negotiable invariants:**
1. `send.step` is serialized per mailbox and checks, in order: suppression list → mailbox daily cap → schedule window (recipient timezone) → reply-detected-on-thread. Any failure parks the enrollment rather than retrying blindly.
2. Every AI job writes an `ai_runs` row **before** calling the model, so a crashed job still shows up in cost accounting.
3. Every job handler takes `(payload, ctx)` where `ctx` carries `org_id` and a tenant-scoped DB client. No handler may construct its own admin client.
4. Per-org fairness: cap concurrent jobs per org so one tenant's 50k-lead import can't starve everyone else.

---

## 7. AI layer

### 7.1 Task → model routing

Costs below are current Anthropic list prices ($ per million tokens). **Note the Sonnet 5 introductory rate expires 2026-08-31** — three weeks from today — so model any Sonnet-heavy path at the standard rate.

| Model | ID | Input | Output |
|---|---|---|---|
| Claude Opus 5 | `claude-opus-5` | $5.00 | $25.00 |
| Claude Sonnet 5 | `claude-sonnet-5` | $3.00 (intro $2.00 → 2026-08-31) | $15.00 (intro $10.00) |
| Claude Haiku 4.5 | `claude-haiku-4-5` | $1.00 | $5.00 |

| Task | Recommended model | Effort | Why |
|---|---|---|---|
| `classify_reply` | `claude-haiku-4-5` | — | Short input, fixed label set, structured output. High volume. |
| `extract_signals` | `claude-haiku-4-5` | — | Deterministic extraction from fetched pages. |
| `research_company` | `claude-opus-5` | `medium` | Multi-source synthesis with web fetch; quality here propagates into every message. |
| `qualify_lead` | `claude-opus-5` | `high` | This decides where money goes. Correctness > cost. |
| `personalize_message` | `claude-opus-5` | `medium` | The customer-visible artifact. A bad opener burns the prospect permanently. |
| `analyze_performance` | `claude-opus-5` | `high` | Low volume, high leverage — powers the Intelligence Center. |

Haiku is proposed only where the task is genuinely closed-set classification. **Everything customer-facing runs on Opus 5** — the failure cost of a bad qualification or a tone-deaf opening line vastly exceeds the token delta. If you want to trade quality for cost on any of these, that's your call to make explicitly, not mine to make by default.

### 7.2 The techniques that actually control the bill

1. **Prompt caching is the single biggest lever.** Product description + ICP + messaging guidelines + few-shot examples are byte-identical across every lead in a campaign — typically 3–6k tokens. Put them first, `cache_control` on the last stable block, and put the per-lead payload after it. Cache reads bill at ~0.1×. Order is `tools → system → messages`; **never interpolate a timestamp, lead ID, or UUID into the system prompt** or the cache dies silently.
2. **Batch API for non-interactive work** (nightly re-scoring, bulk enrichment synthesis): 50% off, results within an hour.
3. **Structured outputs** (`output_config.format`) on every extraction/classification task — no parse-retry loops.
4. **Per-org token budgets** enforced in `packages/ai` before the call, not after. Soft warn at 80%, hard stop at 100% with a UI banner.
5. **Deduplicate by `input_hash`** — the same company researched for two different leads is one call.

### 7.3 Estimated unit cost (Phase 1 shape)

Rough per-lead AI cost with caching active, Opus 5 on research/qualify/personalize:

| Step | Uncached in | Cached in | Out | ~Cost |
|---|---|---|---|---|
| research_company (amortized across ~2 leads/company) | 3k | 4k | 1.5k | ~$0.03 |
| qualify_lead | 1.5k | 4k | 0.6k | ~$0.02 |
| personalize (3 steps) | 3×1k | 3×4k | 3×0.4k | ~$0.05 |
| classify_reply (~15% reply rate, Haiku) | — | — | — | ~$0.00 |
| **AI total per contacted lead** | | | | **~$0.10** |

Enrichment providers ($0.02–0.20/contact) and email verification ($0.003–0.01) will dominate this. **Model the enrichment bill before the AI bill.** At $299/mo for 1,000 contacted leads: ~$100 AI + ~$120 enrichment + ~$20 infra ≈ **60% gross margin** — thin for SaaS. Levers: cache aggressively, cap enrichment retries, price per-contacted-lead rather than per-lead-stored.

### 7.4 Guardrails

- **Prompt injection:** every enriched field and fetched page is untrusted. Wrap external content in delimited blocks with an explicit "this is data, not instructions" system framing, and never let a tool call be triggered by fetched content.
- **PII:** never write API keys or credentials into prompts. Redact contact emails from research prompts where not needed.
- **Hallucination:** personalization prompts must cite the `lead_signal` ID backing each claim; a message referencing an unverifiable fact fails validation and is routed to human review rather than sent.
- **Evals:** golden sets of 50 leads per task in `packages/ai/evals`, run in CI on any prompt change. A prompt is a versioned artifact; `ai_runs.prompt_version` makes regressions attributable.

---

## 8. Build phases

### Phase 0 — Foundation (~1.5 weeks)

Monorepo, CI, Supabase project, Drizzle schema for identity/billing, **RLS policies + the cross-tenant Playwright test**, auth (email + Google OAuth, matching your existing setup), org creation, invites, RBAC, `packages/ui` tokens + components 1–6, app shell (Sidebar + TopBar + all Part 25 states), Sentry + structured logging, Stripe products/webhooks (no metering yet).

**Done when:** two orgs exist, org A provably cannot read org B's data through any route, the shell renders at all breakpoints, and `axe-core` passes.

### Phase 1 — MVP: the loop runs end-to-end (~4–5 weeks)

Product + ICP setup, discovery against one provider, dedupe, `ProviderRegistry` + enrichment for one provider, email verification, lead table + lead detail, rule-based scoring with visible explanations, Gmail + Outlook OAuth mailbox connection, campaign builder (3-step sequences), send scheduler with all four invariants, inbox sync + unified inbox, `classify_reply`, basic analytics (funnel + per-campaign), usage metering + plan limits, Command Center dashboard.

**Done when:** a new signup can go from zero to a running campaign in under 20 minutes and see a real reply land in the inbox — with **no AI generation involved**. Templates with merge fields are enough. This is the "independently valuable without learning" bar from §0.

### Phase 2 — Automation (~4 weeks)

`ai.research` / `ai.qualify` / `ai.personalize` with human approval gates, AI reply classification driving thread status, autonomy levels 0–3 with per-campaign guardrails, workflow triggers, message-approval queue in the Needs You rail, AI cost dashboard, per-org budgets, prompt eval suite in CI.

**Done when:** a campaign at autonomy L3 drafts personalized messages that a human approves in bulk, and AI cost per contacted lead is measured and visible.

### Phase 3 — Intelligence (~4 weeks)

`outcomes` capture, nightly feature aggregation, statistical (not ML) correlation of lead/message attributes to outcomes with confidence intervals, Intelligence Center UI, ICP recommendations, message A/B experiments with proper sample-size gating, score model versioning + drift detection.

**Done when:** the Intelligence Center shows at least three statistically supported findings per active org and score changes are explainable to the user.

**Guard:** do not ship a "learning" claim in the UI until an org has ≥200 outcomes. Below that, show sample-size warnings instead of conclusions. Shipping noise as insight is how this feature loses trust permanently.

### Phase 4 — Scale (deferred)

SSO/SAML, advanced RBAC, warehouse + ClickHouse for analytics, CRM bidirectional sync, public API + webhooks, agency multi-client workspaces.

---

## 9. Cross-cutting requirements

**Definition of done for every feature** (spec Part 71 — enforced by PR template checklist): UI + API + schema + validation + authorization + error/loading/empty states + retry + analytics events + tests + observability + docs + security review + performance consideration + edge cases.

**Performance targets:** dashboard TTFB < 500ms · lead table (10k rows, filtered) < 800ms · lead detail < 400ms · inbox thread < 300ms. Cursor pagination everywhere; no `OFFSET` on leads.

**Observability:** structured logs with `org_id` + `request_id` on every line · OpenTelemetry traces spanning route → job → provider → model call · alerts on queue depth, provider error rate, AI cost spike (>2× 7-day median), mailbox bounce rate >3%, and **any cross-tenant access attempt** (paged immediately).

**Compliance:** suppression list checked before every send · one-click unsubscribe (RFC 8058) in every email · GDPR data export + deletion within 30 days · DPA and subprocessor list published before first paying EU customer · CAN-SPAM physical address in footer. *Not legal advice — get a lawyer to review the outbound compliance posture before EU launch.*

---

## 10. Risk register (top 6)

| Risk | P | Impact | Mitigation |
|---|---|---|---|
| Deliverability collapse from a careless customer | High | Critical | Per-mailbox caps, warmup gating, bounce-rate circuit breaker that auto-pauses campaigns >3%, no shared sending domain |
| Enrichment cost exceeds revenue per account | High | High | Cache-first waterfall, per-org enrichment budget, price on *contacted* leads |
| Learning loop never gets enough data | High | High | §0 sequencing — Phase 1 valuable without it; Phase 3 gated on ≥200 outcomes |
| Cross-tenant data leak | Low | Critical | RLS + import-restricted admin client + isolation test in CI + paging alert |
| Enrichment provider outage or shutdown | Medium | High | Provider abstraction from Phase 1 with a second provider added in Phase 2 |
| AI cost spike from a runaway loop | Medium | High | Per-org token budgets enforced pre-call, max job iterations, cost-spike alert |

---

## 11. Immediate next steps

1. **Confirm §0 assumptions** — especially A1 (Supabase) and A3 (real build vs. UI shell). These change the plan materially.
2. **Scaffold `packages/ui`** — `tokens.css` from §1.1 plus components 1–6, rendered on a `/kitchen-sink` route. This is the fastest way to validate the Supabase+Kima synthesis visually before any product logic exists.
3. **Build the Command Center as a static page** against fixtures, at 1280 / 1440 / 1920 and mobile. Prove the layout before wiring data.
4. **Then** Phase 0 in order: schema → RLS → isolation test → auth → shell.

Say the word and I'll start at step 2.
