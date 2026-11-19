# HuntLoop Engine — Technical Explanation

> **Basis:** reverse-engineered from the source on `main` @ `8021d3f` (working tree has uncommitted doc changes only). Investigation only — no application code, schema or configuration was modified.
> **Date:** 2026-10-30.
> **Companion files:** [`HUNTLOOP_ENGINE_ARCHITECTURE.md`](HUNTLOOP_ENGINE_ARCHITECTURE.md) (diagrams) · [`HUNTLOOP_ENGINE_SIMPLE_GUIDE.md`](HUNTLOOP_ENGINE_SIMPLE_GUIDE.md) / [`.pdf`](HUNTLOOP_ENGINE_SIMPLE_GUIDE.pdf) (plain-language version).

---

## 0. How to read this document

Every statement carries one of these tags where it matters:

| Tag | Meaning |
|---|---|
| **[CODE]** | Read directly in source during this investigation. File paths are given. |
| **[SCHEMA]** | Read in a SQL migration under `packages/db/migrations/`. |
| **[DOC]** | Taken from the repo's own docs/audits, *not* re-verified in code. |
| **[INFERRED]** | A conclusion drawn from code, not stated by it. |
| **[UNVERIFIED]** | Cannot be confirmed from source alone (needs a live vendor, database or deployment). |
| **[NOT READ]** | I did not open this area in depth; treat claims about it as unknown. |

**Scope honesty.** The repo is ≈ 130 k lines (`AUDIT.md`). I read in full or near-full: the job queue, runner, registry, scanning, extraction, fetch/SSRF guard, scoring, the rules engine, the AI task framework and client, discovery, the provider pipeline, contact ranking, entity matching, outreach advancement and sending, reply sync, and the schedulers. I read headers and key logic of the learning, competitor, demand, preferences, retention and notification handlers. I did **not** read the 54 UI pages, the Apollo/Hunter/ZeroBounce adapter bodies, Gmail/Outlook/HubSpot client bodies, or most of the 3,800-line migration verification script. Those are marked **[NOT READ]** where relevant.

**Key numeric corrections to the repo's own docs.** `docs/architecture/engine.md` says "26 handlers, 9 sweepers". The code today has **34 job names** (`packages/jobs/src/registry.ts`) and **14 sweepers** (`packages/jobs/src/runner.ts`). `docs/status/technical-debt.md` lists plan limits as unenforced; the code now checks `emails` (`send-message.ts`) and `opportunities` (`score-opportunity.ts`) quotas. Use code over those docs.

---

## 1. What the engine is

HuntLoop is a multi-tenant B2B "sales intelligence" web app. Its **engine** is the set of background processes that turn a customer's description of who they sell to (an *ICP* — ideal customer profile) into a ranked list of **opportunities**: companies worth contacting *now*, with sourced evidence, the best person to contact, and a drafted message — and then learns from what happens.

The engine is **not** a separate service. It is:

1. A **Postgres job queue** (`job_executions` table) [SCHEMA 0001/0008],
2. A **TypeScript runner** (`packages/jobs`) that claims and executes jobs [CODE],
3. Driven by a **timer outside the app** (GitHub Actions or Inngest) that calls an HTTP endpoint every 5 minutes [CODE: `apps/web/app/api/jobs/tick/route.ts`, `.github/workflows/tick.yml`],
4. Using **Claude models** for judgement tasks (`packages/ai`) and **third-party data APIs** for facts (`packages/providers`) [CODE].

The product's central loop, as the code names it (`analyze-performance.ts` header):

```
Discover → Understand → Qualify → Prioritize → Act → Track → Learn
```

### Design philosophy that shapes the code [CODE]

These rules recur in comments and enforcement code; understanding them explains most "odd" design choices:

- **Fact / inference / unknown** — every claim is classified. A `fact` *must* have a source URL (`packages/ai/src/claims.ts`); an `unknown` may not carry confidence or a source.
- **"Unknown" is never zero.** Score dimensions are nullable; `"unknown"` is stored as `NULL` (`score-opportunity.ts → dimension()`).
- **Say "no" / say "I don't have a key".** With no `ANTHROPIC_API_KEY`, AI paths return a labelled skip (`AiUnavailable`), never fabricated output (`packages/jobs/src/ai.ts`).
- **Models propose; deterministic code and humans dispose.** Rules, ranking, safety gates, and quota checks are plain code; model output is schema-validated and cross-checked.
- **Fail closed on anything irreversible** (sending email), **fail open on counters** (quota read errors do not stop work).
- **Tenant isolation in layers:** Row Level Security in Postgres (the real boundary), plus `OrgScope` in the runner, plus 404-not-403 on cross-org URLs.

---

## 2. Repository and runtime topology

| Path | Role | Evidence |
|---|---|---|
| `apps/web` | Next.js 16 + React 19 app: UI, server actions, API routes, edge `proxy.ts` | `apps/web/package.json` |
| `packages/jobs` | The engine: queue, runner, 34 handlers, fetch, extraction, mailbox clients, email sender | CODE |
| `packages/ai` | 16 Claude "tasks", prompts, JSON-schema output, parsers, model routing, cost estimate | CODE |
| `packages/providers` | Data-vendor abstraction: Apollo, Hunter, ZeroBounce adapters; cache, budget, breaker, ledger | CODE |
| `packages/db` | Migrations 0001–0047, typed domain logic (rules, ICP, identity, contact ranking, needs-you, style), admin/server/browser clients, doctor/seed scripts | CODE/SCHEMA |
| `packages/crm` | HubSpot contract + implementation | CODE [NOT READ in depth] |
| `packages/ui` | Shared React component library | [NOT READ] |
| `scripts/audit.mjs`, `scripts/bundle-budget.mjs` | 44 repo-structure checks, JS bundle budget | [DOC] |
| `e2e/` | Playwright suite (desktop + mobile) | [DOC] |

**Stack (from `package.json`):** Node ≥ 22.6, TypeScript, Next `^16.4`, React `^19`, Tailwind `^4`, Zod `4.4.3`, Supabase (`@supabase/ssr`, `supabase-js`), `@anthropic-ai/sdk ^0.116`, `undici ^8` (guarded fetch), Sentry `10.70`, Vitest 4, Playwright. Hosting is Vercel (+ Supabase Postgres/Auth). No ORM; PostgREST via supabase-js plus SQL functions (RPC).

**Runtime shape.** Everything runs inside Vercel serverless functions. The engine's function is `/api/jobs/tick` with `maxDuration = 60` s (`tick/route.ts`). There is no long-lived worker process.

---

## 3. The queue and the runner

### 3.1 The queue (`packages/jobs/src/queue.ts`, `0008_engine_columns.sql`)

