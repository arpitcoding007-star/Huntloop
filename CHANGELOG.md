# Changelog

All notable changes to Huntloop are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/). Behaviour is documented screen by
screen in [COMMAND.md](COMMAND.md); its §16 holds the roadmap these entries
ship from.

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
