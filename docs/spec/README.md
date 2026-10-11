---
description: The Product Specification Pack — six connected documents and a gap report that describe Huntloop as it is, derived from the code rather than from the plans.
---

# Huntloop — Product Specification Pack

> **As of:** 2026-10-08 · **Code state described:** branch `feat/personal-learning` @ `4c8576a`
> ("chore(release): 0.1.0"), schema through migration `0045`.
> **Purpose:** one accurate, project-specific source of truth that a developer, designer
> or AI coding agent can pick up without rediscovering the product.
> **This pack describes; it does not change behaviour.** No product code was modified to
> produce it. The only code added is a read-only generator
> (`packages/db/scripts/schema-reference.ts`) that writes
> [generated/schema-reference.md](generated/schema-reference.md).

## The documents

| # | Document | Answers |
|---|---|---|
| 1 | [Product Requirements (PRD)](01-product-requirements.md) | What is the product, for whom, and what does each feature do and how complete is it? |
| 2 | [Technical Requirements (TRD)](02-technical-requirements.md) | How is it built, deployed, secured, tested and operated — today and intended? |
| 3 | [App Flow](03-app-flow.md) | How does a user move through it; what does every route do under every condition? |
| 4 | [Design Brief](04-design-brief.md) | What does it look like and how does it behave, in reproducible rules? |
| 5 | [Backend / Database / Schema](05-backend-database-schema.md) | What data exists, who owns and may touch it, and where is it inconsistent? |
| 6 | [Implementation Plan](06-implementation-plan.md) | In what order should the remaining work be done, and what is "done"? |
| 7 | [Specification Gap Report](07-specification-gap-report.md) | What is missing, contradictory, broken, or waiting on a decision? Holds the registers. |
| — | [Schema reference (generated)](generated/schema-reference.md) | Every table, column, constraint, index, policy, trigger and function — introspected from the migrations. |

Read order for a newcomer: **1 → 3 → 5 → 2 → 4 → 6**, then **7** for what to distrust.
Read order for someone about to change code: **7 first**.

## Status vocabulary (used in every document)

| Status | Meaning |
|---|---|
| **EXISTS** | Implemented and verified working by the evidence cited |
| **PARTIALLY EXISTS** | Implemented, with a stated part missing |
| **BROKEN** | Present but does not work as intended (current behaviour, expected behaviour, evidence, likely cause, fix are given) |
| **MISSING** | Required or specified, not present |
| **PLANNED** | Deliberately intended; not implemented |
| **UNCLEAR** | Cannot be determined from the project; a decision or an out-of-band fact is needed |
| **N/A** | Genuinely irrelevant here |

