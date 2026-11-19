# Pass 16 — summary

Audited `7e09759` (`feat/pass-15-audit-fixes`) on 2026-11-14 with `/audit-system full`. Read-only. Five reviewers wrote to `_raw/reviewer-A…E.md`. The lead re-traced every Critical and High (`_raw/disprove.md`) and ran the runtime checks (`_raw/runtime.md`).

**Counts (match `03_FINDINGS.md`): Critical 1 · High 9 · Medium 38 · Low 26 · total 74.**

**One line:** the pass-15 fixes are in the repo but not live. Production still serves `8021d3f`, and the configured database lacks 0048–0050. Two of those fixes break something the moment they land. Separately, stopping a sequence does not stop its queued mail.

---

## TOP 10 TO FIX FIRST

| # | Problem | Evidence | Impact | Depends on | Action |
|---|---|---|---|---|---|
| 1 | **OUT-201** Stop/pause/archive/won/lost/org delete does not stop an approved or deferred email | `send-message.ts:58-60` reads only message columns; reviewer D ran it against a fake DB → sent | Email after the operator withdrew it (P0 class) | — | HL-1601: eligibility guard at send time + clear `scheduled_at` on parent change |
| 2 | **DB-203** Applying 0049 breaks every mailbox connect | PGlite repro (A, B): upsert needs SELECT on the revoked token columns | No mailbox can connect, so nothing sends | must land **before** 0049 | HL-1602: update-then-insert or DEFINER RPC |
| 3 | **PROD-201** Health probe stops at 0047; HEAD on a 0047 DB defers every send silently | `lib/schema.ts:38`; `send-message.ts:415-422`; live health says "complete" | Outreach dies while the deploy looks healthy | must land **before** deploy | HL-1603: probe the ledger; fail loudly on missing rpc |
| 4 | **DB-201** Any member can delete suppressions and forge approvals via PostgREST | `0004:340-355` `FOR ALL member`; PGlite repro (B) | Send after unsubscribe; false audit trail | real grants read | HL-1604: migration 0051 |
| 5 | **PROD-001** Apex fails TLS; prod is pre-pass-15 with no keys | `_raw/prod-get.log` | Dead unsubscribe link in every email; dead sign-in | Vercel/DNS access | M4 + HL-1607 |
| 6 | **OUT-202** Transient refusals strand messages for good; the UI says "stays queued" | `schedule-sends.ts:56` `.is("error", null)` | Approved outreach never leaves | 0048 | HL-1608 |
| 7 | **MONEY-201** Default Free plan sends 0 emails; nothing in the app changes the plan | `0007:370-377`; no `plan_id` writer | Reach Out unusable for every self-serve org | product decision | HL-1610 |
| 8 | **ENG-201** First-run reports work that did not happen | `first-run.ts:359` vs `discover-companies.ts:314-326` | Onboarding states false facts | — | HL-1609 |
| 9 | **CRM-201** HubSpot retry creates duplicate deals | `sync-hubspot.ts:153-172,259-265` | Customer CRM polluted | — | HL-1611 |
| 10 | **PROV-201** Atomic credit reserve not live; the fallback fails open and reserves 1 regardless of cost | `budget.ts:93-99`; doctor | Cap overshoot | 0050 applied | HL-1605 |

Kill switch (PROD-207) is the next item after these ten.

---

## Executive answers

