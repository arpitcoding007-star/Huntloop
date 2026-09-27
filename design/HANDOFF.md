# Handoff — Meridian rebuild (homepage + sidebar)

Written at the end of a session that ran out of budget mid-task. Everything
needed to continue is in this file and the three design files beside it.

---

## The task

Rebuild the marketing homepage and the app sidebar to match the design files
in this folder **exactly**.

- `PremiumLanding.dc.html` — the homepage. Match every section, spacing, font
  size and colour.
- `PremiumSidebar.dc.html` — the app sidebar. Light expanded is the default;
  also build the collapsed icon rail and the dark variant.
- `dir-prem.css` — the colour and style values. Turn them into our theme
  variables. **Do not invent new colours.**

Rules from the brief, verbatim:

- Font: Geist and Geist Mono.
- Only one accent colour: blue `#2F6BFF`, for actions and "needs you" counts.
- Dark sections use `#08090A`. Score rings are thin green circles, amber for
  low scores.
- Keep all existing app logic, routes and data exactly as they are. Only
  change the look.
- Use our existing components where they exist. Don't add new libraries.
- Ignore the `support.js` line and the `<x-dc>` tags; those only work in the
  design tool. In `PremiumSidebar.dc.html`, the `{{s.<key>.<prop>}}`
  placeholders are the design tool's active-state bindings — the `<script>`
  at the bottom of that file shows what each resolves to, and it is worth
  reading, because it is the exact spec for the active/inactive row styling.

The user approved the plan below but asked for it to be executed in a fresh
session. **The plan is approved; the four questions at the end are not
answered yet.** Ask them before building, or make the recommended call and
say so.

---

## Where the repository is right now

Branch `main`. Last commit `dd67aff`. There are ~28 modified files in the
working tree, uncommitted — they are the tail of the previous redesign pass
and they are consistent and green (typecheck, lint, 130 unit tests, 44 audit
checks, build, bundle budget, and 256 Playwright tests including axe in both
themes all pass as of this handoff).

**What the previous pass already built**, which the Meridian work builds on
rather than replaces:

- A token layer in `packages/ui/src/tokens.css` with a light and a dark theme
  scoped by `[data-theme]`, mapped onto Tailwind utility names in
  `packages/ui/src/theme.css`. Changing a value there changes the whole
  product; almost nothing in the app hard-codes a colour.
- `.hl-band` — an inverted full-bleed section. Write
  `<section data-theme="dark" class="hl-band">` and every colour token inside
  flips, so a band needs no per-child restyling. Read the note above
  `.hl-band` in `tokens.css` before touching the black sections.
- A sidebar already at 264 / 72 / 30px / radius 8 / 16px-1.6-stroke / 13.5px,
  with a floating panel, rail tooltips, `SidebarQuota`, `SidebarAccount`,
  `SidebarCollapseButton`, and real plan/account data from
  `apps/web/lib/data/chrome.ts`. The geometry is already right; the
  **palette, the header, the search row and the dark variant are not**.
- `Modal`, `Menu`, `Toast`, `Note` components that did not exist before.
- Type tiers `.hl-hero` / `.hl-display` / `.hl-heading` / `.hl-title`.

So this is a re-skin plus a homepage rebuild, not a from-scratch build.

---

## Token mapping — `dir-prem.css` onto our variables

Every row replaces a value that is currently something else. The current
values came from a different reference and are wrong for this brief.

