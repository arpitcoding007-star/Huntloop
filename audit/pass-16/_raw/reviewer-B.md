# Pass 16 — Reviewer B (db · authz · lifecycle)

status: COMPLETE (all sections written)

Audited commit: `7e09759` (feat/pass-15-audit-fixes). Read-only. Method: every migration `0001`–`0050` applied in order to an in-memory PGlite (scratch script outside the repo) with Supabase-like roles (`anon`, `authenticated`, `service_role` BYPASSRLS) and Supabase's default privileges (ALL on new tables/functions to anon/authenticated/service_role), then the **final** state was read from the catalog (`pg_class`, `pg_policies`, `pg_constraint`, `pg_proc`, `pg_trigger`). So every statement below is about the resolved definition after all later migrations, not an individual file. Repros were run as a non-superuser (`set local role authenticated` + `request.jwt.claim.sub`), the same way PostgREST does.

Counts: 50 numbered migration files (`0001`–`0050`) + `COMBINED-0024-0027.sql` (convenience paste, excluded by the test filter `^\d{4}_.+\.sql$`, `packages/db/scripts/verify-migrations.ts:115`). No `pending-migrations.sql` exists anywhere in the repo. Final schema: **82 tables, 9 views (all `security_invoker=true`), 142 policies, 219 FKs, 166 CHECKs, 118 functions, 128 triggers, 10 enums.** Configured DB (lead's doctor run): 0001–0047 applied, **0048/0049/0050 missing**.

## 1. Table inventory (final state after 0050)

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

## 2. Functions and triggers

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

## 3. Invariants

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

## 4. DB-enforced state machines

| Column | States (code) | DB enforcement | Who can transition (session) | Terminal | Stuck-state recovery |
|---|---|---|---|---|---|
| `opportunities.status` | enum `opportunity_status` (11) | enum values only; **no transition rule** | any member, any → any (RLS `ALL:member`) | won/lost/archived (convention) | n/a |
| `memberships.role` | enum `org_role` | `guard_membership_owner` for owner edges only | admin (non-owner edges), owner | — | ownerless org: manual SQL only (AUTHZ-201) |
| `memberships.deleted_at` | active/removed | `guard_membership_owner` (owner rows) | admin; re-activated by `accept_invitation`/`approve_join_request` | — | — |
| `organizations.deleted_at` | live/deleted | `guard_organization_reserved` (sessions cannot touch); `delete_organization` owner-only | owner via RPC | deleted (no restore path, no hard purge) | manual SQL |
| `invitations` (timestamps) | live/accepted/revoked/expired | `accept_invitation` predicate; partial unique on live `(org, lower(email))` | admin (create/revoke), invitee (accept) | accepted/revoked/expired | re-invite |
| `join_requests.status` | pending/approved/declined | CHECK + partial unique pending | admin | approved/declined | — |
| `enrollments.status` | active/parked/stopped/replied/completed (code) | **none: free text, no CHECK** | any member, any → any (incl. stopped → active after unsubscribe) | stopped (convention) | — |
| `mailboxes.status` | connected/disconnected/paused/error (code) | **no CHECK** | any member | — | reconnect |
| `job_executions.status` | queued/running/succeeded/failed/cancelled | **no CHECK**; claim via `for update skip locked` | service role; admins via `retry_job`/`cancel_job` | succeeded/failed/cancelled | `requeue_stalled_jobs` |
| `campaigns.status`, `threads.status`, `threads.classification`, `ai_runs.status`, `subscriptions.status` | free text | **no CHECK** | member (campaigns/threads) | — | — |
| `discovery_runs`, `learning_runs`, `score_recompute_requests`, `merge_candidates`, `learning_findings`, `memories`, `competitors`, `demand_themes`, `user_questions` `.status` | CHECK enumerations | values only; `score_recompute_requests` session may only move pending/running → cancelled (policy `tenant_cancel`) | per table | per CHECK | partial-unique "one live run" indexes |
| `messages` (implicit: draft → approved → scheduled → attempted → sent / rejected / error) | timestamps + `approved_by` | **none** (no CHECK linking `sent_at`/`approved_by`/`rejected_at`) | any member can set/clear any of them | sent | `send_attempted_at` claim (0033) |

Transitions enforced only in app code: all `opportunities.status`, `enrollments.status`, `messages` lifecycle, last-owner. States with no exit: an ownerless org; a soft-deleted org (no restore, no purge).

## 5. Races (DB-side concurrency)

| Write path | Interleaving | Result | Closing constraint |
|---|---|---|---|
| Last-owner guard (`setMemberRoleAction`/`removeMemberAction`, `team/actions.ts:85-105,159-170`) | Owners A and B each demote the other: both `countOwners()` = 2, both UPDATE | 0 owners | DB trigger counting remaining active owners `for update` (AUTHZ-201) |
| `delete_own_account` vs a concurrent role change | count of other owners read without lock (0029:228ff) | sole owner leaves | same trigger as above |
| `rank_contacts` inline in first run (`first-run.ts:508`) vs queued `rank_contacts` (`schedule-followups.ts:75-77`, key `contacts:<company>`) | both `select external_ids` → miss → `insert people` (`rank-contacts.ts:366-400`) → upsert `external_ids` (last writer wins) | duplicate `people` row, one orphaned from its provider id; second `contact_points` insert hits unique `(org_id,kind,value)` | unique on `external_ids` already exists; insert person + external id in one RPC, or lock on `(org, provider, provider_id)` (P3, LIKELY) |
| Import dedupe (`imports/actions.ts:270-325`) | select names/emails then insert; two imports at once | duplicate people (emails protected by unique) | a people natural key, or accept (P3) |
| `accept_invitation` twice (same token) | no `for update`; same user both times | idempotent (`on conflict (org_id,user_id)`) | n/a |
| Seat quota (`team/actions.ts:352`) | check-then-insert | moot: the counter is never incremented (AUTHZ-202) | count `memberships` + live invitations inside the RPC |
| Usage/rate counters, `record_contact_send`, `claim_contact_lane`, `reserve_provider_credit` | — | atomic upserts / advisory lock | already closed (0050 parts not live) |

## 6. AuthZ

### Role matrix vs enforcement (final DB state)

| Action | Doc (tenancy-and-permissions.md) | DB enforcement | App enforcement | Verdict |
|---|---|---|---|---|
| Read tenant data | all roles | `user_org_ids()` | layout `notFound()` | match |
| Work with opportunities | member+ | `has_org_role(…,'member')` | `mutate()` minRole | match |
| Change members | admin+ | `membership_write` admin + owner guard | `minRole:"admin"` + `canOwn` | match, except last-owner (AUTHZ-201) |
| Integrations (HubSpot) | admin+ | `hubspot_connections` admin | — | match |
| Integrations (mailboxes) | admin+ ("change the org, members, integrations") | **`mailboxes.tenant_write` member** | member | **doc/DB mismatch**: a member can connect/disconnect/edit mailboxes (P3, in DB-201 notes) |
| Provider accounts | admin+ | `provider_accounts` write admin; **read member-of** | — | ok (no secret columns) |
| Suppression list edits | not stated; compliance doc says suppression is the record of objection | `ALL:member` incl. DELETE | no UI | DB-201 |
| Erase / export contact, export org, retry/cancel job | admin | DEFINER wrappers check admin | `minRole:"admin"` | match |
| Delete workspace | owner | `delete_organization` owner | — | match |
| Audit log | doc: "read within org" | admin-only SELECT | — | doc drift |

### Sessions, invites, OAuth

| Check | Finding | Evidence |
|---|---|---|
| Session cookies | `@supabase/ssr` defaults: `path=/`, `SameSite=Lax`, `httpOnly=false`, `maxAge` 400 days, no explicit `Secure` (node_modules/@supabase/ssr/dist/main/utils/constants.js:4-11); no custom `cookieOptions` passed. httpOnly=false is the library design (browser client reads it) but means any XSS can lift the session (P3, AUTHZ-203) | `packages/db/src/server.ts:23-31` |
| Logout | POST only; `supabase.auth.signOut()` default scope = global → refresh tokens revoked; access JWT valid to expiry (Supabase default 1 h) but RLS re-checks membership per request | `app/auth/signout/route.ts` |
| Privilege change / removal | effective on next request (RLS reads `memberships` live); no session rotation needed | `user_org_ids`, `has_org_role` |
| Enumeration on login | one generic error for every OTP failure; success copy identical | `app/(auth)/actions.ts:96-115` |
| Password reset | none (magic link + Google only) | n/a |
| OAuth state/PKCE | `@supabase/ssr` forces `flowType: "pkce"` (createServerClient.js:29); `exchangeCodeForSession(code)`; `next` validated by `safeNextPath` (rejects `//`, `\`, control chars, non-`/`) | `app/auth/callback/route.ts`, `lib/safe-next.ts` |
| Invite token | `gen_random_uuid()` (122 bits), unique, 14-day expiry, single-use, email-bound, confirmed email required; readable by admins (credential-equivalent, bound to an address) | 0007:133-135, `accept_invitation` final (0047) |
| Invite accept error messages | distinguish "no longer valid" vs "different email": not an oracle at 122-bit entropy | `invite/[token]/actions.ts` |
| Last-owner protection | app-only and racy; DB permits; `delete_own_account` counts soft-deleted owners | AUTHZ-201 (repro in §8) |
| Removed member | loses access immediately (RLS); open sessions get empty results; jobs are org-scoped not user-scoped; no share-link feature found (`grep share` in app routes: none) | — |
| Suspended/deleted user | `delete_own_account` hard-deletes `auth.users`; cascades memberships/profiles/personal tables | LIFE-203 for what survives |

## 7. Lifecycle and privacy

### Delete behaviour

| Entity | Delete path | Kind | Cascade reach | Orphans / residue |
|---|---|---|---|---|
| Organization | `delete_organization` (owner) | soft (`deleted_at`) + stop campaigns/enrollments/sources/queries | none (rows kept) | **all tenant data kept indefinitely; no hard purge, no restore** (LIFE-204) |
| User account | `delete_own_account` | hard (`auth.users`) | cascade: memberships, profiles, conversations→conversation_messages, attention_snoozes, join_requests, memory_evidence, notification_preferences, preference_signals/state, rate_limits, user_questions; set null: actor/approver/owner columns | `memories` with `scope='user'` keyed by `scope_id` (not an FK) survive with the deleted user's private notes (LIFE-203) |
| Member removal | soft (`memberships.deleted_at`) | soft | none | intended (keeps attribution) |
| Company | soft; 0049 trigger soft-deletes opportunities (**not live**) | soft | opps (0049) | merged: evidence re-pointed (0049) |
| Opportunity | soft; 0049 trigger stops enrollments, unschedules mail (**not live**); **hard DELETE allowed to members** | soft/hard | hard: enrollments cascade; messages set null and stay scheduled | DB-201 |
| Mailbox | soft + token nulling (`outreach/actions.ts:281-292`) | soft | — | — |
| Contact (erasure) | `erase_contact[_for_org]` | mixed | see below | LIFE-201 |

### PII inventory (by table/column) and erasure reach

| Table.column | PII | `erase_contact` handles? |
|---|---|---|
| `contact_points.value` | email/phone | deleted (email kind only; **phone/linkedin of the same person kept**) |
| `people.first_name,last_name,linkedin_url,departed_note` | name | nulled + soft-deleted; `title`, `seniority`, `department` kept |
| `messages.subject/body_*/to_email/from_email` | content, address | redacted / hashed |
| `enrichment_records.value/raw` | provider PII | deleted for matched people |
| `activities.body/summary` (manual) | free text | redacted; **trigger/backfill activities untouched** |
| `demand_signals` | quotes from replies/notes | deleted via `demand_forget_erased` trigger |
| `suppressions.value` (kind email, from `record_unsubscribe`) | **plaintext address** | **kept** (only a hash row is added) |
| `contact_frequency.email` | **plaintext address** | **kept** |
| `threads.participants`, `threads.subject` | addresses, subject | **kept** |
| `message_events.payload` | webhook/reply payloads | **kept** |
| `provider_cache.body/raw` | person-lookup responses | **kept** (pruned only by pg_cron `prune_provider_cache`, schedule UNVERIFIED) |
| `conversation_messages.content`, `memories`, `ai_decisions.output`, `outcomes.reason` | free text that can name the person | **kept** |
| `job_executions.payload/result` | `purge_contact_data` would store the email in plaintext (`purge-contact-data.ts:67-69`) | job has no producer (dead) |
| `audit_logs.meta` | sha256 of address | by design |
| HubSpot (external) | contact copies | **not propagated** (no CRM delete call) |
| AI provider logs (Anthropic), Sentry | prompts/errors | out of DB reach; not addressed |
| `ai_runs` | no prompt/output text stored (hash only) | n/a — good |

### Retention actually scheduled

| Mechanism | Trigger | Live? |
|---|---|---|
| `enforce_retention` → `prune_stale_contacts` per org with `contact_retention_days` | tick sweep, DAILY idempotency key (`runner.ts:238,306`) | depends on a tick driver (prod: none, per lead); `limit(50)` with no order/cursor (`enforce-retention.ts:58-63`) → orgs beyond 50 never pruned (P3, in LIFE-202) |
| `prune_job_executions` (30 d) | called by `enforce_retention` | **0049, not live** (call fails and is reported) |
| `prune_rate_limits` | pg_cron 03:17 (0006) | cron schedule not visible to doctor: UNVERIFIED |
| `prune_provider_cache` | pg_cron (0011:442-472) | UNVERIFIED (same) |
| `purge_expired_research` (public_research, 30 d expiry) | **nothing calls it, no cron** | **never runs** (LIFE-202) |
| `public_research_attempts` (ip_hash) | **no purge at all** | grows forever |

### Export completeness

`export_organization` (admin): org, members (role/date only), icps, products, companies, opportunities, activities, memories; **evidence, messages, people, ai_runs only as counts** (the function says so in its `note`). No export of contact_points, sequences/campaigns, scoring rules, suppressions, outcomes. `export_contact` (0037) covers the person, contact points, messages and activities. Partial by design and labelled; recorded as Partial in §9.

### Migration DR

50 forward-only files; no down migrations; 25 files use bare `create table` (not re-runnable; `migrate.ts` ledger `schema_migrations` + `--single-transaction` per file prevents double-apply; `MIGRATIONS_BASELINE` for hand-migrated DBs). Rollback = write a new forward migration. Configured DB lacks 0048–0050: every 0048–0050 fix is "Fixed in repo, not live". Applying 0049 as-is breaks mailbox connect (DB-203) — fix before applying.

## 8. Findings

Repro harness for every CONFIRMED DB item: all 50 migrations applied to PGlite (real Postgres semantics), Supabase roles + default privileges emulated, statements run as `set local role authenticated` with `request.jwt.claim.sub` set (= PostgREST). Scratch scripts lived outside the repo.

### [High] DB-203: Applying 0049 breaks mailbox connect (PostgREST upsert needs SELECT on the revoked token columns)
- Confidence: CONFIRMED (PGlite repro of the exact statement shape PostgREST emits). Live today: no (0049 unapplied) — it breaks the moment 0049 is applied.
- Where: `packages/db/migrations/0049_soft_delete_propagation.sql:159-169` (revoke table SELECT, re-grant every column except `oauth_token_enc`, `refresh_token_enc`); `apps/web/app/api/mailboxes/[provider]/callback/route.ts:117,140-163` (`getDb()` session client → `.upsert(row, { onConflict: "org_id,email" })` with both token columns in `row`); `apps/web/lib/data/source.ts:47-63` (getDb = tenant client, role `authenticated`).
- Evidence: as `authenticated` member after 0001–0050: `insert into mailboxes (…, oauth_token_enc, refresh_token_enc …) values (…) on conflict (org_id,email) do update set oauth_token_enc = excluded.oauth_token_enc, …` → `permission denied for table mailboxes`, on the **first** connect as well as a reconnect (privilege checked at plan time). Control cases: plain INSERT with token columns OK; `UPDATE … SET oauth_token_enc = …` OK; upsert without token columns OK.
- Trace/repro: user clicks Connect Gmail → `/api/mailboxes/gmail/callback` → token exchange → `encryptSecret` → session upsert → error → redirect with "That mailbox could not be saved: permission denied for table mailboxes".
- Impact: Reach Out stage — no mailbox can be connected or reconnected on a DB with 0049, so no sends; the pass-15 SEC-102 fix lands as an outage. Tenant: all. Prod: yes once migrated.
- Root cause: column-level SELECT revoke on a table the app writes with `INSERT … ON CONFLICT DO UPDATE SET col = EXCLUDED.col`, which requires SELECT on every updated column.
- Fix: in the callback, replace the upsert with `update … where org_id = ? and email = ?` and, if 0 rows, `insert` (both work with the 0049 grants); or move the write into a `SECURITY DEFINER connect_mailbox(...)` RPC that checks `has_org_role`. Keep 0049's revoke. Touches only the callback route.
- Acceptance criteria: with 0049 applied, a member connects a new mailbox and reconnects an existing one; `select oauth_token_enc from mailboxes` as `authenticated` still fails.
- Test to add: `packages/db/scripts/verify-migrations.ts` — "a session can upsert a mailbox with token columns (PostgREST shape) but cannot read them"; plus a route test in `apps/web/test/` driving the callback with a fake provider.
- Effort: S · Depends on: none (must land before 0049 is applied) · Mechanizable: yes (verify-migrations assertion).
- Status vs last pass: New (regression introduced by the SEC-102 fix).

### [High] DB-201: `tenant_write FOR ALL member` lets any member undo safety records: delete suppressions, forge approvals, and hard-delete around the stop-outreach triggers
- Confidence: CONFIRMED in PGlite (final policies + Supabase default grants); LIKELY on the configured Supabase (settle with `select has_table_privilege('authenticated','public.suppressions','DELETE'), has_table_privilege('authenticated','public.messages','UPDATE')` there — nothing in the repo revokes them).
- Where: policies `suppressions.tenant_write`, `messages.tenant_write`, `opportunities.tenant_write`, `enrollments.tenant_write` (ALL, `has_org_role(org_id,'member')`; created 0004, unchanged through 0050); no guard trigger on `suppressions`, `messages`, `enrollments` (§2); `packages/jobs/src/handlers/schedule-sends.ts:52-58` (picks any outbound, unsent, unerrored, undeleted message with `scheduled_at`).
- Evidence (as a member, via the same path PostgREST uses):
  - `delete from suppressions where org_id=A returning value` → ACCEPTED (`x@y.test`, an `unsubscribe` row). `can_contact` then has nothing to match.
  - `insert into messages (… direction 'outbound', to_email, scheduled_at now(), approved_by '<user of another tenant>')` → ACCEPTED.
  - `update messages set approved_by = '<owner id>'` → ACCEPTED (approver identity forged).
  - `delete from opportunities where id = …` → ACCEPTED; its approved message is left with `opportunity_id null, enrollment_id null, scheduled_at` set, `error null` → still eligible for `schedule_sends`. The 0049 trigger (`opportunities_stop_outreach`) only fires on `UPDATE OF deleted_at`.
  - `enrollments.status` can be moved `stopped → active` (free text, no guard).
- Trace/repro: browser holds the anon key (public) and the member's JWT → `supabase.from('suppressions').delete().eq('org_id', …)` → row gone → next send to that address passes `can_contact`.
- Impact: legal (send after unsubscribe), audit integrity (who approved a send), outreach that the UI believes stopped. Requires a member acting outside the UI, so High rather than Critical; no UI path does this.
- Root cause: write policies are role-only (`FOR ALL`) on tables whose rows encode consent and approval, with no per-command split and no transition guards; DELETE is granted where the product contract is soft delete.
- Fix: split `tenant_write` on `suppressions` into INSERT-only for sessions (no UPDATE/DELETE; removal via an admin-only audited RPC if ever needed); on `messages` add a `guard_message_integrity` trigger (sessions may not set `approved_by`/`rejected_by`/`edited_by` to anyone but `auth.uid()`, may not set `sent_at`/`send_attempted_at`/`provider_message_id`, may not insert with `scheduled_at`); drop DELETE for sessions on `opportunities`, `messages`, `people`, `enrollments` (as 0031 did for `companies`); CHECK on `enrollments.status`. One migration.
- Acceptance criteria: as `authenticated` member each statement above is rejected; UI flows (approve, reject, edit, remove opportunity) still pass.
- Test to add: `verify-migrations.ts` — "a member cannot delete a suppression", "a member cannot set approved_by to someone else", "a member cannot hard-delete an opportunity".
- Effort: M · Depends on: none · Mechanizable: yes (policy lint: no `FOR ALL` on an allowlist of safety tables).
- Status vs last pass: New (extends SEC-101/FLOW-101: the 0049 fix is bypassable by hard delete).

### [Medium] AUTHZ-201: "Every org keeps an owner" is app-only and racy; the DB lets the last owner leave, and `delete_own_account` counts soft-deleted owners
- Confidence: CONFIRMED (PGlite repro).
- Where: `apps/web/app/(app)/[org]/team/actions.ts:85-93,159-164,173-186` (check-then-act `countOwners`); `guard_membership_owner` (final def 0047_security_leads.sql; first 0031) returns early when the caller is an owner; `delete_own_account` (0029:228ff) subquery `m2.role = 'owner' and m2.user_id <> v_user` has **no `m2.deleted_at is null`**.
- Evidence: sole active owner `update memberships set role='admin' where user_id = auth.uid()` → ACCEPTED, active owners = 0. With a second owner whose membership is soft-deleted, `select delete_own_account()` as the only active owner → ACCEPTED; org remains with `deleted_at null` and 0 active owners.
- Trace/repro: two owners each demote the other concurrently through the Team page → both reads see 2 owners → 0 owners. Or remove owner B (soft delete), then owner A deletes their account.
- Impact: tenant locked out of every owner-only action (delete workspace, grant owner; `guard_invitation_owner` stops admins inviting an owner). Recovery is manual SQL by the operator.
- Root cause: the invariant lives in the UI layer; the DB guard asks "is the caller an owner", never "will one remain".
- Fix: in `guard_membership_owner`, on UPDATE/DELETE that removes an active owner, `perform 1 from memberships where org_id = v_org and role='owner' and deleted_at is null for update` and raise if none would remain (skip when the org itself is deleted); add `and m2.deleted_at is null` in `delete_own_account`.
- Acceptance criteria: both repros rejected; deleting a workspace then the account still works.
- Test to add: `verify-migrations.ts` — "the last active owner cannot demote or remove themselves", "delete_own_account ignores soft-deleted co-owners".
- Effort: S · Depends on: none · Mechanizable: yes.
- Status vs last pass: New.

### [Medium] AUTHZ-202: The seats limit is never enforced (counter nothing writes)
- Confidence: CONFIRMED.
- Where: `apps/web/app/(app)/[org]/team/actions.ts:352-355` → `check_quota('seats')` → `check_quota_internal` reads `usage_counters` row `metric='seats'` for the current month; `grep` for any writer of metric `seats` across `apps/` and `packages/`: none (`increment_usage` allowlists only `ai_runs`; `increment_usage_internal` callers: `ai.ts:177`, `enrich-person.ts:117,189`, `score-opportunity.ts:286`, `send-message.ts:529`). `approve_join_request` and `accept_invitation` never check seats.
- Evidence: `used` is always 0 → `allowed = 0 < 2` on Free. `docs/security/tenancy-and-permissions.md` ("`inviteMemberAction` enforces the `seats` quota; it is one of only two plan limits actually enforced") is false.
- Impact: plan limits/billing (money): unlimited members on any plan; the billing screen shows "0 of 2 seats".
- Root cause: seats were modelled as a monthly metered counter rather than a count of current memberships.
- Fix: compute seats in SQL as `count(memberships where deleted_at is null) + count(live invitations)` and check it inside `accept_invitation`/`approve_join_request` (and the invite action); stop reading `usage_counters` for `seats`.
- Acceptance criteria: on Free, a third invite/accept/approval is refused with the quota message.
- Test to add: `verify-migrations.ts` — "a third member cannot join a Free workspace by invite or by join request".
- Effort: S · Depends on: none · Mechanizable: yes.
- Status vs last pass: New.

### [Medium] LIFE-201: Contact erasure leaves the address and other PII in eight places
- Confidence: CONFIRMED (final `erase_contact` = 0037:693ff; column inventory from the catalog).
- Where: `erase_contact` touches only `suppressions` (adds hash), `contact_points` (email kind), `messages`, `enrichment_records`, manual `activities`, `people` names. Survivors: `suppressions.value` plaintext rows written by `record_unsubscribe` (0047 final: `values (…, lower(v_msg.to_email), …)`); `contact_frequency.email`; `threads.participants`/`subject`; `message_events.payload`; `provider_cache.body/raw`; the person's phone/linkedin `contact_points`; trigger/backfill `activities`; free text in `conversation_messages`, `memories`, `ai_decisions.output`, `outcomes.reason`. HubSpot copies are not deleted. `purge-contact-data.ts:67-69` would also write the email into `job_executions.result` (handler is dead).
- Evidence: see §7 table. `docs/security/outreach-compliance.md:98-100` promises "delete everything you have about me".
- Impact: legal (GDPR Art. 17), privacy: an erased person's address remains in plaintext in at least `suppressions` and `contact_frequency`.
- Root cause: erasure enumerates tables by hand and was not extended as later migrations (threads participants, provider cache, frequency, unsubscribe path) added PII.
- Fix: in `erase_contact`, convert matching plaintext suppressions to the hash (update `value = v_hash`, `is_erasure_residue = true`) and make `is_suppressed` match hashes too; delete `contact_frequency` row (re-key by hash if the cap must persist); scrub `threads.participants`, `message_events.payload` for affected messages; delete `provider_cache` rows for the person's lookups; delete all `contact_points` of the matched people; document CRM/AI-provider residue.
- Acceptance criteria: after erasure, `select` across the listed columns for the address returns 0 rows; the address is still refused by `can_contact`.
- Test to add: `verify-migrations.ts` — "after erase_contact the plaintext address appears in no table (scan text/jsonb columns)".
- Effort: M · Depends on: none · Mechanizable: yes (PII-column scan after erasure).
- Status vs last pass: New.

### [Medium] LIFE-202: Stated retention does not run for anonymous research, and retention sweeps are bounded without a cursor
- Confidence: CONFIRMED.
- Where: `packages/db/migrations/0025_anonymous_research.sql:193-215` ("Swept rather than left to accumulate") — `purge_expired_research()` has no caller (`grep` across `packages/` and `apps/`) and no `cron.schedule`; `public_research_attempts` (ip_hash rows, inserted by `reserve_public_research`) has no purge at all; `packages/jobs/src/handlers/enforce-retention.ts:58-63` `.limit(50)` with no `order` or cursor; `prune_job_executions` exists only in 0049 (not live).
- Evidence: `docs/security/privacy.md` inventory says `public_research` "Expires".
- Impact: privacy (data about non-customers kept indefinitely, contrary to the migration's own policy); retention silently skipped for orgs past the 50th.
- Root cause: purge functions were written but never wired to a scheduler.
- Fix: call `purge_expired_research()` and a new `prune_public_research_attempts()` from `enforce_retention`; order by `id` and page through all configured orgs (or loop until fewer than the limit).
- Acceptance criteria: an expired `public_research` row and a >30-day attempt row are gone after one daily sweep; 60 configured orgs are all pruned.
- Test to add: `packages/jobs/scripts/verify-jobs.ts` — "enforce_retention purges expired public research and visits every configured org".
- Effort: S · Depends on: a live tick driver (other reviewers) · Mechanizable: yes ("every purge_*/prune_* function has a caller or a cron entry").
- Status vs last pass: New.

### [Medium] LIFE-204: Workspace deletion is soft forever (no purge, no restore), and `has_org_role` ignores it
- Confidence: CONFIRMED.
- Where: `delete_organization` (final 0031:302ff) sets `organizations.deleted_at` and stops outreach; nothing ever hard-deletes the org's rows (all FKs `on delete cascade` from `organizations` are never exercised); no restore RPC; `has_org_role` (final) has no `organizations.deleted_at` predicate while `user_org_ids` does.
- Evidence: §7 delete table. After deletion, admin RPCs (`export_organization`, `retry_job`, `record_override`, `erase_contact_for_org`) and INSERTs under `has_org_role` checks still succeed for members of the deleted org; reads are hidden.
- Impact: privacy (a deleted customer's prospect database incl. contact PII retained indefinitely; nothing in `privacy.md` says so); support (no undo).
- Root cause: deletion was implemented as the first half (tombstone) without the scheduled second half.
- Fix: a purge step in `enforce_retention` that hard-deletes orgs with `deleted_at < now() - interval '30 days'` (FK cascades do the rest), stated in `privacy.md`; add `and exists (select 1 from organizations o where o.id = target_org and o.deleted_at is null)` to `has_org_role`.
- Acceptance criteria: an org deleted 31 days ago has no rows in any tenant table; a member of a deleted org cannot insert.
- Test to add: `verify-migrations.ts` — "a member of a deleted org cannot write"; jobs test for the purge.
- Effort: M · Depends on: product decision on the grace period · Mechanizable: yes.
- Status vs last pass: New.

### [Low] LIFE-203: Account deletion leaves the user's private memories
- Confidence: CONFIRMED (catalog: `memories.scope_id` is not a foreign key; `delete_own_account` deletes only `memberships` and `auth.users`).
- Where: `delete_own_account` (0029:228ff); `memories` FKs (created_by → `auth.users` set null).
- Impact: privacy: a departed user's `scope='user'` notes remain; unreadable to others unless `shared_at` is set (then admins see them, `memories_read`).
- Root cause: user scoping by a non-FK column.
- Fix: in `delete_own_account`, `delete from memories where scope = 'user' and scope_id = v_user` (and `user_questions` already cascade).
- Acceptance criteria / Test to add: `verify-migrations.ts` — "deleting an account removes its user-scoped memories".
- Effort: S · Depends on: none · Mechanizable: yes.
- Status vs last pass: New.

### [Low] DB-202: Six status columns have no CHECK and no transition rule
- Confidence: CONFIRMED (catalog).
- Where: `enrollments.status`, `mailboxes.status`, `job_executions.status`, `campaigns.status`, `threads.status`/`classification`, `ai_runs.status` (free `text`); `opportunities.status` is an enum but any member can move it any → any.
- Impact: a typo or a direct write creates a state no code path exits; enrollments can be reactivated after a stop (send-time `can_contact` still protects suppressed addresses).
- Root cause: statuses introduced as text in early migrations; later ones (discovery_runs, learning_runs…) got CHECKs.
- Fix: add CHECK enumerations matching the code's literals (one migration, `not valid` then `validate`).
- Test to add: `verify-migrations.ts` — "an unknown enrollment status is rejected". Effort: S · Mechanizable: yes.
- Status vs last pass: New.

### [Low] DB-205: `people` has no natural key; two writers can duplicate a person
- Confidence: LIKELY (code reading; not raced).
- Where: `packages/jobs/src/handlers/rank-contacts.ts:366-410` (select `external_ids` → insert `people` → upsert `external_ids`, last writer wins); `packages/jobs/src/first-run.ts:508` runs `rank_contacts` inline while `schedule-followups.ts:75-77` can queue the same company; `apps/web/app/(app)/[org]/imports/actions.ts:270-325` (select-then-insert by name).
- Impact: duplicate people, one orphaned from its provider id; second email insert fails on `contact_points (org_id,kind,value)`.
- Fix: create person + external id in one SQL function keyed on `(org, provider, provider_id)`; or run first-run's ranking through the queue with the same idempotency key.
- Test to add: jobs test running two `rank_contacts` for one company concurrently against PGlite. Effort: S · Mechanizable: no.
- Status vs last pass: New.

### [Low] AUTHZ-203: Minor hardening gaps
- Confidence: CONFIRMED.
- Where: (a) `mailboxes.tenant_write` is member-level although `tenancy-and-permissions.md` says integrations are admin-only (HubSpot is admin-only); (b) session cookie `httpOnly=false`, 400-day `maxAge` (library defaults, `@supabase/ssr` constants.js:4-11) — an XSS can lift a session; (c) `opportunities.owner_id` / `messages.approved_by` accept any `auth.users` id at the DB (only `assignOpportunityAction` checks membership, `team/actions.ts:228-241`).
- Fix: decide mailbox role and align policy or doc; pass explicit `cookieOptions` (`secure: true`, shorter `maxAge`) if the browser client is not needed; membership trigger for user-reference columns (folds into DB-201's guard).
- Effort: S · Mechanizable: partly · Status vs last pass: New.

### [Low] DB-204: Security/privacy docs disagree with code
- Confidence: CONFIRMED.
- Where: `docs/security/privacy.md` — "GDPR erasure cannot be triggered from the product today" and "Access … no UI" (false: `apps/web/app/(app)/[org]/settings/privacy/actions.ts` calls `erase_contact_for_org`/`export_contact_for_org`); `contact_frequency` "unread by application code" (false: `can_contact` reads it); `public_research` "Expires" (never purged, LIFE-202). `docs/security/tenancy-and-permissions.md` — `audit_logs` "read within org" (policy is admin-only); "236 migration-level checks" (383); seats "enforced" (AUTHZ-202).
- Fix: correct the docs. Effort: S · Mechanizable: partly (doc-claim checks in `scripts/audit.mjs`) · Status vs last pass: Still open in part (COMP-001 corrected `outreach-compliance.md` only).

## 9. Feature status (§6 vocabulary)

| Feature | Status | Evidence / test |
|---|---|---|
| Tenant isolation (RLS on all tables, same-org FK triggers) | Verified | `verify-migrations.ts` cross-tenant + same-org blocks (lead: 383 pass); catalog review here |
| Role enforcement viewer/member/admin/owner | Verified (DB) | `verify-migrations.ts` role block; exceptions DB-201, AUTHZ-201 |
| Owner-role protection (grant/remove owner) | Verified | verify-migrations "an admin cannot make themselves owner…" |
| Last-owner protection | Partial | app-only, racy; DB permits (AUTHZ-201, repro) |
| Invite → accept | Implemented, unverified end-to-end | SQL verified (verify-migrations invitation block); magic-link round trip needs live Supabase Auth |
| Join request → approve | Implemented, unverified | SQL path verified in verify-migrations; no seats check (AUTHZ-202) |
| Seats plan limit | Broken | never binds (AUTHZ-202) |
| Magic-link login / signup | Implemented, unverified | vendor flow; enumeration-safe copy confirmed by reading |
| Google OAuth (PKCE) | Implemented, unverified | needs live provider config |
| Sign-out | Implemented, unverified | POST-only route read; no test found |
| Account deletion (`delete_own_account`) | Partial | sole-owner check has soft-delete bug; leaves user memories (AUTHZ-201, LIFE-203) |
| Workspace deletion | Partial | soft only; no purge/restore (LIFE-204); verify-migrations "the owner deletes the workspace" |
| Contact erasure (Settings → Data & privacy) | Partial | works for the tables it names (verify-migrations erasure block); misses 8 places (LIFE-201) |
| Contact export | Implemented, unverified (UI) / Verified (SQL) | verify-migrations export block |
| Workspace export | Partial | counts-only for evidence/messages/people/ai_runs, by design |
| `purge_contact_data` job | Dead (built, not connected) | no producer (`grep`) |
| `enforce_retention` (contact retention) | Implemented, unverified | jobs tests with fakes; no live driver; 50-org cap without cursor |
| Anonymous research purge | Dead (built, not connected) | `purge_expired_research` never called (LIFE-202) |
| pg_cron prunes (rate limits, provider cache) | Implemented, unverified | cron not visible to doctor |
| Soft-delete propagation (company → opps → outreach) | Implemented in repo, not live | 0049; bypassable by hard DELETE (DB-201) |
| Mailbox token column protection | Implemented in repo, not live; breaks connect | 0049; DB-203 |
| Mailbox safety-column guard | Implemented in repo, not live | 0049 trigger; verify-migrations warm-up test |
| Atomic provider spend / per-address lanes (DB side) | Implemented in repo, not live | 0050 (advisory lock; `on conflict` lane) |
| Migration runner with ledger | Implemented, unverified against real DB | `verify-migrate.ts` (lead: 9 pass) uses a fake executor |

## 10. Baseline diff (pass-15 items in db/authz/lifecycle)

| Pass-15 ID | Status now | Proof |
|---|---|---|
| SEC-101 / FLOW-101 (removal doesn't stop outreach) | Fixed in repo, not live; bypassable by hard DELETE | `propagate_company_removal`, `stop_outreach_for_deleted_opportunity` (0049); repro in DB-201 |
| FLOW-102 (merge leaves loser's evidence) | Fixed in repo, not live | `propagate_company_removal` merged branch (0049) |
| SEC-102 (mailbox ciphertext readable) | Fixed in repo, not live — **regresses mailbox connect** | 0049:159-169; DB-203 |
| SEC-103 (members rewrite send-safety columns) | Fixed in repo, not live | `guard_mailbox_safety` (0049); `daily_limit`/`status` still member-writable (cap uses `least(...)`, so no bypass) |
| DB-102 / FLOW-105 (merged ghost restore) | Fixed (app, live on next deploy) | `apps/web/app/(app)/[org]/companies/actions.ts:89-94` |
| DB-105 (grants on rewritten functions) | Fixed in repo (partly not live) | catalog: every internal DEFINER revoked from anon/authenticated; 0049 part not live |
| JOB-011 (job_executions never pruned) | Fixed in repo, not live | `prune_job_executions` (0049:182) called from `enforce-retention.ts:55` |
| PROV-015 (budget check-then-call), DB side | Fixed in repo, not live | `reserve_provider_credit` with `pg_advisory_xact_lock` (0050) |
| OUT-013 (per-address lane), DB side | Fixed in repo, not live | `claim_contact_lane` atomic `on conflict` (0050) |
| COMP-001 / MAP-101 (erasure doc, purge job producer) | Partly fixed | `outreach-compliance.md:149` corrected; `privacy.md` still stale (DB-204); job still has no producer (accepted by design) |

New this pass: DB-201, DB-202, DB-203, DB-204, DB-205, AUTHZ-201, AUTHZ-202, AUTHZ-203, LIFE-201, LIFE-202, LIFE-203, LIFE-204.

## 11. Checked, nothing found

| What | How |
|---|---|
| RLS enabled on every table | `pg_class.relrowsecurity` for all 82 public tables after 0050: all true |
| Views bypassing RLS | all 9 views `security_invoker=true` (`pg_class.reloptions`) |
| SECURITY DEFINER without `search_path` | `pg_proc.prosecdef` × `proconfig`: none (only `touch_updated_at`, INVOKER, lacks it) |
| Anon/authenticated-executable DEFINER RPCs without an internal check | read every body (list in §2): all gate on `auth.uid()`, membership or role |
| Enum order inversion | `org_role` = owner, admin, member, viewer; `has_org_role` uses `<=` (verify-migrations asserts) |
| Cross-tenant FK smuggling | `enforce_same_org_refs` on every intra-tenant FK (trigger list §2) |
| Admin self-promotion / demoting an owner | PGlite repro: both rejected (`42501`) |
| Invite token entropy/expiry/single-use/email binding | `accept_invitation` final body; uuid v4; 14-day default |
| Open redirect in auth `next` | `lib/safe-next.ts` (rejects `//`, `\`, control chars, non-absolute); used in callback, signout, magic link |
| Account enumeration on login | `app/(auth)/actions.ts:96-115` single generic error |
| Non-atomic counters | `increment_usage_internal`, `consume_rate_limit`, `record_contact_send`, `reserve_provider_credit` bodies: upserts / advisory lock |
| Org plan/trial/deletion editable by admins | `guard_organization_reserved` blocks sessions |
| HubSpot token exposure | `hubspot_connections` admin-only read; AES-256-GCM via `packages/db/src/crypto.ts` |
| AI run logs holding prompts | `ai_runs` stores `input_hash`, tokens, cost only (no prompt/response text) |
| `pending-migrations.sql` drift | file does not exist; `COMBINED-0024-0027.sql` verified as the four files by the test suite |

## 12. Not verified (and what would settle it)

| Item | Access needed |
|---|---|
| Real Supabase table/function grants match the emulated defaults (DB-201 severity) | read-only SQL on the configured project: `has_table_privilege('authenticated','public.suppressions','DELETE')`, same for `messages`/`opportunities` |
| pg_cron jobs `prune-rate-limits`, `prune-provider-cache` exist and run | Supabase SQL: `select jobname, schedule, active from cron.job` and `cron.job_run_details` |
| JWT expiry, refresh-token rotation, email confirmation required, OTP expiry | Supabase Dashboard → Authentication → Settings |
| Google OAuth redirect URIs include `huntloop.pro` origins | Google Cloud console + Supabase Auth URL config |
| PostgREST emits `ON CONFLICT … DO UPDATE SET col = EXCLUDED.col` for `.upsert()` (DB-203 relies on it; repro used that shape) | run the callback against a local Supabase with 0049 applied, or inspect PostgREST logs |
| Backups / PITR / restore rehearsal | Supabase Dashboard → Database → Backups |
| Prod schema == repo beyond the doctor's probes (column-level drift) | `pg_dump --schema-only` diff, read-only |
| Concurrency races in §5 actually interleave under load | a local Postgres with two parallel workers; not run (read-only pass) |

