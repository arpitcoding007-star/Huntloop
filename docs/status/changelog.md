---
description: What shipped and when, reconstructed from the commit history.
---

# Changelog

> **Layer:** Internal / Product · **Audience:** everyone

Reconstructed from `git log`. There are no version tags — `main` is
continuously deployed. Dates are commit dates.

{% hint style="info" %}
Commit messages here describe **what the change does to the system**, not what
was done to the files. That is a deliberate convention — the commit log is the
only place reasoning survives at the granularity of a change. See
[Code conventions](../developer/conventions.md).
{% endhint %}

***

## Uncommitted — working tree on `feat/sidebar-modules`

The audit and integration work in progress as of 2026-09-16.

| Added | |
|---|---|
| `apps/web/vercel.json` | **The heartbeat cron** — `/api/jobs/tick` every minute |
| `packages/crm/` | The HubSpot connector |
| `0028_signals_and_crm.sql` | Signal staleness, `hubspot_connections` |
| `handlers/fetch-company-signals.ts`, `schedule-signal-fetches.ts` | The hiring-signal capability |
| `handlers/sync-hubspot.ts` | CRM push (**no trigger yet**) |
| `settings/integrations/` | Connect and disconnect HubSpot |
| `lib/data/integrations.ts` | Connection status, never the token |
| `audit/full-system/` | A 29-document repository-wide audit |
| `docs/` (this book) | The GitBook |

***

## 2026-09-14 → 09-15 · Brand and theming

| Commit | |
|---|---|
| `de3e50d` | The real Huntloop brand mark; Google auth hidden for testing |
| `2836731` | **System / Light / Dark theming**, with Light derived from the report screenshots rather than inverted from Dark |

***

## 2026-09-09 · The front door

| Commit | |
|---|---|
| `125e06f` | **The marketing funnel** — landing page, `/discover`, use-case and comparison pages, anonymous research (`0025`), org directory and join requests (`0027`) |
| `2c17dd5` | `COMBINED-0024-0027.sql` — one paste for four migrations |
| `3d7a189` | Two real defects: a field that did nothing, and a form that deleted things |

***

## 2026-09-03 · The learning loop

| Commit | |
|---|---|
| `d28dd8e` | `0010` — the Learn stage gets a schema; rules get an **effect the engine reads** |
| `7100a0f` | `analyze_performance` and `draft_scoring_rules` |
| `42b3f09` | The engine wired to the rules; the learning sweep gets an idempotency key |
| `35a0c37` | Two screens: findings a person approves **one at a time**, and the rules they become |
| `dceff90` | `db:doctor` was answering a question nobody asked it |
| `8a8471a` | The tenth audit pass, and the migration audit that drove it |

***

## 2026-08-20 · Closing the loop, and the cron that broke

| Commit | |
|---|---|
| `4fe0bf3` | **The Command Center reads the database** instead of from a fixture file |
| `fe29fab` | **Saving a qualification** — the edge that turns four screens into a loop |
| `eb758fb` | The per-opportunity agent connected, and held to the contract its footer promised |
| `d821708` | An approved message gets a way out, and a person can write one |
| `d5095a8` | **The unsubscribe the emails had been promising** — every message carried `List-Unsubscribe` pointing at a 404 |
| `42afb4d` | The request path now spends against a ceiling, and is counted doing it |
| `da060d6` | The OPS-03 write-ups corrected: there is a `vercel.json`, and it changes nothing |
| `59f7942` | **The cron removed** rather than slowed to a lie — see [The heartbeat](../operations/heartbeat.md) |
| `e780f96` | Every route loaded, asserting nothing throws on the way |
| `311f391`, `2173126`, `d0abf42` | UX: a sixth state with real undo; one priority control; explanations reachable on a phone |
| `ac653ff` | The last four lint warnings were suppression comments that missed |

***

## 2026-08-19 · The engine, and every destination

| Commit | |
|---|---|
| `3bff281` | **Build the engine** — a queue, a scanner, and the tick that drives them |
| `b99088b` | **Close the outreach loop** — connect a mailbox, draft, send, read the reply |
| `a0321e8` | **Build every destination the sidebar advertises** |
| `5a67425` | Name the people in this product, and let one invite another |
| `60f3293` | One way to write per module, and both write tiers the schema has |
| `0355801` | Every loader's query checked against the live project, not against the ERD |
| `27fcfb7` | Why the second Vercel project has never built |

***

## 2026-08-13 → 08-16 · Safe to run

| Commit | |
|---|---|
| `130cd59` | **Refuse model calls that cannot be attributed to the caller's org** — the critical fix |
| `884f1b1` | Cap how fast an org can spend on model calls (`0005`) |
| `af35d56` | Refuse when the limiter cannot run, and say so as a **limit**, not a failure |
| `0cfffd1` | Validate what crosses the Server Action boundary |
| `431ad03` | **The audit program**, with its checks gating CI |
| `7658198` | The browser-facing layer: boundaries, headers, crawler policy |
| `a2fd596` | Error reporting, and measuring what the SDK costs to ship |
| `c6f71bd` | Every control says what it will do, or why it cannot |

***

## 2026-08-10 → 08-12 · Foundation

| Commit | |
|---|---|
| `e55c196` | Scaffold the monorepo and the design system |
| `df679d6` | `QuotaBar`, `BreakdownList`, `ActionRail`, `Sidebar`, `TopBar`; the Command Center assembled |
| `3d45400` | Phase A foundation and the first AI task |
| `d57e322` | `recommend_sources`, and the onboarding pipeline wired through to it |
| `5ffaac8` | `qualify_opportunity` — the analyze screen answers for real |
| `febf782` | `explain_why_now`, placed after qualification |

***

## Keeping this current

Add an entry when something **user-visible or architecturally significant**
ships. Not every commit — the git log already has those. See
[Documentation conventions](../meta-documentation-conventions.md).
