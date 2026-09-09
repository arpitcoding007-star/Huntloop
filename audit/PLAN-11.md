# Eleventh pass — the Apollo era

**Date** 2026-09-05 · **Driven by** [New_Aud.md](../New_Aud.md) · **Program** [audit/README.md](README.md) · **Prior state** [ROADMAP.md](ROADMAP.md) R0–R6 complete, [BACKLOG.md](BACKLOG.md) P0 empty in code

This is the audit conclusion and the phased implementation plan that follows
from it. It is deliberately not a second copy of the backlog: every item below
is new work created by the two things that changed — the migrations are applied
and running, and Apollo is being adopted as the primary company-discovery
provider.

---

## 0. The audit's conclusion, in one page

Huntloop is architecturally in better shape than the request assumes. Ten
passes produced a system whose scoring is genuinely explainable, whose evidence
model is real rather than decorative, whose queue is transactional with the
rows it operates on, and whose AI layer refuses rather than guesses. Very
little here should be rebuilt.

Three things are nevertheless true, and they set the shape of this plan.

**First, the product has no company discovery.** The only inbound path is
`scan_source` — fetch a feed, extract signals, resolve to companies. That is a
*signal* pipeline, and it is a good one, but it can only find companies that
somebody wrote about this week. An ICP describing 4,000 addressable companies
produces zero of them until one appears in an RSS item. Apollo is not an
enhancement to discovery; it is the first implementation of it.
Evidence: [`packages/jobs/src/registry.ts`](../packages/jobs/src/registry.ts)
has twelve job names, none of which searches for a company; Apollo appears in
[`providers.ts`](../packages/jobs/src/providers.ts) only as `people/match`.

**Second, identity is a single unique index.** `companies` is keyed on
`(org_id, canonical_domain)`, which is correct and cheap and holds for the
volumes a feed scanner produces. It has no answer for redirects, renames,
acquisitions, alternate domains, parent/subsidiary, or the same company
arriving from Apollo under a different domain than the one a press release
used. Pouring thousands of provider rows through that key is how a company
table acquires four copies of the same account.

**Third, the provider layer is honest but singular.** `providers.ts` says so
itself: it is "not a provider abstraction framework". It resolves a vendor by
sniffing the shape of one API key, has no quota accounting, no caching, no
retry, no circuit breaking, and no telemetry. That was the right size for one
optional enrichment call. It is the wrong size for a provider that is about to
sit on the critical path of the product's primary workflow and bill per credit.

Everything else in this plan is either an extension of a system that already
works, or a consequence of those three.

---

## 1. Verdict

### KEEP — preserve, do not disturb

| System | Why it stands |
|---|---|
| Postgres-backed queue (`job_executions`, `claim_job_executions`, `requeue_stalled_jobs`) | At-least-once with `for update skip locked`, idempotent enqueue, quadratic backoff capped at 60 min. Transactional with the rows jobs operate on. Adding Apollo does not change the argument in [`queue.ts`](../packages/jobs/src/queue.ts) |
| Deterministic rule language (`@huntloop/db/rules`) | Six operators, closed field list, no I/O, provably inert `intent`, `RULE_FIELDS` checked against `ruleFacts` in both directions. This is the part most products get wrong |
| `model_score` / `score` / `rule_trace` separation | The one decision that keeps the learning loop answerable. Never collapse these |
| Append-only `opportunity_scores` | The only labelled data the product gets for free |
| Evidence model (`evidence`, FACT/INFERENCE/UNKNOWN, `claims.ts`) | §7 and §52 implemented rather than described |
| Refusal-over-guess posture | No provider → say so. No AI key → degrade to the prior step. No verifier → `unverified`. Extend this to Apollo verbatim |
| Spend guard + `ai_runs` + `usage_counters` | Per-org budget enforcement already exists with a generic `(metric, used, limit)` shape. Apollo credits are a new metric, not a new system |
| Tenant isolation: RLS + `check-admin-imports` + `SEC-ADMIN` | Two independent checks on the one unrecoverable risk |
| `audit.mjs` as the durable half of the audit program | Every finding below must end its life as a check here |

### FIX — exists, flawed

| ID | What |
|---|---|
| `PRV-01` | Provider selection by key-shape sniffing cannot express "Apollo for search, Hunter for email, ZeroBounce for verification" |
| `PRV-02` | No provider call is retried, timed out consistently, cached, rate-limited, or counted |
| `ENT-01` | `(org_id, canonical_domain)` is the whole of entity resolution |
| `ICP-02` | `icps.criteria` is untyped jsonb. `ICP-01` (writer and reader disagreeing silently) is a class of bug, not an incident — the class is still open |
| `CON-01` | `people.is_decision_maker boolean` is the entire contact-selection model |
| `SCO-01` | Scores have no model version, so drift is unmeasurable and a prompt change is indistinguishable from a market change |
| `JOB-01` | No dead-letter surface: an exhausted job sets `status` and is never seen again by anyone |
| `OBS-01` | Cost dashboard covers AI only. Provider spend has no ledger at all |

### EXTEND — good, incomplete

