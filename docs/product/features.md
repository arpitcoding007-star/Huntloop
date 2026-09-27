---
description: >-
  Every capability, with whether it exists, whether anything can reach it, and
  what to do about it. Derived from the code on 2026-09-16.
---

# Feature reference

> **Layer:** Product / Internal · **Audience:** product, engineering, leadership

## How to read the status column

| Symbol | Meaning |
|---|---|
| ✅ | Complete, and a user or a clock can reach it in a deployed instance |
| 🟡 | Built, but reaching it depends on something not yet configured (a key, a cron) |
| 🔴 | Built and **unreachable** — no caller, no trigger, no UI |
| ⚪ | Not started |
| 🗑 | Exists in the schema and is read and written by nothing |

{% hint style="info" %}
**"Connected" means a user action or a clock can reach it.** A handler with no
caller is not connected, however well it is written. This distinction is the
single most useful thing in this table.
{% endhint %}

***

## Identity, tenancy, access

| Capability | Status | Evidence |
|---|---|---|
| Magic-link auth | ✅ | `app/(auth)/`, `sendMagicLink` |
| Google OAuth | ✅ | `signInWithGoogle` (currently hidden in the UI — see note) |
| Org membership guard | ✅ | `app/(app)/[org]/layout.tsx` — 404, not 403, by design |
| RLS tenant isolation | ✅ | Proven by a non-superuser cross-tenant test in `verify-migrations.ts` |
| Roles: owner / admin / member / viewer | ✅ | `has_org_role()`; `lib/data/membership.ts` decides rendering |
| Invitations with seat quota | ✅ | `inviteMemberAction`, `accept_invitation()` |
| Same-domain join requests | ✅ | `0027`, `request_to_join()`, `approve_join_request()` |
| Org switching | ✅ | `/orgs` |
| Audit log | 🟡 | `lib/data/audit.ts` writes; **nothing reads it** |
| SSO / SCIM | ⚪ | Deferred |

{% hint style="info" %}
Google sign-in is present and working but hidden in the UI by commit
`de3e50d` ("hide Google auth for testing"). Re-enabling it is a UI change, not
a build.
{% endhint %}

## Onboarding

| Capability | Status | Notes |
|---|---|---|
| `you` step | ✅ | Name and role, stored on `profiles` |
| `company` step — URL to research | 🟡 | Needs `ANTHROPIC_API_KEY`; never verified against the live API |
| Join an existing workspace | ✅ | Same email domain, `0027` |
| `goals` step | ✅ | Max two goals; `saveGoals` |
| `icp` step + look-alike preview + reach estimate | 🟡 | Strongest screen in the product; reach needs a provider key |
| `sources` step | ✅ | Gate correctly does not require a source |
| `building` step (first run) | 🟡 | Five stages, each degrading independently |
| `review` / finish | ✅ | `finishOnboarding` |
| Resume across devices | ✅ | Step stored on `organizations` (`0024`) |

## Discovery and prospecting

| Capability | Status | Notes |
|---|---|---|
| Company search | 🟡 | Works only via onboarding or an unconfigured cron |
| Discovery runs, resumability, page cap | ✅ | `discovery_runs`, `page_cursor` |
| Saved / recurring searches | 🟡 | `discovery_queries` + `claim_due_discovery_queries`; never claimed without a cron |
| ICP to provider-filter translation | ✅ | Unmappable criteria are reported, not dropped |
| Look-alike expansion | ✅ | `packages/jobs/src/look-alike.ts` |
| Reach estimate | 🟡 | Provider total only — never inferred |
| Source scanning (feeds, pages) | 🟡 | `scan_source` + `schedule_scans`; cron-gated |
| Scan one source now | ✅ | `scanSourceNowAction` |
| CSV import | ✅ | `/imports`, `importCsvAction` |
| **Manual "hunt now" control** | ⚪ | **No app route enqueues discovery. Highest-value missing control.** |

## Entity resolution and data quality

