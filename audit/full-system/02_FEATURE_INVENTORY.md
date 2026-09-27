# Feature inventory

Status key: ✅ Complete · 🟡 Partial · 🔴 Broken · ⚪ Missing · 🗑 Legacy · ❓ Unverified

"Connected end-to-end" means a user action or a clock can reach it in a deployed instance. A handler with no caller is **not** connected, however well it is written.

---

## Identity, tenancy, access

| Capability | Exists | Functional | Connected E2E | Prod ready | Issues | Recommendation |
|---|---|---|---|---|---|---|
| Magic-link + Google auth | ✅ | ✅ | ✅ | ✅ | — | Keep |
| Org membership guard | ✅ | ✅ | ✅ | ✅ | 404-not-403 by design | Keep |
| RLS tenant isolation | ✅ | ✅ | ✅ | ✅ | Proven by non-superuser test, `verify-migrations.ts` | Keep |
| Roles (owner/admin/member/viewer) | ✅ | ✅ | ✅ | ✅ | `has_org_role()` | Keep |
| Invitations | ✅ | ✅ | ✅ | ✅ | `inviteMemberAction`, seat quota enforced | Keep |
| Join requests (same-domain) | ✅ | ✅ | ✅ | ✅ | `0027`, `lib/data/directory.ts` | Keep |
| Org switching | ✅ | ✅ | ✅ | ✅ | `/orgs` | Keep |
| Audit log | ✅ | ✅ | 🟡 | 🟡 | `lib/data/audit.ts` writes; **no UI reads it** | Build a read surface or accept as forensic-only |
| SSO / SCIM | ⚪ | — | — | — | Not started | Defer — no enterprise demand yet |

## Onboarding

| Capability | Exists | Functional | Connected E2E | Prod ready | Issues | Recommendation |
|---|---|---|---|---|---|---|
| Company step (URL → research) | ✅ | ✅ | ✅ | 🟡 | Live model call never verified | Verify in Phase 1 |
| Goals step | ✅ | ✅ | ✅ | ✅ | Persists via `saveGoals` (`welcome/actions.ts:243`) | Keep |
| ICP step + look-alike preview | ✅ | ✅ | ✅ | 🟡 | Strongest screen in the product | Keep |
| Sources step | ✅ | ✅ | ✅ | ✅ | Gate correctly no longer requires a source | Keep |
| Building step (first-run) | ✅ | ✅ | ✅ | 🟡 | `first-run.ts` drives handlers in-request | Keep; see discovery |
| Review / finish | ✅ | ✅ | ✅ | ✅ | `finishOnboarding` | Keep |
| Onboarding resume | ✅ | ✅ | ✅ | ✅ | `0024`, step stored on org | Keep |

## Discovery & prospecting

| Capability | Exists | Functional | Connected E2E | Prod ready | Issues | Recommendation |
|---|---|---|---|---|---|---|
| Company search (Apollo) | ✅ | ✅ | 🟡 | 🔴 | Works only via onboarding or an unconfigured cron | **Fix: add manual trigger + cron** |
| Discovery runs / resumability | ✅ | ✅ | 🟡 | 🟡 | `discovery_runs`, cursor, page cap — good design | Keep |
| Saved / recurring searches | ✅ | ✅ | 🟡 | 🟡 | `discovery_queries` + `claim_due_discovery_queries`; never claimed without cron | Fix with cron |
| ICP → filter translation | ✅ | ✅ | ✅ | ✅ | `packages/db/src/discovery.ts`, unmappable criteria reported | Keep |
| Look-alike expansion | ✅ | ✅ | ✅ | ✅ | `packages/jobs/src/look-alike.ts` | Keep |
| Reach estimate | ✅ | ✅ | ✅ | 🟡 | Provider total only, never inferred | Keep |
| Source scanning (RSS/feeds) | ✅ | ✅ | 🟡 | 🟡 | `scan_source` + `schedule_scans`; cron-gated | Fix with cron |
| CSV import | ✅ | ✅ | ✅ | 🟡 | `/imports` | Verify at volume |
| **Manual "hunt now" control** | ⚪ | — | — | — | No app route enqueues discovery | **Build** |

## Entity resolution & data quality

| Capability | Exists | Functional | Connected E2E | Prod ready | Issues | Recommendation |
|---|---|---|---|---|---|---|
| Domain canonicalisation | ✅ | ✅ | ✅ | ✅ | `identity.ts`, refuses `linkedin.com` | Keep |
| `company_domains` resolution | ✅ | ✅ | 🔴 | 🔴 | Populated only by `resolve_entity` — **never enqueued** | **Fix: enqueue after discovery** |
| Merge candidates | ✅ | ✅ | 🔴 | 🔴 | Written only by `resolve_entity` | Fix |
| Merge execution | ✅ | ✅ | 🔴 | 🔴 | `merge_companies_for_org()` called by nothing; no UI | **Build review UI** |
| `company_merges` audit | ✅ | ✅ | 🔴 | 🔴 | Never written in practice | Fix with above |
| Contact identity resolution | 🟡 | ❓ | 🔴 | 🔴 | `enrich_person` unenqueued | Fix |