| ID | What |
|---|---|
| `DSC-*` | Source scanning is one discovery channel; make it one of three (sources, Apollo, imports) behind one `discovery_runs` abstraction |
| `EVD-01` | Evidence has no reliability or contradiction model — freshness exists, trust does not |
| `LRN-01` | The learning loop improves scoring rules only. It should also improve discovery queries, persona targeting and outreach angles |
| `SCO-02` | Human overrides exist as rules; they are not recorded as labelled corrections |
| `OUT-01` | Suppression and unsubscribe exist; per-contact and per-org frequency caps do not |

### BUILD — genuinely absent

| ID | What |
|---|---|
| `DSC-01` | Apollo organization search, ICP→query translation, pagination, budgets, incremental cursors |
| `CMP-01` | Competitor intelligence as a subsystem. Today competitors are a `string[]` in `organizations.profile.voice` |
| `CON-02` | Contact-fit scoring, best-contact selection, why-this-person, recommended angle |
| `ENT-02` | `external_ids`, alternate domains, merge with history |
| `OPS-05` | An end-to-end smoke path that proves the loop runs against real services |
| `CMPL-01` | GDPR-shaped export and erasure for contact data |

### SIMPLIFY

| ID | What |
|---|---|
| `SIM-01` | Discovery, enrichment and research are three verbs spread across `scan_source`, `research_company`, `enrich_person` and `lib/ai/research.ts` with overlapping responsibilities. One pipeline definition, three stages |
| `SIM-02` | `apps/web/lib/ai/*` and `packages/ai/src/tasks/*` both construct model calls. The web-side ones exist for interactive use; the boundary should be stated and enforced by a check, not by convention |
| `SIM-03` | Nav is 12 destinations for a product whose job is to answer one question. Consolidate around the journey, not the tables |

### REMOVE

| ID | What |
|---|---|
| `REM-01` | `apps/web/app/kitchen-sink` — a component gallery on a production route |
| `REM-02` | Demo/fixture branches in loaders, once the smoke path proves live data. They doubled every loader and were correct while there were no rows; they are now a second code path nobody tests |
| `REM-03` | Key-shape provider sniffing, superseded by `PRV-01` |

### DEFER — attractive, not now

| ID | What | Why |
|---|---|---|
| `DEF-01` | Multi-provider fallback chains (Apollo → Clearbit → …) | Build the seam, not the second provider. One live provider with a clean adapter is the prerequisite; a fallback chain with one implementation is speculation |
| `DEF-02` | Intent-data purchase (Bombora-style) | Expensive, and the evidence model cannot yet express "a third party asserts this without showing us why" |
| `DEF-03` | Autonomous sending | §11 human control. Approval stays |
| `DEF-04` | Vector search / embeddings for company similarity | Deterministic ICP filters are not yet exhausted |
| `DEF-05` | Command palette (`UX-15`) | Still a feature, still optional |
| `DEF-06` | Public API surface (`API-03`) | Decision already recorded; unchanged |

---

## 2. The target loop, and exactly where Apollo sits

```
  ICP (typed, versioned)
      |
      +-> [HL] query translation --> [APOLLO] organization search --+
      +-> [HL] source scanning ------------------------------------+
      +-> [HL] CSV import -------------------------------------------+
                                                                    v
                                              [HL] entity resolution + dedupe
                                                                    |
                                                       [HL] canonical company
                                                                    |
                        [APOLLO/other] enrichment --> [HL] evidence + provenance
                                                                    |
                                                    [HL] AI research (grounded)
                                                                    |
                                       [HL] qualification -> model_score
                                       [HL] deterministic rules -> score, trace
                                                                    |
                                                       [HL] opportunity created
                                                                    |
                     [APOLLO] people search --> [HL] contact-fit ranking
                                                                    |
                                              [HL] best contact + why + angle
                                                                    |
                                        [HL] draft -> human approval -> send
                                                                    |
                                              [HL] reply + outcome tracking
                                                                    |
                                                        [HL] learning loop
                                                                    |
                            improves: queries . scoring . personas . angles
```

Apollo appears exactly twice, both times as a data source, both times behind an
adapter interface that names a capability rather than a vendor. Every box
marked `[HL]` is Huntloop's, and none of them may import an Apollo type.

The enforcement is a build check, not a convention: **`PRV-CHK`** — no file
outside `packages/providers/src/adapters/` may contain the string `apollo` in
an import path or a type name. Same shape as `SEC-ADMIN`, same reasoning.

---

## 3. Standing rules for every phase

These are the request's fourteen principles reduced to gates that can fail a
build or a review.

1. **New table, new RLS policy, new migration test.** `test:migrations` covers
   tenant isolation per table; a new table without one is not merged.
2. **New job, new idempotency key, new re-run test.** Every handler must be
   provably safe to run twice. The existing suite has this shape; keep it.
3. **New provider call, new ledger row.** No external paid call without a
   `provider_calls` row recording org, capability, credits, latency, outcome.
4. **New AI claim, new evidence row.** Any model output that reaches a screen
   as an assertion carries `evidence` with a source, or is rendered as
   INFERENCE, or is not rendered.
5. **Deterministic first.** If a rule can decide it, a model may not. Every new
   model call must state in its file header why deterministic logic cannot do
   the job.
6. **Every finding ends as a check in `scripts/audit.mjs`.**
7. **No screen asserts a capability the deployment lacks.** The existing
   refusal posture applies to Apollo unchanged.

---

## 4. The phases

