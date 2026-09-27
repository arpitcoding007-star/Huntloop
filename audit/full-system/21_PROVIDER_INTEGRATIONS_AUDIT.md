# Provider & integration architecture audit

## The seam

`packages/providers` defines six capabilities — `company.search`, `company.enrich`, `person.search`, `person.match`, `email.verify`, `company.signals` — and binds each to exactly one adapter at registry build time, chosen by which API keys are present.

**Nothing outside `src/adapters/` may name a vendor** in an import path or a type. That rule was described in a code comment for months and enforced by nothing; it is now a build-failing audit check (`PRV-CHK`), scoped precisely to imports and type names because vendor names legitimately appear as *data* (`providerRecordUrl`'s `case "apollo"`, the ambiguous-company-name list in `resolve-competitor-mentions.ts`, migration fixtures).

Around every call sits the eight-step path in `call.ts` — configured → credentials → breaker → cache → budget → call+retry → ledger → cache-write. Five steps exist to avoid spending money, and each failure mode is a distinct, named outcome (`ok` / `cache_hit` / `partial` / `empty` / `rate_limited` / `failed` / `refused`).

The distinction between `refused`, `empty` and `failed` is the single most valuable thing in this package: it is what stops "we did not search" from ever being rendered as "your market is empty".

## Per-provider status

| Provider | Capabilities | Auth | Live-verified | Notes |
|---|---|---|---|---|
| **Apollo** | search, enrich, person search/match, signals | `x-api-key` header (never in body — a body credential lands in anything that logs payloads) | 🔴 never | Primary provider. Bands/keywords translated honestly; unmappable filters reported |
| **Hunter** | `person.match` | key | 🔴 never | Wins `person.match` over Apollo as the cheaper specialist |
| **ZeroBounce** | `email.verify` | key | 🔴 never | Conservative status mapping |
| **HubSpot** | CRM push/read | private-app bearer, encrypted at rest | 🔴 never | Single-vendor package by design |
| **Gmail / Outlook** | mailbox send + sync | OAuth, tokens encrypted | 🔴 never | Thread matching by provider id → `In-Reply-To` → sender |
| **Anthropic** | 12 AI tasks | key | 🔴 never | Run ledger, cost estimate, claim validation |
| **Supabase** | database, auth, storage | keys | ✅ | RLS-backed |
| **Sentry / PostHog** | observability | DSN / key | ❓ | No-op when unset |
| **Stripe** | — | — | — | **Declared in env, implemented nowhere** |

## Findings

| # | Severity | Finding |
|---|---|---|
| P-1 | **Critical** | **No integration has ever been exercised against a live account.** Every adapter is written against documentation |
| P-2 | High | **No fallback chain.** One adapter per capability; if it returns empty or fails, the capability yields nothing and the second provider is never tried. This is the core architectural difference from Clay, and it directly determines contact coverage |
| P-3 | High | HubSpot has no budget/breaker/ledger equivalent — `packages/crm` reimplements retry/status handling locally rather than reusing the provider call path |
| P-4 | Medium | Provider credit estimates are self-described as "the shape of the billing rather than a price list" and unreconciled |
| P-5 | Medium | No provider-health alerting; `/ops` shows state but nothing notifies |
| P-6 | Medium | Apollo's 50,000-record enumeration ceiling is handled internally (`partial`) but never surfaced to the user |
| P-7 | Low | Stripe env vars reduce the signal value of `.env.example` |

## Should the provider path absorb HubSpot?

**Partly.** The two are genuinely different shapes — `packages/providers` is *read from interchangeable vendors*, `packages/crm` is *write to the customer's own account* — and collapsing them would force a bad abstraction.

But three pieces of the provider path are vendor-agnostic and worth sharing: the **ledger** (what was called, what it cost, what happened), the **breaker** (stop hammering a failing vendor), and **rate-limit-aware retry**. HubSpot enforces per-portal rate limits and currently meets them with a local `429` check and nothing else. Extracting those three into a shared `packages/providers/src/call.ts`-style primitive that both packages use — without merging the *contracts* — is the right middle.

## Cost architecture

Already strong, and better than the product's stage warrants:

- Per-org **budget** checked before every paid call (`provider_budget_state`).
- Org-scoped **cache** with canonicalised request hashing, so reordering filter chips never triggers a second paid call. Deliberately not shared across tenants, at a documented cost in hit rate, because a shared cache is a cross-tenant read with a performance justification.
- **Ledger** on every call including cache hits and refusals (zero-credit rows), so hit rate is measurable.
- **Breaker** per provider per org.
- AI spend separately metered in `ai_runs` with a monthly quota enforced on both the request and engine paths.

**The gaps are the plan-level quotas** (`enrich`, `emails`, `opportunities` unenforced) and the absence of a **global kill switch** — there is no single control that stops all paid activity for an org or for the deployment.
