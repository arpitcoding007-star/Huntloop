# Pass 21 — Raw C: Engine · Providers · AI · CRM

Branch `feat/pass-21-loop` @ `dab37db`. Read-only. No network or provider calls were made.

Offline test runs (provider/AI keys unset, fetch mocked by each script):
- `packages/providers` verify-providers: 109/109 PASS
- `packages/ai` verify-tasks: 289/289 PASS
- `packages/crm` verify-crm: 20/20 PASS
- `packages/jobs` verify-jobs: 615/615 PASS (simulation not run, because it needs a local backend)

None of the findings below is covered by an existing check. Every one of them passes the current suites.

---

## Findings

### [P1] ENG-001: A discovery run that dies mid-flight blocks its saved search forever
- **Confidence:** CONFIRMED that nothing recovers the run. LIKELY that the trigger (a 60s function kill) happens in production.
- **Where:** `packages/jobs/src/handlers/discover-companies.ts:147-152, 348-373`; `packages/db/migrations/0014_discovery.sql:188-190`; `packages/db/migrations/0057_icp_retires_discovery.sql:58-61`; `apps/web/app/api/jobs/tick/route.ts:45`
- **Evidence:**
  - The run row is set to `running` (line 154). It reaches a terminal state only through `finish_discovery_run` (line 263), which runs in-process.
  - If the function is killed (`maxDuration = 60`), the row stays `running`.
  - The retried job payload is `{queryId}` with no `runId`, so `openRun` inserts a new run. The `discovery_runs_one_open_per_query` unique index rejects it (23505), and the job returns `ok:true, skipped: "already in progress"`.
  - `claim_due_discovery_queries` excludes any query that has a `queued`/`running` run (0057:58-61).
  - grep finds no reaper for `discovery_runs`. No producer passes `runId` (only `discover-companies.ts:84,147`), so the resume path is unreachable.
- **Impact:** The saved search silently stops running for good. The UI shows it enabled, with no error. One run can make up to 5 pages × 3 attempts × 15s of provider time plus about 125 sequential DB writes, which can exceed the 60s budget.
- **Root cause:** Liveness depends on in-process completion. There is no lease or heartbeat on the run, and the queue retry does not carry the run id.
- **Fix (smallest):** Store `started_at` and treat `running` runs older than N minutes (for example 10) as abandoned. In `openRun`, on 23505, select the open run for the query. If it is stale, adopt it (resume from `page_cursor`); otherwise skip. Add the same staleness predicate to the `not exists` in `claim_due_discovery_queries`.
- **Acceptance:** A run left `running` with `started_at` 15 minutes ago is resumed by the next `discover_companies` for that query, and the query is claimable again.
- **Test to add:** In verify-jobs, seed a `running` run 15 minutes old, invoke `discoverCompanies({queryId})`, and assert the stale run is resumed (not skipped) and reaches a terminal status.
- **Effort:** M

### [P1] ENG-002: Enrichment refresh stamps nothing when it fails, so 10 stuck companies starve every tenant
- **Confidence:** CONFIRMED (code read)
- **Where:** `packages/jobs/src/handlers/schedule-followups.ts:87-113`; `packages/jobs/src/handlers/enrich-company.ts:78-82, 108-116`; claim at `packages/jobs/src/runner.ts:253-256` ("every branch sets a marker")
- **Evidence:**
  - Branch 3 selects hot/warm opportunities whose company has `last_enriched_at` null or stale, with `.limit(10)` across all tenants and no `order`. It sets no requested-at marker.
  - `enrich_company` writes `last_enriched_at` only on success or "not found". It does not write it on:
    - `ProviderRefused` (budget exhausted, breaker, no provider, bad key): line 113
    - no usable domain (permanent failure): line 81
    - transient error: line 115
  - The same rows are therefore re-selected and re-enqueued on every tick. The same failure pattern was fixed for signals (FLOW-104, `fetch-company-signals.ts:108-110`) but not here.
