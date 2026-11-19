# Pass 16 — diff against pass 15

Baseline: pass 15 (2026-11-01, `8021d3f` + working tree) and its `07_FIX_STATUS.md`. Each status below was re-checked in code at `7e09759`, not taken from the fix table. Per-area proof is in each reviewer's baseline-diff section (`_raw/reviewer-A.md` §7, B §10, C §8, D §9, E §13).

Vocabulary: **Fixed** (in code and live on the next deploy) · **Fixed, not live** (needs 0048–0050 applied) · **Partly fixed** · **Still open** · **Regressed** · **Obsolete**.

## Headline

Pass 15 fixed most of its findings in the repo. **None of those fixes is live.** Production still serves `8021d3f`, and the configured DB lacks 0048–0050. Two fixes introduce new defects as they land:
- SEC-102's column revoke breaks mailbox connect (**DB-203**).
- 0050 adds a table the readiness probe does not know about (**PROD-201**).

## Pass-15 findings

| Pass-15 ID | Status now | Proof / successor |
|---|---|---|
| PROD-001 | **Still open** (new location: mailbox OAuth uses the request host) | lead's GETs; PROD-001 |
| SEC-101 / FLOW-101 | Fixed, not live; **incomplete** (stop/pause/archive/won/lost/org delete not covered; hard DELETE bypasses the trigger) | 0049:33-117 → **OUT-201**, DB-201 |
| FLOW-102 | Fixed, not live | 0049:86-87 |
| TRUST-101 | Fixed | `profile-company.ts:26-43` |
| TRUST-102 / TRUST-103 / PROV-016 | Fixed | `fetch-company-signals.ts:126-128,199,212,248` |
| PROV-003 | Fixed | `enrich-person.ts:29,80-96`; audit.mjs check |
| AI-009 | Fixed; its queued mail still sends | `sync-mailbox.ts:131-145` → OUT-201 |
| DB-101 / OUT-010 | Fixed, not live (`defer()` needs 0048 `not_before`) | `send-message.ts:426-434` |
| AI-007 | Fixed | gate rejects foreign addresses |
| AI-002b | Fixed for `research_company`; open for `research_competitor`; grounding remainder new | → TRUST-202, AI-204 |
| OUT-011 | Fixed | `send-message.ts:396` |
| SEC-102 | Fixed, not live; **regresses mailbox connect when applied** | 0049:159-169 → **DB-203** |
| SEC-103 | Fixed, not live | 0049 `guard_mailbox_safety` |
| DB-102 / FLOW-105 | Partly fixed: manual add only; import and analyze-save still fail | `companies/actions.ts:89-94` → FLOW-203 |
| DB-105 | Fixed (part in 0049 not live) | catalog grants |
| OPS-101 / PROD-002 (a) `migrate.yml` green with no secret | Fixed | `migrate.yml` `exit 1` |
| OPS-101 / PROD-002 (b) health blind to new migrations | **Still open, worse** | → **PROD-201** |
| JOB-010 | Fixed | `runner.ts:130-136`; test `verify-jobs.ts:587` |
| OUT-012 | Fixed | `mailbox/index.ts:124-136`; test |
| JOB-011 / DB-104 | Fixed, not live | 0049 `prune_job_executions` |
| FLOW-103 | Fixed | `score-opportunity.ts:490-510` |
| FLOW-104 | Fixed (signals); enrichment analogue new | → ENG-202 |
| FLOW-106 | Fixed, not live | 0050:192-220 |
| FLOW-108 | Fixed for good verdicts; bad-verdict downgrade new | → PROV-202 |
| UX-001 / UX-002 / FLOW-107 | Not re-audited (UI out of scope for `/audit-system`) | — |
| TEST-001 | Fixed | `merge-actions.test.ts` |
| AI-004 | Fixed for snapshots; fallback models unpriced | → AI-203 |
| AI-010 | Fixed (ledger); quota side open | → AI-201 |
| AI-011, AI-012 | Fixed | `client.ts`; `extract-signals.ts:299-305` |
| PROV-005 | Placeholder fixed; request shapes still unverified live | `apollo.ts:302` |
| PROV-015 | Fixed, not live; fallback fails open and reserves 1 credit regardless of cost | → **PROV-201** |
| COMP-001 / MAP-101 | Obsolete for the compliance doc; `privacy.md` still stale | → DB-204 |
| PERF-001 | Partly addressed (3 `loading.tsx` / 54 pages, `[org]` covered) | — |
| PERF-002 | Fixed | `merge-candidates.ts:22-25` |
| OUT-013 | Fixed, not live; fails closed while missing | → PROD-201 |
| OUT-014 | Fixed, not live; the inbox select breaks before 0050 | → PROD-201 |
| JOB-012 | Ceiling fixed; Inngest path still dead | → API-204 |
| TRUST-008 | Fixed | `opportunity-map.ts:53,99,353` |
| DB-103 | Likely fixed, not re-verified | `dashboard.ts:318`, `outreach.ts:93` |
| CRM-002 | **Still open, raised to High** | → **CRM-201** |
| CRM-003 / CRM-005 | Still open | → CRM-202 |
| MAP-003 | Still open (not re-traced in depth) | — |
| CRM `loadEmail`, preclassify footer | Fixed (footer not re-checked) | `sync-hubspot.ts:247-257` |
| Raw SDK errors to browser | Fixed for AI; Postgres/provider text still returned | → API-203 |
| DEBT-001 | Obsolete (accepted by design) | — |
| DEBT-002 | Obsolete for prod; reachable on previews (Info) | `proxy.ts:221` |
| DEBT-003 | Partly: `as any` capped at 104; 94 annotations uncapped | → DEBT-202 |
| Env aliases | Obsolete | — |
| (not filed) billing missing | First filing | → MONEY-201 |
| (0019 note) fairness | First filing | → JOB-202 |

