# Enrichment audit

## Provider seam

`packages/providers` is a genuinely good abstraction. Five capabilities (now six), one adapter per capability chosen at registry build time, and an eight-step call path in `call.ts` whose **order is the design**:

```
1 provider configured?   no  → refused, costs nothing
2 credentials known bad? yes → refused, costs nothing
3 breaker open?          yes → refused, costs nothing
4 cached answer?         yes → cache_hit, costs nothing
5 budget left?           no  → refused, costs nothing
6 call, with retries
7 record the ledger row, always
8 cache, if cacheable
```

Five of the eight exist to **not** spend money. Cache-before-budget (4 before 5) looks wrong and is right: a cached answer already cost nothing, so refusing it for lack of budget denies a customer data they already paid for.

Per-capability TTLs are chosen against half-life, not uniformity: `company.enrich` 30d, `person.match` 30d, `person.search` 7d, `company.search` 24h, `email.verify` 90d, `company.signals` 48h.

A cache hit still writes a ledger row — "an unmeasured cache is indistinguishable from a broken one".

## 🔴 Person enrichment is unreachable

`enrich_person` is registered in `HANDLERS` and enqueued by nothing. Consequences:

- Emails and phone numbers are acquired **only** during `first-run.ts`.
- A company discovered later never gets contacts.
- The `enrich` plan quota meters an operation that cannot be invoked on demand.

This is the enrichment equivalent of the discovery finding, and it has the same one-line fix (enqueue after `rank_contacts`).

## Confidence discipline (excellent)

The most important mapping decision in the package, from `adapters/apollo.ts`:

> Apollo returns addresses with a status, and one of the values is a construction from a pattern rather than an observation. Mapping that to anything above `low`, or to `verified: true`, would launder a guess into a finding — and the bounce lands on the customer's sending domain, not ours.

Only `email_status === "verified"` survives as high confidence; nine simulated statuses are unit-tested to prove it. Hunter's score is confidence in a *derivation*, so it is high-confidence but never `verified`. ZeroBounce rounds every ambiguous status **down** (`catch-all` → risky, `spamtrap` → undeliverable, unknown status → unknown).

Phone numbers pass through at `medium`, never verified, because Apollo asserts no verification on them.

`enrich_company` writes each provider assertion as an **evidence row with a checkable URL** (`app.apollo.io/#/organizations/{id}`), degrading the claim to `inference` when no URL can be constructed — "a fabricated citation is worse than no citation: it is a link that looks checkable and is not". It fills blanks only and never overwrites a human-entered value, and flags contradictions between sources.

## 🟡 No waterfall

`registry.ts` binds **one** adapter per capability. Hunter takes `person.match` from Apollo when both keys exist. There is no fallback chain: if the bound provider returns empty or fails, the capability returns empty or throws — the second provider is never tried.

This is the single biggest functional difference from Clay, whose entire value proposition is the waterfall, and the third-party estimates put single-source coverage at 40–60% versus 80–95% for a chain. For a product whose contact data quality determines whether its emails bounce, this matters.

## Findings

| # | Severity | Finding |
|---|---|---|
| E-1 | **Critical** | `enrich_person` unreachable — no contact enrichment after onboarding |
| E-2 | High | No provider fallback chain; a single provider's blind spot is the product's blind spot |
| E-3 | High | `enrich` quota defined and never enforced |
| E-4 | Medium | Re-enrichment is staleness-driven (`STALE_AFTER_DAYS = 30`) but only runs if something enqueues it — nothing does on a schedule for companies |
| E-5 | Medium | No enrichment UI: a user cannot ask to enrich a specific company or contact |
| E-6 | Low | Credit estimates in `apollo.ts` are self-described as "the shape of the billing rather than a price list" and unreconciled against a real invoice |

## Recommendation

Implement a **fallback chain per capability** rather than a single binding: `adaptersFor(capability): ProviderAdapter[]`, tried in order, each attempt ledgered separately so cost stays attributable. The cache/budget/breaker path already wraps individual calls, so this is a registry change plus a loop — not a redesign.
