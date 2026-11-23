# Pass 20 — fix order, mechanizable checks, do-not-change

Fixes are ordered by consequence: whether outreach sends, provider spend, trust in what's shown, data integrity, and then UX.

## P0 — the loop does not close, or money is spent for nothing
| Order | Finding | Why first | Depends on |
|---|---|---|---|
| 1 | PANEL-301: enrollments are never un-parked | The default flow sends nothing | — |
| 2 | PANEL-302: refused approved mail is stranded | Approved mail never sends | — |
| 3 | PANEL-303: inbox reads `error` | Makes 1–2 visible, and verifiable by the user | 2 |
| 4 | PANEL-401: a dead ICP's searches keep running | Unbounded provider spend | — |

## P1 — what is shown as true is not
| Order | Finding | Depends on |
|---|---|---|
| 5 | PANEL-101 and PANEL-406: refuse to persist `source !== "live"` (fix the wrappers once) | — |
| 6 | PANEL-201, 103, 210, 207, 212: carry `claim_kind`, `confidence` and the written date to the UI | — |
| 7 | PANEL-102, 115: correct the columns. Then add check C1 below so this class can't recur | — |
| 8 | PANEL-202, 203, 211: resolve-then-write for `companies` (one shared helper) | — |
| 9 | PANEL-313: activation reply figures from `outcomes` | — |

## P2 — reliability and honest UI
- PANEL-304, 305, 309: parent-state checks in approve and redraft, and a resume path. Depends on 1.
- PANEL-106, 405: surface loader errors.
- PANEL-204, 108, 109, 208, 311, 306: real counts and pagination.
- PANEL-104, 105: What changed and Hunt now.
- PANEL-308, 404: audit coverage, and admin required for autonomy.
- PANEL-402: seats.
- PANEL-206, 205: producers.
- PANEL-307: correcting reply labels.
- PANEL-310, 209, 107, 110.

## P3 — cleanup
All Lows: PANEL-111…117, 213…217, 312, 314, 407…411.

## Checks for `scripts/audit.mjs` and CI (how these findings stay closed)
| ID | Check | Catches |
|---|---|---|
| C1 | Parse every `.from("t").select("…")` string literal in `apps/web/lib`, `apps/web/app` and `packages/*/src`. Resolve each column, including embedded `rel(col)`, against `packages/db/schema-reference.md`. Fail on an unknown column | PANEL-102, 115, and future drift |
| C2 | In `lib/data/*`, a destructured `{ data }` from a PostgREST call whose `error` is never read fails (allow-list for optional sources) | PANEL-106, 405, 102 |
| C3 | Any caller that writes AI output (`insert`/`update` after an `ai/*` call) must reference `result.source` | PANEL-101, 406 |
| C4 | Literal `<ClaimBadge kind="fact"` is forbidden; the kind must come from data | PANEL-201 |
| C5 | Every table read in `lib/data` has a writer in `packages/jobs`, the app actions or SQL (allow-list for user-only tables) | PANEL-205, 214 |
| C6 | `select(` without `.limit`, `.range`, `head:true` or `.single`/`.maybeSingle` in `lib/data` is a warning | PANEL-208, 109, 311 |
| C7 | Every `"use server"` action with `minRole: "admin"` calls `recordAudit` | PANEL-404, 308 |
| C8 | `process.env` names match `.env.example` | 05_ENV |
| C9 | Jobs test: a multi-tick outreach scenario (draft campaign → enrol → tick → activate → tick → message; quota refusal → reset → sends) | PANEL-301, 302 |
| C10 | `verify-migrations`: deleting an ICP means `claim_due_discovery_queries` returns none of its queries | PANEL-401 |

## Do not change
- `mutate()` (`apps/web/lib/data/org.ts`): membership, role and org scope on every action. It holds on every panel.
- `load()`, the live/demo split, and the DataSourceBanner. No fixture leak was found.
- Fair claiming (0056), `claim_mailbox_send`, and the send-time `withdrawnOrHeld` guard.
- The 0051 approval-integrity trigger, and the compare-and-swap on approve.
- The job registry as a total `Record<JobName>` (`packages/jobs/src/registry.ts`).
- The kill switch (`platform_pauses`) and the places that read it.
- `refreshWhyNowAction`'s refusal of non-live output: it is the model for PANEL-101.
- `saveCompanyAction`'s restore-on-re-add: it is the model for PANEL-203.
- The same-org triggers (0047) and the admin-only RLS on `hubspot_connections`.
- Request columns plus sweepers as the only way panels start engine work.
