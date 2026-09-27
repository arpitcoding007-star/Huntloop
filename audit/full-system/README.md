# Full-system audit — index

**Date** 2026-09-15 · **Branch** `feat/sidebar-modules` · **Method** repository-wide inspection with mechanical cross-referencing. Existing documentation was treated as a hypothesis, not evidence; every claim names the file, table, job or check it came from.

## Read in this order

| # | Document | Why |
|---|---|---|
| 00 | [Executive summary](00_EXECUTIVE_SUMMARY.md) | Current state, the central finding, launch blockers |
| 22 | [Gap matrix](22_PRODUCT_GAPS.md) | Everything by severity, with quick wins |
| 02 | [Feature inventory](02_FEATURE_INVENTORY.md) | Per-capability status table |
| 26 | [Implementation plan](26_IMPLEMENTATION_PLAN.md) | Phased, dependency-ordered |
| 27 | [Launch readiness](27_LAUNCH_READINESS.md) | 18 gates, current verdict |
| 28 | [Manual actions required](28_MANUAL_ACTIONS_REQUIRED.md) | What only a human with credentials can do |

## Subsystem audits

| # | Document |
|---|---|
| 01 | [System map](01_SYSTEM_MAP.md) — entities, ownership, conflicting concepts |
| 03 | [User journey](03_USER_JOURNEY_AUDIT.md) |
| 04 | [Onboarding](04_ONBOARDING_AUDIT.md) |
| 05 | [Discovery & prospecting](05_DISCOVERY_AUDIT.md) |
| 06 | [Signals & intent](06_SIGNALS_AUDIT.md) |
| 07 | [Qualification & scoring](07_QUALIFICATION_SCORING_AUDIT.md) |
| 08 | [Enrichment](08_ENRICHMENT_AUDIT.md) |
| 09 | [AI & research](09_AI_RESEARCH_AUDIT.md) |
| 10 | [Outreach](10_OUTREACH_AUDIT.md) |
| 11 | [CRM & HubSpot](11_CRM_HUBSPOT_AUDIT.md) |
| 12 | [Learning loop](12_LEARNING_LOOP_AUDIT.md) |
| 13 | [Database](13_DATABASE_AUDIT.md) |
| 14 | [API & backend](14_API_BACKEND_AUDIT.md) |
| 15 | [Jobs & automation](15_JOBS_AUTOMATION_AUDIT.md) |
| 16 | [Frontend & UX](16_FRONTEND_UX_AUDIT.md) |
| 17 | [Security & permissions](17_SECURITY_PERMISSIONS_AUDIT.md) |
| 18 | [Performance & reliability](18_PERFORMANCE_RELIABILITY_AUDIT.md) |
| 19 | [Testing & CI/CD](19_TESTING_CICD_AUDIT.md) |
| 20 | [Data quality](20_DATA_QUALITY_AUDIT.md) |
| 21 | [Provider integrations](21_PROVIDER_INTEGRATIONS_AUDIT.md) |
| 23 | [Technical debt](23_TECHNICAL_DEBT.md) |
| 24 | [Competitive capability gaps](24_COMPETITIVE_CAPABILITY_GAPS.md) |
| 25 | [Target architecture](25_TARGET_ARCHITECTURE.md) |

## The finding in one paragraph

HuntLoop is a well-architected system whose connective tissue is missing in a small number of specific places. Four job handlers are registered, tested and **enqueued by nothing** (`enrich_person`, `resolve_entity`, `purge_contact_data`, `sync_hubspot`). Nine sweepers depend on a cron that **was never configured**. There is **no in-app control** that starts a hunt, pushes to CRM, or requests an erasure. Deduplication — which migration `0012` said must ship *before* provider search — never runs while provider search does. Three of five plan limits are displayed and unenforced, and there is no payment path at all. Meanwhile a **critical unauthenticated RCE advisory** against the pinned Next.js range has CI's dependency gate failing today.

None of that is a design problem. It is almost entirely *triggering*, and it is days of work — followed by the one thing no amount of code replaces: a live run against real vendor credentials.

## What this audit deliberately did not do

- Change code. This was an audit pass; the only files written are in this directory.
- Trust existing documentation. Three README claims and two code comments were found to describe a product that no longer exists (`23_TECHNICAL_DEBT.md`).
- Verify anything against a live database, a live model, or a live vendor. No such credentials exist in the audit environment, and every claim that would need them is marked ❓ or 🔴 rather than assumed.