`job_executions` is the queue. Key columns: `org_id` (nullable for sweepers), `job_name`, `payload` JSON, `status` (`queued → running → succeeded|failed`), `attempts`, `max_attempts` (default **3**), `run_at`, `idempotency_key`, `locked_at/locked_by`, `error`, `result`.

| Operation | Implementation |
|---|---|
| **enqueue** | Plain `INSERT`. A unique-violation (`23505`) on `idempotency_key` returns `{created:false}` — it is *not* an error. This is how "ten articles about one company → one scoring job" works (`idempotencyKey: "score:<companyId>"`). |
| **claim** | RPC `claim_job_executions(p_limit, p_worker)` — selects due `queued` rows `ORDER BY run_at … FOR UPDATE SKIP LOCKED`, marks them `running` [SCHEMA 0008 l.304–330]. Concurrent workers get disjoint sets. |
| **succeed** | Sets `succeeded`, stores the handler's `result` JSON. |
| **fail / retry** | `markFailed`: if `permanent` or `attempts ≥ max_attempts` → `failed`; else back to `queued` with `run_at = now + min(attempts², 60) minutes` (1, 4, 9 … capped 60 min). Error text truncated to 2,000 chars. |
| **stalled recovery** | RPC `requeue_stalled_jobs(older_than = 10 minutes)` returns `running` rows with a stale `locked_at` to the queue. Called at the start of every tick. pg_cron also calls it where the extension exists [SCHEMA 0008 l.371–384]. |

**Delivery semantics: at-least-once.** A handler may run twice; every handler is written to be idempotent or to detect prior completion (e.g. `send_message` uses `send_attempted_at`, see §10).

### 3.2 The runner (`runner.ts`)

```
tick({limit=5, deadline, reserveMs=20 s, worker})
  1. requeueStalled()                 ← rescue before taking new work
  2. claim(limit)                     ← up to 5 jobs, SKIP LOCKED
  3. for each job, sequentially:
       if now > deadline - reserve → give job back (markFailed, retryable); stoppedEarly = true
       else runOne(job)
  4. return TickReport {claimed, succeeded, failed, requeued, stoppedEarly, jobs[]}
```

Notable decisions [CODE comments]:

- **Sequential, not parallel** inside a tick. Parallelism comes from multiple ticks (SKIP LOCKED) — *in principle*; the deployment only invokes one tick per 5 minutes (see §3.4).
- **A thrown exception keeps retries** (it is probably transient); a returned `{ok:false, permanent:true}` does not.
- `runOne` binds each job to `new OrgScope(job.org_id, adminClient())`. A job with no `org_id` that is not in the `SWEEPERS` set fails *permanently* ("no org_id") rather than running cross-tenant.
- `OrgScope` (`scope.ts`) wraps a **service-role** Supabase client and injects `org_id` into reads/writes. Sweepers use `OrgScope.global()` explicitly; the nil-UUID scope ensures an accidental scoped read returns nothing.

### 3.3 Sweepers — the heartbeat that creates work

`sweep()` enqueues each sweeper (a job with `org_id = null`) once per tick, with `maxAttempts: 1`. Idempotency keys make overlapping sweeps collapse: plain name (every tick), `name:YYYY-MM-DDTHH` (hourly set), `name:YYYY-MM-DD` (daily set).

| Cadence | Sweepers (14 total) |
|---|---|
| Every tick (~5 min) | `schedule_scans`, `schedule_syncs`, `schedule_sends`, `advance_enrollments`, `schedule_discovery`, `schedule_recomputes`, `schedule_signal_fetches`, `schedule_followups`, `send_notifications` |
| Hourly (key carries the hour) | `schedule_learning`, `send_digests`, `schedule_demand`, `schedule_preferences` |
| Daily | `enforce_retention` |

> **Why it matters:** if no driver calls `sweep()`, the engine "processes whatever it is handed and never notices anything is due". Both the tick route and the Inngest route call `sweep()` then `tick()`.

### 3.4 What starts a tick [CODE]

- `GET|POST /api/jobs/tick` — requires `Authorization: Bearer $CRON_SECRET`; missing secret → **503**, wrong secret → **404** (hides the endpoint). `limit` query param defaults to 5. Always returns **200** even if jobs failed (failures live in the body and `job_executions.error`).
- `POST /api/inngest` — HMAC-verified (`INNGEST_SIGNING_KEY`) alternative; registers a single `huntloop-tick` function on `*/5 * * * *`.
- `.github/workflows/tick.yml` — GitHub Actions `*/5 * * * *` curl to the tick endpoint; fails red if `CRON_SECRET`/`HUNTLOOP_URL` are unset. `apps/web/vercel.json` contains **no `crons`** (Hobby plan only allows daily).

**Throughput ceiling [INFERRED from the above]:** at best 5 jobs per 5 minutes ≈ **60 jobs/hour ≈ 1,440/day**, one at a time, each bounded by ~40 s of useful time (60 s − 20 s reserve). A full pipeline for one company is ~5–6 jobs (§4), so the *theoretical* maximum is on the order of a couple of hundred companies/day per deployment — shared across all tenants. See §14.

---

## 4. End-to-end data flow (the "pipeline")

```
 ┌── Onboarding ──► ICP + product + sources saved
 │
 │   [A] Discovery (paid, structured)            [B] Source scanning (free web)
 │   schedule_discovery → discover_companies     schedule_scans → scan_source
 │        │  provider.company.search                  │ fetch → extract → Haiku signal extraction
 │        ▼                                           ▼
 │   companies (+ discovery_results)            source_documents, source_events,
 │        │                                      evidence, company_triggers, companies
 │        └───────────────┬──────────────────────────┘
 │                        ▼
 │            research_company  (Opus, reads company site, 30-day freshness)
 │                        ▼
 │            score_opportunity (Opus qualify → rules → opportunity + score + evidence)
 │                        ▼
 │   schedule_followups ► rank_contacts(discover) ► enrich_company ► sync_hubspot …
 │                        ▼
 │   Human: approves draft / enrolls in sequence (campaign, autonomy level)
 │                        ▼
 │   schedule_sends → send_message (can_contact gate → Gmail/Outlook)
 │   schedule_syncs → sync_mailbox (read replies → classify_reply → stop sequence)
 │                        ▼
 │   outcomes / human overrides ► schedule_learning → analyze_performance ► findings ► rules/memories
 └──────────────────────────────── loop ────────────────────────────────┘
```

Two ways companies enter: **A.** paid provider search against ICP-derived filters; **B.** free scanning of user-chosen sources (RSS/Atom/JSON feeds or HTML pages), where a small model extracts "signals" naming companies. Both converge on `research_company → score_opportunity`.

---

## 5. Input layer: ICP, profile, sources, onboarding