**Regressed:** none in behaviour that is live today. **Regressions in waiting** (they appear when the pass-15 migrations are applied): DB-203 (from SEC-102) and PROD-201 (from 0050).

## New in pass 16 (74 after merging)

| Severity | IDs |
|---|---|
| Critical (1) | OUT-201 |
| High (9) | DB-201, DB-203, PROD-001 (carried), PROD-201, OUT-202, ENG-201, CRM-201 (raised from CRM-002), PROV-201, MONEY-201 |
| Medium (38) | FLOW-203, FLOW-204, AUTHZ-201, API-201, TRUST-202, TRUST-203, AUTHZ-202, LIFE-201, LIFE-202, LIFE-204, ENG-202, PROV-202, AI-201, AI-202, AI-204, AI-205, ENG-203, CRM-202, PROV-204, ENG-204, OUT-203, OUT-204, OUT-206, PROD-207, OUT-208, JOB-202, JOB-203, JOB-204, SEC-201, SEC-203, PROD-202, PROD-203, PROD-206, OBS-201, OBS-202, PERF-201, TEST-201, TEST-202 |
| Low (26) | FLOW-206, FLOW-207, FLOW-208, API-202, API-203, API-204, API-205, TRUST-201, TRUST-204, LIFE-203, DB-202, DB-205, AUTHZ-203, DB-204, AI-203, AI-206, CRM-203, ENG-205, OUT-209, JOB-205, JOB-206, SEC-204, SEC-205, DEBT-202, DEBT-203, OBS-203 |

Carried rather than new: PROD-001, CRM-201 (CRM-002), CRM-202 (CRM-003/005), PROV-201 (PROV-015), PROD-201 (PROD-002b), API-204 (JOB-012), DEBT-202 (DEBT-003). The rest are new.

Why pass 16 finds more than pass 15 (74 against 50: Critical 0 · High 11 · Medium 25 · Low 14): it uses a different lens. `/audit-system` adds state machines, invariants, races, partial failure, DR and the manual-ops register, which `/audit` does not cover. The rise in count is not evidence that the code got worse.
