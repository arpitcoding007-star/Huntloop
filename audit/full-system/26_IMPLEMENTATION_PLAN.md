# Implementation plan

Ordered by dependency and product impact. Each phase states what it solves, what it touches, and how you know it is finished.

Work is labelled **Fix** (exists, broken) · **Improve** (exists, wrong shape) · **Build** (does not exist).

---

## Phase 0 — Turn the engine on (1–2 days)

**Objective:** make the system that already exists actually run.

**Problem:** six subsystems are complete, tested and dormant because nothing calls them.

| # | Work | Type | Files |
|---|---|---|---|
| 0.1 | Deploy `apps/web/vercel.json`; set `CRON_SECRET` | Fix | done, needs deploying |
| 0.2 | Enqueue `resolve_entity` at the end of `discover_companies` | Fix | `handlers/discover-companies.ts` |
| 0.3 | Enqueue `enrich_person` after `rank_contacts` for the top N contacts | Fix | `handlers/rank-contacts.ts` |
| 0.4 | Add "Hunt now" action → enqueue `discover_companies` | Build | `app/(app)/[org]/opportunities/actions.ts`, sources screen |
| 0.5 | Add "Push to HubSpot" action → enqueue `sync_hubspot` | Build | `opportunities/[id]/OpportunityActions.tsx` + actions |
| 0.6 | Add an erasure control → enqueue `purge_contact_data` | Build | settings or team screen, admin-only |

**DB changes:** none. **Risk:** 0.2/0.3 increase provider spend per run — both are already inside the budget/breaker path, and `MAX_PER_TICK` bounds the sweepers.

**Acceptance:** a workspace created today still has discovery runs, enrichment and signal fetches happening tomorrow, with no human intervention, visible in `/ops`.

---

## Phase 1 — Prove it against reality (gated on credentials)

**Objective:** first live end-to-end run.

| # | Work | Type |
|---|---|---|
| 1.1 | Configure `ANTHROPIC_API_KEY`, `APOLLO_API_KEY`, HubSpot private-app token, `MAILBOX_ENCRYPTION_KEY`, Gmail/Outlook OAuth | — |
| 1.2 | One company: URL → ICP → discovery → enrich → signals → score → contacts → research → draft → HubSpot deal | Fix (whatever breaks) |
| 1.3 | Reconcile Apollo job-postings + all HubSpot v3/v4 shapes against real payloads | Fix |
| 1.4 | Reconcile Apollo credit estimates in `adapters/apollo.ts` against one real invoice | Improve |

**Acceptance:** one real opportunity with a cited hiring signal, a real score, and a deal in a real HubSpot portal — reached by clicking, not by running a script.

---

## Phase 2 — Close the compliance and commercial gaps (3–5 days)

| # | Work | Type | Notes |
|---|---|---|---|
| 2.1 | Enforce `emails` quota in `send_message` | Fix | single choke point already exists |
| 2.2 | Enforce `enrich` quota in the provider call path | Fix | beside the existing budget check |
| 2.3 | Enforce `opportunities` quota in `score_opportunity` | Fix | refuse creation, not scoring |
| 2.4 | Data export (GDPR portability) | Build | pairs with 0.6 |
| 2.5 | Read surface for `audit_logs` | Build | admin-only screen |
| 2.6 | Drop `company_gaps`, `contact_frequency`, `evidence_citations` | Fix | migration `0029` |
| 2.7 | Decide Stripe: implement, or delete the env vars and `subscriptions` | Build/Fix | do not leave it ambiguous |

**Acceptance:** every limit shown to a user is enforced; an erasure request can be served end to end; the schema contains no table nothing reads.

---

## Phase 3 — Make the loop legible (1–2 weeks)

**Objective:** answer "who next, why, what do I do" in one place.

| # | Work | Type |
|---|---|---|
| 3.1 | **Next-best-action engine**: compose `priority` + `opportunity_scores` + `contact_fit_scores` + recency + signal freshness into one ranked queue with a reason | Build |
| 3.2 | Signal → action: a hiring signal produces a recommended action on the opportunity, not just an evidence row | Build |
| 3.3 | Merge-review UI over `merge_candidates`, calling `merge_companies_for_org()` | Build |
| 3.4 | Capture user corrections: score override, dismissed recommendation, "not a fit" with reason | Build |

**DB:** one table for recommendations (or a view), one for overrides. **Risk:** 3.1 is the place a competing ranking system could appear — it must *read* the three existing scores, never recompute them.

**Acceptance:** the Command Center opens on a ranked list of accounts with a one-line reason and a single primary action each.

---

## Phase 4 — Resilience and scale (1–2 weeks)

| # | Work | Type |
|---|---|---|
| 4.1 | Provider fallback chain per capability (Apollo → Hunter → …) rather than one adapter | Improve |
| 4.2 | Dead-letter surface in `/ops` with a safe retry control | Build |
| 4.3 | Narrow `schedule_signal_fetches` to companies with live opportunities | Improve |
| 4.4 | Load test `tick()` concurrency at realistic volume | Build |
| 4.5 | Enforce CSP (`CSP_ENFORCE=true`) | Fix |

---

## Phase 5 — Learn (gated on volume, not code)

| # | Work | Type |
|---|---|---|
| 5.1 | Outcome attribution report: which triggers converted, which messages got replies | Build |
| 5.2 | Feed outcomes into ICP suggestions and scoring-rule proposals — **proposed to a human, never auto-applied** | Build |
| 5.3 | Close the loop: accepted/rejected proposals become training signal | Build |

---

## Explicitly not building

Dialer · LinkedIn automation · generic workflow canvas · in-house deliverability · becoming a full CRM · a second AI agent framework. Rationale in `24_COMPETITIVE_CAPABILITY_GAPS.md`.
