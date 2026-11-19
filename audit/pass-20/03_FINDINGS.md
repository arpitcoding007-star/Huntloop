# Pass 20 — findings

**Counts: Critical 0 · High 9 · Medium 31 · Low 19 (59).** Commit `32b0c6f`.

Each High was re-opened in Phase 3 and someone tried to disprove it (callers, RLS, `proxy.ts`, later migrations). Two findings were downgraded:

- PANEL-313 went from High to Medium. It is a misleading activation metric, not a lead decision surface.
- PANEL-204 went from High to Medium. It is a wrong count, not a false claim.

The Medium and Low entries are kept short, but each one still cites its code.

Findings are grouped under six root causes (RC-1…RC-6, defined in [00_SUMMARY.md §I](00_SUMMARY.md)).

---

## High

### [High] PANEL-301 — Starting or resuming a campaign never restarts its enrollments (RC-1)
- Confidence: CONFIRMED. I re-read it in Phase 3. No trigger or code anywhere sets `parked` back to `active` on a campaign change; the only un-park is the per-row Resume at `outreach/actions.ts:379`.
- Where:
  - `packages/jobs/src/handlers/advance-enrollments.ts:146-149`
  - `apps/web/app/(app)/[org]/outreach/actions.ts:94` (new campaigns are created as `draft`) and `:76-85` (the update touches `campaigns` only)
  - `packages/db/migrations/0056_fair_claiming.sql:105` (`due_enrollments_fair` selects `status='active'` only)
- Evidence:
  ```ts
  if (!campaign || campaign.status !== "active") {
    await park(scope, enrollmentId, "The campaign is not running.");
    return "stopped";
  }
  ```
- Repro / trace: Create a campaign (it starts as `draft`) → enrol opportunities (the enrol message says "Nothing sends while the campaign is draft — start it from Outreach") → the next tick parks every enrollment → start the campaign → nothing is ever drafted again. Pause and then resume does the same.
- Impact: The documented order (create, enrol, start) yields zero drafts and zero sends. The Reach Out stage looks running and is not. The only workaround is per-row Resume in a list capped at 200.
- Root cause: The parent state ("campaign not running") is written onto child rows, and nothing reverses it.
- Fix: Hold instead of park: push `next_action_at` forward and leave `status='active'`. Or, when `saveCampaignAction` moves a campaign to `active`, re-activate the enrollments whose `parked_reason='The campaign is not running.'`.
- Effort: S · Depends on: — · Mechanizable: yes. Jobs test: enrol into a draft, tick, activate, tick, then expect a draft message.
- Status vs last pass: New

### [High] PANEL-302 — Approved mail refused once is stranded forever, while the copy says it will send later (RC-1)
- Confidence: CONFIRMED. In Phase 3, both sweep paths filter on `m.error is null` (`0056:136,149`; `schedule-sends.ts:57`). The only writer that clears `error` is the success path (`send-message.ts:534`).
- Where: `packages/jobs/src/handlers/send-message.ts:174-180` (cadence/cap through `can_contact`), `:289-296` (email quota), and the unsubscribe-URL and postal-address refusals. `apps/web/app/(app)/[org]/inbox/actions.ts:282` (approve refuses once `scheduled_at` is set).
- Evidence:
  ```ts
  `... The message stays queued and sends when the allowance resets, or when the plan changes.`;
  await scope.update("messages", { error: why }).eq("id", messageId);
  ```
- Repro / trace: Approve while the workspace is over its quota or a cadence cap, or with no postal address. `send_message` writes `error` and spends its 3 attempts within minutes. `schedule_sends` never re-enqueues the message, and Approve refuses it again.
- Impact: Approved outreach silently never sends, even after the quota resets or the setting is fixed. The comment at `schedule-sends.ts:34` says `error` is meant only for problems that "retrying will not fix". The same file already handles the daily allowance correctly, as a deferral (`defer()` at `:466-472`).
- Root cause: Waits that clear on their own are recorded as terminal `error`.
- Fix: Route the quota, cadence, postal-address and unsubscribe-URL refusals through `defer()` with `wait_reason`. Keep `error` for terminal outcomes. Add a "Send again" action that clears `error` on approved, unsent messages.
- Effort: S · Mechanizable: yes. Test: every non-permanent refusal leaves `error` null.
- Status vs last pass: New

