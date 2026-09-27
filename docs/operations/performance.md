---
description: The budgets that exist, the work that has been done, and what has never been measured.
---

# Performance

> **Layer:** Internal · **Audience:** engineering, operations

## The bundle budget

```bash
npm run audit:bundle     # after a build
```

**Budget: 275 kB gzipped**, measured at 244.6 kB — about 12% of headroom. Fails
CI when exceeded.

### Why this exists

Adding Sentry took shared First Load JS from 103 kB to 185 kB. Tree-shaking
recovered 49 kB of that, and **nobody would have known without measuring.** A
bundle grows the way a room gets untidy — never in one noticeable step.

The Next 16 upgrade made it urgent: `next build` no longer prints a First Load
JS column at all, so the number that used to be visible on every build is now
visible on no build.

### What is measured, and what is deliberately not

**Measured:** `rootMainFiles` + `polyfillFiles` from the build manifest — the
chunks loaded on **every** route, by **every** visitor, before anything
page-specific.

| Excluded | Why |
|---|---|
| The proxy bundle | `NEXT_PUBLIC_*` variables are inlined at build time, so with the empty credentials CI builds with, the bundler proves the Supabase branch in `proxy.ts` is dead and drops it — **125 kB in CI against 154 kB in production.** A budget reading that number would police a bundle nobody ships |
| Per-route chunks | They vary with what a page imports, and a budget that fires when someone adds a screen teaches people to raise the budget |

Gzipped, not raw: raw is 787 kB where gzip is 245 kB, and gzip is the more
conservative of the two available units.

## Deliberate bundle decisions

| Decision | Saved |
|---|---|
| PostHog server-side (`posthog-node`) rather than `posthog-js` | ~50 kB |
| Sentry Session Replay never added to the integration list | ~49 kB (measured against an older SDK; zero today, because the code is not in the module graph at all) |
| `bundleSizeOptimizations` kept even though it currently changes nothing | Insurance — the condition it guards is one line in another file |

{% hint style="info" %}
The Sentry tree-shaking config is documented in `next.config.ts` with the
**measurement that showed it changes nothing today** — two clean builds, `.next`
deleted between them, 1013.9 kB of client chunks either way. It is kept because
it costs nothing and the day someone adds `Sentry.replayIntegration()` it starts
mattering again. That is the house style: record the measurement, not the
belief.
{% endhint %}

## Server-side

| Technique | Where |
|---|---|
| Server Components by default | The whole app |
| React `cache()` on `currentViewer` | The org layout and the page inside it share one `auth.getUser()` + join |
| Schema probe cached per worker | The answer changes exactly once; probing per page load would add a round trip forever to detect a one-time transition |
| Provider registry memoised per process | A serverless instance handles many jobs; three adapters per job is pointless |
| Per-capability provider cache | 24 h to 90 d; a cache hit costs zero credits |
| `contact_frequency` denormalised | The alternative is a four-table aggregate on the hottest path in the system |
| Prompt caching | The biggest AI cost lever — see [Observability](observability.md#the-analytics-screen) |

## Engine performance

| Property | Value | Reasoning |
|---|---|---|
| Jobs per tick | 5 | |
| `maxDuration` | 60 s | Works on both Hobby and Pro |
| Reserve before the deadline | 20 s | The runner declines to start a job it cannot finish rather than being killed holding the lock |
| Parallelism within a tick | **1** | Five at once against one connection pool and one Anthropic rate limit buys latency and spends reliability |
| Parallelism across ticks | Unbounded | `for update skip locked` gives disjoint sets |
| Retry backoff | `attempts²` minutes, capped at 60 | |
| Provider retries | 3, exponential with jitter, 15 s timeout each | A search takes 300 ms–3 s, so 15 s means *something is wrong*, not *this is slow* |
| Extraction cap per scan | Bounded | A feed publishing 80 items overnight costs 80 extractions spread over several ticks rather than 80 at once |
| Signal fetches per tick | Capped | Keeps a sweeper from spending a month's budget in one sweep |

## Database indexes

Every migration adds the indexes its own access patterns need — partial indexes
for "due" and "pending" queries (`sources_due_idx`, `job_executions_due_idx`,
`enrollments_due_idx`, `merge_candidates_pending_idx`,
`discovery_queries_due_idx`, `learning_findings_pending_idx`,
`human_overrides_unconsumed_idx`), GIN on `memories.tags`, and drift indexes on
`opportunity_scores` so a score is only compared to one produced by the same
rules and prompt version.

## What has never been measured

{% hint style="warning" %}
| Gap | Why it matters |
|---|---|
| **No load test** | The rate limiter is proven by seven database-level tests and by nothing driving it through HTTP |
| **No query plans** | `EXPLAIN ANALYZE` needs `DATABASE_URL`; PostgREST will not return a plan. No index has been validated against real cardinality |
| **No volume data** | Every index decision is from reasoning about access patterns, not from a slow query log |
| **No Core Web Vitals** | Nothing collects field data |
| **No CSV import benchmark** | `/imports` is untested at volume |
{% endhint %}

The first of these to fix is query plans — it needs one environment variable,
and everything else in this list is easier once it exists.

## Related

* [Observability](observability.md)
* [Testing](../developer/testing.md)
* [Technical debt](../status/technical-debt.md)
