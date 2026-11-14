# Pass 16 — roadmap and backlog

Order follows consequence, then dependency: data loss, security and unsafe sends → production-breaking → core loop → integrity and concurrency → reliability → spend → debt. Finding details are in `03_FINDINGS.md` (Critical/High in full, Medium/Low as rows with the reviewer file holding the full block).

**Hard ordering constraint for the next deploy:** land R1-2 and R1-3 → apply 0048 → 0049 → 0050 → set env and fix the origin → deploy → confirm health 200 and a green tick. Reversing migrate and deploy stalls every send (PROD-201). Applying 0049 before R1-2 breaks mailbox connect (DB-203).

---

## Phase 1 — Critical fixes (unsafe sends, integrity, spend)

| # | Task | Findings | Requirements | Files | Depends | Tests required | Acceptance | Effort | Parallel? |
|---|---|---|---|---|---|---|---|---|---|
| R1-1 | Send-time eligibility guard | OUT-201 | Before the lane claim, require: enrollment `active`; campaign `active` and not deleted; opportunity live and not won/lost/archived; org not deleted. Otherwise clear `scheduled_at` and write `wait_reason`/reason. Also clear `scheduled_at` on unsent messages in stop/archive/pipeline/org-delete paths (or as triggers beside 0049's) | `send-message.ts`, `outreach/actions.ts`, `pipeline/actions.ts`, new migration for triggers + `delete_organization` | — | verify-jobs: one case per parent state | A previously approved, deferred message is never sent after any of the seven parent changes | S | yes |
| R1-2 | Mailbox connect survives 0049 | DB-203 | Replace the upsert with update-then-insert, or a `SECURITY DEFINER connect_mailbox` RPC checking `has_org_role`. Keep 0049's revoke | `api/mailboxes/[provider]/callback/route.ts` (+ optional migration) | — | verify-migrations: the callback's write shape as `authenticated`, **without** the harness re-grant | Connect and reconnect succeed after 0049 | S | yes; **must ship before 0049 is applied** |
| R1-3 | Readiness tracks the newest migration; lane rpc missing fails loudly | PROD-201 | Probe the ledger or a `migration_0050_applied()` marker. On 42883/PGRST202 from `claim_contact_lane`, fail the job with a clear error | `lib/schema.ts`, `api/health/route.ts`, `send-message.ts`, `scripts/audit.mjs` | — | audit.mjs check: probe names the newest marker; verify-jobs: lane rpc missing → visible failure | Health is 503 and names the missing migration on a 0047 DB | S | yes; **must ship before deploy** |
| R1-4 | Safety tables are not member-deletable or forgeable | DB-201 | `suppressions` INSERT-only for sessions; `guard_message_integrity` (approver fields = `auth.uid()`, never `sent_at`/`send_attempted_at`/`provider_message_id`); drop session DELETE on `opportunities`, `messages`, `people`, `enrollments`; CHECK on `enrollments.status` | new migration 0051 | read real grants on configured DB first | verify-migrations: member cannot delete a suppression / forge `approved_by` / hard-delete an opportunity | All three refused as `authenticated` | M | yes |
| R1-5 | Atomic credit reservation with the real cost | PROV-201 | Pass per-call credits to `reserve_provider_credit`; log once and fall back only on 42883/PGRST202; fail closed on other errors when a limit is known | `providers/src/budget.ts`, `call.ts`, migration if signature changes | 0050 applied | concurrency test (R5-2) | N parallel calls at cap 1 spend exactly 1 | S | yes |
| R1-6 | Kill switch | PROD-207 | `platform_flags` (or env) read per tick in `send_message`, `runTask`, `callProvider`; global and per org; runbook | jobs, ai, providers, new migration, `docs/operations` | — | verify-jobs: flag off → no send, no AI, no provider call | One switch halts sends without stopping other jobs | S | yes |
| R1-7 | Deploy the branch in the safe order | PROD-001, M1, M3, M4, M6 | Fix the apex TLS or move the site URL to www and register URIs; set secrets; migrate; deploy | outside the repo | R1-2, R1-3 | `live-check` strict-TLS probe | Strict-TLS GET of `siteUrl` succeeds; health 200 on HEAD | S (config) | no; last in phase |

## Phase 2 — Core-flow completion and verification

| # | Task | Findings | Requirements | Files | Depends | Tests | Acceptance | Effort |
|---|---|---|---|---|---|---|---|---|
| R2-1 | Transient refusals defer, not error | OUT-202 | Cadence, caps, quota and config refusals call `defer()` with a per-reason horizon; `error` only for permanent outcomes; optional in-app Retry | `send-message.ts`, `inbox/actions.ts` | 0048 applied | verify-jobs: refusal retried after horizon | Daily-cap refusal sends next day unaided | S |
| R2-2 | First-run tells the truth | ENG-201, ENG-203 | Map `status/stopReason/refusal`; count `discovery_results.outcome='new'`; `skipped` stays skipped; score 2–3 inline, enqueue the rest | `first-run.ts`, `welcome/building/actions.ts` | — | verify-jobs: stageDiscover/score contracts | No keys → "skipped: no provider/AI key" | S |
| R2-3 | Billing decision + operator plan path | MONEY-201 | Decide billing; meanwhile an operator-only plan setter and outreach copy that says Free sends nothing | product decision; admin action | — | — | No customer reaches "approve" without knowing the plan sends 0 | S / L |
| R2-4 | HubSpot idempotent create | CRM-201, CRM-202, CRM-203, TRUST-204 | Check `linkExternal` error; search by `huntloop_evidence_url` before create; PATCH only empty or owned props; propagate removal | `sync-hubspot.ts`, `crm/src/hubspot.ts` | test portal for live proof | crm tests: retry after association failure → one deal | One deal per opportunity under retries | M |
| R2-5 | Import robustness | FLOW-203, FLOW-204, FLOW-206 | Resolve deleted/merged domains to survivors; one RPC or re-attach emails on re-run | `imports/actions.ts` | — | action tests | A CSV with a merged domain imports the rest | M |
| R2-6 | Crash-after-claim shows "delivery unknown" | OUT-203 | Write a delivery-unknown state; sweeper filters `send_attempted_at is null` | `send-message.ts`, `schedule-sends.ts` | — | verify-jobs | Message stops re-enqueuing and shows the state | S |
| R2-7 | Enrichment refusals and verdicts | ENG-202, PROV-202, PROV-204 | Stamp checked-at on refusal; keep a prior bad verdict; mark keys invalid on 401/403 | `enrich-company.ts`, `enrich-person.ts`, `registry.ts` | — | verify-jobs | Refused company not re-enqueued every tick | S |

## Phase 3 — Backend and DB foundation

| # | Task | Findings | Requirements | Effort |
|---|---|---|---|---|
| R3-1 | Last-owner rule in the DB | AUTHZ-201 | Trigger locks owner rows `for update` and refuses the last owner leaving; `delete_own_account` ignores soft-deleted owners | S |
| R3-2 | Seats limit binds | AUTHZ-202 | Count memberships + live invitations in accept/approve | S |
| R3-3 | Status CHECKs | DB-202, FLOW-208 | CHECK on six status columns; legal transitions for opportunity stage | S |
| R3-4 | `people` natural key | DB-205 | Unique key per org (email or external id); upsert in writers | M |
| R3-5 | Erasure completeness | LIFE-201, LIFE-203, CRM-203 | Hash suppression; delete frequency and provider cache rows; private memories; document CRM copies | M |
| R3-6 | Org lifecycle | LIFE-204, FLOW-207 | `has_org_role` checks org live; 30-day purge; invitations revoked on delete | M |
| R3-7 | Retention runs fully | LIFE-202 | Call `purge_expired_research`; page sweeps by id | S |
| R3-8 | API hygiene | API-201, API-202, API-203, API-205 | Uniform magic-link response; expiring digest tokens; generic error text; one result shape | M |
| R3-9 | Gates fail closed | OUT-206, OUT-204 | Check `error` on gate reads → defer; enforce or delete `max_contacts_per_company` | S |

## Phase 4 — Integrations and async workflows

| # | Task | Findings | Requirements | Effort |
|---|---|---|---|---|
| R4-1 | Per-tenant fairness | JOB-202 | Round-robin by org in `claim_job_executions` and sweepers | M |
| R4-2 | Complaints and unthreaded bounces | OUT-208 | Parse `Final-Recipient`; record complaints → suppression | M |
| R4-3 | Remove or replace Inngest | API-204 | Delete the hand-rolled route, or adopt the SDK | S |
| R4-4 | Job key and fencing | JOB-205, JOB-206 | One key spelling; fence completion to the claiming worker | S |
| R4-5 | Grounding | AI-204, TRUST-202, TRUST-203, ENG-205, TRUST-201 | Facts cite fetched URLs only; shared downgrade; hold unreviewed sends with ungrounded figures | M |
| R4-6 | AI cost and provenance | AI-201, AI-202, AI-203, AI-205, AI-206 | Cost ceiling in currency counting failed runs; store model id + observation ids; re-approval on preference change | M |
| R4-7 | Business hours | OUT-209 | Default window for unknown country; zone per contact when known | S |

## Phase 5 — Reliability, tests, monitoring, recovery, DR drill

| # | Task | Findings | Requirements | Effort |
|---|---|---|---|---|
| R5-1 | Route and proxy tests | TEST-201 | Missing tests 1, 2, 7, 8, 10 in `05_VERIFICATION.md` | M |
| R5-2 | Real-Postgres concurrency CI | TEST-202 | Postgres service in CI; racing reserve, lane, claim | M |
| R5-3 | Observability | OBS-201, OBS-202, JOB-203, JOB-204, OBS-203 | JSON `logEvent` with org/job ids; Sentry on permanent failure; deep health; null lag fails; counts-only tick output; operator view | M |
| R5-4 | Deploy pipeline order | PROD-202, PROD-203, ENG-204 | Deploy waits for `verify` + `migrate`; one source of truth per runbook | M |
| R5-5 | DR drill | PROD-206 | Decide PITR; restore once into a scratch project; record RTO/RPO | M |
| R5-6 | Key rotation | SEC-203 | Runbook per key; separate env names for derived secrets; key id prefix | M |
| R5-7 | CSP enforce gate | SEC-201 | Accept Reporting-API bodies; set DSN; then enforce | S |
| R5-8 | Supply chain | SEC-204, SEC-205 | Pin actions by SHA; `permissions:` least privilege; admin-import guard sees `@huntloop/jobs` | S |

## Phase 6 — Scale and optimization (only what measurements justify)

| # | Task | Findings | Requirements | Effort |
|---|---|---|---|---|
| R6-1 | Measure first | PERF-201 | Seeded local DB; time inbox, assignments, claim; `EXPLAIN ANALYZE` | S |
| R6-2 | Bound the loaders | PERF-201 | Limit + cursor; drop `body_text` from lists; `threads(org_id,last_message_at)` index, if R6-1 confirms | S |

## Phase 7 — Product expansion

Billing (MONEY-201 full), a cross-tenant operator console (OBS-203), generated DB types (DEBT-202 root cause) and removal of dead env names (DEBT-203). Sequence these after phases 1–5.

---

## Backlog (one ticket ≈ one PR)

| ID | Title | Phase | Priority | Area | Files | Acceptance criteria | Tests | Effort | Blocked by | Mechanizable check |
|---|---|---|---|---|---|---|---|---|---|---|
| HL-1601 | Send-time parent-state guard | 1 | P0 | outreach | `send-message.ts`, outreach/pipeline actions, migration | No send after stop/pause/archive/won/lost/org delete | verify-jobs ×7 | S | — | test |
| HL-1602 | Mailbox callback write compatible with 0049 | 1 | P1 | db/api | mailbox callback | Connect works as `authenticated` after 0049 | verify-migrations (no re-grant) | S | — | test |
| HL-1603 | Schema probe = newest migration; lane-missing fails | 1 | P1 | prod | `lib/schema.ts`, health, `send-message.ts` | 503 on 0047 DB naming 0050 | audit.mjs + verify-jobs | S | — | audit.mjs |
| HL-1604 | Lock down safety tables (0051) | 1 | P1 | db | migration 0051 | Member cannot delete suppression / forge approver / hard-delete opp | verify-migrations | M | grant read on configured DB | policy lint |
| HL-1605 | Reserve real credit cost; fail closed | 1 | P1 | providers | `budget.ts`, `call.ts` | Cap 1 → 1 spend under N parallel | HL-1621 | S | 0050 applied | test |
| HL-1606 | Kill switch | 1 | P2 | jobs | jobs/ai/providers + migration | One flag halts sends | verify-jobs | S | — | test |
| HL-1607 | Safe-order deploy of pass-15 branch | 1 | P1 | prod | — (ops) | Health 200 on HEAD; strict TLS ok | live-check | S | HL-1602, HL-1603 | live-check |
| HL-1608 | Transient refusals → `defer()` | 2 | P1 | outreach | `send-message.ts`, inbox actions | Cap refusal sends next day | verify-jobs | S | 0048 | test |
| HL-1609 | First-run truthful stages; 2–3 inline scores | 2 | P1 | engine | `first-run.ts` | No-key run says skipped | verify-jobs | S | — | test |
| HL-1610 | Operator plan setter + Free-plan copy | 2 | P1 | money | admin action, outreach UI | Plan changeable without SQL | action test | S | billing decision | no |
| HL-1611 | HubSpot idempotent deal create | 2 | P1 | crm | `sync-hubspot.ts`, `hubspot.ts` | One deal under retry | crm test | M | — | test |
| HL-1612 | HubSpot non-destructive PATCH, stage, removal | 2 | P2 | crm | `hubspot.ts` | Existing props untouched | crm test | M | HL-1611 | test |
| HL-1613 | Import: merged/removed domains; atomic | 2 | P2 | flows | `imports/actions.ts` | Mixed CSV imports | action test | M | — | test |
| HL-1614 | Delivery-unknown state | 2 | P2 | outreach | `send-message.ts`, `schedule-sends.ts` | No re-enqueue after claim crash | verify-jobs | S | — | test |
| HL-1615 | Enrichment refusal stamp, verdict keep, key invalid | 2 | P2 | providers | enrich handlers, registry | No per-tick re-enqueue | verify-jobs | S | — | test |
| HL-1616 | Last-owner trigger; seats count | 3 | P2 | authz | migration, team actions | 0 owners impossible; seats bind | verify-migrations | S | — | test |
| HL-1617 | Status CHECKs; `people` key | 3 | P2/P3 | db | migration | Invalid status refused; no duplicate person | verify-migrations | M | — | test |
| HL-1618 | Erasure + retention + org purge | 3 | P2 | privacy | `erase_contact`, retention, `delete_organization` | No residue in listed tables | verify-migrations | M | — | test |
| HL-1619 | Gates fail closed; per-company cap | 3 | P2 | outreach | `send-message.ts`, `can_contact` | Gate read error → defer | verify-jobs | S | — | test |
| HL-1620 | API hygiene bundle | 3 | P2/P3 | api | auth actions, digest token, `mutate` | Uniform responses, no raw errors | unit | M | — | lint |
| HL-1621 | Real-Postgres concurrency suite in CI | 5 | P2 | tests | `verify-concurrency.ts`, `ci.yml` | Races resolve to one winner | itself | M | — | CI |
| HL-1622 | Route + proxy-production tests | 5 | P2 | tests | `apps/web/test/*` | Missing tests 1,2,7,8,10 pass | itself | M | — | CI |
| HL-1623 | Observability bundle | 5 | P2 | ops | runner, health, `tick.yml` | Failed job → Sentry; health 503 on stale tick | health test | M | DSN set | test |
| HL-1624 | Deploy waits for verify + migrate; doc cleanup | 5 | P2 | prod | workflows, docs | Deploy cannot precede migrate | — | M | — | workflow |
| HL-1625 | DR drill + PITR decision | 5 | P2 | ops | `docs/OPERATIONS.md` | Restore done once, RTO recorded | — | M | Supabase access | no |
| HL-1626 | Key rotation runbook + secret separation | 5 | P2 | security | seal, digest-token, public-research | Rotating one key does not break the others | unit | M | — | no |
| HL-1627 | CSP Reporting-API bodies; enforce | 5 | P2 | security | `csp-report/route.ts`, `csp.ts` | Chromium report recorded | csp-report test | S | DSN set | test |
| HL-1628 | Pin actions by SHA; workflow permissions; guard sees jobs | 5 | P3 | supply chain | `.github/workflows/*`, `check-admin-imports.ts` | No tag pins; `permissions:` everywhere | audit.mjs | S | — | audit.mjs |
| HL-1629 | Tenant fairness in claim | 4 | P2 | jobs | `claim_job_executions`, sweepers | Two-org backlog interleaves | verify-migrations | M | — | test |
| HL-1630 | Complaints + unthreaded bounces | 4 | P2 | outreach | `sync-mailbox.ts` | Complaint suppresses | verify-jobs | M | — | test |
| HL-1631 | Grounding by fetched URL | 4 | P2 | ai/trust | research tasks, `claims.ts`, personalize | Unfetched URL fact → inference | ai tests | M | — | test |
| HL-1632 | AI cost ceiling + provenance | 4 | P2 | ai | `jobs/src/ai.ts`, score handler | Failed billed runs counted; model id stored | ai tests | M | — | test |
| HL-1633 | Remove Inngest route; one research key; completion fencing | 4 | P3 | jobs | inngest route, schedule-followups, queue | — | verify-jobs | S | — | audit.mjs (no Inngest import) |
| HL-1634 | Measure and bound inbox/assignments | 6 | P2 | perf | `lib/data/inbox.ts`, `team.ts` | Measured before and after | timing script | S | — | no |
| HL-1635 | `any` ratchet covers annotations and file-wide disables; dead env names | 7 | P3 | debt | `scripts/audit.mjs`, `.env.example` | Ratchet counts all three | audit.mjs | S | — | audit.mjs |

Every Medium and Low in `03_FINDINGS.md` maps to a ticket above. The low-cost Lows (OUT-209, ENG-205, TRUST-201, AUTHZ-203, DB-204, LIFE-203) are grouped into the nearest ticket in their area.
