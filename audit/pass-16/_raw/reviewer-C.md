# Pass 16 — Reviewer C (engine, providers, ai, crm)

status: complete

Audited commit: `7e09759` (`feat/pass-15-audit-fixes`). Read-only. No vendor, AI, mail or network call made; `scripts/live-check.ts` read, not run. Only file written in the repo: this one. One scratch probe in the OS temp dir (below).

**Ran myself:** `node --experimental-strip-types` probe of `packages/providers/src/budget.ts` with a fake db (scratchpad `probe/budget-probe.ts`). Output:
```
0050 missing, 4 lanes allowed: 4 reserved: 0,0,0,0
settle rpc called: false
state unreadable -> allowed: true assumed: true
```
Package suites (providers 20, ai 243, crm 86, jobs 434) were run by the lead and passed; I did not re-run them. Model ids and prices were checked against the bundled `claude-api` reference (cached 2026-11-03), not a live API.

Severity counts (this file): **Critical 0 · High 3 · Medium 11 · Low 4**.

---

## 1. Engine stage map

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

## 2. External-integration inventory

| Service | Purpose | Where | Auth | Env names | Data out | Webhooks | Errors | Retry | Rate limit | Timeout | Cache key / TTL | Live status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Apollo | company search/enrich, people search/match, job postings | `packages/providers/src/adapters/apollo.ts` | `x-api-key` header (`:190-198`) | `APOLLO_API_KEY` | ICP filters, domains, person names | none | 429 → `rateLimited`; 401/403 non-retryable; 5xx retryable; other 4xx non-retryable (`:151-184`) | 3 attempts, exp. backoff + jitter (`call.ts:56-62`) | none client-side; breaker 5 fails → 2 min, **per org** (`0011:290-310`) | 15 s per attempt | `sha256(capability provider canonicalJSON)` per org; search 24 h, enrich 30 d, person.search 7 d, match 30 d, signals 48 h (`cache.ts`) | **Not live**: prod health says every integration false; request shapes never seen by the real API (PROV-005) |
| Hunter | person match | `adapters/hunter.ts` | query key | `ENRICHMENT_API_KEY` | name + domain | none | same classify pattern | same | same | 15 s | person.match 30 d | not live |
| ZeroBounce | email verify | `adapters/zerobounce.ts` | query key | `EMAIL_VERIFICATION_API_KEY` | email address | none | same | same | same | 15 s | email.verify 90 d (not cached when `unknown`) | not live |
| Anthropic | 16 AI tasks | `packages/ai/src/client.ts` | API key | `ANTHROPIC_API_KEY`, `HUNTLOOP_AI_TIMEOUT_MS` | prompts incl. scraped pages, reply bodies, names (see §3) | none | refusal → `ModelRefusalError`; `max_tokens` → error; invalid JSON → error | SDK `maxRetries: 0`; queue retries job (3) | none app-side | 55 s default (`env.ts:42-45`) | prompt cache on system block | not live in prod (`inngest:false`, no key) |
| HubSpot | push company/contact/deal, read stage | `packages/crm/src/hubspot.ts` | private-app bearer token, encrypted at rest | `MAILBOX_ENCRYPTION_KEY` (shared cipher; name per health check) | company name/domain/industry/size, contact email/name/title, score, why-now, app URL | none (no inbound) | 429 retryable; 401/403 permanent; 5xx retryable; 4xx permanent (`:74-91`) | queue retries only | none | 15 s | none | not live; CRM-002/003/005 need a portal |
| Public ATS (Greenhouse, Lever, Ashby, Workable) | job postings | `packages/jobs/src/ats.ts:55-64` via `fetch.ts` | none | none | board slug | none | handled in handler | queue | none | per `fetch.ts` | none | unverified live |
| Company websites | profile, research fetch | `profile-company.ts`, `fetch.ts`, Anthropic `web_fetch` | none | none | URL | none | refusal stamps (FLOW-104) | queue | none | per fetch | none | unverified live |

## 3. AI task inventory

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

## 4. Scoring / learning

