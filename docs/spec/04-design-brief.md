---
description: Design Brief / Design System — reproducible visual and interaction rules for Huntloop, taken from the implemented tokens and components.
---

# 4 · Design Brief / Design System

> **As of 2026-10-08; components and brand placements updated 2026-10-09** against the design reference
> boards (§15). Source of truth for values: `packages/ui/src/tokens.css` (769 lines) and
> `theme.css` (Tailwind mapping). Components: `packages/ui/src/components/` (29). Live gallery:
> `/kitchen-sink` (development only; 404 in production).
> Companions: [PRD](01-product-requirements.md) · [TRD](02-technical-requirements.md) ·
> [App Flow](03-app-flow.md) · [Schema](05-backend-database-schema.md) ·
> [Plan](06-implementation-plan.md) · [Gap Report](07-specification-gap-report.md).
>
> **Reading rule.** Every value below is what the implementation uses. Where the repository's own
> documents describe a *different* look, that is logged as a contradiction (CON-07), and **the
> tokens file wins**. No new colours are invented here; this brief records.

---

## 1 · Brand identity

| Item | Implementation |
|---|---|
| Name | **Huntloop** (domain in production: `seefluence.com` — see DEC-14) |
| Mark | A stroked **spiral loop with a centre dot**, 32×32 viewBox, round caps; geometry in `packages/ui/src/brand.ts` (`BRAND_MARK_PATH`, stroke 3.4, dot r 2.8), rendered by `BrandMark` and by the edge image routes (`opengraph-image`, `apple-icon`). Designed by Chandra Mani Sharma. Favicon `app/icon.svg`. |
| Meaning of the mark | A loop (Discover → … → Learn) closing on a target (the opportunity). |
| Voice | Plain, specific, non-hyped. UI copy states *why* something is unavailable ("There is no checkout yet.", "Nothing is running the queue") rather than hiding it. Refusals are results. (Convention observed in COMMAND.md copy; not machine-enforced.) |
| Fonts | **Geist** (sans, display) and **Geist Mono**, via `next/font/google` (`--hl-font-sans`, `--hl-font-mono`; fallback `ui-sans-serif, system-ui, -apple-system, "Segoe UI"`). |

## 2 · Design principles (with their concrete meaning)

