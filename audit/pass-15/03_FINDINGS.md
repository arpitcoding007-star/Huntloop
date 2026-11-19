# Pass 15 — findings

Audited: `main` @ `8021d3f` plus this session's uncommitted working tree (2026-11-01). Method: five parallel read-only reviewers, a runtime demo walk, read-only production GETs, then Phase 3 re-checks of every High (two re-traced by hand: FLOW-102 against `merge_companies` in `0012_entity_identity.sql`, and SEC-101 against `advance-enrollments.ts:62-151`).

Severity counts: **Critical 0 · High 11 · Medium 25 · Low 14**. Production's TLS failure (PROD-001) would be Critical once keys are set; today nothing is sent, so it is High.

Findings that share a root cause are grouped under one heading, with every place it shows up.

---

## High

### [High] PROD-001 — Production's canonical origin fails TLS; the engine has no driver and no keys
- Confidence: CONFIRMED (read-only GETs, see R_RUNTIME.md)
- Where: `https://huntloop.pro` (apex) → `SEC_E_WRONG_PRINCIPAL`; `https://www.huntloop.pro/api/health` → 503, `siteUrl: https://huntloop.pro`, `cronSecret:false`, `credentialEncryption:false`, every integration false
- Impact: every absolute link the app builds (magic-link redirect, OAuth callbacks, unsubscribe and one-click links) points at an origin browsers reject. Nothing runs or sends.
- Root cause: domain cutover half done; apex has no certificate; env not set.
- Fix (config, outside the repo): attach a certificate to the apex in Vercel (or set `NEXT_PUBLIC_SITE_URL=https://www.huntloop.pro`); set `CRON_SECRET`, `MAILBOX_ENCRYPTION_KEY`, provider keys, and `HUNTLOOP_URL` in GitHub.
- Effort S · Depends on: Vercel/DNS access · Mechanizable: yes — a strict-TLS curl of `siteUrl` in the health check
- Status: Still open (AUDIT.md B-01/B-02), worse than the domain doc records