- **Formula:** none, by design. The score is the model's 0–100 judgement (`qualify-opportunity.ts:13-19`, prompt `:243-247`); code checks coherence (HOT requires established ICP/pain/trigger, `:509-518`) and all 8 dimensions present (`:458-506`). Then deterministic `applyRules` adjusts score/priority or vetoes (`score-opportunity.ts:170-189`). User-set priority is never overwritten (`:255-257`).
- **Versioning:** `opportunity_scores` stores `prompt_version`, `icp_version_id`, `rules_version` (hash via `active_rules_version`), `computed_reason` — good. `model_version` is `qualify_opportunity@<UTC date>` (`:315`), **not the served model**, though `run.model` is available (AI-202).
- **Reproducibility:** a rescore for a past date is not reproducible: model judgement with no sampling control (sampling params are rejected on these models), server-side fallback can change the serving model, and the input observations are re-read live. Inputs to the past score are not snapshotted.
- **Sample-size guards:** org learning needs ≥8 signals (`analyze-performance.ts:105`, `MIN_LEARNING_SIGNALS` `ai/tasks/analyze-performance.ts:235`) and ≥5 outcomes to schedule (`schedule-learning.ts:63`); person preferences need ≥3 supporting actions, enforced in schema `minItems` and parse (`infer-preferences.ts:113,168`). Org findings are proposals; person low-risk preferences go live automatically with undo, high-risk wait for approval (`learn-preferences.ts:160-174`) — but an approved high-risk memory's content can be rewritten without re-approval (AI-205).
- **Feedback amplification:** learned rules apply only after a person accepts (findings are proposals); no evidence of automatic loop. Not further tested.

## 5. Dependency-failure matrix

| Service | Timeout | 429 | 5xx | Malformed body | Partial page | Revoked / expired key | Outage |
|---|---|---|---|---|---|---|---|
| Apollo/Hunter/ZeroBounce | 15 s abort → transport, retried ×3 with jitter | `rate_limited`, retried ×3, **not** counted by breaker; ledger row | retried ×3; counts toward breaker (5 → 2 min) | `response.json()` SyntaxError → not retryable, `failed`, **credits recorded 0** though vendor may have billed (PROV-204) | `partial` outcome, cached with cursor; discovery stores cursor per page | 401/403 non-retryable `failed`; credential status **not** updated from live calls, so every call keeps failing and the breaker cycles every 2 min per org; no alert (PROV-204) | failures never cached; breaker per org; discovery run marked `failed` with message |
| Anthropic | 55 s SDK timeout, no SDK retry; job retried by queue | thrown; queue retry; no backoff specific to 429 | same | `parseStructuredOutput` throws; recorded failed with tokens (AI-010 fixed) | `pause_turn` continued ≤5 then fails | missing key → `AiUnavailable` → job **skipped ok** (no retry storm); invalid key → error → 3 retries | refusal → `ModelRefusalError` surfaced; fallback model on Opus/Sonnet; no circuit breaker; no kill switch |
| HubSpot | 15 s → retryable `CrmError` | retryable | retryable | `response.json()` throws plain Error → **retryable** (job retry) | n/a (no lists) | 401/403 permanent; `last_sync_error` written; connection stays enabled | retried by queue; failure visible on connection row |
| ATS / websites | per `fetch.ts` | handler | handler | handler | n/a | n/a | refusal stamps `last_signal_checked_at` (FLOW-104 fixed) |

Partial failure: **enrich → ledger.** `callProvider` records the ledger before caching and settles the reservation in `finally` (`call.ts:194-199,241`); a ledger RPC failure is logged and swallowed (`ledger.ts:237-245`) and the reservation is still released → under-count. In `enrich_person`, the `enrich` usage metric is incremented only at the end (`enrich-person.ts:189`); a crash in the candidate loop after the paid match leaves the provider ledger counted but the `enrich` quota not, and the retry appends duplicate `enrichment_records` (append-only table, `0003:138-158`) while the match itself is a cache hit (no second spend). **CRM → cursor:** there is no cursor or inbound sync; it is push-only per opportunity. The idempotency anchor is `external_ids`, written after `createDeal` with its error ignored (CRM-201).

---

## 6. Findings

### [High] ENG-201: The first-run screen reports discovery, enrichment and scoring outcomes that did not happen
- Confidence: CONFIRMED (code trace; no test covers `stage*`)
- Where: `packages/jobs/src/first-run.ts:356-372` (discover), `:413-447` (enrich), `:449-480` (score); `packages/jobs/src/handlers/discover-companies.ts:314-328`; `enrich-company.ts:103-109`; `score-opportunity.ts:157-162`
- Evidence: `const created = Number(run.result.created ?? run.result.companies ?? 0);` — `discover_companies` returns `{status, stopReason, pages, credits, total, researchEnqueued, refusal?}`; neither key exists. A refused run (`no_provider`, `org_budget`, `breaker_open`) returns `ok: true`. Refused enrich and `AiUnavailable` scoring return `ok: true, result: {skipped}`, counted as `done++` / `scored++`.
- Trace/repro: new workspace with no `APOLLO_API_KEY` → stage discover says "The search ran and returned nothing new — every match is already in your workspace." With companies found, the same message (count 0). With no Anthropic key, score says "Scored 10 companies against your profile." With no Apollo key, enrich says "Filled in details for 10 companies."
- Impact: user (first-impression trust), core loop — the onboarding surface states false facts about what the engine did, and hides the configuration/budget reason the handler carefully produced.
- Root cause: `first-run` treats `ok: true` as success and reads result keys the handlers never return.
- Fix: map `discover_companies` result (`status`, `stopReason`, `refusal`, and count of `discovery_results.outcome='new'` for the run) to the stage; treat any `result.skipped` as `skipped` with its detail in enrich/score/contacts.
- Acceptance criteria: with no provider key the discover stage is `skipped` with the refusal text; with N new companies it reports N; skipped handlers never count as done.
- Test to add: `packages/jobs/scripts/verify-jobs.ts` — "first-run stageDiscover reports refusal and real created count" with scripted handler outcomes.
- Effort: S · Depends on: — · Mechanizable: yes (test)
- Status vs last pass: New