| Principle (as used in code comments) | What it means in this implementation |
|---|---|
| **"Meridian"** — the visual direction | Pure-white paper in light, one electric blue accent, hairline dividers, **thin** score rings, a very large tightly-tracked headline per marketing section dropping straight to 13–14 px body. Not skeuomorphic; almost no shadow in-app (faint `shadow-card` in light; `none` in dark). |
| **One accent** | Blue — and only blue — marks "act on this": primary button, active-nav accents, links, focus ring, counts, quota fills. Greys carry everything else. |
| **Epistemic colour** | blue = act / model output (`--hl-ai*` is a blue tint) · **green = confirmed** (success, source-verified FACT) · **grey = UNKNOWN** · priority has its own ranked scale. Colour is never the only carrier: priority ships with a word and a dot; counts state their number. |
| **Contrast over pixel-exactness** | Any design colour failing WCAG AA *as text* keeps its value for decoration (icons, rings, borders) while text steps up the same ramp (e.g. muted `#62656d`, not the comp's lighter grey). `#2F6BFF` fails under white text (4.49:1), so **fills use `#1F58F0`** (5.65:1) and `#2F6BFF` is graphics-only. Never loosen `e2e/a11y.spec.ts` instead. |
| **Honesty of state** | Demo, unconfigured and worked-example states are always labelled (banner, `DemoFigures`, "worked example"). Unknown renders as UNKNOWN, never 0. |
| **Reorder, never remove** | Personalisation changes order/lead, not availability. |
| **A control either acts or says why it can't** | `pending="reason"` → `aria-disabled` + `title`. |
| **Restraint with confirmation** | Destructive = two-step ConfirmButton (4 s), except where Undo exists. |

What the vague words mean here: **"clean"** = ≤ 1 hue per screen, 1 px hairline borders, 16/24 px radii, no gradients; **"premium"** = large tight display type + generous section spacing on marketing, never decorative chrome in-app; **"modern"** = system-adaptive theme, native `<dialog>`, `text-wrap: balance`, tabular numerals. Do not use these words as requirements — use the rules in this document.

## 3 · Colour system

Defined as CSS custom properties `--hl-*` under `:root`, `[data-theme="dark"]`, `[data-theme="light"]`;
mapped to Tailwind utilities (`bg-canvas`, `text-fg-muted`, `border-line-subtle`, `bg-brand`, …) in
`theme.css`. Theme chosen by cookie `hl-theme` (`system | light | dark`), resolved server-side to
`data-theme` for a flash-free first paint, and by a tiny bootstrap script for `system`.
`color-scheme: light dark` is the pre-resolution default.

### 3.1 Surfaces, text, borders

| Role | Utility | Light | Dark |
|---|---|---|---|
| Page canvas | `bg-canvas` | `#F7F8FA` | `#111111` |
| Panel / chrome (sidebar base) | `bg-panel` | `#FFFFFF` | `#151515` |
| Card / paper | `bg-surface` | `#FFFFFF` | `#20201F` |
| Surface hover | `bg-surface-hover` | `#F4F6FA` | `#262625` |
| Surface active / pressed | `bg-surface-active` | `#EDF1F4` | `#2B2B29` |
| Input field | `bg-field` | `#F4F6FA` | `#181818` |
| Overlay scrim | `bg-overlay` | `rgba(10,11,12,.45)` | `rgba(0,0,0,.62)` |
| Sidebar column | `bg-sidebar` | `#F2F5F9` | `#151515` |
| Top bar | `bg-toolbar` | `#F7F8FA` | `#151515` |
| Top bar well (search field) | `bg-toolbar-well` | `#EDF1F4` | `#20201F` |
| Hairline (cards, bars) | `border-line-subtle` | `#E9EDF0` | `#232322` |
| Control border | `border-line` | `#DFE4F2` | `#2E2E2C` |
| Strong border / chevrons | `border-line-strong` | `#838587` | `#5A5A57` |
| Text | `text-fg` | `#0D1422` | `#ECECEA` |
| Secondary text | `text-fg-secondary` | `#525969` | `#B4B4B0` |
| Muted text | `text-fg-muted` | `#62656D` | `#939390` |
| Faint (decoration only) | `text-fg-faint` | `#838587` | `#6F6F6C` |
| Inverse text | `text-fg-inverse` | `#FFFFFF` | `#111111` |

### 3.2 Accent and semantic

| Role | Light | Dark |
|---|---|---|
| **Brand fill** (`bg-brand`, white ink) | `#1F58F0` | `#3F63BD` |
| Brand hover / active | `color-mix(brand 86% / 76%, #0A0B0C)` | `color-mix(brand 86% / 76%, #111)` |
| Brand vivid (graphics, focus ring, score dot) | `#2F6BFF` | `#8AA5DC` |
| Brand tint surface / border / text | `#E7EEFC` / `#C6D7FB` / `#1D4FC0` | `rgba(125,151,204,.16)` / `.32` / `#AEC2EA` |
| AI (model output) surface / text | `#E3EBFF` / `#123999` | `rgba(125,151,204,.16)` / `#AEC2EA` |
| Success (fill / surface / border / text) | `#2E9E67` / `#E5F4ED` / `#B0E0C6` / `#0A6743` | `#5BBF8E` / `#1F2B24` / `#2F5140` / (= fill) |
| Warning | `#C08A2A` / `#F4ECDA` / `#F0D3A0` / `#8F4801` | `#E0A44A` / `#2A2217` / `#5C4520` / (= fill) |
| Danger | `#C22F36` / `#FDEAEA` / `#F5C2C1` / `#AE1B22` | `#EC7A7A` / `#2C1C1C` / `#5C2D2D` / (= fill) |
| Info | `#1A63BD` / `#E8F0FC` / `#C2D9F7` / `#0E57B1` | `#8AA5DC` / `#1F2533` / `#34425F` / (= fill) |
| Violet (icon tiles) | `#EEE8FC` / `#451AAF` | `rgba(176,154,224,.14)` / `#C3B3EA` |
| Neutral tile | `#ECECEC` / `#3B3D4A` | `#2B2B29` / `#B4B4B0` |
| Nav hover (also `--hl-hover`, toolbar hover) | `#E6EEFA` | `rgba(125,151,204,.13)` |
| Nav active | `#DCE6FA` (≠ hover on purpose) | `rgba(125,151,204,.22)` |
| Inverted band (marketing, theme-invariant) | `#111111` text `#ECECEA` / `#B4B4B0` / `#939390`, brand `#AEC2EA`, border `#2E2E2C` | same |
| Attention (counts, quota fill) | `= brand` | `= brand` |
| Mark dot | `#2F6BFF` | `#6E9BFF` |

*Blue split rule:* fills/text-on-fill use `--hl-brand`; anything graphic uses `--hl-brand-vivid`.
*Dark is warm-neutral grey (a "Claude-like" ladder), not Meridian true black:* ladder
`#111 → #151515 → #20201F → #262625/#2B2B29`. (The tokens-file header said "true-black `#08090A`"
until 2026-10-09; corrected.)

### 3.3 Priority and score scales

| Priority | Uses | Treatment |
|---|---|---|
| HOT | word `--hl-danger-text`, dot `--hl-danger`, danger surface/border | pill "Hot" |
| WARM | word `--hl-warning-text`, dot `--hl-warning` | pill "Warm" |
| WATCH | word `--hl-info-text`, dot `--hl-info` | pill "Watch" |
| IGNORE | word `--hl-text-muted`, dot `--hl-text-faint`, on `surface-hover` | pill "Ignore" |

Pill: radius full, 12 px / 600 (`sm` 11 px, 20 px high), 6 px filled dot, sentence case (board 02).

Score ramp (`ScorePill`): 0–39 danger · 40–69 warning · 70–89 success · 90+ `#0B6B50` (light) /
`#4FC4A8` (dark); pill = band ink on band tint, no outline. **ScoreRing** is a thin circle (40-unit
viewBox, r 16, stroke 3; sizes 34/38 px) on a hairline track: **green ≥ 75, amber below**
(`SCORE_RING_THRESHOLD = 75`). An unmeasured score is a dashed **UNKNOWN** pill or a dashed ring
with "?" — never 0; an unmeasured dimension is shown as **UNKNOWN**, not as a band.

### 3.4 Charts
`--hl-chart-1…6`: light `#447AFE #33B2A5 #DCA847 #C22F36 #7C3AED #8A8D94`; dark `#8AA5DC #5FB8AA #E0A44A #EC7A7A #B09AE0 #939390`. Charts in-product are simple stat cards / bars / tables; there is no charting library.

## 4 · Typography

| Token / class | Size / line | Weight | Tracking | Use |
|---|---|---|---|---|
| `.hl-hero` | 62/64 (36/39 ≤ 640 px) | 600 | −0.04em | Landing hero only |
| `.hl-display` | 42/45 (30 ≤ 640 px) | 600 | −0.035em | Marketing section openers |
| `.hl-heading` | 40/46 | 700 | −0.035em | In-app page titles |
| `.hl-title` | 26/32 | 600 | −0.02em | Focused flows (auth, onboarding, picker, invite) |
| H1 `--hl-text-h1` | 20/28 | 600 | | Card/section headings |
| H2 `--hl-text-h2` | 16/24 | 600 | | Sub-headings |
| Body | **14/20** | 400 | −0.011em | The workhorse |
| Body-sm | 13/18 | 400 | | Dense tables, controls |
| Caption | 12/16 | 400 | | Hints, errors, meta |
| Label / eyebrow `.hl-label` | 11.5/16 (field labels 11/16) | 600, UPPERCASE | +0.14em | Form labels, section eyebrows |
| Metric | 32/36 | 600 tabular | | Stat cards |
| Metric-sm | 20/24 | 600 tabular | | Compact stats |

Rules: `text-wrap: balance` on all display tiers; `.hl-tabular` (tabular-nums) for every number
column and count; `.hl-prose` for legal/long copy; mono for codes, shortcuts (`<kbd>` 11 px), ids.
`SectionLabel` default = 19 px heading; `variant="eyebrow"` for the caps style.

## 5 · Spacing, grid, radius, shadow, motion

| System | Values |
|---|---|
| Spacing scale | `--hl-space-1…16` = 4, 8, 12, 16, 20, 24, 32, 40, 48, 64 px (Tailwind spacing is used directly) |
| Control heights | `--hl-control-height` 32 · sm 28 · lg 40; buttons: sm 28 / md 32 / lg 42 / xl 46; **inputs & selects 40 px**; row height 44; nav row 32 |
| Radius | xs 4 · sm 6 · **md 10** (buttons, inputs) · **lg 16** (cards, panels) · **xl 24** (modals, drawers, mocks) · full (chips, dots). Large buttons use 12. |
| Shadows | `shadow-raised` (buttons): `0 1px 2px rgba(13,20,34,.05), 0 2px 6px -2px rgba(13,20,34,.08)` light, `0 1px 2px rgba(0,0,0,.35)` dark · `shadow-card`: faint wide light, **none** in dark · `shadow-popover`, `shadow-modal` (larger; dark uses heavier black) |
| Containers | App `<main id="main">` is the only scroller; page content is fluid within the shell; Modal widths sm 400 / md 520 / lg 720 px; reach-bar and form measures are narrow (420–600 px) on focused flows |
| Shell geometry | Top bar **64 px** high; sidebar **rail 76 px** + **panel 240 px** (panel collapsible, `hl:sidebar-panel`); rail item 68 px wide, radius 12; search field up to 660 px; drawer < `lg` |
| Motion | `--hl-duration-fast` 120 ms (hover/press/focus), base 180, slow 280 (overlays); `--hl-ease-out: cubic-bezier(.16,1,.3,1)`, `--hl-ease-emphasis: cubic-bezier(.32,.72,0,1)`; buttons press 0.5 px; sidebar width 220 ms; quota fill 280 ms. **All durations are 0 under `prefers-reduced-motion`**; loop diagram stroke animation has an explicit reduced-motion end state. |
| Focus | `hl-focusable:focus-visible` → `box-shadow: 0 0 0 2px canvas, 0 0 0 4px brand-vivid`; rows use a 2 px inset outline. Never remove. |

## 6 · Iconography
`lucide-react` (stroke icons; rail icons 16–20 px with 1.6 stroke in the sidebar). Icon-only buttons
must carry an accessible name (`aria-label`/`title`); sidebar uses `title` at every width. Icons
are decorative (`aria-hidden`) beside text.

## 7 · Components

All in `packages/ui`; behaviour contracts are COMMAND.md §1.2.

| Component | Visual rule |
|---|---|
| **Button** | Variants `primary` (brand fill, white ink, `shadow-raised`), `secondary` (surface + `line` border, **no shadow**; hover → `hover` wash + `brand-border`), `ghost` (transparent, `fg` ink; hover nav wash), `danger` (danger tint; hover fills danger with inverse ink), `destructive` (solid danger fill, inverse ink, 600 — the armed ConfirmButton only). Medium = 32 px, 13 px text, radius 10; xl 46 px radius 12. `pending="reason"` → `aria-disabled`, 50% opacity, `title`; the reason may also be written under the control as a `Note tone="quiet"`. Optional leading icon. `href` renders an anchor with identical styling. |
| **Input / Select / Textarea / Field** | 40 px, `bg-field`, 1 px `line`, radius 10, 14 px text, muted placeholder; hover `line-strong`; focus `bg-surface` + focus ring; invalid → `danger-border`; label 11 px caps **600** muted (required `*` in danger); hint 12 px muted; error 12 px `danger-text` `role=alert`. Select uses an SVG chevron token. |
| **Badge** | 7 variants `neutral, brand, ai, success, warning, danger, info`; **pill**, 12 px / 500 (`sm` 11 px), **sentence case** (first letter capitalised, so raw status values read "Active"), optional 6 px dot in the variant's fill; `ai` is borderless tint + word; neutral = `surface-hover` + `line`. |
| **ClaimBadge** | Pill, 10.5 px (`md` 11 px) / 600 / +0.08em, CAPITALS, always the word: FACT = success surface/border/text · INFERENCE = AI tint, borderless · UNKNOWN = `surface-hover` + `line` + secondary text. Optional "· confidence" in regular weight. |
| **PriorityBadge / ScorePill / ScoreRing** | §3.3; hover/focus opens a **HoverPanel** with reason, dimensions, confidence (Esc/blur/outside closes). |
| **Card** | `bg-surface`, 1 px `line-subtle`, radius 16, `shadow-card`, padding 20; header row with title + action. |
| **StatCard** | Eyebrow label (`.hl-label`) with an optional 28 px tone tile at the right; 32/36 px 600 tabular metric; one 12 px line — a hint, and/or the destination as a brand-text link (`linkLabel`, e.g. "Open inbox →") when the card is a link. Padding 18, radius 16. |
| **DataTable** | Optional checkbox column; sortable headers (desc⇄asc); row height 44; `empty` slot; scrolls inside a `ScrollRegion`. |
| **FilterBar** | Scope select + search; selection count and actions replace/extend right side. |
| **EmptyState / ErrorState / RateLimited / Note** | States: radius 16 frame, 44 px tile (brand tint for neutral; danger/warning tints), 16 px / 600 title, 13/18 secondary sentence, actions centred. `Note` (inline, radius 12, 13/18, 16 px icon, `<strong>` lead): `neutral` = white with hairline, secondary ink; `quiet` = `bg-field`, no outline, radius 10 (the "why this can't act" line); `info/success/warning/danger` = tinted. |
| **Modal** | Native `<dialog>`, radius 24, `shadow-modal`, focus-trapped, Esc/backdrop close unless `dismissible=false`, ✕ button; widths 400/520/720. |
| **Menu** | Popover with arrow-key/Home/End; `choices` render as inline radio rows. |
| **Toast** | Provider in root layout; success/info auto-dismiss 5 s, danger persists. **Currently unused by product screens** (REC-08). |
| **ConfirmButton** | Two-step, 4 s, live-region announcement, 48 px hit area while armed. |
| **Confirmed** | Success strip with optional Undo. |
| **EvidenceList** | Claims separated by hairlines (not boxed): kind chip + "Happened {age}" on one line, claim at 14/20 (UNKNOWN claims in secondary ink), excerpt, then the source as a brand-text link with ↗ (new tab, `noopener`) and the observed date. |
| **Freshness** | Age → band label (“Happened 3d ago”). |
| **QuotaBar / SidebarQuota** | Stacked: 12 px label left, "used / limit" tabular right, then a **5 px** bar — fill `brand-vivid`, amber ≥ 80 %, red + "Full" badge at the cap. |
| **BreakdownList** | Rows with bar proportion + count. |
| **ActionRail** | Right-rail list of attention items (counts + links). |
| **JumpTo** | ⌘K/Ctrl K palette: combobox + listbox of nav destinations; wrap-around arrows; no-result copy. |
| **Sidebar / TopBar** | §8. |
| **ThemeToggle** | 3-way segmented (System/Light/Dark). |

## 8 · Layout patterns

### 8.1 Application shell (every `/{org}/*` page)
Top bar (brand + workspace switcher left; Jump-to field centre; Feedback + avatar right) over a
two-level sidebar and `<main>`. Below `lg` the sidebar is a drawer opened by ☰ (scrim, Esc, route
change close it; tapping a rail with a panel previews that section). Active item = longest-prefix
match. Attention dot on a rail icon when a child count is `attention`. Panel footer = plan quota
meter. Print: top bar and sidebar hidden; scroll container flattened.

### 8.2 Page anatomy
`.hl-heading` title (+ lead sentence in `fg-secondary`) → action cluster right-aligned → optional
banners/notes → content cards (16 px radius, 20 px padding, 16–24 px gaps). Lists are DataTables
with a FilterBar above; detail pages use a two-column brief from `xl` (single column below —
at 1024 px the main column was ~240 px). Needs-you rail is first on narrow screens and the right
column ≥ 1440 px.

## 9 · Responsive behaviour

| Breakpoint | Behaviour |
|---|---|
| < 640 px (`sm`) | Display type steps down; ThemeToggle moves into drawer footer; Feedback link hidden; Jump-to icon-only |
| < 768 px (`md`) | Landing nav links hidden (a mobile menu exists); ⌘K hint hidden |
| < 1024 px (`lg`) | Sidebar becomes drawer; panel forced open inside it |
| ≥ 1280 px (`xl`) | Opportunity brief two-column |
| ≥ 1440 px | Dashboard "Needs you" right column |
| Print | Share report light theme only (`data-theme="light"`) |
Tested viewports: Desktop Chrome and **Pixel 7** (Playwright). Tablet (768–1023) is covered only by the generic `lg` rule — no dedicated tablet design (UNCLEAR whether needed).

## 10 · Themes
System / Light / Dark; cookie `hl-theme` (1 year); controls on public pages, `/orgs`, onboarding, auth, and the account menu stay in sync. Light is the default reference; Dark follows §3. Marketing inverted bands are theme-invariant `#111`. The Share report forces light. `data-theme` is not set for `system` on first paint (browser decides via `color-scheme`).

## 11 · Accessibility considerations (design level)
Contrast rules in §2; focus ring everywhere; control height 32 px default (28 px `sm`; armed ConfirmButton 48 px); never colour alone; `aria-current`, `aria-pressed`, `aria-disabled`+title; `role=alert/status`; reduced motion; skip link; native dialogs; keyboard map (⌘K, `?`, arrows, Enter, Esc). Axe runs in both themes in e2e. **Not established:** formal WCAG level, screen-reader pass, forced-colors mode (DEC-12).

## 12 · Screen designs

Each entry: layout → key components → states. Element behaviour: COMMAND.md section in brackets.

| Screen | Design |
|---|---|
| **Landing `/`** [§2.1] | Sticky nav (logo · Product · How it works · Pricing · ThemeToggle · Sign in · **Start free**). Hero: `.hl-hero` headline + sub + primary/secondary CTAs + product mock. Alternating light and inverted `#111` bands: feature strip, "a list is not the answer", animated loop diagram (single arrival, halo), Discover/Qualify/Evidence/Claim-kinds/In-control sections, plan cards (limits from `plans`), closing DomainInput, footer columns (Product, Use cases, Company, Legal-if-complete). |
| **/for, /compare** | Header with NavActions; DomainInput twice; static comparison content; "Also for/compared to" footer links. |
| **/discover** | Result card of findings (facts with source links) + "Continue with a free account"; error variants with ErrorState and a second DomainInput. |
| **Auth** [§3] | Centered `.hl-title` card (~420 px), logo, one email field, one primary button; check-email state replaces form with Resend / Use a different address. |
| **Onboarding** [§4] | Header (logo, ThemeToggle) + progress dots 1–5 + back link + "Finish later"; content on a 420–600 px measure; chip fields with an inference badge and "Because your site says…"; reach bar fixed under the ICP card; building = checklist rows with spinner/✓/⊖/⚠. |
| **Workspace picker `/orgs`** | Cards per workspace (initial tile, name, role badge, "Last used", usage line, Finish setup / Open). |
| **Command Center** [§6] | Header (title, lead, Refresh · Sources · Hunt now · Analyze); alert chips; personalised sections as cards (StatCards for Hot/Warm/Watch/Ignore, why-now list, loop-this-week strip, quota bars, breakdowns); optional LearningNewsCard / QuestionCard / PersonalStartCard; Needs-you rail. |
| **Needs you** [§6.6] | Reached-out-today strip with meter; filter links; four grouped lists of item cards (badge, title, why-sentence, why-now/reach lines, primary button, Log touch, Draft, ⏰ Snooze menu). |
| **Opportunities** [§7.1.1] | FilterBar + priority chips with counts + Product select + Stale toggle; DataTable (company/domain, priority badge, score pill, why-now); selection actions; inline EnrollPanel. |
| **Opportunity detail** [§7.1.2] | Header (name, domain, badges, action buttons); **What next bar** (tone-coloured, with Based-on inputs); two-column brief: evidence → what they use → problems/gaps → strength → people → activity timeline → AgentPanel; exclusive action panels. |
| **Companies / company page** | List with edit/remove inline form; company page with opportunities, history timeline, people on file, funding & leadership. |
| **Analyze** [§7.3] | Single URL field → skeleton → verdict card (priority, ring, summary, recommendation, evidence) → Check timing → Save. |
| **Imports** [§7.4] | Textarea + file chooser; live preview card with recognised columns and first 8 rows; result card. |
| **Outreach** [§8.1] | Summary figures; campaign cards (status/autonomy/enrolled badges, Edit); sequence & StepEditor; mailbox rows with sent-today quota bar. |
| **Inbox** [§8.2] | Summary figures; **approval queue** DraftCards (evidence badge, Edited-by-a-person, actions); thread cards with message badges. |
| **Pipeline** [§8.3] | Horizontal board in its own scroll region; 11 columns with count + value total; cards with priority badge, owner badge, value, last touch, next, sequence progress, stage select. |
| **Performance** [§9.1] | Scope & period controls; insight cards each with basis; funnel stat cards with deltas; breakdown tabs with 95% ranges; cost cards; CSV buttons. **Share report**: print layout, light theme, no chrome. |
| **Ask Huntloop** [§9.5] | ≥ lg: left column (Conversations, What it can see), right conversation; answers with Based-on disclosures, proposed-action buttons, "Not in your records". |
| **Learn / Memory / Demand / Intelligence** | Finding cards with kind badge + inference badge + recommendation + citations + Accept/Decline; memory cards with scope badge; theme cards with status & statements; read-only evidence lists. |
| **Settings** [§10] | Settings layout with eyebrow "Settings"; Cards with labelled fields; ICP editor with chip lists, SearchPreview, personas; Scoring rule cards (Waiting for you / Running) and RuleForm; Settings → You with sections (Waiting / You told us / Learned / Shared / Workspace policy) and "Is it working?" stat cards. |
| **Sources** [§10.5] | Header actions; banners; monitored list with status dot, interval select, pause/remove; Recommended list with Accept/Dismiss. |
| **Team / Ops** [§11] | Member rows with role select; pending invites; role reference; Ops warning, dead-letter list, by-job table, provider health. |
| **Public token pages, 404, 503** | Minimal centered pages; single action each. |

## 13 · Differences between documents and implementation (do not follow the older text)

| Source | Says | Implementation |
|---|---|---|
| `docs/architecture/design-system.md` | green brand, violet = AI, "no shadows", Light = "warm paper" | Blue brand; AI = blue tint (violet only for icon tiles); `shadow-card` exists in light; Light canvas `#F7F8FA` |
| `packages/ui/src/tokens.css` header | "true-black `#08090A` bands" | `#111111` |
| `design/HANDOFF.md` | dark sections `#08090A`; single blue `#2F6BFF` | superseded by the user-specified values recorded in project notes (2026-09-28): bands `#111`, fills `#1F58F0` |
| `IMPLEMENTATION_PLAN.md §1` | original green-on-warm-paper palette | history |
(CON-07.)

## 14 · Open design questions
DEC-12 (accessibility target level; browser matrix; i18n), REC-08 (use or delete Toast), tablet layout,
and MIS-15 (reference boards 05 and 06 not supplied).

## 15 · Design reference boards (October 2026)

The owner supplied a **Product design reference v0.1** (October 2026): a cover and four boards, each
as a PDF and as an HTML export — **00 Cover**, **01 Logo system / usage**, **02 Colour**, **03 Type &
layout**, **04 Components**. The cover's index also lists **05 Product screens** and **06 Flows &
architecture**; those two were **not supplied** (MIS-15), so screens were reviewed against boards
01–04 and §12 of this brief. The HTML exports were read for exact values; the PDFs could not be
rendered in this environment and are assumed to be the same boards.

### 15.1 What already matched (no change)

Every colour on board 02 (light surfaces and text, the dark warm-neutral ladder, brand fill/vivid,
the four semantic families, the score ramp, both chart ramps) is the value in `tokens.css`. Board 03's
type scale, 4 px spacing scale, radius scale, control heights (28 / 32 / 40 input / 46), focus ring,
motion durations and shell geometry (top bar 64, rail 76, panel 240, search ≤ 660, `main` the only
scroller) are implemented as drawn. The mark geometry on the boards is the approved logo; **the
logo was not changed** (`BRAND_MARK_PATH`, stroke 3.4, dot r 2.8).

### 15.2 What was changed to match (2026-10-09)

| Board | Element | Before | Now |
|---|---|---|---|
| 04 | Badge | 18 px rounded rectangle, 10 px / 600, CAPITALS | Pill, 12 px / 500, sentence case, optional dot (§7) |
| 02, 04 | Claim chips | Rectangle with a leading dot; UNKNOWN dashed and transparent | Pill, 600, +0.08em; FACT has its border; UNKNOWN `surface-hover` + solid `line` |
| 02 | Priority | Rectangle, CAPITALS; HOT/WATCH words in the fill colour; IGNORE hollow dot | Pill, sentence case; word in the `-text` leaf, dot in the fill |
| 04 | ScorePill | Outlined; no *unknown* state | Ink on tint, no outline; `score={null}` → dashed UNKNOWN pill; 90+ ink `#0B6B50` |
| 04 | ScoreRing | Tinted track; no unmeasured state | Hairline track; `score={null}` → dashed ring with "?" |
| 04 | StatCard | 48 px icon tile, 36 px bold metric, label under it, "Click to view →" | Eyebrow first, 32 px / 600 metric, 12 px line, named link ("Open inbox →") |
| 04 | QuotaBar | Single row, 4 px bar, brand fill | Stacked, 5 px bar, vivid fill |
| 04 | EvidenceList | Boxed items, 13 px claims, grey underlined source | Hairline list, 14/20 claims, "Happened …", blue source link ↗ |
| 04 | Empty state | 40 px grey tile, 14 px title | 44 px brand-tint tile, 16 px / 600 title, secondary sentence |
| 04 | Notes | Neutral = grey well | Neutral = white + hairline ("Rate limited."); new `quiet` = grey well, no outline |
| 04 | ConfirmButton armed | Danger tint | Solid red (`destructive`), 600 |
| 04 | Field | Label 500; error in fill red | Label 600; error in `danger-text` |
| 03 | Button | Secondary had a shadow; ghost in secondary ink; xl radius 10 | No shadow on secondary; ghost in `fg`; xl radius 12 |
| 03 | Caps labels | 47 hand-rolled labels at 500 | 600, as every caps label on the boards |
| 01 | App icon / favicon | `#0D1422` tile, white loop, `#4F84FF` dot, thicker stroke | Board's dark icon: `#111111`, loop `#ECECEA`, dot `#6E9BFF`, stroke 3.4, dot r 2.8 |
| 01 | OG card | Mark + wordmark on a retired palette (`#08090A`) | Mark only, current dark tokens, pill chips |
| 01 | Product email header | The word "Huntloop" in blue | Mark (`/email-mark.png`) + wordmark; email palette on tokens, radius 16 / 10 |
| 01 | Share report | No brand | Mark + wordmark, light |
| 01 | Invitation page | A letter "H" in a tile standing in for the mark | The lockup |
| 01 | Legal pages | Text link "← Huntloop" | The lockup |
| 01 | Auth, onboarding, `/discover` | Lockup left-aligned | Lockup centred |

### 15.3 Logo placement rule (board 01), as implemented

| Where | Rule | Implementation |
|---|---|---|
| Marketing nav and footer | Mark + wordmark | Landing nav/footer; `/for`, `/compare` headers (`BrandLink`) |
| Auth, onboarding, `/discover`, invitation | Mark + wordmark, centred | `BrandLink` centred |
| App top bar | Mark, then workspace name | `OrgShell` (mark + workspace switcher) |
| Favicon, apple-icon, OG image | Mark only | `app/icon.svg`, `app/apple-icon.tsx`, `app/opengraph-image.tsx` |
| Product email header | Mark + wordmark | `packages/jobs/src/email/templates.ts` + `app/email-mark.png` |
| Share report (print) | Mark + wordmark, light | `performance/report` |
| Unsubscribe page | — | **Deliberately unbranded**: the visitor received a customer's email, not one from Huntloop |

Rules carried by every placement: clearspace ≥ 2 dot-diameters; minimum 16 px (24 px beside the
wordmark); dot `#2F6BFF` on light, `#6E9BFF` on dark, white on brand blue; never redrawn, rotated,
outlined, recoloured, or replaced by text.