| Capability | Status | Notes |
|---|---|---|
| Domain canonicalisation | ✅ | `packages/db/src/identity.ts`; refuses `linkedin.com` and similar |
| `company_domains` resolution | 🔴 | Populated only by `resolve_entity`, which is never enqueued |
| Merge candidates | 🔴 | Same |
| Merge execution | 🔴 | `merge_companies_for_org()` is called by nothing; no review UI |
| `company_merges` audit trail | 🔴 | Never written in practice |
| Contact identity resolution | 🔴 | Via `enrich_person`, never enqueued |

{% hint style="danger" %}
Migration `0012` argues in its own header that deduplication "ships BEFORE any
provider search does, and the plan makes that a hard ordering constraint".
`discover_companies` runs; `resolve_entity` does not. **That constraint is
currently inverted in production behaviour.**
{% endhint %}

## Enrichment

| Capability | Status | Notes |
|---|---|---|
| Company enrichment | 🟡 | `enrich_company`; writes sourced evidence, fills blanks only |
| Person enrichment | 🔴 | `enrich_person` never enqueued |
| Email discovery | 🔴 | Via `person.match`; unreachable with `enrich_person` |
| Email verification | 🟡 | ZeroBounce adapter, conservative status mapping |
| Phone | 🔴 | Same path as email |
| Provider waterfall / fallback chain | 🟡 | The registry picks **one** provider per capability; there is no fallback |
| Per-capability cache with TTL | ✅ | `packages/providers/src/cache.ts` |
| Budget + circuit breaker + ledger | ✅ | `0011`; `provider_calls` is append-only |

## Signals

| Capability | Status |
|---|---|
| Hiring signals | 🟡 cron-gated |
| Source-derived triggers | 🟡 cron-gated |
| Funding signals | 🟡 |
| Competitor mention resolution | 🟡 |
| Job-change signals | ⚪ |
| Intent data | ⚪ |
| Website visitor identification | ⚪ (GDPR review first) |
| **Signal to recommended action** | 🔴 Evidence lands; nothing converts it into a next action |

## Qualification and scoring

| Capability | Status | Notes |
|---|---|---|
| Eight-dimension opportunity score | ✅ | Nullable dimensions, no invented weights — **this is the moat** |
| Deterministic rule layer | ✅ | `packages/db/src/rules.ts`, `rule_trace` |
| Priority with mandatory reason | ✅ | HOT / WARM / WATCH / IGNORE |
| Human priority override | ✅ | `overridePriorityAction`, `record_override` |
| Contact-fit score | ✅ | Drives buyer ordering on the opportunity page |
| Score recomputation | 🟡 | `recompute_scores` + `schedule_recomputes`; cron-gated |
| Rule authoring, preview, dry-run | ✅ | `/settings/scoring`, `previewRuleAction` |
| **Composite "next best action"** | ⚪ | Three ranked signals, nothing composes them |

## AI

| Capability | Status | Notes |
|---|---|---|
| 12 AI tasks | 🟡 | All referenced and tested against a scripted client; **none verified against the live API** |
| Structured-output validation | ✅ | `claims.ts`, `ClaimValidationError` |
| Untrusted-content wrapping | ✅ | `untrusted.ts` |
| Run ledger with cost and latency | ✅ | `ai_runs`, `/analytics` |
| Spend guard (org resolution) | ✅ | `SEC-SPEND` audit check |
| Rate limit on model paths | ✅ | `SEC-RATELIMIT` |
| Monthly AI quota, both paths | ✅ | `SEC-QUOTA` |
| Per-opportunity agent | 🟡 | `AgentPanel.tsx`, `sales_agent` task |

## Outreach

