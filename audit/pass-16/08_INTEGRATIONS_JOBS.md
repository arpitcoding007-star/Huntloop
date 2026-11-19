# Pass 16 — integrations, AI and jobs

## Headline
- **No external integration is live.** Production health reports every integration false. Every adapter is proven only against scripted fakes, and Apollo request shapes have never been seen by the real API (PROV-005).
- The provider seam (cache → budget → retry with jitter → ledger) is sound in code. The budget's atomic half (0050) is not live, and its fallback fails open (PROV-201).
- **The queue claims with `for update skip locked`**, with stall requeue, deadline hand-back and dead-letter rows. It has no per-tenant fairness (JOB-202), and failed jobs never alert (JOB-203, OBS-201). Inngest is dead and probably incompatible (API-204).
- **HubSpot is push-only**, with no inbound sync or webhooks. A retry can duplicate a deal (CRM-201), and pushes overwrite customer fields (CRM-202).

## External-integration inventory

| Service | Purpose | Where | Auth | Env names | Data out | Webhooks | Errors | Retry | Rate limit | Timeout | Cache key / TTL | Live status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Apollo | company search/enrich, people search/match, job postings | `packages/providers/src/adapters/apollo.ts` | `x-api-key` header (`:190-198`) | `APOLLO_API_KEY` | ICP filters, domains, person names | none | 429 → `rateLimited`; 401/403 non-retryable; 5xx retryable; other 4xx non-retryable (`:151-184`) | 3 attempts, exp. backoff + jitter (`call.ts:56-62`) | none client-side; breaker 5 fails → 2 min, **per org** (`0011:290-310`) | 15 s per attempt | `sha256(capability provider canonicalJSON)` per org; search 24 h, enrich 30 d, person.search 7 d, match 30 d, signals 48 h (`cache.ts`) | **Not live**: prod health says every integration false; request shapes never seen by the real API (PROV-005) |
| Hunter | person match | `adapters/hunter.ts` | query key | `ENRICHMENT_API_KEY` | name + domain | none | same classify pattern | same | same | 15 s | person.match 30 d | not live |
| ZeroBounce | email verify | `adapters/zerobounce.ts` | query key | `EMAIL_VERIFICATION_API_KEY` | email address | none | same | same | same | 15 s | email.verify 90 d (not cached when `unknown`) | not live |
| Anthropic | 16 AI tasks | `packages/ai/src/client.ts` | API key | `ANTHROPIC_API_KEY`, `HUNTLOOP_AI_TIMEOUT_MS` | prompts incl. scraped pages, reply bodies, names (see §3) | none | refusal → `ModelRefusalError`; `max_tokens` → error; invalid JSON → error | SDK `maxRetries: 0`; queue retries job (3) | none app-side | 55 s default (`env.ts:42-45`) | prompt cache on system block | not live in prod (`inngest:false`, no key) |
| HubSpot | push company/contact/deal, read stage | `packages/crm/src/hubspot.ts` | private-app bearer token, encrypted at rest | `MAILBOX_ENCRYPTION_KEY` (shared cipher; name per health check) | company name/domain/industry/size, contact email/name/title, score, why-now, app URL | none (no inbound) | 429 retryable; 401/403 permanent; 5xx retryable; 4xx permanent (`:74-91`) | queue retries only | none | 15 s | none | not live; CRM-002/003/005 need a portal |
| Public ATS (Greenhouse, Lever, Ashby, Workable) | job postings | `packages/jobs/src/ats.ts:55-64` via `fetch.ts` | none | none | board slug | none | handled in handler | queue | none | per `fetch.ts` | none | unverified live |
| Company websites | profile, research fetch | `profile-company.ts`, `fetch.ts`, Anthropic `web_fetch` | none | none | URL | none | refusal stamps (FLOW-104) | queue | none | per fetch | none | unverified live |

## Engine stage map

Rule = deterministic code; Model = Claude task via `runForOrg` (`packages/jobs/src/ai.ts:122`); Provider = `@huntloop/providers` (`callProvider`). Sweepers run on **every tick** unless listed HOURLY/DAILY (`packages/jobs/src/runner.ts:219-306`).