| Meridian | Value | Our token |
|---|---|---|
| `--paper` / `--card` | `#FFFFFF` | `--hl-surface`, `--hl-panel` |
| `--band` | `#F6F6F7` | `--hl-canvas` |
| `--sunk` | `#F0F0F2` | `--hl-field` |
| `--ink` | `#0A0B0C` | `--hl-text` |
| `--ink-2` | `#3B3D42` | `--hl-text-secondary` |
| `--ink-3` | `#6B6E75` | `--hl-text-muted` |
| `--ink-4` | `#9A9DA4` | **new** `--hl-text-faint` |
| `--line` | `#EBEBEE` | `--hl-border-subtle` |
| `--line-2` | `#DEDEE2` | `--hl-border-default` |
| `--blue` | `#2F6BFF` | `--hl-brand` (and `--hl-attention`, which aliases it) |
| `--blue-h` | `#1F58F0` | `--hl-brand-hover` |
| `--blue-soft` | `#EAF0FF` | `--hl-brand-surface`, `--hl-ai-surface` |
| `--black` | `#08090A` | dark `--hl-canvas`, and `--hl-band` |
| `--on-black` | `#F5F5F6` | dark `--hl-text` |
| `--on-black-2` | `#A0A3AA` | dark `--hl-text-secondary` |
| `--black-line` | `#232427` | dark `--hl-border-default` |
| `--pos` / `--pos-track` | `#2E9E67` / `#E4F1EA` | `--hl-success` / `-surface` |
| `--mid` / `--mid-track` | `#C08A2A` / `#F4ECDA` | `--hl-warning` / `-surface` |
| `--fact` / `--inf` / `--unk` | `#2E9E67` / `#2F6BFF` / `#8A8D94` | `ClaimBadge` |
| `--r` / `--r-lg` / `--r-xl` | `10` / `16` / `24px` | `--hl-radius-md` / `-lg` / `-xl` |
| `--sh-sm` / `--sh` / `--sh-lg` | as given | `--hl-shadow-raised` / `-popover` / `-modal` |
| body letter-spacing | `-.011em` | `--hl-tracking-body` |
| `.eyebrow` | 11.5px / 600 / `.14em` / uppercase / `--ink-3` | `.hl-label` |

Values in the dark sidebar that are not in `dir-prem.css` and must be taken
from `PremiumSidebar.dc.html` directly: panel `#08090A`, border `#1C1D20`,
active row `#17181B` with `inset 0 0 0 1px #232427`, field `#111214`, muted
`#6C6F76`, group label `#54575D`, accent-on-dark `#6E9BFF`, AI chip
`rgba(47,107,255,.16)`.

Light sidebar panel is `#FBFBFC` — note it is *not* `--paper`.

---

## Homepage — the thirteen sections, in order

Source of truth is `PremiumLanding.dc.html`. Section-by-section:

1. **Nav** — 68px, sticky, `rgba(255,255,255,.82)` with
   `backdrop-filter: saturate(160%) blur(16px)`, bottom hairline. Logo: 26px
   `--ink` rounded square (r7) holding the loop glyph, then "Huntloop" at
   18px/600/-0.03em. Centre: 3 links at 14.5px `--ink-3`. Right: "Sign in"
   `--ink-2` and a 38px blue pill (r9, 14.5px/500).
2. **Hero** — grid `520px / minmax(0,1fr)`, gap 64, padding `96px 56px 100px`.
   Eyebrow, then 62px/1.04/600/-0.04em headline, 19px/1.55 `--ink-2` sub
   (max 440px), then a 46px blue CTA (r10) and a "See how it works ›" text
   link. Right: the product mock — `--r-xl`, `--sh-lg`, 1px `--line`; 52px
   toolbar with mark + fake search field; body grid `132px / 1fr` with a
   mini-nav and five company rows, each `30px 1fr 44px 96px 20px`, a 38px
   score ring, and a three-line 11px factor label.
3. **Feature strip** — `--band`, top and bottom hairline, three centred cells
   in a 1160px grid with hairlines between, 20px icon + 15px/500 text.
4. **Black — "The list isn't the answer."** — `--black`, padding `100px 56px`,
   grid `440px / 1fr` gap 72. 52px/1.02/-0.035em heading. Right: dark app mock
   at `#101113`, radius `--r-xl --r-xl 0 --r-xl` (note the square
   bottom-left), 52px score ring in `#4BC98A` on `#243027`, an
   Overview/Evidence/Activity tab row, a three-item "Why now?" checklist with
   dates, and a `#6E9BFF` Source link.
5. **The Huntloop** — centred, padding `110px 56px 90px`. Eyebrow, then
   56px/1.06 two-line headline. Below: a 1160px six-column rail, each cell
   left-aligned with a tracked `01`–`06` eyebrow, an 18px/600 label, and an
   absolutely positioned `→` at `right:8px; top:3px` on all but the last.
6. **01 Discover** — top hairline, grid `420px / 1fr` gap 72. Copy left
   (eyebrow with blue `01`, 42px/1.08 heading, 17px body). Right: a `--r-lg`
   card with a header block and a five-row table
   (`30px 1fr 70px 90px`), numeric fit scores coloured `--pos` / `--mid`,
   and a source column.
7. **02 Qualify** — reversed (`1fr / 420px`), on `--band` with hairlines top
   and bottom. Card max-width 540: company header with a 34px ring, four
   factor rows (`24px 1fr 40px`) with the fourth showing an em dash, then a
   dashed `--line-2` box labelled UNKNOWN.
