# Pass 21 — Raw B: DB + AuthZ + Data lifecycle

Branch `feat/pass-21-loop` @ `dab37db`. Read-only. Evidence comes from reading the migrations (I checked the latest definition of every function and policy cited here) and from scratch PGlite probes. The probes applied all 69 migrations to an in-memory PGlite and impersonated users as role `authenticated` with `request.jwt.claim.sub`. The probe scripts are in the session scratchpad and are not committed. Nothing touched a real database. No secrets were read.

## Baseline (verified, no finding)

- **RLS is on for all 97 public tables.** Checked in the catalog (`pg_class.relrowsecurity`) after all migrations. Two tables have RLS on and no policies, `public_research` and `public_research_attempts`, which makes them deny-all to sessions. That is intended (0025).
- **SECURITY DEFINER functions (136): every one pins `search_path`.**
- **All 10 views are `security_invoker=true`.**
- **Exchange tables (0060–0069): no cross-tenant read through RLS was found.**
  - Needs, matches, intake sessions, notifications and reveal log are scoped by `user_org_ids()`.
  - Intros are buyer-read only. Messages and outcomes go through `exchange_is_intro_party`.
  - Reports and suspensions are deny-all.
  - `org_id` on offerings and evidence is derived by trigger (`exchange_offering_follows_provider`, `exchange_evidence_follows_offering`), so a forged `org_id` is overwritten.
- **Invitations are sound.**
  - Token: uuid v4 (122 bits), 14-day expiry, single-use (`accepted_at`).
  - Bound to the invited email, case-folded, and that email must be confirmed (`accept_invitation`, 0047:743).
  - An owner invite needs an owner (0031 `guard_invitation_owner`).
- **Removing a member ends their access.** Both `user_org_ids()` and `has_org_role()` filter `memberships.deleted_at`.
- **Mailbox tokens can't be read by sessions.** `oauth_token_enc` and `refresh_token_enc` are column-revoked (0049:160-169).
- **apps/web has no service-role client.** `check:admin-imports` enforces this. `lib/ai/seal.ts` only HKDF-derives a MAC key from the service key. `mutate()` (apps/web/lib/data/org.ts) uses the caller's RLS client, and its role tiers match the policies (member / admin / owner).

---

### [P1] DB-001: A deleted workspace keeps its Exchange presence live, and its members keep write access
- **Confidence:** CONFIRMED (PGlite probe)
- **Where:** `has_org_role` in packages/db/migrations/0001_identity.sql:120 (never redefined); `delete_organization` in 0031_tenant_write_hardening.sql:302 (latest version); `exchange_offerings_read` in 0060:281; `exchange_recall_offerings` in 0065:108.
- **Evidence:**
  1. Org A creates a provider profile, an active offering and an open need, then calls `delete_organization(A)`.
  2. Org B can still `select` A's offering and profile.
  3. `exchange_recall_offerings` still returns A's offering as a match candidate.
  4. A's owner can still `insert into exchange_needs (org_id = A)`.
  5. `has_org_role(A, 'owner')` still returns true.
- **Impact:**
  - A "deleted" company stays publicly listed and keeps being matched to buyers, who can request intros to it.
  - Its needs stay `open`.
  - Every INSERT policy and every SECURITY DEFINER RPC gated on `has_org_role` keeps working inside a deleted tenant. Examples: `exchange_request_intro`, `exchange_confirm_need`, `erase_contact_for_org`, `export_organization`.
  - The profile's domain stays reserved forever (see DB-007).
- **Root cause:**
  - `user_org_ids()` was taught about `organizations.deleted_at` in 0031:253. `has_org_role()` was not.
  - `delete_organization` predates the Exchange (0059+) and was never extended to it.
  - The Exchange read paths filter rows on their own `deleted_at`/`status`, never on the owning org's.
- **Fix:**
  1. Redefine `has_org_role` to join `organizations o ... and o.deleted_at is null`.
  2. In `delete_organization`, add:
     - `update exchange_offerings set status='paused'`
     - `update exchange_needs set status='withdrawn'`
     - `update exchange_provider_profiles set deleted_at=now()`
     - Withdraw `requested` intros, all `where org_id = p_org`.
- **Acceptance:** After `delete_organization(A)`, a member of A gets 0 rows from has_org_role-gated writes. A's offerings are invisible to other orgs and absent from recall.
- **Test to add:** In verify-migrations, a "deleted org" block that asserts the five probe statements above now fail or return empty.
- **Effort:** S

