# Interface review

**Date:** 2026-08-16 · **Baseline:** `fa44298` · **Branch:** `main`

A pass over every screen in `apps/web/app`, asking one question the other nine
phases do not: *when a user presses this, does anything happen?*

The design system is not the problem. Five canonical states built once in
`States.tsx`, a contrast floor that was measured rather than assumed, a
`HoverPanel` that clamps to the viewport because three static anchors were tried
and each clipped somewhere. What is left is one class of defect, and it is one
this repository has already diagnosed and built two mechanisms against.

**The defect:** an affordance drawn before the behaviour exists. **Why it
survived:** both existing mechanisms — the `unbuilt` nav flag and the `NAV-02`
audit check — inspect `href`. A button has no href.

Fourteen findings. Six are closed in the commit that adds this file; the rest
are sequenced in [BACKLOG.md](BACKLOG.md).

---

## Closed in this pass

| ID | Finding | Where |
|---|---|---|
| **UX-01** | 22 controls rendered as live actions and did nothing when pressed | 7 files |
| **UX-02** | A `⌘K` shortcut advertised on every page and bound to nothing | `OrgShell.tsx` |
| **UX-03** | A disabled button giving a reason that had stopped being true | `Analyzer.tsx` |
| **UX-04** | Four Refresh buttons, none of which refreshed; two on one screen | 3 files |
| **UX-06** | An empty state instructing the user to visit two `unbuilt` screens | `OpportunityTable.tsx` |
| **UX-12** | Two breadcrumb chevrons promising a menu; one naming a hard-coded ICP | `TopBar.tsx`, `OrgShell.tsx` |

### UX-01 · Controls with no behaviour · **S**

Twenty-one buttons across six screens rendered as ordinary primary and
secondary actions — full styling, full focus ring, no `disabled` — with no
handler of any kind. From the user's side that is indistinguishable from a
broken application.

| Screen | Controls |
|---|---|
| Command Center | Refresh · Export · New hunt |
| Command Center rail | Review · Approve · View · Re-research · Skip · Dismiss · +5 more |
| Opportunities | Refresh ×2 · Analyze a URL · Add to campaign |
| Opportunity detail | Assign · Draft outreach |
| Sources | Scan now · Add a source |
| Topbar | Search · both breadcrumb switchers |

The rail is the sharpest instance and the one to read if you read one. Its
heading is **"Needs you"**. It asserts that four decisions require the user's
attention, and every Approve and Review button beneath it was inert. A queue of
demands with no way to satisfy them is worse than an empty queue.

**The fix is not the handlers.** It is `pending` on `Button` — the button half
of the `unbuilt` nav flag — plus `NAV-03` behind it. Each affected control now
states why it cannot act, and the check fails the build if a new one appears.

Two decisions inside `pending` worth keeping:

- **`aria-disabled`, not `disabled`.** A `disabled` button leaves the tab
  order, so the reason becomes unreachable by exactly the users who most need
  it stated. The control stays focusable, announces as dimmed, carries the
  reason as its accessible description, and refuses the click.
- **`disabled` alone does not satisfy `NAV-03`.** A greyed-out control with no
  reason is the question the check exists to stop shipping.

That second rule found the twenty-second control. `AgentPanel`'s Send button
was `disabled` with its explanation in a notice three elements away — honest at
the panel level, silent at the control a keyboard user actually lands on.
Nothing in the review had listed it; the check did.

**Verified by falsification.** A file containing one bare `<Button>` was added
under `apps/web/app`, `NAV-03` failed and named it, and the file was removed.
A check that has never failed has not been tested.

**And the browser suite earned its keep again.** The first implementation of
`pending` synthesized `onClick={e => e.preventDefault()}` so the control would
refuse the click. Types passed, lint passed, the audit passed, the production
build passed — and nine browser tests failed within a minute with *"Event
handlers cannot be passed to Client Component props"*. Most of these controls
are rendered by Server Components, and a function cannot cross that boundary;
the whole app shell was throwing.

Dropping the handler entirely is both the fix and the more honest
implementation: a pending button has no behaviour by definition, so there is
nothing to prevent, and `type="button"` never submits a surrounding form. Same
lesson as the three silent follow-ons in `SEC-07` — the failures that matter
here do not announce themselves at the type level.

### UX-02 · A shortcut the app teaches and does not listen for · **XS**

