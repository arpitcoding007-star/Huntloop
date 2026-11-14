# Pass 16 — database, invariants and races

Method (reviewer B): all 50 migrations applied in order to an in-memory PGlite with Supabase-like roles and default grants. The final schema was read from the catalog: **82 tables, 142 policies, 118 functions, 128 triggers**. Repros ran as `authenticated` with a JWT user id, the way PostgREST runs. Drift: the configured DB has 0001–0047 (doctor); 0048–0050 are missing; the 0006 cron is not visible to the probe.

## Headline
- RLS is on for every table, and cross-tenant reads and writes are refused (Verified, PGlite). Same-org FK triggers close cross-tenant references.
- Within a tenant, `FOR ALL member` write policies make safety records editable (DB-201). Six status columns have no CHECK (DB-202). Last-owner protection lives only in app code (AUTHZ-201).
- Four invariants are enforced **nowhere**: approver identity on a message (I21), seats (I8), enrollment transitions (I22), every org keeps an owner (I5, app-only and racy).
- Migrations are forward-only, one transaction per file with its ledger row, and safe to re-run (`verify-migrate.ts`). Nothing ties migrate to deploy (PROD-202).

## Invariants

"Test" = the assertion that would fail if the invariant broke. `verify-migrations.ts` = `packages/db/scripts/verify-migrations.ts` (PGlite, non-superuser `authenticated`).

| # | Invariant | Enforced where | Test that would fail | Gap |
|---|---|---|---|---|
| I1 | An org never reads another org's rows | RLS `user_org_ids()` on all 82 tables; views `security_invoker` | verify-migrations "viewer can read their org's companies", "suppressions do not cross tenants", "invitations are not readable across orgs" | none found |
| I2 | A row never references another tenant's row | `enforce_same_org_refs` triggers (DEFINER) on every intra-tenant FK | verify-migrations same-org block | `opportunities.owner_id`, `messages.approved_by/edited_by/rejected_by`, `invitations.invited_by` → `auth.users` have no membership check (app-only, `team/actions.ts:228-241`) → **DB-201** |
| I3 | A removed member loses access at once | `user_org_ids`/`has_org_role` filter `memberships.deleted_at` | verify-migrations role block | JWT stays valid until expiry but grants nothing; OK |
| I4 | A deleted org is unreadable | `user_org_ids` filters `organizations.deleted_at` | verify-migrations "the owner deletes the workspace" | `has_org_role` does **not** check `organizations.deleted_at`: writes and admin RPCs still work in a deleted org (P3, in AUTHZ-203) |
| I5 | Every org keeps ≥1 active owner | **app code only**, check-then-act (`team/actions.ts:85-93,159-164`) | none | DB allows the last owner to demote/remove self; `delete_own_account` counts soft-deleted owners → **AUTHZ-201** |
| I6 | Only an owner grants/removes owner | `guard_membership_owner`, `guard_invitation_owner` (0031/0047) | verify-migrations "an admin cannot make themselves owner/demote an owner/invite an owner" | none |
| I7 | Invitation: unguessable, single-use, expiring, email-bound, confirmed email | `accept_invitation` (0047 final): uuid v4 token (unique), `accepted_at`/`revoked_at`/`expires_at` (14 d default, 0007:135), email compare, `email_confirmed_at` | verify-migrations invitation block | none |
| I8 | Plan limits hold (seats) | **nowhere effective**: `check_quota('seats')` reads a counter nothing writes | none | **AUTHZ-202** |
| I9 | No send to a suppressed address | `can_contact` (DEFINER, service-role) at send time; `record_unsubscribe` | verify-migrations "an unsubscribe suppresses…", "is_suppressed matches…" | any member can DELETE the suppression row (RLS `ALL:member`) → **DB-201** |
| I10 | Suppression survives erasure | `erase_contact` writes hash residue (0037) | verify-migrations "the person stays suppressed afterwards" | holds; but plaintext row also survives → **LIFE-201** |
| I11 | One outbound message per (enrollment, step) | partial unique index, `deleted_at is null` only | verify-migrations "outbound messages are unique per (enrollment, step)" | soft-deleting a sent message frees the slot (P3) |
| I12 | One enrollment per (campaign, opportunity) | unique `(org_id, campaign_id, opportunity_id)` | — | none |
| I13 | Company/opportunity dedupe | unique `(org_id, canonical_domain)`; `(org_id, company_id, icp_id) NULLS NOT DISTINCT` | verify-migrations | `people` has **no** unique key (dedupe is app-side by provider id or name) → race in §5 |
| I14 | Removing a company/opportunity stops its outreach | 0049 triggers (**not live**) + app backstop | verify-migrations 0049 block | hard DELETE by a member bypasses the trigger; queued message stays scheduled → **DB-201** |
| I15 | Provider spend ≤ org cap | `reserve_provider_credit` advisory xact lock (0050, **not live**) | verify-migrations 0050 block | live DB still check-then-call (PROV-015 not live) |
| I16 | Usage counters/rate limits never lose increments | `insert … on conflict do update set used = used + n` | verify-migrations quota block | none |
| I17 | A fact has a source; unknown has no confidence | CHECK on `evidence` | verify-migrations §7 | none |
| I18 | Plan/trial/deleted_at not session-editable | `guard_organization_reserved` | verify-migrations | none |
| I19 | Send counters/warm-up not session-editable | `guard_mailbox_safety` (0049 only, **not live**) | verify-migrations "a signed-in owner cannot reset the warm-up ramp" | live DB: members can reset warm-up (SEC-103 not live) |
| I20 | Mailbox tokens unreadable by sessions | 0049 column grants (**not live**) | none for the connect path | breaks mailbox connect → **DB-203** |
| I21 | Approver identity on a sent message is genuine | **nowhere** (`messages` `ALL:member`, no guard) | none | **DB-201** |
| I22 | Enrollment status transitions legal | app only; `enrollments.status` free text, no CHECK | none | §4 |
| I23 | Retention/purge actually runs | `enforce_retention` daily sweep; pg_cron for `prune_rate_limits`, `prune_provider_cache` | jobs tests (fakes) | `purge_expired_research` has no caller → **LIFE-202**; cron visibility UNVERIFIED |
| I24 | Soft-deleted rows never surface | per-loader `.is('deleted_at', null)` only; RLS read policies ignore `deleted_at` | none central | design choice; noted |