### [High] PANEL-201 — Phrase-match competitor links and model paraphrases are shown as facts (RC-3)
- Confidence: CONFIRMED
- Where:
  - Writer: `packages/jobs/src/handlers/resolve-competitor-mentions.ts:271-272`
  - Loader: `apps/web/lib/data/company-intel.ts:86-92` (never selects `claim_kind` or `confidence`)
  - UI: `apps/web/app/(app)/[org]/opportunities/[id]/BriefSections.tsx:118-119`, rendered on the company page and the brief
  - Demand: `sync-mailbox.ts:349-358` → `lib/data/demand.ts:70-73` → `DemandBoard.tsx:162-168`
- Evidence:
  ```ts
  claim_kind: "inference", confidence: signal.relationship === "mentions" ? "low" : "medium",   // writer
  ) : c.hasEvidence ? ( <ClaimBadge kind="fact" />                                              // UI
  ```
- Repro / trace: An article mentions "Outreach", and the company page then shows "Uses Outreach [Fact]". The displacement angle (`company-intel.ts:147-153`) is built on that row. On the Demand board, a statement the model paraphrased from a reply is shown in quotation marks, attributed as if verbatim.
- Impact: A seller acts on a string match as if it were established, which breaks the product's own §7 rule.
- Root cause: The loaders drop `claim_kind`, and the UI derives "fact" from whether an `evidence_id` exists.
- Fix: Select `claim_kind` and `confidence` in `company-intel.ts`, `competitor-intel.ts` and `demand.ts`, and render `ClaimBadge` from them. For inferred statements, drop the quote marks or mark them "paraphrased".
- Effort: S · Mechanizable: yes. Lint: `<ClaimBadge kind="fact"` with a literal kind fails.
- Status vs last pass: New

### [High] PANEL-103 — "Why now" and the outreach angle reach the action queue without an inference label or date (RC-3)
- Confidence: CONFIRMED
- Where: `apps/web/app/(app)/[org]/needs-you/NeedsYouList.tsx:187-191` (also the dashboard rail); `lib/data/needs-you.ts:139,151`; `opportunities/[id]/page.tsx:298` (outreach angle as a bare `<p>`)
- Evidence: `<dt>Why now</dt><dd …>{item.context.whyNow}</dd>`. There is no `ClaimBadge` and no `why_now_written_at`. The detail page uses `Prose inferred writtenAt=…` for the same field.
- Impact: In the queue people act from, model prose reads as fact and can't be dated. This undoes TRUST-301 on the busiest surface.
- Root cause: The context renderer does not reuse the Prose and ClaimBadge convention.
- Fix: Badge it as inference and select `why_now_written_at`. Render the outreach angle through `Prose inferred` with an "unknown" fallback.
- Effort: S · Mechanizable: partly. Test: every `why_now`/`outreach_angle` render site has a badge.
- Status vs last pass: New. TRUST-301 is fixed on the detail page only.

### [High] PANEL-101 — The opportunity Agent saves the canned example as a real, cited answer (RC-2)
- Confidence: CONFIRMED. In Phase 3, `lib/ai/agent.ts:84-89` returns `{ ok: true, source: "unconfigured", answer: example(input) }`, and `opportunities/[id]/actions.ts:174-176` uses `outcome.result.answer` without checking `source`.
- Where: `apps/web/app/(app)/[org]/opportunities/[id]/actions.ts:174-190`
- Evidence: `if (!outcome.ok) return fail(outcome.error); const answer = outcome.result.answer;`. Compare `refreshWhyNowAction` in the same file, which has `if (result.source !== "live") return fail(...)`.
- Repro / trace: Use a live database with no `ANTHROPIC_API_KEY` (or a key that fails over to unconfigured) and ask any question. The fixed advice, citing a real claim, is inserted into `conversation_messages` and replayed as history on every later turn.
- Impact: Invented advice with a real citation is stored permanently on a decision surface.
- Root cause: The "unconfigured" result counts as success, so every caller has to remember to refuse it.
- Fix: Refuse when `source !== "live"`, as `refreshWhyNowAction` does. Better still, make the wrappers return `ok:false` for unconfigured when a caller intends to persist the result.
- Effort: S · Mechanizable: yes. Grep or lint: every caller that persists AI output branches on `result.source` (it would also catch PANEL-406).
- Status vs last pass: New