- **Impact:**
  - **Cross-tenant stall.** Once 10 hot/warm opportunities point at unenrichable companies (no domain, or one org's credits exhausted), enrichment refresh stops for every org, with no error shown.
  - **Noise every tick.** Each tick adds 10 job rows and, for budget refusals, ledger rows that never stop.
- **Root cause:** A cross-tenant sweeper with no "attempted" marker and no fairness ordering.
- **Fix (smallest):** Have `enrich_company` stamp the company on refusal and on permanent failure, as FLOW-104 does for signals. Either add `enrich_attempted_at` or set `last_enriched_at` with the outcome. Add `.order("companies.last_enriched_at", {nullsFirst:true})` to the sweep query.
- **Acceptance:** A refused or no-domain company is not re-enqueued within `STALE_AFTER_DAYS` (or a shorter retry window), and other orgs' stale companies are reached on the next tick.
- **Test to add:** Seed 10 opportunities whose companies have no domain plus 1 enrichable company in another org. Run `scheduleFollowups` twice with the handler in between, and assert the enrichable company is enqueued.
- **Effort:** S

### [P2] CRM-001: A failed association after deal creation is never retried, and a duplicate deal is possible
- **Confidence:** CONFIRMED
- **Where:** `packages/jobs/src/handlers/sync-hubspot.ts:169-180, 266-271`
- **Evidence:**
  - The order is `createDeal` (174), then `linkExternal` (177), then `associate(...)` (178-179).
  - If `associate` throws a retryable `CrmError` (429/5xx), the job retries. On the retry, `existingDeal` is found and the update branch (170-172) runs, and that branch never associates.
  - `linkExternal` ignores the upsert error (266-271). If that write fails, the retry takes the create branch again and creates a second deal.
- **Impact:** Some HubSpot deals have no company or contact association (invisible in account views). Some opportunities get duplicate deals.
- **Root cause:** The create-and-associate sequence is not idempotent. Association is tied to the create branch, and the mapping write is unchecked.
- **Fix (smallest):**
  - Run the associations on both branches. HubSpot's v4 default-association PUT is idempotent.
  - Check `linkExternal`'s error and fail (retryable) before any further remote call.
- **Acceptance:** With `associate` failing once and then succeeding, the deal ends up associated, and exactly one `createDeal` call is made across retries.
- **Test to add:** In verify-crm or verify-jobs, mock fetch so the first PUT `/associations` returns 503. Run `syncHubspot` twice and assert one POST `/deals` and that the associations PUT succeeded on run 2.
- **Effort:** S

### [P2] CRM-002: Contacts without an email, and companies without a domain, are re-created in HubSpot on every sync
- **Confidence:** CONFIRMED
- **Where:** `packages/crm/src/hubspot.ts:192-200, 210-218`; `packages/jobs/src/handlers/sync-hubspot.ts:138-150`
- **Evidence:**
  - `existingId = input.email ? searchOne(...) : null`, followed by an unconditional POST create. The same pattern applies to `domain` for companies.
  - `loadEmail` returns null whenever no sendable email exists (254-263), which is common.
  - The HubSpot id stored in `external_ids` (`linkExternal`, 141/149) is never consulted before creating.
- **Impact:** Every re-push of an opportunity (a "Sync to CRM" click sets `crm_sync_requested_at`) creates another duplicate contact or company in the customer's CRM.
- **Root cause:** Dedup relies only on a natural key that may be absent. The local mapping table is write-only.
- **Fix (smallest):** Before creating, look up `external_ids(provider='hubspot', entity_type, entity_id)`. If a mapping exists, PATCH that id. Create only when there is neither a mapping nor a natural-key match.
- **Acceptance:** Two syncs of an opportunity whose person has no email produce exactly one POST `/contacts`.
- **Test to add:** Mock HubSpot, sync twice with an email-less person, and count POST `/crm/v3/objects/contacts`.
- **Effort:** S

### [P2] CRM-003: After reconnecting to another portal, or after a deal is deleted in HubSpot, the opportunity fails permanently
- **Confidence:** CONFIRMED (code). The 404 class is inferred from `request()` handling.
- **Where:** `apps/web/app/(app)/[org]/settings/integrations/actions.ts:62-76, 95`; `packages/jobs/src/handlers/sync-hubspot.ts:160-172, 216-219`; `packages/crm/src/hubspot.ts:84-90`
- **Evidence:**
  - Disconnect deletes only `hubspot_connections`. Connect upserts a new token and `hub_id` without comparing it to the previous `hub_id`.
  - `external_ids(provider='hubspot')` survives. The next sync PATCHes the old deal id, which returns 404.
  - That surfaces as `CrmError` with `retryable:false`, so the job fails permanently. There is no 404 fallback to create.
- **Impact:** After a portal switch, or after a user deletes the deal in HubSpot, the opportunity can never sync again. The connection shows a 404 error.
- **Root cause:** HubSpot object mappings are not scoped to a portal, and a vanished remote object is not handled.
- **Fix (smallest):**
  - On connect, if `hub_id` differs from the stored one (or on disconnect), soft-delete `external_ids` where provider='hubspot' for the org.
  - In `updateDealHuntloopFields`, treat 404 as "mapping stale": delete the mapping and fall through to create.
- **Acceptance:** A PATCH that returns 404 leads to one new deal and a replaced mapping. Reconnecting to a different `hub_id` clears the mappings.
- **Test to add:** Mock PATCH `/deals/{id}` returning 404 and assert that a create and a re-link follow.
- **Effort:** S

### [P2] PRV-001: HTTP 200 bodies with an unexpected shape are treated as real answers (billed, cached, or silently "unknown")
- **Confidence:**
  - CONFIRMED that the guard exists only for `person.match`.
  - LIKELY for the ZeroBounce trigger. ZeroBounce returns HTTP 200 with an `error` field for a bad key or exhausted credits; that is vendor behaviour, not verified offline.
- **Where:** `packages/providers/src/adapters/zerobounce.ts:90-101`; `packages/providers/src/adapters/apollo.ts:449-462, 490-499`; compare the PROV-301 guards at `apollo.ts:552-557` and `hunter.ts:121-126`
- **Evidence:**
  - ZeroBounce: `mapStatus(body.status)` turns an absent status into `"unknown"`, with credits 1 and outcome `ok`. The result is not cached, but it is billed in the ledger, reserved against budget, and never trips the breaker or marks the credentials bad.
  - Apollo search: a 200 without `organizations`/`accounts` becomes `items: []`, which is recorded as `empty` and cached for 24h.
  - Apollo enrich: a 200 without `organization` becomes null, which is cached for 30 days (`index.ts:191-196` asserts "an outage throws").
- **Impact:**
  - When ZeroBounce credits run out, every address silently becomes "unknown" (unsendable) while our ledger charges credits.
  - An Apollo shape change or error-in-200 makes the market look empty for a day and companies look unenrichable for a month.
- **Root cause:** Response-shape validation is applied per call site (PROV-301) rather than as an adapter rule for every capability.
- **Fix (smallest):**
  - ZeroBounce: if `body.error` is set or `status` is not a string, throw `ProviderError` (retryable:false, with the message). Mark a credit or key message as a credential failure.
  - Apollo: throw when the expected top-level key (`organizations|accounts`, `organization`) is absent.
- **Acceptance:** A 200 `{"error":"..."}` from ZeroBounce produces outcome `failed` with 0 credits. A 200 `{}` from Apollo search or enrich is not cached.
- **Test to add:** In verify-providers, mock fetch to return 200 `{error:"Invalid API key"}` from `/validate` and 200 `{}` from `/organizations/enrich`. Assert `failed` and no `provider_cache` write.
- **Effort:** S

### [P3] PRV-002: Rate-limit retries ignore Retry-After and wait under 2 seconds
- **Confidence:** CONFIRMED
- **Where:** `packages/providers/src/call.ts:57-60, 277-283`; adapters' 429 branches (`apollo.ts:152`, `hunter.ts:58`, `zerobounce.ts:44`)
- **Evidence:** `backoffMs` waits 0.5–1s, then 1–2s. The `Retry-After` header is never read.
- **Impact:** Against per-minute vendor limits, all three attempts fail. The job then fails and the breaker counts it, which defeats the jitter rationale in the file header.
- **Fix:** Carry `retryAfterMs` on `ProviderError` (parsed in each 429 branch). In `spend`, sleep `max(backoff, retryAfter)` capped at about 10s; give up early if it exceeds the cap.
- **Acceptance / Test:** A 429 with `Retry-After: 3` waits at least 3s before attempt 2 (fake timers or an injected sleep).
- **Effort:** S

### [P3] PRV-003: The enrichment quota is charged on cache hits, and the enrich cache key changes after the first link
- **Confidence:** CONFIRMED
- **Where:** `packages/jobs/src/handlers/enrich-person.ts:124-128, 196-200`; `packages/jobs/src/handlers/enrich-company.ts:86-107`; `packages/providers/src/index.ts:184`
- **Evidence:**
  - `increment_usage_internal('enrich')` runs regardless of `match.meta.outcome === "cache_hit"`. `rank_contacts` re-enqueues `enrich_person` for every unverified top contact on each run, once per opportunity.
  - The `company.enrich` request hash includes `providerId`. That is null on the first call and set after `linkExternal`, so the 30-day cache misses once per company and the enrichment is paid again.
- **Impact:** The customer's monthly enrich quota drains without any new lookup, and each company costs one extra paid enrichment.
- **Fix:** Increment only when `meta.outcome !== "cache_hit"`. Drop `providerId` from the enrich hash, since Apollo enrich ignores it (`apollo.ts:481-483`).
- **Effort:** S

### [P3] AI-001: Cost and provenance are slightly wrong (Sonnet 5.5 cache-read price; served model not recorded)
- **Confidence:** CONFIRMED against the claude-api reference (cached 2026-11-03).
- **Where:** `packages/ai/src/models.ts` PRICES (`sonnet cacheRead: 0.2`); `packages/jobs/src/handlers/score-opportunity.ts:315`; `packages/ai/src/client.ts:137-139`
- **Evidence:**
  - Sonnet 5.5 cache reads cost $0.10/MTok; the code uses $0.20, so cost is over-estimated.
  - `model_version` is stored as `qualify_opportunity@<date>`, not `run.model`.
  - With `fallbacks: "default"`, a refused request may be served by another model. `pricedModel` then falls back to the routed price, and the score row cannot show which model produced it.
- **Fix:** Set the Sonnet cache-read price to 0.10. Store `run.model` in `opportunity_scores.model_version` (or a new `served_model`) and in `ai_runs`.
- **Effort:** S

### [P3] AI-002: The AI run quota is check-then-act, and failed billed runs do not count
- **Confidence:** CONFIRMED
- **Where:** `packages/jobs/src/ai.ts` `withinBudget` → `runTask` → `increment_usage_internal` (only after success)
- **Impact:** Parallel lanes can overshoot `ai_runs`. Refused or invalid-JSON runs that were billed (AI-010) never consume quota.
- **Fix:** Reserve atomically, as `reserve_provider_credit` does, or at least increment in `finally` when `usageOf(error)` is non-null.
- **Effort:** M

---

## Verified OK (no finding)
- **Budget reservation is atomic.** `reserve_provider_credit` takes `pg_advisory_xact_lock`, then checks and increments in one statement (0052); it is settled in `finally` (`call.ts:208-213`).
- **Cache keys include the org.** `provider_cache` is keyed `(org_id, request_hash)`; the hash includes capability and provider (`cache.ts`).
- **Timeouts.** Every adapter and the CRM client use a 15s `AbortSignal.timeout`. The Anthropic SDK has `maxRetries: 0` and a 55s timeout. Pause/kill switches sit before spend.
- **Missing keys fail loudly.**
  - Providers: no adapter gives a `no_provider` refusal that reaches the screen.
  - AI: `AiUnavailable` gives a skip, never fabricated output. No demo or fixture path exists in jobs, AI, providers or CRM.
- **Job coverage.** `HANDLERS: Record<JobName, JobHandler>` is total. Every `enqueue({name})` and the SQL trigger (0050: `resolve_entity`, `profile_company`) name registered jobs.
- **AI hardening.**
  - Every task uses `wrapUntrusted` and `UNTRUSTED_CONTENT_RULE`.
  - Schema-constrained output plus a per-task `parse` validator (for example `qualify-opportunity.ts:429-508`) runs inside `runTask`'s try, so an invalid result is recorded as a failed, billed run and is not persisted.
  - Model ids (`claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`), `web_fetch_20260209`, `server-side-fallback-2026-07-01`, adaptive thinking, explicit effort, and `pause_turn` resume are all current.
- **Learning has sample-size guards.** `MIN_LEARNING_SIGNALS = 8` (`analyze-performance.ts:106`); `MIN_PREFERENCE_SUPPORT = 3`, enforced in both the schema and the parser.
- **Scoring is explainable but not deterministic.** By design, the model gives one holistic 0–100 score with a stated reason (§51), and `applyRules` adds a deterministic, traced overlay. `model_score` and the rule score are stored separately.

---

## Integration inventory

| Service | Where | Creds (env names) | Timeout | Retry | Rate limit handling | Status |
|---|---|---|---|---|---|---|
| Apollo | `packages/providers/src/adapters/apollo.ts` | `APOLLO_API_KEY` (header `x-api-key`) | 15s | 3 attempts, exponential with jitter (`call.ts`); 5xx/429/transport only | 429 → `rate_limited`; DB breaker; Retry-After ignored (PRV-002) | Works; 200-shape gap (PRV-001); `/mixed_people/search` deprecation not checked (UNVERIFIED) |
| Hunter | `packages/providers/src/adapters/hunter.ts` | `ENRICHMENT_API_KEY` (query `api_key`) | 15s | same | same | Works; key in URL query (P3 hygiene); 404 billed as 1 credit in ledger |
| ZeroBounce | `packages/providers/src/adapters/zerobounce.ts` | `EMAIL_VERIFICATION_API_KEY` (query `api_key`) | 15s | same | same | 200-with-error mapped to "unknown" (PRV-001) |
| Anthropic | `packages/ai/src/client.ts`, `packages/jobs/src/ai.ts` | `ANTHROPIC_API_KEY`, `HUNTLOOP_AI_TIMEOUT_MS` | 55s default | none in-call (queue retries) | `withinBudget` quota (not atomic, AI-002); ops pause | Current models and features; cost table off for Sonnet cache reads (AI-001) |
| HubSpot (private app token, no OAuth, so no refresh needed) | `packages/crm/src/hubspot.ts`, `packages/jobs/src/handlers/sync-hubspot.ts` | token stored encrypted in `hubspot_connections` (encryption-key env per `@huntloop/db`) | 15s | queue retry for 5xx/429/transport; 401/403/4xx permanent | 429 → retryable | Duplicates and associations (CRM-001/002), stale mappings (CRM-003); failures visible in `last_sync_error` |
| Company sites / job boards | `packages/jobs/src/fetch.ts`, `ats.ts` | none | `DEFAULT_TIMEOUT_MS` (fetch.ts:257) | retryable flag only | n/a | not reviewed in depth |
