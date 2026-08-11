# Huntloop — Implementation Plan

**Version** 1.1 · **Date** 2026-08-11 · **Governing product intent** [HuntLoop — Master Product, Technical & Engineering Context.md](HuntLoop%20—%20Master%20Product,%20Technical%20&%20Engineering%20Context.md) · **Execution spec** [Project_Creation.md](Project_Creation.md)

Design references: **Supabase dashboard** (color system, chrome, density, data tables) + **Kima BD OS / kimacrm.xyz** (dashboard information architecture, stat grid, quota bars, action rail). This is a settled decision and the master context does not disturb it — §87 lists the design system as UNKNOWN, which means unspecified, not contradicted.

---

## 0.0 Document precedence

Master context §92 sets the order, and it is the rule this repo follows:

| Rank | Source | Authority |
|---|---|---|
| 1 | An explicit instruction from the product owner | May update product intent at any time |
| 2 | The master context document | Defines product intent and confirmed requirements |
| 3 | `Project_Creation.md` | Execution-level spec: phases, cost model, UI states, API shape |
| 4 | This plan | How intent becomes code |
| — | The repository | Reveals what is *actually implemented*, and never loses to a document |

Where the master context and `Project_Creation.md` disagree, the master context wins on **what the product is**; `Project_Creation.md` remains the more detailed source on **how to execute** where it does not contradict. A requirement described in either document is not evidence it exists — check the code.

### 0.0.1 Reconciliation, 2026-08-11

The master context is not a restatement of `Project_Creation.md`. It reframes the product, and five differences change what gets built:

| # | `Project_Creation.md` | Master context | Consequence |
|---|---|---|---|
| R1 | The unit is a **lead**; the loop is Discover → Qualify → Enrich → Personalize → Reach out | The unit is a **qualified opportunity with evidence** (§1); the loop is SIGNAL → CONTEXT → INTENT → OPPORTUNITY (§4) | Vocabulary and IA change throughout. `Leads` became `Opportunities` in the nav; the Command Center leads with the verdict, not with campaign stages. |
| R2 | Scoring is a number with a `breakdown jsonb` | Scoring is **eight named dimensions** (§16, §51), weights explicitly **NOT DEFINED**, and "Claude must not invent arbitrary weights and treat them as official HuntLoop logic" | `ScorePill` now takes named dimensions and renders per-dimension strength. Signed `+18 / −6` factors stay available but must not be shown until a real versioned weighting exists to back them. |
| R3 | No fact/inference distinction | §7 is one of the most important rules in the engine: FACT / INFERENCE / UNKNOWN, never silently promoted | New `ClaimBadge`. Every intelligence claim carries a kind. The token semantics were extended once, deliberately, to make the distinction visible in colour as well as in text. |
| R4 | Signals are a `lead_signals` payload | §52 requires provenance on every important claim: source, URL, observed date, event date, excerpt, claim, confidence, kind | New `EvidenceList`, and the §5 schema below gains an `evidence` table rather than burying provenance in a JSON blob. |
| R5 | Discovery is provider search against an ICP | §10 makes **sources** a user-controlled object — recommended by ICP, then accepted, removed or added by the user — and §17 makes **direct URL analysis** a first-class job that is allowed to answer "no, this is not a good lead" | `sources`, `source_documents` and `source_events` enter the schema; `Sources` and `Analyze a URL` enter the nav. |

Two further requirements are confirmed by the master context and absent from this plan's phasing; they are scheduled in §8 rather than silently dropped: the **lead-specific AI sales agent** with its own persistent conversation per opportunity (§19), and the **organization / user memory hierarchy** (§20, §21, §37).

**Unchanged by the reconciliation:** Supabase (Postgres + Auth + Storage + RLS) as the backend and tenant boundary, Next.js 15 + Tailwind v4 on the frontend, the Supabase-derived design system, Claude for the AI layer, and the durable job runner. The master context lists the stack as UNKNOWN (§74, §87) and instructs the reader to inspect the repository and preserve established conventions — which is exactly what these are.

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
| 4 | `ScorePill` | Circular/rounded pill, background from the score ramp at 15% alpha, text at full color, tabular numerals. Kima's `42` / `52` score column. **Must expose the score's reason on hover/focus** — never show an unexplained number (spec Part 7 §7; master context §51). The hover panel lists the **eight named dimensions** of master context §51 with per-dimension strength; a dimension the evidence does not establish renders `UNKNOWN`, never `0`. Band labels say "opportunity", not "fit" — ICP fit is one dimension of eight, and §78 requires a strong trigger to be unable to drag a poor-fit company upward. |
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

#### Intelligence primitives (added 2026-08-11 — master context)

These four are not chrome. They are the components through which the product's stated rules become enforceable in the UI; a screen that shows an intelligence claim without them has, by construction, violated the master context.