Effort is one engineer, floor estimates, no allowance for review. Ordering
follows one rule: **nothing that spends money or creates rows at volume ships
before the thing that can count it, deduplicate it, and see it fail.**

---

### Phase 0 — Prove the deployed system runs · **P0** · ~3 days

**Goal.** Replace "the architecture is correct" with "the loop executed at
09:14 and here is the row it wrote." Ten passes of verification have never once
driven a real model call, a real cron tick, or a real provider call.

**Why first.** Every subsequent phase adds work to a queue that has, to this
repo's knowledge, never processed a job on a schedule in a deployed
environment. Building on that is how a phase-4 bug turns out to be a phase-0
bug.

| ID | Problem | Evidence | Fix | Cx | Risk |
|---|---|---|---|---|---|
| `OPS-04` | Nothing drives the tick on any deployment | BACKLOG P1; `vercel.json` cron exists, `CRON_SECRET` never set | Set the secret, confirm invocation, assert in smoke | XS | Low |
| `DB-05b` | `0006`'s `pg_cron` schedule unconfirmed | `cron.job` unreachable via PostgREST | One SQL query; record the result in VERIFICATION | XS | Low |
| `AI-01` | No task has ever called the real Anthropic API | VERIFICATION, tenth pass | Run all ten tasks once against real API, record token cost and latency per task | S | Med — schemas may not survive real output |
| `OPS-05` | No end-to-end proof path exists | New | `npm run smoke` — see below | M | Low |
| `JOB-01` | Exhausted jobs are invisible | `markFailed` sets status; no reader | `/[org]/ops` job screen: queued, running, failed, dead, with retry and cancel | S | Low |

**Deliverable — `scripts/smoke.mjs` / `npm run smoke`.** One command, against a
real project, that walks: seed ICP -> enqueue discovery -> tick -> company row
-> `research_company` -> `score_opportunity` -> opportunity row ->
`enrich_person` -> draft. It prints each stage with its row id, its cost, and
its elapsed time, and exits non-zero at the first stage that produces nothing.
Until Phase 3 it starts at "company" rather than "discovery" and says so.

**Also.** `0020_ops_views.sql`: `job_health` and `provider_health` views the ops
screen reads, so the screen is a `select` rather than five.

**Exit.** `npm run smoke` green against the live project · a job failure is
visible and retryable in the UI without SQL · `AI-01` closed with recorded
per-task cost · Sentry has received a real error.

---

### Phase 1 — The provider seam · **P0** · ~1 week

**Goal.** One place where every paid external call is defined, retried, timed
out, cached, counted, budgeted and observed. Apollo is the first adapter
written against it; Hunter and ZeroBounce are migrated onto it in the same
change so the interface is proven by two vendors rather than designed for one.

**New workspace: `packages/providers`.**

```
src/
  contract.ts     capability interfaces + the result envelope
  registry.ts     capability -> configured adapter, resolved at boot
  call.ts         retry . backoff . timeout . circuit breaker . ledger
  cache.ts        keyed on (capability, normalized request), TTL per capability
  budget.ts       per-org credit reservation, on top of usage_counters
  adapters/
    apollo/       organizationSearch . organizationEnrich . peopleSearch . personMatch
    hunter/       personMatch
    zerobounce/   verifyEmail
```

**The contract.** Five capabilities, each a function from a Huntloop-shaped
query to a Huntloop-shaped result plus a cost record:

| Capability | Result envelope |
|---|---|
| `company.search` | `{ items, total, cursor, partial, provider, credits, cachedAt }` |
| `company.enrich` | `{ item \| null, provider, credits }` |
| `person.search` | `{ items, total, cursor, partial, provider, credits }` |
| `person.match` | `{ candidates, provider, credits }` |
| `email.verify` | `{ status, provider, credits }` |

`partial: true` is the load-bearing field. A provider that returns 40 of 100
requested rows because it hit a page limit is a different fact from a provider
that has 40, and Phase 3's incremental cursor depends on telling them apart.

| ID | Problem | Fix | Cx | Risk |
|---|---|---|---|---|
| `PRV-01` | One key sniffed for one vendor | Explicit `PROVIDER_<CAPABILITY>` config, validated at boot against a live auth ping, so a wrong key fails as "wrong credentials" not "no results" — the exact failure the current comment set out to avoid, now avoided by verification rather than by having only one variable | S | Low |
| `PRV-02` | No retry/timeout/backoff/breaker | `call.ts`: 3 attempts, exponential + jitter, 15 s timeout, breaker opens after 5 consecutive 5xx per provider and reports as unavailable rather than throwing per-call | M | Med |
| `PRV-03` | No caching; the same domain enriched twice bills twice | `provider_cache` keyed on normalized request; TTL per capability (search 24 h, enrich 30 d, verify 90 d). A cache hit still writes a ledger row with `credits: 0` so hit rate is measurable | M | Low |
| `PRV-04` | No credit accounting | `provider_calls` ledger + `usage_counters` metrics `apollo_credits`, `enrich_credits`, `verify_credits`. Reservation before the call, reconciliation after | M | Med — over-counting is safe, under-counting is a surprise invoice |
| `PRV-05` | No per-org quota on provider spend | Extend `withinAiBudget` into `withinBudget(metric)`; same fail-open-on-unreadable reasoning, same refusal rendering | S | Low |
| `OBS-01` | Provider spend invisible | Extend the existing cost screen to read the ledger beside `ai_runs` | S | Low |