## Enrichment

| Capability | Exists | Functional | Connected E2E | Prod ready | Issues | Recommendation |
|---|---|---|---|---|---|---|
| Company enrichment | ✅ | ✅ | 🟡 | 🟡 | `enrich_company`; writes sourced evidence, fills blanks only | Keep |
| Person enrichment | ✅ | ✅ | 🔴 | 🔴 | **`enrich_person` never enqueued** | **Fix** |
| Email discovery | ✅ | ✅ | 🔴 | 🔴 | Via `person.match`; unreachable with `enrich_person` | Fix |
| Email verification | ✅ | ✅ | 🟡 | 🟡 | ZeroBounce adapter; conservative mapping | Keep |
| Phone | ✅ | ✅ | 🔴 | 🔴 | Same path as email; stored `medium`/unverified | Fix |
| Provider waterfall | 🟡 | 🟡 | 🟡 | 🟡 | Registry picks **one** provider per capability; no fallback chain | **Improve** |
| Cache / TTL per capability | ✅ | ✅ | ✅ | ✅ | `providers/src/cache.ts` | Keep |
| Budget + breaker + ledger | ✅ | ✅ | ✅ | ✅ | Best-in-class for this stage | Keep |

## Signals

| Capability | Exists | Functional | Connected E2E | Prod ready | Issues | Recommendation |
|---|---|---|---|---|---|---|
| Hiring signals (Apollo job postings) | ✅ | ✅ | 🟡 | 🟡 | Added 2026-09-14; cron-gated | Verify live |
| Source-derived triggers | ✅ | ✅ | 🟡 | 🟡 | `scan_source` → `extract_signals` | Fix with cron |
| Funding signals | ✅ | ✅ | 🟡 | 🟡 | Via `company.enrich` funding fields | Keep |
| Job-change signals | ⚪ | — | — | — | No clean Apollo endpoint confirmed | Defer |
| Intent (Bombora-style) | ⚪ | — | — | — | Not modelled | Defer / integrate |
| Website visitor ID | ⚪ | — | — | — | Not modelled | Defer (GDPR review first) |
| **Signal → recommended action** | 🟡 | 🟡 | 🟡 | 🔴 | Evidence lands; nothing converts it to a next action | **Build** |

## Qualification & scoring

| Capability | Exists | Functional | Connected E2E | Prod ready | Issues | Recommendation |
|---|---|---|---|---|---|---|
| 8-dimension opportunity score | ✅ | ✅ | ✅ | 🟡 | Nullable dims, no invented weights | Keep — this is the moat |
| Deterministic rule layer | ✅ | ✅ | ✅ | ✅ | `packages/db/src/rules.ts`, `rule_trace` | Keep |
| Priority (HOT/WARM/WATCH/IGNORE) | ✅ | ✅ | ✅ | ✅ | With mandatory reason | Keep |
| Contact-fit score | ✅ | ✅ | ✅ | 🟡 | Now drives buyer ordering (2026-09-15) | Keep |
| Score recomputation | ✅ | ✅ | 🟡 | 🟡 | `recompute_scores` + `schedule_recomputes`; cron-gated | Fix with cron |
| **Composite "next best action"** | ⚪ | — | — | — | Three ranked signals, nothing composes them | **Build** |

## AI

| Capability | Exists | Functional | Connected E2E | Prod ready | Issues | Recommendation |
|---|---|---|---|---|---|---|
| 12 AI tasks | ✅ | ✅ | ✅ | 🔴 | All referenced; **none verified against a live model** | Verify Phase 1 |
| Structured-output validation | ✅ | ✅ | ✅ | ✅ | `claims.ts`, `ClaimValidationError` | Keep |
| Untrusted-content wrapping | ✅ | ✅ | ✅ | ✅ | `untrusted.ts` | Keep |
| Run ledger + cost | ✅ | ✅ | ✅ | ✅ | `ai_runs`, spend dashboard | Keep |
| Spend guard (org resolution) | ✅ | ✅ | ✅ | ✅ | `SEC-SPEND` gate | Keep |
| AI quota | ✅ | ✅ | ✅ | ✅ | Both request and engine paths | Keep |
| Per-opportunity agent | ✅ | ✅ | ✅ | 🟡 | `AgentPanel.tsx`, `sales-agent` task | Verify live |

## Outreach