| # | Component | Rule it enforces |
|---|---|---|
| 15 | `PriorityBadge` | §15 — `HOT` / `WARM` / `WATCH` / `IGNORE` as a closed union. Requires a `reason` prop for the same purpose `ScorePill` requires `explanation`: §77 Principle 4 makes the classification a claim, and claims are explainable. Carries a filled → hollow dot so the ranking survives greyscale and red-green deficiency, since the four priority hues alias the existing status colours. |
| 16 | `ClaimBadge` | §7 — `FACT` / `INFERENCE` / `UNKNOWN`, with word-valued confidence (`high`/`medium`/`low`) rather than a fabricated percentage (§16, "do not create fake precision"). |
| 17 | `EvidenceList` | §52 — source, source URL, event date, observed date, excerpt, claim, confidence, kind. Field names match §52 one-for-one so an `evidence` row maps on without a translation layer. An empty list renders "nothing is established" rather than nothing at all (§78). |
| 18 | `Freshness` | §81 — renders signal age and lets it dim. **Presentation only.** Its four bands are not a decay curve; §81 records the real decay logic as UNKNOWN and §51 forbids inventing one and passing it off as Huntloop's model. Takes an explicit `now` so server and client agree. |

Still missing, and required before the company/opportunity page of §47 can be built: `ConversationPanel` (the per-opportunity AI agent of §19), `SourcePicker` (§10 accept / remove / add), and `MemoryEditor` (§20–21).

### 1.5 Accessibility floor (enforced in CI)

- Contrast ≥ 4.5:1 for body text, ≥ 3:1 for UI borders and large text. **Corrected 2026-08-11:** this section originally claimed `#6f6f6f` on `--hl-canvas` was ~4.6:1. Measured against the shipped tokens it is **3.57:1 on canvas and 3.28:1 on surface** — an AA failure, and it was applied to every uppercase label, stat-card label, quota numerator and timestamp on the Command Center. `--hl-text-muted` is now `#949494` (worst case 4.73:1, on `--hl-surface-active`) and `--hl-text-secondary` `#b4b4b4`. Never re-darken these without re-measuring against all five surface tokens; muted still must not carry anything actionable.
- Every interactive element reachable by keyboard with a visible `--hl-focus-ring`.
- **Score and status are never communicated by color alone** — pills carry the number, status dots carry text labels.
- `axe-core` in the Playwright suite; a violation fails the build.

---

## 2. Dashboard information architecture

Kima's `BD Command Center` maps onto Huntloop's loop almost one-to-one. Here's the translation:

```
┌─ TopBar ────────────────────────────────────────────────────────────┐
│ Huntloop · Acme Inc ⌄ · Web3 Infra ICP ⌄ │ ⌘K Search Feedback ? [av]│
├──────────────┬──────────────────────────────────────┬───────────────┤
│              │  Command Center            Aug 11    │  NEEDS YOU    │
│  COMPANY     │  ● Live · 14 sources · scanned 20m   │  ┌──────────┐ │
│   Product    │                                      │  │ 12 replies│ │
│   ICP     AI │  ⚡ 9 new triggers (24h) →            │  │ unread    │ │
│   Sources    │  ✦ 12 awaiting review →              │  └──────────┘ │
│              │  🔍 Analyze a company URL →          │  ┌──────────┐ │
│  HUNT        │                                      │  │ 5 msgs    │ │
│   Command  ● │  ── PRIORITY ──                      │  │ need appr.│ │
│   Opportuni. │  ┌────┐ ┌────┐ ┌────┐ ┌────┐        │  └──────────┘ │
│   Companies  │  │ 12 │ │ 34 │ │ 88 │ │ 46 │        │  ┌──────────┐ │
│   Analyze URL│  │HOT │ │WARM│ │WTCH│ │IGN │        │  │ source    │ │
│   Imports    │  └────┘ └────┘ └────┘ └────┘        │  │ down ⚠    │ │
│              │                                      │  └──────────┘ │
│  ENGAGE      │  ── WHY NOW ──                       │  ┌──────────┐ │
│   Outreach   │  ┌──────────────────────────────┐    │  │ 7 stale   │ │
│   Inbox   ●12│  │ Alphio AI  [HOT]        (91) │    │  │ evidence  │ │
│   Pipeline   │  │ Raised $12M Series A · 3d    │    │  └──────────┘ │
│              │  │ ▸ Evidence (3)               │    │   +5 more →   │
│  TEAM        │  │ Recommended: contact the CTO │    │               │
│   Members    │  └──────────────────────────────┘    │               │
│   Assignments│  ┌ Northwind [WARM] (74) · 10d ─┐    │               │
│              │  └──────────────────────────────┘    │               │
│  LEARN       │                                      │               │
│   Analytics  │  ── LOOP THIS WEEK ──  ── OUTCOMES ──│               │
│   Intel.  AI │  ┌──┐┌──┐┌──┐┌──┐      ┌──┐┌──┐┌──┐ │               │
│   Memory     │  └──┘└──┘└──┘└──┘      └──┘└──┘└──┘ │               │
│              │                                      │               │
│  SETTINGS    │  ── SENDING CAPACITY ──              │               │
│              │  founder@acme.co  38/50  ▓▓▓▓▓░ 76% │               │
│              │                                      │               │
│              │  ┌─ SIGNALS BY TYPE ─┐┌─ SOURCE PERF┐│               │
│              │  │ Funding    31 ▓▓▓ ││ The Block 22││               │
│              │  └───────────────────┘└─────────────┘│               │
└──────────────┴──────────────────────────────────────┴───────────────┘
```