**Migration `0011_providers.sql`.** `provider_accounts` (org, capability,
provider, enabled, monthly_credit_limit), `provider_calls` (org, capability,
provider, request_hash, credits, latency_ms, http_status, outcome, error,
created_at), `provider_cache` (request_hash pk, capability, provider, body
jsonb, fetched_at, expires_at). Ledger and cache are org-scoped with RLS;
cache is deliberately **not** shared across orgs — a cross-tenant cache is a
cross-tenant leak with a performance justification.

**Exit.** All three existing vendors run through `packages/providers` · a
forced 500 from a mocked Apollo produces three attempts and one open breaker ·
`PRV-CHK` passes · a cache hit is visible in the ledger · exceeding a credit
limit produces a refusal, not a spend.

---

### Phase 2 — Canonical identity · **P0** · ~1 week

**Goal.** Huntloop's own company and person ids, with provider ids as
attributes. Nothing in Phase 3 may create a row until this is in place.

| ID | Problem | Fix | Cx | Risk |
|---|---|---|---|---|
| `ENT-01` | One unique index is the whole model | `company_domains` (company_id, domain, kind: primary/alternate/redirect/former, evidence_id) with the unique index moving to it. `companies.canonical_domain` stays as the display key | M | **High — data migration on a live table** |
| `ENT-02` | Provider ids have nowhere to live | `external_ids` (org, entity_type, entity_id, provider, provider_id, first_seen_at, last_seen_at), unique on (org, provider, provider_id) | S | Low |
| `ENT-03` | No merge | `company_merges` (winner, loser, merged_by, reason, payload jsonb) + a `merge_companies()` function that repoints opportunities, people, evidence and scores inside one transaction and keeps the loser row soft-deleted with a pointer | L | High |
| `ENT-04` | No parent/subsidiary | `companies.parent_company_id` + `relationship_kind`. Deliberately minimal: a hierarchy is not the same as a graph, and the product only needs "do not pitch the subsidiary and the parent in the same week" | S | Low |
| `ENT-05` | Matching is exact-string | `resolveCompany({domain?, name?, providerIds?})` — domain canonicalization (scheme, www, trailing dot, punycode, known redirect list), then provider id, then normalized-name + country with a confidence band. Returns `{companyId, confidence, matchedOn}` and never silently merges below `high` — it flags for review | L | Med |

**On the redirect list.** Following redirects at resolve time is an SSRF
surface and a latency cost on a hot path. `fetch.ts` already has the SSRF
guard; resolution reads a cached `company_domains` row and enqueues a
`resolve_entity` job to confirm asynchronously. Deterministic in the request
path, network in the queue.

**New job.** `resolve_entity` — confirms redirects, reconciles provider ids,
proposes merges. Idempotent on (entity_type, entity_id).

**Exit.** The same company arriving from Apollo (`apollo.io/org/123`, domain
`acme.io`) and from a press release (`www.acme.com` redirecting to `acme.io`)
produces one row · a merge is reversible from `company_merges` · migration test
proves no cross-tenant merge is reachable.

---

### Phase 3 — ICP v2 and Apollo discovery · **P1** · ~2 weeks

The two halves of one loop. The ICP is done first because the query translator
is only as good as the structure it reads, and `ICP-01` proved that an untyped
`criteria` blob fails silently in the worst possible way — the model judged
every company against an ICP asserting nothing, in a tone that read as a
finding.

#### 3a. ICP v2

| ID | Problem | Fix | Cx |
|---|---|---|---|
| `ICP-02` | `criteria jsonb` untyped, writer/reader agreement by convention | One zod schema in `@huntloop/db/icp`, imported by every writer and every reader. Parse on read; a criteria blob that does not parse is a loud error, not an empty list | S |
| `ICP-03` | No real versioning — `version integer` is never incremented by anything | `icp_versions` append-only snapshot on every change, with the diff. Scores reference the version they were computed against | M |
| `ICP-04` | Thin model: no personas per segment, no buying/negative signals, no example companies, no exclusion semantics beyond a second blob | Structured: `segments[]`, `personas[]` (already a table — link it), `industries`, `employee_range`, `revenue_band`, `geographies`, `technologies`, `triggers`, `pain_points`, `use_cases`, `buying_signals`, `negative_signals`, `exclusions`, `example_companies[]` | M |
| `ICP-05` | No sense of whether an ICP is any good | `icp_quality` — a deterministic completeness score (which fields are populated, how specific), plus an addressable-company estimate taken from Apollo's `total_entries` on a zero-row search, which costs one cheap call. Never an AI-invented number | M |

**Migration `0012_icp_v2.sql`** + a backfill that reads existing `criteria`
under both known shapes and writes the typed one, refusing rather than guessing
where it cannot tell.

#### 3b. Apollo discovery

