# C — Providers, CRM (HubSpot), AI — read-only audit

Commit `509a24e` (main). Static reading only: no API, DB, dev server or build was run; `.env.local` not opened. Every external shape below comes from code and SDK typings. **No recorded vendor fixtures exist in the repo** (`git ls-files | grep -i fixture` returns only `apps/web/lib/fixtures/opportunities.ts`, which is UI demo data). Every adapter test (`packages/providers/scripts/verify-providers.ts`, `packages/crm/scripts/verify-crm.ts`, `packages/ai/scripts/verify-tasks.ts`) uses hand-written responses taken from the documentation.

---

## 1. Provider matrix

### 1a. The seam (`packages/providers`)

The call path is `index.ts:route()`, which checks that a provider is configured and that its credentials are not known to be bad (`credentialsKnownBad`). It then goes through `call.ts:callProvider`: breaker → cache → budget → call with 3 attempts (15 s timeout inside each adapter) → ledger RPC `record_provider_call` → cache write. The ledger RPC also increments `usage_counters['provider_credits:<p>']` and updates `provider_breakers` (`0011_providers.sql:245-324`).

| Capability | Bound adapter (`registry.ts:68-93`) | Reachable production callers | TTL (`cache.ts`) |
|---|---|---|---|
| company.search | Apollo `POST /mixed_companies/search` | `discover-companies.ts:177`, `reach.ts:127` (onboarding reach counter, debounced 900 ms, no server rate limit) | 24 h |
| company.enrich | Apollo `POST /organizations/enrich` | `enrich-company.ts` via **first-run only** (`first-run.ts:402`); `look-alike.ts:127` (ICP preview) | 30 d |
| person.search | Apollo `POST /mixed_people/search` | `rank-contacts.ts:318` via **first-run only** (`first-run.ts:487`) | 7 d |
| person.match | Hunter `GET /v2/email-finder` (it overrides Apollo when both keys are set) | **none**; only the test script calls it | 30 d |
| email.verify | ZeroBounce `GET /v2/validate` | **none** through the seam | 90 d (`unknown` is not cached) |
| company.signals | Apollo `GET /organizations/{id}/job_postings` | `fetch-company-signals.ts:70`, run by the sweeper `schedule-signal-fetches.ts` (25 per 5-min tick, across all tenants) | 48 h |

**Bypass of the seam:** `packages/jobs/src/providers.ts:86-240` (`findContacts`, `verifyEmail`) calls Apollo `/people/match`, Hunter and ZeroBounce directly with `fetch`. It skips the cache, budget, breaker and ledger, and picks the vendor by sniffing the shape of `ENRICHMENT_API_KEY`. Its only caller is `handlers/enrich-person.ts:29`, which is itself never enqueued.

### 1b. Per-provider detail

| | Apollo | Hunter | ZeroBounce |
|---|---|---|---|
| Auth | `x-api-key` header (`apollo.ts:196,231`) | `api_key` **query string** (`hunter.ts:40`; also `jobs/providers.ts:106`) | `api_key` **query string** (`zerobounce.ts:34`) |
| Request shape vs docs | Taken from the docs; never checked live. Suspect: `/mixed_people/search` (Apollo has moved API people search to a newer endpoint; UNVERIFIED), `currently_using_any_of_technology_uids` sent tech *names*, `q_organization_domains` passed as a string, `revenueBands` silently ignored, `excludeDomains` a no-op (`apollo.ts:412,425-432`) | email-finder with domain, first and last name | validate with `email`; no `ip_address` |
| Pagination | page number stored as an opaque cursor; `per_page` ≤ 100; `partial` = more pages exist | n/a | n/a |
| Dedupe / entity resolution | `resolve_company` RPC (domain + provider id) in `discover-companies.ts` absorb(). `resolve_entity` job (fuzzy duplicate detection) is **never enqueued** | person identified by a synthetic `email:<addr>` id | n/a |
| Rate limits | 429 → `rateLimited`, retried with 0.5–2 s jittered backoff; `Retry-After` ignored; `rate_limited` outcomes do **not** feed the breaker (`0011:295-320` only counts `failed`) | same | same |
| Timeouts / retries | 15 s × 3 attempts (`call.ts:56-57`) | same | same |
| Normalization | Canonical domain (`canonicalizeDomain`), employee band, funding. Email trusted only when `email_status==="verified"` → `high`/verified | score banded; never `verified` | `valid`→deliverable; invalid/spamtrap/do_not_mail→undeliverable; catch-all/abuse→risky; else unknown |
| Cache | per org, keyed on a hash of the canonicalised request; failures never cached | same | `unknown` not cached |
| Budget | `provider_budget_state` reads `provider_accounts.monthly_credit_limit`. **No code ever writes that column**, so every org is unlimited (PROV-002) | same | same |
| Source attribution | `companies.discovered_via='provider:apollo'`. Evidence rows only from `enrich_company` (a record URL on app.apollo.io) and signals (the posting URL) | `contact_points.provider` | `verification_status` |
| Live-verified | **Never** (no fixtures, no recorded responses) | Never | Never |

### 1c. What HuntLoop owns vs what the provider owns

- **Provider owns:** firmographics, the people graph, email discovery and deliverability verdicts, job postings, credit pricing, rate limits, and the 50k-record enumeration cap.
- **HuntLoop owns:** filter translation (ICP → provider query, `packages/db/src/discovery.ts`), canonical identity and dedupe (`resolve_company`, `company_domains`, `external_ids`), caching, per-org budget/breaker/ledger, confidence mapping, the evidence and provenance model, staleness cadence (`STALE_AFTER_DAYS` exists but nothing uses it), and deciding when to spend.

### 1d. Cost per core-loop run (estimate, credits taken from `apollo.ts:70-82`; unreconciled)

- **Onboarding reach counter:** 1 org-search credit per debounced edit whose filter set is new (`reach.ts`). No server-side rate limit.
- **First run (`first-run.ts`):** 1 search page (25 companies, 1 credit) + ≤10 enrich (10) + 3 people searches (3) + look-alike enrich for each example company (n). Total ≈ **14 + n Apollo credits**. AI side: `research_company` for ≤25 new companies plus a `score_opportunity` for each, so up to ~50 Opus/high runs.
- **Daily scheduled discovery:** 1 page per query per day (`interval_minutes: 1440`, `max_pages 1`, `credit_budget 40`) → 1 credit, then up to 25 `research_company` + 25 `score_opportunity` Opus runs per day. The Free plan's 100 `ai_runs` per month runs out in about 2 days (AI-005).
- **Signals:** 1 credit per Apollo-known company every 48 h, whether or not the company has a live opportunity. That is ≈15 credits per company per month; an org with 1,000 companies spends ≈15k credits a month. Deployment-wide cap: 25 per 5-min tick ≈ 7,200 calls a day.
- **Contacts after onboarding:** 0. Nothing ever acquires contacts after first-run (PROV-001).

