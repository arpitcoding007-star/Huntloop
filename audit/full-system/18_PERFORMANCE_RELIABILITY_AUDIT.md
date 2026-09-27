# Performance, reliability & observability

## Performance

**Measured:**
- Shared client JS **245.2 kB of a 275 kB budget**, enforced in CI (`scripts/bundle-budget.mjs`). A budget that fails the build is worth more than a one-off Lighthouse score.
- Production build compiles in ~6–9s (Turbopack); 15 static pages pre-rendered, the rest server-rendered on demand.
- Deliberate bundle work is visible in history: auth moved off the client SDK (217 kB → 151 kB), Sentry's 185 kB trimmed to 33 kB via tree-shaking and `DefinePlugin`, PostHog captured server-side at 0 kB client cost.

**Query shapes inspected:**
- Opportunity list — one query with embedded relations, mapped in `opportunity-map.ts`. No N+1.
- Opportunity detail — one main query plus **two deliberate side queries** (evidence, contact fit) run in `Promise.all`. The side-query choice is documented as resilience, not oversight: a mistake in a nested embed throws and takes out the page; a separate read that returns empty costs only that feature.
- Job claim — `for update skip locked`, indexed.

**Not measured, and this is the gap:** no load test exists anywhere. Concurrency behaviour of `tick()` (default `limit: 5`, 60s `maxDuration`) under real volume is unknown, as is query performance with 10k+ companies per org.

| # | Severity | Finding |
|---|---|---|
| PF-1 | Medium | No load test; `tick()` concurrency and DB performance at volume unverified |
| PF-2 | Medium | The tick's throughput ceiling is unanalysed: at `limit: 5` per minute, an org with thousands of queued enrichments drains slowly, and nothing surfaces queue depth as a user-visible expectation |
| PF-3 | Low | No skeleton loaders on heavier screens |
| PF-4 | Low | `getStageLabels` adds one HubSpot request per sync (deliberate trade against caching credentials in-process) |
| PF-5 | Info | No caching layer in front of `lib/data` reads; Next's own caching plus `revalidatePath` is the current strategy and is adequate at this scale |

## Reliability

Strong primitives, thin operations layer.

**Good:**
- At-least-once queue with idempotent handlers, exponential backoff, a `permanent` flag for failures that are answers, stall recovery, and a deadline that stops the runner claiming work it cannot finish.
- Provider breaker prevents hammering a failing vendor.
- Every job outcome is recorded in `job_executions` with its error; every provider call in `provider_calls`; every model run in `ai_runs`.
- `/ops` ("Engine") renders job and provider health — the right screen, and unusual to have built this early.

**Missing:**

| # | Severity | Finding |
|---|---|---|
| R-1 | High | **No dead-letter surface.** A job that exhausts `max_attempts` sits `failed` with no operator queue and no retry control |
| R-2 | High | **No alerting.** Sentry captures exceptions, but a job failing silently every tick, a provider breaker stuck open, or a credential gone invalid produce no notification |
| R-3 | Medium | No health check endpoint for uptime monitoring |
| R-4 | Medium | No rollback procedure documented for a bad deploy |
| R-5 | Medium | Migrations applied by hand — the largest operational risk in the project (`19_TESTING_CICD_AUDIT.md` T-2) |

## Observability — can an operator answer the four questions?

> *What failed, why, which user was affected, and can it safely be retried?*

| Question | Answerable? |
|---|---|
| What failed? | ✅ `job_executions.error`, `provider_calls.outcome`, Sentry |
| Why? | ✅ outcomes are distinct and named (`refused` vs `empty` vs `failed` vs `rate_limited`), with refusal reasons |
| Which user/org? | ✅ every job and provider call carries `org_id`; `ai_runs` records the caller |
| Can it be retried safely? | 🟡 **yes in principle** — every handler is idempotent by design — but **there is no control that does it**. An operator must write SQL |

So three of four are answerable from the product; the fourth is answerable in theory and not in practice.

## Recommendations

1. **Dead-letter view in `/ops`** with a "retry" button that re-enqueues. The handlers are already idempotent, so this is safe by construction — it is the cheapest large reliability win available.
2. **Alert on**: repeated failure of the same job name, a breaker open longer than N minutes, `credential_status = 'invalid'`, and a tick that has not run in 10 minutes (which would have surfaced the missing cron immediately).
3. **Load test** before the first real customer volume, focused on tick throughput and the opportunity list query.
