# Pass 21 — raw D: Jobs, Outreach, Money

Commit `dab37db`, branch `feat/pass-21-loop`. Read-only audit. No provider calls, no sends.
Offline run: `npm test -w @huntloop/jobs` → verify-jobs + simulation, **PASS 35/35, exit 0** (no test covers the defects below).

Labels: CONFIRMED = proven by reading code paths end to end (or test); LIKELY = code plus a provider-API behaviour I did not exercise; UNVERIFIED = depends on production state or a doc claim.

---

## Highs I tried to disprove first (held up — not findings)

| Claim checked | Verdict | Evidence |
|---|---|---|
| Two workers claim the same job | Disproved | `0056_fair_claiming.sql:72-85`: UPDATE … WHERE id IN (SELECT … AND status='queued' FOR UPDATE SKIP LOCKED) |
| A dead worker leaves jobs stuck in `running` forever | Disproved | `0008_engine_columns.sql:340-358` requeues after 10 min; `runner.ts:97` calls it every tick |
| Tick endpoint open or compared with timing leak | Disproved | `apps/web/app/api/jobs/tick/route.ts:48-67,107-112` fail-closed 503 when unset, XOR compare (length-only leak) |
| Message sent twice after a crash between provider accept and DB write | Disproved (at-most-once holds) | `send-message.ts:78-89,493-502` conditional claim on `send_attempted_at`; the side effect is OUT-201 below |
| Unsubscribe not honoured across sequences/mailboxes | Disproved | `0047_security_leads.sql:526-555` org-wide suppression + stops every active enrollment; `send-message.ts:162-204` `can_contact` fail-closed before every send |
| One-click POST / prefetch-safe GET missing | Disproved | `api/unsubscribe/[token]/route.ts:44-96`; headers `mailbox/provider.ts:147-148` |
| Footer postal address/unsubscribe optional | Disproved | `send-message.ts:240-283` defers when either is missing |
| Approval bypassable by a session | Disproved | `0051_safety_record_integrity.sql:126-131` trigger: scheduling only by approving as yourself |
| OAuth tokens readable/plain | Disproved | `0049:158-170` column SELECT revoked; `callback/route.ts:141-156` encrypt-or-refuse; revoked grant → disconnect `mailbox/index.ts:122-136` |
| Provider credits race | Disproved | `0050:28-58` advisory lock + reserve |
| Admin sets `plan_id` to NULL (unlimited) | Disproved | `0047:41-45` guard; `0007:376` default 'free' |
| DST/quiet hours wrong | Disproved | `business-hours.ts:58-73` uses `Intl` with IANA zones (unknown country = no hold, by design) |

---

## Findings

### [P1] OUT-201: An unfinished send claim is re-queued on every tick and never shown to anyone
- **Confidence:** CONFIRMED (code read end to end)
- **Where:** `packages/jobs/src/handlers/send-message.ts:78-89`; `packages/db/migrations/0056_fair_claiming.sql:136-153`; `packages/jobs/src/handlers/schedule-sends.ts:93-101`; `apps/web/app/(app)/[org]/inbox/actions.ts:296`
- **Evidence:**
  - `if (message.send_attempted_at) { return { ok:false, permanent:true, error:"Delivery unknown…" } }`: no write to `messages.error` or `not_before`.
  - `due_sends_fair` filters `sent_at is null and error is null`. It has no `send_attempted_at is null` (not redefined after 0056; 0066–0068 only re-grant it).
  - `schedule_sends` re-enqueues `send:<id>`. The earlier job is `failed`, so the idempotency index (queued/running only, `0031:71-73`) lets a new one in.
  - `retrySend` excludes `send_attempted_at is not null`, so the UI offers no way out.
- **Impact:** You get this state whenever an invocation is killed mid-send (JOB-202) or the post-send record write fails (`send-message.ts:551-563`, which also writes no `error`). After that, each tick adds one more failed `send_message` row for each stuck message, forever. The inbox shows the message as approved and pending, not "delivery unknown", so no one checks the Sent folder. Stuck rows are the oldest in their org's lane, so each one also takes a permanent slot in that org's 50-row `due_sends_fair` window. An org with 50 of them sends nothing more.
- **Root cause:** The "delivery unknown" outcome is recorded only on the job row. The sweeper treats `error is null` as "still sendable".
- **Fix (smallest):** In the `send_attempted_at` branch (and the `recordError` branch), write `messages.error = 'Delivery unknown — check the Sent folder…'` with the service role (the 0051 guard only blocks sessions). Add `and m.send_attempted_at is null` to both `due_sends_fair` CTEs (new migration) and to the fallback query in `schedule-sends.ts:51-60`.
- **Acceptance:** A message with `send_attempted_at` set and `sent_at` null is enqueued at most once. Its `error` reads "Delivery unknown". It drops out of `due_sends_fair`.
- **Test to add:** verify-jobs: run the `send_attempted_at` case and assert an `update:messages` with `error` matching /Delivery unknown/. verify-migrations: such a row is not returned by `due_sends_fair`.
- **Effort:** S