### [High] CRM-201: A deal created in HubSpot is not recorded reliably, so a retry creates a duplicate
- Confidence: CONFIRMED (code); live behaviour UNVERIFIED (needs a portal)
- Where: `packages/jobs/src/handlers/sync-hubspot.ts:153-172,259-265`; `packages/crm/src/hubspot.ts:226-236`
- Evidence: `createDeal` → `linkExternal(...)` whose upsert result is discarded (`linkExternal` returns nothing and checks no error); then two `associate` calls that can throw a retryable error.
- Trace/repro: `createDeal` succeeds → `external_ids` upsert fails, or `associate` 429/5xx throws → job retried → `existingDeal` empty (or present, but the deal has no company association) → second `createDeal`. Same if the function is killed between create and link.
- Impact: duplicate deals in the customer's CRM (external write without idempotency); deals without company/contact associations.
- Root cause: the only idempotency anchor is written after the external create, unchecked, with no lookup on HubSpot's side.
- Fix: check `linkExternal`'s error and fail permanently if it cannot record; before `createDeal`, search deals by `huntloop_evidence_url` (already a custom property) and adopt a match; make association failures re-run idempotently on the next attempt (associations are `PUT`).
- Acceptance criteria: a retry after any failure past `createDeal` never creates a second deal.
- Test to add: verify-jobs.ts — "sync_hubspot: associate throws after create; the retry finds the deal by evidence URL and creates none".
- Effort: S–M · Mechanizable: yes (test)
- Status vs last pass: Still open (CRM-002, was Medium; raised to High per §9 "missing idempotency on anything that writes externally")

### [High] PROV-201: Atomic credit reservation is not live; the configured DB silently uses the old check-then-call and fails open
- Confidence: CONFIRMED (probe run above; db:doctor shows 0050 MISSING)
- Where: `packages/providers/src/budget.ts:88-119` (fallback `:98-101`), `:44-56` (fail-open), `call.ts:182-199`; `packages/db/migrations/0050_atomic_spend_and_send_lanes.sql:28-80`
- Evidence: probe — with `reserve_provider_credit` returning PGRST202, four parallel lanes at "1 left" are all allowed, `reserved: 0`, settle never called; with the state unreadable, `allowed: true, assumed: true`.
- Trace: `callProvider` → `reserveCredit` → rpc error (any error, not only "function missing") → `budgetAllows` → `provider_budget_state` read → call. Even with 0050 applied: the reservation is always 1 credit while `person.match` costs 2 (`apollo.ts:71-76`), so the cap can be overshot by (lanes × 1); and any transient RPC error degrades to unlocked check-then-call.
- Impact: cost — overshoot of the per-provider monthly cap by up to the tick's concurrency (bounded, small) today; unbounded only while the budget RPCs error (fail-open). Not P0: bounded by tick concurrency.
- Root cause: PROV-015 fix depends on an unapplied migration and the fallback is indistinguishable from success.
- Fix: apply 0050 (runbook step 1); reserve the adapter's known per-call credits (pass `credits` into `reserve_provider_credit`); log once when falling back on 42883/PGRST202 and fail closed on other errors when a limit is known.
- Acceptance criteria: with 0050 applied, N parallel calls at `remaining = k` allow ≤k credits; fallback path emits a log line.
- Test to add: `packages/providers/scripts/verify-providers.ts` — "a 2-credit capability reserves 2"; "reserve RPC error other than missing-function is not fail-open".
- Effort: S · Depends on: 0050 applied · Mechanizable: yes (db:doctor + test)
- Status vs last pass: PROV-015 **Fixed in repo, not live**

