# Pass 16 — fix status

Phase 1, first batch (HL-1601, HL-1602, HL-1603), uncommitted on `feat/pass-15-audit-fixes`. Verified with `npm run verify`: everything green. Counts: jobs 478 (was 434), db migrations 388 (was 383), site audit 47 checks (was 46: SCHEMA-01 added), build passes, bundle 201.7 / 275 kB.

| Finding | Status | How | Proof |
|---|---|---|---|
| OUT-201 | Fixed (code; no migration needed) | `send_message` asks `withdrawnOrHeld()` before anything is spent. **Withdrawn** (closed out with `error`, never retried): workspace deleted; enrollment stopped, removed or missing; campaign archived or deleted; opportunity removed or in replied/meeting/proposal/won/lost/archived. **Held** (deferred, sends on resume): enrollment paused or parked, campaign draft or paused, or parent unreadable. `advanceOne` no longer marks a sequence "finished" while its last approved email is still waiting. The Stop action and pipeline close also mark queued mail at once, so the inbox says why (`lib/data/withdraw-mail.ts`) | `verify-jobs.ts`: 9 withdrawn cases + org deleted + 4 held cases + 2 advance cases |
| DB-203 | Fixed | The mailbox callback no longer upserts. It looks up by granted columns, then sends a plain INSERT or UPDATE that returns nothing. If two connects race, the loser of the `23505` retries as an update | `verify-migrations.ts` "Mailbox connect after 0049" re-applies 0049's column grant, which the harness otherwise undoes. In it, the old upsert is refused (DB-203 reproduced) and the new insert/update succeeds |
| PROD-201 | Fixed | Readiness probes `migration_0050_applied()` (`LATEST_MIGRATION`) instead of a table name. Health reports `requiredMigration`. A missing `claim_contact_lane` fails the send loudly instead of deferring it forever. `audit.mjs` SCHEMA-01 fails the build when the probe or `db:doctor` lag the newest migration | SCHEMA-01 passes, and fails with the probe set to 0047 (checked by hand). `verify-jobs.ts` PGRST202 case |

## Second batch: HL-1604 (migration 0051)

| Finding | Status | How | Proof |
|---|---|---|---|
| DB-201 | Fixed in repo, **not live until 0051 is applied** | `0051_safety_record_integrity.sql`. `suppressions` becomes insert-only for sessions. `people`, `opportunities`, `enrollments` and `messages` lose session DELETE (split into insert + update policies, as 0031 did for `companies`). The `guard_message_integrity` trigger lets a session set `approved_by`/`rejected_by`/`edited_by` only to itself. A session can never write `sent_at`, `send_attempted_at`, `provider_message_id` or `message_id_header`, never insert an inbound message, and never change a message whose send was claimed. `enrollments.status` CHECK allows only active/paused/parked/stopped (added NOT VALID, validated when existing rows allow) | `verify-migrations.ts` "DB-201 (0051)": 18 cases as `authenticated`, including the app's own approve/edit/withdraw/reply/stop writes still passing and the engine still able to record a send |
| SEC-301 (pass 17) | Fixed in 0051, **not live** | The guard now protects the approval, not only the approver columns. A session can schedule a message only by approving it as itself (insert or update). An approved message's subject, body or recipient can change only in the same write that clears `scheduled_at` and `approved_by`, so it must be approved again | `verify-migrations.ts`: 7 SEC-301 cases, plus the app-writes case run in the app's real order (edit, then approve). 414/414 |
| DB-202 | Fixed (0051 + 0055) | `enrollments.status` CHECK in 0051; the other five status columns in 0055 (see `docs/status/pass-18-status.md`) | same block |

`LATEST_MIGRATION` is now 0051, so production readiness requires 0051 applied. `db:doctor` has a 0051 row. `docs/spec/generated/schema-reference.md` was regenerated.

**Deploy order now:** apply 0048 → 0049 → 0050 → 0051, then deploy. 0051 has no app dependency: the app never does what it forbids.

## Third batch: HL-1605, HL-1606 and pass-17 fixes (migrations 0052, 0053)

| Finding | Status | How | Proof |
|---|---|---|---|
| PROV-201 / HL-1605 | Fixed, **not live** (0052) | `reserve_provider_credit(p_org, p_provider, p_credits default 1)` holds the call's whole cost and allows it only if all of it fits. Adapters declare per-capability costs (`ProviderAdapter.credits`; Apollo person match = 2). `reserveCredit` falls back to 0050's two-argument function, then to the read-only check, and logs any error instead of failing open silently | `verify-migrations.ts` 0052 block (two-credit call refused on the last credit, holds nothing); `verify-providers.ts` (reserves 2, settles 2; 0050 fallback holds and settles 1) |
| PROD-207 / HL-1606 | Fixed, **not live** (0053) | `platform_pauses` (service role only, deny-all RLS) + `platform_paused(scope, org)`. Scopes: `sends` (`send_message` defers, fails closed when unreadable), `ai` (`runForOrg`, `resolveRecorder`, anonymous `/discover` research on a global pause), `providers` (`callProvider` refuses after the cache, before the budget). Runbook `docs/operations/kill-switch.md` | `verify-migrations.ts` 0053 block (9 cases incl. session isolation); `verify-jobs.ts` 4 send cases; `verify-providers.ts` 4 cases (paid call refused, nothing reserved, cache still served) |
| PERF-301 (pass 17) | Fixed, **not live** (0052) | `message_events(message_id)`, `messages(thread_id, created_at)`, `threads(org_id, last_message_at desc)` | index-existence check; measured 46.7 s → 0.74 s in pass 17 |
| SEC-302 (pass 17) | Fixed, **not live** (0052) | `discoverable_workspaces()` lists a workspace at a domain only if an owner or admin has a confirmed address there; `request_to_join` inherits it | `verify-migrations.ts` 0027 block: Org B claiming `a.test` is not offered to `@a.test` |
| PROV-301 (pass 17) | Fixed | Apollo and Hunter person match throw a non-retryable `ProviderError` on a 200 without the expected envelope; the vendors' real "no match" answers are unchanged | `verify-providers.ts` 5 cases incl. "recorded failed, 0 credits, not cached" |
| A11Y-301 (pass 17) | Fixed | Inbox chip `text-ai` → `text-ai-text`; Companies link `text-brand` → `text-brand-text` (both existing text-safe tokens); Imports file input `aria-label` + `tabIndex={-1}`; report table wrapper focusable region. `e2e/a11y.spec.ts` now covers 39 routes (was 5), with one documented per-page exception (`/demo/intelligence` `<main>`, reachable via the skip link) | `npx playwright test e2e/a11y.spec.ts`: 88 passed (39 routes × desktop and mobile, plus palette and themed contrast) |
| FLOW-301 (pass 17) | Fixed | `split(/\s+/)` | — |

`LATEST_MIGRATION` is now **0053**. **Deploy order now:** apply 0048 → 0053, then deploy.

## Not done in this batch

- **Org deletion** is handled only at send time. `delete_organization` (0031) still leaves `scheduled_at` set; the guard refuses those sends. A trigger would need migration 0051.
- **Campaign archive** is handled only at send time, for the same reason (no bounded list of messages to mark from the action).
- **Not run against hosted Supabase or PostgREST.** The DB-203 proof uses PGlite with the SQL that PostgREST emits; the probe change assumes `POST /rest/v1/rpc/migration_0050_applied` answers 404 when the function is absent. Settle both on a staging project before applying 0049.
- **Remaining Phase 1:** HL-1607 (deploy in the safe order), which needs owner access (pass-17 `09_ACCESS_NEEDED.md` A1 and A6).
