# Pass 20 — summary: is every panel connected?

Commit `32b0c6f` (branch `feat/pass-19-debt`, clean tree), 20 Nov 2026. Scope: the dashboard and every panel under `apps/web/app/(app)/[org]/`, traced from button to table to engine and back. **59 findings: 0 Critical · 9 High · 31 Medium · 19 Low.** Full list: [03_FINDINGS.md](03_FINDINGS.md).

**The short answer:** the wiring is mostly real. Every nav link resolves, every server action has a caller (except one), and every enqueued job has a handler. There's no path where demo fixtures leak into a live workspace, and every check passes. What's broken sits one layer down, in places the tests don't look:

- two loaders select columns that don't exist, and the error is swallowed;
- several "wait" states are recorded as terminal, so outreach silently stops;
- inferred data loses its label between the table and the screen;
- AI wrappers return canned examples as success, and two callers persist them.

## A. What HuntLoop is today
A Next.js 16 app over Supabase Postgres. A job queue (`job_executions`) is driven by a 5-minute GitHub Actions tick, with Inngest as an alternative driver. Packages handle providers (Apollo, Hunter, ZeroBounce), AI (Anthropic), CRM (HubSpot), and mailboxes (Gmail/Microsoft OAuth). The panels cover the whole loop:

- Discover: Hunt now, Sources, Imports, Analyze
- Qualify and prioritise: scoring, Needs-you, Opportunities
- Enrich: research, contact ranking
- Reach Out: Outreach, Inbox
- Track: Pipeline, Outreach log
- Learn: Learn, Performance, Memory

Without a database, every screen renders labelled fixtures.

## B. Architecture
Browser → server components and server actions (`mutate()`: membership, role, org scope) → `lib/data/*` loaders (`load()`: live database or fixtures) → Supabase (RLS) and request columns → `schedule_*` sweepers → handlers in `packages/jobs` → provider and AI calls (budget, ledger, kill switch) → tables → revalidated UI. See [01_SYSTEM_MAP.md](01_SYSTEM_MAP.md).

## C. Feature inventory rollup
About 95 panel features were traced ([02_FEATURES.md](02_FEATURES.md)):

| Status | Count | Features |
|---|---|---|
| Working | ≈55 | — |
| Partial | ≈30 | — |
| Broken | 6 | Agent; contact fit; Analyze save on existing rows; campaign start → enrollments; ICP delete/activate; You trend |
| Dead or missing | 4 | `company_gaps`; unsnooze; discovered feeds; billing (by decision) |

## D–G. Severity headlines
- **Critical (0).** No cross-tenant path, no auth bypass and no send without consent found on these panels.
- **High (9):**
  - Reach Out stalls two ways: PANEL-301, PANEL-302.
  - Inference is shown as fact: PANEL-201, PANEL-103.
  - A canned AI answer is saved as real: PANEL-101.
  - Contact fit is dead on live data: PANEL-102.
  - Analyze save corrupts provenance: PANEL-202.
  - CSV import breaks after any removal: PANEL-203.
  - A deleted ICP keeps paying for discovery: PANEL-401.
- **Medium (31).** The main groups:
  - The inbox misstates what will send (303/304/305).
  - Counts are computed from capped lists (204, 108, 208, 311).
  - Errors are swallowed into "nothing" (106, 405).
  - Missing audit coverage (404) and seats not enforced (402).
  - Debt #2 and #13 work but mislead (105, 104).
- **Low (19).** Copy, dead code and consistency.

## H. Missing systems
- A **schema check on `.select()` strings**: `check:types` covers `types.ts` only.
- A **writer for `company_gaps`**.
- A **seat-count mechanism**.
- A **correction path for AI reply labels**.
- **Pagination** on Companies, Inbox and Pipeline.
- **Billing** (held by decision).

## I. Broken connections: root causes
| RC | Cause | Shows up in |
|---|---|---|
| RC-1 | A temporary state is written as a terminal one, and nothing reverses it | PANEL-301, 302, 303, 304, 305, 401 |
| RC-2 | AI wrappers return `ok:true, source:"unconfigured"` (a canned example), and callers persist it | PANEL-101, 406 |
| RC-3 | `claim_kind`/`confidence` are dropped between table and screen, or a label is derived from "has evidence" | PANEL-201, 103, 307, 207, 210, 212, 313 |
| RC-4 | Query errors are swallowed, and counts come from capped lists | PANEL-102, 115, 106, 405, 204, 108, 109, 208, 306, 311, 403 |
| RC-5 | Blind writes on `companies` ignore soft delete and merge | PANEL-202, 203, 211 |
| RC-6 | A table or counter is read but has no producer (or only one producer) | PANEL-205, 206, 402, 404 |

## J–K. Data-flow and integration maps
See [01_SYSTEM_MAP.md](01_SYSTEM_MAP.md).

## L–O. Headlines by area
- **Security.** Role and escalation guards hold, and admin actions are gated server-side and in RLS. Gaps:
  - PANEL-308: a member can enable autonomous sending, unaudited.
  - PANEL-404: credential changes and full exports are unaudited.
  - PANEL-216: a link can spend a member's AI budget.
  - PANEL-411: an unauthenticated PUT to `/api/inngest` triggers a register call.