8. **Black — 03 Evidence** — grid `1fr / 300px / 1fr` gap 56. Copy, a 200px
   ring at 87 (`#F5F5F6` on `#1D1E21`, 6px stroke, "87" at 56px and "WHY?"
   at 11px/3-tracked), and a four-row factor list with a right-aligned
   "Unknown" chip.
9. **Fact / Inference / Unknown** — centred eyebrow, then a 1160px bordered
   `--r-lg` box split into three by hairlines. Each cell: a 12px tracked
   uppercase label with a 16px icon in `--fact` / `--inf` / `--unk` (the
   unknown icon uses `stroke-dasharray="3 2.5"`), then three 15px/1.9 lines.
   Closing line at 16px `--ink-3`.
10. **04 You stay in control** — grid `300px / 1fr / 300px` gap 56. Copy left.
    Centre: a 300px square with an absolutely positioned SVG — a dashed
    `--line-2` circle (`stroke-dasharray="2 6"`) plus a blue arc
    `M150 30 a120 120 0 0 1 104 60` — "Huntloop" at 22px in the middle, and
    six eyebrow labels absolutely positioned around it (exact offsets are in
    the file). Right: "Factor breakdown" and "Rules used" lists.
11. **Data + Pricing** — `--band`, top hairline, grid `300px / 1fr` gap 64.
    Left: eyebrow + four hairline-separated rows with 17px icons, then a blue
    text link. Right: 34px/1.1 two-line heading, then three plan cards. The
    middle card has `1.5px solid var(--blue)` and `--sh`; the outer two have
    `1px solid var(--line)`. Prices 38px/600/-0.03em tabular.
12. **Black CTA** — padding `80px 56px`, grid `300px / 1fr` gap 64. Left:
    28px "We're early.", 14.5px body, `#6E9BFF` link. Right: 58px/1/-0.04em
    "See who needs you.", then a 52px input (`#101113`, `--black-line`,
    r11) + blue submit, then a 13px `#6C6F76` note.
13. **Footer** — padding `40px 56px`. Top row: logo lockup and a
    Find → Understand → Prioritize → Act eyebrow nav. Then a top-hairline
    grid `1fr 200px 200px 200px` with the copyright and three link columns.

### Homepage logic that must not change

`apps/web/app/(marketing)/page.tsx` is a Server Component. Preserve all of it:

- `resolveDestination()` and the redirect for signed-in visitors (and the
  deliberate exception that `demo` still sees the page — the comment explains
  why, keep it).
- `listPlans()`. **Pricing renders from the database, not from the mock's
  hard-coded $0 / $99 / $299.** There is a long comment in
  `apps/web/lib/data/plans.ts` about why.
- `publicResearchEnabled()` gating both CTAs, `legalIsComplete()` gating the
  footer's legal links, and the existing `<DomainInput>` component.
- Real hrefs, not the mock's `#discover` / `#loop` / `#pricing` anchors,
  wherever a real route exists.

---

## Sidebar — three states

Geometry is already correct in `packages/ui/src/components/Sidebar.tsx`
(264 / 72 rail, 30px rows, radius 8, 16px icons at 1.6 stroke, 13.5px
labels). What changes:

**Light expanded** — panel `#FBFBFC`, 1px `--line`, radius 16, `--sh`.
- 58px header: a workspace button (26px `--ink` mark, "acme" 14px/600 over
  "Growth plan" 11px `--ink-4`, a 14px up/down chevron) and a 32px icon
  button on the right.
- Search row: full-width 34px button, `#FFFFFF` on `--line`, r9, magnifier +
  "Search or jump to" + a `⌘K` kbd chip in Geist Mono on `--band`.
- Command Center pinned above the groups at 32px with a blue count pill.
- Groups Hunt / Engage / Learn / Company / Team, labels 10.5px eyebrow
  `--ink-4` with `margin: 14px 10px 5px`.
- **Active row**: `background:#FFFFFF`, `box-shadow: 0 0 0 1px var(--line),
  0 1px 2px rgba(10,11,12,.06)`, `color: var(--ink)`, `font-weight:500`, and
  the **icon in `--blue`**. Inactive: transparent, `--ink-2` text,
  `--ink-4` icon. Hover: `rgba(10,11,12,.045)`.