| ID | Problem | Fix | Cx | Risk |
|---|---|---|---|---|
| `DSC-01` | No company discovery exists | `discover_companies` job + `company.search` capability | L | Med |
| `DSC-02` | ICP -> query translation | **Deterministic mapper**, not a model call. ICP fields map to Apollo's documented filter parameters through one table; unmappable fields are reported as "not expressible in this provider" on the discovery screen rather than dropped. An optional AI step *proposes* keyword expansions, which a human accepts — the proposal is not the query | M | Med |
| `DSC-03` | Pagination, limits, quotas | `discovery_runs` holds `page_cursor`, `pages_fetched`, `max_pages`, `credit_budget`, `stop_reason`. A run stops on budget, on page cap, on `partial`, or on exhaustion, and always records which | M | Low |
| `DSC-04` | Repeat calls for the same query | `discovery_queries` stores the normalized query and its hash; a re-run within TTL reads `provider_cache`. Incremental re-runs pass a `since` cursor where the provider supports one and otherwise diff against `external_ids` already seen | M | Low |
| `DSC-05` | Recurring discovery | Extend `schedule_scans` into `schedule_discovery` — same due-row pattern as `sources.next_scan_at`, same idempotency shape | S | Low |
| `DSC-06` | Discovery is unexplainable | `discovery_results` records, per company, which query produced it, which filters matched, its rank in the provider's response, and whether it was new, a duplicate, or excluded — and by which exclusion | M | Low |
| `DSC-07` | Provider outage looks like an empty market | A failed run is `status: failed` with the provider error, never zero results. Partial pages are kept with `partial: true` and resumed | S | **High if wrong** |

**Migration `0013_discovery.sql`.** `discovery_queries`, `discovery_runs`,
`discovery_results`, plus `saved_searches` (a named `discovery_query` with a
schedule). `sources` gains `discovery_query_id` so a scanned source and a
searched query are two kinds of the same thing on one screen.

**Screens.** `/[org]/discovery` — build a search from the ICP with every filter
visible, see the estimated count *before* spending, run it, watch results
arrive with per-result reasons, promote to companies in bulk. Saved and
recurring searches live here.

**Exit.** An ICP produces a query, an estimate, a bounded run, and companies
that are provably deduplicated against existing rows · a second identical run
inside TTL spends zero credits · a simulated 429 and a simulated outage each
produce a resumable run with a stated reason · `npm run smoke` now starts at
the ICP.

---

### Phase 4 — Company intelligence and competitors · **P1** · ~2 weeks

| ID | Problem | Fix | Cx |
|---|---|---|---|
| `SIM-01` | Discovery/enrichment/research overlap across four files | One `pipeline.ts` naming the stages and their preconditions; handlers become stage implementations. No behaviour change, one place to read | M |
| `ENR-01` | No company enrichment job — companies arrive with whatever the source gave | `enrich_company` using `company.enrich`, writing evidence rows with provider attribution, cached 30 d | M |
| `EVD-01` | Evidence has freshness but no reliability, and no contradiction handling | `evidence.reliability` (provider-attested / first-party / press / inferred), `evidence.supersedes`, and a contradiction flag when two sources disagree on a typed field. The UI shows both rather than picking | M |
| `EVD-02` | Dedupe is per-source | Content-hash dedupe across sources, so the same funding round from three outlets is one claim with three citations | S |
| `AI-02` | Research prompts construct context ad hoc | One context builder: capped, ordered by reliability then recency, token-budgeted, with the same shape for every task. Cuts token spend and removes the largest hallucination surface | M |
| `CMP-01` | Competitors are a `string[]` in a settings blob | The subsystem below | L |

**Competitor intelligence.** New tables `competitors` (org, name, canonical
domain, is_ours boolean — a competitor is a company, so it reuses entity
resolution), `competitor_profiles` (positioning, differentiators, products,
target markets, pricing where discoverable, each field carrying an evidence
id), `competitor_evidence`, and `company_competitor_signals` (this prospect
mentions / uses / was won by this competitor — with the evidence).

Two jobs: `research_competitor` (grounded, evidence-required, refuses rather
than characterising a competitor from the model's memory — a hallucinated
competitor weakness is a claim a salesperson repeats out loud) and a resolver
that links competitor mentions found by `extract_signals` to competitor rows.

**Placement.** Onboarding gains a competitor step *after* product and before
ICP, because "who else do your buyers consider" is how a good ICP gets its
exclusions. In the nav it belongs under Intelligence, not as a top-level
destination — it is context for opportunities, not a workflow of its own.

**Exit.** A competitor has a profile where every claim cites a source, or says
UNKNOWN · a prospect using a competitor shows it on the opportunity with the
evidence · no competitor claim exists without provenance.

---

### Phase 5 — Contacts and qualification v2 · **P1** · ~2 weeks