### [P1] DB-002: Deleted workspaces are never purged, and hard-deleting an Exchange provider org fails
- **Confidence:** CONFIRMED
- **Where:** packages/db/migrations/0060_exchange_core.sql:144-160 (`org_id ... on delete set null` plus `check ((org_id is null) = (claimed_at is null))`); apps/web/app/(marketing)/privacy/page.tsx:235-236; packages/jobs/src/handlers/enforce-retention.ts.
- **Evidence:**
  - Probe: `delete from organizations where id = A` fails with `new row for relation "exchange_provider_profiles" violates check constraint "exchange_provider_profiles_check"`.
  - Searching packages/ and apps/ for any hard delete or purge of `organizations` finds nothing.
  - The privacy page says: "A deleted workspace is retained for a recovery period and then removed."
- **Impact:**
  - The published retention promise is false. All prospect PII of a deleted workspace is kept forever.
  - Any future purge, or a manual ops delete, of an org that ever claimed a supplier profile aborts.
- **Root cause:**
  - Soft delete was built with no second stage.
  - The SET NULL FK action contradicts the table's own CHECK.
- **Fix:**
  1. Make `exchange_provider_profiles.org_id` `on delete cascade`, or add a BEFORE DELETE trigger on organizations that clears `claimed_at`.
  2. Add `purge_deleted_organizations(p_grace interval default '30 days')`: `delete from organizations where deleted_at < now() - p_grace`. Grant it to service_role and call it from `enforce_retention`.
- **Acceptance:**
  - An org deleted more than the grace period ago is gone after one retention tick.
  - Hard delete succeeds when a claimed profile exists.
- **Test to add:** PGlite: an org with a claimed profile, `deleted_at = now() - 31 days`; run the purge; assert 0 rows in organizations and its child tables.
- **Effort:** M

### [P1] DB-003: A discovery run left in `running` blocks its saved search forever
- **Confidence:** CONFIRMED that no recovery exists. LIKELY that the trigger happens: the job tick has `maxDuration = 60` (apps/web/app/api/jobs/tick/route.ts:45) and the run loops over paid provider pages.
- **Where:** packages/jobs/src/handlers/discover-companies.ts:147-155 and 351-370; unique index `discovery_runs_one_open_per_query` in 0014:188; `claim_due_discovery_queries` in 0057:40-62.
- **Evidence:**
  - `openRun` resumes a run only if the payload names `runId`, and no producer ever sets `runId`.
  - If the worker dies after the run is set to `running`, `requeue_stalled_jobs` re-queues the *job*. The retry then inserts a new run, hits 23505, and returns `ok: true, skipped: "already in progress"`.
  - The claim function excludes any query that has a `queued`/`running` run.
  - Nothing in SQL or in the jobs package ever moves a stale `discovery_runs` row out of `running`.
- **Impact:** That ICP's scheduled discovery silently stops for good. The core loop starves with no error shown anywhere.
- **Root cause:** Liveness is tracked on two rows (`job_executions` has a reaper, `discovery_runs` has none), and the retry path has no handle on the orphaned run.
- **Fix:** Either works.
  - In `openRun`, on 23505, select the live run for `query_id` and resume it when `updated_at < now() - 10 min`.
  - Or extend `requeue_stalled_jobs` to `update discovery_runs set status='failed', stop_reason='abandoned' where status in ('queued','running') and updated_at < now() - interval '30 minutes'`.
- **Acceptance:** A run forced into `running` with an old `updated_at` no longer stops the query being claimed on the next tick.
- **Test to add:** Insert a stale `running` run; call `claim_due_discovery_queries` (after the reaper); assert the query is returned.
- **Effort:** S

### [P2] DB-004: The "at least one owner" rule is enforced only in the app, and an ownerless org can be taken by any admin
- **Confidence:** CONFIRMED (PGlite probe)
- **Where:** `guard_membership_owner` in 0047_security_leads.sql:327-380 (latest version), the "first owner" branch at 356-363; `membership_write` in 0001:163; `delete_own_account` in 0029:228-262, where line 251 doesn't filter `m2.deleted_at`; the app-only check is apps/web/app/(app)/[org]/team/actions.ts:88-95 and 154-158.
- **Evidence:**
  1. The sole owner runs `update memberships set deleted_at=now()` on their own row through PostgREST. It is accepted, and the org has 0 live owners.
  2. Admin D then runs `update memberships set role='owner' where user_id = D`. It is accepted through the "first owner" branch.
  3. Separately, a sole live owner whose org also holds a *soft-deleted* owner row can `delete_own_account()`. It succeeds and leaves 0 owners.