### [P1] JOB-202: The runner keeps 20s in reserve, but a model call can take 55s, so late-claimed jobs are killed and take every lane with them
- **Confidence:** CONFIRMED (arithmetic on constants), consequence LIKELY
- **Where:** `packages/jobs/src/runner.ts:79,101,130`; `packages/ai/src/env.ts:42-45`; `apps/web/app/api/jobs/tick/route.ts:45,80`; `apps/web/app/api/inngest/route.ts:170,210`; `packages/jobs/src/registry.ts:13-25` (no deadline in `JobContext`)
- **Evidence:** `reserveMs = 20_000`; deadline = start + 55s; `aiRequestTimeoutMs()` defaults to `55_000`; `maxDuration = 60`. A job is started while `now < deadline - 20s` (35s in). One model call can then run to about 90s, but the platform kills the function at 60s.
- **Impact:** The kill takes down all 4 lanes in the invocation, including any `send_message` inside `provider.send` (→ OUT-201 orphans). Rows stay `running` for 10 minutes. A sweeper (key = its name, `maxAttempts:1`) is blocked for those 10 minutes and then marked failed. AI jobs lose an attempt without any fault of their own.
- **Root cause:** Handlers get no time budget. The reserve is tuned for "report back", not for the longest call a job can make.
- **Fix (smallest):** Add `deadline: Date` to `JobContext` (set in `runOne`). Have `runForOrg` pass `timeout = min(aiRequestTimeoutMs(), deadline - now - 5s)` and throw a retryable error when that is under 5s. Alternatively, raise `reserveMs` to at least the AI timeout plus 5s, but at a 60s cap that leaves almost no claim window, so prefer the budget.
- **Acceptance:** No handler-initiated network call outlives `deadline`. A simulated slow model at t=34s ends as a retryable failure before 60s.
- **Test to add:** simulation: a fake model that sleeps 50s, job claimed at t=34s; assert the tick returns before the deadline and the job is `queued` with backoff.
- **Effort:** M

### [P1] OUT-202: Gmail sync drops inbound mail (replies, opt-outs, bounces) and still reports the inbox as fresh
- **Confidence:** CONFIRMED for the 50-id truncation and the swallowed errors; LIKELY for pagination (Gmail returns `nextPageToken` and the mailbox-current `historyId`)
- **Where:** `packages/jobs/src/mailbox/gmail.ts:198-231` (history), `:269-279` (hydrate); `packages/jobs/src/handlers/sync-mailbox.ts:160-166`
- **Evidence:**
  - `maxResults=100`, `nextPageToken` ignored, `cursor: json.historyId ?? cursor`.
  - `for (const id of ids.slice(0, 50))`: ids beyond 50 are discarded, but the cursor still advances past them.
  - `catch { continue; }`: a 429 or 5xx on one message drops it permanently.
  - `historyTypes=messageAdded` with no `labelId=INBOX`, so our own sent mail uses up the 50 slots (it is skipped later at `sync-mailbox.ts:72`).
  - `last_sync_at` is set unconditionally.
- **Impact:** Mailboxes sending real volume regularly have more than 50 additions between syncs, especially with the 4–8h heartbeat (JOB-201). A dropped reply never stops the sequence. The `repliedSinceLastSend` backstop (`send-message.ts:736-781`) reads stored inbound rows, so it misses it too, and the next step lands on top of the person's answer. A dropped "please remove me" is never suppressed, and dropped bounces under-count `bounceHealth`. `SYNC_FRESH_MINUTES` passes because `last_sync_at` was bumped.
- **Root cause:** The cursor advances to "now" whatever was actually processed.
- **Fix (smallest):** Add `labelId=INBOX`. Follow `nextPageToken`, or stop early and keep the cursor at the last fully processed history id. If hydrate fails or truncates, do not advance the cursor (throw, or return the old cursor). Set `last_sync_at` only when the history is drained.
- **Acceptance:** With 120 messageAdded entries in history, two syncs store all 120. A 429 on one message leaves it fetched on the next run.
- **Test to add:** verify-jobs: stub Gmail history with 2 pages and 70 ids, one hydrate 429; assert every id is eventually stored and `sync_cursor` never passes an unprocessed id.
- **Effort:** M