### [High] PANEL-102 — Contact fit on the opportunity page selects a column that does not exist; ordering by fit is dead on live data (RC-4)
- Confidence: CONFIRMED. In Phase 3, `contact_fit_scores` (0016:94-140) has `reason`, not `explanation`.
- Where: `apps/web/lib/data/opportunities.ts:353-363`; `opportunity-map.ts:603-604`; `opportunities/[id]/page.tsx:312-324`
- Evidence:
  ```ts
  .select("person_id, score, explanation, computed_at")
  ...
  if (error || !data) return fit;
  ```
- Repro / trace: PostgREST returns 42703, which is swallowed, so the map is empty. On a live database every buyer has `fitScore=null`: no "Fit N" badge, no reason, and no ordering by fit. The fixtures carry `fitScore`, so the feature works only in demo.
- Impact: "Who do I contact first", the north-star question, is cut off from `rank_contacts` on the one page built to answer it.
- Root cause: A wrong column name, plus an error swallowed by design. `check:types` checks `types.ts`, not `.select()` strings.
- Fix: Select `reason`. Log the error instead of discarding it.
- Effort: S · Mechanizable: yes. A CI check that parses `.from(t).select("…")` literals against `schema-reference.md` (the subagent's scratch checker found this and PANEL-115).
- Status vs last pass: New

### [High] PANEL-202 — Analyze "Save" blindly upserts, overwriting company provenance and the human-set priority (RC-5)
- Confidence: CONFIRMED (code). Attaching to a removed company is LIKELY; saving a domain whose company was soft-deleted would settle it.
- Where: `apps/web/app/(app)/[org]/analyze/actions.ts:196-231`
- Evidence:
  ```ts
  .upsert({ org_id, canonical_domain, name: q.companyName, website: q.url, discovered_via: "manual" },
          { onConflict: "org_id,canonical_domain" })
  ```
- Repro / trace: Save a URL whose company was found from a competitor's customer list. `discovered_via` changes from `competitor:<id>` to `manual`, so competitor "prospects found" (`competitor-intel.ts:210-214`) and Performance attribution lose it. The opportunity upsert also overwrites `priority` and `priority_reason`, including a human override. `deleted_at` and `merged_into_id` are left alone, so a live opportunity can attach to a removed or merged-away row. `scan-source.ts:301-303` warns against exactly this upsert.
- Impact: Provenance and analytics are corrupted, a human verdict is lost, and opportunities can be orphaned.
- Root cause: An upsert is used where resolve-then-update is needed.
- Fix: Resolve the company (follow `merged_into_id`, restore it if soft-deleted) and insert only when it is missing. Never overwrite `name` or `discovered_via`. On the opportunity, update scoring fields only and keep a human priority.
- Effort: M · Mechanizable: yes. Test: saving over a `competitor:` company leaves `discovered_via` unchanged.
- Status vs last pass: New

### [High] PANEL-203 — CSV import fails outright if any row's domain was ever removed or merged (RC-5)
- Confidence: CONFIRMED. In Phase 3, `unique (org_id, canonical_domain)` is not partial (`0003:44`), and the pre-read filters `.is("deleted_at", null)` (`imports/actions.ts:171`).
- Where: `apps/web/app/(app)/[org]/imports/actions.ts:166-197`
- Evidence: The pre-read skips removed rows, `toInsert` then includes them, the insert hits 23505, and the action returns `The companies could not be imported: duplicate key…`. No row from the file lands. `saveCompanyAction` handles this case (`companies/actions.ts:87-117`); the importer does not.
- Impact: An onboarding entry point breaks permanently after ordinary use (one removed or merged company), and the error message misleads.
- Root cause: A filtered pre-read is paired with an all-or-nothing insert against a non-partial unique key.
- Fix: Read without the `deleted_at` filter. Map merged rows to their survivor and restore soft-deleted ones. Or insert with `ignoreDuplicates`.
- Effort: S · Mechanizable: yes. Test: import over a soft-deleted domain.
- Status vs last pass: New

### [High] PANEL-401 — Deleting (or emptily replacing) the active ICP leaves its paid discovery search running daily (RC-1)
- Confidence: CONFIRMED. In Phase 3, `deleteIcpAction` (`settings/icp/actions.ts:297-314`) only soft-deletes the ICP. `claim_due_discovery_queries` (`0038:20-40`) filters `is_enabled` and `deleted_at` on the query and never joins `icps`. No trigger in any migration disables a query when its ICP is removed.
- Where: the above, plus `packages/jobs/src/first-run.ts:133-139,160-170,216,253` (`retireSuperseded` runs only after a new non-empty query is built) and `discover-companies.ts:121-127` (a missing ICP means no exclusions are applied).
- Repro / trace: (a) Activate an ICP B that has only a name. B's translation is empty, so A's query is never retired, while the UI says "Discovery and scoring now follow it." Removing A, which the UI allows once it is inactive, leaves A's query running. (b) `deleteIcpAction` has no server-side "not active" check, so the active ICP can be deleted directly.
- Impact: Provider credits are spent every day on a profile the user deleted. Exclusions are dropped, and `score_opportunity` skips every result ("no active ICP"). The setting claims to control the engine and doesn't.
- Root cause: Retiring old queries is a side effect of building a new one. Nothing ties a query to its ICP being live.
- Fix: Join `icps` (active, not deleted) in `claim_due_discovery_queries`, or disable an ICP's queries on delete and deactivate. Refuse to delete the active ICP on the server. Check the activate update's row count.
- Effort: S · Mechanizable: yes. DB test: delete an ICP, then `claim_due_discovery_queries` returns none of its queries.
- Status vs last pass: New. It is a regression path of the FLOW-008 fix.

---

## Medium

| ID | Title | Conf. | Where | Evidence / trace | Fix | Eff. | RC |
|---|---|---|---|---|---|---|---|
| PANEL-313 | "Is the loop working?" counts every inbound email (newsletters, out-of-office replies, bounces) as a reply. Reply rate can exceed 100% | CONFIRMED | `0054_…activation.sql:94-97,106-110`; `sync-mailbox.ts:68-98` (stores unmatched inbound mail with `thread_id` null) | `first_reply_at`/`replies_30d` = any `direction='inbound'` message. Disagrees with the Performance funnel. `drafts_rejected_30d` isn't filtered on `ai_generated`, but its denominator is | Count `outcomes.kind in ('reply','positive')`, or inbound mail with `thread_id` not null that isn't classified OOO or bounce | S | RC-3 |
| PANEL-204 | Intelligence headline ratio (Facts / Inferences / Unknown) is computed from the 50-row display list | CONFIRMED | `lib/data/intelligence.ts:70,113-118` | `counts.fact = rows.filter(...)` over `limit(50)`. The "nothing established yet" warning fires whenever the newest 50 rows are all inferences | `count:'exact', head:true` per kind, or a group-by RPC | S | RC-4 |
| PANEL-303 | Withdrawn or failed mail still reads "Queued to send" in the inbox | CONFIRMED | `lib/data/inbox.ts:78-83` (doesn't select `error`); `InboxView.tsx:383-385` | Stop or close writes `error='Not sent: …'`, which the inbox never reads. Stranded mail (PANEL-302) looks the same | Select `error` and render "Not sent: …" | S | RC-1 |
| PANEL-304 | The approval queue offers drafts whose campaign, sequence or opportunity is dead. Approve says "sent on the next run" | CONFIRMED | `lib/data/inbox.ts:297-316`; `inbox/actions.ts:282-318` | `listDrafts` has no parent-state filter. `send_message` withdraws them at send time (`send-message.ts:816-840`) | Filter or label such drafts; refuse them in approve; withdraw drafts when a campaign is archived | M | RC-1 |
| PANEL-305 | Redraft on a non-active enrollment deletes the draft, and no new draft ever comes | CONFIRMED | `inbox/actions.ts:520-552` | The enrollment update has no status guard, the message is soft-deleted, and `due_enrollments_fair` requires `active`. The UI says "appears within a few minutes" | Require an active enrollment and a non-zero row count before deleting | S | RC-1 |
| PANEL-306 | The assistant reads the *oldest* 40 and 60 turns, so recent context and answers drop off after about 30 exchanges | CONFIRMED | `assistant/actions.ts:66-72`; `lib/data/assistant.ts:91-97` | `.order("created_at",{ascending:true}).limit(40)`. The question and answer share a `created_at`, so their order is undefined | Order descending, limit, then reverse; add a tiebreaker | S | RC-4 |
| PANEL-307 | AI reply classification is shown as a bare badge and cannot be corrected, though it drives suppression, sequence stops, opportunity status and learning | CONFIRMED | `InboxView.tsx:226-227`; `sync-mailbox.ts:262-290,395-412` | The confidence sits in `message_events.payload` and is never shown. No relabel action | AI badge plus confidence; a "Wrong label" action that reverses the side-effects | M | RC-3 |
| PANEL-308 | Any member can raise a campaign to autonomous sending, and nothing is audited | CONFIRMED | `outreach/actions.ts:42-90` (default `minRole`) | `autonomy_level` "decides whether messages leave without a human reading them" | Require admin for autonomy ≥2; `recordAudit('campaign.autonomy_changed')` | S | — |
| PANEL-310 | "Run analysis" waits up to an hour while the copy says "next engine tick" | CONFIRMED | `packages/jobs/src/runner.ts:285-290` (`HOURLY` set); `learn/actions.ts` | Requested runs are picked up only by the hourly `schedule_learning` | Use a non-hourly sweeper for requests, or fix the copy | S | — |
| PANEL-311 | The inbox loads every thread with every message and event, unbounded | LIKELY (settle with PostgREST `max_rows`) | `lib/data/inbox.ts:76-89` | No `.limit` or `.range`. PERF-301's indexes fixed the join cost, not the payload size | Page by `last_message_at`; cap embeds; show "N of M" | M | RC-4 |
| PANEL-205 | `company_gaps` is read and rendered on every company and opportunity view, but nothing writes it | CONFIRMED | `lib/data/company-intel.ts:79-85`; `BriefSections.tsx:168-170` | grep finds `company_gaps` only in that loader and in migrations | Emit gaps from `research_company`, or drop them from the loader and the copy | M | RC-6 |
| PANEL-206 | `resolve_entity` runs only after `discover_companies`, so Merge review never sees duplicates from CSV, manual entry, scan, Analyze or competitor customers | CONFIRMED | `discover-companies.ts:298-303` (the only producer) | Debt #1 is wired for one creation path of six | Add a sweeper for companies with no resolve run | M | RC-6 |
| PANEL-207 | "Seen in N sources" counts distinct URLs, not sources | CONFIRMED | `0022_evidence_dedupe.sql:100-103`; `EvidenceList.tsx:112-113` | A summary and the full article from one feed count as 2 sources | Count distinct `coalesce(source_id, host(url))` | S | RC-3 |
| PANEL-208 | Unbounded reads silently truncate at PostgREST `max_rows`: Companies list, per-source evidence and document counts, Demand weights, import person dedupe | LIKELY (settle with `max_rows`) | `lib/data/company.ts:53-58`; `hunt-source.ts:117-123,151-155`; `demand.ts:53,69-75`; `imports/actions.ts:282-289` | No `.limit`, `.range` or `head:true` counts | Paginate; count with `head:true` or an RPC | M | RC-4 |
| PANEL-209 | CSV files of 1–2 MB fail with an opaque framework error, though the form promises 2 MB | LIKELY (post a 1.5 MB CSV) | `lib/validation.ts:328`; `next.config.ts` (no `serverActions.bodySizeLimit`) | Next's default body limit for server actions is 1 MB | Set `bodySizeLimit: '2mb'`, or cap at 1 MB on the client | S | — |
| PANEL-210 | The Competitors list counts removed companies and words inferences as fact ("12 prospects use them"), disagreeing with the detail page | CONFIRMED | `lib/data/competitor-intel.ts:131-136` vs `:266-268`; `CompetitorList.tsx:174-177` | No company `deleted_at` filter on the list | Filter on an inner join; reword or badge | S | RC-3 |
| PANEL-211 | `scan_source` attaches evidence to removed or merged-away companies | CONFIRMED (code) | `scan-source.ts:284-286,306-308` | Looks up by `canonical_domain` with no `deleted_at` filter and no `merged_into_id` follow | Follow `merged_into_id`; skip or restore removed rows | S | RC-5 |
| PANEL-212 | Intelligence evidence rows don't say which company they are about | CONFIRMED | `lib/data/intelligence.ts:80-82` (doesn't select `subject_id`) | "Raised a Series B" with no subject | Select `subject_id`, resolve names, link | S | RC-3 |
| PANEL-402 | The plan seat limit is never enforced | CONFIRMED | `team/actions.ts:352-355`; `lib/data/usage.ts:42-58` | `checkQuota('seats')` reads monthly `usage_counters`, which nothing increments for seats. Join approval and invitation accept never check | A headcount RPC (members plus pending invites), checked in the 3 paths | S | RC-6 |
| PANEL-403 | Ops "share of queue" is always about 100% | CONFIRMED | `0019_ops_views.sql:293-309` (`security_invoker`) | The denominator is RLS-scoped to the viewer's own jobs | A security-definer global count, or drop the banner | S | RC-4 |
| PANEL-404 | The Activity log misses most of what its empty state promises (settings, mailboxes, HubSpot, exports) | CONFIRMED | `settings/activity/page.tsx`; `lib/audit-labels.ts:20-40` | `recordAudit` is called only from team, competitors, outreach and sources. Labels such as `mailbox.connected` and `data.exported` have no emitter | Call `recordAudit` in the admin, settings and integration actions | S | RC-6 |
| PANEL-405 | The Ops board swallows read errors and shows "Nothing has failed" | CONFIRMED | `lib/data/ops.ts:96-168` | `(dead.data ?? [])`; `.error` is never checked | Return an `unreadable` flag per section | S | RC-4 |
| PANEL-406 | With no AI key, "Draft from my ICP" saves template rules into the live database as `origin:'drafted'` | CONFIRMED | `lib/ai/rules.ts:62-67`; `settings/scoring/actions.ts:115-140` | `source:"unconfigured"` is ignored | Refuse to persist when unconfigured | S | RC-2 |
| PANEL-104 | "What changed" (debt #13) resets on any refresh or action, so it vanishes once the user interacts | CONFIRMED | `dashboard/MarkSeen.tsx:15`; `dashboard/page.tsx:101` | The cookie is written on every mount, and actions revalidate the layout | Write it on `pagehide`, or keep a `prev` cookie for the session | S | — |
| PANEL-105 | "Hunt now" (debt #2) promises results when the engine isn't driven or discovery is paused, and queues a full rescore on every click | CONFIRMED (code) | `dashboard/actions.ts:28-37`; `lib/data/engine.ts:300` | `askResearchAction` checks `engineReadiness`; `huntNowAction` doesn't | Check `engineReadiness` and `backlogState` first; no recompute | S | — |
| PANEL-106 | Needs-you, the dashboard and the shell badge treat query errors as "nothing" | CONFIRMED | `packages/db/src/needs-you.ts:464-736`; `lib/data/dashboard.ts:168`; `lib/data/chrome.ts:26` | 11 queries with no `.error` check; `.catch(() => 0)` | Surface errors on the core queries | S | RC-4 |
| PANEL-107 | The Agent panel shows each exchange twice after asking | LIKELY (not run live) | `opportunities/[id]/AgentPanel.tsx:76`; `actions.ts:208` | `[...history, ...added]` plus a revalidated `history` | Reset `added` when `history` changes | S | — |
| PANEL-108 | The Opportunities list caps at 500, and its notice says filtering reaches the rest, which it can't (filters run in the browser) | CONFIRMED | `opportunities/page.tsx:85-86`; `lib/data/opportunities.ts:93-122` | The loader takes no filter params | Server-side filters, or honest copy | M | RC-4 |
| PANEL-109 | Pipeline loads every opportunity unbounded; extras are capped at 2000 with no order | LIKELY | `lib/data/team.ts:113-122`; `lib/data/pipeline.ts:26-31` | — | Bound it, count it, and say when it's truncated | S | RC-4 |
| PANEL-110 | "Work it out again" (why-now) and the Agent ignore company-level evidence, which is where triggers live | LIKELY | `opportunities/[id]/actions.ts:81,379` (`subject_type='opportunity'` only) | Signal writers store `subject_type='company'` (`scan-source.ts:336`, `fetch-company-signals.ts:115,225`, and others) | Reuse `evidenceFor` (both subjects) | S | — |
| PANEL-115 | Settings → You "Is it working?" selects `messages.approved_at`, which doesn't exist, so it always reports 0 on live data | CONFIRMED | `lib/data/personal-learning.ts:367-373,382` | `approved_at` exists only on `scoring_rules` (`0010:71`); the drafts error isn't checked | Use `sent_at`, or add the column | S | RC-4 |

## Low

| ID | Title | Where | Fix |
|---|---|---|---|
| PANEL-309 | An unclassified reply *stops* the sequence, and the copy says "resume from the inbox", which has no such control | `sync-mailbox.ts:129-143`; `OutreachManager.tsx:914` | Park instead of stop, or add Resume for `stopped` |
| PANEL-312 | Approving a learning finding isn't atomic, so a duplicate rule or memory is possible | `learn/actions.ts` (insert, then mark) | Claim first, or add a unique index |
| PANEL-314 | Analytics shows demo spend with no demo banner; the Performance CSV export ignores `source` | `analytics/page.tsx:47`; `performance/export/route.ts:31` | Render `DemoFigures`; flag or refuse the export |
| PANEL-213 | Auto-merges and the merge history are invisible; the merge pair isn't linked; a loser's URL returns 404 | `resolve-entity.ts:137-147`; `company_merges` has no reader | A "Recent merges" list; links; redirect |
| PANEL-214 | `config.discovered_feeds` is written, but nothing offers it | `scan-source.ts:231-238` | Surface it in SourceManager |
| PANEL-215 | Bulk "Scan now" reports one failure and hides the successes | `SourceManager.tsx:158-166` | Report "N queued, M skipped" |
| PANEL-216 | Analyze auto-runs a metered model call from `?url=…&run=1`, so a link can spend a member's AI budget | `analyze/page.tsx`; `Analyzer.tsx:124-127` | A one-time token, or require a click |
| PANEL-217 | Dead paths: `engine.requestResearch` is never called; the sources edit-by-id branch is unused; `resolve_competitor_mentions` isn't run after `research_company` | `lib/data/engine.ts:86`; `sources/actions.ts:62-73` | Delete them or wire them up |
| PANEL-407 | HubSpot reads "not connected" to members (admin-only RLS) | `lib/data/integrations.ts:33-60`; `0028:103-104` | A definer `hubspot_status()` that exposes no token |
| PANEL-408 | The quota message points to a non-existent "Settings → Billing" and is wrong for seats | `lib/data/usage.ts:67-74` | Reword |
| PANEL-409 | Product update and delete report success on 0 rows; a bad id gives a raw 22P02 | `settings/product/actions.ts:105-150` | `.select("id")`; `uuidSchema` |
| PANEL-410 | An active kill-switch pause isn't shown anywhere in the app | `ops/page.tsx`; `send-message.ts:130-135` | `pauseState` banner on Ops |
| PANEL-411 | An unauthenticated PUT to `/api/inngest` makes the server call Inngest's register endpoint | `api/inngest/route.ts` (PUT) | Rate-limit, or require a signature |
| PANEL-111 | The queue names two different people ("Start with A" vs the Reach line naming B) | `lib/data/needs-you.ts:139,151` vs `packages/db/src/needs-you.ts:261,638` | Prefer `primary_person_id` |
| PANEL-112 | Inconsistent dashboard figures: deleted triggers counted; two reply counts; "qualified" counts every status | `lib/data/dashboard.ts:113,221-222`; `page.tsx:488-490` | Filter; one source; reword |
| PANEL-113 | `unsnoozeAttentionAction` has no caller and ignores its delete error | `needs-you/actions.ts:86` | Wire it up or delete it |
| PANEL-114 | The nudge says "You've overruled N" over the whole org's overrides; a dismissed nudge hides the ICP-quality card | `lib/data/nudges.ts:95,131`; `dashboard/page.tsx:600-604` | Filter by user; fall back to the card |
| PANEL-116 | Deal values drop the currency (€25k is stored and summed as the default currency) | `brief-actions.ts:56`; `PipelineBoard.tsx:337-339` | Save the currency; refuse mixed-currency sums |
| PANEL-117 | The shell runs the full Needs-you gather (about 11 queries) on every navigation just for one badge | `lib/data/chrome.ts:26` | A count-only RPC, or a cache |

Each Low is CONFIRMED from code, except PANEL-117, whose cost is UNVERIFIED. All are Effort S except PANEL-117 (M).