## Races (DB-side concurrency)

| Write path | Interleaving | Result | Closing constraint |
|---|---|---|---|
| Last-owner guard (`setMemberRoleAction`/`removeMemberAction`, `team/actions.ts:85-105,159-170`) | Owners A and B each demote the other: both `countOwners()` = 2, both UPDATE | 0 owners | DB trigger counting remaining active owners `for update` (AUTHZ-201) |
| `delete_own_account` vs a concurrent role change | count of other owners read without lock (0029:228ff) | sole owner leaves | same trigger as above |
| `rank_contacts` inline in first run (`first-run.ts:508`) vs queued `rank_contacts` (`schedule-followups.ts:75-77`, key `contacts:<company>`) | both `select external_ids` → miss → `insert people` (`rank-contacts.ts:366-400`) → upsert `external_ids` (last writer wins) | duplicate `people` row, one orphaned from its provider id; second `contact_points` insert hits unique `(org_id,kind,value)` | unique on `external_ids` already exists; insert person + external id in one RPC, or lock on `(org, provider, provider_id)` (P3, LIKELY) |
| Import dedupe (`imports/actions.ts:270-325`) | select names/emails then insert; two imports at once | duplicate people (emails protected by unique) | a people natural key, or accept (P3) |
| `accept_invitation` twice (same token) | no `for update`; same user both times | idempotent (`on conflict (org_id,user_id)`) | n/a |
| Seat quota (`team/actions.ts:352`) | check-then-insert | moot: the counter is never incremented (AUTHZ-202) | count `memberships` + live invitations inside the RPC |
| Usage/rate counters, `record_contact_send`, `claim_contact_lane`, `reserve_provider_credit` | — | atomic upserts / advisory lock | already closed (0050 parts not live) |

