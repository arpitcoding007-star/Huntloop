# Frontend & UX audit

**Scope note:** this is a code-level review. No live database was available, so visual regressions under real data volume were not observed. Findings below are drawn from component source, the design-system inventory, the Playwright suite and the audit checks — not from clicking through a running app.

## Information architecture

Five nav groups, nineteen destinations (`app/(app)/[org]/OrgShell.tsx`):

| Group | Destinations |
|---|---|
| Company | Product · ICP · Sources |
| Hunt | Command Center · Opportunities · Companies · Analyze a URL · Imports |
| Engage | Outreach · Inbox · Pipeline |
| Team | Members · Assignments |
| Learn | Analytics · Intelligence · What we've learned · Memory |
| Settings | Settings · Engine |

The grouping maps onto the product loop (Company → Hunt → Engage → Learn), which is the right organising idea. **No item is marked `unbuilt`** and every `href` resolves — verified by `NAV-01` and by Playwright ("no nav item leads to a 404").

**Concern:** nineteen destinations is a lot for a product whose core promise is "who next, why, what do I do". Four of them (Analytics, Intelligence, What we've learned, Memory) are all "Learn", and three of those have no data until the loop runs. A new user meets a navigation tree richer than the product's current output.

## Design system

`packages/ui` — 20 components, semantic tokens in `tokens.css`, `cn()` utility, `linkComponent` seam so the package does not depend on Next.

Semantics are meaningful rather than decorative:
- **green** = source-verified fact · **violet** = model inference · **gray** = unknown
- priority (`HOT`/`WARM`/`WATCH`/`IGNORE`) aliases existing hues and **always ships with the word and a dot shape** — nothing is communicated by colour alone, and Playwright asserts it.

Components that encode product rules rather than just styling: `ClaimBadge`, `EvidenceList`, `ScorePill` (requires an explanation to render), `BreakdownList`, `PriorityBadge` (requires a reason), `Freshness`, `QuotaBar`, `DemoFigures`.

That is a design system doing real work. Keep it.

## State coverage

| State | Handling |
|---|---|
| Loading | `loading.tsx` in onboarding; `useTransition` pending states in forms |
| Empty | `EmptyState` used throughout; empty states explain the reason and the fix |
| Error | `error.tsx`, `global-error.tsx`, `not-found.tsx`; Postgres messages surfaced rather than replaced with "something went wrong" |
| Demo | `DemoFigures` banner, build-enforced by `FEAT-DEMO` |
| Read-only | Viewer role gets the screen with controls replaced by an explanation, not a hidden form |

## Accessibility

- Skip link is the first focusable element and moves focus (E2E-asserted).
- Mobile drawer closes on Escape — "a pointer-only dismissal is a keyboard trap".
- `jsx-a11y` in the lint config; `hl-focusable` focus treatment is systematic.
- Non-interactive table rows are explicitly not focusable (unit-tested).
- Colour is never the sole carrier of meaning.

Better than most products at this stage.

## Themes

Light/dark/system via `ThemeToggle` and token redefinition. Not visually verified in this audit.

## Findings

| # | Severity | Finding |
|---|---|---|
| F-1 | High | **Missing primary actions.** The three most important verbs in the product have no button: "hunt now", "push to CRM", "enrich this contact". The screens are read-heavy and action-light |
| F-2 | High | The Command Center does not answer "what changed since I last looked" — the single question a daily user opens the product for |
| F-3 | Medium | Nineteen destinations, four of them empty-by-construction until the loop runs; consider collapsing the Learn group until it has data |
| F-4 | Medium | No global search / command palette. With companies, opportunities, contacts and campaigns all addressable, the absence is felt |
| F-5 | Medium | No notification or digest surface anywhere |
| F-6 | Low | `/kitchen-sink` ships in the production build |
| F-7 | Low | No skeleton loaders on the heavier product screens (opportunity detail does several round trips) |
| F-8 | Info | Visual consistency under real data volume unverified — tables with 1,000 rows, long company names, missing avatars |

## Recommendation

The interface is in better shape than the product's *wiring*. The highest-value UI work is not redesign — it is **adding the three missing verbs** (F-1) and **building the "what changed" rail** (F-2). Both convert existing backend capability into something a user can do.