| Stage | Handler | Enqueued by | Inputs | Rule / Model / Provider | Tables written | Test (runs it) |
|---|---|---|---|---|---|---|
| Discover (provider) | `discover-companies.ts` | `schedule-discovery.ts` (sweeper), `first-run.ts:345` (inline), "Hunt now" (`dashboard/actions.ts` → schedule) | `discovery_queries.filters`, ICP exclusions | Provider `company.search` (≤5 pages × 25, `credit_budget` default 100, `:67-113`) + Rule exclusions (`isExcluded`, `:441-457`) | `discovery_runs`, `discovery_results`, `companies`, `external_ids`, `job_executions` | `packages/jobs/scripts/verify-jobs.ts` (scripted fakes) |
| Discover (sources) | `scan-source.ts` | `schedule-scans.ts` | `sources` rows, fetched docs | Rule fetch + Model `extract_signals` (Haiku) | `source_events`, `companies`, `evidence` | verify-jobs.ts |
| Identity | `resolve-entity.ts` | `discover-companies.ts:298`; every insert/restore only via 0050 trigger (**not live**) | company row | Rule (domain/provider id) | `merge_candidates`, `companies` | verify-jobs.ts |
| Site profile | `profile-company.ts` | `discover-companies.ts:306`; 0050 trigger (**not live**) | homepage HTML | Rule (regex detectors, `:30-43`) | `evidence` | verify-jobs.ts |
| Research | `research-company.ts` | discover (`:285`), `schedule-followups.ts:113-162`, `prospect-competitor-customers`, brief "Research this" | company URL | Model `research_company` (Opus, high, `web_fetch` restricted to company domains) | `evidence`, `companies.last_researched_at`, → enqueues `score_opportunity` | verify-jobs.ts / `packages/ai/scripts/verify-tasks.ts` |
| Enrich company | `enrich-company.ts` | `schedule-followups.ts:86-110`, `first-run.ts:413` | domain, provider id | Provider `company.enrich` (1 credit) | `companies` (fill-empty only, `:128-158`), `external_ids`, `evidence` (`provider_attested`) | verify-jobs.ts |
| Signals | `fetch-company-signals.ts` | `schedule-signal-fetches.ts` | ATS boards, Apollo job postings | Rule + public ATS APIs (`ats.ts:55-64`) + Provider `company.signals` | `evidence`, `companies.last_signal_checked_at` | verify-jobs.ts |
| Qualify / score | `score-opportunity.ts` | research, scan, `recompute-scores.ts`, `analyze/actions.ts`, `settings/scoring/actions.ts`, `first-run.ts:449` | company, ICP summary, ≤25 observations (per-family, `:490-510`) | **Model** `qualify_opportunity` (Opus high) → Rule `applyRules` (`:170-180`) | `opportunities`, `opportunity_scores` | verify-jobs.ts, verify-tasks.ts |
| Recompute | `recompute-scores.ts` | `schedule-recomputes.ts` | ICP/rule change request | Rule fan-out (200/run) → Model per company | `score_recompute_requests`, `job_executions` | verify-jobs.ts |
| Contacts | `rank-contacts.ts` | `schedule-followups.ts:61-84` (hot/warm), `first-run.ts:482` | people, ICP personas | Provider `person.search` (25) + Rule ranking | `people`, `contact_points`, `opportunities.primary_person_id` | verify-jobs.ts:3973 |
| Enrich person | `enrich-person.ts` | `rank-contacts.ts:210` (top `ENRICH_TOP=2`), `score-opportunity.ts` | person + domain | Provider `person.match` (2 credits) + `email.verify` | `enrichment_records`, `contact_points`, usage `enrich` | verify-jobs.ts:4297 (FLOW-108 only) |
| Why now | (web `lib/ai/why-now.ts`, `first-run.ts:536`) | first-run, brief | evidence | Model `explain_why_now` | `opportunities.why_now` | verify-tasks.ts |
| Learn (org) | `analyze-performance.ts` | `schedule-learning.ts` (hourly key, ≥5 outcomes) | outcomes ≥ `MIN_LEARNING_SIGNALS=8` | Model `analyze_performance` | `learning_runs`, `learning_findings` (proposals) | verify-jobs.ts |
| Learn (person) | `learn-preferences.ts` | `schedule-preferences.ts` | ≥3 notes | Model `infer_preferences` | `memories` (low-risk auto-active, high-risk proposed) | verify-jobs.ts:3489 |
| Demand | `cluster-demand.ts` | `schedule-demand.ts` | demand items | Model `cluster_demand` | demand themes (proposals) | verify-jobs.ts |
| CRM push | `sync-hubspot.ts` | `schedule-followups.ts:40-59` (from `crm_sync_requested_at`) | opportunity, company, primary person | Rule + HubSpot API | `external_ids`, `evidence` (stage), `hubspot_connections` | verify-jobs.ts:3020-3230 (scripted fetch) |

Engine/trust classification of statements leaving the backend:

| Statement | Class | Where |
|---|---|---|
| Opportunity score 0–100, priority | **AI-inferred**, then Calculated (rules) | `score-opportunity.ts:147-180` |
| Dimension values, priority reason, summary | AI-inferred | `qualify-opportunity.ts:418-625` |
| Research facts | AI-inferred with source URL; off-domain → inference (AI-002b fix) | `research-company.ts:232-238` |
| Firmographics "180 employees — according to apollo" | Provider-sourced, stored `kind: fact`, `reliability: provider_attested`, source = login-gated Apollo record URL | `enrich-company.ts:191-206` |
| Homepage detectors | Calculated (regex) — fact/inference by detector | `profile-company.ts:26-43` |
| HubSpot stage | Provider-sourced fact | `sync-hubspot.ts:179-196` |
| First-run stage messages | **Calculated — and wrong** (ENG-201) | `first-run.ts:356-372,413-447,449-480` |

## AI task inventory

Routing `packages/ai/src/models.ts`. All calls: adaptive thinking, `output_config.format: json_schema`, system block `cache_control`, streaming, server-side fallback `"default"` on Opus/Sonnet (`client.ts`). Validation: every task has a hand-written `parse` that throws on schema/§7 violations, run inside `runTask`'s try so failures are recorded (`task.ts`). Invalid JSON: no in-call retry; job retry (max 3). Injection: scraped/provider/user text passes through `wrapUntrusted` (random-id tags + `UNTRUSTED_CONTENT_RULE`) in every task (count per file 1–8). Cost accounting: `ai_runs` row before the call, tokens + cost after (success and, since AI-010, failure); `cache_write_tokens` not persisted.

| Task | Model / effort | Max tokens | Main injection surface | PII to model | Tests |
|---|---|---|---|---|---|
| research_company | opus-5-5 / high, web_fetch ≤5 × 20k, domains pinned | 32 000 | fetched company pages | none intended | verify-tasks.ts |
| recommend_sources | opus / medium | 16 000 | ICP text | no | verify-tasks.ts |
| extract_signals | haiku-5-5 / medium | 16 000 | arbitrary scraped documents | incidental names | verify-tasks.ts |
| qualify_opportunity | opus / high, web_fetch | 32 000 | company site, stored evidence | no | verify-tasks.ts |
| explain_why_now | opus / medium | 16 000 | evidence | no | verify-tasks.ts |
| personalize_message | opus / medium | 8 000 | evidence, house style memories | recipient name/title | verify-tasks.ts |
| classify_reply | haiku / low | 4 000 | **inbound reply bodies** | reply text, sender | verify-tasks.ts |
| sales_agent | opus / medium | 24 000 | activity, memories, competitors | contact names | verify-tasks.ts |
| draft_scoring_rules | opus / high | 20 000 | ICP, outcomes | no | verify-tasks.ts |
| analyze_performance | opus / high | 32 000 | outcomes | aggregated | verify-tasks.ts |
| research_competitor | opus / high | 24 000 | competitor site | no | verify-tasks.ts |
| draft_icp | opus / high | 16 000 | product URL/site | no | verify-tasks.ts |
| explain_performance | sonnet-5-5 / medium | **900** (AI-206) | computed facts | no | verify-tasks.ts |
| workspace_assistant | sonnet / medium | 16 000 | workspace rows | names | verify-tasks.ts |
| cluster_demand | sonnet / medium | 8 000 | demand text | no | verify-tasks.ts |
| infer_preferences | sonnet / medium | 4 000 | user notes | user notes | verify-tasks.ts |

Model ids `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5` are current ids (no date suffix — these are the published ids). Prices in `models.ts:PRICES` match the reference for input/output on all three and Opus cache read; Sonnet cache read is coded $0.20 vs published $0.10 (AI-203). Evals: no golden set; tests are fixture-based parse tests. Budget: count of runs per month (`ai_runs`, free plan 100, `0007:368`), not cost (AI-201).

**Cost per core-loop run (from code constants, not measured):** discovery ≤5 credits (`CREDITS.organizationSearch`=1/page); per new company: 1 `research_company` (Opus high, up to 6 requests with fetch continuations) + 1 `qualify_opportunity` (Opus high); hot/warm: 1 `company.enrich` credit + 1 `person.search` credit + up to 2 × (`person.match` 2 credits + 1 verify). Default provider ceiling: `coalesce(usage_limit(org,'enrich'),25)` credits per provider per month (`0047:421`) — a first run (5 + 10 enrich + 3 searches + 6 × 2 match) can use ~30 credits and hit it. Token cost per run: **not measured**.

## Scoring / learning