### [Medium] ENG-202: Refused company enrichment is re-enqueued every tick and starves every other company
- Confidence: CONFIRMED (code)
- Where: `packages/jobs/src/handlers/schedule-followups.ts:86-110`; `enrich-company.ts:103-109`; `runner.ts:219-306` (`schedule_followups` is a per-tick sweeper, not HOURLY); idempotency index only covers queued/running (`0031:71-73`)
- Evidence: refusal returns `{ok:true, skipped}` without stamping `last_enriched_at`; the sweep selects `last_enriched_at is null or < 30d`, `limit 10`, no order.
- Trace: org out of Apollo credit → same ≤10 companies enqueued each tick → each writes a `refused` `provider_calls` row (`call.ts:183-191`) → other stale companies never reached.
- Impact: queue churn, ledger growth (~10 rows/tick/org), enrichment of other companies blocked until month end. Same class as FLOW-104 (fixed for signals only).
- Root cause: no "checked" stamp on refusal, and no ordering in the sweep query.
- Fix: stamp an `enrich_checked_at` (or `last_enriched_at` with refusal reason) on refusal; order by `last_enriched_at nulls first`.
- Acceptance criteria: a refused company is not re-enqueued for ≥24 h; ten refused companies don't block an eleventh.
- Test to add: verify-jobs.ts — "schedule_followups skips a company whose enrichment was refused today".
- Effort: S · Mechanizable: yes
- Status vs last pass: New

### [Medium] PROV-202: Re-enrichment can turn a known-risky or undeliverable address back into a sendable one
- Confidence: CONFIRMED (code); not run
- Where: `packages/jobs/src/handlers/enrich-person.ts:141-185`; `packages/db/src/contact.ts:693-696` (`isSendableEmail`)
- Evidence: `status = "unverified"` default; only `deliverable`/`provider_verified` are kept (`:152`); when `verifyEmail` throws `ProviderRefused` (budget, breaker, no verifier) the upsert writes `verification_status: "unverified"` over `risky`/`undeliverable`.
- Trace: address marked `risky` by ZeroBounce → 90 days later (verify cache expired) or verifier out of credit → `enrich_person` re-runs → row becomes `unverified` → `isSendableEmail` true → eligible for outreach. Bounces are additionally in `suppressions` (`sync-mailbox.ts:292-299`), so the bounce case is backstopped; verifier verdicts are not.
- Impact: sending to addresses the system already learned are bad → bounces, sender reputation.
- Root cause: the "keep the prior verdict" rule (FLOW-108) covers good verdicts only.
- Fix: keep any prior non-`unverified`/`unknown` status when no fresh verdict was obtained.
- Acceptance criteria: a refused verify never changes an existing status.
- Test to add: verify-jobs.ts — "enrich_person: verifier refused, prior risky stays risky".
- Effort: S · Mechanizable: yes
- Status vs last pass: New (sibling of FLOW-108)

### [Medium] PROV-203: Provider cache keeps a person's contact data after erasure, and its prune may not run
- Confidence: LIKELY (code; cron state UNVERIFIED — 0006 schedule not visible to db:doctor)
- Where: `packages/providers/src/cache.ts` (`provider_cache` keyed `org_id, request_hash`); `erase_contact` final def `0037_daily_loop.sql:693-830` (no `provider_cache` delete); `prune_provider_cache` `0011:425-437` scheduled by pg_cron guard
- Evidence: `person.match` bodies (names, emails) cached 30 d, `email.verify` keyed by `sha256("email.verify zerobounce {email}")` 90 d; no reference to `provider_cache` in any erasure or retention path (`grep` across migrations and handlers).
- Impact: privacy/legal — erased contact data still served from cache and can re-materialise a `contact_points` row if `enrich_person` runs again within TTL.
- Root cause: the cache is outside the erasure inventory.
- Fix: in `erase_contact`, delete `provider_cache` rows for `email.verify` by computed hash and `person.match` rows whose body contains the email; verify the prune cron exists or run `prune_provider_cache` from `enforce_retention`.
- Acceptance criteria: after erasure, no `provider_cache` row contains the email.
- Test to add: `packages/db` migration test — erase removes matching cache rows.
- Effort: S–M · Mechanizable: yes
- Status vs last pass: New

### [Medium] AI-201: The job-side AI budget is a run count that fails open and never counts failed (billed) runs; no cost cap or kill switch
- Confidence: CONFIRMED (code)
- Where: `packages/jobs/src/ai.ts:105-147`; web counterpart `apps/web/lib/ai/budget.ts` (fails **closed**); claims of parity in `packages/providers/src/budget.ts:4-16` and the comment above `withinBudget`
- Evidence: `if (error) return { ok: true, ... }`; `increment_usage_internal` only after `runTask` returns; a run that throws after tokens were billed is retried by the queue up to 3× and counted 0 times. Limit is `ai_runs` per month (free 100), regardless of Opus-high vs Haiku cost.
- Impact: cost — spend is uncapped in money terms; failing runs (e.g. AI-206) consume tokens invisibly to the quota; inconsistency with the web path the comments say it mirrors.
- Root cause: budget designed as a run counter incremented on success only.
- Fix: count the run at start (or on failure with usage), and add a monthly cost ceiling from `ai_runs.cost_cents`; align fail-open/closed posture and correct the comments.
- Acceptance criteria: three failed attempts increment `ai_runs` usage by 3; an org above its cost ceiling is refused.
- Test to add: verify-jobs.ts — "runForOrg counts a failed run".
- Effort: M · Mechanizable: yes
- Status vs last pass: New (AI-010 fixed the ledger side, not the quota)