### Adaptations, with reasons

| Source element | Huntloop version | Why the change |
|---|---|---|
| Kima: "Lead Queue Quotas · agent pauses when full" | **Sending Capacity** (per-mailbox daily send limits) | Lead-count quotas are an artificial constraint. Mailbox send limits are a *real* one — exceeding them destroys deliverability, which is the actual failure mode this UI should prevent. Same visual component, load-bearing meaning. |
| Kima: notification rail showing "37d overdue" follow-ups | **Needs You** rail: unread positive replies → messages awaiting approval → **source failures** → **stale evidence** | "37 days overdue" on five separate cards is a UI that has already failed the user. The rail surfaces *what blocks the loop right now*, capped at 5. The last two items come straight from the master context: §58 says a failing source must be marked and retried rather than silently dropped, and §81 says old evidence must stop being treated as current. |
| Kima: "Powered by GPT-4o + Tavily + Hunter.io" in the header | Removed | Naming your vendors in the product chrome is free advertising for them and a switching cost for you. Provider health belongs in Settings → Integrations and the internal admin console. |
| Kima: 8 stat cards, all equal weight | **Priority row first** (§15 HOT/WARM/WATCH/IGNORE), then loop stages, then outcomes | Changed 2026-08-11. The previous cut led with New/Qualified/Approved/Contacted, which is a campaign tool's dashboard. §46 asks this screen to answer *how urgent, how strong, why now, what next* on sight; pipeline stages answer none of those. Activity counts still exist, below the verdict they produce. |
| — | **Why-now section with evidence inline** (§13, §52) | New. This is the product's differentiator and it cannot live behind a click: a why-now claim whose source is one page away is a claim most users will never check, and an unchecked claim is how an inference quietly becomes a fact (§7). |
| Kima: "Discovery runs on manual click only" footer | **Autonomy level indicator** (L0–L5, spec Part 44) with an inline control | Same information, but framed as the product's autonomy ladder rather than a limitation. |

### Route map

```
(marketing)   /  /product  /pricing  /use-cases/[slug]  /compare/[slug]  /blog/*  /docs/*
(auth)        /login  /signup  /forgot  /accept-invite/[token]
(onboarding)  /welcome/{org,product,icp,mailbox,persona,first-campaign}
(app)         /[org]/
                dashboard                      ← Command Center (above)
                sources                        ← §10: recommended by ICP, then accept/remove/add
                opportunities                  ← DataTable + FilterBar + saved views, priority-first
                opportunities/[id]             ← the §47 page: why-now, evidence, gaps, buyers, agent
                companies  companies/[id]      ← §12 company intelligence, independent of any one opportunity
                analyze                        ← §17: paste a URL, get an honest verdict incl. "no"
                imports                        ← §18/§61: upload → map → dedupe → resolve → research
                outreach  outreach/[id]
                inbox  inbox/[threadId]
                pipeline                       ← §26 CRM, intelligence-native
                team  team/assignments         ← §28
                analytics  analytics/{funnel,sources,signals,messages,attribution}
                intelligence                   ← what Huntloop learned, why scores moved
                memory                         ← §20/§21 organization + user memory
                settings/{general,product,icp,members,mailboxes,integrations,billing,usage,api,security,data}
(admin)       /admin/{orgs,providers,jobs,ai-usage,flags,abuse}
```

`leads` and `campaigns` are gone as route names. That is R1 from §0.0.1: the master context's unit is an opportunity, and a route map is where vocabulary either holds or quietly reverts. `discovery` folded into `sources` + `opportunities`, because discovery in the master context is a consequence of monitoring chosen sources rather than a search box.

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

── Sources & evidence (master context §10, §33, §52) ───────────────
sources             org_id, icp_id, kind(news|blog|jobs|social|github|funding|
                    regulatory|community|custom), name, url, is_enabled,
                    recommended_by(system|user), last_scanned_at,
                    status(ok|degraded|unavailable), failure_count
                    ← §10: the user accepts, removes and adds these. §58: a
                      failing source is marked and retried, never fatal.
source_documents    org_id, source_id, url, canonical_url, title, published_at,
                    fetched_at, content_hash, raw_ref
                    UNIQUE(org_id, content_hash)     ← §60 dedup
