# Changelog

All notable changes to Huntloop are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/). Behaviour is documented screen by
screen in [COMMAND.md](COMMAND.md); its §16 holds the roadmap these entries
ship from.

## [Unreleased]

Needs database migrations **0046** and **0047** (0040–0045 are already in
production).

### Security
- Dependencies patched: `npm audit` reports 0 vulnerabilities (was 3 critical,
  4 high, 2 moderate). `next` 16.4.0 — the previous version was inside the
  range of a critical remote-code-execution advisory in `next/og`, which the
  Open Graph card and the Apple touch icon use. Also `undici` 8.11.2,
  `sharp` 0.35.5, and `vitest` 4.1.11 for the test suites.
- `0046`: signed-in and anonymous sessions can no longer call `usage_limit`,
  which returned any workspace's plan limits to anyone holding its id.
- The anonymous-research IP hash no longer falls back to a salt published in
  the repository; without `PUBLIC_RESEARCH_SALT` it derives one from the
  deployment's Supabase secret.
- The 2026-10-11 security audit's thirteen leads are closed (`0047` for the
  database half). Seven of them had been reproduced locally first:
  - A workspace admin can no longer change its own plan, trial or deletion
    date directly. Deleting a workspace still goes through the owner-only
    flow.
  - Usage can no longer be inflated from a session: a member meters one AI
    run at a time, viewers meter nothing, and every other metric is the
    engine's. A single call used to be able to lock a workspace out until the
    month ended.
  - A record can no longer point at another workspace's record (an
    opportunity at another workspace's company, an enrollment at its
    opportunity, and 88 more references). The engine follows these links with
    no tenant filter, so a planted one leaked the other workspace's data.
  - Approving a join request from a removed owner brings them back as a
    member, not as an owner. Un-deleting an owner now needs an owner.
  - An admin's provider credit limit can only lower the plan's ceiling, not
    raise it.
  - Unsubscribe tokens moved to a table no signed-in role can read, so a
    viewer (or a removed member) can no longer use them to suppress contacts
    and stop sequences. Links already sent keep working, and opening one
    again records no second event.
  - Nobody, admins included, can change who wrote a logged note, call or
    meeting.
  - Mail headers: a line break in a subject, recipient or In-Reply-To can no
    longer add a header (such as a Bcc). Drafted, replied and edited subjects
    are one line, a recipient must be one valid address or the message is not
    sent, and an imported CSV cell that is not a valid address is not stored
    as one.
  - Pages and documents added to Memory reach the message writer as reference
    material, not as house style, which the writer ranks above its own rules.
  - `/discover` researches only the front page of the domain it caches under
    (never the visitor's own path, query or a `www.www.` host), and reserves
    each paid lookup before the model is called, so failed, concurrent and
    refreshed lookups count against the limits. Expired readings are now
    swept daily.
  - Accepting an invitation needs a confirmed email address.
  - PDFs added to Memory are measured before they are read: one whose
    compressed streams expand past 64 MB, a password-protected one, or one
    with more than 500 pages is refused with a message saying what to do.

### Changed
- The interface now follows the design reference boards (logo, colour, type
  and layout, components): pill badges in sentence case; FACT / INFERENCE /
  UNKNOWN chips; Hot / Warm / Watch / Ignore pills; score pills and rings that
  show an unmeasured score as "Unknown" or "?" rather than 0; stat cards with
  the label first and a named link ("Open inbox →"); a 5 px quota meter; the
  evidence list as a hairline-separated list with blue source links; empty
  states, notes and the armed "click again" button as drawn on the boards.
- Brand placements per the logo board: the app icon and favicon on the dark
  tile; a mark-only social card; the mark and wordmark in product emails, on
  the share report, the invitation page and the legal pages; the lockup
  centred on sign-in, onboarding and the domain-research page.

### Fixed
- Below 1440 px the Command Center scrolled sideways and pushed **Log touch**
  and **Draft** off-screen in the Needs-you rail.
- A Hot item in Needs you no longer reads "Hot HOT".
- Sortable table headers were in sentence case beside capitalised ones.

### Added (engineering)
- CI fails when a registered job has no producer (the three known ones are
  listed and must be removed when wired) and when
  `docs/spec/generated/schema-reference.md` no longer matches the migrations.
- `npm run test:security-leads --workspace @huntloop/db` (part of `npm test`)
  holds the database fixes from the 2026-10-11 security audit: each case
  asserts the attack is refused and the ordinary path still works. One case
  fails if a later migration adds a reference between tenant tables without
  the same-workspace check.

## [0.1.0] — 2026-10-08

The first versioned release. Everything below shipped after `14cf749` (the
last commit on `main` before it), and needs database migrations **0040–0045**
— applied to production on 2026-10-08.

### Added

**Daily loop (§16.3-L, `37ebb22`)**
- Opportunities: a product filter (`?product=`), "Also fits" chips linking the
  same company's opportunities under other profiles, and a **Stale** view with
  bulk **Archive** for opportunities found 60+ days ago, never contacted, with
  no recent trigger (only pre-contact rows are archived; nothing is taught to
  learning).
- Needs you: "Reached out today" against the daily share of the weekly goal;
  each reach-out item shows its why-now and who to reach (or "find one"), with
  inline **Log touch** and **Draft**.
- **Outreach log** (`/outreach/log`): every touch on every channel, filtered
  by period, channel, person and outcome; outcomes (replied / waiting / no
  response) derived from the activity ledger; one-click **Got a reply**.
- Product settings as cards (what it does, who it is for, open opportunities)
  and **Draft from a website** for a new product.
- Ask Huntloop: several saved conversations per person, an optional product
  focus per conversation, and a **What it can see** panel.
- Performance: **Me / Everyone** (role default), a product breakdown, and
  pipeline value from deal values people entered; a printable **Share
  report** (Performance and competitors, browser save-as-PDF).
- Pipeline cards: last touch, next step and when it is due, sequence
  progress, deal value; column value totals.
- Sources: the review backlog split by customer profile.

**Personal mode and the learning layer (§16.3-K, K0–K6)**
- Start from a task instead of company research (`/welcome/start`), personal
  workspaces, and Analyze `?url=&run=1`.
- **Settings → You**: what Huntloop was told and learned about how you work —
  correct, pause, forget, share, export; "Written with" on drafts and answers.
- Learning from edits, rejections, redrafts with a note, assistant
  corrections, score overrides and losses; style applies itself with undo,
  targeting is only proposed.
- Just-in-time questions on the dashboard, Inbox, Ask Huntloop and Analyze;
  "Your usual questions"; "Is it working?" measurement.

**Roadmap P3–P6 (`7c16a64`)**
- Competitors and their research; opportunity brief sections and deal value;
  notifications and digests.
- **Ask Huntloop**, the workspace assistant answering from the workspace's
  own records with citations.
- Several products and the company page; prospect demand themes; PDF/DOCX
  Memory ingest; learning over competitors and demand.

### Changed
- The production schema gate (`LATEST_TABLE`) now probes `user_questions`
  (0044) instead of `hubspot_connections` (0028), so a database missing
  0040–0045 no longer reads as complete.
- The workspace shell prints in full: chrome is hidden and the page flows
  normally on paper.
- COMMAND.md §10.2 described the pre-P5 single-product form; it now matches
  the product list.

### Fixed
- Personal (user-scoped) memories were readable and editable by every member,
  and included in workspace exports; they are now private to their subject
  (0044).
- Drafts ignored the sender's own preferences.
- The assistant presented a person's own memories to the model as team notes.
- A draft insert named a column that only exists after 0044, which would have
  failed every draft on an older database; it now retries without it.
- `erase_contact` failed for anyone with a manual activity (0042 trigger).
- The Memory end-to-end test still chose "user" scope, which left that screen
  in K2.

### Database
Apply in order; each is additive and the bundle runs as one transaction
(`npm run db:doctor -- --bundle`):
- `0040_brief_value_notifications.sql` — brief sections, deal value,
  notification preferences.
- `0041_workspace_assistant.sql` — workspace-scoped assistant conversations,
  citations and proposed actions.
- `0042_demand_intelligence.sql` — demand themes and signals.
- `0043_learning_competitors_demand.sql` — learning over competitors and
  demand.
- `0044_personal_learning.sql` — private personal memories, preference
  signals, questions, applied-memory tracking, personal export.
- `0045_assistant_conversations.sql` — several assistant conversations per
  person (drops 0041's one-per-person index) and `conversations.product_id`.

[0.1.0]: https://github.com/arpitcoding007-star/Huntloop/compare/14cf749...v0.1.0