### [Medium] AI-202: Score provenance records a date, not the model that produced it; rescores are not reproducible
- Confidence: CONFIRMED (code)
- Where: `packages/jobs/src/handlers/score-opportunity.ts:313-323`; `packages/ai/src/client.ts` (server-side `fallbacks: "default"`)
- Evidence: `model_version: \`qualify_opportunity@${new Date().toISOString().slice(0, 10)}\``; `run.model` (served model) is returned by `runTask` and discarded.
- Impact: trust/learning — "did the score change because the model changed (fallback) or the market changed" has no answer; past scores cannot be re-derived (observations not snapshotted).
- Root cause: `model_version` field filled with a label instead of the served model.
- Fix: store `run.model`; store the observation ids used.
- Acceptance criteria: `opportunity_scores.model_version` equals the response's model id; a fallback-served score is distinguishable.
- Test to add: verify-jobs.ts — scripted client returning `model: "claude-opus-4-8"` → stored.
- Effort: S · Mechanizable: yes
- Status vs last pass: New

### [Medium] AI-204: A "fact" only has to cite a URL on an allowed domain, not a page that was actually read
- Confidence: LIKELY (code; would be settled by a live run comparing citations to `web_fetch_tool_result` URLs)
- Where: `packages/ai/src/tasks/research-company.ts:232-238,277-288`; `qualify-opportunity.ts` (same rule in prompt); `claims.ts:assertValidClaim`
- Evidence: `citesAllowedDomain(sourceUrl, fetchable)` checks host only; the fetch results in `message.content` are not collected or compared.
- Impact: a model-recalled URL on the company's domain (e.g. a guessed `/pricing`) is stored as a `fact` with high trust.
- Root cause: grounding checks domain, not fetch provenance.
- Fix: return fetched URLs from `client.run` (from `web_fetch_tool_result` blocks) and downgrade facts citing unfetched URLs to inference (allow observed-block URLs for qualify).
- Acceptance criteria: a fact citing an unfetched URL is stored as inference.
- Test to add: verify-tasks.ts — parse with fetched-URL list.
- Effort: M · Mechanizable: yes
- Status vs last pass: New (AI-002b fixed the off-domain half)

### [Medium] AI-205: An approved high-risk learned preference can have its content rewritten by the model without re-approval
- Confidence: CONFIRMED (code)
- Where: `packages/jobs/src/handlers/learn-preferences.ts:144-158`
- Evidence: for an existing `origin: "learned"` memory with fresh support, `update("memories", { content: c.content, ... })` — status unchanged, risk not re-evaluated.
- Impact: a targeting preference a person approved ("skip agencies") can become different targeting policy silently, then feed prompts/rules.
- Root cause: reinforcement path updates content as if it were only support.
- Fix: for `risk = high`, write the new content as a proposal (status `proposed`) or only update support/counters when content differs.
- Acceptance criteria: changed content on a high-risk memory requires a yes.
- Test to add: verify-jobs.ts — "learn_preferences: new wording of an approved high-risk memory is proposed, not applied".
- Effort: S · Mechanizable: yes
- Status vs last pass: New

### [Medium] ENG-203: First-run scoring runs up to ten Opus-high model calls inside one 60-second request
- Confidence: LIKELY (not measured)
- Where: `packages/jobs/src/first-run.ts:449-480`; `apps/web/app/(onboarding)/welcome/building/actions.ts` (comment: 60 s on Hobby, no `maxDuration`); `packages/ai/src/env.ts:42-45` (55 s per AI request)
- Evidence: sequential `runHandler("score_opportunity")` × `limit = 10`, each a `qualify_opportunity` at high effort with `web_fetch`.
- Impact: the score stage times out mid-loop on real keys; partial work (billed runs) with a failed stage. Combined with ENG-201 the screen may still claim success when AI is absent.
- Root cause: per-stage sizing assumed fast handlers.
- Fix: score ≤2–3 inline, enqueue the rest; or split the stage per company.
- Acceptance criteria: stage completes under the function limit with real latency (measure).
- Test to add: none offline; measure in the first live run.
- Effort: S · Mechanizable: no
- Status vs last pass: New