### [High] SEC-101 / FLOW-101 — Removing or merging a company does not stop its outreach
- Confidence: CONFIRMED (code trace; not run against a live DB)
- Where: `apps/web/app/(app)/[org]/companies/actions.ts` `deleteCompanyAction` (sets `companies.deleted_at` only); `0012` `merge_companies` (soft-deletes the colliding loser opportunity); `packages/jobs/src/handlers/advance-enrollments.ts:62-70,120-151` (filters `enrollments.status='active'`, checks `opportunity.status`, never `opportunities.deleted_at` or the company); `send-message.ts` (checks `messages.deleted_at` only); `lib/data/dashboard.ts:202-219` and `lib/data/opportunities.ts:202` (no company filter)
- Repro: enrol an opportunity → remove its company (or merge it so its opportunity collides) → the enrollment stays active and the next step is drafted and sent.
- Impact: email to a company the user removed — the "email without consent" class. Removed companies still appear on the dashboard and detail URL.
- Root cause: soft delete is applied to one row and nothing propagates to enrollments or queued messages.
- Fix: a database trigger: when an opportunity is soft-deleted, stop its active enrollments and unschedule its unsent messages; delete-company soft-deletes its opportunities; backstop guards in `advance_enrollments` and `send_message`; company filter on the dashboard and detail loaders.
- Effort S–M · Mechanizable: yes — migration test: deleting an opportunity leaves no active enrollment
- Status: New (extends this session's hide-removed-companies work)

### [High] FLOW-102 — Merging companies leaves the loser's evidence behind
- Confidence: CONFIRMED (`merge_companies` in `0012` moves domains, external ids, people, problems, gaps, triggers, source events and opportunities; no statement touches `evidence`)
- Impact: the survivor loses all enrichment, research, hiring and site evidence of the merged-away row; the evidence panel and scorer read by `subject_id`. The merge-review UI says "moves everything onto it". Same for automatic `high` merges in `resolve_entity`.
- Fix: move `evidence` (subject_type `company`) to the winner on merge, dropping rows that would collide on `evidence_live_source_key_uidx`.
- Effort M · Mechanizable: yes — migration test
- Status: New

### [High] TRUST-101 — Homepage detectors store weak signals as first-party facts
- Confidence: CONFIRMED (regexes in `packages/jobs/src/handlers/profile-company.ts:24-40`)
- Evidence: `calendly` matches any hyperlink to calendly.com; `stripe` claims "Takes payments" from `js.stripe.com/v3` (also loaded for fraud detection); `shopify` claims "Sells through a Shopify store" from CDN assets; `wordpress` matches any `/wp-content/` URL; no check that the final URL is still the company's domain.
- Impact: guesses written as `fact / high / first_party`, counted in fact badges and fed to the qualifier.
- Fix: embed-only patterns for Calendly; reword Stripe/Shopify to what was observed; final-host check; `inference` for ambiguous detectors.
- Effort S · Mechanizable: yes — fixture test per detector
- Status: New (P2-4 this session)

### [High] TRUST-102 / TRUST-103 / PROV-016 — Job-board postings: ownership unchecked, never expire, wrong timestamp
- Confidence: CONFIRMED (code) / LIKELY (ownership)
- Where: `packages/jobs/src/ats.ts:35-45`; `fetch-company-signals.ts` `boardSignals` and the Apollo path
- Evidence: any board linked from `/careers`, `/jobs` or `/` is written as "on its own … job board", `fact / high / first_party`; `observed_at` is set to the posting date; postings no longer listed are never removed.
- Impact: another company's openings and filled roles count as live hiring signals.
- Fix: keep a board as first-party only when its slug resembles the company's domain label or name, else store as inference "linked from its site"; `event_date` = posting date, `observed_at` = fetch time; soft-delete previous postings from that board absent in the latest fetch.
- Effort S–M · Mechanizable: yes
- Status: New (P2-5 this session)

### [High] PROV-003 — `enrich_person` is now wired and bypasses the provider seam
- Confidence: CONFIRMED
- Where: `rank-contacts.ts` (new enqueue); `enrich-person.ts:30`; `packages/jobs/src/providers.ts` (raw `fetch` to Apollo, Hunter, ZeroBounce)
- Impact: paid lookups with no cache, budget, breaker or ledger; invisible to spend screens; vendor chosen by key shape.
- Fix: stop enqueuing until it goes through `@huntloop/providers`, or route it through `callProvider`.
- Effort S (unwire) / M (rewire) · Mechanizable: yes — no `fetch(` to vendor hosts outside `packages/providers`
- Status: Regressed (pass-14 PROV-003 left it deliberately unwired)

### [High] AI-009 — A failed reply classification never stops the sequence
- Confidence: CONFIRMED (code)
- Where: `packages/jobs/src/handlers/sync-mailbox.ts:107-125` (non-`AiUnavailable` errors swallowed, cursor advanced); enrollments stopped only in `applyClassification`
- Impact: one timeout or refusal leaves a human reply unclassified for good. Partly mitigated by this session's send-time check (`repliedSinceLastSend`), which holds any step to an address that wrote back — but only for the same address.
- Fix: when classification fails for any reason and the reply is on a thread with an opportunity, stop its active enrollments with the reason.
- Effort S · Mechanizable: yes — scripted client that throws
- Status: New

### [High] DB-101 / OUT-010 — Warm-up cap hit fails the send and churns the queue
- Confidence: CONFIRMED (code; needs 0048 applied)
- Where: `send-message.ts` claim failure returns a retryable error; `mailbox/index.ts` `pickMailbox` ranks by raw `daily_limit - sent_today`
- Impact: a warming mailbox is picked over a warm one, the send fails three times, `schedule_sends` re-enqueues it every tick; "sent tomorrow" is untrue.
- Fix: defer to next UTC midnight on claim failure; `pickMailbox` uses `mailbox_remaining_today` (fallback on 42883).
- Effort S · Mechanizable: yes
- Status: New (0048 this session)

### [High] AI-007 — Model-written links reach unreviewed email at autonomy ≥ 2
- Confidence: LIKELY → **mitigated this session**: the pre-send gate (`packages/jobs/src/gate.ts`) rejects links outside the sender's, recipient's and org's domains and unfilled placeholders at autonomy ≥ 2. Email addresses and phone numbers are not checked.
- Fix remaining: add foreign email-address detection to the gate.
- Status: Still open (pass-14 AI-007), partly fixed

### [High] AI-002b — `research_company` facts accept any source URL
- Confidence: CONFIRMED (`claims.ts:76-82` requires only a non-empty `sourceUrl`; only `qualify_opportunity` checks the domain)
- Fix: apply qualify's domain check to research facts.
- Effort S · Status: Still open (pass-14 AI-002, research half)

### [High] OUT-011 — A person's approval cannot release a message held by the content gate
- Confidence: CONFIRMED (code)
- Where: `send-message.ts` step 3g runs on autonomy ≥ 2 regardless of `approved_by`
- Impact: false positives loop forever; the reasons are cleared on approve.
- Fix: run the gate only when nobody approved the message.
- Effort S · Status: New

---

## Medium

| ID | Title | Where | Fix |
|---|---|---|---|
| SEC-102 | Mailbox OAuth ciphertext readable by every member incl. viewers | `0004` `tenant_read` on `mailboxes` | Column-level revoke of `oauth_token_enc`, `refresh_token_enc` from `authenticated` (check loaders select explicit columns) |
| SEC-103 | Members can rewrite send-safety columns (warm-up, domain status, counters) | `0004` `tenant_write` on `mailboxes`; 0048 | Guard trigger blocking session writes to those columns |
| DB-102 / FLOW-105 | Re-adding a merged-away domain restores an empty ghost with `merged_into_id` | `companies/actions.ts` restore | Refuse restore of merged rows and name the survivor |
| OPS-101 / PROD-002 | `migrate.yml` green when it applied nothing; health can't see column-only migrations | `.github/workflows/migrate.yml:42` | `exit 1` without the secret |
| JOB-010 | A job handed back at the deadline burns an attempt and can fail without running | `runner.ts` deadline branch | Release without penalty |
| OUT-012 | Any token-refresh failure disconnects the mailbox permanently | `mailbox/index.ts:~139` | Disconnect only on 400/401 (`invalid_grant`) |
| JOB-011 | `job_executions` never pruned; sweep's key lookup unindexed | runner `sweep()`, 0004/0008 | Daily prune of finished rows > 30 days; index `(job_name, idempotency_key)` |
| FLOW-103 | New hiring/site evidence barely reaches the scorer, never the draft | `score-opportunity.ts:468`; `advance-enrollments.ts:570` | Set `event_date`; per-kind cap in observations (follow-up) |
| FLOW-104 | Refused signal fetches keep the company at the head of the queue | `fetch-company-signals.ts` refusal branch | Stamp `last_signal_checked_at` on refusal |
| FLOW-106 | Identity resolution and site profiling only for discovery-created companies | `scan-source.ts`, imports, manual add, analyze | Enqueue on every create path (follow-up) |
| UX-001 / FLOW-107 | Merge is one click, no confirm, no undo | `MergeReview.tsx:60-82` | Explicit confirm step naming what moves |
| UX-002 | Merge panel shows "0 pairs"; 50-row cap unexplained; removed sides filtered client-side | `MergeReview.tsx`, `merge-candidates.ts` | Hide when empty, note cap |
| TEST-001 | Merge actions untested; panel invisible to E2E | — | Action tests with a fake db |
| AI-010 | Failed model runs record no tokens or cost | `task.ts:98`, `runs.ts` | Carry usage on errors (follow-up) |
| AI-011 | `web_fetch` has no `max_content_tokens`; continuations re-bill context | `client.ts:86-92` | Set `max_content_tokens`, lower `max_uses` |
| AI-012 | `extract_signals` trusts the model's `companyDomain` | `extract-signals.ts:299` | Require the domain label in the document text |
| PROV-005 | Apollo request shapes unverified; adapter emits placeholder emails | `adapters/apollo.ts` | Filter placeholders in adapter; verify live |
| PROV-015 | Provider budget is check-then-call and fails open | `call.ts`, `budget.ts` | Atomic reserve (follow-up) |
| CRM-002/003/005 | Duplicate deals on retry; no `dealstage`; PATCH overwrites customer data; `loadEmail` can push placeholders | `sync-hubspot.ts`, `hubspot.ts` | Filter `loadEmail`; rest needs a live portal |
| COMP-001 / MAP-101 | `purge_contact_data` has no producer; compliance doc stale | `purge-contact-data.ts`, `docs/security/outreach-compliance.md` | Erasure is served by `erase_contact_for_org`; correct the doc |
| PERF-001 | 3 `loading.tsx` for 54 pages | `apps/web/app` | Add route skeletons (follow-up) |
| OUT-013 | `can_contact` → `record_contact_send` not atomic; parallel lanes | `send-message.ts` | Per-address lock (follow-up) |
| TRUST-008 | Unscored shown as 0 | `opportunity-map.ts:478,639` | Still open from pass 14 |
| MAP-003 | No writer for `competitors` from discovery | — | Still open from pass 14 |
| DB-103 | UI shows `daily_limit`, not the warm-up cap | `dashboard.ts:314`, `outreach.ts:90` | Read the cap |

## Low

DB-104 (`schedule_sends` index doesn't cover `error`/`not_before`), DB-105 (grants on rewritten functions), OUT-014 (reply match by address only; deferrals leave no UI trace), JOB-012 (12 jobs/tick ceiling; Inngest dead path), DEBT-001 (Toast/ActionRail unused), DEBT-002 (kitchen-sink relies on proxy only), DEBT-003 (128 `as any`/suppressions untriaged), RT-001 (demo fixtures disagree: list "1 open", detail "Not qualified yet"), preclassify `\bunsubscribe\b` matches auto-reply footers, cost attributed to routed not served model (AI-004), raw SDK errors returned to the browser, legacy env aliases undocumented, PERF-002 (merge loader filters client-side), FLOW-108 (`enrich_person` can downgrade a verified address).