- **Formula:** none, by design. The score is the model's 0–100 judgement (`qualify-opportunity.ts:13-19`, prompt `:243-247`); code checks coherence (HOT requires established ICP/pain/trigger, `:509-518`) and all 8 dimensions present (`:458-506`). Then deterministic `applyRules` adjusts score/priority or vetoes (`score-opportunity.ts:170-189`). User-set priority is never overwritten (`:255-257`).
- **Versioning:** `opportunity_scores` stores `prompt_version`, `icp_version_id`, `rules_version` (hash via `active_rules_version`), `computed_reason` — good. `model_version` is `qualify_opportunity@<UTC date>` (`:315`), **not the served model**, though `run.model` is available (AI-202).
- **Reproducibility:** a rescore for a past date is not reproducible: model judgement with no sampling control (sampling params are rejected on these models), server-side fallback can change the serving model, and the input observations are re-read live. Inputs to the past score are not snapshotted.
- **Sample-size guards:** org learning needs ≥8 signals (`analyze-performance.ts:105`, `MIN_LEARNING_SIGNALS` `ai/tasks/analyze-performance.ts:235`) and ≥5 outcomes to schedule (`schedule-learning.ts:63`); person preferences need ≥3 supporting actions, enforced in schema `minItems` and parse (`infer-preferences.ts:113,168`). Org findings are proposals; person low-risk preferences go live automatically with undo, high-risk wait for approval (`learn-preferences.ts:160-174`) — but an approved high-risk memory's content can be rewritten without re-approval (AI-205).
- **Feedback amplification:** learned rules apply only after a person accepts (findings are proposals); no evidence of automatic loop. Not further tested.

## Dependency-failure matrix

| Service | Timeout | 429 | 5xx | Malformed body | Partial page | Revoked / expired key | Outage |
|---|---|---|---|---|---|---|---|
| Apollo/Hunter/ZeroBounce | 15 s abort → transport, retried ×3 with jitter | `rate_limited`, retried ×3, **not** counted by breaker; ledger row | retried ×3; counts toward breaker (5 → 2 min) | `response.json()` SyntaxError → not retryable, `failed`, **credits recorded 0** though vendor may have billed (PROV-204) | `partial` outcome, cached with cursor; discovery stores cursor per page | 401/403 non-retryable `failed`; credential status **not** updated from live calls, so every call keeps failing and the breaker cycles every 2 min per org; no alert (PROV-204) | failures never cached; breaker per org; discovery run marked `failed` with message |
| Anthropic | 55 s SDK timeout, no SDK retry; job retried by queue | thrown; queue retry; no backoff specific to 429 | same | `parseStructuredOutput` throws; recorded failed with tokens (AI-010 fixed) | `pause_turn` continued ≤5 then fails | missing key → `AiUnavailable` → job **skipped ok** (no retry storm); invalid key → error → 3 retries | refusal → `ModelRefusalError` surfaced; fallback model on Opus/Sonnet; no circuit breaker; no kill switch |
| HubSpot | 15 s → retryable `CrmError` | retryable | retryable | `response.json()` throws plain Error → **retryable** (job retry) | n/a (no lists) | 401/403 permanent; `last_sync_error` written; connection stays enabled | retried by queue; failure visible on connection row |
| ATS / websites | per `fetch.ts` | handler | handler | handler | n/a | n/a | refusal stamps `last_signal_checked_at` (FLOW-104 fixed) |

Partial failure: **enrich → ledger.** `callProvider` records the ledger before caching and settles the reservation in `finally` (`call.ts:194-199,241`); a ledger RPC failure is logged and swallowed (`ledger.ts:237-245`) and the reservation is still released → under-count. In `enrich_person`, the `enrich` usage metric is incremented only at the end (`enrich-person.ts:189`); a crash in the candidate loop after the paid match leaves the provider ledger counted but the `enrich` quota not, and the retry appends duplicate `enrichment_records` (append-only table, `0003:138-158`) while the match itself is a cache hit (no second spend). **CRM → cursor:** there is no cursor or inbound sync; it is push-only per opportunity. The idempotency anchor is `external_ids`, written after `createDeal` with its error ignored (CRM-201).

---

## Job inventory

Defaults (all jobs unless stated): `max_attempts` 3 (`queue.ts:136`); backoff `min(attempts², 60)` min → +1, +4 min, then `failed` (`queue.ts:230-244`); no per-job timeout — only the invocation deadline (`maxDuration` 60 s, deadline −5 s, reserve 20 s: `apps/web/app/api/jobs/tick/route.ts:45,80`, `runner.ts:79,130`); a worker killed mid-job is recovered by `requeue_stalled_jobs` after 10 min (`0008_engine_columns.sql:338-356`). Idempotency index: `(job_name, idempotency_key, org_id) NULLS NOT DISTINCT WHERE status IN ('queued','running')` (`0031_tenant_write_hardening.sql:70-73`) — i.e. collapses only while queued/running.

Sweepers (org_id null, enqueued by `sweep()` on every tick, `maxAttempts: 1`, key = name or name:hour/day; `runner.ts:219-361`): `schedule_scans`, `schedule_syncs`, `schedule_sends`, `advance_enrollments`, `schedule_learning`(H), `schedule_discovery`, `enforce_retention`(D), `schedule_recomputes`, `schedule_signal_fetches`, `schedule_followups`, `send_notifications`, `send_digests`(H), `schedule_demand`(H), `schedule_preferences`(H).