`OrgShell.tsx` passed `onSearchClick={() => {}}`. Because the prop was present,
`TopBar` rendered the whole search affordance — a 224px field with `⌘K` printed
inside it. Nothing bound the shortcut and clicking did nothing.

A dead link disappoints once. A dead shortcut teaches a habit and then breaks
it, on every page, indefinitely.

Removed rather than stubbed: `TopBar` already omits the control when the
handler is absent, which is the mechanism Feedback and Help have used since
`ANL-03`. Pass a handler in the commit that builds the palette — see UX-15.

### UX-03 · A disabled reason that another file made false · **XS**

`Analyzer.tsx` disabled *Save as an opportunity* and explained: *"Saving needs
the database — not connected yet."* By the sixth pass the database was
migrated, seeded and serving the opportunity list. The sentence was false, and
false in the direction that made the product look less finished than it was.

Nothing touched this file to break it. That is the same shape as `FEAT-07`, and
the rule it produces is worth stating plainly:

> A disabled state must never name a condition that some other file can quietly
> satisfy.

What is actually missing is the writer — nothing in `lib/data/opportunities.ts`
inserts. The control now says that instead, which is a condition only this
repository can change.

### UX-04 · Refresh buttons that did not refresh · **XS**

Four, plus a duplicate: `OpportunityTable` rendered two identical Refresh
buttons eleven rows apart, one in the header and one in the filter bar.

`RefreshButton` is a client component because the Command Center is an async
Server Component and cannot hold a handler. It calls `router.refresh()` rather
than `location.reload()` deliberately: the former re-runs the loader while
keeping client state — the filter you set, the rows you selected, your scroll
position. On the opportunity list a full reload would mean the refresh button
discards the triage you just did.

The header duplicate is gone; the filter-bar one is kept, because it belongs
with the other controls that change what is displayed.

### UX-06 · An empty state with no exit · **S**

An empty opportunity list read: *"Define an ICP and pick your sources to start
hunting."* Both destinations are `unbuilt: true` in the nav. The user was
instructed to do something the application would not let them do, on the one
screen where they had nothing else to try.

`EmptyState` has taken an `action` prop since it was written; it was unused
here. It now offers what exists — *Analyze a company URL* and *Review sources* —
and a filtered empty result offers *Clear filters* instead, because those are
different problems with different exits.

### UX-12 · Chevrons without menus, and one hard-coded ICP · **XS**

Both breadcrumbs rendered a `ChevronDown` — the universal promise of a menu —
with `onClick` undefined. The chevron now goes with the handler; without one
the crumb is plain text, with no button, no focus ring and no arrow.

The second crumb also read *"Web3 Infrastructure ICP · Hunting"* for every
organisation, hard-coded. A multi-tenant product naming someone else's ICP
above every screen is the kind of detail that costs trust out of proportion to
its size. No ICP name is plumbed to this component, so the crumb is removed
until one is — the same call as `/` redirecting to `/login` rather than serving
the component gallery.

---

## Open — sequenced in the backlog

### UX-05 · Analyze is a dead end that discards its own best output · **M**
**The highest-value item in this review.**

Paste a URL; a model reads the site, judges it against the ICP, and produces a
scored verdict with cited evidence — the most expensive and most valuable thing
the product does. Press *Analyze another* and `setState({})` discards it. It was
never written anywhere. No history, no list, no way back.

Meanwhile the opportunity list can only show rows `db:seed` created, and the two
screens have no path between them in either direction.

**Do:** make *Save as an opportunity* insert the qualification and redirect to
`/[org]/opportunities/[id]`. One edge turns four disconnected screens into a
loop — analyze → save → list → detail — and it is the first moment a user
creates something that outlives the session. It also closes UX-03 properly, by
making the button real rather than better-labelled.

### UX-07 · Onboarding ends on the most invented screen in the app · **S**
`SourcesStep` finishes with `router.push(`/${org}/dashboard`)`. The Command
Center is the one screen whose figures are entirely hard-coded — `180
discovered`, `2 meetings`, sending capacity for two mailboxes that do not
exist. `DemoFigures` marks it honestly, which is right, and means the reward for
completing setup is a page announcing that it is a demonstration.

The four steps before it are the best work in the product: it reads the user's
own site, shows every finding as editable, labels each as fact or inference, and
cites the URL. Then it hands over a fixture.

**Do:** land on `/[org]/opportunities`, which is real. Better, land on Analyze
with their first target prefilled, so setup ends with the product doing the
thing they bought it for.