### [P1] JOB-201: The engine has no working driver in production (heartbeat)
- **Confidence:** UNVERIFIED (doc claim; production not inspected)
- **Where:** `docs/operations/heartbeat.md:11-21`; `.github/workflows/tick.yml:28-30`; `apps/web/vercel.json` (no `crons`); Inngest route present but needs keys (`api/inngest/route.ts:184`)
- **Evidence:** The doc states the engine does not run in production, `CRON_SECRET` is not a GitHub secret, and GitHub fires the schedule only every 4–8h.
- **Impact:** None of the send, sync, unsubscribe-adjacent, or stall-recovery paths run. With a 4–8h cadence, `SYNC_FRESH_MINUTES=30` (`send-message.ts:418-421`) and the 15-minute defers mean sequence steps can keep deferring on `inbox_not_fresh` (LIKELY, depends on in-tick ordering).
- **Fix:** Configure Inngest (code present, signature check looks right) or a paid Vercel cron. Operational, not code.
- **Acceptance:** `/ops` shows `oldestDueSeconds < 900` for 24h.
- **Effort:** S (config)

### [P2] OUT-203: Outlook's first sync walks the whole inbox history and marks the mailbox fresh before reaching new mail
- **Confidence:** LIKELY
- **Where:** `packages/jobs/src/mailbox/outlook.ts:114-135`; `sync-mailbox.ts:105-121,160-166`
- **Evidence:** The initial delta runs over `mailFolders/inbox/messages/delta` with no date filter, `$top=50`, and `cursor = nextLink ?? deltaLink`. Each page's non-preclassified messages each get a `classifyReply` model call. `last_sync_at` is set after every page.
- **Impact:** Connecting a large inbox takes hundreds of syncs to drain, with one model run per old email burning the org's `ai_runs` quota. Meanwhile new replies sit behind the backlog while the freshness gate says the mailbox is current.
- **Root cause:** Same as OUT-202: "synced" is recorded per page, not when the mailbox is caught up. The first sync is unbounded.
- **Fix:** Start the delta with `$filter=receivedDateTime ge {now-7d}` to match Gmail's `newer_than:7d`. Set `last_sync_at` only when a `deltaLink` is returned.
- **Test to add:** Stub 3 nextLink pages; assert `last_sync_at` is unchanged until the deltaLink.
- **Effort:** S

### [P2] OUT-204: Any member can raise a mailbox's daily send cap without limit
- **Confidence:** CONFIRMED (policy and trigger read; not executed)
- **Where:** `0004_outreach_memory_learning.sql:341-353` (`tenant_write FOR ALL` on `mailboxes`, never narrowed); `0049_soft_delete_propagation.sql:126-140` (guard omits `daily_limit`); `0048_mailbox_readiness.sql:54-58`; `0004:29` (no CHECK)
- **Evidence:** The guard blocks `warmup_*`, `domain_*` and `sent_today*` but not `daily_limit`. The cap is `least(daily_limit, warmup_target, 10+5n)`, and when `warmup_started_at` is null it is just `daily_limit`. The org cap `max_sends_per_day` defaults to NULL (`0017:96`).
- **Impact:** A member can `PATCH /rest/v1/mailboxes?id=…` to `daily_limit=100000` and remove the per-mailbox reputation cap: immediately for pre-0048 mailboxes, and after warm-up for the rest (the ramp keeps growing). Only the monthly plan `emails` quota still applies. The same policy also lets members change `status` and hard-delete mailboxes.
- **Fix (smallest):** Add `daily_limit` (and `status`) to `guard_mailbox_safety`, plus `CHECK (daily_limit between 1 and 200)`. Expose an admin-gated RPC if the UI needs to set it.
- **Test to add:** verify-migrations: `expectRejectTx` on an authenticated `update mailboxes set daily_limit = 10000`.
- **Effort:** S

### [P2] OUT-205: "No mailbox has allowance" is a retryable failure, so every approved message turns into a failed job on every tick until midnight
- **Confidence:** CONFIRMED
- **Where:** `packages/jobs/src/handlers/send-message.ts:343-351`
- **Evidence:** `if (!mailboxId) return { ok:false, error:"No connected mailbox has any send allowance left today…" }`. Three attempts are used up in about 5 minutes (`queue.ts:239-252`), the message keeps `error=null`, and `schedule_sends` re-enqueues it. The `claim_mailbox_send` path a few lines further down was already changed to `defer` until UTC midnight (DB-101); this one was missed.
- **Impact:** Floods the failed-job history and `/ops` with false failures (dead-letter noise hides real ones) and wastes queue throughput.
- **Fix:** `return defer(ctx, messageId, nextUtcMidnight, "daily_allowance", …)` (and, if no mailbox is connected at all, a `SETUP_RECHECK_MS` defer).
- **Test to add:** verify-jobs: `pickMailbox` returns null; assert `ok:true`, `deferred:'daily_allowance'`, `not_before` = next UTC midnight.
- **Effort:** S