### 5.1 ICP model (`packages/db/src/icp.ts`, migration `0013_icp_v2.sql`)

An ICP has `criteria` (segments, industries, sizes, employee range, regions, technologies, revenue bands, business models, keywords, triggers, buying signals, pain points, use cases, example companies) and `negative_criteria`/exclusions (industries, regions, keywords, domains, free-text exclusions). `parseIcp()` validates; `isExcluded()` applies exclusions deterministically. ICPs are versioned (`icp_versions`, `bump_icp_version`), and scores record `icp_version_id`.

### 5.2 How the ICP is created

- **Onboarding** (`apps/web/app/(onboarding)/welcome/*`: company → goals → icp → sources → review → building) [pages listed; flow logic **[NOT READ]**].
- `draft_icp` task (Opus, high effort): turns a company website's research into a candidate ICP; exists specifically because an earlier screen used hard-coded placeholder segments (comment cites defect `ICP-02`).
- `recommend_sources` (Opus, medium): proposes places where future customers become visible; output constrained so each recommendation has a `basis`.
- `reach.ts`: asks a provider how many companies match, so the user sees a real market size before spending [CODE header; the number comes from the provider, not inference].
- `look-alike.ts`: resolves "companies like Stripe and Ramp" by enriching each named company and folding industry/size/tech into the search filters (reuses the already metered `company.enrich`).

### 5.3 Public pre-signup research (`public-research.ts`)

The landing page lets an anonymous visitor enter a domain; the engine runs `research_company` and shows the result. Because this is a paid AI call behind an unauthenticated endpoint, it is guarded: `PUBLIC_RESEARCH_ENABLED=true` required, **5 requests per IP-hash per hour**, **global daily ceiling default 200** (`PUBLIC_RESEARCH_DAILY_LIMIT`), enforced in RPC `reserve_public_research`; results cached in `public_research` with an expiry. **Fails closed** on any error.

### 5.4 First-run experience (`first-run.ts`)

A bounded in-process run for a brand-new workspace so results appear while the user watches. Stages: `discover → enrich → score → contacts → explain`. Limits: **1 page** of provider results, **40 credits**, **3 contacts**. It calls the same `HANDLERS` directly (not through the queue). Creates/updates a saved `discovery_queries` row keyed by a hash of canonical filters (`filters_hash`, unique per org). `translateIcp()` returning `empty` aborts: it refuses to search with no filters ("returns the internet").

---

## 6. Discovery — finding companies

### 6.1 ICP → provider filters (`packages/db/src/discovery.ts → translateIcp`)

| ICP field | Becomes |
|---|---|
| industries, regions, technologies, revenue bands | provider filters directly |
| employee range (min/max) | `employeeMin/Max` |
| segments + keywords + business models | one **keyword bag** (lossy; over-returns, later narrowed) |
| exclusion **domains** | `excludeDomains` (only exclusion pushed to the provider) |
| triggers, buying signals, pain points, use cases, example companies | **not mappable** — recorded in `unmapped[]` with a "handled elsewhere" note (applied during qualification) |
| other exclusions | applied *after* the call in `isExcluded` (costs credits but gives a visible reason) |

Every unmapped criterion is stored on the query row (`unmappable`) so the UI can say what the search *isn't* honouring.

### 6.2 Scheduling and the run (`schedule-discovery.ts`, `discover-companies.ts`)