source_events       org_id, source_document_id, company_id, event_type,
                    event_date, observed_at, description, confidence,
                    fact_or_inference, url
                    ← §33's normalized event. The intelligence engine consumes
                      THIS, not per-platform shapes.
evidence            org_id, subject_type(company|opportunity|contact|claim),
                    subject_id, claim text, kind(fact|inference|unknown),
                    confidence(high|medium|low), source_id, source_url,
                    excerpt, event_date, observed_at, superseded_by
                    ← §52 in full, and the reason §62 rule 4 ("cite evidence")
                      is implementable at all. One row per EvidenceList item.

── Companies & people ──────────────────────────────────────────────
companies           org_id, canonical_domain, name, industry, employee_count,
                    revenue_band, country, region, tech_stack text[],
                    funding jsonb, business_model, last_researched_at,
                    UNIQUE(org_id, canonical_domain)
company_problems    org_id, company_id, problem, severity, evidence_id
company_gaps        org_id, company_id, gap, current_approach, evidence_id
company_triggers    org_id, company_id, trigger_type, event_date, strength,
                    evidence_id
                    ← §12 splits these out because §78 needs them independently
                      addressable: "strong trigger but unclear problem" must be
                      representable, not collapsed into one score.
people              org_id, company_id, first_name, last_name, title, seniority,
                    linkedin_url, is_decision_maker, source
contact_points      org_id, person_id, kind(email|phone|linkedin), value,
                    verification_status, confidence numeric, verified_at, provider
                    UNIQUE(org_id, kind, value)      ← dedup key
enrichment_records  org_id, entity_type, entity_id, provider, field, value,
                    confidence, cost_cents, fetched_at, raw jsonb
                    ← never overwrite higher-confidence data (spec Part 42)

── Opportunities & qualification ───────────────────────────────────
opportunities       org_id, company_id, icp_id, primary_person_id, priority
                    (hot|warm|watch|ignore), priority_reason text,
                    status, stage, owner_id, why_this_company, identified_problem,
                    potential_gap, why_now, outreach_angle, confidence,
                    first_seen_at, UNIQUE(org_id, company_id, icp_id)
                    ← renamed from `leads` (R1). `priority_reason` is NOT NULL:
                      §77 Principle 4 makes the verdict a claim, and
                      PriorityBadge requires the reason at the type level.
scoring_rules       org_id, icp_id, name, expression jsonb, weight, is_active
opportunity_scores  org_id, opportunity_id, model_version, score,
                    icp_fit, problem_severity, evidence_strength,
                    trigger_strength, trigger_freshness, buying_likelihood,
                    product_relevance, decision_maker_accessibility,
                    confidence, explanation text, computed_at
                    ← the eight §51 dimensions as NULLABLE columns, not a
                      jsonb blob. NULL means UNKNOWN and renders as UNKNOWN;
                      0 would assert "measured, and bad" (§78). No `weights`
                      column until a real weighting exists — §51 forbids
                      inventing one and calling it Huntloop's model.

── Campaigns & outreach ────────────────────────────────────────────
mailboxes           org_id, provider(gmail|outlook|smtp), email, display_name,
                    oauth_token_enc, refresh_token_enc, daily_limit, sent_today,
                    health_score, warmup_stage, status
campaigns           org_id, name, icp_id, product_id, status, autonomy_level(0-5),
                    schedule jsonb, sending_config jsonb, started_at
sequences           org_id, campaign_id, name, version
sequence_steps      org_id, sequence_id, position, kind(email|wait|condition),
                    delay_hours, template jsonb, conditions jsonb
enrollments         org_id, campaign_id, opportunity_id, status, current_step,
                    next_action_at,
                    UNIQUE(org_id, campaign_id, opportunity_id) ← no double-enrollment
messages            org_id, enrollment_id, step_id, mailbox_id, direction,
                    subject, body_html, body_text, ai_generated bool, approved_by,
                    scheduled_at, sent_at, provider_message_id, thread_id,
                    evidence_ids uuid[]
                    ← §62 rule 9 / §7.4: a personalized claim names the evidence
                      backing it, or the message goes to human review unsent.
message_events      org_id, message_id, kind(delivered|bounced|opened|clicked|
                    replied|complained|unsubscribed), payload jsonb, occurred_at
threads             org_id, opportunity_id, mailbox_id, subject, last_message_at,
                    status(open|snoozed|won|lost), classification, assignee_id
suppressions        org_id, kind(email|domain), value, reason, source
                    UNIQUE(org_id, kind, value)     ← checked before EVERY send

── AI, memory & learning ───────────────────────────────────────────
conversations       org_id, opportunity_id, user_id, title, last_message_at
                    ← §19: every opportunity has its own persistent agent
                      conversation. UNIQUE(org_id, opportunity_id, user_id).
conversation_msgs   org_id, conversation_id, role, content, ai_run_id,
                    cited_evidence_ids uuid[], created_at
