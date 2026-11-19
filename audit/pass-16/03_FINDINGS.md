# Pass 16 — findings

Audited `7e09759` (`feat/pass-15-audit-fixes`), 2026-11-14. Method: five read-only reviewers (A flows/api/trust · B db/authz/lifecycle · C engine/providers/ai/crm · D jobs/outreach/money · E security/prod/perf/tests/debt), each writing the full §9 schema to `_raw/reviewer-<X>.md`. Every Critical and High was then re-traced by the lead (log: `_raw/disprove.md`). Reviewer D's P1/P2/P3 map to High/Medium/Low.

**Counts after merging duplicates: Critical 1 · High 9 · Medium 38 · Low 26 (74).**

Merged (same root cause, one finding, every location kept): FLOW-202 → **OUT-201** · FLOW-200 → **DB-203** · FLOW-201 → **PROD-001** · OUT-205 → **PROD-201** · FLOW-205 → **AUTHZ-201** · PROV-203 → **LIFE-201** · MONEY-202 → **AI-201** · OUT-207 → **PROD-207** · SEC-202, JOB-207 → **API-204** · DEBT-201 → **TRUST-204**.

The theme of this pass: **the pass-15 fixes are in the repo but not live.** Migrations 0048–0050 are not applied to the configured database (`_raw/db-doctor.log`), and production still serves `8021d3f`. Four of the ten High-or-worse findings are about the gap between repo, database and deploy (DB-203, PROD-201, PROV-201, PROD-001). They decide what order the next deploy must happen in.

---

## Critical

### [Critical] OUT-201: Stop, pause, archive, close or delete does not stop an approved or deferred email
- Confidence: CONFIRMED. Code trace by reviewers A and D, plus reviewer D's run of `sendMessage` against a fake DB (enrollment `stopped`, campaign `archived`, opportunity `deleted_at` set → provider `send` called once). Re-traced by the lead.
- Where: `packages/jobs/src/handlers/send-message.ts:58-60` (selects message columns and `opportunity_id` only; no read of `enrollments.status`, `campaigns.status/deleted_at`, `opportunities.status/deleted_at` or `organizations.deleted_at` anywhere in the handler); `:609-622` `defer()` keeps `scheduled_at`; `schedule-sends.ts:50-70` re-sweeps by message columns only; `apps/web/app/(app)/[org]/outreach/actions.ts:364-389` (`setEnrollmentStatusAction` → `stopped`, messages untouched), `:110-133` (`deleteCampaignAction`); `pipeline/actions.ts:50` (won/lost/archived, status only); `0031_tenant_write_hardening.sql` `delete_organization` (stops enrollments, leaves `messages.scheduled_at`); `sync-mailbox.ts:131-145` (AI-009 stop, same gap).
- Evidence: `messages.scheduled_at` is the only "go" signal. The only path that clears it on a parent change is 0049's opportunity soft-delete trigger, which is not applied and covers neither stop, pause, archive, won/lost nor org deletion.
- Trace/repro: autonomy-2 campaign drafts a step → `scheduled_at = now`, enqueued → send defers (outside business hours, daily cap → next UTC midnight, bounce pause 6 h, lane busy 15 min) → user presses **Stop** (UI says "Stopped.") or archives the campaign or marks the deal lost → `schedule_sends` re-enqueues after `not_before` → sent. The same happens at autonomy 0–1 for any approved message not yet sent.
- Impact: email goes out after the operator explicitly withdrew it, to a prospect mid-deal, or from a deleted workspace. That is "email sent without consent" under §9. The recipient's own unsubscribe is still honoured (`can_contact` reads suppressions). Not happening today only because production has no driver or keys.
- Root cause: send-time eligibility is derived from the message row alone; parent state changes never propagate to queued mail.
- Fix: one guard in `send_message` before the lane claim. For a message with an enrollment, require enrollment `active`, campaign `active` and not deleted, opportunity live and not won/lost/archived, and org not deleted; otherwise clear `scheduled_at` with a reason. Also clear `scheduled_at` on unsent messages in `setEnrollmentStatusAction(stopped)`, `deleteCampaignAction`, `delete_organization` and the pipeline status action, or as triggers next to 0049's.
- Acceptance criteria: for each of stop, pause, archive, won, lost, archived opportunity and org delete, a previously approved, deferred message is not sent and shows the reason in the inbox.
- Test to add: `packages/jobs/scripts/verify-jobs.ts`, "a stopped enrollment's approved, deferred message is not sent" (one case per parent state).
- Effort: S · Depends on: — · Mechanizable: yes (test)
- Status vs last pass: New. It extends SEC-101, whose fix (0049) covers soft delete only and is not live.