| ID | Problem | Fix | Cx |
|---|---|---|---|
| `CON-01` | `is_decision_maker boolean` | Keep the column as a derived convenience; add `contact_fit_scores` (person, icp_version, persona_id, dimensions jsonb, score, rule_trace, computed_at) mirroring the opportunity scoring architecture exactly — deterministic rules over title/seniority/department/persona match, model score separate, both visible | L |
| `CON-02` | No best contact | `opportunities.primary_person_id` is chosen by `rank_contacts`, with `why_this_person` and `recommended_angle` stored as evidence-backed text, and the ranked alternatives kept so a user can override with one click. An override is recorded as a correction (see `SCO-02`) | M |
| `CON-03` | No contact discovery, only per-person match | Apollo `person.search` scoped to the company and the ICP's personas, budgeted per opportunity | M |
| `CON-04` | Contact freshness and employment change | `people.last_verified_at`, `people.employment_status` (current / departed / unknown), re-verify on a schedule for contacts in an active sequence. A departed contact halts its enrollment rather than emailing a dead address | M |
| `CON-05` | Duplicate people | Entity resolution from Phase 2 applied to people: `(org, company, normalized name)` plus provider id, with the same merge machinery | M |
| `SCO-01` | No score versioning | `opportunity_scores.model_version`, `prompt_version`, `icp_version`, `rules_version`. Drift becomes a query rather than a guess | S |
| `SCO-02` | Overrides are not labelled data | `score_overrides` (opportunity, previous, new, reason, by, at) feeding the learning loop. A human disagreeing with the model is the highest-value signal the product receives and it is currently discarded | M |
| `SCO-03` | Recalculation is implicit | `recompute_scores` job triggered by ICP version change or rule change, batched per org, with a preview showing how many opportunities would change band before it runs | M |
| `SCO-04` | Unknowns are handled per-task | One policy: an unknown never counts as a negative; a dimension with too many unknowns lowers `confidence`, not `score`. Enforce in `ruleFacts` and test it | S |

**Exit.** An opportunity names one contact, with a fit score, a rule trace, a
reason and an angle, all evidence-backed · overriding either a score or a
contact is one click and produces a labelled row · a rule change previews its
blast radius before it applies.

---

### Phase 6 — Outreach, safety and compliance · **P1** · ~1 week

| ID | Problem | Fix | Cx |
|---|---|---|---|
| `OUT-01` | No frequency caps | Per-contact (`max 1 message / N days`), per-company (`max N contacts in flight`), per-org daily send ceiling on top of the existing per-mailbox `claim_mailbox_send` | M |
| `OUT-02` | Reply classification exists; outcome attribution is thin | Link `classify-reply` output to `outcomes` with the score and contact that produced it, so the learning loop has a complete tuple | S |
| `OUT-03` | Failure states are per-message | A campaign-level health view: bounced, suppressed, halted, mailbox disconnected, budget exhausted | S |
| `CMPL-01` | No export or erasure | `export_org_data` and `purge_contact_data` jobs producing a machine-readable archive and a verified deletion with an audit row. Suppression survives erasure by hashed address — deleting someone must not make them contactable again | M |
| `CMPL-02` | Retention is unbounded | `contact_data_retention_days` per org, enforced by a scheduled job, defaulting to no deletion but *configurable*, with the deletion recorded | S |
| `CMPL-03` | Unsubscribe is per-message-token only | Org-wide suppression on unsubscribe by default, and a documented CAN-SPAM checklist in `docs/OPERATIONS.md` | S |

**Exit.** No path can send twice to one address inside the window · an export
produces every row about one contact · an erasure is verifiable and leaves the
suppression intact.

---

### Phase 7 — Close the learning loop · **P2** · ~1 week

Today `analyze_performance` proposes scoring rules. That is one of four things
outcomes should improve.

| ID | Extension | What it changes |
|---|---|---|
| `LRN-02` | Findings gain a target: `scoring_rule` \| `discovery_query` \| `persona` \| `outreach_angle` | Same approval UI, four kinds of proposal |
| `LRN-03` | Discovery feedback | Companies that convert are compared against the query that found them; the proposal is a filter change with the evidence behind it |
| `LRN-04` | Persona feedback | Which titles actually replied, versus which the ICP predicted |
| `LRN-05` | Angle feedback | Which recommended angles preceded meetings. Angles are enumerable, so this is counting, not inference |
| `LRN-06` | Correction ingestion | `score_overrides` and contact overrides become inputs, not just records |

Every proposal remains human-approved. Nothing here changes behaviour
automatically, and the citation constraint from the tenth pass — a finding may
only cite ids it was given — extends unchanged to the new targets.

**Exit.** A rejected finding is never re-proposed identically · a query
improvement can be traced from an outcome to the filter it changed.

---

### Phase 8 — Observability, cost, performance · **P1**, runs alongside 1–7 · ~1 week of dedicated work

Consolidation of the instrumentation each phase adds, plus the questions the
request asked to be answerable.

| Question | Answered by |
|---|---|
| What failed? | `job_health` view + ops screen; Sentry for exceptions |
| Why? | `job_executions.error`, `provider_calls.error`, breaker state |
| Which org? | Every ledger and job row is org-scoped; org filter on the ops screen |
| Can it retry? | Retry button, honouring `permanent` |
| How much did it cost? | `ai_runs` + `provider_calls`, per org per period, on one screen |
| What happened next? | `events` timeline per company and per opportunity |

Plus: structured logging with a request/job correlation id through every layer;
queue-depth and oldest-queued-job metrics; per-org fairness in `claim` (round
robin by org rather than pure `run_at`, so one org's 5,000-company discovery
cannot starve everyone else — this is the single most likely scaling failure
once Phase 3 ships); `EXPLAIN ANALYZE` on the list queries (`PERF-04`, now
unblocked); indexes for the new tables sized against real row counts rather
than guessed.

---

### Phase 9 — UX consolidation · **P2** · ~1.5 weeks

The product should answer six questions. Today it presents twelve tables.

