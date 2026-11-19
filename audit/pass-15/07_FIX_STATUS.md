# Pass 15 — fix status

Fixed in the same session, uncommitted. Verified with `npm run verify` (all green: web 284, ai 238, providers 20, db migrations 371, migrator 9, security leads 59, rules 150, jobs 417, crm 81, ui 42, site audit, build, bundle) and Playwright (316 passed, 4 skipped). Not run against a real database or vendor.

| Finding | Status | How |
|---|---|---|
| SEC-101 / FLOW-101 | Fixed | 0049 triggers: company removal soft-deletes its opportunities; opportunity removal stops enrollments and unschedules unsent mail. Backstop in `advance_enrollments`; dashboard filter |
| FLOW-102 | Fixed | 0049: merge moves company evidence to the survivor, retiring duplicates |
| TRUST-101 | Fixed | Detectors reworded; Calendly embed-only; Stripe/Shopify/WordPress as inference; final-host check |
| TRUST-102/103, PROV-016 | Fixed | Board ownership check, posting host check, `event_date` vs `observed_at`, unlisted postings retired |
| PROV-003 | Fixed | `enrich_person` routed through `@huntloop/providers`; direct-fetch module deleted; `scripts/audit.mjs` PROV-003 check |
| AI-009 | Fixed | Unclassifiable reply stops the thread's sequence |
| DB-101 / OUT-010 | Fixed | Cap hit defers to UTC midnight; `pickMailbox` uses the warm-up cap |
| OUT-011 | Fixed | Gate skips approved messages |
| AI-002b | Fixed | Off-domain research "facts" downgraded to inference |
| AI-007 | Fixed (remainder) | Gate rejects foreign email addresses |
| SEC-102, SEC-103, DB-105 | Fixed | 0049: token columns unreadable by sessions; guard trigger on safety columns; function grants |
| DB-102 / FLOW-105 | Fixed | Re-adding a merged domain points to the survivor |
| OPS-101 | Fixed | `migrate.yml` fails without `DATABASE_URL` |
| JOB-010 | Fixed | Deadline hand-back releases without penalty |
| OUT-012 | Fixed | Disconnect only on revoked grant (400/401) |
| JOB-011, DB-104 | Fixed | `prune_job_executions` (daily via retention) + two indexes |
| FLOW-104 | Fixed | Refusals stamp `last_signal_checked_at` |
| UX-001 / UX-002 / PERF-002 | Fixed | Merge confirm step; empty/cap states; removed sides filtered in query |
| AI-011, AI-012 | Fixed | `max_content_tokens` 20k, `max_uses` 5; model-supplied domain must appear in the document |
| CRM `loadEmail` | Fixed | Only sendable, preferring verified |
| preclassify footer | Fixed | Bare "unsubscribe" only in short messages |
| DB-103 | Fixed | Screens show the warm-up cap |
| COMP-001 doc | Fixed | Compliance doc corrected |
| PROV-015 | Fixed (follow-up) | 0050 `reserve_provider_credit` / `settle_provider_credit`; `callProvider` reserves, then settles after the ledger |
| OUT-013 | Fixed (follow-up) | 0050 `claim_contact_lane`: one in-flight message per address; the other defers 15 min |
| FLOW-106 | Fixed (follow-up) | 0050 trigger queues `resolve_entity` + `profile_company` on every company insert or restore |
| AI-010 | Fixed (follow-up) | Client errors carry usage; `runTask` passes tokens and cost to `failed` |
| FLOW-103 | Fixed (follow-up) | Scorer balances observations per family (hiring / site / other); drafts load recent company hiring and site evidence |
| PROV-005 (placeholder) | Fixed (follow-up) | Apollo adapter drops `email_not_unlocked@` addresses. Request shapes still unverified live |
| TRUST-008 | Fixed (follow-up) | Score is `null` until scored; sorts last |
| RT-001 | Fixed (follow-up) | Demo company page derives its opportunity and people from the same fixture as the list |
| FLOW-108 (cost) | Fixed (follow-up) | The prior verdict is read first; a verified address is not re-verified |
| AI-004 | Fixed (follow-up) | `pricedModel` prices the served model; snapshots as their family |
| Raw SDK errors | Fixed (follow-up) | `publicAiError` in every web AI wrapper; original logged server-side |
| OUT-014 | Fixed (follow-up) | 0050 `messages.wait_reason`; inbox shows "Waiting to send" with reason and next try. Address-only reply match kept: it can only hold a send, never release one |
| JOB-012 | Fixed (follow-up) | `tick` claims up to `batches` full batches; `TICK_DEFAULTS` shared by cron and Inngest routes |
| TEST-001 | Fixed (follow-up) | `lib/data/merge-actions.test.ts` (8 cases) |
| DEBT-003 | Triaged | Every cast is an untyped row or shared client surface, with its reason beside it; `audit.mjs` DEBT-003 caps the count at 104 |
| DEBT-001 | Kept by design | Toast is mounted at the root on purpose (layout comment); ActionRail is a design-brief component, tree-shaken |
| PROD-001 | **Open — outside the repo** | Vercel apex certificate or `NEXT_PUBLIC_SITE_URL`; env vars; apply 0048, 0049 and 0050 |
| CRM-002/003/005, MAP-003, PERF-001 | Open | CRM needs a live HubSpot portal; MAP-003 needs a design decision; PERF-001 is covered by `[org]/loading.tsx` for every org page |
| DEBT-002, env aliases | Withdrawn | Proxy blocks kitchen-sink in production; aliases already documented |