- Counts: blue pill (min-w 20, h 20, r10, 11px/600, white) for "needs you";
  plain 12px `--ink-4` numeral for informational. AI chip: h18, r5,
  `--blue-soft` on `--blue`, 10px/600/.06em.
- Footer: quota card (`#FFFFFF`, `--line`, r10, 4px track on `--sunk` with a
  blue fill and `min-width:5px`), then a Settings row + 32px collapse button,
  then the account row (30px round `--blue-soft` avatar, name 13px/500, email
  11px Geist Mono `--ink-4`, an ellipsis button).

**Rail (72px)** — 40px targets at radius 10, 32px mark at top, search icon
button, 28×1px `--line` dividers between groups, active = white chip with the
same ring, blue dot badge `0 0 0 2px #fff` for attention, a count pill ringed
in `#FBFBFC`, and a dark tooltip (`--ink` bg, white, r8, `--sh`) at
`left:54px`. Settings and avatar pinned to the bottom with `margin-top:auto`.

**Dark** — see the value list in the token section above.

---

## Files to change

**System** — `packages/ui/src/tokens.css`, `packages/ui/src/theme.css`,
`apps/web/app/layout.tsx` (fonts), `apps/web/app/globals.css`

**Components** — `Sidebar.tsx` (palette, header, search, rail, dark),
`Button.tsx`, `Badge.tsx`, `Card.tsx`, `Form.tsx`, `ClaimBadge.tsx`,
`Freshness.tsx`, `StatCard.tsx`, `Note.tsx`, `TopBar.tsx`, `index.ts`, and a
**new `ScoreRing.tsx`** (thin ring, 38 / 52 / 200px, green above the
threshold, amber below; the existing `ScorePill` stays for table cells)

**App** — `apps/web/app/(marketing)/page.tsx` (rebuild),
`apps/web/app/(marketing)/DomainInput.tsx`,
`apps/web/app/(app)/[org]/OrgShell.tsx`

---

## Four open questions — decide these before building

1. **Three Meridian colours fail WCAG AA on text, and the brief says not to
   invent colours.** `--ink-4` `#9A9DA4` is 2.6:1 on white and it carries
   counts, placeholders and "Unknown" labels. `#6C6F76` is 3.9:1 on
   `--black`. `--blue` with white text is 4.50:1 — exactly on the line, so
   any rounding in a future tweak breaks it. `e2e/a11y.spec.ts` runs axe
   against both themes on every push and **will fail**.
   *Recommended*: use the next step up in the same ramp wherever the value
   lands on real text (`--ink-3` in place of `--ink-4`, `--on-black-2` in
   place of `#6C6F76`) and keep the exact values for decoration — borders,
   icons, rings, dividers. No new hex, nothing invented. The alternative is
   to accept the failures and relax the test, which should be the user's
   explicit call.
2. **Score ring threshold.** The mock is green at 78 / 84 / 89 / 92 and amber
   at 72. *Recommended*: break at 75.
3. **The ⌘K search row.** There is no command palette, and `scripts/audit.mjs`
   fails the build on affordances that do nothing (`NAV-02` / `NAV-03`; see
   the `unbuilt` flag in `Sidebar.tsx` and `pending` in `Button.tsx`).
   *Recommended*: build a real jump-to — a client-side filter over the nav
   list already in `OrgShell`, no new library — so the row in the design is
   honest. Otherwise omit the row.
4. **Geist** — `next/font/google` is the only route that adds no dependency.
   Confirm, and remove the now-unused Inter import from
   `apps/web/app/layout.tsx` in the same change.

---

## How to run and verify

```bash
npm run dev --workspace @huntloop/web    # port 3100, needs apps/web/.env.local
node scripts/dev-demo.mjs                # demo data, no Supabase; honours PORT
```

The demo server is the one to use — `/acme/dashboard` is the seeded workspace
and every screen has a demo branch. Sign-in is not needed.

Full gate, all of which passed at handoff and must pass again:

```bash
npm run typecheck && npm run lint && npm test && npm run audit:site && npm run build && npm run audit:bundle
npx playwright test
```

`e2e/a11y.spec.ts` is the one that will catch the colour problem in question 1.

To compare against the design: open `design/PremiumLanding.dc.html` and
`design/PremiumSidebar.dc.html` directly in a browser next to the running app
at 1440px. They render standalone — `support.js` is missing and the `<x-dc>`
tags are inert, which is fine; only the sidebar's `{{...}}` bindings will show
as literal text.