---

## High

### [High] DB-201: Any member can undo safety records through the raw API
- Confidence: CONFIRMED in PGlite (all 50 migrations, `authenticated` role); LIKELY on the configured Supabase until `has_table_privilege('authenticated','public.suppressions','DELETE')` is read there. Re-traced by the lead.
- Where: `packages/db/migrations/0004_outreach_memory_learning.sql:340-355`: `suppressions`, `messages`, `enrollments` (and `opportunities` in 0003) get `tenant_write FOR ALL using has_org_role(org_id,'member')`, unchanged through 0050. No guard trigger on `suppressions`, `messages` or `enrollments`. `can_contact` consults only `is_suppressed` and `suppressions.value_hash`.
- Evidence (reviewer B repro): as a member, `delete from suppressions …` succeeds and `can_contact` then allows the address. `update messages set approved_by = <any uuid, including another tenant's user>` succeeds. `delete from opportunities …` (hard) skips 0049's soft-delete trigger and leaves a scheduled message that `schedule_sends` still picks up.
- Impact: send after unsubscribe (legal), forged approval audit trail, outreach the UI believes stopped. It needs a signed-in member acting outside the UI, so High rather than Critical. It is still the first integrity fix, because the consequence is the P0 class.
- Root cause: generic `FOR ALL` write policies on tables whose rows are safety records.
- Fix (one migration): `suppressions` INSERT-only for sessions; a `guard_message_integrity` trigger, so a session may set `approved_by`/`rejected_by`/`edited_by` only to `auth.uid()` and may never set `sent_at`/`send_attempted_at`/`provider_message_id`; drop session DELETE on `opportunities`, `messages`, `people`, `enrollments` (as 0031 did for `companies`); CHECK on `enrollments.status`.
- Acceptance criteria: as `authenticated`, deleting a suppression, forging `approved_by`, or hard-deleting an opportunity is refused.
- Test to add: `packages/db/scripts/verify-migrations.ts`, "a member cannot delete a suppression / forge approved_by / hard-delete an opportunity".
- Effort: M · Mechanizable: yes (policy lint: no `FOR ALL` on an allow-list of safety tables)
- Status vs last pass: New. It also covers how SEC-101's trigger can be bypassed.

### [High] DB-203: Applying 0049 breaks every mailbox connect and reconnect
- Confidence: CONFIRMED. PGlite repro of the statement PostgREST emits, independently by reviewers A and B. Not live today because 0049 is unapplied; it breaks the moment 0049 is applied.
- Where: `0049_soft_delete_propagation.sql:159-169` (revokes table SELECT on `mailboxes` and re-grants every column except `oauth_token_enc` and `refresh_token_enc`); `apps/web/app/api/mailboxes/[provider]/callback/route.ts:161-163` (session client `.upsert(row, { onConflict: "org_id,email" })` with both token columns in `row`).
- Evidence: plain INSERT works, UPDATE works, the upsert fails with `permission denied for table mailboxes`, even on a first connect. `ON CONFLICT DO UPDATE … excluded.col` needs SELECT on the columns it reads. The test harness re-grants table access after migrations, so the suite cannot see it.
- Impact: no mailbox can be connected, so nothing can be sent. The SEC-102 fix lands as an outage.
- Root cause: the column revoke was not checked against the one writer of those columns.
- Fix: in the callback, `update … where org_id and email`, then `insert` if 0 rows. Or a `SECURITY DEFINER connect_mailbox(…)` RPC that checks `has_org_role`. Keep 0049's revoke. **Must land before 0049 is applied.**
- Acceptance criteria: after 0049, the connect callback stores a new mailbox and refreshes an existing one as `authenticated`.
- Test to add: `verify-migrations.ts`, "after 0049, the callback's write shape succeeds as authenticated", without re-granting table SELECT.
- Effort: S · Mechanizable: yes
- Status vs last pass: New. A regression introduced by the SEC-102 fix.