| Job | Handler | Enqueuer (path:line) | Idempotency key | Side effects | Notes |
|---|---|---|---|---|---|
| schedule_sends | `handlers/schedule-sends.ts` | `runner.ts:359` | `schedule_sends` | enqueues send_message (≤50/tick, oldest approval first) | skips any message with `error` set (`:56`) — see OUT-202/203 |
| send_message | `handlers/send-message.ts` | `advance-enrollments.ts:350`, `schedule-sends.ts:83` | `send:<messageId>` | **outbound email** via Gmail/Graph; writes messages, message_events, threads, usage, contact_frequency, opportunities.status | at-most-once claim `send_attempted_at` (`:440-449`) |
| advance_enrollments | `handlers/advance-enrollments.ts` | `runner.ts:359` | `advance_enrollments` | AI draft (`runForOrg`), messages insert, enqueue send at autonomy ≥2 | **5 enrollments per tick, globally** (`:50`) |
| schedule_syncs | `schedule-syncs.ts` | sweep | `schedule_syncs` | enqueues sync_mailbox (`sync:<mbx>`, `:72-74`), check_mailbox_domain (`domain:<mbx>`, `:95-97`) | ≤50/tick |
| sync_mailbox | `sync-mailbox.ts` | `schedule-syncs.ts:72` | `sync:<mailboxId>` | reads inbox, stores inbound, AI classify, suppressions on bounce/unsubscribe, stops enrollments | |
| check_mailbox_domain | `check-mailbox-domain.ts` | `schedule-syncs.ts:95` | `domain:<mailboxId>` | DNS MX/SPF/DMARC/DKIM; writes `mailboxes.domain_*` (0048 columns — fails before 0048) | |
| schedule_scans / scan_source | `schedule-scans.ts` / `scan-source.ts` | sweep / `schedule-scans.ts:121`; UI via `sources.next_scan_at` (`lib/data/engine.ts:52-80`) | `scan:<sourceId>` | fetch pages, AI extract, enqueue score_opportunity, resolve_competitor_mentions | |
| research_company | `research-company.ts` | `discover-companies.ts:287`, `prospect-competitor-customers.ts:184`, `schedule-followups.ts:130,156` | **two spellings**: `research:<org>:<company>` vs `research:<company>` | AI + web fetch | JOB-205 |
| score_opportunity | `score-opportunity.ts` | scan-source:370, research-company:188, resolve-competitor-mentions:296, recompute-scores:124 | `score:<companyId>` | AI | |
| enrich_person | `enrich-person.ts` | `rank-contacts.ts:213` | `enrich:<personId>` | provider credits | |
| schedule_discovery / discover_companies | `schedule-discovery.ts` / `discover-companies.ts` | sweep / `schedule-discovery.ts:54` | `discover:<query>:<hour>` | provider credits; enqueues research/resolve/profile | ≤10/tick |
| enrich_company, rank_contacts, sync_hubspot, research_competitor, prospect_competitor_customers | respective handlers | `schedule-followups.ts:53,75,105,179,210` | `crm:`, `contacts:`, `enrich:`, `competitor:` … | provider credits / HubSpot writes / AI | |
| resolve_entity, profile_company | respective handlers | `discover-companies.ts:300,308`; 0050 trigger `enqueue_company_followups` (`0050…sql:~190-215`, **not live**) | `resolve:company:<id>`, `profile:<id>` | DB merge suggestions / homepage fetch | |
| resolve_competitor_mentions | handler | `scan-source.ts:382` | `competitors:<companyId>` | DB | |
| recompute_scores / schedule_recomputes | handlers | `schedule-recomputes.ts:50`, self-chain `recompute-scores.ts:169` | `recompute:<req>` / `recompute:<icp>:<last>` | enqueues score jobs | |
| schedule_signal_fetches / fetch_company_signals | handlers | sweep / `schedule-signal-fetches.ts:70` | `signals:<company>:<day>` | ATS fetches | ≤25/tick |
| schedule_learning / analyze_performance | handlers | sweep(H) / `schedule-learning.ts:148,214` | `learn:<org>:<isoWeek>`, `learn-run:<id>` (maxAttempts 1) | AI | |
| schedule_demand / cluster_demand | handlers | sweep(H) / `schedule-demand.ts:54` | `cluster_demand:<org>` | AI | |
| schedule_preferences / learn_preferences | handlers | sweep(H) / `schedule-preferences.ts:54` | `learn_preferences:<org>:<user>` | AI | |
| enforce_retention | handler | sweep(D) | `enforce_retention:<day>` | deletes stale contacts; calls `prune_job_executions` (0049, **not live** → error reported in result, `enforce-retention.ts:54`) | |
| send_notifications / send_digests | handlers | sweep / sweep(H) | `join-request:…`, `digest:<org>:<user>:<date>` | product email via Resend | |
| purge_contact_data | `purge-contact-data.ts` | **none** (only a test insert, `packages/db/scripts/verify-migrations.ts:3222`) | — | erasure | **orphan handler**, documented as "no producer by design" (`docs/security/outreach-compliance.md` Gaps table) |