---

## 2. HubSpot integration trace

| Step | Where | Observed |
|---|---|---|
| Connect | `settings/integrations/actions.ts:28-79` | A **private-app token** is pasted in. There is no OAuth, so state, PKCE and refresh don't apply. `verifyHubspotToken` (GET companies?limit=1) and `encryptSecret` run **before** `mutate` checks membership or role (CRM-007). The row is upserted with `{minRole:'admin'}`. `hub_id` is **never written**. |
| Storage | `hubspot_connections` (`0028_signals_and_crm.sql:43-73`) | one row per org, AES-GCM `access_token`; RLS admin-only for read and write. The loader never selects the token (`lib/data/integrations.ts:40`). |
| Trigger | — | **None.** `sync_hubspot` is in `HANDLERS` (`registry.ts:93`) and the `JobName` union (`queue.ts:77`), but nothing enqueues it: grep for `"sync_hubspot"` finds only tests. It is not a sweeper, and the UI has no push control (grep `push.*hubspot` → 0). The settings copy says "push an opportunity to start" (`IntegrationsForm.tsx:99`). **Prior claim C-1 re-confirmed.** |
| Push (if invoked) | `handlers/sync-hubspot.ts` | Direction is **HuntLoop → HubSpot** only: company (search by domain, then PATCH or create), contact (search by email, then PATCH or create), deal (created once and remembered in `external_ids`, otherwise PATCHed), then v4 default associations. Then a single read-back of the deal stage, written as an `evidence` "fact". |
| Custom properties | `hubspot.ts:121-144` | group plus 3 deal properties, created on every sync (409-tolerant). With `getStageLabels` that makes ≥5 extra calls per push. |
| Retries / rate limits | `hubspot.ts:74-91` | 429 → retryable `CrmError`, handled only through the job's own retry; no Retry-After, no budget or breaker, no ledger. |
| Failure visibility | `hubspot_connections.last_sync_error` (single string) | no per-record history. |
| Inbound / webhooks | — | none (no webhook route under `apps/web/app/api`). |
| Disconnect | `actions.ts:81-97` | the row is hard-deleted. `external_ids` and evidence stay behind. The token isn't revoked at HubSpot (a private app has to be rotated by the user, and the UI doesn't say so). |
| Deletion / data rights | `purge-contact-data.ts` | no HubSpot propagation (grep hubspot → 0). |
| Who can connect | admin (RLS plus `minRole`) | the token check runs pre-auth (CRM-007). |

---

## 3. AI call table (every model call)

Shared plumbing:
- All tasks go through `runTask` (`packages/ai/src/task.ts`), which uses `createAnthropicClient` (`client.ts`). That client uses SDK `@anthropic-ai/sdk@0.116.0` with defaults: **600 s timeout and 2 automatic retries**, `betas:["server-side-fallback-2026-07-01"]`, `fallbacks:"default"`, a cached system prompt, adaptive thinking (Opus), and `output_config.format=json_schema`. `pause_turn` is continued up to 5 times.
- Engine calls use `runForOrg` (`jobs/src/ai.ts`): `check_quota_internal('ai_runs')`, then the run, then `increment_usage_internal` **only on success**. Web calls use `lib/ai/*.ts`: `resolveRecorder` (refuses non-members) → `withinAiBudget` → `consumeRateLimit` → run → `countAiRun` only on success.
- Every task's `entity()` returns `id: null`, so `ai_runs.entity_id` is always null (AI-004).
- The model IDs `claude-opus-5`, `claude-sonnet-5` and `claude-haiku-4-5` appear in the SDK 0.116 type unions. None has been called live.

| Task | Model / effort / max_tokens | Purpose | Callers | Inputs (⚠ = untrusted) | Output validation | Fallback | Quota / rate limit | PII sent | Persisted | Fact vs inference / basis |
|---|---|---|---|---|---|---|---|---|---|---|
| research_company | claude-opus-5 / high / 32k, **web_fetch** (company domain + www) | what a company sells, buyers, problem, model, trigger | job `research-company.ts:73` (enqueued by discovery, first-run); web `lib/ai/research.ts:88`; **anonymous** `(marketing)/discover/actions.ts:152` | URL (user) ⚠, fetched pages ⚠ (tool results, not wrapped; system rule only) | strict field set, `assertValidClaim`: a fact needs a *non-empty string* sourceUrl. **URL not validated** (AI-002) | server-side fallback model; SDK retries | engine quota + rate limit (web); anonymous: IP/day allowance, **no ai_runs row** (AI-006) | none beyond the company | `companies.description`, `business_model`, `name` (**overwrites**), `evidence` (insert), `company_problems` (insert); `public_research` | kind stored in evidence, **lost** in `companies.description`, which renders as "What they do" |
| research_competitor | opus / high / 24k, web_fetch | competitor profile | job `research-competitor.ts:182` (enqueue site not found by grep) | URL, knownAs ⚠, pages ⚠ | as above, plus "strength as fact must cite" (URL string only) | same | engine quota | — | `competitor_profiles`, `competitors` | kind kept |
| qualify_opportunity | opus / high / 32k, web_fetch | the verdict | job `score-opportunity.ts:147`; web `lib/ai/qualify.ts:108` | ICP, evidence ⚠, URL ⚠ | `assertValidClaim`, **plus cited domain must be the company's or an already-read URL** (`qualify-opportunity.ts:583-595`) | same | both | — | `opportunity_scores`, `evidence`, `opportunities` | kind kept |
| explain_why_now | opus / medium / 16k | trigger narrative | web `lib/ai/why-now.ts:119` only (not the engine) | ICP, evidence ⚠ | claims required | same | web | — | returned to UI (not traced) | cites evidence |
| extract_signals | claude-haiku-4-5 / (no effort) / 8k | events from fetched docs | job `scan-source.ts:175` | document ⚠ (wrapped) | schema + confidence words | same | engine | page content | `source_events`, `company_triggers`, `evidence`, **`companies` insert** | kind kept |
| personalize_message | opus / medium / 8k | email body | job `advance-enrollments.ts:386` | recipient name/title, product, angle, evidence ⚠, template, house style ⚠ | citedEvidenceIds | template fill if AI unavailable | engine | **recipient name + title** | `messages` | cited ids |
| classify_reply | haiku / low / 1k | reply → outcome | job `sync-mailbox.ts:107` | **inbound reply body ⚠** + our message | closed label set | same | engine | **prospect email content** | `outcomes`, `messages`, `opportunities` | label |
| analyze_performance | opus / high / 32k | learning findings, rule proposals | job `analyze-performance.ts:184` | prospecting records ⚠ (company names, notes) | ids must exist; rule names unique | same | engine | company names/notes | `learning_runs`, `learning_findings` | cited ids |
| draft_icp | opus / high / 16k | ICP draft | web `lib/ai/icp-draft.ts:81` | research ⚠ | schema | same | web | — | returned for review | review screen |
| draft_scoring_rules | opus / high / 20k | rule proposals | web `lib/ai/rules.ts:86` | ICP ⚠ | schema + expression checks | same | web | — | returned for review | review |
| recommend_sources | opus / medium / 16k | where the ICP's companies appear | web `lib/ai/sources.ts:77` | ICP ⚠ | schema | same | web | — | returned | — |
| sales_agent | opus / medium / 24k | per-opportunity Q&A | web `lib/ai/agent.ts:103` | ICP, narrative, evidence, history, question ⚠ (all wrapped) | claims must cite provided ids | same | web | — | not traced | cites |