| Capability | Status | Notes |
|---|---|---|
| Campaigns and sequences | ✅ | `/outreach` |
| Enrollment advancement | 🟡 | `advance_enrollments` is a sweeper — cron-gated |
| Sending via Gmail / Outlook | 🟡 | Idempotent, approval-gated, allowance-claimed |
| Autonomy ladder | ✅ | Draft-and-stop at low autonomy — a differentiator |
| Reply sync and classification | 🟡 | `sync_mailbox` — cron-gated |
| Inbox: status, assign, reply, approve | ✅ | `/inbox` |
| Unsubscribe | ✅ | Public token route plus suppression |
| Suppression and cadence caps | ✅ | `0017`, `can_contact()` |
| Deliverability tooling | ⚪ | Bring-your-own mailbox; deliberately not building |
| **Email quota enforcement** | 🔴 | `emails` limit defined and incremented, never checked |

## CRM

| Capability | Status | Notes |
|---|---|---|
| Internal pipeline | ✅ | `/pipeline`, opportunity status |
| HubSpot connect / disconnect | ✅ | Admin-only, token encrypted at the application layer |
| HubSpot push (company, contact, deal) | 🔴 | **`sync_hubspot` has no trigger** |
| Deal-stage read-back as evidence | 🔴 | Same |
| Two-way sync | ⚪ | Deliberate: stage is recorded, not obeyed |
| Salesforce / Pipedrive | ⚪ | Single-vendor by design |

## Learning and analytics

| Capability | Status | Notes |
|---|---|---|
| Outcome capture | 🟡 | Reply classification to outcome; cron-gated |
| Learning runs | 🟡 | `schedule_learning`, `analyze_performance` |
| Findings review, one at a time | ✅ | `/learn` |
| Org and rep memory | ✅ | `/memory`, `0004` |
| AI spend analytics | ✅ | `/analytics` over `ai_runs` |
| Engine health | ✅ | `/ops` — job and provider health, retry and cancel |
| Intelligence / evidence browser | ✅ | `/intelligence` |
| Score-correction capture | ✅ | `human_overrides` (`0016`) |
| Product analytics (PostHog) | 🟡 | Server-side only; five events, onboarding funnel |

## Commercial

| Capability | Status | Notes |
|---|---|---|
| Plan catalogue read from the database | ✅ | `lib/data/plans.ts` — the pricing page reads the rows enforcement reads |
| Usage display | ✅ | `lib/data/usage.ts` |
| `seats` enforcement | ✅ | `team/actions.ts` |
| `ai_runs` enforcement | ✅ | Request path and engine path |
| `enrich` enforcement | 🔴 | Checked, but only inside the unreachable `enrich_person` |
| `emails` enforcement | 🔴 | Counted, never checked |
| `opportunities` enforcement | 🔴 | Neither counted nor checked in application code |
| Payment / Stripe | ⚪ | Three env vars, **zero lines of code**; `subscriptions` unused since `0001` |

## Orphaned schema objects

| Object | Origin | Status |
|---|---|---|
| `company_gaps` | `0003` | 🗑 never read or written |
| `contact_frequency` | `0017` | 🗑 never read or written by application code |
| `evidence_citations` | `0022` | 🗑 never read or written |
| `company_merges` | `0012` | 🗑 in practice — its only writer is unreachable |
| `subscriptions` | `0001` | 🗑 no billing exists |
| `STRIPE_*` env vars | `.env.example` | 🗑 read by nothing |

***

## The four unreachable jobs

Cross-referencing every name in `packages/jobs/src/queue.ts` against every
`enqueue()` call site in the repository:

| Job | Enqueued by | Consequence |
|---|---|---|
| `enrich_person` | nothing | Contact enrichment is unreachable; emails and phones are only acquired during first run |
| `resolve_entity` | nothing | Entity resolution and deduplication never run |
| `purge_contact_data` | nothing | GDPR erasure cannot be triggered |
| `sync_hubspot` | nothing | CRM sync has no trigger |

Verify this yourself at any time:

```bash
grep -rn "enqueue(" packages apps --include=*.ts --include=*.tsx
```

***

## Related

* [Implementation status](../status/implementation-status.md) — the same picture, summarised
* [Technical debt](../status/technical-debt.md)
* [Roadmap](../status/roadmap.md)