## Table inventory (final state after 0050)

Legend: `member-of` = `org_id in (select user_org_ids())` (any active member of a non-deleted org); `member`/`admin` = `has_org_role(org_id, <role>)` (role ordinal ≤, `deleted_at is null` on membership; **does not check `organizations.deleted_at`**); `self` = `user_id = auth.uid()` + membership; `none` = `using(false)`. RLS is **on for all 82 tables**; no table has `FORCE ROW LEVEL SECURITY` (owner/service role bypass, by design). Table-level grants to `authenticated` are Supabase defaults (SELECT/INSERT/UPDATE/DELETE on every table); the only column-level restriction in the repo is `mailboxes` SELECT (0049:156–169, **not live**).

| Table | org_id | RLS | Policies (cmd:role) | Unique (incl. PK, partial) | FK → ON DELETE | Soft-del | PII |
|---|---|---|---|---|---|---|---|
| activities | not null | on | INS:member(own, manual), SEL:member-of, UPD:member(own)/admin, no DELETE | (id); (org_id, ref_type, ref_id, kind) (partial) | auth.users(set null), companies(cascade), opportunities(cascade), organizations(cascade), people(set null) | yes | body/summary free text |
| ai_decisions | not null | on | SEL:member-of, ALL:member | (id) | organizations(cascade), auth.users(set null), ai_runs(set null) |  | output jsonb (may quote PII) |
| ai_runs | not null | on | SEL:member-of, ALL:member | (id) | organizations(cascade) |  |  |
| attention_snoozes | not null | on | ALL:self | (org_id, user_id, item_key) | organizations(cascade), auth.users(cascade) |  |  |
| audit_logs | not null | on | SEL:admin | (id) | auth.users(set null), organizations(cascade) |  | actor_id, ip, meta |
| campaigns | not null | on | SEL:member-of, ALL:member | (id) | icps(set null), organizations(cascade), products(set null) | yes |  |
| companies | not null | on | INS:member, SEL:member-of, UPD:member | (org_id, canonical_domain); (id) | discovery_runs(set null), companies(set null), organizations(cascade) | yes |  |
| company_competitor_signals | not null | on | SEL:member-of, ALL:member | (id); (org_id, company_id, competitor_id, relationship) | companies(cascade), competitors(cascade), evidence(set null), organizations(cascade) |  |  |
| company_domains | not null | on | SEL:member-of, ALL:member | (org_id, company_id) (partial); (org_id, domain); (id) | companies(cascade), evidence(set null), organizations(cascade) |  |  |
| company_gaps | not null | on | SEL:member-of, ALL:member | (id) | companies(cascade), evidence(set null), organizations(cascade) | yes |  |
| company_merges | not null | on | SEL:member-of, ALL:member | (id) | companies(set null), auth.users(set null), organizations(cascade), companies(cascade) |  |  |
| company_problems | not null | on | SEL:member-of, ALL:member | (id) | companies(cascade), evidence(set null), organizations(cascade) | yes |  |
| company_triggers | not null | on | SEL:member-of, ALL:member | (id) | companies(cascade), evidence(set null), organizations(cascade) | yes |  |
| competitor_evidence | not null | on | SEL:member-of, ALL:member | (org_id, competitor_id, evidence_id, field); (id) | competitors(cascade), evidence(cascade), organizations(cascade) |  |  |
| competitor_profiles | not null | on | SEL:member-of, ALL:member | (org_id, competitor_id); (id) | ai_runs(set null), competitors(cascade), organizations(cascade) |  |  |
| competitors | not null | on | SEL:member-of, ALL:member | (id); (org_id, domain) (partial); (org_id, lower(name)) (partial) | companies(set null), auth.users(set null), organizations(cascade) | yes |  |
| contact_fit_scores | not null | on | SEL:member-of, ALL:member | (id) | icps(set null), icp_versions(set null), organizations(cascade), people(cascade), personas(set null) |  |  |
| contact_frequency | not null | on | SEL:member-of, ALL:member | (org_id, email); (id) | organizations(cascade) |  | email (plaintext) |
| contact_points | not null | on | SEL:member-of, ALL:member | (org_id, kind, value); (id) | organizations(cascade), people(cascade) | yes | email/phone value |
| contact_send_lanes | not null | on | ALL:none | (org_id, address) | organizations(cascade) |  | md5(email) |
| conversation_messages | not null | on | ALL:self | (id) | conversations(cascade), organizations(cascade) |  | free text |
| conversations | not null | on | ALL:self | (id); (org_id, opportunity_id, user_id) | opportunities(cascade), organizations(cascade), products(set null), auth.users(cascade) | yes |  |
| demand_signals | not null | on | SEL:member-of, ALL:member | (id); (org_id, source_type, source_id, statement) | companies(set null), opportunities(set null), organizations(cascade), demand_themes(set null) |  |  |
| demand_state | not null | on | SEL:member-of, ALL:member | (org_id) | organizations(cascade) |  |  |
| demand_themes | not null | on | SEL:member-of, ALL:member | (id) | auth.users(set null), demand_themes(set null), organizations(cascade) |  |  |
| discovery_queries | not null | on | SEL:member-of, ALL:member | (org_id, filters_hash); (id) | auth.users(set null), icps(set null), icp_versions(set null), organizations(cascade) | yes |  |
| discovery_results | not null | on | SEL:member-of, ALL:member | (run_id, provider, provider_id); (id) | companies(set null), organizations(cascade), discovery_queries(set null), discovery_runs(cascade) |  |  |
| discovery_runs | not null | on | SEL:member-of, ALL:member | (id); (query_id) (partial) | organizations(cascade), discovery_queries(set null), auth.users(set null), sources(set null) |  |  |
| enrichment_records | not null | on | SEL:member-of, ALL:member | (id) | organizations(cascade) |  | value/raw provider PII |
| enrollments | not null | on | SEL:member-of, ALL:member | (org_id, campaign_id, opportunity_id); (id) | campaigns(cascade), mailboxes(set null), opportunities(cascade), organizations(cascade) | yes |  |
| events | not null | on | SEL:member-of, ALL:member | (id) | organizations(cascade), auth.users(set null) |  |  |
| evidence | not null | on | SEL:member-of, ALL:member | (id); (org_id, subject_type, subject_id, field, COALESCE((source_id)::text, ''::text), COALESCE(source_url, ''::text)) (partial); (org_id, subject_type, subject_id, field, live_source_key) | organizations(cascade), sources(set null), evidence(set null) | yes |  |
| evidence_citations | not null | on | SEL:member-of | (id); (org_id, evidence_id, COALESCE((source_id)::text, ''::text), COALESCE(source_url, ''::text)) | evidence(cascade), organizations(cascade), sources(set null) |  |  |
| external_ids | not null | on | SEL:member-of, ALL:member | (org_id, provider, provider_id); (id) | organizations(cascade) |  |  |
| hubspot_connections | not null | on | SEL:admin, ALL:admin | (id); (org_id) | auth.users(set null), organizations(cascade) |  | access_token |
| human_overrides | not null | on | SEL:member-of, ALL:member | (id) | auth.users(set null), learning_runs(set null), organizations(cascade), opportunity_scores(set null) |  |  |
| icp_versions | not null | on | SEL:member-of | (org_id, icp_id, version); (id) | auth.users(set null), icps(cascade), organizations(cascade) |  |  |
| icps | not null | on | SEL:member-of, ALL:member | (id) | icp_versions(set null), organizations(cascade), products(set null) | yes |  |
| invitations | not null | on | ALL:admin | (org_id, lower(email)) (partial); (id); (token) | auth.users(set null), organizations(cascade) |  | invitee email |
| job_executions | nullable | on | SEL:member-of | (id); (job_name, idempotency_key, org_id) NULLS NOT DISTINCT (partial) | organizations(cascade) |  |  |
| join_requests | not null | on | ALL:admin | (id); (org_id, user_id) (partial) | auth.users(set null), organizations(cascade), auth.users(cascade) |  | requester email |
| learning_findings | not null | on | SEL:member-of, ALL:member | (id) | auth.users(set null), organizations(cascade), learning_runs(cascade) |  |  |
| learning_runs | not null | on | SEL:member-of, ALL:member | (id); (org_id) (partial) | ai_runs(set null), organizations(cascade), auth.users(set null) | yes |  |
| mailboxes | not null | on | SEL:member-of, ALL:member | (id); (org_id, email) | organizations(cascade) | yes | email + encrypted OAuth tokens |
| memberships | not null | on | SEL:member-of, ALL:admin | (org_id, user_id); (id) | auth.users(set null), organizations(cascade), auth.users(cascade) | yes |  |
| memories | not null | on | SEL:admin, ALL:self, ALL:member | (id) | auth.users(set null), organizations(cascade), memories(set null) | yes | free text |
| memory_evidence | not null | on | DEL:self, SEL:self | (memory_id, signal_id) | memories(cascade), organizations(cascade), preference_signals(cascade), auth.users(cascade) |  |  |
| merge_candidates | not null | on | SEL:member-of, ALL:member | (id); (org_id, company_a_id, company_b_id) | companies(cascade), auth.users(set null), organizations(cascade) |  |  |
| message_events | not null | on | SEL:member-of | (id) | messages(cascade), organizations(cascade) |  | payload (webhook bodies) |
| message_unsubscribe_tokens | not null | on | ALL:none | (message_id); (token) | messages(cascade), organizations(cascade) |  |  |
| messages | not null | on | SEL:member-of, ALL:member | (enrollment_id, step_id) (partial); (id) | auth.users(set null), contact_fit_scores(set null), enrollments(set null), mailboxes(set null), opportunities(set null), organizations(cascade), sequence_steps(set null), threads(set null) | yes | to/from email, subject, bodies |
| notification_preferences | not null | on | ALL:self | (org_id, user_id) | organizations(cascade), auth.users(cascade) |  |  |
| opportunities | not null | on | SEL:member-of, ALL:member | (org_id, company_id, icp_id) NULLS NOT DISTINCT; (id) | companies(cascade), icps(set null), auth.users(set null), organizations(cascade), people(set null) | yes |  |
| opportunity_scores | not null | on | SEL:member-of, ALL:member | (id) | icp_versions(set null), opportunities(cascade), organizations(cascade) |  |  |
| organizations | — | on | SEL:member-of, UPD:admin | (id); (slug) | plans(no action) | yes |  |
| outcomes | not null | on | SEL:member-of, ALL:member | (id) | campaigns(set null), competitors(set null), opportunities(set null), organizations(cascade), people(set null), auth.users(set null), opportunity_scores(set null) |  | reason free text |
| people | not null | on | SEL:member-of, ALL:member | (id) | companies(cascade), organizations(cascade), personas(set null) | yes | names, linkedin_url, departed_note |
| personas | not null | on | SEL:member-of, ALL:member | (id) | icps(cascade), organizations(cascade) | yes |  |
| plans | — | on | SEL:public | (id) |  |  |  |
| preference_signals | not null | on | DEL:self, INS:self, SEL:self | (id) | organizations(cascade), auth.users(cascade) |  | user behaviour |
| preference_state | not null | on | ALL:self | (org_id, user_id) | organizations(cascade), auth.users(cascade) |  |  |
| products | not null | on | SEL:member-of, ALL:member | (id) | organizations(cascade) | yes |  |
| profiles | — | on | SEL:member, UPD:self | (id) | auth.users(cascade) |  | email, full_name, avatar |
| provider_accounts | not null | on | SEL:member-of, ALL:admin | (org_id, capability); (id) | organizations(cascade) | yes |  |
| provider_breakers | not null | on | SEL:member-of | (org_id, provider); (id) | organizations(cascade) |  |  |
| provider_cache | not null | on | SEL:member-of | (org_id, request_hash); (id) | organizations(cascade) |  | body/raw provider responses (person lookups) |
| provider_calls | not null | on | SEL:member-of | (id) | organizations(cascade) |  |  |
| public_research | — | on | (none: service-role only) | (id); (canonical_domain) | auth.users(set null), organizations(set null) |  | ip_hash |
| public_research_attempts | — | on | (none: service-role only) | (id) |  |  | ip_hash |
| rate_limits | not null | on | SEL:member-of | (org_id, action, window_start) (partial); (id); (org_id, user_id, action, window_start) (partial) | organizations(cascade), auth.users(cascade) |  | user_id |
| score_recompute_requests | not null | on | UPD:member, SEL:member-of | (org_id, COALESCE((icp_id)::text, ''::text)) (partial); (id) | icps(cascade), organizations(cascade), auth.users(set null) |  |  |
| scoring_rules | not null | on | SEL:member-of, ALL:member | (id) | auth.users(set null), icps(cascade), organizations(cascade) | yes |  |
| sequence_steps | not null | on | SEL:member-of, ALL:member | (org_id, sequence_id, "position"); (id) | organizations(cascade), sequences(cascade) | yes |  |
| sequences | not null | on | SEL:member-of, ALL:member | (id) | campaigns(cascade), organizations(cascade) | yes |  |
| source_documents | not null | on | SEL:member-of, ALL:member | (id); (org_id, content_hash); (org_id, url_hash) (partial) | organizations(cascade), sources(cascade) |  |  |
| source_events | not null | on | SEL:member-of, ALL:member | (id) | companies(cascade), organizations(cascade), source_documents(cascade) |  |  |
| sources | not null | on | SEL:member-of, ALL:member | (id) | icps(set null), organizations(cascade) | yes |  |
| subscriptions | not null | on | SEL:member-of | (id); (stripe_sub_id) | organizations(cascade) | yes |  |
| suppressions | not null | on | SEL:member-of, ALL:member | (org_id, kind, value); (id) | organizations(cascade) |  | email plaintext (unsubscribe) / sha256 (erasure) |
| threads | not null | on | SEL:member-of, ALL:member | (org_id, mailbox_id, provider_thread_id) (partial); (id) | auth.users(set null), mailboxes(set null), opportunities(set null), organizations(cascade) | yes | participants, subject |
| usage_counters | not null | on | SEL:member-of | (org_id, period, metric); (id) | organizations(cascade) |  |  |
| user_questions | not null | on | ALL:self | (id); (org_id, user_id, question_key) | memories(set null), organizations(cascade), auth.users(cascade) |  | free text |