Unused route: `MODELS.sonnet` (no task uses it). Pricing is hardcoded (`models.ts` PRICES) and unverified. Cost is estimated from `route.model` even when the server-side fallback served a different model (`task.ts:100`, where `result.model` is returned but not recorded).

---

## 4. Integration map

```mermaid
flowchart LR
  subgraph Vercel["Vercel (apps/web, Next 16)"]
    UI[Server Actions / pages]
    TICK[/api/jobs/tick maxDuration 60s/]
    PUB[(marketing)/discover anon action]
  end
  GH[GitHub Actions tick.yml */5] -->|CRON_SECRET| TICK
  subgraph Jobs["packages/jobs runner"]
    DISC[discover_companies]
    FR[first-run stages]
    ENC[enrich_company]
    RC[rank_contacts]
    SIG[fetch_company_signals]
    EP[enrich_person — never enqueued]
    RE[resolve_entity — never enqueued]
    SH[sync_hubspot — never enqueued]
    AIJ[research/score/scan/advance/sync-mailbox]
  end
  subgraph Seam["packages/providers seam: cache→budget→breaker→ledger"]
    SEAM[callProvider]
  end
  UI --> FR
  TICK --> DISC & SIG & AIJ
  FR --> ENC & RC & DISC
  DISC --> SEAM
  ENC --> SEAM
  RC --> SEAM
  SIG --> SEAM
  UI -->|estimateReach / look-alike| SEAM
  SEAM --> APOLLO[Apollo API]
  SEAM -. person.match (no caller) .-> HUNTER[Hunter]
  SEAM -. email.verify (no caller) .-> ZB[ZeroBounce]
  EP -->|BYPASS: direct fetch, no ledger/budget| APOLLO & HUNTER & ZB
  SH -. never runs .-> HUBSPOT[HubSpot CRM v3/v4]
  UI -->|connect: private-app token| HUBSPOT
  AIJ --> ANTH[Anthropic Messages API + web_fetch]
  UI -->|7 wrappers: quota+ratelimit| ANTH
  PUB -->|nullRecorder, IP allowance| ANTH
  AIJ -->|send / sync| MAIL[Gmail / Outlook OAuth]
  Jobs & UI & Seam --> SB[(Supabase Postgres + RLS)]
```

---

## 5. Status of prior findings (my areas)

| Prior ID | Claim | Status | Evidence |
|---|---|---|---|
| 08 E-1 | `enrich_person` unreachable | **Still open, and broader:** `rank_contacts` and `enrich_company` also run only from first-run → PROV-001. `enrich_person` also bypasses the seam → PROV-003 | grep `"enrich_person"`, `"rank_contacts"`, `"enrich_company"`: only `first-run.ts` / registry |
| 08 E-2 / 21 P-2 / 22 H-6 | no fallback chain | Still open | `registry.ts:68-93` uses `map.set` overwrite |
| 08 E-3 / 22 C-6 (enrich) | `enrich` quota never enforced | **Partly fixed but ineffective:** `enrich-person.ts:57-73` checks it, but that handler is unreachable. Reachable paths (enrich_company, rank_contacts) don't meter `enrich` | code |
| 08 E-4 | no scheduled re-enrichment | Still open (`staleBefore` exported, zero callers) | grep |
| 08 E-5 | no enrichment UI | Still open (no web enqueue of enrich) | grep in apps/web |
| 08 E-6 / 21 P-4 | credits unreconciled | Still open | `apollo.ts` header comment |
| 09 A-1 / 21 P-1 / 22 C-5 | zero live calls | Still open (UNVERIFIED; no fixtures) | §0 |
| 09 A-2 | no eval harness | Still open (only scripted clients) | `verify-tasks.ts` |
| 09 A-3 | no output review surface | Not rechecked (UX area) | — |
| 09 A-4 | routing unvalidated | Still open; sonnet route unused | `models.ts` |
| 09 A-5 | analyze_performance single caller | Not rechecked (flow area) | — |
| 09 A-6 | prompt/score provenance | Still open, with a new detail: `ai_runs.entity_id` is always null → AI-004 | all `tasks/*.ts` `entity()` |
| 09 inventory | "explain_why_now called from score_opportunity" | **Obsolete / incorrect:** only `lib/ai/why-now.ts` calls it | grep `runForOrg(` |
| 11 C-1 / 22 H-2 | sync_hubspot never enqueued | **Still open** (CRM-001) | grep |
| 11 C-2 | no bulk sync | Still open | — |
| 11 C-3 | no inbound/webhooks | Still open | no webhook route |
| 11 C-4 | never live-verified | Still open, and CRM-003 is a likely day-one failure | — |
| 11 C-5 | hard-coded mapping | Still open | `hubspot.ts:39-43,165-224` |
| 11 C-6 | no sync history | Still open | — |
| 11 C-7 | deleted-record handling | Still open: a 404 on `updateDealHuntloopFields` becomes a permanent failure; the external id is never cleared | `hubspot.ts:84-90` |
| 11 C-8 / 22 M-8 | stage labels re-fetched per sync | Still open | `hubspot.ts:299` |
| 11 C-9 / 21 P-3 | no rate-limit/breaker/ledger for HubSpot | Still open | — |
| 21 P-5 | no provider-health alerting; "/ops shows state" | **Still open, and the claim was wrong:** no web code reads `provider_calls`, `provider_health`, `provider_accounts` or `provider_breakers` (grep → 0; `ops.ts` reads only `job_health`, `queue_pressure`) | PROV-008 |
| 21 P-6 | Apollo 50k cap not surfaced | Still open (not surfaced; not re-traced in UI) | — |
| 21 "per-org budget checked before every paid call" | | **Misleading:** checked, but the limit is never set, so it is effectively unlimited → PROV-002; and bypassed by `jobs/providers.ts` → PROV-003 | — |
| 22 C-2 | resolve_entity never enqueued | Still open | grep |
| 22 M-5 | signal scheduler scans every Apollo-known company | Still open, plus a starvation bug → PROV-011 | `schedule-signal-fetches.ts:47-55` |