- **Impact:**
  - An org can end up with no owner.
  - Any admin can then promote themselves to owner, which unlocks `delete_organization` and owner grants. The SEC-002 invariant (an admin can't become owner) is broken in this state.
  - The app's `countOwners` check can be bypassed with a direct REST call and races under concurrent demotions.
- **Root cause:**
  - The guard asks whether the caller is an owner, not whether an owner remains.
  - The bootstrap exception for `create_organization` is keyed only on "no live owner exists".
- **Fix:**
  1. In the guard, after an owner row is removed or demoted, raise if `not exists (live owner <> old.user_id)` and the org is live.
  2. Restrict the first-owner branch to a GUC set inside `create_organization` (`set_config('huntloop.bootstrap_owner', ...)`).
  3. Add `and m2.deleted_at is null` in `delete_own_account`.
- **Acceptance:**
  - All three probe statements are rejected with 42501.
  - `create_organization` still works.
- **Test to add:** The three probes above, as `expectRejectTx` in verify-migrations.
- **Effort:** S

### [P2] DB-005: Erasure (GDPR) leaves phone, LinkedIn and thread data behind
- **Confidence:** CONFIRMED (PGlite probe)
- **Where:** `erase_contact` in 0037_daily_loop.sql:693-775 (latest version).
- **Evidence:**
  - Setup: a person with email, phone and LinkedIn contact points, plus a thread with `participants = {sender, jane@...}` and subject "Hi Jane Doe".
  - After `erase_contact(org, 'jane@t.test')`:
    - The `phone` and `linkedin` contact_points remain.
    - The thread's `subject` and `participants` (the plaintext email) remain.
    - `people.title` remains.
  - The function only deletes `contact_points where kind='email'` (0037:727) and never touches `threads`.
- **Impact:** An erasure request is reported as done while direct identifiers stay stored. This is a compliance failure.
- **Root cause:** Erasure is keyed on the email address instead of on the people it resolves to. Tables added later (`threads.participants`, 0008:176) were never added to it.
- **Fix:**
  - Delete `contact_points where person_id = any(v_people)`, all kinds.
  - Null `people.title`.
  - `update threads set subject='[erased]', participants = array_replace(participants, v_email, v_hash)` where the email is in participants.
  - Review `message_events.payload` (UNVERIFIED whether it carries addresses).
- **Acceptance:** After erasure, no row in public contains the email, the phone number or the LinkedIn URL.
- **Test to add:** Seed a person with all three kinds plus a thread; erase; grep the seeded values with `select ... where row_to_json(t)::text ilike '%jane%'` over the affected tables.
- **Effort:** S

### [P2] DB-006: Contact retention only ever runs for 50 orgs, and it deletes less than promised
- **Confidence:** CONFIRMED
- **Where:** packages/jobs/src/handlers/enforce-retention.ts:71-76; `prune_stale_contacts` in 0017_outreach_safety.sql:385-414; privacy page lines 239-242.
- **Evidence:**
  - The query is `.not("contact_retention_days","is",null).is("deleted_at",null).limit(50)` with no order and no cursor. The job runs daily (runner.ts:318).
  - `prune_stale_contacts` deletes only `contact_points`. `enrichment_records`, `people.first_name/last_name/linkedin_url` and `title` are kept.
- **Impact:**
  - From the 51st org that sets a retention window, nothing is ever pruned for the orgs past the first 50.
  - Where pruning does run, names and enrichment survive even though the privacy page says "details ... are deleted".
- **Root cause:** A per-tick cap was added with no rotation, and the prune scope was never widened.
- **Fix:**
  - Process orgs in pages (loop until fewer than 50 are returned), or order by a `last_pruned_at` column.
  - Extend the prune to the person's `enrichment_records` and name/LinkedIn/title fields for the same eligible people.
- **Acceptance:** With 120 configured orgs, one tick prunes all 120.
- **Test to add:** A unit test with a fake db that returns 120 orgs; assert `prune_stale_contacts` is called 120 times.
- **Effort:** S

### [P2] DB-007: Any admin can claim any company's domain on the Exchange and lock out the real owner
- **Confidence:** CONFIRMED (PGlite probe)
- **Where:** 0060_exchange_core.sql:163 (`exchange_provider_profiles_domain_key`, unique where `domain is not null and deleted_at is null`); apps/web/app/(app)/[org]/exchange/actions.ts:444.
- **Evidence:**
  - Org B's admin inserts a profile with `domain='a-co.test'`, and it is accepted.
  - Org A (the real owner) then gets `duplicate key value violates unique constraint "exchange_provider_profiles_domain_key"`.
  - Nothing ties a claimed domain to the org's verified email domain.
- **Impact:**
  - Squatting and impersonation on the marketplace: the squatter shows the victim's domain, unverified.
  - The genuine company can't list itself.
  - Combined with DB-001, a deleted org holds the domain forever.
- **Root cause:** Uniqueness is applied at claim time instead of at verification time.
- **Fix:** Change the index to `unique (domain) where verified_at is not null and deleted_at is null`. On verification, soft-delete other unverified holders of that domain. Optionally require `domain` to equal the creating user's confirmed email domain.
- **Acceptance:** Two unverified claims can coexist. Once one is verified it is the only live holder.
- **Test to add:** The probe sequence above, plus verification.
- **Effort:** S

### [P2] DB-008: Any member (not just admins) can raise a mailbox's daily send limit without bound, or delete the mailbox
- **Confidence:** CONFIRMED (PGlite probe)
- **Where:** `tenant_write` policy for `mailboxes` (0004:341-351, member tier); `guard_mailbox_safety` in 0049:124-145, which guards warm-up and counters but not `daily_limit`; there is no CHECK on `daily_limit` (0004:29).
- **Evidence:**
  - A member runs `update mailboxes set daily_limit=1000000`, and it is accepted.
  - A member runs `delete from mailboxes ... returning id`, and it is accepted.
  - The app has no UI that writes `daily_limit`, so this is reachable only through direct PostgREST.
- **Impact:**
  - Once warm-up ends, the per-mailbox cap (0048: `least(daily_limit, ...)`) is whatever a member types. That means deliverability and spam-abuse risk on a customer's own domain.
  - A member can also disconnect sending for the whole team.
- **Root cause:** `mailboxes` was put in the generic member-write bucket in 0004. Later hardening added column guards but not a role tier.
- **Fix:**
  - Admin tier for INSERT/UPDATE/DELETE on mailboxes.
  - `check (daily_limit between 1 and 500)`.
  - Add `daily_limit` to `guard_mailbox_safety` unless the caller is an admin.
- **Acceptance:** Both probe statements are rejected for role `member`.
- **Test to add:** Both probes as `expectRejectTx`.
- **Effort:** S

### [P3] DB-009: Exchange notification emails still go to people removed after the notice was queued, and to deleted orgs
- **Confidence:** LIKELY
- **Where:** packages/jobs/src/handlers/send-exchange-notifications.ts:100-133.
- **Evidence:** Rows are read by `user_id`/`org_id` with the service role. Neither `memberships.deleted_at` nor `organizations.deleted_at` is re-checked before sending. Digests and quiet hours delay a send by up to a day.
- **Impact:** A removed employee gets an email about the org's intros and needs.
- **Root cause:** Membership is checked when the notice is queued, not when it is sent.
- **Fix:** Join live memberships and live orgs when reading notices, and set `channel='none'` on any that no longer qualify.
- **Acceptance / Test:** Queue a notice, soft-delete the membership, run the handler, and assert no email and `channel='none'`.
- **Effort:** S

### [P3] DB-010: The workspace export leaves out Exchange data, contact points, sequences and assistant conversations
- **Confidence:** CONFIRMED
- **Where:** `export_organization` in 0044_personal_learning.sql:281-352 (latest version).
- **Evidence:** Its sources are activities, ai_runs, companies, evidence, icps, memberships, memories, messages, opportunities, organizations, people and products. None of `exchange_*`, `contact_points`, `campaigns`/`sequences`/`enrollments` or `conversations` is included.
- **Impact:** Data portability is incomplete, so the "export your workspace" claim is only partly true.
- **Fix:** Add those tables, scoped by `org_id`, to the jsonb object.
- **Acceptance / Test:** The export JSON has a key for every table that has an `org_id`. A test can diff the export's keys against `information_schema` with an explicit allowlist of exclusions.
- **Effort:** S

### [P3] DB-011: The workspace directory trusts an email domain that hasn't been confirmed
- **Confidence:** LIKELY. It only matters if the auth configuration issues sessions to unconfirmed addresses, the same premise 0047 used to harden `accept_invitation`.
- **Where:** `discoverable_workspaces` and `request_to_join` in 0027_org_directory.sql:104-140 and 238-270 (no later redefinition).
- **Impact:** A user with an unconfirmed `@victim.com` address sees the names, slugs and seat counts of workspaces on that domain, and can file join requests.
- **Fix:** Require `email_confirmed_at is not null`, as 0047 does for invitations.
- **Effort:** S

### [P3] DB-012: Any member, even a viewer, can write audit-log entries with any action name
- **Confidence:** CONFIRMED
- **Where:** `write_audit_log` in 0007:228. It checks membership only, then accepts any `p_action`/`p_meta`.
- **Impact:** A viewer can add misleading entries (for example `member.removed`) to the admin-visible trail. The actor is recorded correctly, so the harm is noise and confusion, not impersonation.
- **Fix:** Allow only a fixed list of client-writable actions, or revoke the function from `authenticated` and write audit entries only from SECURITY DEFINER paths.
- **Effort:** S

---

## State machines

| Entity.column | States | Transitions / who | DB-enforced? | Stuck-state recovery |
|---|---|---|---|---|
| job_executions.status | queued → running → succeeded/failed/cancelled | runner (service) | CHECK on the value set only | `requeue_stalled_jobs` (0008:340), 10 min — OK |
| discovery_runs.status | queued, running, succeeded, partial, failed, refused | handler + `finish_discovery_run` | CHECK only | **None** (DB-003) |
| score_recompute_requests.status | pending → running → done/failed/cancelled | claim fn; member may cancel (0023:95) | yes (no INSERT policy; cancel-only UPDATE) | A user can cancel. No automatic reclaim of a stale `running` |
| learning_runs.status | requested, running, ready, insufficient, failed | analyze-performance | partial unique (0010:270) | The handler resumes by runId. No reaper (UNVERIFIED) |
| messages (sent_at/send_attempted_at/scheduled_at) | draft → approved/scheduled → attempted → sent | session up to approval, engine after | yes, `guard_message_integrity` (0051:69): sent rows are immutable, approve only as yourself | send claim (0033/0050); lane TTL 10 min |
| enrollments.status | active, paused, parked, stopped | engine/session | CHECK only; firewall triggers | stopped by delete_org / firewall |
| exchange_intros.state | requested → accepted/declined/withdrawn/stale; accepted → closed/stale | SECURITY DEFINER RPCs only (no write policy) | yes: functions check the current state, plus a CHECK tying decided_at to state | `exchange_expire` (0066:729) |
| exchange_needs.status | draft, open, paused, fulfilled, expired, withdrawn | a member may set any value by UPDATE | value set only; no transition rules (for example withdrawn → open is allowed; reopening re-dates confirmation) | `exchange_expire` |
| exchange_offerings.status | draft, active, paused | member | value set only | — (not closed on org delete: DB-001) |
| exchange_reports.state | open → actioned/dismissed | platform only (deny-all RLS) | yes | — |
| invitations | pending → accepted / revoked / expired | admin; invitee through the RPC | yes (RPC predicates + partial unique) | expiry by time |
| join_requests.status | pending → approved/declined | admin | invoker function + RLS | — |
| memberships (role, deleted_at) | live ↔ removed; role changes | admin; owner for the owner role | partial: owner guard, but no last-owner rule (DB-004) | — |
| organizations.deleted_at | live → soft-deleted | owner | yes (owner check) | **No purge** (DB-002) |

## Invariants

| Invariant | Where enforced | Test that would fail today |
|---|---|---|
| A deleted org grants no write privileges | `user_org_ids` only (0031:253); **not** `has_org_role` | insert into exchange_needs as owner of a deleted org (DB-001) |
| A deleted org's Exchange listings are not public | nowhere | select another org's offering after delete_organization (DB-001) |
| A deleted workspace is eventually removed | nowhere (privacy page claim) | purge test (DB-002) |
| A live org has ≥1 live owner | app only (team/actions.ts) | sole owner soft-deletes own row via REST (DB-004) |
| Only an owner can make an owner | guard_membership_owner (0047) — except when there are 0 owners | admin self-promotes after the owner leaves (DB-004) |
| Erasure removes all identifiers for the person | partial, erase_contact (0037) | phone/LinkedIn/thread participants survive (DB-005) |
| Retention applies to every configured org | enforce-retention, capped at 50 | 120-org sweep (DB-006) |
| One live discovery run per query, and it terminates | unique index (0014:188); termination is not enforced | stale running run blocks claim (DB-003) |
| A provider domain belongs to its verified owner | partial unique on any claim | squat probe (DB-007) |
| The mailbox send cap is admin-controlled and bounded | not enforced | member sets daily_limit = 1e6 (DB-008) |
| A sent message is immutable | guard_message_integrity (0051) | — (holds) |
| Invite is single-use, email-bound and confirmed | accept_invitation (0047:743) | — (holds) |
| Every table has RLS; every SECURITY DEFINER function pins search_path | migrations | — (holds; checked in the catalog) |
| An offering or evidence row's org follows its provider/offering | triggers 0060:253, 0062:47 | — (holds) |