- **Performance.** The shell runs about 11 queries for one badge on every navigation (PANEL-117). Inbox, Companies and Pipeline reads are unbounded.
- **UX.** All 31 demo routes render, and axe passes on all of them (e2e 388 passed, 4 skipped). Problems: actions that report success when nothing happened (PANEL-105, 304, 305, 409), and the "What changed" card that vanishes on interaction (PANEL-104).
- **Product integrity.** The §7 promise holds in the database and the AI layer (243/243 AI checks), but leaks at the UI layer (RC-3).

## P. Implementation order
See [06_PLAN.md](06_PLAN.md):

1. RC-1 in outreach (301, 302) and ICP (401).
2. RC-2 and RC-3 trust leaks (101, 201, 103).
3. RC-4 column bugs and the select-string checker (102, 115).
4. RC-5 company writes (202, 203).
5. The Mediums, grouped by root cause.

## Q. Do not change
See [06_PLAN.md](06_PLAN.md#do-not-change). In brief:

- `mutate()` and the `load()` live/demo split
- fair claiming (0056) and the send-time withdraw guard
- the 0051 approval trigger
- the job registry's total `Record<JobName>`
- the kill switch
- the demo banner
- `refreshWhyNowAction`'s refusal of non-live output

## R. Target architecture (from the current code)
Keep the shape. Add three invariants at the seams:

1. **Wait vs. terminal.** Every refusal in the engine is either `defer()` (it clears itself) or `error` (terminal), and parents never mutate children's status.
2. **Provenance travels.** Every loader that reads a claim-bearing table selects `claim_kind`, `confidence` and the written date, and `ClaimBadge` derives its kind only from those.
3. **Loaders fail loudly.** A typed `select` checked in CI against the migrated schema, `error` surfaced rather than mapped to empty, and counts taken from `head:true` queries.

## SYSTEM HEALTH
- **Architecture.** Sound and consistent. Actions, loaders, request columns and sweepers form one pattern applied almost everywhere. The defects sit at the seams between layers, not in the design.
- **Product functionality.** Discover, qualify, track and learn are wired end to end. Reach Out is wired but stalls on two common paths (PANEL-301, 302), so in practice the loop doesn't reliably close.
- **Data integrity.** The database guards are strong (CHECKs, same-org triggers, the 0051 trigger). App-side company writes bypass the soft-delete and merge model (RC-5).
- **Security.** No Critical issue on the panels. Audit coverage is thin for credential and export actions.
- **Performance.** Nothing measured slow in the demo (routes took 0.25–3.5 s cold on the dev server). Several unbounded live reads will degrade with scale.
- **UX.** Polished and accessible in demo. Several success messages are not true on live data.
- **Integrations.** HubSpot and mailbox OAuth are wired correctly. The production origin couldn't be reached, so nothing is live-verified.
- **Production readiness.** UNVERIFIED. The recorded Vercel URL returns `DEPLOYMENT_NOT_FOUND`, and the local `NEXT_PUBLIC_SITE_URL` is empty.
- **Maintainability.** High. Tests and comments are unusually thorough. The gap is that tests don't exercise live PostgREST column names or the multi-tick outreach flow.

## TOP 10 TO FIX FIRST
| # | Problem | Evidence | Impact | Depends on | Action |
|---|---|---|---|---|---|
| 1 | Enrollments parked by a draft or paused campaign never restart | `advance-enrollments.ts:146-149` | Zero sends in the default flow | — | Hold instead of park, or un-park on activate |
| 2 | Refused approved mail is stranded | `send-message.ts:289-296`; `0056:136` | Approved mail never sends | — | `defer()` for quota, cadence and postal; a "Send again" action |
| 3 | A deleted or replaced ICP keeps paying for discovery | `0038:20-40`; `icp/actions.ts:297` | Provider spend on a dead profile | — | Join `icps` in the claim |
| 4 | Canned Agent answer saved as real | `[id]/actions.ts:174-176` | Invented advice stored with a citation | — | `source !== "live"` refusal |
| 5 | Competitor phrase match shown as Fact | `BriefSections.tsx:118` | Seller acts on a string match | — | Select and render `claim_kind` |
| 6 | Why-now in Needs-you unlabelled and undated | `NeedsYouList.tsx:187-191` | Stale inference read as fact | — | Badge and date |
| 7 | Contact fit selects a missing column | `opportunities.ts:358` | "Who first" dead on live data | — | `reason`; plus the select checker (#10) |
| 8 | Analyze Save overwrites provenance and priority | `analyze/actions.ts:196-231` | Corrupt attribution, lost human verdict | — | Resolve, then update |
| 9 | CSV import fails after any removal | `imports/actions.ts:166-197` | Import unusable | — | Unfiltered pre-read and restore |
| 10 | No CI check that `.select()` columns exist | PANEL-102, 115 | The next schema drift ships silently | — | Add to `audit.mjs` (see 06_PLAN) |