---

## 6. Findings

### [High] PROV-001 — Contacts and enrichment are acquired only during onboarding; the loop never enriches later discoveries
- Confidence: CONFIRMED (call-site grep)
- Where: `packages/jobs/src/first-run.ts:402,487`; `handlers/rank-contacts.ts` (only runs `person.search`); `handlers/enrich-company.ts`; `handlers/enrich-person.ts`; `queue.ts:42,56-57`
- Evidence: `"rank_contacts"` and `"enrich_company"` appear only in `first-run.ts` `runHandler(...)` and the `JobName` union. `enrich_person` has no enqueue site. `discover-companies.ts:283-296` hands new companies only to `research_company`, which enqueues only `score_opportunity`.
- Trace: daily `schedule_discovery` → `discover_companies` → `research_company` → `score_opportunity` → an opportunity with **no people, no contact points, no provider enrichment/evidence**. Outreach then finds no recipient (`advance-enrollments.ts:300-333`).
- Impact: the "Enriched" stage is missing for every company after the first ≤10 (enrich) or 3 (contacts). Every tenant, core loop.
- Root cause: enrichment handlers were wired into the synchronous onboarding runner, not into the job chain.
- Fix: enqueue `enrich_company` and `rank_contacts` from `research_company` (or `score_opportunity` when the verdict is not IGNORE), with idempotency keys like `enrich:${company}` / `contacts:${company}`, gated by PROV-002's budget. Don't enqueue `enrich_person` until PROV-003 is fixed.
- Effort: S · Depends on: PROV-002, PROV-003 · Mechanizable: yes (audit check: every `JobName` has ≥1 non-test enqueue site)
- Status vs last pass: Still open (08 E-1, 22 C-4), broadened