memories            org_id, scope(organization|team|user|account|opportunity),
                    scope_id, kind(durable|conversational), key, content,
                    source(user|derived), confidence, created_by, expires_at
                    ← §37's hierarchy in one table with an explicit scope, so
                      the retrieval query can be permission-filtered in one
                      place. §54: nothing global-scoped is stored here.
ai_runs             org_id, task, model, prompt_version, input_hash,
                    input_tokens, output_tokens, cache_read_tokens, cost_cents,
                    latency_ms, status, error, entity_type, entity_id
ai_decisions        org_id, run_id, decision_type, output jsonb, confidence,
                    human_override jsonb, overridden_by, overridden_at
                    ← the human-override record IS the training signal
outcomes            org_id, opportunity_id, campaign_id, kind(reply|positive|
                    meeting|proposal|won|lost), value_cents, occurred_at
                    ← the join target for the entire learning loop

── Events & jobs ───────────────────────────────────────────────────
events              org_id, user_id, name, properties jsonb, occurred_at
                    ← partition by month from day one; this table grows fastest
job_executions      org_id, job_name, status, attempts, payload jsonb, error,
                    started_at, finished_at
```

### Indexes that are not optional

```sql
create index on opportunities (org_id, priority, first_seen_at desc);
                                                              -- the Command Center's priority row
create index on opportunity_scores (org_id, opportunity_id, computed_at desc);
create index on enrollments (org_id, next_action_at)
  where status = 'active';                                    -- the send scheduler's hot path
create index on message_events (org_id, message_id, kind);
create index on source_events (org_id, company_id, event_date desc);
                                                              -- why-now, newest first (§13)
create index on evidence (org_id, subject_type, subject_id, event_date desc);
create index on sources (org_id, status) where is_enabled;    -- §58 failing-source rail
create index on contact_points (org_id, kind, value);         -- dedup lookups
create index on ai_runs (org_id, task, created_at desc);      -- cost dashboards
create index on events (org_id, name, occurred_at desc);
```

Note that the default opportunity sort is `priority` then recency, **not** `score desc`. That is deliberate: §78 requires a strong trigger to be unable to make a poor-fit company HOT, so the verdict is what the list is ordered by and the score is a detail within it.

### RLS pattern (applied to every tenant table)

```sql
alter table opportunities enable row level security;

create policy tenant_isolation on opportunities
  for all
  using  (org_id in (select org_id from memberships where user_id = auth.uid()))
  with check (org_id in (select org_id from memberships where user_id = auth.uid()));