| Question | Where it is answered today | Where it should be |
|---|---|---|
| Who should I pursue next? | Nowhere — Opportunities is a list, not a queue | A ranked work queue, one decision at a time, with a "next best action" |
| Why are they a good fit? | Opportunity detail, mixed with everything else | The verdict panel, dimensions and rule trace first |
| Why now? | `why_now` text field | The trigger with its evidence and its date |
| Who should I contact? | Not answered | Phase 5's best contact with alternatives |
| What should I say? | Draft screen | The angle, its evidence, then the draft |
| What should I do next? | Not answered | One action per opportunity state, always visible |

Work: consolidate Opportunities/Pipeline/Companies into one surface with three
views · bulk actions everywhere a list exists (promote, dismiss, assign,
enqueue) · progress feedback on every long-running job (discovery especially —
a run that takes four minutes must not look like a hung page) · empty states
that say what to do, not that there is nothing · `REM-01` and `REM-02`.

---

### Phase 10 — Re-audit · **continuous, gated at each phase**

Per phase: unit tests for new pure logic · migration tests for every new table
(tenant isolation, not just shape) · provider adapter tests against recorded
fixtures *and* against simulated 429/500/timeout/partial · idempotency tests
that run every new handler twice and assert one effect · prompt-contract tests
for every new AI task including a refusal case · Playwright coverage for every
new screen · a new `audit.mjs` check per closed finding.

New suites: `test:providers` (adapters + call semantics), `test:idempotency`
(every handler, twice), `test:discovery` (query translation is deterministic
and total — every ICP field either maps or is reported unmappable).

At the end of each phase, update `FINDINGS.md`, `BACKLOG.md`, `VERIFICATION.md`
and this file. A phase is not done when its code merges; it is done when its
findings are closed with checks behind them.

---

## 5. Sequencing

```
Phase 0  Prove production ---+
                              +--> Phase 1  Provider seam ---+
                              |                              +--> Phase 3  ICP v2 + Apollo discovery ---+
                              +--> Phase 2  Canonical identity ------------------------------------------+
                                                                                                          +--> Phase 4  Company + competitor intelligence ---+
                                                                                                          |                                                   +--> Phase 6  Outreach + compliance
                                                                                                          +--> Phase 5  Contacts + qualification v2 ----------+
                                                                                                                                                               +--> Phase 7  Learning loop
Phase 8  Observability ..... threaded through 1-7, consolidated after 6
Phase 9  UX ................ after 5, because it presents what 3-5 produce
Phase 10 Re-audit .......... gates every phase
```

**Hard dependencies.** Phase 3 must not start before Phase 2 (volume before
identity is unrecoverable). Phase 5's contact discovery must not start before
Phase 1 (unbudgeted per-opportunity provider calls). Phase 7 needs Phase 5's
labelled corrections to have been collecting for a while — it can be built
earlier, but it will have nothing to say.

**Floor total:** ~11 weeks of engineering, one person, excluding review and the
manual items below.

**If only three weeks exist:** Phase 0, Phase 1, Phase 2. That combination
leaves the product no more capable than today and makes every subsequent week
cheaper. Doing Phase 3 first and identity later is the one ordering that
creates work rather than removing it.

---

## 6. What this plan does not do, and why

- **It does not rebuild scoring, evidence, the queue, or the rule language.**
  All four are better than what would replace them.
- **It does not adopt Explee's model.** Competitor intelligence is here because
  Huntloop's own ICP work needs exclusions and its own outreach needs
  positioning — not because Explee has a screen for it. Everything else from
  that analysis is in DEFER or absent.
- **It does not make Apollo load-bearing.** Every Apollo capability has a
  Huntloop-shaped interface, a cache, a budget and a defined behaviour when it
  is absent. Deleting the adapter directory should break a build in one place.
- **It does not automate consequential actions.** Approval stays on sending,
  on merges below high confidence, on learning findings, and on any
  recomputation that would move opportunities between bands.

---

## 7. MANUAL ACTIONS REQUIRED

Nothing below blocks Phase 0–2 planning or code. Each is required before the
phase named can go live in production.