### [High] PROV-002 — Provider spend is unlimited by default: nothing ever sets `monthly_credit_limit`
- Confidence: CONFIRMED
- Where: `packages/db/migrations/0011_providers.sql:74,352-368`; `packages/providers/src/budget.ts:363-369`; grep `monthly_credit_limit` → only migration, `verify-migrations.ts`, `audit/PLAN-11.md`
- Evidence: `case when (select lim from cap) is null then true` (0011:366). No app code, seed or UI writes `provider_accounts.monthly_credit_limit`. `PLAN-11.md:602` lists it as an open manual decision.
- Trace: any paid call → `budgetAllows` → limit null → allowed. The sweeper `schedule_signal_fetches` spends 1 credit per Apollo-known company every 48 h across all orgs. `estimateReachAction` (`welcome/icp/actions.ts:136-176`) spends a search credit per new filter set with no server-side rate limit (client debounce only, `IcpStep.tsx:291-321`).
- Impact: unbounded Apollo bill, capped only by the Apollo plan. One member can script `estimateReachAction` with varied filters to burn credits.
- Root cause: the budget mechanism exists but its only input was left as a "billing decision" and defaults to unlimited.
- Fix: a deployment default (env `PROVIDER_MONTHLY_CREDIT_LIMIT`) as the fallback in `provider_budget_state` when no row exists; an admin UI to set it; `consumeRateLimit` on `estimateReach`/`previewLookAlikes`.
- Effort: S · Depends on: — · Mechanizable: yes (test: org with no provider_accounts row gets a finite limit)
- Status vs last pass: New (contradicts 21's "cost architecture already strong")

### [High] PROV-003 — `enrich_person` bypasses the provider seam (no cache, budget, breaker or ledger) and uses a contradictory vendor rule
- Confidence: CONFIRMED (code); impact is latent while unreachable
- Where: `packages/jobs/src/providers.ts:63-67,86-240`; `handlers/enrich-person.ts:29,87,139`
- Evidence: `return key.startsWith("hunter_") || key.length === 40 ? "hunter" : "apollo";` (providers.ts:66). The registry treats `ENRICHMENT_API_KEY` as Hunter-only (`registry.ts:36-37`) and the docs say the sniffing was reversed (`docs/architecture/providers.md` "A reversed decision"). ZeroBounce mapping differs: `spamtrap`/`do_not_mail` → `risky` here (providers.ts:229-237) vs `undeliverable` in the adapter (`zerobounce.ts:130-132`). No `provider_calls` row, no `provider_credits` counter.
- Trace: the obvious fix for PROV-001 (enqueue enrich_person) turns on an unmetered paid path. With only `APOLLO_API_KEY` set, enrich_person reports "No enrichment provider is configured".
- Impact: unmetered spend and invisible cost as soon as it's wired; a second, divergent verification vocabulary.
- Root cause: the pre-seam implementation was never migrated when `packages/providers` landed.
- Fix: rewrite `enrich-person.ts` on `matchPerson`/`verifyEmail` from `@huntloop/providers`, then delete `jobs/src/providers.ts` and its re-exports (`jobs/src/index.ts:65-72`).
- Effort: S · Depends on: — · Mechanizable: yes (extend `PRV-CHK`: no vendor hostnames outside `providers/src/adapters`)
- Status vs last pass: New

### [High] PROV-004 — Emails come only from Apollo *search* results and are trusted as provider-verified; outreach sends to anything not flagged bad
- Confidence: LIKELY (code CONFIRMED; the Apollo response behaviour needs one live `mixed_people/search` call to settle)
- Where: `adapters/apollo.ts:301-314,490-522`; `handlers/rank-contacts.ts:390-407`; `handlers/advance-enrollments.ts:318-323`
- Evidence: `toPerson` maps `email` + `email_status==="verified"` → `confidence:"high", verified:true` for search rows. rank-contacts stores it as `verification_status: "provider_verified"`. The recipient filter is `p.verification_status !== "undeliverable" && p.verification_status !== "risky"`, so `unverified` and `provider_verified` both pass, and `contact_points.deleted_at` isn't filtered. Apollo's people search is documented and widely reported to return locked placeholder addresses (e.g. `email_not_unlocked@<domain>`) for contacts that haven't been revealed.
- Trace: first-run → rank_contacts → searchPeople → contact_points → advance_enrollments → send.
- Impact: sends to placeholder or pattern-guessed addresses. Bounces land on the customer's sending domain, which the code's own comments call the worst failure. `unique(org_id,kind,value)` + `ignoreDuplicates` also means a shared placeholder attaches to only the first person at a company.
- Root cause: the search endpoint is treated as a reveal endpoint, and the send gate is a denylist rather than an allowlist.
- Fix: drop emails from `searchPeople` results (keep them only from `matchPerson`), reject `email_not_unlocked@*`, and make the send gate an allowlist (`deliverable` or `provider_verified` + high).
- Effort: S · Depends on: PROV-003 · Mechanizable: yes (adapter unit test with the placeholder)
- Status vs last pass: New

### [Medium] PROV-005 — Apollo request shapes are unverified and some are probably wrong; no recorded fixtures exist
- Confidence: UNVERIFIED (settle with one recorded call per endpoint against a real key, committed as fixtures)
- Where: `apollo.ts:411-435` (`currently_using_any_of_technology_uids` fed tech names; `q_organization_domains` as a string; `q_organization_keyword_tags` merges industries), `apollo.ts:507` (`/mixed_people/search`), `apollo.ts:389-400` (`verifyCredentials` uses a search endpoint that may consume credits, which contradicts `contract.ts` "must not consume a search credit")
- Evidence: see lines. `git ls-files` has no provider fixtures.
- Impact: a tech filter sent as names to a UID filter can AND the result set to zero. That shows up as `empty`, the exact "empty market" failure the seam was built to avoid. A deprecated endpoint returns 4xx, which is classified as non-retryable `failed`.
- Root cause: adapters were written from documentation without a recorded-response harness.
- Fix: record real responses (with secrets redacted) into `packages/providers/fixtures/`; move tech names to keywords or report them as unmappable; check the people-search endpoint.
- Effort: M (needs a key) · Depends on: — · Mechanizable: yes (fixture replay tests)
- Status vs last pass: Still open (21 P-1), made specific

### [Medium] PROV-006 — Email verification never runs, and the verification vocabulary is split, so the UI never shows an email
- Confidence: CONFIRMED
- Where: `apps/web/lib/data/opportunity-map.ts:407-409` (`verification_status === "verified"`); writers: `rank-contacts.ts:404` (`provider_verified`/`unverified`), `enrich-person.ts:159` (`deliverable`…), `imports/actions.ts:346`, `sync-mailbox.ts:266`; `rank-contacts.ts:280` (`=== "deliverable"`); the `contact_points.verification_status` column is free text (`0003:125`, no CHECK)
- Evidence: no writer produces `"verified"`. `verifyEmail`/`matchPerson` from the seam have zero production callers.
- Impact: the "buyers" block on the opportunity page never shows an email. Contact ranking never sees a verified email. ZeroBounce is configured and unused.
- Root cause: no enum or CHECK on `verification_status`; each writer invented its own value.
- Fix: a CHECK/enum (`unverified|provider_verified|deliverable|risky|undeliverable|unknown`), fix the reader, and call `verifyEmail` in the contact path before an address becomes sendable.
- Effort: S · Depends on: PROV-004 · Mechanizable: yes (CHECK constraint)
- Status vs last pass: New

### [Medium] PROV-007 — ICP filters are silently dropped or mis-sent while the UI says they were applied
- Confidence: CONFIRMED (revenue); LIKELY (technologies)
- Where: `packages/db/src/discovery.ts:124-125,291` vs `adapters/apollo.ts:402-435`
- Evidence: `filters.revenueBands` is described to the user ("with revenue …", discovery.ts:291) and never read by the adapter. It isn't in `unmapped`, which contradicts `db/src/index.ts:136` "never silently dropped". `excludeDomains` sets `organization_not_ids = undefined` (a no-op).
- Impact: search results ignore the revenue criteria the user set; the excluded domains still cost credits.
- Root cause: the translator assumes the adapter maps every filter field, and the adapter has no way to report what it could not map.
- Fix: have the adapter return `unmapped` fields in `RawCall`, persist them to `discovery_queries.unmappable`, and map revenue to Apollo's revenue range filter.
- Effort: S · Mechanizable: yes (contract test: every `CompanySearchQuery` field is either mapped or reported)
- Status vs last pass: New

### [Medium] PROV-008 — Provider credential checks, health, spend and budget are invisible and some are unwired
- Confidence: CONFIRMED
- Where: `registry.ts:137-196` (`verifyCredentials`, whose comment says "Called from the settings screen and from `npm run smoke`": zero callers, no smoke script); `registry.ts:43` ("An org that wants otherwise says so in `provider_accounts`": `build()` ignores it); `0011_providers.sql:63-65` (capability CHECK lacks `company.signals`); `ledger.ts:usageThisMonth`, `provider_budget_for_org`, `provider_health` view: zero web readers
- Impact: `credential_status` stays `unverified` forever, so the `credentials_invalid` refusal never fires. Admins can't see provider spend or health. Any future `provider_accounts` upsert for signals fails the CHECK.
- Root cause: the backend landed without its settings or ops surface.
- Fix: a provider panel in `/settings/integrations` (configured capabilities, `verifyCredentials` button, month-to-date credits, limit editor), and a migration adding `company.signals` to the CHECK.
- Effort: M · Mechanizable: partly (unused-export check)
- Status vs last pass: Still open (21 P-5), and the prior "/ops shows state" was wrong

### [Medium] PROV-009 — Provider ledger, cache and breaker tables (and `ai_runs`) are writable by any member through RLS
- Confidence: CONFIRMED (policy text); not exploited
- Where: `0011_providers.sql:380-396` (`tenant_write ... has_org_role(org_id,'member')` on `provider_calls`, `provider_cache`, `provider_breakers`); `0004_outreach_memory_learning.sql:336-360` (same for `ai_runs`)
- Evidence: `create policy tenant_write on public.%1$I for all using (public.has_org_role(org_id, 'member'))`
- Impact: a member can insert a `provider_cache` row that `discover_companies` later serves as an Apollo answer. The result is fabricated companies stamped `discovered_via='provider:apollo'`, a provenance forgery. A member can also delete or alter ledger and `ai_runs` rows (cost reports), or set `open_until` to disable a provider. Budget counters (`usage_counters`) are read-only, so quota itself isn't bypassable.
- Root cause: the generic tenant policy template was applied to system ledgers.
- Fix: select-only for members; writes only through the service role and the security-definer RPCs.
- Effort: S · Mechanizable: yes (RLS test: member insert on these tables fails)
- Status vs last pass: New

### [Medium] PROV-010 — Scheduled signal fetches can starve: refused or failed companies are re-picked every tick, deployment-wide
- Confidence: CONFIRMED (code path)
- Where: `handlers/schedule-signal-fetches.ts:47-71`; `fetch-company-signals.ts:78-86`
- Evidence: the query is global (all orgs), `order last_signal_checked_at nulls first`, `limit 25`. `last_signal_checked_at` is updated only after a successful call (line 86). A refusal (budget, breaker, credentials) returns ok without updating it. The idempotency key is per company per day, so the same 25 rows keep being selected and produce no new work.
- Impact: once 25 companies from orgs whose budget or breaker refuses sit at the head, **every other tenant's signals stop**. It also scans every Apollo-known company regardless of relevance (22 M-5).
- Fix: stamp `last_signal_checked_at` (or a `signal_next_at`) on refusal as well; round-robin per org; restrict to companies with live opportunities.
- Effort: S · Status vs last pass: Still open (22 M-5), plus a new starvation bug

### [Medium] PROV-011 — Rate-limit handling ignores Retry-After, and sustained 429s never open the breaker
- Confidence: CONFIRMED (code)
- Where: `call.ts:56-62,244-251`; `0011_providers.sql:295-320` (breaker counts only `failed`)
- Impact: three retries within ~3 s per call, per job, per tick against a vendor that's throttling. A rate-limited provider is hammered indefinitely, without the breaker ever tripping.
- Fix: honour `Retry-After` (surface it on `ProviderError`), count `rate_limited` toward the breaker, and put a per-org concurrency cap on paid calls.
- Effort: S · Status vs last pass: New

### [Medium] PROV-012 — Provider firmographics from discovery are stored as bare attributes with no per-field source or as-of date
- Confidence: CONFIRMED
- Where: `discover-companies.ts:createCompany` (writes industry, employee_count, revenue_band, country, description, tech_stack, funding with only `discovered_via`); evidence is written only by `enrich_company` (first-run only, PROV-001)
- Impact: the company and opportunity screens show provider numbers with no "according to Apollo, as of …" provenance, and nothing re-checks them (no staleness sweep).
- Fix: write the same evidence rows `enrich_company` writes (shared helper) at absorb time, or enqueue enrich_company (PROV-001).
- Effort: S · Status vs last pass: New (trust)

### [Low] PROV-013 — Adapter hygiene
- Confidence: CONFIRMED
- Where: `hunter.ts:40`, `zerobounce.ts:34` and `jobs/providers.ts:106,206` put the API key in the query string, which ends up in vendor and proxy logs. ZeroBounce returns HTTP 200 with an error body for a bad key, which is mapped to `unknown` and billed 1 credit in the ledger (`zerobounce.ts:89-99`). Apollo 403 ("endpoint requires master key") is reported as "rejected the API key" (`apollo.ts:158-167`). `rank-contacts.ts:306-310` and `enrich-company.ts:81-85` read `external_ids` for a company without filtering by provider, so once HubSpot company ids exist (`sync-hubspot.ts:125`) a HubSpot id can be sent to Apollo as `organization_ids`.
- Fix: header auth where the vendor supports it; parse `error` in ZB bodies; `.eq("provider", provider)` on external-id reads.
- Effort: S · Status vs last pass: New

### [Low] PROV-014 — Public-web fetch SSRF guard has gaps (defer depth to the security pass)
- Confidence: LIKELY
- Where: `packages/jobs/src/fetch.ts` `assertFetchable`/`isPrivateAddress`
- Evidence: the address is resolved with `lookup()` and `fetch()` then resolves again (DNS-rebinding window). Missing ranges include 198.18.0.0/15, 192.0.0.0/24, NAT64 `64:ff9b::/96`, IPv4-compatible `::a.b.c.d` and 6to4 `2002::/16`.
- Fix: pin the resolved address (custom undici dispatcher `connect.lookup`), and extend the ranges.
- Effort: S · Status vs last pass: New

### [High] CRM-001 — HubSpot sync cannot run, but the UI presents it as ready
- Confidence: CONFIRMED
- Where: `packages/jobs/src/handlers/sync-hubspot.ts` (handler); `queue.ts:77`; `registry.ts:93`; `IntegrationsForm.tsx:70,99`
- Evidence: grep `"sync_hubspot"` → tests only, no sweeper entry, no action. The copy reads "Pushes an opportunity's company, primary contact and score out as a HubSpot deal…" and "Not synced yet — push an opportunity to start." No push control exists (grep → 0).
- Impact: an admin connects HubSpot and nothing ever happens, while the screen implies it will.
- Root cause: the trigger was deferred and the UI copy was written as if it existed.
- Fix: add a "Push to HubSpot" action on the opportunity page that enqueues `{name:"sync_hubspot", idempotencyKey:"hubspot:"+opp+":"+minute}` (admin/member?), and fix CRM-002…004 first. Until then, change the copy.
- Effort: S · Depends on: CRM-002, CRM-003, CRM-004 · Mechanizable: yes (JobName-has-enqueuer check)
- Status vs last pass: Still open (11 C-1; severity lowered from Critical because the CRM isn't the core loop)

### [High] CRM-002 — The push is not idempotent across partial failure and will create duplicates in the customer's CRM
- Confidence: CONFIRMED (code); latent until CRM-001
- Where: `sync-hubspot.ts:122-164,241-247`; `hubspot.ts:165-198`
- Evidence: `createDeal` then `linkExternal` (whose upsert error is ignored). A timeout, crash or failed upsert between them means the retry creates a second deal. Contacts with no email and companies with no domain skip the search and are **created fresh on every push** (`hubspot.ts:171,189`). The handler never consults `external_ids` for company or person before searching.
- Impact: duplicate deals, contacts and companies in the customer's system of record.
- Fix: look up `external_ids` for company, person and opportunity first and PATCH by id; check the `linkExternal` error; skip contact creation without an email; for deals, set a unique `huntloop_opportunity_id` property and search it before creating.
- Effort: S · Status vs last pass: New

### [Medium] CRM-003 — Deal creation omits `dealstage`/`pipeline`
- Confidence: LIKELY (HubSpot docs require `dealstage` on create; verify against a sandbox portal)
- Where: `packages/crm/src/hubspot.ts:205-215`
- Impact: the first live push probably returns 400, which is classified non-retryable → permanent failure.
- Fix: read the default pipeline and first stage (the same `getStageLabels` call) and send `pipeline` + `dealstage`.
- Effort: S · Status vs last pass: New

### [Medium] CRM-004 — `hub_id` is never written, so the stage read-back violates `evidence_fact_needs_source` and is silently lost
- Confidence: CONFIRMED
- Where: `settings/integrations/actions.ts:61-71` (no `hub_id`); `sync-hubspot.ts:170-187` (`kind:"fact"`, `source_url: hubId ? … : null`, upsert result unchecked); `0002_icp_sources_evidence.sql:134-135` (`check (kind <> 'fact' or source_url is not null)`); the test fixture sets `hub_id: "4242"` (`verify-jobs.ts:2563`), which hides it
- Impact: the one inbound signal (deal stage) never lands, and the settings screen can't show the portal id.
- Fix: capture the portal id at connect time (`GET /account-info/v3/details`); degrade to `kind:"inference"` when there's no URL; check upsert errors.
- Effort: S · Status vs last pass: New

### [Medium] CRM-005 — The push overwrites the customer's HubSpot fields and exports unverified contact data
- Confidence: CONFIRMED
- Where: `hubspot.ts:173-176,191-194` (PATCH name, industry, numberofemployees, firstname, lastname, jobtitle on every push); `sync-hubspot.ts:232-239` (`loadEmail` takes any email contact point: no verification, `deleted_at` or suppression filter)
- Impact: HuntLoop silently wins every conflict against the customer's curated CRM data. Guessed, placeholder or suppressed addresses are written into the customer's CRM. Deletions and data-rights purges never reach HubSpot (`purge-contact-data.ts` has no HubSpot handling).
- Fix: create-only for existing records (or fill blanks only), per the source-of-truth table in 11; filter `loadEmail` to sendable, non-deleted addresses; add HubSpot to the purge path.
- Effort: S–M · Status vs last pass: Still open (11 C-5/C-7), made specific

### [Low] CRM-006 — Token validation and encryption run before the authorization check
- Confidence: CONFIRMED
- Where: `settings/integrations/actions.ts:28-54` (runs before `mutate(... {minRole:"admin"})` at :56)
- Impact: any caller of the Server Action can make HuntLoop issue HubSpot API calls with arbitrary tokens: a token-validity oracle and outbound call amplification.
- Fix: move `verifyHubspotToken` inside `mutate`.
- Effort: S · Status vs last pass: New

### [Low] CRM-007 — No HubSpot rate-limit model, no per-record history, ≥5 overhead calls per push
- Confidence: CONFIRMED
- Where: `hubspot.ts:121-144,272-287`; `hubspot_connections.last_sync_error` only
- Fix: cache property existence per connection (a column), share the retry/breaker/ledger primitive with providers.
- Effort: M · Status vs last pass: Still open (11 C-6/C-8/C-9, 21 P-3)

### [High] AI-001 — Long Opus/web_fetch runs execute inside a 60 s function, with SDK defaults of 600 s timeout and 2 retries; killed runs are retried and re-billed
- Confidence: LIKELY (needs one live latency measurement for `research_company` at high effort)
- Where: `apps/web/app/api/jobs/tick/route.ts:45,79` (`maxDuration = 60`, deadline only gates *starting* a job); `packages/ai/src/client.ts:66-67` (no `timeout`/`maxRetries`/`signal`); `0008_engine_columns.sql:340` (`requeue_stalled_jobs` after 10 min); `jobs/src/ai.ts:159-167` (quota incremented only on success)
- Evidence: research_company, qualify and research_competitor are Opus, high effort, 24–32k max_tokens, up to 8 fetches and 5 `pause_turn` continuations.
- Impact: Vercel kills the invocation mid-stream, but Anthropic still bills the tokens. The job stalls, is requeued, and runs again, up to the job's retry limit. `ai_runs` rows stay `started`. Quota isn't incremented, so the spend is invisible to the plan limit. Result: wasted spend and research that never completes.
- Root cause: synchronous model calls inside a short serverless budget, with no deadline propagation.
- Fix: pass `AbortSignal` / `timeout` derived from the runner deadline, set `maxRetries: 0` (the job queue already retries), and run AI-heavy jobs on a longer-duration route or background function. Count failed-but-billed runs.
- Effort: M · Depends on: — · Mechanizable: partly (lint: `new Anthropic({` must set timeout)
- Status vs last pass: New

### [High] AI-002 — Model output is written as a plain company attribute and rendered as fact; research "facts" need only a non-empty string as their source
- Confidence: CONFIRMED (code path to UI)
- Where: `packages/jobs/src/handlers/research-company.ts` (`set("description","sells")`, `set("business_model",…)` overwrite unconditionally, contrary to the comment "never overwriting a value a person typed"); `apps/web/lib/data/opportunity-map.ts:471` → `opportunities/[id]/page.tsx:167` "What they do"; `packages/ai/src/claims.ts:84-91` (a fact needs only `sourceUrl.trim()`); `tasks/research-company.ts` and `research-competitor.ts` don't validate the URL, while `qualify-opportunity.ts:583-595` does
- Evidence: `if (finding && finding.kind !== "unknown" && finding.value.trim()) { update[column] = finding.value.trim(); }`
- Impact: an `inference` (or a hallucinated "fact" with an invented URL) replaces provider or human data in `companies.description`/`business_model` and is shown on the decision surface with no kind, source or date.
- Root cause: two storage paths for one finding (column + evidence); only the evidence path keeps the kind.
- Fix: write only `fact` findings to columns, and only when empty. Render "What they do" from evidence with its kind and source. Apply qualify's cited-domain/read-URL check in `assertValidClaim` (parse the URL, require an `http(s)` URL on the fetched domain).
- Effort: S · Mechanizable: yes (unit test on claims.ts)
- Status vs last pass: New

### [Medium] AI-003 — Research re-runs duplicate evidence and problems; insert errors are ignored
- Confidence: CONFIRMED
- Where: `research-company.ts` (`scope.insert("evidence", …)`, `scope.insert("company_problems", …)`, no conflict target, result unchecked; re-runs every 30 d per `FRESH_FOR_MS`, or when `last_researched_at` is refreshed)
- Fix: upsert on `(org_id,subject_type,subject_id,field,source_id,source_url)` as `enrich_company` does; supersede old rows.
- Effort: S · Status vs last pass: New

### [Medium] AI-004 — AI provenance is incomplete: `ai_runs.entity_id` is always null and the served model isn't recorded
- Confidence: CONFIRMED
- Where: every `packages/ai/src/tasks/*.ts` `entity: () => ({ type, id: null })`; `task.ts:72-80,100` (records and prices `route.model`; `result.model` is returned but not persisted, and server-side fallback can change it)
- Impact: a score, draft or message can't be linked to the run, prompt version or model that produced it; the cost estimate may be wrong.
- Fix: pass the entity id in the input (or `RunContext`), and persist `result.model` on success.
- Effort: S · Status vs last pass: Still open (09 A-6), made specific

### [Medium] AI-005 — The quota meters successful runs, not cost; the Free plan runs out in days on the automatic pipeline
- Confidence: CONFIRMED (metering); LIKELY (exhaustion rate)
- Where: `jobs/src/ai.ts:151-167`, `apps/web/lib/ai/budget.ts:97-103` (increment only after success); `0007_profiles_invites_accounting.sql:368` (free `ai_runs: 100`); `discover-companies.ts:80` (`MAX_AUTO_RESEARCH = 25`) + research → score
- Impact: failed runs (validation errors after full Opus output, timeouts per AI-001) cost money and aren't counted. Meanwhile the daily discovery chain uses ~50 runs a day, so Free orgs stop getting research on day 2 with no clear signal.
- Fix: count at `started` (refund only on pre-call failure), or meter `cost_cents`; show quota state on discovery runs.
- Effort: S · Status vs last pass: New

### [Medium] AI-006 — Anonymous public research spends Opus/web_fetch with no run record, and the allowance counts only successes
- Confidence: CONFIRMED
- Where: `apps/web/app/(marketing)/discover/actions.ts` (`recorder: nullRecorder`, `orgId:"public"`); `packages/jobs/src/public-research.ts` (`anonymousAllowance` counts `public_research` rows; `recordPublicResearch` runs only on success; upsert on domain keeps the original `created_at`; check-then-act race)
- Impact: public AI spend is invisible in `ai_runs` and `/analytics`. Failing lookups (sites that time out, validation failures) are unlimited per IP. Default ceiling is 200/day when enabled (`PUBLIC_RESEARCH_ENABLED` is off by default, which mitigates this).
- Fix: record public runs in `ai_runs` under a system org; count attempts in a separate table before the call.
- Effort: S · Status vs last pass: New

### [Medium] AI-007 — Prompt-injection path from a prospect's website to outbound email
- Confidence: LIKELY (mitigations present, not tested live)
- Where: `client.ts:76-85` (web_fetch tool results reach the model unwrapped; only `UNTRUSTED_CONTENT_RULE` in the system prompt); `research-company.ts` → `evidence` → `advance-enrollments.ts:loadEvidence` → `personalize_message`
- Evidence: all non-tool inputs are wrapped with `wrapUntrusted` (grep shows 12/12 tasks). Fetched pages can't be wrapped. A page can steer `research_company` into emitting "facts" with URLs on its own domain (AI-002 accepts any string), which then become citable evidence in `personalize_message`.
- Fix: the URL validation from AI-002; mark evidence originating from a research model as `reliability:"model_extracted"` and exclude it from `personalize_message` unless a human confirms it; an injection regression set.
- Effort: M · Status vs last pass: New

### [Low] AI-008 — Model and tool versions and prices are unverified; newer versions exist
- Confidence: UNVERIFIED (one live call per route settles it)
- Where: `packages/ai/src/models.ts` (`claude-opus-5`, `claude-sonnet-5` unused, `claude-haiku-4-5`; hardcoded PRICES); `client.ts:80,106` (`web_fetch_20260209`; SDK 0.116 also ships `web_fetch_20260309`/`20260318`; beta `server-side-fallback-2026-07-01`)
- Evidence: all identifiers are present in `node_modules/@anthropic-ai/sdk@0.116.0` typings, so they are not invented. A newer Opus (5.5) exists outside these typings. Every call depends on the fallback beta, and none has ever been made live.
- Fix: a live smoke per route in CI (manual secret); reconcile prices; drop the unused sonnet route or use it for medium-effort tasks (`recommend_sources`, `explain_why_now`, `sales_agent`) to cut cost.
- Effort: S · Status vs last pass: Still open (09 A-1/A-4)

### [High] XINT-001 — No external integration has ever been exercised against a live account (root cause shared by PROV-005, CRM-003, AI-008)
- Confidence: UNVERIFIED. To settle: a staging run with real Apollo, Hunter, ZeroBounce, HubSpot sandbox and Anthropic keys, with the responses recorded as fixtures.
- Where: no fixture files; all tests use scripted clients (`verify-providers.ts`, `verify-crm.ts`, `verify-tasks.ts`)
- Impact: the likely day-one failures found in this pass (Apollo people-search endpoint, HubSpot `dealstage`, AI timeouts) can't be caught by the current tests.
- Fix: a gated `npm run smoke:live` that records sanitized responses; replay them in CI.
- Effort: M (credentials) · Status vs last pass: Still open (21 P-1, 09 A-1, 11 C-4; was Critical, rated High here because it's a verification gap, not an observed break)

---

### Do not change (keep)
- `call.ts` ordering, the never-cache-failures rule, ledger rows on cache hits and refusals, and the `refused`/`empty`/`failed` distinction.
- Per-org cache isolation and canonical request hashing (`cache.ts`).
- Apollo `email_status` → confidence mapping (the principle; fix the *source endpoint*, PROV-004).
- `qualify_opportunity`'s cited-domain check (the model for AI-002).
- `resolveRecorder` refusing non-members before any model call; `consumeRateLimit` refusing in production without a DB.
- HubSpot token encryption, admin-only RLS, the token never selected in loaders, and hard delete on disconnect.
- `wrapUntrusted` on every non-tool input.