Orphans: handler-without-enqueuer = `purge_contact_data` only (documented). Enqueuer-without-handler: impossible by type (`registry.ts:77` total map over the `JobName` union, `queue.ts:37-95`); legacy rows fail permanently (`runner.ts:153-158`). Sessions cannot insert jobs: `tenant_write` on `job_executions` dropped in `0031_tenant_write_hardening.sql:54-60` (read-only for members). The 0050 company trigger is the only SQL producer.

## Queue mechanics

| Property | Implementation | Verdict |
|---|---|---|
| Claim | `claim_job_executions`: `UPDATE … WHERE id IN (SELECT … WHERE status='queued' AND run_at<=now() ORDER BY run_at LIMIT n FOR UPDATE SKIP LOCKED)`; increments attempts (`0008…sql:308-331`) | Correct for disjoint claims across workers. Execute revoked from anon/authenticated (`:363-380`). Tested only against fakes (`verify-jobs.ts`), no concurrent-claim test against Postgres. |
| Visibility timeout | `requeue_stalled_jobs('10 minutes')` at the start of every tick (`runner.ts:97`); exhausted → `failed` with "Abandoned" | OK. A job killed by the 60 s platform limit sits `running` ≥10 min and is charged an attempt. |
| Completion fencing | `succeed`/`markFailed` update by `id` only — no `status='running' AND locked_by=worker` guard (`queue.ts:199-209,233-245`) | LIKELY harmless today (60 s platform cap ≪ 10 min stall window, so no zombie can outlive its lease), but nothing enforces it — JOB-206 (P3). |
| Retries/backoff | +1, +4 min, then failed; `permanent` skips; thrown errors keep retries (`runner.ts:186-194`) | No jitter (fine at this scale). For send_message, retryable refusals that also write `messages.error` exhaust in ~5 min and strand the message — OUT-202. |
| Dead letter | `status='failed'` rows, `error` text; `/[org]/ops` board and `queue_pressure` view (0019). Pruned after 30 days by `prune_job_executions` (0049, not live). | No alert on failed-job growth; the only alert is tick.yml (non-200, or oldest due > 900 s). JOB-203. |
| Fairness | `ORDER BY run_at` globally; 0019 documents the starvation risk and explicitly defers round-robin (`0019_ops_views.sql:279-290`). Sweepers also pick globally oldest-first with small global caps (advance_enrollments 5/tick, schedule_sends 50/tick, schedule_syncs 50/tick). | **Not fair.** JOB-202. |
| Throughput | `TICK_DEFAULTS {limit 12, concurrency 4, batches 5}` → ≤60 jobs per tick (`runner.ts:63`); tick every 5 min from GitHub Actions → ≤720 jobs/h across all tenants, ~16 of each tick's slots go to sweepers. | Not measured. advance_enrollments ceiling = 60 enrollment-steps/hour platform-wide. |
| Tick chain | `.github/workflows/tick.yml` (cron `*/5`, `concurrency: engine-tick`, no cancel) → `GET ${HUNTLOOP_URL}/api/jobs/tick` with `Authorization: Bearer $CRON_SECRET` → `proxy.ts:107,143` lets it through without a session and while schema is not ready → route: no `CRON_SECRET` ⇒ 503 (`route.ts:48-58`); wrong bearer ⇒ 404 (`:61-67`, constant-time compare) → `sweep()` → `tick()`. `apps/web/vercel.json` has no `crons`. | Correct and fail-closed. Local demo 404 on GET (lead's observation) is the route's own wrong-bearer answer: `apps/web/.env.local` defines `CRON_SECRET`, the probe sent none. Prod `cronSecret:false` ⇒ prod tick answers 503 ⇒ nothing runs in prod (UNVERIFIED that the GH workflow is even configured — needs repo Settings). |
| Inngest | `/api/inngest`: 404 unless `INNGEST_EVENT_KEY`+`INNGEST_SIGNING_KEY`; hand-rolled HMAC (`route.ts:102-136`) and a hand-written GET "introspection" shape (`:78-93`); no SDK, no PUT/sync handler. | **Dead** (prod `inngest:false`). Whether a real Inngest app could register/sign against this hand-rolled protocol is UNVERIFIED (likely not: no PUT registration; HMAC key/ordering not checked against vendor docs). JOB-207 (P3). |
| Deadline | stops claiming new batches at deadline−reserve; un-started jobs in hand are `release`d without penalty (`runner.ts:130-136`, `queue.ts:258-270`) | JOB-010 fixed (`release` restores attempts). |
| Missed ticks | GitHub schedule is best-effort and pauses after 60 days of repo inactivity (tick.yml:23-25). Work is state-driven (`next_action_at`, `scheduled_at`, `not_before`), so missed ticks delay, never lose. Hourly/daily sweepers keyed by UTC hour/day: a missed hour is skipped, not caught up (by design, `runner.ts:279-283`). | OK. |
| Overlapping ticks | Workflow concurrency group serialises GH runs; a manual `workflow_dispatch` or a second driver (Inngest) overlapping is safe: claims are SKIP LOCKED, sweepers collapse on their key. | OK (code reading). |
| Heartbeat/observability | tick.yml fails on non-200 and on `oldestDueSeconds > 900`; `jq '.oldestDueSeconds // 0'` turns an unreadable probe (`null`) into 0 = green (`tick.yml:63`), contradicting `queue.ts:174-178` "a failed probe never reads as healthy". `/api/health` reports config booleans only — no queue lag, last tick, or failed-job count. `lastTickAt` reads the org's newest *created* job (`lib/data/engine.ts:239-250`), so any UI- or trigger-enqueued job reads as "driven". | JOB-203. Tick report body (first 2000 bytes, incl. `send_message` results `{to, from}`) is printed to the Actions log (`tick.yml:57`) — JOB-204. |

## Compliance-doc claim table (`docs/security/outreach-compliance.md`)

| Claim | Verdict | Evidence |
|---|---|---|
| "Every control here is enforced at the database, not in the sending handler" | **False** | Postal address, unsubscribe-URL, quota, reply-pending, bounce pause, domain, business hours, content gate are all handler code (`send-message.ts:187-408`); only `can_contact`, `claim_mailbox_send`, CHECK on sent are DB |
| Four frequency policies incl. `max_contacts_per_company` (default 3) "stops the email-nine-people pattern"; flowchart "company saturated → Refused" | **False for `max_contacts_per_company`** | Column exists (`0017…sql:92-93`); no reader anywhere (grep: only the migration). `can_contact` has no company check (`0017…sql:116-221`). OUT-204 |
| `min_days_between_contacts`, `max_sends_per_contact_30d`, `max_sends_per_day` | True | `can_contact` `0017…sql:160-210`; test `verify-jobs.ts:1183+`, `verify-migrations.ts:2210+` |
| `can_contact` "called by every send path" | True (one send path) | `send-message.ts:130` is the only sender |
| `record_contact_send` after provider accepts | True | `send-message.ts:540-543` |
| Sent requires provider id (CHECK) | True | `messages_sent_has_provider_id` (0004) |
| "Same message never sent twice; `sent_at` is the proof" | True, stronger now | plus `send_attempted_at` claim (0033) |
| Mailbox cannot exceed daily allowance (atomic) | True | `claim_mailbox_send` conditional UPDATE |
| No send at autonomy 0–1 without approval | True as stated (`scheduled_at` required); note approval is "any member" and `scheduled_at` is member-writable via `tenant_write` | `send-message.ts:92-104` |
| List-Unsubscribe + One-Click + footer on every message | True when `NEXT_PUBLIC_SITE_URL` set; send refuses otherwise | `send-message.ts:193-200,456-482`; `provider.ts` buildMime (headers) — prod `siteUrl` is the apex that fails TLS (lead fact), so prod links would be dead if prod sent |
| POST acts, GET does not; no session | True | `api/unsubscribe/[token]/route.ts:44-96`; `proxy.ts:71-72` |
| Suppression survives erasure | True | `can_contact` checks `value_hash` (`0017…sql:~140-147`) |
| `erase_contact` admin-gated | True | `erase_contact_for_org` `0017…sql:~490-500` |
| Retention daily, NULL default, `prune_stale_contacts` spares messaged contacts | Plausible; not audited here (lifecycle reviewer) | `runner.ts:306` daily key |
| No way to enrol and raise autonomy in one call; create accepts no autonomy | True | `outreach/actions.ts:96`; enrol action inserts enrollments only (`opportunities/actions.ts:171-183`) |
| `emails` plan limit ✅ checked before every send | True, **fails open** on read error | `send-message.ts:251-267`; PROBE-D C |
| `purge_contact_data` has no producer by design | True | §1 |
| Removed or merged companies ✅ 0049 stops sequences and unschedules mail | **Fixed in repo, not live** (0049 missing in configured DB); also covers opportunity soft-delete only, not stop/pause/archive | §3 #19–20 |
| "No deliverability tooling (warm-up, rotation, seed lists)" | **Stale** | warm-up ramp (0048) and multi-mailbox spreading (`pickMailbox`) exist |
| Lawful basis / DPAs / CAN-SPAM content | Doc says open; agree | No consent/lawful-basis column anywhere; no region rules in code |
| Bounces "stop every future send to it, across every campaign" (code comment `sync-mailbox.ts:284-285`) | Partly | Only when the DSN threads to our message; complaints never recorded |

## Money

**Billing: `Missing`.** No Stripe/Razorpay/Paddle/checkout/webhook code anywhere (grep over `packages/`, `apps/web/app`, `apps/web/lib`; hits are only schema/scripts/comments). Schema stubs exist since `0001_identity.sql:48-77`: `plans`, `subscriptions` (`stripe_sub_id`, unused), `usage_counters`. `STRIPE_*` env vars are declared and read by nothing (docs agree: `docs/product/plans-and-quotas.md` "There is no payment path at all"; `docs/status/roadmap.md:92` lists "Decide Stripe" as an open decision). Intent is undecided, so no billing design is proposed here.

**Plan assignment is manual SQL.** `organizations.plan_id` defaults to `free` (`0007_profiles_invites_accounting.sql:375-377`); no application code writes `plan_id` (grep: only reads in `lib/data/organization.ts:49,70`). The seeded Free plan has `emails: 0` (`0007…sql:370-373`), and `send_message` enforces it (`send-message.ts:251-267`, `check_quota_internal` `0009…sql:54-71`: `0 < 0` is false). Consequence: every self-serve workspace's outreach is refused until an operator edits `plan_id` or `usage_counters."limit"` in SQL, and each refused message is stranded (OUT-202). MONEY-201.

**Substitutes audited:**

| Control | Where | Atomic with spend? | Fails | Live in configured DB? |
|---|---|---|---|---|
| Plan quotas (`opportunities`, `ai_runs`, `emails`, `enrich`, `seats`) | `usage_limit` (0007), `check_quota_internal`/`increment_usage_internal` (0009) | No — check-then-act; increment after success | open on read error (`ai.ts:127-131`, `send-message.ts:259`) | yes |
| AI monthly quota | `packages/jobs/src/ai.ts:122-183` | No; counts **successful** runs only; failed-but-billed runs are never counted (`:115-120`), so a task that keeps failing has no quota ceiling — only retry/sweeper caps | open | yes |
| AI per-request rate limits (request path) | `apps/web/lib/rate-limit.ts:122-154` per user + per org per hour, consumed via `consume_rate_limit` (0005) | yes (DB counter) | open when the table is missing (`:182`) | yes |
| Provider budget per org per provider | `provider_budget_state` (final 0047: account cap may only lower the plan's `enrich`) | **Before 0050 no**: `reserveCredit` falls back to `budgetAllows` (check-then-call) (`packages/providers/src/budget.ts:89-100`); with 0050, advisory-locked reserve | open on read error (`budget.ts:47-49`) | reserve **not live** (0050) |
| Per-mailbox daily cap | `claim_mailbox_send` | yes | closed | yes (warm-up part not live) |
| Org daily send ceiling | `organizations.max_sends_per_day` (default NULL = none) via `can_contact` | No (counts sent rows) | closed | yes |
| Queue load per org | none — no per-org job cap; `job_executions` unbounded per org; fairness absent | — | — | — |
| Global kill switch | **none** in code or runbooks (grep "kill switch", "pause engine", "disable send" → nothing; `docs/operations/*` has no stop-sending procedure). De-facto levers: unset `CRON_SECRET` (tick 503s), disable the GitHub workflow, disconnect mailboxes per org | — | — | — |
| Platform-wide $ ceiling on shared Anthropic / provider keys | none; all caps are per-org counts, not currency | — | — | — |

Can one org drive unbounded spend? Provider credits: bounded per org per provider per month by the Free/Growth/Scale `enrich` figure (25/1000/10000) — per provider, so the effective ceiling is that × number of providers; before 0050 concurrent lanes can overshoot by up to the tick concurrency (4) per race. AI: bounded by the `ai_runs` count for successful runs; failed runs and token-heavy runs (web_fetch continuations) are uncapped in currency. Request-path AI is rate-limited per hour. I found no loop that re-enqueues paid work without a staleness guard in the jobs I read (each scheduler sets a marker or uses period keys), but the quota-fails-open + count-not-cost design means "bounded" depends on the counters being readable. MONEY-202 (P2). Not P0: every paid path has a per-org ceiling when the DB is healthy.