Notes on the inventory:
- `ALL:member` policies (most tenant tables) include **DELETE**: a member can hard-delete `opportunities`, `people`, `messages`, `evidence`, `suppressions`, `enrollments`, `threads`, etc. through PostgREST, bypassing the soft-delete triggers that hang off `deleted_at` (`opportunities_stop_outreach`, `companies_propagate_removal`). `companies` is the only core table without a DELETE policy (I/S/U only, 0031).
- Tables with no write policy (service-role only writes): `audit_logs`, `evidence_citations`, `icp_versions`, `job_executions`, `message_events`, `plans`, `provider_*`, `rate_limits`, `subscriptions`, `usage_counters`, `public_research*`; `contact_send_lanes` and `message_unsubscribe_tokens` have an explicit `using(false)`.
- Doc drift: `docs/security/tenancy-and-permissions.md` says `audit_logs` is "read within org"; the policy is `has_org_role(org_id,'admin')` (admins only). The doc's "236 migration-level checks" is stale (lead measured 383).

## Functions and triggers

All 118 `public` functions resolved. **Every `SECURITY DEFINER` function (≈80) has a pinned `search_path` (`public, pg_catalog`; `delete_own_account` adds `auth`; `merge_duplicate_evidence` uses `public, pg_temp` with pg_temp explicitly last, which is safe).** `touch_updated_at()` has no `search_path` but is INVOKER and references only `now()`: harmless.