| Capability | Exists | Functional | Connected E2E | Prod ready | Issues | Recommendation |
|---|---|---|---|---|---|---|
| Campaigns / sequences | ✅ | ✅ | ✅ | 🟡 | `OutreachManager.tsx` | Verify live |
| Enrollment advancement | ✅ | ✅ | 🟡 | 🟡 | `advance_enrollments` is a sweeper — cron-gated | Fix with cron |
| Sending (Gmail/Outlook) | ✅ | ✅ | 🟡 | 🟡 | Idempotent, approval-gated, allowance-claimed | Verify live |
| Autonomy ladder | ✅ | ✅ | ✅ | ✅ | Draft-and-stop at low autonomy | Keep — differentiator |
| Reply sync + classification | ✅ | ✅ | 🟡 | 🟡 | `sync_mailbox` — cron-gated | Fix with cron |
| Unsubscribe | ✅ | ✅ | ✅ | ✅ | Token route + suppression | Keep |
| Suppression / cadence caps | ✅ | ✅ | ✅ | ✅ | `0017`, `can_contact()` | Keep |
| Deliverability tooling | ⚪ | — | — | — | BYO mailbox only | Deliberately not building |
| **Email quota enforcement** | 🔴 | — | — | 🔴 | `emails` limit defined, never checked | **Fix** |

## CRM

| Capability | Exists | Functional | Connected E2E | Prod ready | Issues | Recommendation |
|---|---|---|---|---|---|---|
| Internal pipeline | ✅ | ✅ | ✅ | 🟡 | `/pipeline`, opportunity status | Keep |
| HubSpot connect / disconnect | ✅ | ✅ | ✅ | 🟡 | Admin-only, token encrypted | Verify live |
| HubSpot push (company/contact/deal) | ✅ | ✅ | 🔴 | 🔴 | **`sync_hubspot` has no trigger** | **Fix** |
| Stage read-back as evidence | ✅ | ✅ | 🔴 | 🔴 | Same | Fix |
| Inbound / two-way sync | ⚪ | — | — | — | Deliberate: stage recorded, not obeyed | Decide after usage |
| Salesforce / Pipedrive | ⚪ | — | — | — | Single-vendor by design | Defer |

## Learning & analytics

| Capability | Exists | Functional | Connected E2E | Prod ready | Issues | Recommendation |
|---|---|---|---|---|---|---|
| Outcome capture | ✅ | ✅ | 🟡 | 🟡 | Reply classification → outcome | Fix with cron |
| Learning runs | ✅ | ✅ | 🟡 | 🟡 | `schedule_learning`, `analyze_performance` | Fix with cron |
| "What we've learned" screen | ✅ | ✅ | ✅ | 🟡 | Real loader; no data yet | Keep |
| Org / rep memory | ✅ | ✅ | ✅ | 🟡 | `/memory`, `0004` | Keep |
| AI spend analytics | ✅ | ✅ | ✅ | ✅ | `/analytics` over `ai_runs` | Keep |
| Score override / correction capture | ⚪ | — | — | — | No user-correction signal captured | **Build** |
| Engine health (`/ops`) | ✅ | ✅ | ✅ | ✅ | Job + provider health | Keep |

## Commercial

| Capability | Exists | Functional | Connected E2E | Prod ready | Issues | Recommendation |
|---|---|---|---|---|---|---|
| Plan catalogue | ✅ | ✅ | ✅ | ✅ | Read from `plans`, not hard-coded | Keep |
| Usage display | ✅ | ✅ | ✅ | ✅ | `lib/data/usage.ts` | Keep |
| `seats` enforcement | ✅ | ✅ | ✅ | ✅ | `team/actions.ts:294` | Keep |
| `ai_runs` enforcement | ✅ | ✅ | ✅ | ✅ | Both paths | Keep |
| `opportunities` enforcement | 🔴 | — | — | 🔴 | Defined, displayed, unenforced | **Fix** |
| `emails` enforcement | 🔴 | — | — | 🔴 | Same | **Fix** |
| `enrich` enforcement | 🔴 | — | — | 🔴 | Same | **Fix** |
| Payment / Stripe | ⚪ | — | — | — | 3 env vars, 0 code; `subscriptions` unused since `0001` | **Build or remove the env vars** |

## Orphans

| Object | Origin | Status |
|---|---|---|
| `company_gaps` | `0003` | 🗑 never read or written |
| `contact_frequency` | `0017` | 🗑 never read or written |
| `evidence_citations` | `0022` | 🗑 never read or written |
| `company_merges` | `0012` | 🗑 in practice (writer unreachable) |
| `subscriptions` | `0001` | 🗑 no billing exists |
| `STRIPE_*` env vars | `.env.example` | 🗑 read by nothing |
