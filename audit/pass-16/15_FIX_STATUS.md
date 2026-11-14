# Pass 16 — fix status

Phase 1, first batch (HL-1601, HL-1602, HL-1603), uncommitted on `feat/pass-15-audit-fixes`. Verified with `npm run verify`: everything green. Counts: jobs 478 (was 434), db migrations 388 (was 383), site audit 47 checks (was 46: SCHEMA-01 added), build passes, bundle 201.7 / 275 kB.

| Finding | Status | How | Proof |
|---|---|---|---|
| OUT-201 | Fixed (code; no migration needed) | `send_message` asks `withdrawnOrHeld()` before anything is spent. **Withdrawn** (closed out with `error`, never retried): workspace deleted; enrollment stopped, removed or missing; campaign archived or deleted; opportunity removed or in replied/meeting/proposal/won/lost/archived. **Held** (deferred, sends on resume): enrollment paused or parked, campaign draft or paused, or parent unreadable. `advanceOne` no longer marks a sequence "finished" while its last approved email is still waiting. The Stop action and pipeline close also mark queued mail at once, so the inbox says why (`lib/data/withdraw-mail.ts`) | `verify-jobs.ts`: 9 withdrawn cases + org deleted + 4 held cases + 2 advance cases |
| DB-203 | Fixed | The mailbox callback no longer upserts. It looks up by granted columns, then sends a plain INSERT or UPDATE that returns nothing. If two connects race, the loser of the `23505` retries as an update | `verify-migrations.ts` "Mailbox connect after 0049" re-applies 0049's column grant, which the harness otherwise undoes. In it, the old upsert is refused (DB-203 reproduced) and the new insert/update succeeds |
| PROD-201 | Fixed | Readiness probes `migration_0050_applied()` (`LATEST_MIGRATION`) instead of a table name. Health reports `requiredMigration`. A missing `claim_contact_lane` fails the send loudly instead of deferring it forever. `audit.mjs` SCHEMA-01 fails the build when the probe or `db:doctor` lag the newest migration | SCHEMA-01 passes, and fails with the probe set to 0047 (checked by hand). `verify-jobs.ts` PGRST202 case |

## Not done in this batch

- **Org deletion** is handled only at send time. `delete_organization` (0031) still leaves `scheduled_at` set; the guard refuses those sends. A trigger would need migration 0051.
- **Campaign archive** is handled only at send time, for the same reason (no bounded list of messages to mark from the action).
- **Not run against hosted Supabase or PostgREST.** The DB-203 proof uses PGlite with the SQL that PostgREST emits; the probe change assumes `POST /rest/v1/rpc/migration_0050_applied` answers 404 when the function is absent. Settle both on a staging project before applying 0049.
- **Remaining Phase 1:** HL-1604 (safety-table policies, 0051), HL-1605 (credit reserve cost), HL-1606 (kill switch), HL-1607 (deploy in the safe order).