Execution surface for `anon`/`authenticated` (Supabase default privileges grant EXECUTE on every new function to both; migrations revoke from the internal half, e.g. 0009:159–175, 0031:86ff, 0046):

| Callable by anon+authenticated (DEFINER) | Internal gate (checked in body) |
|---|---|
| `accept_invitation(token)` | `auth.uid()` not null; token live (unaccepted, unrevoked, unexpired); caller email = invitation email (case-insensitive); `email_confirmed_at` not null |
| `delete_organization` | `has_org_role(p_org,'owner')` |
| `delete_own_account` | `auth.uid()`; sole-owner block (bug: see AUTHZ-201) |
| `export_organization`, `export_contact_for_org`, `erase_contact_for_org`, `retry_job`, `cancel_job`, `bump_icp_version_for_org` | `has_org_role(…,'admin')` |
| `record_override`, `merge_companies_for_org`, `increment_usage` | `has_org_role(…,'member')` (+ metric allowlist for `increment_usage`) |
| `write_audit_log`, `consume_rate_limit`, `check_quota`, `backlog_state_for_org`, `provider_budget_for_org`, `org_has_hubspot` | active membership |
| `record_unsubscribe(token)` | token lookup only (intended public path) |
| `user_org_ids`, `has_org_role`, `co_member_ids` | scoped to `auth.uid()` |
| Trigger functions (`guard_*`, `project_*`, `handle_new_user`, `enforce_same_org_refs`, `issue_unsubscribe_token`, `enqueue_company_followups`) | `RETURNS trigger`: cannot be invoked via RPC |