### UX-08 · Selection serves one action, and it is unbuilt · **S**
`DataTable` carries checkboxes, a count, an all-rows toggle and a selection
bar. Everything it leads to is *Add to campaign*, now marked `pending`.
Either give it a real verb — bulk re-research, bulk assign, export the
selection — or remove selection until one exists.

### UX-09 · The same four buckets, twice, with different rules · **S**
`/opportunities` renders four priority `StatCard`s with counts, and directly
beneath them five filter chips for the same four buckets with the same counts.

Worse, the cards behave differently between screens: on the Command Center a
priority `StatCard` deep-links into this filtered list, and here the
identical-looking card is inert. The component teaches "clickable" on one screen
and "not clickable" on the next.

**Do:** keep the stat cards — bigger targets, they already carry the tone colour
and the count, and wiring them matches the dashboard. Give the active one
`aria-pressed` and delete the chip row.

### UX-10 · The URL is true exactly once · **S**
`?priority=hot` seeds the filter on arrival. Click a chip afterwards and the
state changes while the URL does not, so the address bar describes a view that
is not on screen: Back does not undo, Reload silently reverts, and a link sent
to a colleague shows them something else.

The code comment gives the objection — a `router.push` per click re-runs the
server component to change state the client already owns — and it is correct.
`window.history.replaceState` updates the address bar without a navigation and
without re-running the loader. The filter stays client-owned, and a filtered
list becomes shareable, which for a sales team is most of the point of filters.

### UX-11 · "Needs you" is below the fold on the common screen size · **S**
The rail sits beside content at ≥1440px and stacks beneath it below that. On a
1280px laptop it lands under the priority grid, the why-now cards and their
evidence, the weekly counters, the outcomes, the quota bars and two breakdown
lists — roughly two thousand pixels down. It is the only part of the Command
Center that asks for a decision, and it is the last thing reachable.

**Do:** below 1440px, promote a compact strip under the header with the top two
items and a count, rather than the full column at the bottom.

### UX-13 · The explanation panel is unreachable by touch · **XS**
`HoverPanel` opens on `mouseenter` and `focus` only, with no click or tap path,
so on a phone the score breakdown and the priority reasoning cannot be opened.
Those two panels are where §51 and §77 Principle 4 are actually discharged. The
component's own header states the standard it fails: *an explanation the user
cannot read has not been given.*

Separately and definitely a bug: the panel sets both `overflow-y: auto` and
`pointer-events: none`. Those cancel. An eight-dimension breakdown exceeding
`maxHeight` gets a scrollbar no pointer can use — and `mouseleave` on the
trigger closes the panel, so the pointer could never arrive anyway.

**Do:** click-to-toggle alongside hover, dismissed by outside-click and Escape.
Then either let the panel take pointer events and stay open while the pointer is
within it, or drop `overflow-y: auto` and let it size to its content. Not both
as they stand.

### UX-14 · The state family is missing confirmation · **S**
`States.tsx` defines empty, error, permission-denied, rate-limited and loading —
built once, deliberately, so no page improvises. There is no confirmation
state, so nothing in the app can say *done*.

Removing a source is therefore instant, silent and unrecoverable. Every write
added from here — saving an opportunity, assigning an owner, approving a draft —
needs this, and each will invent its own if it is not there. That is the
argument the file's own header already makes about permission-denied.

### UX-15 · A command palette · **M**
Optional, and listed because UX-02 removed a control rather than building one.
This product wants a palette more than most: a dozen of its verbs — analyze a
URL, jump to a company, filter to Hot, re-research — have no screen of their
own, and a palette can host them before those screens exist.

---

## The pattern underneath

Every finding closed above is the same defect: an affordance drawn before the
behaviour exists. This repository already named it — §7's rule against promoting
an inference to a fact, turned on the interface itself — and built two
mechanisms against it, both of which read `href`.

Buttons, keyboard shortcuts, chevrons and disabled-reasons are affordances with
no href to inspect, and all four appear above. The durable half of this pass is
not the twenty-two handlers and labels; it is `NAV-03`, which is the same move
that made `audit.mjs` worth building in the first place.

**What still has no check:** UX-03's class — a true sentence made false by a
change elsewhere. `FEAT-DEMO` covers demo figures and `NAV-03` now covers
unexplained controls, but nothing verifies that a `pending` reason is *still
accurate*. Prose remains the surface with the least coverage in this codebase,
and it is where both this pass and the sixth pass found their most interesting
defect.