### [Medium] CRM-202: Pushing to HubSpot overwrites the customer's existing records and creates deals without a stage
- Confidence: CONFIRMED (overwrite, code) / UNVERIFIED (stage requirement — needs a portal)
- Where: `packages/crm/src/hubspot.ts:186-219` (`PATCH` name/industry/numberofemployees, firstname/lastname/jobtitle on existing records), `:226-236` (no `pipeline`/`dealstage`)
- Impact: customer CRM data replaced by Huntloop's guesses; deal creation may be rejected or land in an arbitrary stage.
- Root cause: upsert writes all fields regardless of what HubSpot already holds.
- Fix: on existing records PATCH only empty properties (read first) or only Huntloop-owned properties; set pipeline/stage from a connection setting.
- Acceptance criteria: an existing HubSpot company's name is never changed by a push.
- Test to add: verify-crm.ts — existing record PATCH body excludes populated fields.
- Effort: M · Mechanizable: yes
- Status vs last pass: Still open (CRM-003, CRM-005)

### [Medium] PROV-204: A revoked or expired vendor key is never marked invalid by live calls; failures are per-org and silent
- Confidence: CONFIRMED (code)
- Where: `packages/providers/src/registry.ts` (`credentialsKnownBad` reads `provider_accounts.credential_status`, written only by `verifyCredentials`); `0011:290-310` (breaker keyed `org_id, provider`); `apollo.ts:211,241` (`response.json()` unguarded)
- Evidence: a 401 in `spend()` records `failed` and throws; nothing sets `credential_status = 'invalid'`. Keys are platform env vars shared by all orgs, but each org's breaker learns separately. A 200 with a non-JSON body throws SyntaxError → `failed`, `credits: 0`.
- Impact: during a key revocation every org burns 5 failed calls per 2 minutes indefinitely, nothing alerts; malformed-body calls the vendor billed are recorded as free.
- Root cause: credential state and breaker are per-org although the credential is global; no alert path.
- Fix: on 401/403 from a call, mark the capability's credentials invalid (or a global breaker row) and emit an ops event; treat parse failure as `failed` with the adapter's nominal credits.
- Acceptance criteria: one 401 stops further calls for that provider until re-verified.
- Test to add: verify-providers.ts — "401 marks credentials invalid".
- Effort: S · Mechanizable: yes
- Status vs last pass: New

### [Medium] ENG-204: The live-check and runbook disagree with the code on what is checked and what is free
- Confidence: CONFIRMED (code + doc)
- Where: `scripts/live-check.ts:128,141` (aliases `HUNTER_API_KEY`, `ZEROBOUNCE_API_KEY`); `packages/providers/src/registry.ts` reads only `ENRICHMENT_API_KEY` / `EMAIL_VERIFICATION_API_KEY`; `apollo.ts:385-404` ("the credit it may cost"); `docs/operations/first-live-run.md` §2 ("Free: proves each key is accepted")
- Evidence: live-check passes Hunter/ZeroBounce with alias names the app never reads; it calls adapters directly, so the ledger, cache, budget and breaker path (`callProvider`) is never exercised; Apollo's credential check is a `/mixed_companies/search` that the adapter itself says may cost a credit.
- Impact: a green live-check can coexist with "no provider configured" in the app; the "free" step may spend.
- Root cause: script written against adapters and its own env aliases.
- Fix: drop aliases (or have the registry read the same names); add one `--spend` check through `@huntloop/providers` with a real `OrgScope` so a ledger row is written; correct the runbook wording.
- Acceptance criteria: live-check and registry agree on which providers are configured.
- Test to add: none (script); mechanizable env-name check in `scripts/audit.mjs`.
- Effort: S · Mechanizable: yes
- Status vs last pass: New

### [Low] AI-203: Price table and cost recording drift
- Confidence: CONFIRMED (code vs `claude-api` reference, cached 2026-11-03)
- Where: `packages/ai/src/models.ts` PRICES (Sonnet `cacheRead: 0.2`, published $0.10); `pricedModel` falls back to routed price for fallback-served models not in the table; `packages/jobs/src/ai.ts:82-108` (no `cache_write_tokens` column written)
- Impact: cost screens over-count Sonnet cache reads 2×, misprice fallback-served runs, cannot reconcile cache writes.
- Fix: correct the price; add the fallback models' prices; persist cache write tokens.
- Effort: S · Mechanizable: yes (price test) · Status: New (AI-004 fixed for snapshots only)