| Authenticated only | Gate |
|---|---|
| `create_organization` | `auth.uid()`; slug regex; ≤20 owned orgs |
| `request_to_join`, `discoverable_workspaces` | `auth.uid()`; domain match |
| `approve_join_request` (INVOKER) | RLS on `join_requests`/`memberships` → admin |
| `advance_onboarding`, `request_score_recompute`, `claim_research` | membership/role checks in body |
| `claim_mailbox_send`, `mailbox_daily_cap`, `mailbox_remaining_today` (INVOKER) | RLS; `guard_mailbox_safety` blocks a session from moving `sent_today` |

Service-role only (revoked from anon/authenticated): `erase_contact`, `export_contact`, `merge_companies`, `claim_*`, `reserve/settle_provider_credit`, `record_provider_call`, `record_contact_send/reply`, `claim/release_contact_lane`, `prune_*`, `purge_expired_research`, `requeue_stalled_jobs`, `can_contact`, `usage_limit`, `write_audit_log_internal`, etc. Verified with `has_function_privilege` in the PGlite catalog.

Triggers (128): `touch_updated_at` on every mutable table; `enforce_same_org_refs` (DEFINER) on every table with intra-tenant FKs (cross-tenant FK smuggling closed in DB); guards: `guard_membership_owner`, `guard_invitation_owner`, `guard_organization_reserved` (plan/trial/deleted_at/created_at immutable to sessions), `guard_mailbox_safety` (warm-up/domain/send counters), `guard_activity_authorship`; propagation: `companies_propagate_removal` (0049, **not live**), `opportunities_stop_outreach` (0049, **not live**), `companies_enqueue_followups` (0050, **not live**); `on_auth_user_created` on `auth.users` (AFTER INSERT OR UPDATE → `handle_new_user`, upserts `profiles`). **No guard trigger on `messages`, `suppressions`, `enrollments` or `memberships` beyond the owner-role rule** (see DB-201, DB-202, AUTHZ-201).