### [High] PROD-001: The production origin fails TLS; production runs pre-pass-15 code with no keys
- Confidence: CONFIRMED (lead's GETs, `_raw/prod-get.log`, 2026-11-14).
- Where: `https://huntloop.pro` → `SEC_E_WRONG_PRINCIPAL`; `http://huntloop.pro/` 308 → that host; `https://www.huntloop.pro/api/health` → 503, commit `8021d3f`, `siteUrl https://huntloop.pro`, `cronSecret/inngest/credentialEncryption:false`, every integration false. Link builders: `apps/web/lib/site-url.ts:22-33` → `(auth)/actions.ts:80,125` (magic link, Google), `team/actions.ts:327,426` (invites), `send-message.ts:819` (the unsubscribe link in every email), `send-digests.ts:83`, `send-notifications.ts:28`, `sync-hubspot.ts:125`. New this pass: mailbox OAuth builds `redirect_uri` from the request host (www) at `mailboxes/[provider]/start/route.ts:58,114` and `callback/route.ts:61,125`, while emailed links use the apex.
- Impact: dead unsubscribe link in commercial email (legal), dead sign-in and invites, OAuth redirect mismatch. Masked today because nothing runs.
- Root cause: domain cutover half-done; production env not set.
- Fix (outside the repo): attach the apex certificate and 308 www → apex, or set `NEXT_PUBLIC_SITE_URL=https://www.huntloop.pro` and register www URIs. Then set the secrets and deploy HEAD after migrating (see PROD-201).
- Acceptance criteria: a strict-TLS GET of `siteUrl` succeeds; health returns 200 on the deployed HEAD.
- Test to add: `scripts/live-check.ts`, a strict-TLS probe of `siteUrl`.
- Effort: S (config) · Depends on: Vercel/DNS access · Mechanizable: yes
- Status vs last pass: Still open (pass-15 PROD-001), unchanged in 13 days.

### [High] PROD-201: The readiness probe stops at 0047, and HEAD stalls every send silently on a database without 0048–0050
- Confidence: CONFIRMED (code trace by reviewers D and E, re-traced; doctor output).
- Where: `apps/web/lib/schema.ts:38` (`LATEST_TABLE = "message_unsubscribe_tokens"`, 0047; 0050 creates `contact_send_lanes`); `send-message.ts:415-422` (any `claim_contact_lane` error → defer 15 min as "address busy"); `:609-621` (`not_before` 0048, `wait_reason` 0050); `:361-373` (`domain_status` 0048); `apps/web/lib/data/inbox.ts:79-91` (selects `not_before, wait_reason` and throws); `proxy.ts:240-247`; `api/health/route.ts`.
- Evidence: the live health endpoint reports schema "complete" for a database the doctor shows missing 0048–0050. Reviewer D's gate table: lane claim fails closed (every send deferred every tick), `wait_reason` write fails quietly, warm-up, domain check and removed-company stop fail open, and the inbox likely throws.
- Impact: deploy HEAD before migrating and outreach dies silently while the deployment looks healthy. The safety gates added in pass 15 are also off.
- Root cause: schema readiness is a single-table probe that lags the migrations, and deploy is not coupled to migrate (see PROD-202).
- Fix: probe `migration_0050_applied()` or the migration ledger instead of a table. When the lane rpc returns 42883, fail the job with a clear error instead of deferring. Make "apply 0048–0050, then deploy" the runbook's first step.
- Acceptance criteria: on a DB without 0050, health returns 503 naming the missing migration and `send_message` fails visibly.
- Test to add: `scripts/audit.mjs`, "the schema probe names the newest migration's marker".
- Effort: S · Mechanizable: yes
- Status vs last pass: Still open and worse (pass-15 OPS-101/PROD-002 part b).

### [High] OUT-202: A transient send refusal strands the message permanently, while the UI says it "stays queued"
- Confidence: CONFIRMED (code; lead re-checked the sweep filter).
- Where: `send-message.ts:146-158` (`can_contact` `too_soon`/`frequency_cap`/`org_daily_cap`/`unavailable`), `:197-199` (no unsubscribe URL), `:226-228` (no postal address), `:260-266` (over email quota; copy "stays queued and sends when the allowance resets"), `:571-576`. Each writes `error`. `schedule-sends.ts:56` `.is("error", null)` never re-sweeps them; `inbox/actions.ts:294,321` approve refuses already-scheduled rows.
- Impact: approved outreach never leaves and the copy promises the opposite. Combined with MONEY-201, that is every message of every self-serve workspace.
- Root cause: `error` is used for both "permanent" and "try later".
- Fix: transient refusals call `defer()` (`not_before` + `wait_reason`, `error` null) with a horizon per reason. Keep `error` for permanent outcomes. Or add an in-app Retry that clears `error` on unsent, unclaimed messages.
- Acceptance criteria: a message refused for the daily cap is sent on the next day's tick without user action.
- Test to add: `verify-jobs.ts`, "a cadence/cap/quota refusal is retried after its horizon".
- Effort: S · Depends on: 0048 applied · Mechanizable: yes
- Status vs last pass: New.

### [High] ENG-201: The first-run screen reports discovery, enrichment and scoring results that did not happen
- Confidence: CONFIRMED (lead re-traced).
- Where: `packages/jobs/src/first-run.ts:359` reads `run.result.created ?? run.result.companies`; `discover-companies.ts:314-326` returns `{status, stopReason, pages, credits, total, researchEnqueued, refusal?}` with neither field, so the count is always 0. A refusal comes back `ok: true` with `refusal`, so the stage says `done`. `:413-447` (enrich) and `:449-480` (score) count `result.skipped` runs as done.
- Impact: the onboarding surface, the product's first proof of value, states false facts ("Scored 10 companies" with no AI key; "returned nothing new" when the provider refused). The configuration or budget reason the handler produced is hidden. This breaks the pass's own rule, "a failed search must never look like an empty market".
- Root cause: the stage reads a result contract the handler no longer returns, and no test runs `stage*`.
- Fix: map `status`/`stopReason`/`refusal` and the run's count of `discovery_results.outcome='new'`; treat any `result.skipped` as `skipped` with its detail.
- Acceptance criteria: with no provider key, the discover stage reads "skipped/failed: no provider"; with no AI key, the score stage reads "skipped".
- Test to add: `verify-jobs.ts`, "stageDiscover reports a refusal as a refusal and counts new companies".
- Effort: S · Mechanizable: yes
- Status vs last pass: New.

### [High] CRM-201: A HubSpot retry can create a duplicate deal
- Confidence: CONFIRMED in code (lead re-traced); live UNVERIFIED (needs a portal).
- Where: `packages/jobs/src/handlers/sync-hubspot.ts:153-158` (the `external_ids` read ignores its error; null → create path); `:167-172` `createDeal` → `linkExternal` (`:259-265`, upsert error discarded) → `associate` can throw → job retried → no `external_ids` row → second `createDeal`. `packages/crm/src/hubspot.ts:226-236`.
- Impact: duplicate deals in the customer's CRM, deals without associations. This is an external write without idempotency (§9 P1).
- Root cause: the local record of an external create is best-effort and is not checked before re-creating.
- Fix: check `linkExternal`'s error and fail permanently if it cannot record; before `createDeal`, search deals by `huntloop_evidence_url` and adopt a match; associations are `PUT`, so re-running them is safe.
- Acceptance criteria: an association failure followed by a retry leaves exactly one deal.
- Test to add: `packages/crm` tests, "a retry after an association failure does not create a second deal".
- Effort: S–M · Mechanizable: yes
- Status vs last pass: Still open, raised from Medium (pass-15 CRM-002).

### [High] PROV-201: Atomic credit reservation is not live; the configured DB silently uses check-then-call and fails open
- Confidence: CONFIRMED (code; reviewer C's offline probe: four parallel lanes all spend the last credit; doctor: 0050 missing).
- Where: `packages/providers/src/budget.ts:93-99` (any rpc error, including the function being missing, falls back to `budgetAllows`); `:44-56` (allowed when unreadable); `reserved: allowed ? 1 : 0` regardless of cost (a person match costs 2); `call.ts:182-199`; `0050_atomic_spend_and_send_lanes.sql:28-80`.
- Impact: the per-provider monthly cap can be overshot by up to the tick's concurrency, and without limit while the budget read errors. Not P0: the overshoot is bounded and small while reads succeed.
- Root cause: the fallback path is silent and the reservation size is fixed.
- Fix: apply 0050; pass the adapter's per-call credits into `reserve_provider_credit`; log once on 42883/PGRST202 and fail closed on other errors when a limit is known.
- Acceptance criteria: N parallel calls against a cap of 1 spend exactly 1 credit (real Postgres).
- Test to add: concurrency test (see TEST-202).
- Effort: S · Depends on: 0050 applied · Mechanizable: yes
- Status vs last pass: PROV-015 is fixed in the repo but not live.

### [High] MONEY-201: No billing and no in-app plan change; the default Free plan's `emails: 0` blocks all outreach
- Confidence: CONFIRMED (code).
- Where: `0007_profiles_invites_accounting.sql:370-377` (plans seed, default `free`); no writer of `organizations.plan_id` in app code; `send-message.ts:251-267`; `0009_service_role_surface.sql:54-71`.
- Impact: Reach Out is unusable for every self-serve workspace until an operator runs SQL. That is a manual-operations item for every customer.
- Root cause: billing is an open product decision (`docs/status/roadmap.md:92`), and the default plan was set as if billing existed.
- Fix: decision first. Smallest mitigation: an operator-only path to set `plan_id`, and outreach UI that says the Free plan sends nothing before anyone approves a draft.
- Effort: S (mitigation) / L (billing) · Mechanizable: no
- Status vs last pass: First filing of a known gap (pass-15 "Missing: billing").

---

## Medium (38)

Full §9 blocks are in the reviewer file named. Each one-line fix is the reviewer's smallest change.

| ID | Title | Where (primary) | Fix | Effort | File |
|---|---|---|---|---|---|
| FLOW-203 | A CSV with a removed or merged-away domain fails the whole import | `[org]/imports/actions.ts:165-185` | Look up deleted rows too; map merged → survivor; share the helper with analyze-save | S | A |
| FLOW-204 | Import is three non-atomic writes; a retry never attaches dropped emails | `imports/actions.ts:180,313,353` | One `import_rows` RPC, or attach missing emails on re-run | M | A |
| AUTHZ-201 | "Every org keeps an owner" is app-only and races; `delete_own_account` counts soft-deleted owners (+FLOW-205) | `team/actions.ts:85-93,159-164`; `guard_membership_owner` (0047); 0029 `delete_own_account` | Lock owner rows `for update` in the trigger and raise if none would remain; filter `deleted_at` in the count | S | B, A |
| API-201 | Magic-link login tells an unknown address from a known one | `(auth)/actions.ts:82-109` | Map "signups not allowed" to the `sent` state | S | A |
| TRUST-202 | `research_competitor` "facts" accept any source URL | `ai/src/tasks/research-competitor.ts:257-282` | Shared allowed-domain downgrade in `claims.ts` | S | A |
| TRUST-203 | Unreviewed (autonomy ≥ 2) email claims are not checked against cited evidence | `personalize-message.ts:1-19,389-470` | Hold sends whose figures/proper nouns are absent from cited claims; fix the comment | M | A |
| AUTHZ-202 | The seats limit never binds (reads a counter nothing writes) | `team/actions.ts:352-355` → `check_quota('seats')` | Count memberships + live invitations in SQL inside accept/approve | S | B |
| LIFE-201 | Erasure leaves the address and PII in eight places, incl. plaintext suppression, `contact_frequency`, threads, events, provider cache, CRM (+PROV-203) | `erase_contact` (final 0037:693-830); `providers/src/cache.ts` | Hash the suppression, delete frequency/cache rows, document CRM copies | M | B, C |
| LIFE-202 | Anonymous-research retention never runs; retention sweeps cap at 50 orgs with no cursor | `0025:193-215` `purge_expired_research` (no caller) | Call it from `enforce_retention`; page by id | S | B |
| LIFE-204 | Workspace deletion is soft forever; `has_org_role` ignores deleted orgs | `delete_organization` (0031); `has_org_role` | Purge after 30 days; add the org-live check | M | B |
| ENG-202 | Refused company enrichment is re-enqueued every tick and starves others | `schedule-followups.ts:86-110`; `enrich-company.ts:103-109` | Stamp a checked-at on refusal; order nulls first | S | C |
| PROV-202 | Re-enrichment turns a known risky or undeliverable address sendable again | `enrich-person.ts:141-185`; `db/src/contact.ts:693-696` | Keep a prior bad verdict when no fresh one is obtained | S | C |
| AI-201 | AI budget is a run count, fails open in jobs, never counts failed billed runs; provider/plan ceilings likewise (+MONEY-202) | `jobs/src/ai.ts:105-147,170-183`; `providers/src/budget.ts:47-49` | Count every billed run/cost; monthly cost ceiling; align fail-closed with the web side | M | C, D |
| AI-202 | Score provenance stores a date, not the serving model; rescores not reproducible | `score-opportunity.ts:313-323` | Store `run.model` and the observation ids | S | C |
| AI-204 | A "fact" need only cite a URL on an allowed domain, not a page actually fetched | `research-company.ts:232-238,277-288` | Return fetched URLs from `client.run`; downgrade the rest | M | C |
| AI-205 | An approved high-risk learned preference can be rewritten without re-approval | `learn-preferences.ts:144-158` | Re-propose on content change | S | C |
| ENG-203 | First run makes up to ten Opus calls inside one 60 s request | `first-run.ts:449-480`; `welcome/building/actions.ts` | Score 2–3 inline, enqueue the rest | S | C |
| CRM-202 | HubSpot push overwrites existing customer fields; deals have no stage | `crm/src/hubspot.ts:186-236` | PATCH only empty or Huntloop-owned properties; stage from a setting | M | C |
| PROV-204 | A revoked/expired key is never marked invalid by live calls; failures per-org and silent | `providers/src/registry.ts`; 0011 | Mark invalid on 401/403; emit an ops event | S | C |
| ENG-204 | live-check and the runbook disagree with the code (env aliases, ledger path skipped, "free" step may cost) | `scripts/live-check.ts:128,141` | Drop aliases; add a `--spend` check through `callProvider`; fix wording | S | C |
| OUT-203 | A send that crashed after its claim is re-enqueued every tick and never shows "delivery unknown" | `send-message.ts:75-86,498-510`; `schedule-sends.ts:50-59` | Write a delivery-unknown error; filter `send_attempted_at is null` | S | D |
| OUT-204 | `max_contacts_per_company` is documented and enforced nowhere | `outreach-compliance.md`; `can_contact` (0017:116-221) | Enforce in `can_contact`, or delete the column and the claim | S | D |
| OUT-206 | Reply-pending, bounce-rate and autonomy gates fail open when their read fails | `send-message.ts:648-667,691-717,720-730` | Check `error`; defer 15 min | S | D |
| PROD-207 | No kill switch for sends, AI or provider spend, per org or global; no runbook (+OUT-207) | — | `platform_flags` / env read per tick in `send_message`, `runTask`, `callProvider` | S | E, D |
| OUT-208 | Complaints are never recorded; bounce suppression only works on threaded DSNs | `sync-mailbox.ts:286-301,401-412`; enum only in 0004:167 | Parse `Final-Recipient` when unthreaded; record complaints | M | D |
| JOB-202 | No per-tenant fairness; one org can starve all others | `claim_job_executions` (0008:325-327); sweepers | Round-robin by org in claim and sweepers | M | D |
| JOB-203 | A null lag passes `tick.yml`; failed jobs never alert | `tick.yml:63`; `queue.ts:174-178` | Treat null as failure; add failed count and threshold | S | D |
| JOB-204 | Tick reports print recipient addresses into GitHub Actions logs | `tick.yml:57`; `runner.ts:181`; `send-message.ts:552-559` | Print counts only | S | D |
| SEC-201 | CSP report endpoint drops Chromium's Reporting-API bodies and Sentry is off, so the "enforce after a quiet week" gate is blind | `lib/csp.ts:173-176`; `api/csp-report/route.ts` | Accept array bodies; set DSNs | S | E |
| SEC-203 | No key-rotation procedure; the service key is the HKDF root for three other secrets | `lib/ai/seal.ts`; `email/digest-token.ts:4-8`; `public-research.ts:250-262` | Runbook per key; own env names; key id prefix | M | E |
| PROD-202 | Migrations, deploys and CI are unordered | `.github/workflows/migrate.yml`, `ci.yml`; `deployment.md:119-121` | Deploy after `verify` and `migrate` | M | E |
| PROD-203 | Ops docs contradict each other and the code (Vercel Cron "committed", etc.) | `docs/operations/heartbeat.md:70-80`; `tick/route.ts:6` | One source of truth per procedure | S | E |
| PROD-206 | Backups never rehearsed; RPO, RTO and PITR undecided | `docs/OPERATIONS.md:24-25,235-285` | Decide PITR, restore once, record RTO | M | E |
| OBS-201 | Job failures never reach Sentry or alerts; logs carry no org/job id | `jobs/src/runner.ts:184-191` | `logEvent` JSON helper; `captureException` on permanent failure | M | E |
| OBS-202 | `/api/health` is shallow: no tick recency, lag, failures or migration ledger | `api/health/route.ts` | Aggregate RPC; 503 on thresholds | S | E |
| PERF-201 | Inbox and assignments load unbounded nested sets (not measured) | `lib/data/inbox.ts:76-89`; `lib/data/team.ts:113-122` | Limit + cursor; drop `body_text` from list; index | S | E |
| TEST-201 | Route handlers and the production proxy branch are untested | `apps/web/app/api/**`, `proxy.ts` | Route-level tests (missing tests 1, 2, 7, 8, 10) | M | E |
| TEST-202 | Concurrency guarantees (0050 lane, reserve, claim) are proven only sequentially | `verify-migrations.ts` | Real-Postgres CI service with racing connections | M | E |

## Low (26)

| ID | Title | Where | File |
|---|---|---|---|
| FLOW-206 | CSV 1–2 MB fails in the framework, not with the app's message | `lib/validation.ts:328` | A |
| FLOW-207 | Invitations survive workspace deletion and dead-end on 404 | `delete_organization`; `accept_invitation` (0047:743+) | A |
| FLOW-208 | Opportunity stage moves unconstrained; reopening leaves the outcome | `pipeline/actions.ts:25-80` | A |
| API-202 | Digest off-switch token never expires and acts for non-members | `email/digest-token.ts:17-48` | A |
| API-203 | Internal Postgres/provider error text returned to the browser | `lib/data/org.ts` `mutate`; mailbox callback | A |
| API-204 | Inngest route hand-rolled, dead, likely incompatible (+SEC-202, JOB-207) | `api/inngest/route.ts` | A, E, D |
| API-205 | Response shapes differ across actions and routes | `ActionResult` vs bespoke states | A |
| TRUST-201 | Browser-supplied market estimate stored as provider-sourced | `welcome/actions.ts:398-411`; `lib/data/onboarding.ts:688-694` | A |
| TRUST-204 | CRM pushes carry AI text unlabelled and a fake fallback link (+DEBT-201) | `crm/src/hubspot.ts:41`; `sync-hubspot.ts:125` | A, E |
| LIFE-203 | Account deletion leaves the user's private memories | 0029 `delete_own_account` | B |
| DB-202 | Six status columns have no CHECK or transition rule | `enrollments`, `mailboxes`, `job_executions`, `campaigns`, `threads`, `ai_runs` | B |
| DB-205 | `people` has no natural key; two writers can duplicate a person | `rank-contacts.ts:366-410` | B |
| AUTHZ-203 | Minor hardening: mailbox write is member-level vs doc's admin; cookie options; user-reference membership | `mailboxes.tenant_write`; doc | B |
| DB-204 | Security/privacy docs disagree with code (erasure "not in product") | `docs/security/privacy.md` | B |
| AI-203 | Price table and cost recording drift (Sonnet cache-read; fallback models) | `ai/src/models.ts` | C |
| AI-206 | `explain_performance` capped at 900 tokens with adaptive thinking on | `explain-performance.ts:92` | C |
| CRM-203 | HubSpot push ignores removals and erasure | `sync-hubspot.ts:107-110,232-237` | C |
| ENG-205 | Provider-attested firmographics stored as `kind: fact` with a login-gated source | `enrich-company.ts:191-206` | C |
| OUT-209 | Business-hours window skipped for unknown countries; one zone per country | `send-message.ts:380-383`; `business-hours.ts` | D |
| JOB-205 | `research_company` enqueued under two key spellings | `discover-companies.ts:291` vs `schedule-followups.ts:132,158` | D |
| JOB-206 | Job completion not fenced to the claiming worker | `queue.ts:199-209,233-245` | D |
| SEC-204 | Actions pinned by tag; no `permissions:` in any workflow | `.github/workflows/*` | E |
| SEC-205 | Admin-import guard does not see service-role reach through `@huntloop/jobs` | `check-admin-imports.ts` | E |
| DEBT-202 | The `any` ratchet counts only `as any` (101); 94 annotations and 35 file-wide disables uncapped | `scripts/audit.mjs:438-459` | E |
| DEBT-203 | Dead env names in `.env.example` | `.env.example` | E |
| OBS-203 | No cross-tenant operator view; `audit_logs` has no reader | — | E |