### [Low] AI-206: `explain_performance` is capped at 900 tokens with adaptive thinking on
- Confidence: LIKELY (UNVERIFIED: settle with one live call)
- Where: `packages/ai/src/tasks/explain-performance.ts:92`; `client.ts` throws on `max_tokens` (thinking and output share the cap)
- Impact: the narrative likely fails often and silently degrades (`performance-narrative.ts:64-67` catches) while billing tokens.
- Fix: raise to several thousand or lower effort to `low`.
- Effort: S · Mechanizable: yes · Status: New

### [Low] CRM-203: HubSpot push ignores removals and erasure; falls back to a fake app URL
- Confidence: CONFIRMED (code)
- Where: `sync-hubspot.ts:107-110` (company loaded without `deleted_at` filter), `:232-237` (person without `deleted_at`), `:125` (`https://app.huntloop.example` when `NEXT_PUBLIC_SITE_URL` unset); disconnect (`settings/integrations/actions.ts:93`) leaves `external_ids`; no deletion propagation to HubSpot
- Impact: removed company/person data pushed (opportunity check mitigates once 0049 is live); deal property points to a non-existent host on a misconfigured deploy.
- Fix: filter `deleted_at`; refuse to push without a site URL. Effort S · Status: New

### [Low] ENG-205: Provider-attested firmographics stored as `kind: fact` with a login-gated source
- Confidence: CONFIRMED (code)
- Where: `enrich-company.ts:191-206`
- Impact: counted with first-party facts in fact badges; the "source" is an Apollo app URL most viewers cannot open. Claim text does say "according to apollo" and `reliability: provider_attested`.
- Fix: ensure fact counts exclude `provider_attested` or label them separately. Effort S · Status: New

---

## 7. Feature status (§6 vocabulary)

| Feature | Status | Evidence |
|---|---|---|
| Provider seam (cache → budget → retries → ledger → cache) | Implemented, unverified (fakes only; vendors never called) | `call.ts`; verify-providers.ts |
| Atomic provider spend (0050) | Partial — code in repo, migration not applied | PROV-201 |
| Apollo adapter | Implemented, unverified (request shapes never seen live) | PROV-005 |
| Hunter / ZeroBounce adapters | Implemented, unverified | adapters |
| Provider breaker | Implemented, unverified; per-org | PROV-204 |
| Discovery (provider) | Implemented, unverified | discover-companies.ts; verify-jobs.ts |
| First-run onboarding stages | Broken (status reporting) | ENG-201 |
| Company enrichment | Implemented, unverified; refusal loop | ENG-202 |
| Person enrichment | Implemented, unverified | PROV-202 |
| Research (web_fetch) | Implemented, unverified | AI-204 |
| Qualify / score | Implemented, unverified (model output; parse tested) | AI-202 |
| Score recompute | Implemented, unverified | recompute-scores.ts |
| Entity resolution / site profile on every create | Partial (0050 trigger not live; discovery path only) | FLOW-106 |
| Org learning (analyze_performance) | Implemented, unverified; proposals only | analyze-performance.ts |
| Personal preferences | Implemented, unverified | AI-205 |
| AI run ledger / cost | Implemented, unverified | AI-201, AI-203 |
| AI budget | Partial (run count, fails open in jobs) | AI-201 |
| HubSpot connect (private-app token) | Implemented, unverified | integrations/actions.ts |
| HubSpot OAuth / token refresh | Missing (not needed for private-app tokens; not planned in code) | — |
| HubSpot push | Implemented, unverified; idempotency gap | CRM-201, CRM-202 |
| HubSpot inbound sync / webhooks / cursor | Missing | none in repo |
| Live check script | Implemented, unverified (not run, by rule) | ENG-204 |

## 8. Baseline diff (my areas)

