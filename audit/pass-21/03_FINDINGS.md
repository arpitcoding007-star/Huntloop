# Pass 21: findings and fix status

Audited at `dab37db` (branch `feat/pass-21-loop`, the same tree as PR 18). Evidence for each finding is in the area reports:

- [raw-A-flows-api-trust.md](raw-A-flows-api-trust.md)
- [raw-B-db-authz-lifecycle.md](raw-B-db-authz-lifecycle.md)
- [raw-C-engine-providers-ai-crm.md](raw-C-engine-providers-ai-crm.md)
- [raw-D-jobs-outreach-money.md](raw-D-jobs-outreach-money.md)
- [raw-E-security-prod-perf-tests-debt.md](raw-E-security-prod-perf-tests-debt.md)

Every High was put through a disprove pass. **No P0 held up.**

Status key:

| Status | Meaning |
|---|---|
| **Fixed** | Changed on this branch, with a test that would fail if the fix broke |
| **Fixed (typecheck)** | Changed on this branch; no automated test yet |
| **Open** | Not fixed. The reason is given |
| **External** | Needs access, credentials or a decision from the owner |
| **Rejected** | The proposed fix was judged wrong. The reason is given |

## P1

| ID | Finding | Status | Fix and proof |
|---|---|---|---|
| PROD-001 / JOB-201 | Production health `ok:false`: no `CRON_SECRET`, encryption key, AI, email, Sentry or vendor keys. The tick fails on every run | **External** | See [00_SUMMARY.md](00_SUMMARY.md), "Blockers" |
| ENG-001 / DB-003 | A discovery run killed mid-flight blocked its saved search forever | **Fixed (typecheck)** | `schedule_discovery` closes runs untouched for 15 min as `failed/timeout`. `openRun` adopts a run idle for 5 min via compare-and-swap on `updated_at` and resumes from `page_cursor` |
| ENG-002 | Ten unenrichable companies starved enrichment refresh for every tenant | **Fixed (typecheck)** | Migration 0070 adds `companies.enrich_requested_at`. The sweep stamps it and skips anything asked about in the last 24 h |
| OUT-201 | A send claim that never finished was re-queued every tick and never shown | **Fixed** | `send_message` writes "Delivery unknown…" to `messages.error`. `due_sends_fair` already excludes rows that have an error. Test in `verify-jobs` |
| OUT-202 | Gmail sync dropped replies (page cap, second page, failed loads) but marked the inbox fresh | **Fixed (typecheck)** | `labelId=INBOX`. The cursor advances only past history records that were fully read, and a partial sync does not set `last_sync_at` |
| JOB-202 | A model call could outlive the 60 s function and kill every lane, sends included | **Fixed (typecheck)** | `withAiDeadline` (AsyncLocalStorage) gives each request the time remaining minus 3 s. A call that cannot fit 10 s is not started |
| FLOW-001 | A reversed Won/Lost move left its outcome counted for good | **Fixed (typecheck)** | A move retracts the won/lost outcome that no longer applies, along with its demand signal. Meetings and proposals stay |
| DB-001 | A deleted workspace kept every role, and its Exchange listings stayed live | **Fixed** | `has_org_role` checks `organizations.deleted_at`. `delete_organization` pauses offerings, withdraws needs and intros, and removes the profile. Tests in `verify-migrations` 0070 |
| DB-002 | A workspace that had claimed a profile could not be hard-deleted | **Fixed (part)** | The profile foreign key now cascades; tested. **Open:** no purge job removes deleted workspaces after a grace period. That needs a retention-period decision (privacy page: "a recovery period") |

## P2

