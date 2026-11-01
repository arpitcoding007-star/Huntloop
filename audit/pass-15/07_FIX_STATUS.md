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
| PROD-001 | **Open — outside the repo** | Vercel apex certificate or `NEXT_PUBLIC_SITE_URL`; env vars; apply 0048 and 0049 |
| AI-010, FLOW-103, FLOW-106, PROV-015, OUT-013, PERF-001, CRM-002/003/005, PROV-005, TRUST-008, MAP-003, TEST-001, DEBT-001/003, RT-001 | Open | Follow-ups; several need a live portal or key |
| DEBT-002, env aliases | Withdrawn | Proxy blocks kitchen-sink in production; aliases already documented |