"EXISTS" means *implemented and covered by the repository's own checks or read directly in code*. It
does **not** mean "observed working against a live vendor or in production" — see
[Evidence and its limits](#evidence-and-its-limits).

## Identifier schemes

Identifiers are stable so the six documents can cross-reference one another.

| Prefix | Meaning | Defined in |
|---|---|---|
| `F-nn` | Feature | PRD §6 |
| `UC-nn` | Use case | PRD §4 |
| `BR-nn` | Business rule | PRD §14 |
| `R-nn` | Route / screen | App Flow §3 |
| `FL-nn` | Flow | App Flow §4 |
| `T-nnn` | Table (grouped, not numbered individually) | Schema §3 |
| `CON-nn` | Contradiction (document vs. code, or document vs. document) | Gap Report §3 |
| `DEF-nn` | Broken or incomplete (code) | Gap Report §4 |
| `MIS-nn` | Missing | Gap Report §2 |
| `DEC-nn` | Decision required from the owner | Gap Report §5 |
| `REC-nn` | **RECOMMENDED** — not a requirement | Gap Report §9 |
| `P-n` | Implementation phase | Implementation Plan |

## Authority order

When sources disagree, in descending order of trust:

1. **The code and migrations** — what actually runs.
2. **This pack** — derived from (1) on the as-of date.
3. **[COMMAND.md](../../COMMAND.md) §0–§15** — the element-by-element interaction map. It remains the
   *normative detail layer* for the App Flow; this pack links into it rather than duplicating its
   ~1,900 lines. It was spot-checked against code for this pack; the drift found is logged as
   `CON-xx`.
4. **The `docs/` book** (`docs/README.md` …) — good narrative, but its *numbers and status pages
   are stale* (written against 28 migrations; there are 45). See CON-03.
5. **Plans and history** — `IMPLEMENTATION_PLAN.md`, the Master Context, `PROJECT_AUDIT.md`,
   `audit/*`. These record intent and history, not current behaviour.

## Evidence and its limits

**Verified directly for this pack (2026-10-08):**

| Check | Result |
|---|---|
| `npm run typecheck` (all 7 workspaces) | exit 0 |
| `npm test` | all pass — web 267 (Vitest), ai 227, crm 20, db 341 migration checks + 59 rules + 148 pure, jobs 298, providers 81, ui 39 → **1,480 assertions** |
| `npm run audit:site` | 44 checks · 0 failing · **1 warning** (`LEGAL-01`) |
| All 45 migrations applied to a real Postgres (PGlite) | succeeds; yields **79 tables, 9 views, 98 functions, 140 RLS policies**, RLS on 79/79 tables |
| Job reachability (grep of every `enqueue` site) | 34 handlers; **3 have no caller** |
| Production health (`GET https://www.seefluence.com/api/health`) | `ok:false`, commit `14cf749`, schema probe `complete`, **no** cron secret, **no** AI/provider/mailbox/observability keys |
| `git` | `main` = `origin/main` = `14cf749`; `feat/personal-learning` is **11 commits ahead of `main`, never pushed**; tag `v0.1.0` is local only |
| GitHub (read-only `gh`) | PR #2 **open**; Actions secrets **0**, variables **0**; no branch protection (404); workflow `Engine tick` **fails on every scheduled run** ("`CRON_SECRET` … or `HUNTLOOP_URL` … is not set"); CI on `main` **red on its last 6 pushes** (latest cause: `Audit — dependency advisories`) |
| `npm audit` (today) | **9 vulnerabilities — 3 critical, 4 high, 2 moderate**; 6 are in production dependencies, including `next` 16.3.5 (critical: RCE in `next/og` `ImageResponse`, which `/opengraph-image` and `/apple-icon` use) |
| 2026-10-09 re-check | After the patch: `npm audit` **0 vulnerabilities**; typecheck, lint, every unit suite, site audit, build, bundle budget and Playwright re-run (TRD §16); design reference boards 00–04 reviewed (Design Brief §15) |

**Not verified (and therefore not asserted as working):**

- Any live-vendor behaviour (Anthropic, Apollo, Hunter, ZeroBounce, Gmail, Outlook, HubSpot, Resend).
  No verified environment has had those keys.
- Playwright browser suite (~108 `test()` cases across 8 specs, run in demo mode in CI) — not re-run here.
- Whether migrations `0040`–`0045` are applied to production (`CHANGELOG.md` says yes; the repo cannot
  prove it — see CON-11).
- Signed-in flows on the real production domain.
- Vercel/GitHub/Supabase/DNS settings (only what `/api/health` and committed files reveal).
- Backups, point-in-time recovery, monitoring/alerting — nothing in the repository configures them.

## Relationship to existing documentation

Nothing was deleted. Existing documents are reused as follows:

| Existing | Role now |
|---|---|
| `COMMAND.md` | Normative element-level interaction map (App Flow §0 explains how to use it). Roadmap §16 is the planned-work ledger. |
| `docs/product/*`, `docs/architecture/*`, `docs/security/*`, `docs/developer/*`, `docs/operations/*` | Narrative companions; each pack document links to the relevant ones. |
| `docs/status/*`, `docs/README.md` status block | **Superseded in the numbers.** A banner pointing here was added to those pages (CON-03). |
| `HuntLoop — Master Product, Technical & Engineering Context.md` | Product intent. Its own §85–§87 already separate confirmed / inferred / unknown; the PRD respects that split. |
| `IMPLEMENTATION_PLAN.md`, `DELIVERY_PLAN.md`, `Migrate.md`, `explee.md`, `New_Aud.md`, `Project_Creation.md`, `PROJECT_AUDIT.md`, `audit/*` | Historical. Not relied on for current behaviour. |

## Maintaining the pack

- Re-generate the schema reference after any migration:
  `node --experimental-strip-types packages/db/scripts/schema-reference.ts` (run from the repo root).
- Keep `COMMAND.md` in sync with every UI/route/action change (its own maintenance rule); update PRD
  §6 and App Flow §3 only when a *route, feature status or role rule* changes.
- Every `DEF-`/`MIS-`/`CON-` closed should be removed from the Gap Report in the same commit that
  closes it, with the fix recorded in `CHANGELOG.md`.
- **Never put a secret value in any of these documents.** Variables are named, never valued.