- `schedule_discovery` (sweeper): RPC `claim_due_discovery_queries(10)` — advances `next_run_at` *as part of the claim* (so a crash can't double-run) and **skips saturated orgs** (backpressure, migration 0038: backlog cap default **250**). Enqueues `discover_companies` with key `discover:<queryId>:<hour>`.
- `discover_companies`: opens/resumes a `discovery_runs` row (resumable via `page_cursor`; unique index prevents two live runs). Loop: while `pages < max_pages (default 5)` and `credits < credit_budget (default 100)`: call `searchCompanies` (page size **25**), `absorb()` each result, persist cursor. Stop reasons: `exhausted`, `page_cap`, `credit_budget`, `org_budget`, `breaker_open`, `no_provider`, `provider_error`. A refused/failed provider yields run status `refused`/`failed` — explicitly *not* "empty market".
- `absorb()`: canonicalize domain → no domain ⇒ `invalid`; ICP exclusion ⇒ `excluded` with reason; suppressed ⇒ `suppressed`; known company ⇒ `matched`; else create `companies` row ⇒ `new`. Every outcome is written to `discovery_results` (unique `run_id,provider,provider_id`) — nothing is silently dropped.
- After the run, up to **25** `new` companies get `research_company` jobs (`research:<org>:<company>` key).

### 6.3 Identity and de-duplication (`packages/db/src/identity.ts`)

`canonicalizeDomain()`: lower-case, strip scheme/path/port/credentials/`www.`/trailing dot; reject IPs, bare labels, and a **blocklist of non-identity hosts** (linkedin, github, gmail, notion…). `rootLabel()` handles two-label TLDs (`co.uk`…) with a **hard-coded list** (not the Public Suffix List).

`compareCompanies(a, b)` — ordered match ladder:

| # | Signal | Confidence |
|---|---|---|
| 1 | Same vendor provider-id | high |
| 2 | Same canonical domain | high |
| 3 | Same normalized name + same root label of both domains | medium |
| 4 | Same normalized name + same known country | medium |
| 5 | Same normalized name, country unknown on one side | **low** (never auto-merge) |
| 6 | Same name but *different known countries* | **explicit non-match** |
| 7 | Edit distance ≤ 1 (name ≥ 7 chars) or ≤ 2 (≥ 12 chars), same country | low |

`normalizeName` strips legal suffixes (Inc, GmbH, Ltd, SA …) and diacritics. Exact resolution is synchronous (`resolve_company` SQL function); fuzzy matching is asynchronous and **only proposes** (`merge_candidates`) via `resolve_entity` — a human merges. **Important:** no code enqueues `resolve_entity` (see §14), so fuzzy proposals are currently never produced in the running system.

---

## 7. Source scanning — finding signals on the open web

### 7.1 Scheduling (`schedule-scans.ts`, migration 0008)

`sources` rows carry `scan_interval_minutes` (default **1440**, minimum **5**), `next_scan_at`, `failure_count`, `is_enabled`, `config.etag`. Sweeper picks up to **50** due sources per run (`next_scan_at IS NULL OR ≤ now`, oldest first), skips orgs over the backlog cap *without moving their schedule*, and enqueues `scan_source` (`scan:<sourceId>`).
Failure backoff (SQL `record_source_failure`): `next_scan_at = now + min(interval, 60) × min(2^failures, 24)` minutes. Success resets to `now + interval`.

### 7.2 Fetching safely (`fetch.ts`)

`fetchPage(url, {etag})` — the crawler's outbound policy:

- **Schemes:** http/https only.
- **SSRF defence, twice:** (1) `assertFetchable` resolves DNS and rejects any private/loopback/link-local/CGNAT/multicast/documentation IPv4 or IPv6 address (incl. IPv4-in-IPv6, NAT64, 6to4); (2) an `undici` `Agent` with a custom `connect.lookup` re-checks the address *at connect time* (defeats DNS rebinding). Redirect handling re-validates each hop [CODE: rest of file not fully read].
- **Limits:** timeout **15 s**, max body **4 MiB**, `HuntloopBot/1.0` user agent, conditional GET via ETag (304 → "unchanged").

### 7.3 Extraction (`extract.ts`)

Format sniffing (JSON Feed → RSS/Atom → HTML; else `UnreadableContent`). Produces `ExtractedDocument {url, canonicalUrl, title, publishedAt, text, contentHash}`. `contentHash` = SHA-256 of `title\ntext` so syndicated copies collapse. HTML pages also yield `discoveredFeeds` (`<link rel=alternate>`), saved to `sources.config.discovered_feeds` as a *suggestion* only. Parsing is hand-written regex/string code (no XML/HTML library) [CODE].

### 7.4 The scan handler (`handlers/scan-source.ts`)

```
load source (skip if deleted/paused/no URL)
fetchPage → 304? record_source_success, done
extract(page)
for each doc:  INSERT source_documents (unique url_hash) — duplicate (23505) ⇒ skip
for first 10 NEW docs with ≥ 200 chars of text:
     runForOrg(extractSignals)            ← Haiku, per document
     for each signal: recordSignal(...)
merge_duplicate_evidence(company) for each touched company
record_source_success; maybe store discovered feeds
```

`recordSignal`: resolve/create `companies` by `canonical_domain` (insert-then-reread on race; **no upsert**, so a researched name isn't overwritten), insert `source_events`, insert `evidence` (claim, kind, confidence, source URL, excerpt), and **only if the event has a date and a trigger-type** insert `company_triggers` with `strength` mapped from confidence. Then enqueue `score_opportunity` (`score:<companyId>`).

> **Design rule** (comments): an undated trigger would be "permanently fresh" and would score — so triggers require a date. `research_company` deliberately never writes `company_triggers` (the site has no date).

**Limits:** max 10 model extractions per scan; documents < 200 chars skipped (no model call); a failing extraction increments source failure but doesn't fail the job.

---

## 8. AI subsystem (`packages/ai`)

### 8.1 Task framework (`task.ts`)

An `LLMTask<TInput,TOutput>` bundles: `name`, versioned `prompt`, JSON `schema`, `maxTokens`, `renderInput`, optional `fetchDomains`, a strict `parse(json, input)` and an `entity` label. `runTask` does: look up route → record `ai_runs(started)` with `input_hash` → call the client → `parse` (throws on any contract violation) → compute `costCents` → record success/failure.

**Prompt versioning:** `definePrompt(name, text)` → `version = name@sha256(text)[0:12]`. Prompt text changes ⇒ a new version id, stored on `opportunity_scores.prompt_version`, so "scores moved because we edited a prompt" is diagnosable.

### 8.2 Model client (`client.ts`)

Uses Anthropic Messages **streaming** with: adaptive thinking (if the model supports it), `output_config.format = json_schema` (structured output), `effort` per route, a cached system prompt (`cache_control: ephemeral`), a `server-side-fallback` beta, and optionally the server-side **`web_fetch`** tool restricted to `allowed_domains` (max 8 uses) — this is how `research_company`/`qualify_opportunity` read a company's own site *without our crawler*. Handles `pause_turn` (up to 5 continuations, then fails rather than bill forever), `refusal` (typed `ModelRefusalError`; "an answer, not an outage"), `max_tokens` (fails; never parses a truncated answer). SDK retries are **off** (`maxRetries: 0`) — the queue retries. Timeout default **55 s** (`HUNTLOOP_AI_TIMEOUT_MS`).

### 8.3 Routing and cost (`models.ts`)

| Task | Model | Effort | Purpose |
|---|---|---|---|
| `extract_signals` | Haiku 4.5 | medium | Read an article → dated company signals |
| `classify_reply` | Haiku 4.5 | low | 7-label reply classification |
| `research_company`, `qualify_opportunity` | Opus 5 | high | Understand a site; score vs ICP |
| `draft_icp`, `draft_scoring_rules`, `analyze_performance`, `research_competitor` | Opus 5 | high | Policy-shaping drafts |
| `recommend_sources`, `explain_why_now`, `personalize_message`, `sales_agent` | Opus 5 | medium | Sources, why-now, email drafting, per-deal chat |
| `explain_performance`, `workspace_assistant`, `cluster_demand`, `infer_preferences` | Sonnet 5 | medium | Summaries/assistant/clustering |

Price table in code: Opus $5/$25, Sonnet $3/$15, Haiku $1/$5 per million tokens (in/out); cache reads priced at 10 % of input. `estimateCostCents` is **an estimate** stored per run; billing truth lives at the vendor. **[UNVERIFIED]** whether these model ids exist on a given Anthropic account — no live call has ever been observed (`AUDIT.md`).

### 8.4 Defences against the model being wrong or hostile

1. **Untrusted content wrapper** (`untrusted.ts`): web text is wrapped in `<untrusted-RANDOM label=…>` tags and the system prompt carries a rule that retrieved content is data, never instructions (prompt-injection mitigation; best-effort, not a guarantee).
2. **Closed-enum citations**: tasks that cite records (`analyze_performance`, `personalize_message`, `infer_preferences`) constrain citation ids to an enum of the ids actually sent, making cross-tenant citations unrepresentable.
3. **Parsers that throw**: wrong enum, out-of-range score, duplicate/missing dimension, a `HOT` verdict with unestablished ICP-fit/pain/trigger (`PRIORITY_REQUIRES`), a fact with no source, an email naming a forbidden competitor, a body over ~1,080 chars — all raise, failing the run instead of silently "fixing" the model.
4. **Claim validation** (`claims.ts`) at the model boundary, again before write for competitors.
5. **Budget gate** (`jobs/src/ai.ts → runForOrg`): no key ⇒ `AiUnavailable`; `check_quota_internal('ai_runs')` not allowed ⇒ `AiUnavailable`; after a successful run, `increment_usage_internal('ai_runs',1)`. Counter read errors **fail open**.

---

## 9. Qualification, scoring and ranking

### 9.1 `research_company` (handler + task)

- Skips if `last_researched_at` is within **30 days** (unless `force`).
- Runs the Opus `research_company` task on `https://<site>` (web-fetch tool allowed on that domain).
- Writes only into **empty** columns (`description`, `business_model`, placeholder `name`) — never overwrites typed or provider data.
- Stores every finding as `evidence`; a `fact` whose source is *not on the company's own domain* is demoted to `inference` (`onCompanySite`).
- "problem" findings → `company_problems` (severity null).
- Enqueues `score_opportunity`.

### 9.2 `qualify_opportunity` — the scoring task

**There is no numeric formula for the base score.** The model returns a composite 0–100 and its own reasoning; code only validates coherence (`ai/src/tasks/qualify-opportunity.ts`, header: weights are "NOT DEFINED"; inventing them would be presenting an invented number as the product's logic).

Output contract:
- `priority ∈ {hot, warm, watch, ignore}`, integer `score` 0–100, `scoreConfidence ∈ {high, medium, low}`, `priorityReason`, `summary`, `explanation`, `recommendation`.
- **Exactly eight dimensions**, each 0–100 or `"unknown"`: *ICP fit, Problem severity, Evidence strength, Trigger strength, Trigger freshness, Buying likelihood, Product relevance, Decision-maker accessibility.*
- Evidence list (claim, kind, confidence, source URL, excerpt).

Coherence checks: HOT requires ICP fit + Problem severity + Trigger strength **established** (not unknown); WARM requires ICP fit. Otherwise the run fails ("a company with nothing measured is WATCH, not a stretched HOT"). No numeric floors are imposed.

Inputs (`score-opportunity.ts`): company row, the ICP summary (what the org sells, segments, sizes, regions, triggers, exclusions), and up to **25** most recent live (non-deleted, non-superseded) company-level `evidence` rows.

### 9.3 The rules engine (`packages/db/src/rules.ts`) — deterministic post-processing

Customer-authored (or AI-drafted, or learned) rules run **after** the model, as a pure function:

- **Language:** expression tree of `all`/`any`/`not` over conditions `{field, op, value}`. Fields (17): company.{name,domain,industry,country,region,business_model,description,employee_count,tech_stack}, evidence.{claims,kinds}, signals.event_types, score.{model_score,priority}, competitors.{uses,evaluating,former}. Ops: `equals`, `includes` (case-insensitive substring), `gte`, `lte`, `exists`, `missing`.
- **Limits:** depth ≤ 4, ≤ 12 conditions per rule. Adjust weight must be non-zero within **±40**. Floors cannot be `ignore` (use veto).
- **Effects:** `adjust` (add weight to score), `floor` (raise priority at least to a tier), `veto` (force `ignore`).
- **Outcome:** `score = clamp(round(model + Σ weights), 0, 100)`; priority = best floor, overridden by any veto; the full `rule_trace` and both `model_score` and `score` are stored. A malformed rule is skipped, never fatal.
- **Provenance of rules:** `origin ∈ {user, drafted, learned}`; `active_rules_version` hashes the active set and is stored on each score.

> Observation [INFERRED]: floor/veto change `priority` but **not** `score`, so a vetoed opportunity can keep a high numeric score with priority `ignore`.

### 9.4 Persistence and quota

`score_opportunity` upserts `opportunities` on `(org_id, company_id, icp_id)`; a human-set priority (`priority_set_by = 'user'`) is **preserved** (the machine's verdict is still stored in `opportunity_scores`). New opportunities pass `check_quota_internal('opportunities')` first; over-quota ⇒ a *skip*, not a failure. Inserts an immutable `opportunity_scores` row each time: `model_version`, `prompt_version`, `icp_version_id`, `rules_version`, `computed_reason` (initial/new_evidence/rule_change/icp_change/manual/scheduled), `score`, `model_score`, `rule_trace`, the eight dimensions, `confidence`, `explanation`. Opportunity-level `evidence` is replaced (old rows soft-deleted). Status moves `discovered|researching → qualified` only (never drags a contacted deal backwards).

### 9.5 Re-scoring (`recompute-scores.ts`, `0023`)

When rules/ICP change, `request_score_recompute` creates a request; `schedule_recomputes` claims it; `recompute_scores` walks opportunities in pages of **200**, ordered by `company_id` (stable cursor), enqueueing `score_opportunity` per company with the same `score:<id>` idempotency key (collapsing with scan-triggered rescoring). A cancelled request stops via the `advance_recompute` return status. **Cost note:** each rescore is a full Opus call.

### 9.6 Contact ranking (`packages/db/src/contact.ts`, `rank-contacts.ts`)

For each person at the company:

1. **Hard vetoes (score 0):** `employment_status = departed`; title matches any persona's `exclude_titles`.
2. For each ICP persona, compute `titleMatch` (token overlap; ≥ 50 % overlap → 40 + overlap·30 band …), `seniorityFit`, `departmentFit` (from `classifyTitle` → department + seniority rank), `personaMatch = weighted(title×3, seniority×2, department×2)`, `contactability` (best contact point: verified email > unverified email > LinkedIn > phone), `recency` (age of last verification).
3. `total = weighted(personaMatch×5, contactability×3, recency×1)` (null dimensions are excluded from the weighted mean). With **no personas**: `seniorityFit×5, contactability×3, recency×1` and confidence is lowered.
4. Best persona wins; ties break on `persona.priority`. `is_decision_maker = !vetoed && score ≥ 70`.
5. The top non-vetoed person becomes `opportunities.primary_person_id` **unless a human chose** (`contact_selected_by = 'user'`).

Optionally (`discover: true`) it first calls `searchPeople` (≤ 25 results) using persona titles/seniorities/departments as the query — paid.

### 9.7 Why-now, sales agent, needs-you

- `explain_why_now` (Opus): must tie to a *dated, sourced* reason; instructed against inventing one (comment: "asked why now, a model will always find something"). The first-run stage `explain` invokes it. **Where it is called in steady state: [NOT READ] (`apps/web/lib/ai/why-now.ts`).**
- `sales_agent`: per-opportunity chat.
- **Needs-you ranking** (`packages/db/src/needs-you.ts`): a *pure, model-free* function that orders actionable items (replies, due steps, etc.) with a written reason per item; the daily digest email uses the same function. Exact rank constants **[NOT READ in detail]**.

---

## 10. Outreach engine

### 10.1 Objects

`campaigns` (status, `autonomy_level` 0–5, product), `sequences`/`sequence_steps` (kinds incl. `wait`, `condition`, email), `enrollments` (opportunity in a campaign: `current_step`, `next_action_at`, `status`, `mailbox_id`, `parked_reason`), `messages` (inbound/outbound, `scheduled_at`, `sent_at`, `send_attempted_at`, `to_email`, subject/body), `threads`, `message_events`, `mailboxes` (OAuth, **tokens AES-256-GCM encrypted** with `MAILBOX_ENCRYPTION_KEY`, daily send cap), `suppressions`, `contact_frequency`, `message_unsubscribe_tokens`.

**Autonomy ladder:** 0–1 = engine drafts, a human approves each message; ≥ 2 = engine may schedule for sending itself (still subject to every gate below).

### 10.2 `advance_enrollments` (sweeper)

Takes up to **5** due active enrollments per run (`next_action_at ≤ now`, oldest first). Per enrollment (`advanceOne`):

1. Campaign not active ⇒ park. Opportunity status in `replied|meeting|proposal|won|lost` ⇒ stop ("sequences stop when somebody answers"). `archived` ⇒ stop.
2. Next step missing ⇒ stop ("finished"). `wait`/`condition` step ⇒ advance pointer, set `next_action_at = now + delayHours`.
3. If an unapproved/unsent draft already exists for this enrollment ⇒ hold and re-check in **24 h** (`APPROVAL_RECHECK_MS`).
4. Resolve recipient (verified/sendable email for the primary person or company); none ⇒ park with reason.
5. `is_suppressed` check; then **draft** with `personalize_message` (Opus), which receives ≤ 12 evidence items, org voice/profile (`org-profile.ts`), learned style preferences (`preferences.ts`), and a per-competitor `mayName` flag. At autonomy ≥ 2 the message is given `scheduled_at` (queued); otherwise it waits for approval in the Inbox.
6. Any exception ⇒ enrollment is **parked** with the reason on the row (visible where the user looks).

`personalize_message` hard rules (parser): body ≤ 900 chars target (hard reject > 1,080), subject ≤ 200, no forbidden competitor names (`findForbiddenCompetitor`), citations must be among the evidence ids sent. [CODE]

### 10.3 `send_message` — the safety gauntlet (`handlers/send-message.ts`)

Executed in this order; each failure is a *typed refusal*, most permanent:

1. Message exists; `sent_at` set ⇒ skip ("already sent").
2. `send_attempted_at` set ⇒ **permanent failure "Delivery unknown"** (prior attempt may have reached the inbox; never resend on a guess).
3. Must be outbound, must have `scheduled_at` (approved), must have `to_email`, `isSingleAddress` (no header-injection lists/newlines).
4. **`can_contact(org, email)`** (SQL, migration 0017) — the single gate: suppression list; **erasure-residue hash** (post-GDPR-erasure hash match); per-contact **minimum days between contacts** (org setting; a reply lifts it); **30-day rolling cap per address**; **org daily ceiling**. Anything but `allowed = true` (including no answer) ⇒ refuse. `suppressed`/`invalid_address`/`unknown_org` are closed as skips; `too_soon` etc. stay retryable.
5. Unsubscribe token must exist and `NEXT_PUBLIC_SITE_URL` set (so a footer link can be built).
6. Org **postal address** must be set (commercial-email compliance).
7. `emails` monthly quota (`check_quota_internal`) — over ⇒ stays queued with reason.
8. Pick a mailbox with allowance today (`pickMailbox`); `authorize` (decrypt + refresh token); `claim_mailbox_send` increments the mailbox's daily counter atomically.
9. **Compare-and-set claim:** `UPDATE messages SET send_attempted_at = now() WHERE sent_at IS NULL AND send_attempted_at IS NULL` — only the winner sends.
10. Provider `send` (Gmail/Outlook REST) with footer (unsubscribe link + postal address; HTML footer too), `In-Reply-To`/thread id, and RFC 8058 one-click `List-Unsubscribe`.
11. Record `sent_at`, provider ids, thread; log `message_events(delivered)`; `increment_usage('emails')`; `record_contact_send` (cadence counters); move opportunity to `contacted` (forward-only).

### 10.4 Replies (`sync-mailbox.ts`, `classify-reply.ts`)

`schedule_syncs` → `sync_mailbox` pulls new messages from Gmail (history-based) / Outlook using a stored cursor; skips our own sent copies (dedupe on `provider_message_id`); matches to a thread; runs **`classify_reply`** (Haiku, low effort) with 7 labels:

| Label | Effect |
|---|---|
| `positive` | stop sequence; flag human; opportunity → `replied` |
| `neutral` | sequence continues |
| `negative` / `wrong_person` | stop |
| `unsubscribe` | stop **and** add to suppression (outranks all other labels in the prompt) |
| `out_of_office` | sequence continues (delayed); does not count as engagement |
| `bounce` | stop; mark the contact point `undeliverable`; add suppression |

Non-bounce, non-unsubscribe, non-OOO replies call `record_contact_reply` (lifts the cadence cap). Also emits a `demand` field (feeding the Demand screen).

---

## 11. Data providers (`packages/providers`)

### 11.1 Contract and registry

Six **capabilities** (`contract.ts`): `company.search`, `company.enrich`, `person.search`, `person.match`, `email.verify`, `company.signals`. `registry.ts` builds a **capability → single adapter** map from environment keys: `APOLLO_API_KEY` (all Apollo capabilities), `ENRICHMENT_API_KEY` (Hunter; registered second so it overrides overlapping capabilities), `EMAIL_VERIFICATION_API_KEY` (ZeroBounce). One adapter per capability — **no fallback chain**. A repo audit check (`PRV-CHK`) fails the build if a vendor name appears outside `adapters/`.

### 11.2 The call pipeline (`call.ts → callProvider`)

```
breaker open?           → refuse (breaker_open), ledger row
cache hit?              → return (cost 0), ledger row   [before budget on purpose]
budget allows?          → else refuse (budget_exhausted)
loop ≤ 3 attempts:      run() ; retry on retryable/transport errors with jittered backoff 500·2^(n-1) + rand
  success → outcome ok|empty|partial ; ledger ; cache (if cacheable)
failure  → outcome failed|rate_limited ; ledger ; throw   (failures never cached)
```

Cache TTLs: company.search 24 h, company.enrich 30 d, person.search 7 d, person.match 30 d, email.verify 90 d, company.signals 48 h; key = SHA-256 of `capability provider canonical-JSON(request)`. Tables: `provider_cache`, `provider_calls` (ledger), `provider_breakers`, `provider_accounts` (credential status); RPC `provider_budget_state` supplies per-org monthly credit budget. Per-call timeout 15 s.

### 11.3 Email-confidence policy (Apollo adapter header)

Only provider status `verified` is trusted; every other status (including pattern-guessed addresses) is stored as `low` confidence, unverified — because bounces damage the customer's own sending domain. `isSendableEmail` (`contact.ts`) is the send-side gate. **[NOT READ]** beyond headers: the exact field mappings and credit costs per endpoint.

### 11.4 Enrichment jobs

- `enrich_company`: calls `company.enrich` (domain + optional stored provider id); fills **only empty** columns; records one `evidence` per attribute (e.g. "180 employees", "Funding stage: …"); links `external_ids`; 30-day staleness (`schedule_followups` picks `hot`/`warm` opportunities with stale `last_enriched_at`, ≤ 10 per tick).
- `fetch_company_signals` (`schedule_signal_fetches`, 48 h): provider hiring signals → evidence (kind `hiring`). `enrich_person`: find/verify a decision maker's contact point; **no producer** (see §14).

### 11.5 Follow-up fan-out (`schedule_followups`)

One sweeper that, per tick, enqueues: `sync_hubspot` (≤ 25, opportunities with `crm_sync_requested_at`), `rank_contacts` with `discover:true` (≤ 10 `hot|warm` opportunities never sought), `enrich_company` (≤ 10 stale), `research_company` (≤ 5 never-researched companies without opportunities, retry-gated 24 h; plus user-asked force-research), `research_competitor` (≤ 5 asked), and `prospect_competitor_customers`. Each branch stamps a marker so it never asks twice.

---

## 12. Learning, memory, demand, competitors

### 12.1 Performance learning (`schedule-learning.ts`, `analyze-performance.ts`)

Weekly-ish (a run is due if the last analysis is > ~6 days old; checked hourly). Collects `outcomes` (replies, meetings, losses) and `ai_decisions` human overrides over a **90-day** window (≤ 300 outcomes, ≤ 200 decisions). **Gate:** fewer than `MIN_LEARNING_SIGNALS = 8` ⇒ stops *before spending anything* with an explanation. Otherwise runs Opus `analyze_performance`, returning ≤ `MAX_FINDINGS = 10` **findings**, each reviewed individually; approving a finding creates exactly one scoring rule or one memory. An empty list is valid and encouraged by the prompt. Citations are closed-enum ids. The code states "nothing here is doing statistics" — it is an LLM reading small samples, not a statistical test.

### 12.2 Personal preferences (K3, migration 0044)

Deterministic (`packages/db/src/style.ts`): edit features per draft; a style preference is proposed only after `MIN_EXAMPLES = 3` consistent edits across ≥ 2 distinct subjects. `learn_preferences` also runs Sonnet `infer_preferences` over typed notes (needs ≥ 3 statements; at most every 6 h per person). Preferences are injected into `personalize_message` as guidance.

### 12.3 Competitors and demand

`research_competitor` (Opus; **no claim without provenance**, enforced in prompt, parser and handler), `resolve_competitor_mentions` (links evidence to competitor list), `prospect_competitor_customers` (opt-in; only customers the competitor's site names as *fact*), `cluster_demand` (Sonnet, ≥ N new statements, themes are **proposals** a person accepts), competitor relations feed rule fields `competitors.uses/evaluating/former`.

### 12.4 Memory and assistant

`memories`/`memory_evidence` store reviewed organizational knowledge; `workspace_assistant` (Sonnet; answers from a bounded set of workspace records with citations checked against returned rows); `api/memory/extract` ingests documents. **[NOT READ in depth].**

---

## 13. Database, security, and operations

### 13.1 Schema (47 migrations, ≈ 90 tables) [SCHEMA]

Domain groups: **identity/tenancy** (organizations, memberships, profiles, invitations, join_requests, plans, subscriptions), **inputs** (products, icps, icp_versions, personas, sources, scoring_rules, discovery_queries/runs/results), **knowledge** (companies, company_domains, company_triggers, company_problems, company_gaps, evidence, evidence_citations, people, contact_points, external_ids, enrichment_records, competitors*, memories*), **pipeline** (opportunities, opportunity_scores, contact_fit_scores, activities, outcomes, ai_decisions, human_overrides, learning_runs/findings), **outreach** (campaigns, sequences, sequence_steps, enrollments, messages, threads, mailboxes, message_events, suppressions, contact_frequency, message_unsubscribe_tokens), **engine/ops** (job_executions, ai_runs, provider_*, rate_limits, usage_counters, audit_logs, events, score_recompute_requests), **demand/preferences/assistant** (demand_*, preference_*, conversations…).

**Row Level Security** is enabled on every tenant table (44 `enable row level security` statements across migrations); policies use `user_org_ids()` / `has_org_role()` helpers. Writes are hardened by `0031_tenant_write_hardening` and `enforce_same_org_refs` (cross-org foreign keys are rejected). **Security-definer functions** perform privileged operations: `create_organization`, `erase_contact*`, `export_*`, `merge_companies*`, `claim_*`, `can_contact`, `consume_rate_limit`, etc. [SCHEMA]

Plans seeded in 0007: **free** (50 opportunities, 100 AI runs, 0 emails, 25 enrichments, 2 seats), **growth** $99 (1,000 / 3,000 / 5,000 / 1,000 / 10), **scale** $299 (10,000 / 20,000 / 50,000 / 10,000 / 50). Billing is not implemented (no Stripe code reads the keys) [DOC + env audit].

### 13.2 Authentication and request guard

Supabase Auth (magic link + optional Google). `apps/web/proxy.ts` refreshes the session, bounces anonymous users off `/[org]/*`, mints a **per-request CSP nonce** (report-only by default; `CSP_ENFORCE=true` to enforce). **The guard is convenience; RLS is the boundary.** In production (`VERCEL_ENV=production`) missing Supabase config or an unmigrated DB answers **503** instead of demo fixtures. `GET /api/health` reports commit, DB state, and which integrations have keys (booleans only).

### 13.3 Compliance features implemented [CODE/SCHEMA]

Unsubscribe tokens and one-click header; suppression list; **erasure** (`erase_contact` redacts, leaves a hash so the person can't be re-contacted), **export**, **retention** (`contact_retention_days`, default off), audit log, org deletion, account deletion, postal-address requirement, public-research rate limiting.

### 13.4 Observability

`ai_runs` (per-call model/prompt version/tokens/cost/latency), `provider_calls` ledger, `job_executions` (status/result/error), `/ops` page, `ops` SQL views (0019), Sentry (needs DSN), PostHog (needs key). No alert exists for a stalled queue (`technical-debt.md` #19; nothing found in code to contradict).

---

## 14. Limitations, bottlenecks, risks, and improvement opportunities

### 14.1 Status of the running system

[DOC: `AUDIT.md` dated 2026-10-13, not independently re-run today] Production was deployed but **not operational**: no engine driver configured, no encryption key, no vendor keys. In this checkout, `.env.local` has Supabase keys, `DATABASE_URL`, `CRON_SECRET`, `MAILBOX_ENCRYPTION_KEY` but **no `ANTHROPIC_API_KEY`**, no Apollo/Hunter/ZeroBounce keys, no Resend. Consequently **no AI or provider call has ever been observed live** [DOC] — every behaviour above that depends on a vendor is **[UNVERIFIED]** in practice (it is exercised only against scripted fakes in tests).

### 14.2 Code-level findings (from this investigation)

| # | Finding | Evidence | Severity |
|---|---|---|---|
| F1 | **Three handlers have no producer**: `enrich_person`, `resolve_entity`, `purge_contact_data`. A static search for `name: "<job>"` finds no enqueue anywhere outside their own files/registry. Person enrichment, fuzzy duplicate proposals and the erasure *job* are therefore unreachable by the queue. (Erasure SQL functions exist and may be invoked directly by UI actions — **[NOT READ]**.) | grep over `packages`/`apps` | **High** (compliance + data quality) |
| F2 | **Throughput is tiny and shared:** 5 jobs/tick, sequential, one tick/5 min ⇒ ≤ 60 jobs/h for *all tenants*. Each company costs ~5 jobs. GitHub Actions cron can be delayed or paused after 60 days of inactivity (workflow comment). | `tick/route.ts`, `tick.yml` | High at scale |
| F3 | **A 60 s function must contain model calls up to 55 s** (`aiRequestTimeoutMs`), while the runner reserves 20 s. One slow Opus call can consume the whole tick; a job started with ~21 s left can be killed ⇒ stalled-job recovery after 10 min. | `runner.ts`, `env.ts` | Medium |
| F4 | **No fallback provider**: one adapter per capability. A vendor outage/budget exhaustion halts that capability; the circuit breaker only prevents hammering. | `registry.ts` | Medium |
| F5 | **Score is an LLM opinion** with no calibration, no inter-run stability measurement, and no ground-truth validation; rules only shift it. `opportunity_scores` stores everything needed to study drift but no code does. | `qualify-opportunity.ts` | Medium (product risk) |
| F6 | **Learning is small-sample LLM reading** (min 8 signals; "nothing here is doing statistics"). Findings are human-gated, which limits harm. | `analyze-performance.ts` | Medium |
| F7 | **Prompt-injection residual risk:** untrusted-content tagging is a prompt-level mitigation; the web-fetch tool lets the *vendor-side* model read arbitrary pages on the company's domain. Output is schema-checked but a poisoned page could still bias `evidence` text. | `untrusted.ts`, `client.ts` | Medium |
| F8 | **Hand-written feed/HTML parsing** (regex) — correctness and edge-case risk on hostile or unusual markup; no JS rendering ⇒ SPA sites yield nothing (the code skips < 200-char docs). | `extract.ts` | Medium |
| F9 | `rootLabel` uses a short hard-coded two-label TLD list instead of the Public Suffix List ⇒ mis-matches for unlisted suffixes (e.g. `.com.es`). | `identity.ts` | Low |
| F10 | Fuzzy name matching: edit distance on whole names, same-country only; will miss abbreviations/rebrands and can't use parent/subsidiary graphs. | `identity.ts` | Low |
| F11 | **Rules cannot see dimension scores or trigger age** (fields list lacks `score.<dimension>`, `trigger.age`); floors/vetoes don't alter numeric score. | `rules.ts` | Low |
| F12 | Quota/budget **fail-open** on read errors (deliberate) — a DB hiccup can let spend past a cap; the email path is the exception (fails closed through `can_contact`). | `ai.ts`, `budget.ts` | Low–Medium |
| F13 | Per-tick caps (50 scans, 10 discovery queries, 5 enrollments) are constants in code, not configuration. | handlers | Low |
| F14 | **Migrations applied by hand**, no ledger (`db:doctor` infers state). SETUP.md lagged the code (listed 0001–0010 applied as of 2026-09-28); the code at HEAD expects 0001–0047. | `SETUP.md`, `doctor.ts` | High operationally |
| F15 | Docs drift: engine.md counts, README/COMMAND headers contradict code (AUDIT §17). | see §0 | Low |
| F16 | Schema objects with no readers: `company_gaps`, `evidence_citations`, `subscriptions`, others per `technical-debt.md` #8 [DOC]. | | Low |
| F17 | No billing path; free plan has 0 emails yet onboarding offers outreach [DOC]. | | Product gap |

### 14.3 Bottlenecks, in order of likely impact

1. **Tick capacity** (F2/F3) — move to a long-lived worker or queue-per-job invocation; raise `limit`; run N ticks concurrently (SKIP LOCKED already supports it).
2. **Opus cost/latency per company** — `research_company` + `qualify_opportunity` are both Opus-high with web-fetch (both read the site); consider caching the fetched page text once and sharing it, or Sonnet for first-pass screening before Opus on shortlist.
3. **Provider credits** — default per-query budget 100 credits and 5 pages × 25 = 125 results per run; no ICP-quality pre-filter before paying for enrichment beyond `isExcluded`.
4. **Scan fan-out** — each scan does sequential model extractions (≤ 10 documents) inside one 60 s window.

### 14.4 Improvement opportunities

- Wire (or delete) the three producer-less handlers; add an alert when any `JobName` has a handler but no producer (a repo audit check would catch it).
- Add a **queue health alert** (stalled/oldest-queued age) — the engine's most likely silent failure mode.
- Add **score stability tests** (rescore the same company N times; track variance) using the existing `prompt_version`/`model_version` columns.
- Add **provider fallback chain** (the contract already supports it per `technical-debt.md`).
- Replace regex parsing with a vetted HTML/feed parser; add JS-rendered-page support only if needed.
- Use the Public Suffix List for `rootLabel`.
- Make per-tick caps configurable per plan/deployment.
- Automate migrations with a ledger.

---

## 15. Glossary (technical)

- **ICP** — Ideal Customer Profile; criteria + exclusions describing who to sell to.
- **Opportunity** — a (company × ICP) row with priority, score, evidence, and a primary contact.
- **Evidence** — a sourced claim classified `fact | inference | unknown` with confidence.
- **Trigger** — a *dated* event (funding, hiring, launch…) that makes now a good time.
- **Sweeper** — a job with no org that scans all tenants for due work and enqueues per-org jobs.
- **Tick** — one invocation of the runner that claims and executes ≤ N jobs.
- **Idempotency key** — unique string making duplicate enqueues collapse.
- **OrgScope** — service-role DB wrapper bound to one org id.
- **RLS** — Postgres Row Level Security; the actual tenant boundary.
- **Autonomy level** — 0–5 setting controlling whether humans approve each outbound message.
- **Capability / adapter** — a kind of vendor call / the vendor-specific code behind it.
- **Breaker** — circuit breaker that pauses calls to a repeatedly failing provider.
- **Suppression** — addresses that must never be contacted.
- **SSRF** — Server-Side Request Forgery; the fetcher blocks private network targets.