| Pass-15 ID | Now | Proof |
|---|---|---|
| PROV-003 | Fixed | `enrich-person.ts:29,80-96` uses `matchPerson`/`verifyEmail`; no vendor hosts outside `packages/providers` and `packages/crm` (grep) |
| PROV-005 (placeholder) | Fixed; request shapes still unverified | `apollo.ts:302`; `isPlaceholderEmail` in `enrich-person.ts:99-102` |
| PROV-015 | **Fixed in repo, not live** | `budget.ts:88-137`, 0050 MISSING; probe |
| PROV-016 / TRUST-102 / TRUST-103 | Fixed | `fetch-company-signals.ts:127-128,199` (`observed_at` vs `event_date`); ownership check not re-traced in full |
| TRUST-101 | Fixed | `profile-company.ts:26-43` |
| AI-002b | Fixed (domain half); grounding remainder new as AI-204 | `research-company.ts:232-238` |
| AI-004 | Fixed for snapshots; fallback models not priced (AI-203) | `models.ts:pricedModel` |
| AI-009 | Fixed | `sync-mailbox.ts:128-140` |
| AI-010 | Fixed (ledger); quota side open (AI-201) | `client.ts:withUsage`, `task.ts` catch |
| AI-011 | Fixed | `client.ts` `max_uses: 5`, `max_content_tokens: 20_000` |
| AI-012 | Fixed | `extract-signals.ts:299-305` |
| FLOW-103 | Fixed | `score-opportunity.ts:490-510`; verify-jobs.ts FLOW-103 block |
| FLOW-104 | Fixed (signals); enrich analogue new ENG-202 | `fetch-company-signals.ts:95-97` |
| FLOW-106 | **Fixed in repo, not live** (0050 trigger) | `0050:192-220` |
| FLOW-108 | Fixed for good verdicts; bad-verdict downgrade new PROV-202 | `enrich-person.ts:145-155`; verify-jobs.ts:4272 |
| CRM `loadEmail` | Fixed | `sync-hubspot.ts:247-257` |
| CRM-002 | Still open → CRM-201 (High) | `sync-hubspot.ts:166-172` |
| CRM-003 / CRM-005 | Still open → CRM-202 | `hubspot.ts:186-236` |
| MAP-003 | Still open (no `competitors` writer from discovery) — not re-traced in depth | grep: `competitors` written only by competitor flows |
| preclassify footer | Not re-checked (outreach reviewer) | — |

## 9. Checked, nothing found

- **Vendor calls outside the seam:** grep for `api.apollo.io|api.hunter.io|zerobounce.net|api.hubapi.com` across `*.ts|*.tsx|*.mjs` → only adapters and `packages/crm/src/hubspot.ts` (plus a web test).
- **Retry policy:** 3 attempts, exponential backoff with jitter, failures never cached, 429 not counted toward breaker (`call.ts:56-62,260-291`; `0011:290-310`).
- **Cache keys include org:** `provider_cache` read/write filtered by `org_id` (`cache.ts`), so no cross-tenant answer reuse.
- **Discovery resume/cost on retry:** failed page → run `failed`; retry re-reads page 1 from the 24 h cache at no cost.
- **Prompt injection wrapping:** every task wraps untrusted inputs, including memories in `sales_agent` (`:237-240`) and house style in `personalize_message` (`:355`).
- **Refusal/max_tokens/pause_turn handling** in `client.ts`: checked before parsing; continuation bounded at 5.
- **Thinking config:** no `budget_tokens`, no `disabled`, no forced `tool_choice`, no sampling params — all 400 on Opus 5.5 / Sonnet 5.5 per reference; none present.
- **`/api/jobs/tick` 404:** the route's own response to a missing/wrong bearer (`apps/web/app/api/jobs/tick/route.ts`, `safeEquals` branch), listed as handled in `proxy.ts:105-113`. Expected, not a bug.
- **Runbook feasibility (`docs/operations/first-live-run.md`):** step 0 `db:doctor` exists; step 1 `migrate.yml` has `workflow_dispatch` and passes `MIGRATIONS_BASELINE` (`.github/workflows/migrate.yml:20,40`), migrator reads it (`packages/db/scripts/migrate.ts`); step 2 `npm run live-check` exists (`package.json:22`) — caveats ENG-204; step 3 dev on port 3100 (`apps/web/package.json:7`), tick accepts GET with bearer; step 4: postal address setting exists (`settings/OrgSettingsForm.tsx`), Gmail callback route `api/mailboxes/[provider]`, ICP under Settings → ICP (doc says "Profiles"), discovery via dashboard "Hunt now" (doc says "Discovery: run it"; no page by that name), Companies add, Imports, Outreach campaigns exist. All steps are possible; labels differ. Plan cap of 25 credits/provider/month (`0047:421`) can be exhausted by one first run, which the runbook does not mention.

## 10. Not verified (and what would settle it)

| Item | Access needed |
|---|---|
| Apollo/Hunter/ZeroBounce request shapes, credit costs per call, whether credential check costs a credit | `npm run live-check -- --spend` by the owner, then Apollo usage page |
| Anthropic behaviour: `explain_performance` 900-token cap, fallback-served model ids, real token cost per research/qualify | one live run; `ai_runs` rows after runbook step 4 |
| First-run stage duration vs 60 s limit | timing during runbook step 4 on Vercel |
| HubSpot: deal creation without `dealstage`, duplicate behaviour, PATCH overwrite | a test HubSpot portal |
| 0050 behaviour in Postgres (advisory lock, settle at month boundary) | apply 0050 to a non-prod project; db tests in PGlite cover syntax only |
| pg_cron schedule for `prune_provider_cache` | Supabase dashboard → Database → Cron, or `select * from cron.job` |
| Grounding (AI-204) frequency | compare `evidence.source_url` vs fetched URLs on real research runs |