```

Write-heavy tables additionally get a role check via a `has_org_role(org_id, min_role)` SQL function so `viewer` cannot mutate.

---

## 6. Background jobs

| Job | Trigger | Concurrency | Retry | Idempotency key |
|---|---|---|---|---|
| `source.scan` | schedule per source | 2 per org | 3× exp, then mark `unavailable` | `(source_id, window)` |
| `signal.extract` | after scan | 10 global | 3× | `(source_document_id, prompt_version)` |
| `company.resolve` | after extract | 5 global | 3× | `(org_id, canonical_domain)` |
| `enrich.company` | after resolve | 10 per org, provider rate-limited | 5× exp + provider fallback | `(company_id, provider, field)` |
| `verify.email` | after enrich | 20 global | 3× | `(contact_point_id)` |
| `ai.research` | after enrich | 5 per org | 2× | `(company_id, prompt_version)` |
| `ai.qualify` | after research | 5 per org | 2× | `(company_id, icp_version, prompt_version)` |
| `ai.score` | after qualify | 5 per org | 2× | `(opportunity_id, model_version)` |
| `opportunity.rescore` | on new signal, nightly | 5 per org | 2× | `(opportunity_id, date)` |
| `ai.personalize` | on enrollment | 5 per org | 2× | `(enrollment_id, step_id, prompt_version)` |
| `send.step` | scheduler, 1-min tick | **1 per mailbox** | 3× then park | `(enrollment_id, step_id)` |
| `inbox.sync` | 5-min poll + webhook | 1 per mailbox | 5× | `(mailbox_id, history_id)` |
| `ai.classify_reply` | on inbound message | 10 global | 2× | `(message_id, prompt_version)` |
| `analytics.rollup` | hourly | 1 per org | 3× | `(org_id, period)` |
| `learning.recompute` | nightly | 1 per org | 2× | `(org_id, date)` |

`discovery.run` and `lead.dedupe` are gone. Discovery is now the tail of `source.scan → signal.extract → company.resolve`, which is R5: the master context's §11 hunt engine monitors sources the *user* chose rather than running an opaque search, and §59 makes entity resolution a named step rather than a dedupe afterthought.

**Non-negotiable invariants:**
1. `send.step` is serialized per mailbox and checks, in order: suppression list → mailbox daily cap → schedule window (recipient timezone) → reply-detected-on-thread. Any failure parks the enrollment rather than retrying blindly.
2. Every AI job writes an `ai_runs` row **before** calling the model, so a crashed job still shows up in cost accounting.
3. Every job handler takes `(payload, ctx)` where `ctx` carries `org_id` and a tenant-scoped DB client. No handler may construct its own admin client.
4. Per-org fairness: cap concurrent jobs per org so one tenant's 50k-company import can't starve everyone else.
5. **A failing source never fails the hunt** (§58). `source.scan` marks the source `unavailable`, increments `failure_count`, surfaces it in the Needs You rail, and lets every other source complete. A hunt that returns partial results says so.
6. **Nothing writes a `fact` it did not observe** (§7). `signal.extract` and `ai.research` must emit `kind` on every claim, and a claim with `kind = 'fact'` and no `source_url` fails validation rather than being stored.
7. **`opportunity.rescore` re-runs on new evidence, not only on a timer** (§49). "This account wasn't interesting last month, something changed" is only true if a new signal actually moves the score.

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
| `extract_signals` | `claude-haiku-4-5` | — | Deterministic extraction from fetched pages into §33's normalized event shape. |
| `research_company` | `claude-opus-5` | `medium` | Multi-source synthesis with web fetch; quality here propagates into every message. |
| `qualify_opportunity` | `claude-opus-5` | `high` | This decides where money goes — and it must be willing to return IGNORE (§17). Correctness > cost. |
| `explain_why_now` | `claude-opus-5` | `medium` | The product's differentiator (§13). Must cite the evidence rows behind the claim or return "no reason to contact today". |
| `personalize_message` | `claude-opus-5` | `medium` | The customer-visible artifact. A bad opener burns the prospect permanently. |
| `sales_agent` | `claude-opus-5` | `medium` | §19's per-opportunity conversation. Long shared context, heavy cache reuse, and the §62 safety rules apply in full. |
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
- **Hallucination:** personalization prompts must cite the `evidence` row ID backing each claim (`messages.evidence_ids`); a message referencing an unverifiable fact fails validation and is routed to human review rather than sent.
- **Fact vs inference (§7, and the hardest of these to enforce):** every task that produces a claim emits `kind` alongside it. A `fact` without a `source_url` is rejected at the validation boundary, not softened. `unknown` is a valid, expected output — the evals below must include cases where the correct answer is "we don't know", or the model learns from the eval set that confident guessing scores better.
- **Evals:** golden sets of 50 companies per task in `packages/ai/evals`, run in CI on any prompt change. A prompt is a versioned artifact; `ai_runs.prompt_version` makes regressions attributable. `qualify_opportunity`'s golden set must contain poor-fit companies whose expected verdict is `IGNORE` (§17: Huntloop has to be willing to answer "no").

---

## 8. Build phases

### Phase 0 — Foundation (~1.5 weeks)

Monorepo, CI, Supabase project, Drizzle schema for identity/billing, **RLS policies + the cross-tenant Playwright test**, auth (email + Google OAuth, matching your existing setup), org creation, invites, RBAC, `packages/ui` tokens + components 1–6, app shell (Sidebar + TopBar + all Part 25 states), Sentry + structured logging, Stripe products/webhooks (no metering yet).

**Done when:** two orgs exist, org A provably cannot read org B's data through any route, the shell renders at all breakpoints, and `axe-core` passes.

> **Resequenced 2026-08-11.** The previous Phase 1 shipped campaign sending with *no AI generation involved* and deferred research and qualification to Phase 2. Master context §68 stages the product the other way round — intelligence core first, execution third — and §76 lists "build everything simultaneously without validating the intelligence core" under DO NOT. Under §0.0's precedence the master context governs product intent, so the phases below follow §68.
>
> This does **not** retract the concern in §0. That concern was about the *learning* loop needing outcome volume, and §68 agrees — learning is its Phase 5. The narrower disagreement was about whether *sending* or *intelligence* comes first, and on that the master context is unambiguous: the thing to prove first is "HuntLoop can identify better opportunities than ordinary lead databases" (§68 Phase 1 goal). A campaign tool that sends templates does not test that claim at all.

### Phase 1 — Intelligence core (~5–6 weeks)

The §68 pipeline end to end: company URL → company understanding → ICP builder with user review and edit (§9) → source recommendation and the accept/remove/add UI (§10) → `source.scan` on a small set of source kinds → `signal.extract` into §33's normalized event → `company.resolve` (§59) → `ai.research` → pain/gap/trigger detection → `qualify_opportunity` → the eight-dimension score with its explanation → `explain_why_now` → buyer identification. Then the two screens that display it: the opportunity list ordered by priority, and the §47 company/opportunity page. Plus direct URL analysis (§17) and CSV import (§18), which both re-enter the same pipeline.

**Done when:** a new signup enters their website, reviews a generated ICP, accepts a source set, and within one scan cycle sees opportunities they judge better than what their current lead database returns — with every HOT verdict traceable to cited evidence, and at least one company the system was willing to mark IGNORE.

**Not in Phase 1:** any sending. Enrichment is limited to what buyer identification needs.

### Phase 2 — AI sales workspace (~4 weeks)

Per-opportunity AI conversation (§19) with the §62 safety rules enforced, `conversations` + `conversation_msgs`, organization and user memory (§20, §21, §37) with permission-aware retrieval, contact enrichment behind `ProviderRegistry`, activity timeline, CRM pipeline (§26), AI cost dashboard, per-org budgets, prompt eval suite in CI.

**Done when:** a salesperson can ask "why do you think this?" on any claim and get an evidence-cited answer, and the agent visibly declines to assert things the evidence does not support.

### Phase 3 — Execution (~4 weeks)

Gmail + Outlook OAuth mailbox connection, message generation grounded in `evidence_ids`, human approval gates, send scheduler with all four invariants, sequences and follow-ups, inbox sync + unified inbox, `classify_reply` driving thread status, autonomy levels 0–3, message-approval queue in the Needs You rail, usage metering + plan limits.

**Done when:** a message drafted from cited evidence is approved and sent, the reply lands in the unified inbox, and cost per contacted opportunity is measured and visible.

### Phase 4 — Team operating system (~3 weeks)

Roles beyond owner/admin/member (§39), opportunity assignment and reassignment, junior-BD views, manager dashboards, team performance analytics (§29), AI coaching.

### Phase 5 — Learning (~4 weeks)

`outcomes` capture, nightly feature aggregation, statistical (not ML) correlation of opportunity/signal/message attributes to outcomes with confidence intervals, Intelligence Center UI, ICP recommendations, message A/B experiments with proper sample-size gating, score model versioning + drift detection, and the §54 boundary between global and per-tenant learning enforced in the aggregation query itself.

**Done when:** the Intelligence Center shows at least three statistically supported findings per active org and score changes are explainable to the user.

**Guard:** do not ship a "learning" claim in the UI until an org has ≥200 outcomes. Below that, show sample-size warnings instead of conclusions. Shipping noise as insight is how this feature loses trust permanently.

### Phase 6 — Scale (deferred)

SSO/SAML, advanced RBAC, warehouse + ClickHouse for analytics, CRM bidirectional sync, public API + webhooks, agency multi-client workspaces.

---

## 9. Cross-cutting requirements

**Definition of done for every feature** (spec Part 71 — enforced by PR template checklist): UI + API + schema + validation + authorization + error/loading/empty states + retry + analytics events + tests + observability + docs + security review + performance consideration + edge cases.

**Performance targets:** dashboard TTFB < 500ms · opportunity table (10k rows, filtered) < 800ms · opportunity detail < 400ms · inbox thread < 300ms. Cursor pagination everywhere; no `OFFSET` on opportunities.

**Observability:** structured logs with `org_id` + `request_id` on every line · OpenTelemetry traces spanning route → job → provider → model call · alerts on queue depth, provider error rate, AI cost spike (>2× 7-day median), mailbox bounce rate >3%, and **any cross-tenant access attempt** (paged immediately).

**Compliance:** suppression list checked before every send · one-click unsubscribe (RFC 8058) in every email · GDPR data export + deletion within 30 days · DPA and subprocessor list published before first paying EU customer · CAN-SPAM physical address in footer. *Not legal advice — get a lawyer to review the outbound compliance posture before EU launch.*

---

## 10. Risk register (top 8)

| Risk | P | Impact | Mitigation |
|---|---|---|---|
| **The intelligence isn't actually better than a lead database** | High | Critical | This is now the Phase 1 bet rather than a Phase 2 addition. Fail it early and cheaply against real ICPs; §68's Phase 1 goal is the pass/fail criterion. |
| **Inference silently rendered as fact** | Medium | Critical | §7 is the product's credibility. `kind` on every claim, `fact` without `source_url` rejected at validation, `ClaimBadge` on every surfaced claim, and eval cases whose correct answer is UNKNOWN. One confident fabrication in front of a prospect costs more than a hundred missed opportunities. |
| Deliverability collapse from a careless customer | High | Critical | Per-mailbox caps, warmup gating, bounce-rate circuit breaker that auto-pauses campaigns >3%, no shared sending domain |
| Enrichment cost exceeds revenue per account | High | High | Cache-first waterfall, per-org enrichment budget, price on *contacted* opportunities |
| Learning loop never gets enough data | High | High | §0 sequencing — Phases 1–3 are valuable without it; Phase 5 gated on ≥200 outcomes |
| Cross-tenant data leak | Low | Critical | RLS + import-restricted admin client + isolation test in CI + paging alert |
| **Memory leaking across the §37 hierarchy** | Low | Critical | `memories.scope` filtered in one retrieval module, not per call site; a user-scoped memory must never reach another user's agent context, and §54 forbids private data reaching global learning. Same isolation test treatment as leads. |
| Enrichment provider outage or shutdown | Medium | High | Provider abstraction from Phase 2 with a second provider added later |
| AI cost spike from a runaway loop | Medium | High | Per-org token budgets enforced pre-call, max job iterations, cost-spike alert |

---

## 11. Where the build actually is (2026-08-11)

Audited against the repository, not against this document.

**Built — design system.** `packages/ui`: tokens, Tailwind theme mapping, components 1–11, the four intelligence primitives 15–18, `HoverPanel`, and the five Part 25 states (#14).

**Built — schema.** `packages/db/migrations` 0001–0004: identity/billing/audit, ICP + sources + evidence, companies + opportunities + the eight score dimensions, outreach + per-opportunity conversations + memory + outcomes. Every tenant table carries `org_id`, RLS, and a `has_org_role` write check.

`npm test` runs the migrations against a real Postgres (PGlite, in-process — no server, no Docker) and asserts **31 checks**, including:

- a `fact` without a `source_url` is rejected, and an `unknown` carrying a confidence is rejected (§7);
- an opportunity without `priority_reason` and a score without `explanation` are rejected (§51, §77);
- a NULL dimension survives the round trip as NULL rather than 0 (§78);
- a user-scoped memory with no `scope_id` is rejected (§37);
- **cross-tenant isolation**, exercised as a non-superuser `authenticated` role so RLS actually applies — org A sees only org A, and cannot insert into org B;
- a viewer can read and cannot write;
- structurally, that *every* table with an `org_id` has RLS enabled and at least one policy — so a table added later cannot silently join the schema unprotected.

This is the D2 isolation test, and it runs today rather than waiting for a hosted project.

**Built — clients.** `createTenantClient` (RLS-respecting, session-carrying) and `createClientSideClient`. The service-role client is isolated in `packages/db/src/admin.ts`, reachable only via the `@huntloop/db/admin` subpath, and `npm run check:admin-imports` fails the build if anything under `apps/` imports it. D2 specifies an ESLint rule for this; ESLint is not configured yet and the risk is rated Critical, so the dependency-free check ships now and both should be kept later.

**Built — screens** (all against fixtures): the Command Center, the opportunity list with priority filters, the §47 opportunity detail page, and source management with the §58 failure state.

**Built — the AI layer (2026-08-12).** `packages/ai`: the `LLMTask` interface and `runTask`, the §7.1 routing table with per-model capability gating, content-hashed prompt versions, cost attribution that prices cache reads at 0.1×, the §7.4 untrusted-content wrapper, the §7 claim validator, and the first real task — `research_company`, which reads a company's website through Anthropic's `web_fetch` (restricted to that company's own domain) and returns §8's five fields as FACT / INFERENCE / UNKNOWN.

`npm test --workspace @huntloop/ai` asserts **52 checks** against a scripted model client — no key, no network, no spend — including that a fact without a source fails the whole run, that an `unknown` carrying a confidence is rejected, that a half-answered run fails rather than being padded out with synthesised unknowns, that the `ai_runs` row is written *before* the call, and that a failed or refused call still lands in cost accounting.

`/welcome/product` calls it. With no key it shows a labelled worked example; a failure returns to the input step rather than substituting that example for a real answer.

**Written but never executed.** The Anthropic request shape in `packages/ai/src/client.ts` typechecks against the SDK's generated types but has never been sent — `ANTHROPIC_API_KEY` is empty. Streaming, `output_config.format`, `web_fetch`, server-side refusal fallbacks and `pause_turn` resumption are all correct as written and unproven in practice. Treat the first real call as a test.

**Not built — nothing below exists in any form:** `packages/core`, `providers`, `jobs`, `analytics`, `config`; `apps/workers`; the marketing and admin route groups; `imports`, `outreach`, `inbox`, `pipeline`, `team`, `analytics`, `intelligence`, `memory`, `settings`; any browser test.

**No page reads the database.** Every screen renders fixtures. The migrations are verified against PGlite, not against the hosted project. Treat the stack table in the README as *decided and schema-verified*, not as *connected*.

### Next steps

1. **Apply the migrations to the hosted Supabase project** and re-run the isolation test against it. PGlite proves the SQL is correct; it does not prove this project is configured correctly.
2. **Add `ANTHROPIC_API_KEY`** and run `research_company` against a real site. This is the first live model call in the codebase; expect to fix the request shape rather than to be lucky.
3. **Persist** the product, ICP and source choices, which unblocks the rest of B1 and gives `qualify_opportunity` an ICP to judge against.
4. **Then the rest of the §68 pipeline**: source recommendation → `source.scan` → `signal.extract` → `company.resolve` → `ai.research` → `qualify_opportunity`. `packages/jobs` becomes necessary at `source.scan`, because a scan cycle cannot run inside a request the way one onboarding call can.