### [P2] JOB-203: `advance_enrollments` drafts 5 enrollments for the whole platform per tick, one after another, inside one sweeper job
- **Confidence:** LIKELY
- **Where:** `packages/jobs/src/handlers/advance-enrollments.ts:53,70-72,93-110,583`; `runner.ts:219-224`
- **Evidence:** `MAX_PER_TICK = 5`. `advanceOne` runs in a loop inside the single org-less sweeper, each iteration making a `personalizeMessage` model call (up to 55s).
- **Impact:** A platform-wide ceiling of 5 sequence steps per tick (1,440 a day at 5-minute ticks; about 20 a day on the current GitHub cadence), shared by all tenants. A single slow call pushes the sweeper into JOB-202 kills, and the `advance_enrollments` key stays blocked while the row is stuck `running`.
- **Root cause:** Per-enrollment work (with model calls) runs in the fan-out job instead of being fanned out the way `schedule_sends` → `send_message` is.
- **Fix:** Add an `advance_enrollment` job (key `advance:<id>`, org-scoped) and have the sweeper only enqueue (MAX ~100).
- **Effort:** M

### [P3] MONEY-201: Email and AI quotas are checked first and charged after, they fail open, and failed AI runs are not counted
- **Confidence:** CONFIRMED (bounded overshoot)
- **Where:** `send-message.ts:294-310` then `:582-586`; `packages/jobs/src/ai.ts` (`withinBudget` → `runTask` → `increment_usage_internal`); `apps/web/lib/ai/intake.ts:50-62` (same shape); `0009_service_role_surface.sql:54-71`
- **Evidence:** `check_quota_internal` is a STABLE read. The increment happens only after success, and errors are ignored.
- **Impact:** Overshoot is bounded by the number of in-flight lanes (4 per invocation × concurrent ticks) plus every failed but token-spending run. That is not unbounded spend: provider credits are atomic, and the request path also has `consume_rate_limit` and the kill switch. Still, the documented "limits the product enforces" are approximate.
- **Fix:** A `reserve_usage(p_org, p_metric)` that increments under the same check (as `reserve_provider_credit`). Refund on a definite refusal; count failed AI runs that reported spend.
- **Effort:** S–M

---

## Job inventory

| Job | Enqueued by | Handler | Idempotent? | Retry policy |
|---|---|---|---|---|
| schedule_* (scans, syncs, sends, discovery, signal_fetches, followups, recomputes, demand, preferences, matching, learning), enforce_retention, send_notifications, send_digests, create_intro_opportunities, send_exchange_notifications, advance_enrollments | `sweep()` each tick (`runner.ts:345-373`); hourly/daily keys checked in any status | yes | key = name (or name:hour/day); collapse while queued/running | `maxAttempts:1`; a stall → failed after 10 min |
| send_message | advance_enrollments (inline, autonomy ≥2), schedule_sends | yes | `send:<id>` + `send_attempted_at` claim (at-most-once) | 3, backoff n² min; ambiguous → permanent (see OUT-201) |
| sync_mailbox | schedule_syncs (15 min) | yes | `sync:<mailbox>`; per-message `provider_message_id` dedupe | 3 (cursor issue OUT-202) |
| check_mailbox_domain | schedule_syncs (daily) | yes | `domain:<mailbox>` | 3 |
| scan_source | schedule_scans | yes | key per source | 3, permanent for bad URL |
| research_company / score_opportunity / resolve_competitor_mentions | discovery, followups, scan, research | yes | keyed per entity | 3 |
| discover_companies | schedule_discovery | yes | claim advances `next_run_at` | 3 |
| enrich_company / rank_contacts / enrich_person / sync_hubspot / research_competitor / prospect_competitor_customers | schedule_followups, rank_contacts | yes | markers + keys; provider credits reserved | 3 |
| resolve_entity / profile_company | DB trigger `enqueue_company_followups` (`0050:192-212`) | yes | `resolve:company:<id>`, `profile:<id>` | 3 |
| recompute_scores | schedule_recomputes, self | yes | one live request per profile | 3 |
| fetch_company_signals | schedule_signal_fetches | yes | 48h staleness | 3 |
| analyze_performance | schedule_learning | yes | weekly per org | 3 |
| cluster_demand / learn_preferences / match_needs | their schedulers | yes | staleness rules | 3 |
| purge_contact_data | **nobody**: erasure runs inline via `erase_contact_for_org` (`settings/privacy/actions.ts:53`) | yes (dead) | n/a | n/a |

Inngest: route and signature are implemented (`api/inngest/route.ts`, `lib/inngest.ts:80-115`); it is live only when `INNGEST_*` is set (UNVERIFIED in production). Signed requests can be replayed within the 5-minute window with no nonce, which is harmless because a tick is idempotent.