| ID | Finding | Status | Fix and proof |
|---|---|---|---|
| FLOW-002 | About 15 writes reported success when they changed 0 rows | **Fixed (typecheck)** | `.select("id").maybeSingle()` plus a refusal on: pipeline move, campaign archive, step save and remove, approve, join decline, Exchange profile, offering, request and evidence. Ids are validated as UUIDs |
| TRUST-001 / DB-007 | Any admin could claim another company's domain | **Fixed** | The 0070 trigger requires an owner or admin with a confirmed address at the domain. A 23505 is reported in words. Tested |
| TRUST-002 | "Verified" outlived a rename or a new domain | **Fixed** | The trigger clears `verified_at`. Tested |
| TRUST-003 | Any save re-dated availability | **Fixed (typecheck)** | The action keeps the old date when availability is unchanged |
| API-001 | "Schema not applied" was cached for the life of the process | **Fixed (typecheck)** | Only `true` is cached |
| DB-004 | "At least one owner" was enforced in the app only; an admin could self-promote | **Fixed** | Guard trigger: the last live owner cannot leave or step down, and the bootstrap branch needs an empty workspace. Tested |
| DB-005 | Erasure left phone, LinkedIn, thread participants and title | **Fixed** | `erase_contact` removes all of the person's contact points, redacts threads and clears the title. Tested |
| DB-006 | Retention reached only 50 orgs | **Fixed (typecheck)** | Pages through every configured org. **Open:** the prune still deletes contact points only (scope decision) |
| DB-008 / OUT-204 | Any member could set an unbounded mailbox cap, or hard-delete a mailbox | **Fixed** | CHECK 1–500, `daily_limit` added to the guard, delete is admin-only. Tested |
| CRM-001 | A failed association after creating a deal was never retried; a mapping write could be ignored | **Fixed** | Association on both branches, and mapping errors throw. Test |
| CRM-002 | Contacts and companies without a natural key were re-created on every sync | **Fixed (typecheck)** | The `knownId` PATCH comes first, falling back to search-then-create on 404 |
| CRM-003 | A reconnected portal or a deleted deal failed for good | **Fixed** | A 404 on update means forget the mapping and create; a portal change clears the mappings. Test |
| PRV-001 | 200 responses with an unexpected shape were accepted (ZeroBounce `error`, Apollo search) | **Fixed (typecheck)** | Non-retryable `ProviderError`. Apollo enrich is left as is: whether it returns `{}` for "not found" is UNVERIFIED |
| OUT-203 | Outlook's first sync walked the whole inbox | **Fixed (typecheck)** | 7-day `$filter`. Fresh only on a `deltaLink` |
| OUT-205 | "No mailbox allowance" burned retries every tick | **Fixed (typecheck)** | Deferred, rechecked hourly |
| SEC-002 | Memory URL fetch and document parsing had no rate limit | **Fixed (typecheck)** | `memory_ingest_url` and `memory_extract` limits |
| PERF-001 | Waterfall in the org layout | **Fixed (typecheck)** | `Promise.all`. Other pages in the finding are still **Open** (not measured) |
| JOB-203 | `advance_enrollments` drafts only 5 a tick, platform-wide | **Open** | Fan-out per enrollment (M). Throughput only matters once the tick runs (PROD-001) |
| SEC-001 | CSP is report-only and has nowhere to report | **External** | Needs `SENTRY_DSN`, then `CSP_ENFORCE=true` after a quiet week |
| PROD-002 | Migrate runs beside CI and the deploy | **Rejected (part)** | Gating migrate on CI would make a guaranteed ~20-minute 503 window, because Vercel deploys at once. PR CI already gates `main`. Least-privilege `permissions` were added instead |

## P3

| ID | Status | Note |
|---|---|---|
| API-002 duplicate mailbox audit row | **Fixed** | — |
| FLOW-003 login drops the query | **Fixed** | `safeNextPath` validates the whole value |
| FLOW-004 Exchange resubmit duplicates | **Fixed (typecheck)** | A completed session returns the request it already filed |
| PRV-002 429 retried in-call | **Fixed** | Left to the queue's backoff. Test updated |
| PRV-003 / enrich and rank read any provider's id | **Fixed (typecheck)** | Filtered to Apollo. A HubSpot id had been sent to Apollo |
| SEC-003 workflow permissions | **Fixed** | `contents: read` on all three. **Open:** pinning actions by SHA |
| SEC-004 csp-report mints Sentry issues | **Fixed (typecheck)** | Directive allow-list, fingerprint by origin |
| SEC-005 `.next*` build output committable | **Fixed** | `.gitignore` |
| SEC-006 SSRF ranges | **Fixed (typecheck)** | Teredo, local NAT64, 192.88.99/24 |
| SEC-007 recipient in logs | **Fixed (typecheck)** | Addresses masked |
| PROD-003 empty site URL becomes localhost | **Fixed (typecheck)** | — |
| PERF-002 unbounded memories | **Fixed (typecheck)** | `.limit(500)` |
| DB-009 Exchange mail to removed members and deleted orgs | **Fixed (typecheck)** | Filtered by live membership and live org |
| AI-001 cache-read price, served model not recorded | **Open** | The price claim is not verified against the current price list |
| AI-002 / MONEY-201 quotas checked, then charged | **Open** | Bounded by lanes. Atomic `reserve_usage` (S–M) |
| DB-010 export misses Exchange and outreach tables | **Fixed** | Campaigns, sequences, steps, Exchange requests, offerings and profile in full; contact points and enrollments counted. Tested |
| DB-011 discoverable workspaces trust unconfirmed domain | **Fixed** | The caller's address must be confirmed. Tested |
| DB-012 any member can write arbitrary audit actions | **Open** | Actor is recorded correctly |
| DEBT-001 191 `any`, 80 `eslint-disable` | **Open** | Root fix: generated Supabase types |