1. **How does HuntLoop actually work internally?** It is a Next.js 16 app on Vercel. 138 server actions and 13 route handlers talk to Supabase Postgres under RLS. A GitHub Actions cron calls `/api/jobs/tick` every 5 minutes, and that tick drives a Postgres job queue (claim with `skip locked`, 4 lanes). Jobs run discovery → research → score → rank → enrich → draft → send → sync → learn through three seams: `packages/providers` (Apollo, Hunter, ZeroBounce), `packages/ai` (Claude 5.5 models) and `packages/crm` (HubSpot). See [01_SYSTEM_MAP.md](01_SYSTEM_MAP.md).
2. **Is the architecture right?** Yes for this stage. The tenant boundary is in the database, `OrgScope` covers service-role writes, and every vendor call goes through one seam with cache, breaker and ledger. The two structural weaknesses: send eligibility is a property of the message row alone (OUT-201), and deploy is not coupled to migrate (PROD-201, PROD-202). See [11_DEBT.md](11_DEBT.md) § Do not change.
3. **Which critical flows work, which are broken?** Tenant isolation, invite/accept, suppression at send, at-most-once send and SSRF are verified in PGlite or fakes. Reach Out is broken or blocked by six findings (OUT-201, OUT-202, PROD-201, DB-203, MONEY-201, PROD-001). Onboarding misreports (ENG-201). Discover, qualify, enrich and learn are implemented but have never run against a real vendor. See [04_FEATURES.md](04_FEATURES.md), [02_FLOWS.md](02_FLOWS.md).
4. **Does the backend implement the intended business logic?** Mostly. The gaps are in withdrawal and retry semantics: stop does not stop (OUT-201), "stays queued" does not requeue (OUT-202). There are also documented rules enforced nowhere: `max_contacts_per_company` (OUT-204), seats (AUTHZ-202), last owner (AUTHZ-201).
5. **Is the database sound?** Across tenants, yes: RLS is on for all 82 tables, views run as invoker, every DEFINER function has `search_path`, and cross-tenant FKs are blocked by trigger (reviewer B §11). Within a tenant, no: generic `FOR ALL member` policies on safety tables (DB-201), six free-text status columns (DB-202), and no natural key on `people` (DB-205). See [06_DB_AND_INVARIANTS.md](06_DB_AND_INVARIANTS.md).
6. **Are APIs correct and consistent?** They are correct on auth: no action takes an org id from the client, and redirects are validated. They are inconsistent in shape (API-205), leak internal error text (API-203) and allow login enumeration through the magic link (API-201). The Inngest route is dead and probably incompatible with the vendor (API-204).
7. **Is AuthN/Z secure?** No Critical. The cross-tenant boundary held under every probe. The weak spots are within a tenant (DB-201), the app-only last-owner rule (AUTHZ-201) and the unenforced seats limit (AUTHZ-202). See [07_SECURITY_PRIVACY.md](07_SECURITY_PRIVACY.md).
8. **Are integrations really live?** No. Production reports every integration `false`. No vendor call has ever run, and the Apollo and HubSpot request shapes are unverified. See [08_INTEGRATIONS_JOBS.md](08_INTEGRATIONS_JOBS.md).
9. **Are background processes reliable?** The mechanics are sound and tested with fakes: claim, deadline hand-back, backoff, at-most-once send. They lack per-tenant fairness (JOB-202), alerting on failed jobs (JOB-203, OBS-201) and a kill switch (PROD-207). Nothing runs in prod (`cronSecret:false`).
10. **Is error handling correct?** It is mixed. `can_contact` and the secrets fail closed, but several send gates fail open on read errors (OUT-206). The budget fallback also fails open (PROV-201), and transient errors are recorded as permanent (OUT-202).
11. **Data-integrity and concurrency risks?** The DB-side races are listed in [06_DB_AND_INVARIANTS.md](06_DB_AND_INVARIANTS.md) § Races: last owner, people duplicates, and import dedupe. The 0050 lane and reserve close the send and spend races, but they are not live, and they have only been tested sequentially (TEST-202).
12. **Production-ready?** **No.** The blockers are origin TLS (PROD-001), unset secrets, unapplied 0048–0050, the two migrate-time regressions (DB-203, PROD-201), OUT-201, and the Free plan blocking sends (MONEY-201).
13. **Biggest technical risks?** (a) Outbound email that ignores operator withdrawal (OUT-201). (b) Repo, DB and deploy drifting apart with a health check that cannot see it (PROD-201). (c) No kill switch and no alerting, so a bad batch is noticed late and stopped crudely (PROD-207, OBS-201). (d) Recovery never rehearsed (PROD-206).
14. **Essential missing functionality?** Billing or plan change, a kill switch, deep health, job-failure alerting, complaint handling and complete erasure. See [10_MISSING_SYSTEMS.md](10_MISSING_SYSTEMS.md).
15. **Fix immediately?** Phase 1 of [12_ROADMAP.md](12_ROADMAP.md): HL-1601 → HL-1607, in the stated deploy order.
16. **Build next?** Phase 2: truthful first run, transient-refusal deferral, the plan path, idempotent HubSpot. Then the real-Postgres concurrency suite and route tests (HL-1621, HL-1622), so that the guarantees this product relies on stop being proven only sequentially.
17. **Simplify or remove?** Remove the hand-rolled Inngest route, the Vercel Cron references and the dead Stripe env names. Replace the single-table schema probe with the migration ledger. Replace `scheduled_at` as the sole go signal with a send-time eligibility check. See [11_DEBT.md](11_DEBT.md).
18. **What breaks at 10x?** Not measured. By code: per-tenant starvation in the queue (JOB-202), then the unbounded inbox and assignments loaders hitting PostgREST's row cap (PERF-201), then GitHub-cron tick throughput. See [09_OPS_AND_SCALE.md](09_OPS_AND_SCALE.md) § Scale tiers.
19. **What would you do first as CTO?** Freeze the deploy. Land HL-1601/1602/1603 as one PR, apply 0048–0050 to a staging project and drive one real send end to end with a sandbox mailbox. Then fix the origin, set the secrets and deploy in the safe order. Add the kill switch before the first real customer sends.

---

## Maturity

| Dimension | Level | Reason |
|---|---|---|
| Functional completeness | Works in demo | Every core-loop stage exists in code; none has run against real vendors; Reach Out is blocked (six findings) |
| Backend quality | Works in prod-like env | Sound seams and tests with fakes; withdrawal/retry semantics wrong (OUT-201, OUT-202) |
| Architecture | Works in prod-like env | Right shape; deploy/migrate uncoupled and send eligibility row-local |
| Database integrity | Works in prod-like env | Cross-tenant verified in PGlite (383 checks); within-tenant safety tables writable (DB-201) |
| API quality | Works in prod-like env | Auth correct everywhere; shapes and error text inconsistent |
| Security | Works in prod-like env | No Critical; CSP report-only and blind (SEC-201); no rotation (SEC-203) |
| Privacy / compliance | Prototype | Erasure leaves PII in eight places (LIFE-201); unsubscribe link points at a TLS-failing origin (PROD-001); complaints unrecorded (OUT-208) |
| Reliability | Prototype | No alerting on jobs, no kill switch, stop doesn't stop |
| Integration completeness | Works in demo | Adapters built; zero live calls; Inngest dead |
| Observability | Prototype | No structured logs, Sentry unset, shallow health |
| Test coverage | Works in prod-like env | Strong PGlite/fake suites by risk; no route, proxy-prod or concurrency tests |
| Infrastructure / DR readiness | Prototype | Restore never rehearsed; RPO/RTO undecided; migrations never run on the configured DB |
| Scalability | Not measured → Prototype | No fairness, unbounded loaders; no measurements |
| Cost control | Prototype | Per-org caps exist; not atomic in the live DB; counts not currency; no kill switch |

No numeric score: there is no rubric that could support one.