| # | Action | Why | Where | Value/config | Verify | Blocks |
|---|---|---|---|---|---|---|
| 1 | Set `CRON_SECRET` on the Vercel project | The tick endpoint refuses all requests without it; nothing has run on a schedule | Vercel project → Settings → Environment Variables | `openssl rand -hex 32` | `npm run smoke` shows the cron-triggered tick in `job_executions` | Phase 0 |
| 2 | Confirm `ANTHROPIC_API_KEY` is a real, billable key | Every AI task has only ever run against a scripted client | Vercel env vars / `apps/web/.env.local` | Anthropic console key | `AI-01` smoke run returns real completions with recorded token cost | Phase 0, all AI-dependent phases |
| 3 | Provision a Sentry DSN | No exception has ever reached Sentry from this deployment | sentry.io project settings | `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` | Throw a deliberate error; confirm it appears in Sentry | Phase 0, Phase 8 |
| 4 | Provision an Apollo account and API key, and confirm the plan's credit allotment | Phase 1/3 cannot be built against a mocked API alone; real rate limits and response shapes must be confirmed | apollo.io account settings → API | The key; note the plan tier and monthly credits | A real `organizationSearch` call returns rows and the response shape matches the adapter's fixtures | Phase 1, Phase 3 |
| 5 | Decide and communicate the Apollo monthly credit budget per org (or org-wide) | `PRV-05`'s quota enforcement needs a number, and it is a billing decision, not an engineering one | — | A number in credits/month | `provider_accounts.monthly_credit_limit` set and a forced-over-budget test refuses | Phase 1, Phase 3 |
| 6 | `DATABASE_URL` (direct Postgres connection) | Still needed for `EXPLAIN ANALYZE`, and now also for running the `0011`–`0013` migrations from the CLI rather than pasting into the dashboard | Supabase dashboard → Project Settings → Database → Connection string (Transaction pooler) | Replace `[YOUR-PASSWORD]` | `packages/db` migration scripts run without manual SQL-editor steps | Phase 1, 2, 3 |
| 7 | Confirm `pg_cron` scheduled `0006`'s prune job | Unconfirmed since the original audit; the same mechanism will carry `schedule_discovery` in Phase 3 | Supabase SQL editor | `select * from cron.job;` | A row exists for `prune_rate_limits` | Phase 0 (`DB-05b`), Phase 3 |
| 8 | Decide the default contact-data retention period | `CMPL-02` needs an org default; this is a legal/policy call, not a technical one | — | A number of days, or "no automatic deletion" | Set as the default in `organizations` and confirmed in `docs/OPERATIONS.md` | Phase 6 |
| 9 | Confirm which jurisdictions' outreach rules apply (GDPR / CAN-SPAM / other) | Changes what `CMPL-01`–`03` must actually enforce, and whether a consent-capture step is required before first contact | — | A short written policy | Reviewed against `docs/OPERATIONS.md`'s compliance checklist | Phase 6 |
| 10 | Repo admin: branch protection on `main` | Standing item, unrelated to Apollo, still open | GitHub repo settings → Branches | Require PR review + status checks | `CONTRIBUTING.md` checklist satisfied | None — do anytime |

---

## 8. Implementation status

Kept here rather than in a separate file, because a status that lives away from
the plan drifts from it. Updated as work lands; every row is either backed by a
test in `npm run verify` or is explicitly marked as not started.

**A pattern worth naming, because it recurred.** Several items in `0016`–`0020`
shipped as SQL — tables, functions, constraints, views — that no application
code ever called. Each looked complete in the schema and did nothing in the
product: `evidence.claim_hash` was never written, `can_contact` was never asked,
`retry_job` had no button, `opportunity_scores.prompt_version` stayed null.
A migration is not a feature. Where the table below says "wired", it means an
application path reaches it and a test proves it.

| ID | State | Where |
|---|---|---|
| `PRV-01`–`05` | Done | `packages/providers` |
| `ENT-01`–`05` | Done | `0012`, `packages/db/src/identity.ts`, `resolve_entity` |
| `ICP-02`–`05` | Done | `0013`, `packages/db/src/icp.ts` |
| `DSC-01`–`07` | Done | `0014`, `discover_companies`, `schedule_discovery` |
| `ENR-01` | Done | `enrich_company` |
| `EVD-01` | Done | `0020`, wired by `enrich_company` and `research_competitor` |
| `EVD-02` | Done | `0022` — `0020`'s `claim_hash` had no writer; now generated, with `merge_duplicate_evidence` called from `scan_source` |
| `CMP-01` | Done | `0015`, `0021`, `research_competitor`, `resolve_competitor_mentions` |
| `CON-01`, `CON-02` | Done | `0016`, `rank_contacts` |
| `SCO-01` | Done | `0016` columns, **wired** by `score_opportunity` |
| `SCO-02` | Done | `0016`'s `record_override`, **wired** by the Disagree control on an opportunity |
| `SCO-03` | Done, minus the preview | `0023`, `schedule_recomputes`, `recompute_scores`, Rescore all button |
| `OUT-01` | Done | `0017`'s `can_contact`, **wired** as the single gate in `send_message` |
| `CMPL-01` | Erasure done; export not surfaced | `purge_contact_data`; `export_contact` has no caller yet |
| `CMPL-02` | Done | `enforce_retention`, daily sweeper |
| `JOB-01` | Done | `0019`'s views, **wired** by `/[org]/ops` |
| `SIM-01` | Not started | One `pipeline.ts` naming the stages |
| `AI-02` | Not started | One token-budgeted context builder |
| `CON-03`–`CON-05` | Not started | Contact discovery, freshness, dedupe |
| `SCO-04` | Not started | One unknown-handling policy in `ruleFacts` |
| `OUT-02`, `OUT-03` | Not started | Outcome attribution, campaign health |
| `CMPL-03` | Partial | Unsubscribe is already org-wide; the CAN-SPAM checklist is unwritten |
| `LRN-02`–`LRN-06` | Not started | `0018` has the columns; nothing reads them yet |
| `SIM-02`, `SIM-03`, `REM-01`–`03` | Not started | — |
| Phase 0 (`OPS-04`, `DB-05b`, `AI-01`, `OPS-05`) | Blocked | Needs §7 manual actions 1, 2, 6, 7 |

**The remaining `0018` gap is the same pattern.** `learning_findings` gained a
target kind, `outcomes` gained attribution columns, and no code writes or reads
either. `LRN-02`–`LRN-06` is that wiring, and it is the largest single piece of
decorative schema still in the tree.
