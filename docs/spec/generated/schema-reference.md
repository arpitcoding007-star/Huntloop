---
description: Generated column-level schema reference, introspected from the migrations. Do not edit by hand.
---

# Schema reference (generated)

> **Generated** by `packages/db/scripts/schema-reference.ts` by applying all 47 migrations
> (`0001_identity.sql` … `0047_security_leads.sql`) to an in-memory Postgres (PGlite) and reading the catalog.
> It is evidence for [05-backend-database-schema.md](../05-backend-database-schema.md); that document
> carries the interpretation. Re-generate rather than editing.

**Totals:** 81 tables · 9 views · 105 public functions · 10 enum types · 141 RLS policies · 237 indexes · 123 triggers.

**RLS enabled on:** 81 of 81 tables.

## Contents

[`activities`](#activities) · [`ai_decisions`](#ai_decisions) · [`ai_runs`](#ai_runs) · [`attention_snoozes`](#attention_snoozes) · [`audit_logs`](#audit_logs) · [`campaigns`](#campaigns) · [`companies`](#companies) · [`company_competitor_signals`](#company_competitor_signals) · [`company_domains`](#company_domains) · [`company_gaps`](#company_gaps) · [`company_merges`](#company_merges) · [`company_problems`](#company_problems) · [`company_triggers`](#company_triggers) · [`competitor_evidence`](#competitor_evidence) · [`competitor_profiles`](#competitor_profiles) · [`competitors`](#competitors) · [`contact_fit_scores`](#contact_fit_scores) · [`contact_frequency`](#contact_frequency) · [`contact_points`](#contact_points) · [`conversation_messages`](#conversation_messages) · [`conversations`](#conversations) · [`demand_signals`](#demand_signals) · [`demand_state`](#demand_state) · [`demand_themes`](#demand_themes) · [`discovery_queries`](#discovery_queries) · [`discovery_results`](#discovery_results) · [`discovery_runs`](#discovery_runs) · [`enrichment_records`](#enrichment_records) · [`enrollments`](#enrollments) · [`events`](#events) · [`evidence`](#evidence) · [`evidence_citations`](#evidence_citations) · [`external_ids`](#external_ids) · [`hubspot_connections`](#hubspot_connections) · [`human_overrides`](#human_overrides) · [`icp_versions`](#icp_versions) · [`icps`](#icps) · [`invitations`](#invitations) · [`job_executions`](#job_executions) · [`join_requests`](#join_requests) · [`learning_findings`](#learning_findings) · [`learning_runs`](#learning_runs) · [`mailboxes`](#mailboxes) · [`memberships`](#memberships) · [`memories`](#memories) · [`memory_evidence`](#memory_evidence) · [`merge_candidates`](#merge_candidates) · [`message_events`](#message_events) · [`message_unsubscribe_tokens`](#message_unsubscribe_tokens) · [`messages`](#messages) · [`notification_preferences`](#notification_preferences) · [`opportunities`](#opportunities) · [`opportunity_scores`](#opportunity_scores) · [`organizations`](#organizations) · [`outcomes`](#outcomes) · [`people`](#people) · [`personas`](#personas) · [`plans`](#plans) · [`preference_signals`](#preference_signals) · [`preference_state`](#preference_state) · [`products`](#products) · [`profiles`](#profiles) · [`provider_accounts`](#provider_accounts) · [`provider_breakers`](#provider_breakers) · [`provider_cache`](#provider_cache) · [`provider_calls`](#provider_calls) · [`public_research`](#public_research) · [`public_research_attempts`](#public_research_attempts) · [`rate_limits`](#rate_limits) · [`score_recompute_requests`](#score_recompute_requests) · [`scoring_rules`](#scoring_rules) · [`sequence_steps`](#sequence_steps) · [`sequences`](#sequences) · [`source_documents`](#source_documents) · [`source_events`](#source_events) · [`sources`](#sources) · [`subscriptions`](#subscriptions) · [`suppressions`](#suppressions) · [`threads`](#threads) · [`usage_counters`](#usage_counters) · [`user_questions`](#user_questions)

---

## activities

RLS: **enabled**

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` |
| `org_id` | uuid | NOT NULL |  |
| `opportunity_id` | uuid | null |  |
| `company_id` | uuid | null |  |
| `person_id` | uuid | null |  |
| `kind` | text | NOT NULL |  |
| `channel` | text | NOT NULL |  |
| `direction` | text | NOT NULL |  |
| `actor_type` | text | NOT NULL |  |
| `actor_id` | uuid | null |  |
| `occurred_at` | timestamp with time zone | NOT NULL |  |
| `summary` | text | NOT NULL |  |
| `body` | text | null |  |
| `ref_type` | text | null |  |
| `ref_id` | uuid | null |  |
| `payload` | jsonb | NOT NULL | `'{}'::jsonb` |
| `origin` | text | NOT NULL |  |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |
| `updated_at` | timestamp with time zone | NOT NULL | `now()` |
| `deleted_at` | timestamp with time zone | null |  |
| `product_feedback` | boolean | NOT NULL | `false` |

**Constraints**

- CHECK `activities_actor_type_check` — `CHECK ((actor_type = ANY (ARRAY['user'::text, 'system'::text, 'contact'::text])))`
- CHECK `activities_body_check` — `CHECK (((body IS NULL) OR (length(body) <= 10000)))`
- CHECK `activities_body_is_manual` — `CHECK (((body IS NULL) OR (origin = 'manual'::text)))`
- CHECK `activities_channel_check` — `CHECK ((channel = ANY (ARRAY['email'::text, 'linkedin'::text, 'phone'::text, 'meeting'::text, 'chat'::text, 'other'::text, 'system'::text])))`
- CHECK `activities_direction_check` — `CHECK ((direction = ANY (ARRAY['outbound'::text, 'inbound'::text, 'internal'::text])))`
- CHECK `activities_has_subject` — `CHECK (((opportunity_id IS NOT NULL) OR (company_id IS NOT NULL)))`
- CHECK `activities_kind_check` — `CHECK ((kind = ANY (ARRAY['discovered'::text, 'email_sent'::text, 'email_received'::text, 'email_bounced'::text, 'email_complained'::text, 'email_unsubscribed'::text, 'draft_rejected'::text, 'stage_changed'::text, 'priority_changed'::text, 'owner_changed'::text, 'override_recorded'::text, 'outcome_recorded'::text, 'note'::text, 'call'::text, 'meeting'::text, 'message'::text, 'connection_request'::text])))`
- CHECK `activities_manual_shape` — `CHECK (((origin <> 'manual'::text) OR ((actor_id IS NOT NULL) AND (actor_type = 'user'::text) AND (kind = ANY (ARRAY['note'::text, 'call'::text, 'meeting'::text, 'message'::text, 'connection_request'::text])))))`
- CHECK `activities_origin_check` — `CHECK ((origin = ANY (ARRAY['trigger'::text, 'manual'::text, 'backfill'::text])))`
- CHECK `activities_ref_pair` — `CHECK (((ref_type IS NULL) = (ref_id IS NULL)))`
- CHECK `activities_ref_type_check` — `CHECK (((ref_type IS NULL) OR (ref_type = ANY (ARRAY['opportunity'::text, 'message'::text, 'message_event'::text, 'outcome'::text, 'human_override'::text]))))`
- CHECK `activities_summary_check` — `CHECK (((length(summary) >= 1) AND (length(summary) <= 500)))`
- FK `activities_actor_id_fkey` — `FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE SET NULL`
- FK `activities_company_id_fkey` — `FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE`
- FK `activities_opportunity_id_fkey` — `FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE`
- FK `activities_org_id_fkey` — `FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE`
- FK `activities_person_id_fkey` — `FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE SET NULL`
- PK `activities_pkey` — `PRIMARY KEY (id)`

**Indexes**

- `activities_company_idx` — `activities USING btree (org_id, company_id, occurred_at DESC) WHERE (deleted_at IS NULL)`
- `activities_kind_idx` — `activities USING btree (org_id, kind, occurred_at DESC) WHERE (deleted_at IS NULL)`
- `activities_opportunity_idx` — `activities USING btree (org_id, opportunity_id, occurred_at DESC) WHERE (deleted_at IS NULL)`
- `activities_person_idx` — `activities USING btree (org_id, person_id) WHERE (person_id IS NOT NULL)`
- `activities_projection_key` — `UNIQUE activities USING btree (org_id, ref_type, ref_id, kind) WHERE (ref_id IS NOT NULL)`

**Policies**

- `activities_insert_manual` — INSERT WITH CHECK `(has_org_role(org_id, 'member'::org_role) AND (origin = 'manual'::text) AND (actor_id = auth.uid()))`
- `activities_read` — SELECT USING `(org_id IN ( SELECT user_org_ids() AS user_org_ids))`
- `activities_update_manual` — UPDATE USING `((origin = 'manual'::text) AND has_org_role(org_id, 'member'::org_role) AND ((actor_id = auth.uid()) OR has_org_role(org_id, 'admin'::org_role)))` WITH CHECK `((origin = 'manual'::text) AND has_org_role(org_id, 'member'::org_role) AND ((actor_id = auth.uid()) OR has_org_role(org_id, 'admin'::org_role)))`

**Triggers**

- `activities_demand`
- `activities_demand_erasure`
- `activities_guard_authorship`
- `activities_same_org`
- `activities_touch`

## ai_decisions

RLS: **enabled**

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` |
| `org_id` | uuid | NOT NULL |  |
| `run_id` | uuid | null |  |
| `decision_type` | text | NOT NULL |  |
| `output` | jsonb | NOT NULL |  |
| `confidence` | confidence | null |  |
| `human_override` | jsonb | null |  |
| `overridden_by` | uuid | null |  |
| `overridden_at` | timestamp with time zone | null |  |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |
| `updated_at` | timestamp with time zone | NOT NULL | `now()` |
| `quality_rating` | text | null |  |
| `quality_note` | text | null |  |
| `rated_by` | uuid | null |  |
| `rated_at` | timestamp with time zone | null |  |
| `entity_type` | text | null |  |
| `entity_id` | uuid | null |  |

**Constraints**

- CHECK `ai_decisions_quality_rating_check` — `CHECK ((quality_rating = ANY (ARRAY['excellent'::text, 'good'::text, 'average'::text, 'poor'::text])))`
- FK `ai_decisions_org_id_fkey` — `FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE`
- FK `ai_decisions_overridden_by_fkey` — `FOREIGN KEY (overridden_by) REFERENCES auth.users(id) ON DELETE SET NULL`
- FK `ai_decisions_rated_by_fkey` — `FOREIGN KEY (rated_by) REFERENCES auth.users(id) ON DELETE SET NULL`
- FK `ai_decisions_run_id_fkey` — `FOREIGN KEY (run_id) REFERENCES ai_runs(id) ON DELETE SET NULL`
- PK `ai_decisions_pkey` — `PRIMARY KEY (id)`

**Indexes**

- `ai_decisions_entity_idx` — `ai_decisions USING btree (org_id, entity_type, entity_id, created_at DESC)`
- `ai_decisions_rated_idx` — `ai_decisions USING btree (org_id, decision_type, rated_at DESC) WHERE (quality_rating IS NOT NULL)`

**Policies**

- `tenant_read` — SELECT USING `(org_id IN ( SELECT user_org_ids() AS user_org_ids))`
- `tenant_write` — ALL USING `has_org_role(org_id, 'member'::org_role)` WITH CHECK `has_org_role(org_id, 'member'::org_role)`

**Triggers**

- `ai_decisions_same_org`
- `ai_decisions_touch`

## ai_runs

RLS: **enabled**

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` |
| `org_id` | uuid | NOT NULL |  |
| `task` | text | NOT NULL |  |
| `model` | text | NOT NULL |  |
| `prompt_version` | text | NOT NULL |  |
| `input_hash` | text | null |  |
| `input_tokens` | integer | NOT NULL | `0` |
| `output_tokens` | integer | NOT NULL | `0` |
| `cache_read_tokens` | integer | NOT NULL | `0` |
| `cost_cents` | numeric | NOT NULL | `0` |
| `latency_ms` | integer | null |  |
| `status` | text | NOT NULL | `'started'::text` |
| `error` | text | null |  |
| `entity_type` | text | null |  |
| `entity_id` | uuid | null |  |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |
| `updated_at` | timestamp with time zone | NOT NULL | `now()` |

**Constraints**

- FK `ai_runs_org_id_fkey` — `FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE`
- PK `ai_runs_pkey` — `PRIMARY KEY (id)`

**Indexes**

- `ai_runs_cost_idx` — `ai_runs USING btree (org_id, task, created_at DESC)`
- `ai_runs_dedupe_idx` — `ai_runs USING btree (org_id, task, input_hash)`

**Policies**

- `tenant_read` — SELECT USING `(org_id IN ( SELECT user_org_ids() AS user_org_ids))`
- `tenant_write` — ALL USING `has_org_role(org_id, 'member'::org_role)` WITH CHECK `has_org_role(org_id, 'member'::org_role)`

**Triggers**

- `ai_runs_touch`

## attention_snoozes

RLS: **enabled**

| Column | Type | Null | Default |
|---|---|---|---|
| `org_id` | uuid | NOT NULL |  |
| `user_id` | uuid | NOT NULL |  |
| `item_key` | text | NOT NULL |  |
| `snoozed_until` | timestamp with time zone | NOT NULL |  |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |

**Constraints**

- CHECK `attention_snoozes_item_key_check` — `CHECK (((length(item_key) >= 3) AND (length(item_key) <= 200)))`
- FK `attention_snoozes_org_id_fkey` — `FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE`
- FK `attention_snoozes_user_id_fkey` — `FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE`
- PK `attention_snoozes_pkey` — `PRIMARY KEY (org_id, user_id, item_key)`

**Policies**

- `snoozes_own` — ALL USING `((user_id = auth.uid()) AND (org_id IN ( SELECT user_org_ids() AS user_org_ids)))` WITH CHECK `((user_id = auth.uid()) AND has_org_role(org_id, 'viewer'::org_role))`

## audit_logs

RLS: **enabled**

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` |
| `org_id` | uuid | NOT NULL |  |
| `actor_id` | uuid | null |  |
| `action` | text | NOT NULL |  |
| `target_type` | text | null |  |
| `target_id` | uuid | null |  |
| `meta` | jsonb | NOT NULL | `'{}'::jsonb` |
| `ip` | inet | null |  |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |

**Constraints**

- FK `audit_logs_actor_id_fkey` — `FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE SET NULL`
- FK `audit_logs_org_id_fkey` — `FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE`
- PK `audit_logs_pkey` — `PRIMARY KEY (id)`

**Indexes**

- `audit_logs_org_idx` — `audit_logs USING btree (org_id, created_at DESC)`

**Policies**

- `audit_read` — SELECT USING `has_org_role(org_id, 'admin'::org_role)`

## campaigns

RLS: **enabled**

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` |
| `org_id` | uuid | NOT NULL |  |
| `name` | text | NOT NULL |  |
| `icp_id` | uuid | null |  |
| `product_id` | uuid | null |  |
| `status` | text | NOT NULL | `'draft'::text` |
| `autonomy_level` | integer | NOT NULL | `0` |
| `schedule` | jsonb | NOT NULL | `'{}'::jsonb` |
| `sending_config` | jsonb | NOT NULL | `'{}'::jsonb` |
| `started_at` | timestamp with time zone | null |  |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |
| `updated_at` | timestamp with time zone | NOT NULL | `now()` |
| `deleted_at` | timestamp with time zone | null |  |

**Constraints**

- CHECK `campaigns_autonomy_level_check` — `CHECK (((autonomy_level >= 0) AND (autonomy_level <= 5)))`
- FK `campaigns_icp_id_fkey` — `FOREIGN KEY (icp_id) REFERENCES icps(id) ON DELETE SET NULL`
- FK `campaigns_org_id_fkey` — `FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE`
- FK `campaigns_product_id_fkey` — `FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL`
- PK `campaigns_pkey` — `PRIMARY KEY (id)`

**Policies**

- `tenant_read` — SELECT USING `(org_id IN ( SELECT user_org_ids() AS user_org_ids))`
- `tenant_write` — ALL USING `has_org_role(org_id, 'member'::org_role)` WITH CHECK `has_org_role(org_id, 'member'::org_role)`

**Triggers**

- `campaigns_same_org`
- `campaigns_touch`

## companies

RLS: **enabled**

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` |
| `org_id` | uuid | NOT NULL |  |
| `canonical_domain` | text | NOT NULL |  |
| `name` | text | NOT NULL |  |
| `website` | text | null |  |
| `industry` | text | null |  |
| `employee_count` | integer | null |  |
| `revenue_band` | text | null |  |
| `country` | text | null |  |
| `region` | text | null |  |
| `business_model` | text | null |  |
| `description` | text | null |  |
| `tech_stack` | text[] | NOT NULL | `'{}'::text[]` |
| `funding` | jsonb | NOT NULL | `'{}'::jsonb` |
| `leadership` | jsonb | NOT NULL | `'[]'::jsonb` |
| `last_researched_at` | timestamp with time zone | null |  |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |
| `updated_at` | timestamp with time zone | NOT NULL | `now()` |
| `deleted_at` | timestamp with time zone | null |  |
| `discovered_via` | text | NOT NULL | `'manual'::text` |
| `parent_company_id` | uuid | null |  |
| `relationship_kind` | text | null |  |
| `merged_into_id` | uuid | null |  |
| `discovery_run_id` | uuid | null |  |
| `last_signal_checked_at` | timestamp with time zone | null |  |
| `last_enriched_at` | timestamp with time zone | null |  |
| `research_requested_at` | timestamp with time zone | null |  |
| `research_asked_at` | timestamp with time zone | null |  |

**Constraints**

- CHECK `companies_not_own_merge_target` — `CHECK (((merged_into_id IS NULL) OR (merged_into_id <> id)))`
- CHECK `companies_not_own_parent` — `CHECK (((parent_company_id IS NULL) OR (parent_company_id <> id)))`
- CHECK `companies_relationship_kind_check` — `CHECK (((relationship_kind IS NULL) OR (relationship_kind = ANY (ARRAY['subsidiary'::text, 'division'::text, 'brand'::text, 'acquired'::text]))))`
- FK `companies_discovery_run_id_fkey` — `FOREIGN KEY (discovery_run_id) REFERENCES discovery_runs(id) ON DELETE SET NULL`
- FK `companies_merged_into_id_fkey` — `FOREIGN KEY (merged_into_id) REFERENCES companies(id) ON DELETE SET NULL`
- FK `companies_org_id_fkey` — `FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE`
- FK `companies_parent_company_id_fkey` — `FOREIGN KEY (parent_company_id) REFERENCES companies(id) ON DELETE SET NULL`
- PK `companies_pkey` — `PRIMARY KEY (id)`
- UNIQUE `companies_org_id_canonical_domain_key` — `UNIQUE (org_id, canonical_domain)`

**Indexes**

- `companies_discovery_run_idx` — `companies USING btree (org_id, discovery_run_id) WHERE (discovery_run_id IS NOT NULL)`
- `companies_parent_idx` — `companies USING btree (org_id, parent_company_id) WHERE (parent_company_id IS NOT NULL)`
- `companies_research_asked_idx` — `companies USING btree (research_asked_at) WHERE ((research_asked_at IS NOT NULL) AND (deleted_at IS NULL))`
- `companies_signal_stale_idx` — `companies USING btree (last_signal_checked_at) WHERE (deleted_at IS NULL)`
- `companies_unresearched_idx` — `companies USING btree (research_requested_at NULLS FIRST) WHERE ((last_researched_at IS NULL) AND (deleted_at IS NULL))`

**Policies**

- `tenant_insert` — INSERT WITH CHECK `has_org_role(org_id, 'member'::org_role)`
- `tenant_read` — SELECT USING `(org_id IN ( SELECT user_org_ids() AS user_org_ids))`
- `tenant_update` — UPDATE USING `has_org_role(org_id, 'member'::org_role)` WITH CHECK `has_org_role(org_id, 'member'::org_role)`

**Triggers**

- `companies_same_org`
- `companies_touch`

## company_competitor_signals

RLS: **enabled**

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` |
| `org_id` | uuid | NOT NULL |  |
| `company_id` | uuid | NOT NULL |  |
| `competitor_id` | uuid | NOT NULL |  |
| `relationship` | text | NOT NULL |  |
| `claim_kind` | claim_kind | NOT NULL | `'inference'::claim_kind` |
| `confidence` | confidence | NOT NULL | `'low'::confidence` |
| `evidence_id` | uuid | null |  |
| `observed_at` | timestamp with time zone | null |  |
| `detected_by` | text | NOT NULL | `'system'::text` |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |
| `updated_at` | timestamp with time zone | NOT NULL | `now()` |

**Constraints**

- CHECK `company_competitor_signals_relationship_check` — `CHECK ((relationship = ANY (ARRAY['uses'::text, 'evaluating'::text, 'mentions'::text, 'former'::text, 'partner'::text])))`
- FK `company_competitor_signals_company_id_fkey` — `FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE`
- FK `company_competitor_signals_competitor_id_fkey` — `FOREIGN KEY (competitor_id) REFERENCES competitors(id) ON DELETE CASCADE`
- FK `company_competitor_signals_evidence_id_fkey` — `FOREIGN KEY (evidence_id) REFERENCES evidence(id) ON DELETE SET NULL`
- FK `company_competitor_signals_org_id_fkey` — `FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE`
- PK `company_competitor_signals_pkey` — `PRIMARY KEY (id)`
- UNIQUE `company_competitor_signals_org_id_company_id_competitor_id__key` — `UNIQUE (org_id, company_id, competitor_id, relationship)`

**Indexes**

- `company_competitor_signals_company_idx` — `company_competitor_signals USING btree (org_id, company_id)`
- `company_competitor_signals_competitor_idx` — `company_competitor_signals USING btree (org_id, competitor_id, observed_at DESC)`

**Policies**

- `tenant_read` — SELECT USING `(org_id IN ( SELECT user_org_ids() AS user_org_ids))`
- `tenant_write` — ALL USING `has_org_role(org_id, 'member'::org_role)` WITH CHECK `has_org_role(org_id, 'member'::org_role)`

**Triggers**

- `company_competitor_signals_same_org`
- `company_competitor_signals_touch`

## company_domains

RLS: **enabled**

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` |
| `org_id` | uuid | NOT NULL |  |
| `company_id` | uuid | NOT NULL |  |
| `domain` | text | NOT NULL |  |
| `kind` | text | NOT NULL | `'alternate'::text` |
| `evidence_id` | uuid | null |  |
| `asserted_by` | text | NOT NULL | `'system'::text` |
| `confidence` | confidence | NOT NULL | `'medium'::confidence` |
| `verified_at` | timestamp with time zone | null |  |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |
| `updated_at` | timestamp with time zone | NOT NULL | `now()` |

**Constraints**

- CHECK `company_domains_domain_check` — `CHECK (((domain = lower(domain)) AND (domain !~ '[/\s]'::text) AND (domain !~~ '%:%'::text) AND (domain ~~ '%.%'::text)))`
- CHECK `company_domains_kind_check` — `CHECK ((kind = ANY (ARRAY['primary'::text, 'alternate'::text, 'redirect'::text, 'former'::text, 'acquired'::text])))`
- FK `company_domains_company_id_fkey` — `FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE`
- FK `company_domains_evidence_id_fkey` — `FOREIGN KEY (evidence_id) REFERENCES evidence(id) ON DELETE SET NULL`
- FK `company_domains_org_id_fkey` — `FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE`
- PK `company_domains_pkey` — `PRIMARY KEY (id)`
- UNIQUE `company_domains_org_id_domain_key` — `UNIQUE (org_id, domain)`

**Indexes**

- `company_domains_company_idx` — `company_domains USING btree (org_id, company_id)`
- `company_domains_one_primary` — `UNIQUE company_domains USING btree (org_id, company_id) WHERE (kind = 'primary'::text)`

**Policies**

- `tenant_read` — SELECT USING `(org_id IN ( SELECT user_org_ids() AS user_org_ids))`
- `tenant_write` — ALL USING `has_org_role(org_id, 'member'::org_role)` WITH CHECK `has_org_role(org_id, 'member'::org_role)`

**Triggers**

- `company_domains_same_org`
- `company_domains_touch`

## company_gaps

RLS: **enabled**

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` |
| `org_id` | uuid | NOT NULL |  |
| `company_id` | uuid | NOT NULL |  |
| `gap` | text | NOT NULL |  |
| `current_approach` | text | null |  |
| `evidence_id` | uuid | null |  |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |
| `updated_at` | timestamp with time zone | NOT NULL | `now()` |
| `deleted_at` | timestamp with time zone | null |  |

**Constraints**

- FK `company_gaps_company_id_fkey` — `FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE`
- FK `company_gaps_evidence_id_fkey` — `FOREIGN KEY (evidence_id) REFERENCES evidence(id) ON DELETE SET NULL`
- FK `company_gaps_org_id_fkey` — `FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE`
- PK `company_gaps_pkey` — `PRIMARY KEY (id)`

**Policies**

- `tenant_read` — SELECT USING `(org_id IN ( SELECT user_org_ids() AS user_org_ids))`
- `tenant_write` — ALL USING `has_org_role(org_id, 'member'::org_role)` WITH CHECK `has_org_role(org_id, 'member'::org_role)`

**Triggers**

- `company_gaps_same_org`
- `company_gaps_touch`

## company_merges

RLS: **enabled**

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` |
| `org_id` | uuid | NOT NULL |  |
| `winner_id` | uuid | NOT NULL |  |
| `loser_id` | uuid | null |  |
| `moved` | jsonb | NOT NULL | `'{}'::jsonb` |
| `reason` | text | NOT NULL |  |
| `method` | text | NOT NULL | `'manual'::text` |
| `confidence` | confidence | NOT NULL | `'high'::confidence` |
| `merged_by` | uuid | null |  |
| `merged_at` | timestamp with time zone | NOT NULL | `now()` |
| `reverted_at` | timestamp with time zone | null |  |
| `reverted_by` | uuid | null |  |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |

**Constraints**

- CHECK `company_merges_method_check` — `CHECK ((method = ANY (ARRAY['manual'::text, 'auto'::text])))`
- FK `company_merges_loser_id_fkey` — `FOREIGN KEY (loser_id) REFERENCES companies(id) ON DELETE SET NULL`
- FK `company_merges_merged_by_fkey` — `FOREIGN KEY (merged_by) REFERENCES auth.users(id) ON DELETE SET NULL`
- FK `company_merges_org_id_fkey` — `FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE`
- FK `company_merges_reverted_by_fkey` — `FOREIGN KEY (reverted_by) REFERENCES auth.users(id) ON DELETE SET NULL`
- FK `company_merges_winner_id_fkey` — `FOREIGN KEY (winner_id) REFERENCES companies(id) ON DELETE CASCADE`
- PK `company_merges_pkey` — `PRIMARY KEY (id)`

**Indexes**

- `company_merges_loser_idx` — `company_merges USING btree (org_id, loser_id)`
- `company_merges_org_idx` — `company_merges USING btree (org_id, merged_at DESC)`

**Policies**

- `tenant_read` — SELECT USING `(org_id IN ( SELECT user_org_ids() AS user_org_ids))`
- `tenant_write` — ALL USING `has_org_role(org_id, 'member'::org_role)` WITH CHECK `has_org_role(org_id, 'member'::org_role)`

**Triggers**

- `company_merges_same_org`

## company_problems

RLS: **enabled**

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` |
| `org_id` | uuid | NOT NULL |  |
| `company_id` | uuid | NOT NULL |  |
| `problem` | text | NOT NULL |  |
| `severity` | integer | null |  |
| `evidence_id` | uuid | null |  |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |
| `updated_at` | timestamp with time zone | NOT NULL | `now()` |
| `deleted_at` | timestamp with time zone | null |  |

**Constraints**

- CHECK `company_problems_severity_check` — `CHECK (((severity >= 0) AND (severity <= 100)))`
- FK `company_problems_company_id_fkey` — `FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE`
- FK `company_problems_evidence_id_fkey` — `FOREIGN KEY (evidence_id) REFERENCES evidence(id) ON DELETE SET NULL`
- FK `company_problems_org_id_fkey` — `FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE`
- PK `company_problems_pkey` — `PRIMARY KEY (id)`

**Policies**

- `tenant_read` — SELECT USING `(org_id IN ( SELECT user_org_ids() AS user_org_ids))`
- `tenant_write` — ALL USING `has_org_role(org_id, 'member'::org_role)` WITH CHECK `has_org_role(org_id, 'member'::org_role)`

**Triggers**

- `company_problems_same_org`
- `company_problems_touch`

## company_triggers

RLS: **enabled**

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` |
| `org_id` | uuid | NOT NULL |  |
| `company_id` | uuid | NOT NULL |  |
| `trigger_type` | text | NOT NULL |  |
| `event_date` | timestamp with time zone | NOT NULL |  |
| `strength` | integer | null |  |
| `evidence_id` | uuid | null |  |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |
| `updated_at` | timestamp with time zone | NOT NULL | `now()` |
| `deleted_at` | timestamp with time zone | null |  |

**Constraints**

- CHECK `company_triggers_strength_check` — `CHECK (((strength >= 0) AND (strength <= 100)))`
- FK `company_triggers_company_id_fkey` — `FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE`
- FK `company_triggers_evidence_id_fkey` — `FOREIGN KEY (evidence_id) REFERENCES evidence(id) ON DELETE SET NULL`
- FK `company_triggers_org_id_fkey` — `FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE`
- PK `company_triggers_pkey` — `PRIMARY KEY (id)`

**Indexes**

- `company_triggers_recent_idx` — `company_triggers USING btree (org_id, company_id, event_date DESC) WHERE (deleted_at IS NULL)`

**Policies**

- `tenant_read` — SELECT USING `(org_id IN ( SELECT user_org_ids() AS user_org_ids))`
- `tenant_write` — ALL USING `has_org_role(org_id, 'member'::org_role)` WITH CHECK `has_org_role(org_id, 'member'::org_role)`

**Triggers**

- `company_triggers_same_org`
- `company_triggers_touch`

## competitor_evidence

RLS: **enabled**

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` |
| `org_id` | uuid | NOT NULL |  |
| `competitor_id` | uuid | NOT NULL |  |
| `evidence_id` | uuid | NOT NULL |  |
| `field` | text | NOT NULL |  |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |

**Constraints**

- FK `competitor_evidence_competitor_id_fkey` — `FOREIGN KEY (competitor_id) REFERENCES competitors(id) ON DELETE CASCADE`
- FK `competitor_evidence_evidence_id_fkey` — `FOREIGN KEY (evidence_id) REFERENCES evidence(id) ON DELETE CASCADE`
- FK `competitor_evidence_org_id_fkey` — `FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE`
- PK `competitor_evidence_pkey` — `PRIMARY KEY (id)`
- UNIQUE `competitor_evidence_org_id_competitor_id_evidence_id_field_key` — `UNIQUE (org_id, competitor_id, evidence_id, field)`

**Indexes**

- `competitor_evidence_competitor_idx` — `competitor_evidence USING btree (org_id, competitor_id, created_at DESC)`

**Policies**

- `tenant_read` — SELECT USING `(org_id IN ( SELECT user_org_ids() AS user_org_ids))`
- `tenant_write` — ALL USING `has_org_role(org_id, 'member'::org_role)` WITH CHECK `has_org_role(org_id, 'member'::org_role)`

**Triggers**

- `competitor_evidence_same_org`

## competitor_profiles

RLS: **enabled**

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` |
| `org_id` | uuid | NOT NULL |  |
| `competitor_id` | uuid | NOT NULL |  |
| `positioning` | text | null |  |
| `value_prop` | text | null |  |
| `target_markets` | text[] | NOT NULL | `'{}'::text[]` |
| `products` | jsonb | NOT NULL | `'[]'::jsonb` |
| `differentiators` | jsonb | NOT NULL | `'[]'::jsonb` |
| `pricing_model` | text | null |  |
| `pricing_detail` | text | null |  |
| `customer_examples` | jsonb | NOT NULL | `'[]'::jsonb` |
| `strengths` | jsonb | NOT NULL | `'[]'::jsonb` |
| `weaknesses` | jsonb | NOT NULL | `'[]'::jsonb` |
| `claims` | jsonb | NOT NULL | `'{}'::jsonb` |
| `icp_overlap` | jsonb | NOT NULL | `'[]'::jsonb` |
| `ai_run_id` | uuid | null |  |
| `researched_at` | timestamp with time zone | NOT NULL | `now()` |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |
| `updated_at` | timestamp with time zone | NOT NULL | `now()` |

**Constraints**

- FK `competitor_profiles_ai_run_id_fkey` — `FOREIGN KEY (ai_run_id) REFERENCES ai_runs(id) ON DELETE SET NULL`
- FK `competitor_profiles_competitor_id_fkey` — `FOREIGN KEY (competitor_id) REFERENCES competitors(id) ON DELETE CASCADE`
- FK `competitor_profiles_org_id_fkey` — `FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE`
- PK `competitor_profiles_pkey` — `PRIMARY KEY (id)`
- UNIQUE `competitor_profiles_org_id_competitor_id_key` — `UNIQUE (org_id, competitor_id)`

**Policies**

- `tenant_read` — SELECT USING `(org_id IN ( SELECT user_org_ids() AS user_org_ids))`
- `tenant_write` — ALL USING `has_org_role(org_id, 'member'::org_role)` WITH CHECK `has_org_role(org_id, 'member'::org_role)`

**Triggers**

- `competitor_profiles_same_org`
- `competitor_profiles_touch`

## competitors

RLS: **enabled**

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` |
| `org_id` | uuid | NOT NULL |  |
| `company_id` | uuid | null |  |
| `name` | text | NOT NULL |  |
| `domain` | text | null |  |
| `origin` | text | NOT NULL | `'user'::text` |
| `status` | text | NOT NULL | `'active'::text` |
| `tier` | text | null |  |
| `our_advantage` | text | null |  |
| `their_advantage` | text | null |  |
| `last_researched_at` | timestamp with time zone | null |  |
| `created_by` | uuid | null |  |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |
| `updated_at` | timestamp with time zone | NOT NULL | `now()` |
| `deleted_at` | timestamp with time zone | null |  |
| `research_requested_at` | timestamp with time zone | null |  |
| `prospect_customers` | boolean | NOT NULL | `false` |
| `customers_sought_at` | timestamp with time zone | null |  |

**Constraints**

- CHECK `competitors_origin_check` — `CHECK ((origin = ANY (ARRAY['user'::text, 'onboarding'::text, 'discovered'::text, 'mention'::text])))`
- CHECK `competitors_status_check` — `CHECK ((status = ANY (ARRAY['proposed'::text, 'active'::text, 'dismissed'::text])))`
- CHECK `competitors_tier_check` — `CHECK (((tier IS NULL) OR (tier = ANY (ARRAY['direct'::text, 'adjacent'::text, 'incumbent'::text, 'diy'::text]))))`
- FK `competitors_company_id_fkey` — `FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL`
- FK `competitors_created_by_fkey` — `FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL`
- FK `competitors_org_id_fkey` — `FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE`
- PK `competitors_pkey` — `PRIMARY KEY (id)`

**Indexes**

- `competitors_domain_idx` — `UNIQUE competitors USING btree (org_id, domain) WHERE ((domain IS NOT NULL) AND (deleted_at IS NULL))`
- `competitors_name_idx` — `UNIQUE competitors USING btree (org_id, lower(name)) WHERE (deleted_at IS NULL)`
- `competitors_prospect_idx` — `competitors USING btree (org_id) WHERE (prospect_customers AND (deleted_at IS NULL) AND (status = 'active'::text))`
- `competitors_research_requested_idx` — `competitors USING btree (research_requested_at) WHERE ((research_requested_at IS NOT NULL) AND (deleted_at IS NULL))`
- `competitors_status_idx` — `competitors USING btree (org_id, status) WHERE (deleted_at IS NULL)`

**Policies**

- `tenant_read` — SELECT USING `(org_id IN ( SELECT user_org_ids() AS user_org_ids))`
- `tenant_write` — ALL USING `has_org_role(org_id, 'member'::org_role)` WITH CHECK `has_org_role(org_id, 'member'::org_role)`

**Triggers**

- `competitors_same_org`
- `competitors_touch`

## contact_fit_scores

RLS: **enabled**

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` |
| `org_id` | uuid | NOT NULL |  |
| `person_id` | uuid | NOT NULL |  |
| `icp_id` | uuid | null |  |
| `icp_version_id` | uuid | null |  |
| `persona_id` | uuid | null |  |
| `score` | integer | NOT NULL |  |
| `base_score` | integer | null |  |
| `dimensions` | jsonb | NOT NULL | `'{}'::jsonb` |
| `rule_trace` | jsonb | NOT NULL | `'[]'::jsonb` |
| `confidence` | confidence | NOT NULL | `'medium'::confidence` |
| `reason` | text | NOT NULL |  |
| `recommended_angle` | text | null |  |
| `computed_at` | timestamp with time zone | NOT NULL | `now()` |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |

**Constraints**

- CHECK `contact_fit_scores_base_score_check` — `CHECK (((base_score IS NULL) OR ((base_score >= 0) AND (base_score <= 100))))`
- CHECK `contact_fit_scores_score_check` — `CHECK (((score >= 0) AND (score <= 100)))`
- FK `contact_fit_scores_icp_id_fkey` — `FOREIGN KEY (icp_id) REFERENCES icps(id) ON DELETE SET NULL`
- FK `contact_fit_scores_icp_version_id_fkey` — `FOREIGN KEY (icp_version_id) REFERENCES icp_versions(id) ON DELETE SET NULL`
- FK `contact_fit_scores_org_id_fkey` — `FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE`
- FK `contact_fit_scores_person_id_fkey` — `FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE`
- FK `contact_fit_scores_persona_id_fkey` — `FOREIGN KEY (persona_id) REFERENCES personas(id) ON DELETE SET NULL`
- PK `contact_fit_scores_pkey` — `PRIMARY KEY (id)`

**Indexes**

- `contact_fit_current_idx` — `contact_fit_scores USING btree (org_id, person_id, computed_at DESC)`
- `contact_fit_ranking_idx` — `contact_fit_scores USING btree (org_id, icp_id, score DESC, computed_at DESC)`

**Policies**

- `tenant_read` — SELECT USING `(org_id IN ( SELECT user_org_ids() AS user_org_ids))`
- `tenant_write` — ALL USING `has_org_role(org_id, 'member'::org_role)` WITH CHECK `has_org_role(org_id, 'member'::org_role)`

**Triggers**

- `contact_fit_scores_same_org`

## contact_frequency

RLS: **enabled**

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` |
| `org_id` | uuid | NOT NULL |  |
| `email` | text | NOT NULL |  |
| `last_sent_at` | timestamp with time zone | null |  |
| `sends_total` | integer | NOT NULL | `0` |
| `sends_30d` | integer | NOT NULL | `0` |
| `window_start` | timestamp with time zone | NOT NULL | `now()` |
| `last_reply_at` | timestamp with time zone | null |  |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |
| `updated_at` | timestamp with time zone | NOT NULL | `now()` |

**Constraints**

- CHECK `contact_frequency_sends_30d_check` — `CHECK ((sends_30d >= 0))`
- CHECK `contact_frequency_sends_total_check` — `CHECK ((sends_total >= 0))`
- FK `contact_frequency_org_id_fkey` — `FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE`
- PK `contact_frequency_pkey` — `PRIMARY KEY (id)`
- UNIQUE `contact_frequency_org_id_email_key` — `UNIQUE (org_id, email)`

**Indexes**

- `contact_frequency_recent_idx` — `contact_frequency USING btree (org_id, last_sent_at DESC)`

**Policies**

- `tenant_read` — SELECT USING `(org_id IN ( SELECT user_org_ids() AS user_org_ids))`
- `tenant_write` — ALL USING `has_org_role(org_id, 'member'::org_role)` WITH CHECK `has_org_role(org_id, 'member'::org_role)`

**Triggers**

- `contact_frequency_touch`

## contact_points

RLS: **enabled**

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` |
| `org_id` | uuid | NOT NULL |  |
| `person_id` | uuid | NOT NULL |  |
| `kind` | text | NOT NULL |  |
| `value` | text | NOT NULL |  |
| `verification_status` | text | NOT NULL | `'unverified'::text` |
| `confidence` | confidence | null |  |
| `provider` | text | null |  |
| `verified_at` | timestamp with time zone | null |  |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |
| `updated_at` | timestamp with time zone | NOT NULL | `now()` |
| `deleted_at` | timestamp with time zone | null |  |

**Constraints**

- CHECK `contact_points_kind_check` — `CHECK ((kind = ANY (ARRAY['email'::text, 'phone'::text, 'linkedin'::text])))`
- CHECK `contact_points_verification_status_check` — `CHECK (((verification_status IS NULL) OR (verification_status = ANY (ARRAY['unverified'::text, 'provider_verified'::text, 'deliverable'::text, 'risky'::text, 'undeliverable'::text, 'unknown'::text]))))`
- FK `contact_points_org_id_fkey` — `FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE`
- FK `contact_points_person_id_fkey` — `FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE`
- PK `contact_points_pkey` — `PRIMARY KEY (id)`
- UNIQUE `contact_points_org_id_kind_value_key` — `UNIQUE (org_id, kind, value)`

**Indexes**

- `contact_points_person_idx` — `contact_points USING btree (org_id, person_id) WHERE (deleted_at IS NULL)`

**Policies**

- `tenant_read` — SELECT USING `(org_id IN ( SELECT user_org_ids() AS user_org_ids))`
- `tenant_write` — ALL USING `has_org_role(org_id, 'member'::org_role)` WITH CHECK `has_org_role(org_id, 'member'::org_role)`

**Triggers**

- `contact_points_same_org`
- `contact_points_touch`

## conversation_messages

RLS: **enabled**

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` |
| `org_id` | uuid | NOT NULL |  |
| `conversation_id` | uuid | NOT NULL |  |
| `role` | text | NOT NULL |  |
| `content` | text | NOT NULL |  |
| `ai_run_id` | uuid | null |  |
| `cited_evidence_ids` | uuid[] | NOT NULL | `'{}'::uuid[]` |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |
| `updated_at` | timestamp with time zone | NOT NULL | `now()` |
| `citations` | jsonb | NOT NULL | `'[]'::jsonb` |
| `actions` | jsonb | NOT NULL | `'[]'::jsonb` |
| `applied_memory_ids` | uuid[] | NOT NULL | `'{}'::uuid[]` |

**Constraints**

- CHECK `conversation_messages_role_check` — `CHECK ((role = ANY (ARRAY['user'::text, 'assistant'::text, 'system'::text])))`
- FK `conversation_messages_conversation_id_fkey` — `FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE`
- FK `conversation_messages_org_id_fkey` — `FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE`
- PK `conversation_messages_pkey` — `PRIMARY KEY (id)`

**Indexes**

- `conversation_messages_idx` — `conversation_messages USING btree (org_id, conversation_id, created_at)`

**Policies**

- `conversation_messages_owner` — ALL USING `((org_id IN ( SELECT user_org_ids() AS user_org_ids)) AND (conversation_id IN ( SELECT conversations.id    FROM conversations   WHERE (conversations.user_id = auth.uid()))))` WITH CHECK `((org_id IN ( SELECT user_org_ids() AS user_org_ids)) AND (conversation_id IN ( SELECT conversations.id    FROM conversations   WHERE (conversations.user_id = auth.uid()))))`

**Triggers**

- `conversation_messages_same_org`
- `conversation_messages_touch`

## conversations

RLS: **enabled**

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` |
| `org_id` | uuid | NOT NULL |  |
| `opportunity_id` | uuid | null |  |
| `user_id` | uuid | NOT NULL |  |
| `title` | text | null |  |
| `last_message_at` | timestamp with time zone | null |  |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |
| `updated_at` | timestamp with time zone | NOT NULL | `now()` |
| `deleted_at` | timestamp with time zone | null |  |
| `scope` | text | NOT NULL | `'opportunity'::text` |
| `product_id` | uuid | null |  |

**Constraints**

- CHECK `conversations_scope_check` — `CHECK ((scope = ANY (ARRAY['opportunity'::text, 'workspace'::text])))`
- CHECK `conversations_scope_subject` — `CHECK (((scope = 'opportunity'::text) = (opportunity_id IS NOT NULL)))`
- FK `conversations_opportunity_id_fkey` — `FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE`
- FK `conversations_org_id_fkey` — `FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE`
- FK `conversations_product_id_fkey` — `FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL`
- FK `conversations_user_id_fkey` — `FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE`
- PK `conversations_pkey` — `PRIMARY KEY (id)`
- UNIQUE `conversations_org_id_opportunity_id_user_id_key` — `UNIQUE (org_id, opportunity_id, user_id)`

**Indexes**

- `conversations_workspace_recent_idx` — `conversations USING btree (org_id, user_id, last_message_at DESC NULLS LAST) WHERE ((scope = 'workspace'::text) AND (deleted_at IS NULL))`

**Policies**

- `conversation_owner` — ALL USING `((user_id = auth.uid()) AND (org_id IN ( SELECT user_org_ids() AS user_org_ids)))` WITH CHECK `((user_id = auth.uid()) AND (org_id IN ( SELECT user_org_ids() AS user_org_ids)))`

**Triggers**

- `conversations_same_org`
- `conversations_touch`

## demand_signals

RLS: **enabled**

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` |
| `org_id` | uuid | NOT NULL |  |
| `kind` | text | NOT NULL |  |
| `statement` | text | NOT NULL |  |
| `source_type` | text | NOT NULL |  |
| `source_id` | uuid | NOT NULL |  |
| `opportunity_id` | uuid | null |  |
| `company_id` | uuid | null |  |
| `claim_kind` | claim_kind | NOT NULL | `'inference'::claim_kind` |
| `theme_id` | uuid | null |  |
| `clustered_at` | timestamp with time zone | null |  |
| `occurred_at` | timestamp with time zone | NOT NULL | `now()` |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |

**Constraints**

- CHECK `demand_signals_kind_check` — `CHECK ((kind = ANY (ARRAY['request'::text, 'objection'::text, 'blocker'::text])))`
- CHECK `demand_signals_source_type_check` — `CHECK ((source_type = ANY (ARRAY['reply'::text, 'outcome'::text, 'note'::text])))`
- CHECK `demand_signals_statement_check` — `CHECK (((length(statement) >= 1) AND (length(statement) <= 500)))`
- FK `demand_signals_company_id_fkey` — `FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL`
- FK `demand_signals_opportunity_id_fkey` — `FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE SET NULL`
- FK `demand_signals_org_id_fkey` — `FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE`
- FK `demand_signals_theme_id_fkey` — `FOREIGN KEY (theme_id) REFERENCES demand_themes(id) ON DELETE SET NULL`
- PK `demand_signals_pkey` — `PRIMARY KEY (id)`
- UNIQUE `demand_signals_org_id_source_type_source_id_statement_key` — `UNIQUE (org_id, source_type, source_id, statement)`

**Indexes**

- `demand_signals_opportunity_idx` — `demand_signals USING btree (org_id, opportunity_id) WHERE (opportunity_id IS NOT NULL)`
- `demand_signals_theme_idx` — `demand_signals USING btree (org_id, theme_id)`
- `demand_signals_unclustered_idx` — `demand_signals USING btree (org_id, created_at) WHERE ((clustered_at IS NULL) AND (theme_id IS NULL))`

**Policies**

- `tenant_read` — SELECT USING `(org_id IN ( SELECT user_org_ids() AS user_org_ids))`
- `tenant_write` — ALL USING `has_org_role(org_id, 'member'::org_role)` WITH CHECK `has_org_role(org_id, 'member'::org_role)`

**Triggers**

- `demand_signals_same_org`

## demand_state

RLS: **enabled**

| Column | Type | Null | Default |
|---|---|---|---|
| `org_id` | uuid | NOT NULL |  |
| `requested_at` | timestamp with time zone | null |  |
| `last_clustered_at` | timestamp with time zone | null |  |
| `updated_at` | timestamp with time zone | NOT NULL | `now()` |

**Constraints**

- FK `demand_state_org_id_fkey` — `FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE`
- PK `demand_state_pkey` — `PRIMARY KEY (org_id)`

**Policies**

- `tenant_read` — SELECT USING `(org_id IN ( SELECT user_org_ids() AS user_org_ids))`
- `tenant_write` — ALL USING `has_org_role(org_id, 'member'::org_role)` WITH CHECK `has_org_role(org_id, 'member'::org_role)`

**Triggers**

- `demand_state_touch`

## demand_themes

RLS: **enabled**

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` |
| `org_id` | uuid | NOT NULL |  |
| `title` | text | NOT NULL |  |
| `description` | text | null |  |
| `kind` | text | NOT NULL | `'request'::text` |
| `status` | text | NOT NULL | `'proposed'::text` |
| `merged_into` | uuid | null |  |
| `origin` | text | NOT NULL | `'model'::text` |
| `shipped_at` | timestamp with time zone | null |  |
| `decided_by` | uuid | null |  |
| `decided_at` | timestamp with time zone | null |  |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |
| `updated_at` | timestamp with time zone | NOT NULL | `now()` |

**Constraints**

- CHECK `demand_themes_description_check` — `CHECK (((description IS NULL) OR (length(description) <= 1000)))`
- CHECK `demand_themes_kind_check` — `CHECK ((kind = ANY (ARRAY['request'::text, 'objection'::text, 'blocker'::text])))`
- CHECK `demand_themes_origin_check` — `CHECK ((origin = ANY (ARRAY['model'::text, 'user'::text])))`
- CHECK `demand_themes_status_check` — `CHECK ((status = ANY (ARRAY['proposed'::text, 'open'::text, 'planned'::text, 'shipped'::text, 'wont'::text, 'rejected'::text, 'merged'::text])))`
- CHECK `demand_themes_title_check` — `CHECK (((length(title) >= 1) AND (length(title) <= 160)))`
- FK `demand_themes_decided_by_fkey` — `FOREIGN KEY (decided_by) REFERENCES auth.users(id) ON DELETE SET NULL`
- FK `demand_themes_merged_into_fkey` — `FOREIGN KEY (merged_into) REFERENCES demand_themes(id) ON DELETE SET NULL`
- FK `demand_themes_org_id_fkey` — `FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE`
- PK `demand_themes_pkey` — `PRIMARY KEY (id)`

**Indexes**

- `demand_themes_org_idx` — `demand_themes USING btree (org_id, status, updated_at DESC)`

**Policies**

- `tenant_read` — SELECT USING `(org_id IN ( SELECT user_org_ids() AS user_org_ids))`
- `tenant_write` — ALL USING `has_org_role(org_id, 'member'::org_role)` WITH CHECK `has_org_role(org_id, 'member'::org_role)`

**Triggers**

- `demand_themes_same_org`
- `demand_themes_touch`

## discovery_queries

RLS: **enabled**

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` |
| `org_id` | uuid | NOT NULL |  |
| `icp_id` | uuid | null |  |
| `icp_version_id` | uuid | null |  |
| `name` | text | null |  |
| `filters` | jsonb | NOT NULL | `'{}'::jsonb` |
| `filters_hash` | text | NOT NULL |  |
| `unmappable` | jsonb | NOT NULL | `'[]'::jsonb` |
| `is_saved` | boolean | NOT NULL | `false` |
| `is_enabled` | boolean | NOT NULL | `false` |
| `interval_minutes` | integer | null |  |
| `next_run_at` | timestamp with time zone | null |  |
| `credit_budget` | integer | NOT NULL | `100` |
| `max_pages` | integer | NOT NULL | `5` |
| `created_by` | uuid | null |  |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |
| `updated_at` | timestamp with time zone | NOT NULL | `now()` |
| `deleted_at` | timestamp with time zone | null |  |

**Constraints**

- CHECK `discovery_queries_credit_budget_check` — `CHECK ((credit_budget >= 0))`
- CHECK `discovery_queries_interval_minutes_check` — `CHECK (((interval_minutes IS NULL) OR (interval_minutes >= 60)))`
- CHECK `discovery_queries_max_pages_check` — `CHECK (((max_pages >= 1) AND (max_pages <= 100)))`
- FK `discovery_queries_created_by_fkey` — `FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL`
- FK `discovery_queries_icp_id_fkey` — `FOREIGN KEY (icp_id) REFERENCES icps(id) ON DELETE SET NULL`
- FK `discovery_queries_icp_version_id_fkey` — `FOREIGN KEY (icp_version_id) REFERENCES icp_versions(id) ON DELETE SET NULL`
- FK `discovery_queries_org_id_fkey` — `FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE`
- PK `discovery_queries_pkey` — `PRIMARY KEY (id)`
- UNIQUE `discovery_queries_org_id_filters_hash_key` — `UNIQUE (org_id, filters_hash)`

**Indexes**

- `discovery_queries_due_idx` — `discovery_queries USING btree (next_run_at) WHERE ((is_enabled = true) AND (deleted_at IS NULL))`
- `discovery_queries_saved_idx` — `discovery_queries USING btree (org_id, updated_at DESC) WHERE ((is_saved = true) AND (deleted_at IS NULL))`

**Policies**

- `tenant_read` — SELECT USING `(org_id IN ( SELECT user_org_ids() AS user_org_ids))`
- `tenant_write` — ALL USING `has_org_role(org_id, 'member'::org_role)` WITH CHECK `has_org_role(org_id, 'member'::org_role)`

**Triggers**

- `discovery_queries_same_org`
- `discovery_queries_touch`

## discovery_results

RLS: **enabled**

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` |
| `org_id` | uuid | NOT NULL |  |
| `run_id` | uuid | NOT NULL |  |
| `query_id` | uuid | null |  |
| `provider` | text | null |  |
| `provider_id` | text | null |  |
| `raw_name` | text | null |  |
| `raw_domain` | text | null |  |
| `rank` | integer | null |  |
| `outcome` | text | NOT NULL |  |
| `exclusion_reason` | text | null |  |
| `company_id` | uuid | null |  |
| `matched_filters` | jsonb | NOT NULL | `'[]'::jsonb` |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |

**Constraints**

- CHECK `discovery_results_outcome_check` — `CHECK ((outcome = ANY (ARRAY['new'::text, 'matched'::text, 'excluded'::text, 'suppressed'::text, 'invalid'::text])))`
- CHECK `discovery_results_rank_check` — `CHECK (((rank IS NULL) OR (rank >= 0)))`
- FK `discovery_results_company_id_fkey` — `FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL`
- FK `discovery_results_org_id_fkey` — `FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE`
- FK `discovery_results_query_id_fkey` — `FOREIGN KEY (query_id) REFERENCES discovery_queries(id) ON DELETE SET NULL`
- FK `discovery_results_run_id_fkey` — `FOREIGN KEY (run_id) REFERENCES discovery_runs(id) ON DELETE CASCADE`
- PK `discovery_results_pkey` — `PRIMARY KEY (id)`
- UNIQUE `discovery_results_run_id_provider_provider_id_key` — `UNIQUE (run_id, provider, provider_id)`

**Indexes**

- `discovery_results_company_idx` — `discovery_results USING btree (org_id, company_id) WHERE (company_id IS NOT NULL)`
- `discovery_results_run_idx` — `discovery_results USING btree (run_id, rank)`
- `discovery_results_seen_idx` — `discovery_results USING btree (org_id, provider, provider_id)`

**Policies**

- `tenant_read` — SELECT USING `(org_id IN ( SELECT user_org_ids() AS user_org_ids))`
- `tenant_write` — ALL USING `has_org_role(org_id, 'member'::org_role)` WITH CHECK `has_org_role(org_id, 'member'::org_role)`

**Triggers**

- `discovery_results_same_org`

## discovery_runs

RLS: **enabled**

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` |
| `org_id` | uuid | NOT NULL |  |
| `channel` | text | NOT NULL |  |
| `query_id` | uuid | null |  |
| `source_id` | uuid | null |  |
| `provider` | text | null |  |
| `status` | text | NOT NULL | `'queued'::text` |
| `stop_reason` | text | null |  |
| `page_cursor` | text | null |  |
| `pages_fetched` | integer | NOT NULL | `0` |
| `total_available` | bigint | null |  |
| `results_returned` | integer | NOT NULL | `0` |
| `companies_new` | integer | NOT NULL | `0` |
| `companies_matched` | integer | NOT NULL | `0` |
| `results_excluded` | integer | NOT NULL | `0` |
| `credits_spent` | integer | NOT NULL | `0` |
| `error` | text | null |  |
| `requested_by` | uuid | null |  |
| `trigger` | text | NOT NULL | `'manual'::text` |
| `started_at` | timestamp with time zone | null |  |
| `finished_at` | timestamp with time zone | null |  |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |
| `updated_at` | timestamp with time zone | NOT NULL | `now()` |

**Constraints**

- CHECK `discovery_runs_channel_check` — `CHECK ((channel = ANY (ARRAY['provider'::text, 'source'::text, 'import'::text])))`
- CHECK `discovery_runs_channel_target` — `CHECK ((((channel = 'provider'::text) AND (query_id IS NOT NULL) AND (source_id IS NULL)) OR ((channel = 'source'::text) AND (source_id IS NOT NULL)) OR (channel = 'import'::text)))`
- CHECK `discovery_runs_companies_matched_check` — `CHECK ((companies_matched >= 0))`
- CHECK `discovery_runs_companies_new_check` — `CHECK ((companies_new >= 0))`
- CHECK `discovery_runs_credits_spent_check` — `CHECK ((credits_spent >= 0))`
- CHECK `discovery_runs_pages_fetched_check` — `CHECK ((pages_fetched >= 0))`
- CHECK `discovery_runs_results_excluded_check` — `CHECK ((results_excluded >= 0))`
- CHECK `discovery_runs_results_returned_check` — `CHECK ((results_returned >= 0))`
- CHECK `discovery_runs_status_check` — `CHECK ((status = ANY (ARRAY['queued'::text, 'running'::text, 'succeeded'::text, 'partial'::text, 'failed'::text, 'refused'::text])))`
- CHECK `discovery_runs_stop_reason_check` — `CHECK (((stop_reason IS NULL) OR (stop_reason = ANY (ARRAY['exhausted'::text, 'page_cap'::text, 'credit_budget'::text, 'org_budget'::text, 'breaker_open'::text, 'no_provider'::text, 'provider_error'::text, 'timeout'::text, 'cancelled'::text]))))`
- CHECK `discovery_runs_total_available_check` — `CHECK (((total_available IS NULL) OR (total_available >= 0)))`
- CHECK `discovery_runs_trigger_check` — `CHECK ((trigger = ANY (ARRAY['manual'::text, 'scheduled'::text, 'onboarding'::text])))`
- FK `discovery_runs_org_id_fkey` — `FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE`
- FK `discovery_runs_query_id_fkey` — `FOREIGN KEY (query_id) REFERENCES discovery_queries(id) ON DELETE SET NULL`
- FK `discovery_runs_requested_by_fkey` — `FOREIGN KEY (requested_by) REFERENCES auth.users(id) ON DELETE SET NULL`
- FK `discovery_runs_source_id_fkey` — `FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE SET NULL`
- PK `discovery_runs_pkey` — `PRIMARY KEY (id)`

**Indexes**

- `discovery_runs_one_open_per_query` — `UNIQUE discovery_runs USING btree (query_id) WHERE ((status = ANY (ARRAY['queued'::text, 'running'::text])) AND (query_id IS NOT NULL))`
- `discovery_runs_query_idx` — `discovery_runs USING btree (org_id, query_id, created_at DESC)`
- `discovery_runs_recent_idx` — `discovery_runs USING btree (org_id, created_at DESC)`

**Policies**

- `tenant_read` — SELECT USING `(org_id IN ( SELECT user_org_ids() AS user_org_ids))`
- `tenant_write` — ALL USING `has_org_role(org_id, 'member'::org_role)` WITH CHECK `has_org_role(org_id, 'member'::org_role)`

**Triggers**

- `discovery_runs_same_org`
- `discovery_runs_touch`

## enrichment_records

RLS: **enabled**

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` |
| `org_id` | uuid | NOT NULL |  |
| `entity_type` | text | NOT NULL |  |
| `entity_id` | uuid | NOT NULL |  |
| `provider` | text | NOT NULL |  |
| `field` | text | NOT NULL |  |
| `value` | text | null |  |
| `confidence` | confidence | null |  |
| `cost_cents` | integer | NOT NULL | `0` |
| `raw` | jsonb | null |  |
| `fetched_at` | timestamp with time zone | NOT NULL | `now()` |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |
| `updated_at` | timestamp with time zone | NOT NULL | `now()` |

**Constraints**

- FK `enrichment_records_org_id_fkey` — `FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE`
- PK `enrichment_records_pkey` — `PRIMARY KEY (id)`

**Indexes**

- `enrichment_entity_idx` — `enrichment_records USING btree (org_id, entity_type, entity_id, field, fetched_at DESC)`

**Policies**

- `tenant_read` — SELECT USING `(org_id IN ( SELECT user_org_ids() AS user_org_ids))`
- `tenant_write` — ALL USING `has_org_role(org_id, 'member'::org_role)` WITH CHECK `has_org_role(org_id, 'member'::org_role)`

**Triggers**

- `enrichment_records_touch`

## enrollments

RLS: **enabled**

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` |
| `org_id` | uuid | NOT NULL |  |
| `campaign_id` | uuid | NOT NULL |  |
| `opportunity_id` | uuid | NOT NULL |  |
| `status` | text | NOT NULL | `'active'::text` |
| `current_step` | integer | NOT NULL | `0` |
| `next_action_at` | timestamp with time zone | null |  |
| `parked_reason` | text | null |  |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |
| `updated_at` | timestamp with time zone | NOT NULL | `now()` |
| `deleted_at` | timestamp with time zone | null |  |
| `last_step_at` | timestamp with time zone | null |  |
| `mailbox_id` | uuid | null |  |
| `redraft_note` | text | null |  |

**Constraints**

- CHECK `enrollments_redraft_note_check` — `CHECK (((redraft_note IS NULL) OR (length(redraft_note) <= 500)))`
- FK `enrollments_campaign_id_fkey` — `FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE`
- FK `enrollments_mailbox_id_fkey` — `FOREIGN KEY (mailbox_id) REFERENCES mailboxes(id) ON DELETE SET NULL`
- FK `enrollments_opportunity_id_fkey` — `FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE`
- FK `enrollments_org_id_fkey` — `FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE`
- PK `enrollments_pkey` — `PRIMARY KEY (id)`
- UNIQUE `enrollments_org_id_campaign_id_opportunity_id_key` — `UNIQUE (org_id, campaign_id, opportunity_id)`

**Indexes**

- `enrollments_due_idx` — `enrollments USING btree (org_id, next_action_at) WHERE (status = 'active'::text)`

**Policies**

- `tenant_read` — SELECT USING `(org_id IN ( SELECT user_org_ids() AS user_org_ids))`
- `tenant_write` — ALL USING `has_org_role(org_id, 'member'::org_role)` WITH CHECK `has_org_role(org_id, 'member'::org_role)`

**Triggers**

- `enrollments_same_org`
- `enrollments_touch`

## events

RLS: **enabled**

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` |
| `org_id` | uuid | NOT NULL |  |
| `user_id` | uuid | null |  |
| `name` | text | NOT NULL |  |
| `properties` | jsonb | NOT NULL | `'{}'::jsonb` |
| `occurred_at` | timestamp with time zone | NOT NULL | `now()` |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |
| `updated_at` | timestamp with time zone | NOT NULL | `now()` |

**Constraints**

- FK `events_org_id_fkey` — `FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE`
- FK `events_user_id_fkey` — `FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL`
- PK `events_pkey` — `PRIMARY KEY (id)`

**Indexes**

- `events_idx` — `events USING btree (org_id, name, occurred_at DESC)`

**Policies**

- `tenant_read` — SELECT USING `(org_id IN ( SELECT user_org_ids() AS user_org_ids))`
- `tenant_write` — ALL USING `has_org_role(org_id, 'member'::org_role)` WITH CHECK `has_org_role(org_id, 'member'::org_role)`

**Triggers**

- `events_touch`

## evidence

RLS: **enabled**

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` |
| `org_id` | uuid | NOT NULL |  |
| `subject_type` | text | NOT NULL |  |
| `subject_id` | uuid | NOT NULL |  |
| `claim` | text | NOT NULL |  |
| `kind` | claim_kind | NOT NULL |  |
| `confidence` | confidence | null |  |
| `source_id` | uuid | null |  |
| `source_url` | text | null |  |
| `excerpt` | text | null |  |
| `event_date` | timestamp with time zone | null |  |
| `observed_at` | timestamp with time zone | NOT NULL | `now()` |
| `superseded_by` | uuid | null |  |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |
| `updated_at` | timestamp with time zone | NOT NULL | `now()` |
| `deleted_at` | timestamp with time zone | null |  |
| `reliability` | text | null |  |
| `field` | text | null |  |
| `contradicted` | boolean | NOT NULL | `false` |
| `claim_hash` | text | null | `md5(btrim(regexp_replace(regexp_replace(lower(claim), '[^a-z0-9 ]'::text, ' '::text, 'g'::text), '\s+'::text, ' '::text, 'g'::text)))` |
| `live_source_key` | text | null | ` CASE     WHEN ((field IS NOT NULL) AND (deleted_at IS NULL)) THEN ((COALESCE((source_id)::text, ''::text) \|\| '\|'::text) \|\| COALESCE(source_url, ''::text))     ELSE NULL::text END` |

**Constraints**

- CHECK `evidence_fact_needs_source` — `CHECK (((kind <> 'fact'::claim_kind) OR (source_url IS NOT NULL)))`
- CHECK `evidence_reliability_check` — `CHECK (((reliability IS NULL) OR (reliability = ANY (ARRAY['first_party'::text, 'provider_attested'::text, 'press'::text, 'user_asserted'::text, 'inferred'::text]))))`
- CHECK `evidence_subject_type_check` — `CHECK ((subject_type = ANY (ARRAY['company'::text, 'opportunity'::text, 'contact'::text, 'signal'::text, 'competitor'::text])))`
- CHECK `evidence_unknown_has_no_confidence` — `CHECK (((kind <> 'unknown'::claim_kind) OR (confidence IS NULL)))`
- FK `evidence_org_id_fkey` — `FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE`
- FK `evidence_source_id_fkey` — `FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE SET NULL`
- FK `evidence_superseded_by_fkey` — `FOREIGN KEY (superseded_by) REFERENCES evidence(id) ON DELETE SET NULL`
- PK `evidence_pkey` — `PRIMARY KEY (id)`

**Indexes**

- `evidence_claim_hash_idx` — `evidence USING btree (org_id, subject_type, subject_id, claim_hash) WHERE (deleted_at IS NULL)`
- `evidence_competitor_idx` — `evidence USING btree (org_id, subject_id, observed_at DESC) WHERE ((subject_type = 'competitor'::text) AND (deleted_at IS NULL))`
- `evidence_field_idx` — `evidence USING btree (org_id, subject_type, subject_id, field) WHERE ((field IS NOT NULL) AND (deleted_at IS NULL))`
- `evidence_live_source_key_uidx` — `UNIQUE evidence USING btree (org_id, subject_type, subject_id, field, live_source_key)`
- `evidence_one_per_source_field` — `UNIQUE evidence USING btree (org_id, subject_type, subject_id, field, COALESCE((source_id)::text, ''::text), COALESCE(source_url, ''::text)) WHERE ((field IS NOT NULL) AND (deleted_at IS NULL))`
- `evidence_subject_idx` — `evidence USING btree (org_id, subject_type, subject_id, event_date DESC) WHERE ((deleted_at IS NULL) AND (superseded_by IS NULL))`

**Policies**

- `tenant_read` — SELECT USING `(org_id IN ( SELECT user_org_ids() AS user_org_ids))`
- `tenant_write` — ALL USING `has_org_role(org_id, 'member'::org_role)` WITH CHECK `has_org_role(org_id, 'member'::org_role)`

**Triggers**

- `evidence_same_org`
- `evidence_touch`

## evidence_citations

RLS: **enabled**

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` |
| `org_id` | uuid | NOT NULL |  |
| `evidence_id` | uuid | NOT NULL |  |
| `source_id` | uuid | null |  |
| `source_url` | text | null |  |
| `excerpt` | text | null |  |
| `observed_at` | timestamp with time zone | NOT NULL | `now()` |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |

**Constraints**

- FK `evidence_citations_evidence_id_fkey` — `FOREIGN KEY (evidence_id) REFERENCES evidence(id) ON DELETE CASCADE`
- FK `evidence_citations_org_id_fkey` — `FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE`
- FK `evidence_citations_source_id_fkey` — `FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE SET NULL`
- PK `evidence_citations_pkey` — `PRIMARY KEY (id)`

**Indexes**

- `evidence_citations_evidence_idx` — `evidence_citations USING btree (org_id, evidence_id, observed_at DESC)`
- `evidence_citations_unique_source` — `UNIQUE evidence_citations USING btree (org_id, evidence_id, COALESCE((source_id)::text, ''::text), COALESCE(source_url, ''::text))`

**Policies**

- `tenant_read` — SELECT USING `(org_id IN ( SELECT user_org_ids() AS user_org_ids))`

## external_ids

RLS: **enabled**

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` |
| `org_id` | uuid | NOT NULL |  |
| `entity_type` | text | NOT NULL |  |
| `entity_id` | uuid | NOT NULL |  |
| `provider` | text | NOT NULL |  |
| `provider_id` | text | NOT NULL |  |
| `provider_updated_at` | timestamp with time zone | null |  |
| `first_seen_at` | timestamp with time zone | NOT NULL | `now()` |
| `last_seen_at` | timestamp with time zone | NOT NULL | `now()` |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |
| `updated_at` | timestamp with time zone | NOT NULL | `now()` |

**Constraints**

- CHECK `external_ids_entity_type_check` — `CHECK ((entity_type = ANY (ARRAY['company'::text, 'person'::text, 'competitor'::text, 'opportunity'::text])))`
- FK `external_ids_org_id_fkey` — `FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE`
- PK `external_ids_pkey` — `PRIMARY KEY (id)`
- UNIQUE `external_ids_org_id_provider_provider_id_key` — `UNIQUE (org_id, provider, provider_id)`

**Indexes**

- `external_ids_entity_idx` — `external_ids USING btree (org_id, entity_type, entity_id)`

**Policies**

- `tenant_read` — SELECT USING `(org_id IN ( SELECT user_org_ids() AS user_org_ids))`
- `tenant_write` — ALL USING `has_org_role(org_id, 'member'::org_role)` WITH CHECK `has_org_role(org_id, 'member'::org_role)`

**Triggers**

- `external_ids_touch`

## hubspot_connections

RLS: **enabled**

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` |
| `org_id` | uuid | NOT NULL |  |
| `access_token` | text | NOT NULL |  |
| `hub_id` | text | null |  |
| `connected_by` | uuid | null |  |
| `connected_at` | timestamp with time zone | NOT NULL | `now()` |
| `last_synced_at` | timestamp with time zone | null |  |
| `last_sync_error` | text | null |  |
| `is_enabled` | boolean | NOT NULL | `true` |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |
| `updated_at` | timestamp with time zone | NOT NULL | `now()` |

**Constraints**

- FK `hubspot_connections_connected_by_fkey` — `FOREIGN KEY (connected_by) REFERENCES auth.users(id) ON DELETE SET NULL`
- FK `hubspot_connections_org_id_fkey` — `FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE`
- PK `hubspot_connections_pkey` — `PRIMARY KEY (id)`
- UNIQUE `hubspot_connections_org_id_key` — `UNIQUE (org_id)`

**Policies**

- `tenant_read` — SELECT USING `has_org_role(org_id, 'admin'::org_role)`
- `tenant_write` — ALL USING `has_org_role(org_id, 'admin'::org_role)` WITH CHECK `has_org_role(org_id, 'admin'::org_role)`

**Triggers**

- `hubspot_connections_touch`

## human_overrides

RLS: **enabled**

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` |
| `org_id` | uuid | NOT NULL |  |
| `subject` | text | NOT NULL |  |
| `entity_type` | text | NOT NULL |  |
| `entity_id` | uuid | NOT NULL |  |
| `system_value` | text | null |  |
| `human_value` | text | NOT NULL |  |
| `reason` | text | null |  |
| `score_id` | uuid | null |  |
| `actor_id` | uuid | null |  |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |
| `consumed_at` | timestamp with time zone | null |  |
| `consumed_by` | uuid | null |  |

**Constraints**

- CHECK `human_overrides_entity_type_check` — `CHECK ((entity_type = ANY (ARRAY['opportunity'::text, 'person'::text, 'company'::text])))`
- CHECK `human_overrides_subject_check` — `CHECK ((subject = ANY (ARRAY['opportunity_priority'::text, 'opportunity_score'::text, 'primary_contact'::text, 'contact_fit'::text, 'company_excluded'::text])))`
- FK `human_overrides_actor_id_fkey` — `FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE SET NULL`
- FK `human_overrides_consumed_by_fkey` — `FOREIGN KEY (consumed_by) REFERENCES learning_runs(id) ON DELETE SET NULL`
- FK `human_overrides_org_id_fkey` — `FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE`
- FK `human_overrides_score_id_fkey` — `FOREIGN KEY (score_id) REFERENCES opportunity_scores(id) ON DELETE SET NULL`
- PK `human_overrides_pkey` — `PRIMARY KEY (id)`

**Indexes**

- `human_overrides_entity_idx` — `human_overrides USING btree (org_id, entity_type, entity_id, created_at DESC)`
- `human_overrides_org_idx` — `human_overrides USING btree (org_id, created_at DESC)`
- `human_overrides_unconsumed_idx` — `human_overrides USING btree (org_id, created_at) WHERE (consumed_at IS NULL)`

**Policies**

- `tenant_read` — SELECT USING `(org_id IN ( SELECT user_org_ids() AS user_org_ids))`
- `tenant_write` — ALL USING `has_org_role(org_id, 'member'::org_role)` WITH CHECK `has_org_role(org_id, 'member'::org_role)`

**Triggers**

- `human_overrides_project_activity`
- `human_overrides_same_org`

## icp_versions

RLS: **enabled**

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` |
| `org_id` | uuid | NOT NULL |  |
| `icp_id` | uuid | NOT NULL |  |
| `version` | integer | NOT NULL |  |
| `name` | text | NOT NULL |  |
| `criteria` | jsonb | NOT NULL |  |
| `negative_criteria` | jsonb | NOT NULL | `'{}'::jsonb` |
| `personas` | jsonb | NOT NULL | `'[]'::jsonb` |
| `diff` | jsonb | NOT NULL | `'{}'::jsonb` |
| `quality` | integer | null |  |
| `created_by` | uuid | null |  |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |

**Constraints**

- CHECK `icp_versions_quality_check` — `CHECK (((quality IS NULL) OR ((quality >= 0) AND (quality <= 100))))`
- CHECK `icp_versions_version_check` — `CHECK ((version >= 1))`
- FK `icp_versions_created_by_fkey` — `FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL`
- FK `icp_versions_icp_id_fkey` — `FOREIGN KEY (icp_id) REFERENCES icps(id) ON DELETE CASCADE`
- FK `icp_versions_org_id_fkey` — `FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE`
- PK `icp_versions_pkey` — `PRIMARY KEY (id)`
- UNIQUE `icp_versions_org_id_icp_id_version_key` — `UNIQUE (org_id, icp_id, version)`

**Indexes**

- `icp_versions_recent_idx` — `icp_versions USING btree (org_id, icp_id, version DESC)`

**Policies**

- `tenant_read` — SELECT USING `(org_id IN ( SELECT user_org_ids() AS user_org_ids))`

## icps

RLS: **enabled**

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` |
| `org_id` | uuid | NOT NULL |  |
| `product_id` | uuid | null |  |
| `name` | text | NOT NULL |  |
| `criteria` | jsonb | NOT NULL | `'{}'::jsonb` |
| `negative_criteria` | jsonb | NOT NULL | `'{}'::jsonb` |
| `is_active` | boolean | NOT NULL | `true` |
| `version` | integer | NOT NULL | `1` |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |
| `updated_at` | timestamp with time zone | NOT NULL | `now()` |
| `deleted_at` | timestamp with time zone | null |  |
| `quality_score` | integer | null |  |
| `addressable_estimate` | bigint | null |  |
| `addressable_source` | text | null |  |
| `addressable_at` | timestamp with time zone | null |  |
| `current_version_id` | uuid | null |  |

**Constraints**

- CHECK `icps_addressable_estimate_check` — `CHECK (((addressable_estimate IS NULL) OR (addressable_estimate >= 0)))`
- CHECK `icps_addressable_source_check` — `CHECK (((addressable_source IS NULL) OR (addressable_source = ANY (ARRAY['provider'::text, 'manual'::text]))))`
- CHECK `icps_criteria_is_object` — `CHECK ((jsonb_typeof(criteria) = 'object'::text))`
- CHECK `icps_criteria_known_keys` — `CHECK (jsonb_keys_within(criteria, ARRAY['segments'::text, 'sizes'::text, 'regions'::text, 'triggers'::text, 'industries'::text, 'employeeRange'::text, 'revenueBands'::text, 'technologies'::text, 'businessModels'::text, 'painPoints'::text, 'useCases'::text, 'buyingSignals'::text, 'keywords'::text, 'exampleCompanies'::text, 'notes'::text]))`
- CHECK `icps_negative_is_object` — `CHECK ((jsonb_typeof(negative_criteria) = 'object'::text))`
- CHECK `icps_negative_known_keys` — `CHECK (jsonb_keys_within(negative_criteria, ARRAY['exclusions'::text, 'industries'::text, 'regions'::text, 'sizes'::text, 'technologies'::text, 'businessModels'::text, 'employeeRange'::text, 'keywords'::text, 'domains'::text, 'signals'::text, 'notes'::text]))`
- CHECK `icps_quality_score_check` — `CHECK (((quality_score IS NULL) OR ((quality_score >= 0) AND (quality_score <= 100))))`
- FK `icps_current_version_id_fkey` — `FOREIGN KEY (current_version_id) REFERENCES icp_versions(id) ON DELETE SET NULL`
- FK `icps_org_id_fkey` — `FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE`
- FK `icps_product_id_fkey` — `FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL`
- PK `icps_pkey` — `PRIMARY KEY (id)`

**Indexes**

- `icps_org_active_idx` — `icps USING btree (org_id) WHERE (is_active AND (deleted_at IS NULL))`

**Policies**

- `tenant_read` — SELECT USING `(org_id IN ( SELECT user_org_ids() AS user_org_ids))`
- `tenant_write` — ALL USING `has_org_role(org_id, 'member'::org_role)` WITH CHECK `has_org_role(org_id, 'member'::org_role)`

**Triggers**

- `icps_same_org`
- `icps_touch`

## invitations

RLS: **enabled**

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` |
| `org_id` | uuid | NOT NULL |  |
| `email` | text | NOT NULL |  |
| `role` | org_role | NOT NULL | `'member'::org_role` |
| `token` | uuid | NOT NULL | `gen_random_uuid()` |
| `invited_by` | uuid | null |  |
| `expires_at` | timestamp with time zone | NOT NULL | `(now() + '14 days'::interval)` |
| `accepted_at` | timestamp with time zone | null |  |
| `accepted_by` | uuid | null |  |
| `revoked_at` | timestamp with time zone | null |  |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |
| `updated_at` | timestamp with time zone | NOT NULL | `now()` |

**Constraints**

- FK `invitations_accepted_by_fkey` — `FOREIGN KEY (accepted_by) REFERENCES auth.users(id) ON DELETE SET NULL`
- FK `invitations_invited_by_fkey` — `FOREIGN KEY (invited_by) REFERENCES auth.users(id) ON DELETE SET NULL`
- FK `invitations_org_id_fkey` — `FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE`
- PK `invitations_pkey` — `PRIMARY KEY (id)`
- UNIQUE `invitations_token_key` — `UNIQUE (token)`

**Indexes**

- `invitations_pending_idx` — `UNIQUE invitations USING btree (org_id, lower(email)) WHERE ((accepted_at IS NULL) AND (revoked_at IS NULL))`

**Policies**

- `invitation_admin` — ALL USING `has_org_role(org_id, 'admin'::org_role)` WITH CHECK `has_org_role(org_id, 'admin'::org_role)`

**Triggers**

- `invitations_guard_owner`
- `invitations_touch`

## job_executions

RLS: **enabled**

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` |
| `org_id` | uuid | null |  |
| `job_name` | text | NOT NULL |  |
| `status` | text | NOT NULL | `'queued'::text` |
| `attempts` | integer | NOT NULL | `0` |
| `payload` | jsonb | NOT NULL | `'{}'::jsonb` |
| `error` | text | null |  |
| `started_at` | timestamp with time zone | null |  |
| `finished_at` | timestamp with time zone | null |  |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |
| `updated_at` | timestamp with time zone | NOT NULL | `now()` |
| `run_at` | timestamp with time zone | NOT NULL | `now()` |
| `max_attempts` | integer | NOT NULL | `3` |
| `locked_at` | timestamp with time zone | null |  |
| `locked_by` | text | null |  |
| `result` | jsonb | null |  |
| `idempotency_key` | text | null |  |

**Constraints**

- FK `job_executions_org_id_fkey` — `FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE`
- PK `job_executions_pkey` — `PRIMARY KEY (id)`

**Indexes**

- `job_executions_due_idx` — `job_executions USING btree (run_at) WHERE (status = 'queued'::text)`
- `job_executions_idempotency_idx` — `UNIQUE job_executions USING btree (job_name, idempotency_key, org_id) NULLS NOT DISTINCT WHERE ((idempotency_key IS NOT NULL) AND (status = ANY (ARRAY['queued'::text, 'running'::text])))`
- `job_executions_idx` — `job_executions USING btree (org_id, job_name, created_at DESC)`

**Policies**

- `tenant_read` — SELECT USING `(org_id IN ( SELECT user_org_ids() AS user_org_ids))`

**Triggers**

- `job_executions_touch`

## join_requests

RLS: **enabled**

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` |
| `org_id` | uuid | NOT NULL |  |
| `user_id` | uuid | NOT NULL |  |
| `email` | text | NOT NULL |  |
| `status` | text | NOT NULL | `'pending'::text` |
| `decided_by` | uuid | null |  |
| `decided_at` | timestamp with time zone | null |  |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |
| `updated_at` | timestamp with time zone | NOT NULL | `now()` |
| `admins_notified_at` | timestamp with time zone | null |  |
| `requester_notified_at` | timestamp with time zone | null |  |

**Constraints**

- CHECK `join_requests_status_check` — `CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'declined'::text])))`
- FK `join_requests_decided_by_fkey` — `FOREIGN KEY (decided_by) REFERENCES auth.users(id) ON DELETE SET NULL`
- FK `join_requests_org_id_fkey` — `FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE`
- FK `join_requests_user_id_fkey` — `FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE`
- PK `join_requests_pkey` — `PRIMARY KEY (id)`

**Indexes**

- `join_requests_approved_unnotified_idx` — `join_requests USING btree (decided_at) WHERE ((requester_notified_at IS NULL) AND (status = 'approved'::text))`
- `join_requests_org_idx` — `join_requests USING btree (org_id) WHERE (status = 'pending'::text)`
- `join_requests_pending_idx` — `UNIQUE join_requests USING btree (org_id, user_id) WHERE (status = 'pending'::text)`
- `join_requests_unnotified_idx` — `join_requests USING btree (created_at) WHERE ((admins_notified_at IS NULL) AND (status = 'pending'::text))`

**Policies**

- `join_request_admin` — ALL USING `has_org_role(org_id, 'admin'::org_role)` WITH CHECK `has_org_role(org_id, 'admin'::org_role)`

**Triggers**

- `join_requests_touch`

## learning_findings

RLS: **enabled**

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` |
| `org_id` | uuid | NOT NULL |  |
| `run_id` | uuid | NOT NULL |  |
| `kind` | text | NOT NULL |  |
| `headline` | text | NOT NULL |  |
| `detail` | text | NOT NULL |  |
| `recommendation` | text | NOT NULL |  |
| `confidence` | confidence | null |  |
| `cited_opportunity_ids` | uuid[] | NOT NULL | `'{}'::uuid[]` |
| `cited_company_ids` | uuid[] | NOT NULL | `'{}'::uuid[]` |
| `cited_source_ids` | uuid[] | NOT NULL | `'{}'::uuid[]` |
| `supporting_count` | integer | NOT NULL | `0` |
| `contradicting_count` | integer | NOT NULL | `0` |
| `proposal` | jsonb | null |  |
| `status` | text | NOT NULL | `'pending'::text` |
| `decided_by` | uuid | null |  |
| `decided_at` | timestamp with time zone | null |  |
| `applied_type` | text | null |  |
| `applied_id` | uuid | null |  |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |
| `updated_at` | timestamp with time zone | NOT NULL | `now()` |
| `cited_person_ids` | uuid[] | NOT NULL | `'{}'::uuid[]` |
| `cited_query_ids` | uuid[] | NOT NULL | `'{}'::uuid[]` |
| `cited_competitor_ids` | uuid[] | NOT NULL | `'{}'::uuid[]` |
| `cited_theme_ids` | uuid[] | NOT NULL | `'{}'::uuid[]` |

**Constraints**

- CHECK `learning_findings_applied_type_check` — `CHECK (((applied_type IS NULL) OR (applied_type = ANY (ARRAY['scoring_rule'::text, 'memory'::text, 'discovery_query'::text, 'persona'::text, 'icp'::text]))))`
- CHECK `learning_findings_decision` — `CHECK (((status = 'pending'::text) = (decided_at IS NULL)))`
- CHECK `learning_findings_kind_check` — `CHECK ((kind = ANY (ARRAY['source_performance'::text, 'scoring_adjustment'::text, 'style_guidance'::text, 'icp_refinement'::text, 'discovery_query'::text, 'persona_fit'::text, 'outreach_angle'::text, 'contact_selection'::text, 'competitive_positioning'::text, 'product_demand'::text])))`
- CHECK `learning_findings_status_check` — `CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])))`
- FK `learning_findings_decided_by_fkey` — `FOREIGN KEY (decided_by) REFERENCES auth.users(id) ON DELETE SET NULL`
- FK `learning_findings_org_id_fkey` — `FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE`
- FK `learning_findings_run_id_fkey` — `FOREIGN KEY (run_id) REFERENCES learning_runs(id) ON DELETE CASCADE`
- PK `learning_findings_pkey` — `PRIMARY KEY (id)`

**Indexes**

- `learning_findings_pending_idx` — `learning_findings USING btree (org_id, status, created_at DESC) WHERE (status = 'pending'::text)`
- `learning_findings_run_idx` — `learning_findings USING btree (org_id, run_id, status)`

**Policies**

- `tenant_read` — SELECT USING `(org_id IN ( SELECT user_org_ids() AS user_org_ids))`
- `tenant_write` — ALL USING `has_org_role(org_id, 'member'::org_role)` WITH CHECK `has_org_role(org_id, 'member'::org_role)`

**Triggers**

- `learning_findings_same_org`
- `learning_findings_touch`

## learning_runs

RLS: **enabled**

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` |
| `org_id` | uuid | NOT NULL |  |
| `status` | text | NOT NULL | `'requested'::text` |
| `triggered_by` | uuid | null |  |
| `trigger` | text | NOT NULL | `'manual'::text` |
| `window_start` | timestamp with time zone | NOT NULL |  |
| `window_end` | timestamp with time zone | NOT NULL |  |
| `outcomes_considered` | integer | NOT NULL | `0` |
| `decisions_considered` | integer | NOT NULL | `0` |
| `ratings_considered` | integer | NOT NULL | `0` |
| `summary` | text | null |  |
| `error` | text | null |  |
| `ai_run_id` | uuid | null |  |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |
| `updated_at` | timestamp with time zone | NOT NULL | `now()` |
| `deleted_at` | timestamp with time zone | null |  |
| `overrides_considered` | integer | NOT NULL | `0` |
| `targets` | text[] | NOT NULL | `'{}'::text[]` |

**Constraints**

- CHECK `learning_runs_status_check` — `CHECK ((status = ANY (ARRAY['requested'::text, 'running'::text, 'ready'::text, 'insufficient'::text, 'failed'::text])))`
- CHECK `learning_runs_trigger_check` — `CHECK ((trigger = ANY (ARRAY['manual'::text, 'scheduled'::text])))`
- CHECK `learning_runs_window` — `CHECK ((window_end > window_start))`
- FK `learning_runs_ai_run_id_fkey` — `FOREIGN KEY (ai_run_id) REFERENCES ai_runs(id) ON DELETE SET NULL`
- FK `learning_runs_org_id_fkey` — `FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE`
- FK `learning_runs_triggered_by_fkey` — `FOREIGN KEY (triggered_by) REFERENCES auth.users(id) ON DELETE SET NULL`
- PK `learning_runs_pkey` — `PRIMARY KEY (id)`

**Indexes**

- `learning_runs_one_open_per_org` — `UNIQUE learning_runs USING btree (org_id) WHERE ((status = ANY (ARRAY['requested'::text, 'running'::text])) AND (deleted_at IS NULL))`
- `learning_runs_recent_idx` — `learning_runs USING btree (org_id, created_at DESC) WHERE (deleted_at IS NULL)`
- `learning_runs_requested_idx` — `learning_runs USING btree (created_at) WHERE ((status = 'requested'::text) AND (deleted_at IS NULL))`

**Policies**

- `tenant_read` — SELECT USING `(org_id IN ( SELECT user_org_ids() AS user_org_ids))`
- `tenant_write` — ALL USING `has_org_role(org_id, 'member'::org_role)` WITH CHECK `has_org_role(org_id, 'member'::org_role)`

**Triggers**

- `learning_runs_same_org`
- `learning_runs_touch`

## mailboxes

RLS: **enabled**

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` |
| `org_id` | uuid | NOT NULL |  |
| `provider` | text | NOT NULL |  |
| `email` | text | NOT NULL |  |
| `display_name` | text | null |  |
| `oauth_token_enc` | text | null |  |
| `refresh_token_enc` | text | null |  |
| `daily_limit` | integer | NOT NULL | `50` |
| `sent_today` | integer | NOT NULL | `0` |
| `health_score` | integer | null |  |
| `warmup_stage` | text | null |  |
| `status` | text | NOT NULL | `'connected'::text` |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |
| `updated_at` | timestamp with time zone | NOT NULL | `now()` |
| `deleted_at` | timestamp with time zone | null |  |
| `sent_today_on` | date | null |  |
| `token_expires_at` | timestamp with time zone | null |  |
| `last_sync_at` | timestamp with time zone | null |  |
| `sync_cursor` | text | null |  |
| `last_error` | text | null |  |
| `warmup_started_at` | timestamp with time zone | null |  |
| `warmup_target` | integer | null |  |

**Constraints**

- CHECK `mailboxes_health_score_check` — `CHECK (((health_score >= 0) AND (health_score <= 100)))`
- CHECK `mailboxes_provider_check` — `CHECK ((provider = ANY (ARRAY['gmail'::text, 'outlook'::text, 'smtp'::text])))`
- FK `mailboxes_org_id_fkey` — `FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE`
- PK `mailboxes_pkey` — `PRIMARY KEY (id)`
- UNIQUE `mailboxes_org_id_email_key` — `UNIQUE (org_id, email)`

**Policies**

- `tenant_read` — SELECT USING `(org_id IN ( SELECT user_org_ids() AS user_org_ids))`
- `tenant_write` — ALL USING `has_org_role(org_id, 'member'::org_role)` WITH CHECK `has_org_role(org_id, 'member'::org_role)`

**Triggers**

- `mailboxes_touch`

## memberships

RLS: **enabled**

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` |
| `org_id` | uuid | NOT NULL |  |
| `user_id` | uuid | NOT NULL |  |
| `role` | org_role | NOT NULL | `'member'::org_role` |
| `invited_by` | uuid | null |  |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |
| `updated_at` | timestamp with time zone | NOT NULL | `now()` |
| `deleted_at` | timestamp with time zone | null |  |

**Constraints**

- FK `memberships_invited_by_fkey` — `FOREIGN KEY (invited_by) REFERENCES auth.users(id) ON DELETE SET NULL`
- FK `memberships_org_id_fkey` — `FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE`
- FK `memberships_user_id_fkey` — `FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE`
- PK `memberships_pkey` — `PRIMARY KEY (id)`
- UNIQUE `memberships_org_id_user_id_key` — `UNIQUE (org_id, user_id)`

**Indexes**

- `memberships_user_idx` — `memberships USING btree (user_id, org_id)`

**Policies**

- `membership_read` — SELECT USING `(org_id IN ( SELECT user_org_ids() AS user_org_ids))`
- `membership_write` — ALL USING `has_org_role(org_id, 'admin'::org_role)` WITH CHECK `has_org_role(org_id, 'admin'::org_role)`

**Triggers**

- `memberships_guard_owner`
- `memberships_touch`

## memories

RLS: **enabled**

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` |
| `org_id` | uuid | NOT NULL |  |
| `scope` | memory_scope | NOT NULL |  |
| `scope_id` | uuid | null |  |
| `kind` | text | NOT NULL | `'durable'::text` |
| `key` | text | null |  |
| `content` | text | NOT NULL |  |
| `source` | text | NOT NULL | `'user'::text` |
| `confidence` | confidence | null |  |
| `created_by` | uuid | null |  |
| `expires_at` | timestamp with time zone | null |  |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |
| `updated_at` | timestamp with time zone | NOT NULL | `now()` |
| `deleted_at` | timestamp with time zone | null |  |
| `source_type` | text | NOT NULL | `'text'::text` |
| `tags` | text[] | NOT NULL | `'{}'::text[]` |
| `source_url` | text | null |  |
| `source_label` | text | null |  |
| `truncated` | boolean | NOT NULL | `false` |
| `origin` | text | NOT NULL | `'stated'::text` |
| `category` | text | null |  |
| `risk` | text | NOT NULL | `'low'::text` |
| `status` | text | NOT NULL | `'active'::text` |
| `applies_to` | text[] | NOT NULL | `'{}'::text[]` |
| `support` | integer | NOT NULL | `0` |
| `contradicts` | integer | NOT NULL | `0` |
| `last_reinforced_at` | timestamp with time zone | null |  |
| `last_applied_at` | timestamp with time zone | null |  |
| `shared_at` | timestamp with time zone | null |  |
| `promoted_from` | uuid | null |  |

**Constraints**

- CHECK `memories_category_check` — `CHECK (((category IS NULL) OR (category = ANY (ARRAY['writing_style'::text, 'output_format'::text, 'research'::text, 'targeting'::text, 'workflow'::text, 'context'::text, 'interface'::text]))))`
- CHECK `memories_contradicts_check` — `CHECK ((contradicts >= 0))`
- CHECK `memories_kind_check` — `CHECK ((kind = ANY (ARRAY['durable'::text, 'conversational'::text])))`
- CHECK `memories_origin_check` — `CHECK ((origin = ANY (ARRAY['stated'::text, 'learned'::text, 'promoted'::text])))`
- CHECK `memories_risk_check` — `CHECK ((risk = ANY (ARRAY['low'::text, 'high'::text])))`
- CHECK `memories_scope_id_presence` — `CHECK (((scope = 'organization'::memory_scope) = (scope_id IS NULL)))`
- CHECK `memories_shared_is_personal` — `CHECK (((shared_at IS NULL) OR (scope = 'user'::memory_scope)))`
- CHECK `memories_source_check` — `CHECK ((source = ANY (ARRAY['user'::text, 'derived'::text])))`
- CHECK `memories_source_type_check` — `CHECK ((source_type = ANY (ARRAY['text'::text, 'url'::text, 'file'::text, 'image'::text])))`
- CHECK `memories_status_check` — `CHECK ((status = ANY (ARRAY['proposed'::text, 'active'::text, 'paused'::text, 'rejected'::text])))`
- CHECK `memories_support_check` — `CHECK ((support >= 0))`
- FK `memories_created_by_fkey` — `FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL`
- FK `memories_org_id_fkey` — `FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE`
- FK `memories_promoted_from_fkey` — `FOREIGN KEY (promoted_from) REFERENCES memories(id) ON DELETE SET NULL`
- PK `memories_pkey` — `PRIMARY KEY (id)`

**Indexes**

- `memories_retrieval_idx` — `memories USING btree (org_id, scope, scope_id) WHERE ((deleted_at IS NULL) AND (status = 'active'::text))`
- `memories_tags_idx` — `memories USING gin (tags) WHERE (deleted_at IS NULL)`

**Policies**

- `memories_read` — SELECT USING `((org_id IN ( SELECT user_org_ids() AS user_org_ids)) AND ((scope <> 'user'::memory_scope) OR (scope_id = auth.uid()) OR ((shared_at IS NOT NULL) AND has_org_role(org_id, 'admin'::org_role))))`
- `memories_write_own` — ALL USING `((scope = 'user'::memory_scope) AND (scope_id = auth.uid()) AND (org_id IN ( SELECT user_org_ids() AS user_org_ids)))` WITH CHECK `((scope = 'user'::memory_scope) AND (scope_id = auth.uid()) AND (org_id IN ( SELECT user_org_ids() AS user_org_ids)))`
- `memories_write_shared` — ALL USING `((scope <> 'user'::memory_scope) AND has_org_role(org_id, 'member'::org_role))` WITH CHECK `((scope <> 'user'::memory_scope) AND has_org_role(org_id, 'member'::org_role))`

**Triggers**

- `memories_origin`
- `memories_same_org`
- `memories_touch`

## memory_evidence

RLS: **enabled**

| Column | Type | Null | Default |
|---|---|---|---|
| `memory_id` | uuid | NOT NULL |  |
| `signal_id` | uuid | NOT NULL |  |
| `org_id` | uuid | NOT NULL |  |
| `user_id` | uuid | NOT NULL |  |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |

**Constraints**

- FK `memory_evidence_memory_id_fkey` — `FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE`
- FK `memory_evidence_org_id_fkey` — `FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE`
- FK `memory_evidence_signal_id_fkey` — `FOREIGN KEY (signal_id) REFERENCES preference_signals(id) ON DELETE CASCADE`
- FK `memory_evidence_user_id_fkey` — `FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE`
- PK `memory_evidence_pkey` — `PRIMARY KEY (memory_id, signal_id)`

**Policies**

- `memory_evidence_delete` — DELETE USING `((user_id = auth.uid()) AND (org_id IN ( SELECT user_org_ids() AS user_org_ids)))`
- `memory_evidence_own` — SELECT USING `((user_id = auth.uid()) AND (org_id IN ( SELECT user_org_ids() AS user_org_ids)))`

## merge_candidates

RLS: **enabled**

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` |
| `org_id` | uuid | NOT NULL |  |
| `company_a_id` | uuid | NOT NULL |  |
| `company_b_id` | uuid | NOT NULL |  |
| `matched_on` | text | NOT NULL |  |
| `confidence` | confidence | NOT NULL |  |
| `detail` | jsonb | NOT NULL | `'{}'::jsonb` |
| `status` | text | NOT NULL | `'pending'::text` |
| `decided_by` | uuid | null |  |
| `decided_at` | timestamp with time zone | null |  |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |
| `updated_at` | timestamp with time zone | NOT NULL | `now()` |

**Constraints**

- CHECK `merge_candidates_distinct` — `CHECK ((company_a_id <> company_b_id))`
- CHECK `merge_candidates_matched_on_check` — `CHECK ((matched_on = ANY (ARRAY['provider_id'::text, 'domain'::text, 'redirect'::text, 'normalized_name'::text, 'name_and_country'::text])))`
- CHECK `merge_candidates_status_check` — `CHECK ((status = ANY (ARRAY['pending'::text, 'merged'::text, 'rejected'::text])))`
- FK `merge_candidates_company_a_id_fkey` — `FOREIGN KEY (company_a_id) REFERENCES companies(id) ON DELETE CASCADE`
- FK `merge_candidates_company_b_id_fkey` — `FOREIGN KEY (company_b_id) REFERENCES companies(id) ON DELETE CASCADE`
- FK `merge_candidates_decided_by_fkey` — `FOREIGN KEY (decided_by) REFERENCES auth.users(id) ON DELETE SET NULL`
- FK `merge_candidates_org_id_fkey` — `FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE`
- PK `merge_candidates_pkey` — `PRIMARY KEY (id)`
- UNIQUE `merge_candidates_org_id_company_a_id_company_b_id_key` — `UNIQUE (org_id, company_a_id, company_b_id)`

**Indexes**

- `merge_candidates_pending_idx` — `merge_candidates USING btree (org_id, created_at DESC) WHERE (status = 'pending'::text)`

**Policies**

- `tenant_read` — SELECT USING `(org_id IN ( SELECT user_org_ids() AS user_org_ids))`
- `tenant_write` — ALL USING `has_org_role(org_id, 'member'::org_role)` WITH CHECK `has_org_role(org_id, 'member'::org_role)`

**Triggers**

- `merge_candidates_same_org`
- `merge_candidates_touch`

## message_events

RLS: **enabled**

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` |
| `org_id` | uuid | NOT NULL |  |
| `message_id` | uuid | NOT NULL |  |
| `kind` | text | NOT NULL |  |
| `payload` | jsonb | NOT NULL | `'{}'::jsonb` |
| `occurred_at` | timestamp with time zone | NOT NULL | `now()` |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |
| `updated_at` | timestamp with time zone | NOT NULL | `now()` |

**Constraints**

- CHECK `message_events_kind_check` — `CHECK ((kind = ANY (ARRAY['delivered'::text, 'bounced'::text, 'opened'::text, 'clicked'::text, 'replied'::text, 'complained'::text, 'unsubscribed'::text, 'failed'::text])))`
- FK `message_events_message_id_fkey` — `FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE`
- FK `message_events_org_id_fkey` — `FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE`
- PK `message_events_pkey` — `PRIMARY KEY (id)`

**Indexes**

- `message_events_lookup_idx` — `message_events USING btree (org_id, message_id, kind)`

**Policies**

- `tenant_read` — SELECT USING `(org_id IN ( SELECT user_org_ids() AS user_org_ids))`

**Triggers**

- `message_events_project_activity`
- `message_events_touch`

## message_unsubscribe_tokens

RLS: **enabled**

| Column | Type | Null | Default |
|---|---|---|---|
| `message_id` | uuid | NOT NULL |  |
| `org_id` | uuid | NOT NULL |  |
| `token` | uuid | NOT NULL | `gen_random_uuid()` |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |

**Constraints**

- FK `message_unsubscribe_tokens_message_id_fkey` — `FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE`
- FK `message_unsubscribe_tokens_org_id_fkey` — `FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE`
- PK `message_unsubscribe_tokens_pkey` — `PRIMARY KEY (message_id)`
- UNIQUE `message_unsubscribe_tokens_token_key` — `UNIQUE (token)`

**Policies**

- `no_session_access` — ALL USING `false` WITH CHECK `false`

## messages

RLS: **enabled**

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` |
| `org_id` | uuid | NOT NULL |  |
| `enrollment_id` | uuid | null |  |
| `step_id` | uuid | null |  |
| `mailbox_id` | uuid | null |  |
| `thread_id` | uuid | null |  |
| `direction` | text | NOT NULL |  |
| `subject` | text | null |  |
| `body_html` | text | null |  |
| `body_text` | text | null |  |
| `ai_generated` | boolean | NOT NULL | `false` |
| `approved_by` | uuid | null |  |
| `evidence_ids` | uuid[] | NOT NULL | `'{}'::uuid[]` |
| `scheduled_at` | timestamp with time zone | null |  |
| `sent_at` | timestamp with time zone | null |  |
| `provider_message_id` | text | null |  |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |
| `updated_at` | timestamp with time zone | NOT NULL | `now()` |
| `deleted_at` | timestamp with time zone | null |  |
| `message_id_header` | text | null |  |
| `in_reply_to` | text | null |  |
| `from_email` | text | null |  |
| `to_email` | text | null |  |
| `error` | text | null |  |
| `outreach_angle` | text | null |  |
| `opportunity_id` | uuid | null |  |
| `contact_fit_id` | uuid | null |  |
| `send_attempted_at` | timestamp with time zone | null |  |
| `edited_by` | uuid | null |  |
| `edited_at` | timestamp with time zone | null |  |
| `original_subject` | text | null |  |
| `original_body_text` | text | null |  |
| `rejected_by` | uuid | null |  |
| `rejected_at` | timestamp with time zone | null |  |
| `rejection_reason` | text | null |  |
| `applied_memory_ids` | uuid[] | NOT NULL | `'{}'::uuid[]` |

**Constraints**

- CHECK `messages_direction_check` — `CHECK ((direction = ANY (ARRAY['outbound'::text, 'inbound'::text])))`
- CHECK `messages_rejection_reason_check` — `CHECK (((rejection_reason IS NULL) OR (length(rejection_reason) <= 500)))`
- CHECK `messages_sent_has_provider_id` — `CHECK (((direction <> 'outbound'::text) OR (sent_at IS NULL) OR (provider_message_id IS NOT NULL)))`
- FK `messages_approved_by_fkey` — `FOREIGN KEY (approved_by) REFERENCES auth.users(id) ON DELETE SET NULL`
- FK `messages_contact_fit_id_fkey` — `FOREIGN KEY (contact_fit_id) REFERENCES contact_fit_scores(id) ON DELETE SET NULL`
- FK `messages_edited_by_fkey` — `FOREIGN KEY (edited_by) REFERENCES auth.users(id) ON DELETE SET NULL`
- FK `messages_enrollment_id_fkey` — `FOREIGN KEY (enrollment_id) REFERENCES enrollments(id) ON DELETE SET NULL`
- FK `messages_mailbox_id_fkey` — `FOREIGN KEY (mailbox_id) REFERENCES mailboxes(id) ON DELETE SET NULL`
- FK `messages_opportunity_id_fkey` — `FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE SET NULL`
- FK `messages_org_id_fkey` — `FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE`
- FK `messages_rejected_by_fkey` — `FOREIGN KEY (rejected_by) REFERENCES auth.users(id) ON DELETE SET NULL`
- FK `messages_step_id_fkey` — `FOREIGN KEY (step_id) REFERENCES sequence_steps(id) ON DELETE SET NULL`
- FK `messages_thread_id_fkey` — `FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE SET NULL`
- PK `messages_pkey` — `PRIMARY KEY (id)`

**Indexes**

- `messages_angle_idx` — `messages USING btree (org_id, outreach_angle, sent_at DESC) WHERE ((outreach_angle IS NOT NULL) AND (sent_at IS NOT NULL))`
- `messages_awaiting_approval_idx` — `messages USING btree (org_id, created_at DESC) WHERE ((direction = 'outbound'::text) AND (sent_at IS NULL) AND (scheduled_at IS NULL) AND (deleted_at IS NULL))`
- `messages_one_per_enrollment_step` — `UNIQUE messages USING btree (enrollment_id, step_id) WHERE ((direction = 'outbound'::text) AND (enrollment_id IS NOT NULL) AND (step_id IS NOT NULL) AND (deleted_at IS NULL))`
- `messages_opportunity_idx` — `messages USING btree (org_id, opportunity_id, created_at DESC) WHERE (opportunity_id IS NOT NULL)`
- `messages_scheduled_idx` — `messages USING btree (scheduled_at) WHERE ((direction = 'outbound'::text) AND (sent_at IS NULL) AND (deleted_at IS NULL))`
- `messages_thread_idx` — `messages USING btree (org_id, thread_id, created_at)`

**Policies**

- `tenant_read` — SELECT USING `(org_id IN ( SELECT user_org_ids() AS user_org_ids))`
- `tenant_write` — ALL USING `has_org_role(org_id, 'member'::org_role)` WITH CHECK `has_org_role(org_id, 'member'::org_role)`

**Triggers**

- `messages_demand_erasure`
- `messages_issue_unsubscribe_token`
- `messages_project_activity`
- `messages_same_org`
- `messages_touch`

## notification_preferences

RLS: **enabled**

| Column | Type | Null | Default |
|---|---|---|---|
| `org_id` | uuid | NOT NULL |  |
| `user_id` | uuid | NOT NULL |  |
| `daily_digest` | boolean | NOT NULL | `true` |
| `digest_hour` | smallint | NOT NULL | `8` |
| `timezone` | text | NOT NULL | `'UTC'::text` |
| `last_digest_on` | date | null |  |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |
| `updated_at` | timestamp with time zone | NOT NULL | `now()` |

**Constraints**

- CHECK `notification_preferences_digest_hour_check` — `CHECK (((digest_hour >= 0) AND (digest_hour <= 23)))`
- CHECK `notification_preferences_timezone_check` — `CHECK (((length(timezone) >= 1) AND (length(timezone) <= 64)))`
- FK `notification_preferences_org_id_fkey` — `FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE`
- FK `notification_preferences_user_id_fkey` — `FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE`
- PK `notification_preferences_pkey` — `PRIMARY KEY (org_id, user_id)`

**Policies**

- `notification_preferences_own` — ALL USING `((user_id = auth.uid()) AND (org_id IN ( SELECT user_org_ids() AS user_org_ids)))` WITH CHECK `((user_id = auth.uid()) AND has_org_role(org_id, 'viewer'::org_role))`

**Triggers**

- `notification_preferences_touch`

## opportunities

RLS: **enabled**

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` |
| `org_id` | uuid | NOT NULL |  |
| `company_id` | uuid | NOT NULL |  |
| `icp_id` | uuid | null |  |
| `primary_person_id` | uuid | null |  |
| `priority` | opportunity_priority | NOT NULL | `'watch'::opportunity_priority` |
| `priority_reason` | text | NOT NULL |  |
| `status` | opportunity_status | NOT NULL | `'discovered'::opportunity_status` |
| `owner_id` | uuid | null |  |
| `why_this_company` | text | null |  |
| `identified_problem` | text | null |  |
| `potential_gap` | text | null |  |
| `why_now` | text | null |  |
| `current_approach` | text | null |  |
| `potential_use_case` | text | null |  |
| `outreach_angle` | text | null |  |
| `confidence` | confidence | null |  |
| `first_seen_at` | timestamp with time zone | NOT NULL | `now()` |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |
| `updated_at` | timestamp with time zone | NOT NULL | `now()` |
| `deleted_at` | timestamp with time zone | null |  |
| `discovered_via` | text | NOT NULL | `'manual'::text` |
| `last_scored_at` | timestamp with time zone | null |  |
| `why_this_person` | text | null |  |
| `contact_selected_at` | timestamp with time zone | null |  |
| `contact_selected_by` | text | NOT NULL | `'system'::text` |
| `priority_set_by` | text | NOT NULL | `'system'::text` |
| `crm_sync_requested_at` | timestamp with time zone | null |  |
| `contacts_sought_at` | timestamp with time zone | null |  |
| `next_step` | text | null |  |
| `next_step_due_at` | timestamp with time zone | null |  |
| `next_step_set_by` | uuid | null |  |
| `next_step_set_at` | timestamp with time zone | null |  |
| `estimated_value_cents` | bigint | null |  |
| `estimated_value_currency` | text | NOT NULL | `'USD'::text` |

**Constraints**

- CHECK `opportunities_contact_selected_by_check` — `CHECK ((contact_selected_by = ANY (ARRAY['system'::text, 'user'::text])))`
- CHECK `opportunities_estimated_value_cents_check` — `CHECK (((estimated_value_cents IS NULL) OR ((estimated_value_cents >= 0) AND (estimated_value_cents <= '100000000000'::bigint))))`
- CHECK `opportunities_estimated_value_currency_check` — `CHECK ((estimated_value_currency ~ '^[A-Z]{3}$'::text))`
- CHECK `opportunities_next_step_check` — `CHECK (((next_step IS NULL) OR ((length(next_step) >= 1) AND (length(next_step) <= 280))))`
- CHECK `opportunities_priority_set_by_check` — `CHECK ((priority_set_by = ANY (ARRAY['system'::text, 'user'::text])))`
- FK `opportunities_company_id_fkey` — `FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE`
- FK `opportunities_icp_id_fkey` — `FOREIGN KEY (icp_id) REFERENCES icps(id) ON DELETE SET NULL`
- FK `opportunities_next_step_set_by_fkey` — `FOREIGN KEY (next_step_set_by) REFERENCES auth.users(id) ON DELETE SET NULL`
- FK `opportunities_org_id_fkey` — `FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE`
- FK `opportunities_owner_id_fkey` — `FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE SET NULL`
- FK `opportunities_primary_person_id_fkey` — `FOREIGN KEY (primary_person_id) REFERENCES people(id) ON DELETE SET NULL`
- PK `opportunities_pkey` — `PRIMARY KEY (id)`
- UNIQUE `opportunities_org_id_company_id_icp_id_key` — `UNIQUE NULLS NOT DISTINCT (org_id, company_id, icp_id)`

**Indexes**

- `opportunities_contacts_unsought_idx` — `opportunities USING btree (org_id, priority) WHERE ((contacts_sought_at IS NULL) AND (deleted_at IS NULL))`
- `opportunities_crm_sync_requested_idx` — `opportunities USING btree (crm_sync_requested_at) WHERE ((crm_sync_requested_at IS NOT NULL) AND (deleted_at IS NULL))`
- `opportunities_next_step_due_idx` — `opportunities USING btree (org_id, next_step_due_at) WHERE ((next_step_due_at IS NOT NULL) AND (deleted_at IS NULL))`
- `opportunities_owner_idx` — `opportunities USING btree (org_id, owner_id, status) WHERE (deleted_at IS NULL)`
- `opportunities_priority_idx` — `opportunities USING btree (org_id, priority, first_seen_at DESC) WHERE (deleted_at IS NULL)`

**Policies**

- `tenant_read` — SELECT USING `(org_id IN ( SELECT user_org_ids() AS user_org_ids))`
- `tenant_write` — ALL USING `has_org_role(org_id, 'member'::org_role)` WITH CHECK `has_org_role(org_id, 'member'::org_role)`

**Triggers**

- `opportunities_project_activity`
- `opportunities_same_org`
- `opportunities_touch`

## opportunity_scores

RLS: **enabled**

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` |
| `org_id` | uuid | NOT NULL |  |
| `opportunity_id` | uuid | NOT NULL |  |
| `model_version` | text | NOT NULL |  |
| `score` | integer | NOT NULL |  |
| `icp_fit` | integer | null |  |
| `problem_severity` | integer | null |  |
| `evidence_strength` | integer | null |  |
| `trigger_strength` | integer | null |  |
| `trigger_freshness` | integer | null |  |
| `buying_likelihood` | integer | null |  |
| `product_relevance` | integer | null |  |
| `decision_maker_accessibility` | integer | null |  |
| `confidence` | confidence | null |  |
| `explanation` | text | NOT NULL |  |
| `computed_at` | timestamp with time zone | NOT NULL | `now()` |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |
| `updated_at` | timestamp with time zone | NOT NULL | `now()` |
| `model_score` | integer | null |  |
| `rule_trace` | jsonb | NOT NULL | `'[]'::jsonb` |
| `prompt_version` | text | null |  |
| `icp_version_id` | uuid | null |  |
| `rules_version` | text | null |  |
| `computed_reason` | text | null |  |

**Constraints**

- CHECK `opportunity_scores_buying_likelihood_check` — `CHECK (((buying_likelihood >= 0) AND (buying_likelihood <= 100)))`
- CHECK `opportunity_scores_computed_reason_check` — `CHECK (((computed_reason IS NULL) OR (computed_reason = ANY (ARRAY['initial'::text, 'new_evidence'::text, 'rule_change'::text, 'icp_change'::text, 'manual'::text, 'scheduled'::text]))))`
- CHECK `opportunity_scores_decision_maker_accessibility_check` — `CHECK (((decision_maker_accessibility >= 0) AND (decision_maker_accessibility <= 100)))`
- CHECK `opportunity_scores_evidence_strength_check` — `CHECK (((evidence_strength >= 0) AND (evidence_strength <= 100)))`
- CHECK `opportunity_scores_icp_fit_check` — `CHECK (((icp_fit >= 0) AND (icp_fit <= 100)))`
- CHECK `opportunity_scores_model_score_check` — `CHECK (((model_score >= 0) AND (model_score <= 100)))`
- CHECK `opportunity_scores_problem_severity_check` — `CHECK (((problem_severity >= 0) AND (problem_severity <= 100)))`
- CHECK `opportunity_scores_product_relevance_check` — `CHECK (((product_relevance >= 0) AND (product_relevance <= 100)))`
- CHECK `opportunity_scores_score_check` — `CHECK (((score >= 0) AND (score <= 100)))`
- CHECK `opportunity_scores_trigger_freshness_check` — `CHECK (((trigger_freshness >= 0) AND (trigger_freshness <= 100)))`
- CHECK `opportunity_scores_trigger_strength_check` — `CHECK (((trigger_strength >= 0) AND (trigger_strength <= 100)))`
- FK `opportunity_scores_icp_version_id_fkey` — `FOREIGN KEY (icp_version_id) REFERENCES icp_versions(id) ON DELETE SET NULL`
- FK `opportunity_scores_opportunity_id_fkey` — `FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE`
- FK `opportunity_scores_org_id_fkey` — `FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE`
- PK `opportunity_scores_pkey` — `PRIMARY KEY (id)`

**Indexes**

- `opportunity_scores_current_idx` — `opportunity_scores USING btree (org_id, opportunity_id, computed_at DESC)`
- `opportunity_scores_drift_idx` — `opportunity_scores USING btree (org_id, model_version, computed_at DESC)`
- `opportunity_scores_prompt_drift_idx` — `opportunity_scores USING btree (org_id, prompt_version, computed_at DESC) WHERE (prompt_version IS NOT NULL)`

**Policies**

- `tenant_read` — SELECT USING `(org_id IN ( SELECT user_org_ids() AS user_org_ids))`
- `tenant_write` — ALL USING `has_org_role(org_id, 'member'::org_role)` WITH CHECK `has_org_role(org_id, 'member'::org_role)`

**Triggers**

- `opportunity_scores_same_org`
- `opportunity_scores_touch`

## organizations

RLS: **enabled**

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` |
| `name` | text | NOT NULL |  |
| `slug` | text | NOT NULL |  |
| `plan_id` | text | null | `'free'::text` |
| `trial_ends_at` | timestamp with time zone | null |  |
| `settings` | jsonb | NOT NULL | `'{}'::jsonb` |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |
| `updated_at` | timestamp with time zone | NOT NULL | `now()` |
| `deleted_at` | timestamp with time zone | null |  |
| `min_days_between_contacts` | integer | NOT NULL | `2` |
| `max_sends_per_contact_30d` | integer | NOT NULL | `6` |
| `max_contacts_per_company` | integer | NOT NULL | `3` |
| `max_sends_per_day` | integer | null |  |
| `contact_retention_days` | integer | null |  |
| `onboarding_step` | text | NOT NULL | `'you'::text` |
| `onboarding_completed_at` | timestamp with time zone | null |  |
| `goals` | text[] | NOT NULL | `'{}'::text[]` |
| `primary_domain` | text | null |  |
| `is_discoverable` | boolean | NOT NULL | `true` |
| `workspace_kind` | text | NOT NULL | `'company'::text` |

**Constraints**

- CHECK `organizations_contact_retention_days_check` — `CHECK (((contact_retention_days IS NULL) OR (contact_retention_days >= 30)))`
- CHECK `organizations_goals_known` — `CHECK (((cardinality(goals) <= 2) AND (goals <@ ARRAY['discover'::text, 'qualify'::text, 'enrich'::text, 'reach_out'::text, 'learn'::text])))`
- CHECK `organizations_max_contacts_per_company_check` — `CHECK ((max_contacts_per_company >= 1))`
- CHECK `organizations_max_sends_per_contact_30d_check` — `CHECK ((max_sends_per_contact_30d >= 0))`
- CHECK `organizations_max_sends_per_day_check` — `CHECK (((max_sends_per_day IS NULL) OR (max_sends_per_day >= 0)))`
- CHECK `organizations_min_days_between_contacts_check` — `CHECK ((min_days_between_contacts >= 0))`
- CHECK `organizations_onboarding_step_check` — `CHECK ((onboarding_step = ANY (ARRAY['you'::text, 'company'::text, 'goals'::text, 'icp'::text, 'sources'::text, 'building'::text, 'review'::text, 'done'::text])))`
- CHECK `organizations_workspace_kind_check` — `CHECK ((workspace_kind = ANY (ARRAY['company'::text, 'personal'::text])))`
- FK `organizations_plan_fk` — `FOREIGN KEY (plan_id) REFERENCES plans(id)`
- PK `organizations_pkey` — `PRIMARY KEY (id)`
- UNIQUE `organizations_slug_key` — `UNIQUE (slug)`

**Indexes**

- `organizations_domain_idx` — `organizations USING btree (primary_domain) WHERE ((primary_domain IS NOT NULL) AND is_discoverable AND (deleted_at IS NULL))`
- `organizations_onboarding_idx` — `organizations USING btree (onboarding_step) WHERE (onboarding_completed_at IS NULL)`

**Policies**

- `org_read` — SELECT USING `(id IN ( SELECT user_org_ids() AS user_org_ids))`
- `org_write` — UPDATE USING `has_org_role(id, 'admin'::org_role)` WITH CHECK `has_org_role(id, 'admin'::org_role)`

**Triggers**

- `organizations_guard_reserved`
- `organizations_touch`

## outcomes

RLS: **enabled**

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` |
| `org_id` | uuid | NOT NULL |  |
| `opportunity_id` | uuid | null |  |
| `campaign_id` | uuid | null |  |
| `kind` | text | NOT NULL |  |
| `value_cents` | bigint | null |  |
| `occurred_at` | timestamp with time zone | NOT NULL | `now()` |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |
| `updated_at` | timestamp with time zone | NOT NULL | `now()` |
| `score_id` | uuid | null |  |
| `person_id` | uuid | null |  |
| `outreach_angle` | text | null |  |
| `reason` | text | null |  |
| `reason_category` | text | null |  |
| `competitor_id` | uuid | null |  |
| `recorded_by` | uuid | null |  |

**Constraints**

- CHECK `outcomes_kind_check` — `CHECK ((kind = ANY (ARRAY['reply'::text, 'positive'::text, 'meeting'::text, 'proposal'::text, 'won'::text, 'lost'::text, 'disqualified'::text])))`
- CHECK `outcomes_reason_category_check` — `CHECK (((reason_category IS NULL) OR (reason_category = ANY (ARRAY['no_need'::text, 'no_budget'::text, 'timing'::text, 'chose_competitor'::text, 'missing_capability'::text, 'no_response'::text, 'not_a_fit'::text, 'wrong_contact'::text, 'other'::text]))))`
- CHECK `outcomes_reason_length` — `CHECK (((reason IS NULL) OR (length(reason) <= 1000)))`
- FK `outcomes_campaign_id_fkey` — `FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE SET NULL`
- FK `outcomes_competitor_id_fkey` — `FOREIGN KEY (competitor_id) REFERENCES competitors(id) ON DELETE SET NULL`
- FK `outcomes_opportunity_id_fkey` — `FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE SET NULL`
- FK `outcomes_org_id_fkey` — `FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE`
- FK `outcomes_person_id_fkey` — `FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE SET NULL`
- FK `outcomes_recorded_by_fkey` — `FOREIGN KEY (recorded_by) REFERENCES auth.users(id) ON DELETE SET NULL`
- FK `outcomes_score_id_fkey` — `FOREIGN KEY (score_id) REFERENCES opportunity_scores(id) ON DELETE SET NULL`
- PK `outcomes_pkey` — `PRIMARY KEY (id)`

**Indexes**

- `outcomes_learning_idx` — `outcomes USING btree (org_id, kind, occurred_at DESC)`
- `outcomes_score_idx` — `outcomes USING btree (org_id, score_id) WHERE (score_id IS NOT NULL)`

**Policies**

- `tenant_read` — SELECT USING `(org_id IN ( SELECT user_org_ids() AS user_org_ids))`
- `tenant_write` — ALL USING `has_org_role(org_id, 'member'::org_role)` WITH CHECK `has_org_role(org_id, 'member'::org_role)`

**Triggers**

- `outcomes_demand`
- `outcomes_project_activity`
- `outcomes_same_org`
- `outcomes_touch`

## people

RLS: **enabled**

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` |
| `org_id` | uuid | NOT NULL |  |
| `company_id` | uuid | NOT NULL |  |
| `first_name` | text | null |  |
| `last_name` | text | null |  |
| `title` | text | null |  |
| `seniority` | text | null |  |
| `linkedin_url` | text | null |  |
| `is_decision_maker` | boolean | NOT NULL | `false` |
| `source` | text | null |  |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |
| `updated_at` | timestamp with time zone | NOT NULL | `now()` |
| `deleted_at` | timestamp with time zone | null |  |
| `department` | text | null |  |
| `seniority_rank` | integer | null |  |
| `employment_status` | text | NOT NULL | `'unknown'::text` |
| `employment_checked_at` | timestamp with time zone | null |  |
| `departed_note` | text | null |  |
| `last_verified_at` | timestamp with time zone | null |  |
| `persona_id` | uuid | null |  |

**Constraints**

- CHECK `people_employment_status_check` — `CHECK ((employment_status = ANY (ARRAY['current'::text, 'departed'::text, 'unknown'::text])))`
- CHECK `people_seniority_rank_check` — `CHECK (((seniority_rank IS NULL) OR ((seniority_rank >= 0) AND (seniority_rank <= 100))))`
- FK `people_company_id_fkey` — `FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE`
- FK `people_org_id_fkey` — `FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE`
- FK `people_persona_id_fkey` — `FOREIGN KEY (persona_id) REFERENCES personas(id) ON DELETE SET NULL`
- PK `people_pkey` — `PRIMARY KEY (id)`

**Indexes**

- `people_company_idx` — `people USING btree (org_id, company_id)`
- `people_company_rank_idx` — `people USING btree (org_id, company_id, seniority_rank DESC) WHERE (deleted_at IS NULL)`

**Policies**

- `tenant_read` — SELECT USING `(org_id IN ( SELECT user_org_ids() AS user_org_ids))`
- `tenant_write` — ALL USING `has_org_role(org_id, 'member'::org_role)` WITH CHECK `has_org_role(org_id, 'member'::org_role)`

**Triggers**

- `people_same_org`
- `people_touch`

## personas

RLS: **enabled**

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` |
| `org_id` | uuid | NOT NULL |  |
| `icp_id` | uuid | NOT NULL |  |
| `name` | text | NOT NULL |  |
| `title_patterns` | text[] | NOT NULL | `'{}'::text[]` |
| `seniority` | text[] | NOT NULL | `'{}'::text[]` |
| `pain_points` | jsonb | NOT NULL | `'[]'::jsonb` |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |
| `updated_at` | timestamp with time zone | NOT NULL | `now()` |
| `deleted_at` | timestamp with time zone | null |  |
| `departments` | text[] | NOT NULL | `'{}'::text[]` |
| `exclude_titles` | text[] | NOT NULL | `'{}'::text[]` |
| `priority` | integer | NOT NULL | `1` |
| `is_primary` | boolean | NOT NULL | `false` |

**Constraints**

- CHECK `personas_priority_check` — `CHECK ((priority >= 1))`
- FK `personas_icp_id_fkey` — `FOREIGN KEY (icp_id) REFERENCES icps(id) ON DELETE CASCADE`
- FK `personas_org_id_fkey` — `FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE`
- PK `personas_pkey` — `PRIMARY KEY (id)`

**Indexes**

- `personas_icp_idx` — `personas USING btree (org_id, icp_id, priority) WHERE (deleted_at IS NULL)`

**Policies**

- `tenant_read` — SELECT USING `(org_id IN ( SELECT user_org_ids() AS user_org_ids))`
- `tenant_write` — ALL USING `has_org_role(org_id, 'member'::org_role)` WITH CHECK `has_org_role(org_id, 'member'::org_role)`

**Triggers**

- `personas_same_org`
- `personas_touch`

## plans

RLS: **enabled**

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | text | NOT NULL |  |
| `name` | text | NOT NULL |  |
| `price_cents` | integer | NOT NULL | `0` |
| `limits` | jsonb | NOT NULL | `'{}'::jsonb` |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |

**Constraints**

- PK `plans_pkey` — `PRIMARY KEY (id)`

**Policies**

- `plans_read` — SELECT USING `true`

## preference_signals

RLS: **enabled**

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` |
| `org_id` | uuid | NOT NULL |  |
| `user_id` | uuid | NOT NULL |  |
| `kind` | text | NOT NULL |  |
| `subject_type` | text | null |  |
| `subject_id` | uuid | null |  |
| `note` | text | null |  |
| `features` | jsonb | NOT NULL | `'{}'::jsonb` |
| `learned_at` | timestamp with time zone | null |  |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |

**Constraints**

- CHECK `preference_signals_kind_check` — `CHECK ((kind = ANY (ARRAY['draft_edited'::text, 'draft_rejected'::text, 'draft_regenerated'::text, 'assistant_correction'::text, 'score_override'::text, 'disqualified'::text, 'question_answered'::text, 'applied_dismissed'::text, 'task_instruction'::text])))`
- CHECK `preference_signals_note_check` — `CHECK (((note IS NULL) OR (length(note) <= 1000)))`
- FK `preference_signals_org_id_fkey` — `FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE`
- FK `preference_signals_user_id_fkey` — `FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE`
- PK `preference_signals_pkey` — `PRIMARY KEY (id)`

**Indexes**

- `preference_signals_pending_idx` — `preference_signals USING btree (org_id, user_id) WHERE (learned_at IS NULL)`
- `preference_signals_user_idx` — `preference_signals USING btree (org_id, user_id, created_at DESC)`

**Policies**

- `preference_signals_delete` — DELETE USING `((user_id = auth.uid()) AND (org_id IN ( SELECT user_org_ids() AS user_org_ids)))`
- `preference_signals_insert` — INSERT WITH CHECK `((user_id = auth.uid()) AND (org_id IN ( SELECT user_org_ids() AS user_org_ids)))`
- `preference_signals_own` — SELECT USING `((user_id = auth.uid()) AND (org_id IN ( SELECT user_org_ids() AS user_org_ids)))`

## preference_state

RLS: **enabled**

| Column | Type | Null | Default |
|---|---|---|---|
| `org_id` | uuid | NOT NULL |  |
| `user_id` | uuid | NOT NULL |  |
| `last_learned_at` | timestamp with time zone | null |  |
| `requested_at` | timestamp with time zone | null |  |
| `reviewed_at` | timestamp with time zone | null |  |

**Constraints**

- FK `preference_state_org_id_fkey` — `FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE`
- FK `preference_state_user_id_fkey` — `FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE`
- PK `preference_state_pkey` — `PRIMARY KEY (org_id, user_id)`

**Policies**

- `preference_state_own` — ALL USING `((user_id = auth.uid()) AND (org_id IN ( SELECT user_org_ids() AS user_org_ids)))` WITH CHECK `((user_id = auth.uid()) AND (org_id IN ( SELECT user_org_ids() AS user_org_ids)))`

## products

RLS: **enabled**

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` |
| `org_id` | uuid | NOT NULL |  |
| `name` | text | NOT NULL |  |
| `website` | text | null |  |
| `description` | text | null |  |
| `value_props` | jsonb | NOT NULL | `'[]'::jsonb` |
| `proof_points` | jsonb | NOT NULL | `'[]'::jsonb` |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |
| `updated_at` | timestamp with time zone | NOT NULL | `now()` |
| `deleted_at` | timestamp with time zone | null |  |
| `research` | jsonb | null |  |
| `researched_at` | timestamp with time zone | null |  |
| `research_is_live` | boolean | NOT NULL | `false` |

**Constraints**

- CHECK `products_research_is_object` — `CHECK (((research IS NULL) OR (jsonb_typeof(research) = 'object'::text)))`
- FK `products_org_id_fkey` — `FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE`
- PK `products_pkey` — `PRIMARY KEY (id)`

**Policies**

- `tenant_read` — SELECT USING `(org_id IN ( SELECT user_org_ids() AS user_org_ids))`
- `tenant_write` — ALL USING `has_org_role(org_id, 'member'::org_role)` WITH CHECK `has_org_role(org_id, 'member'::org_role)`

**Triggers**

- `products_touch`

## profiles

RLS: **enabled**

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | NOT NULL |  |
| `email` | text | null |  |
| `full_name` | text | null |  |
| `avatar_url` | text | null |  |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |
| `updated_at` | timestamp with time zone | NOT NULL | `now()` |
| `role` | text | null |  |
| `onboarded_at` | timestamp with time zone | null |  |
| `goals` | text[] | NOT NULL | `'{}'::text[]` |
| `learning_paused` | boolean | NOT NULL | `false` |

**Constraints**

- CHECK `profiles_goals_known` — `CHECK (((cardinality(goals) <= 2) AND (goals <@ ARRAY['discover'::text, 'qualify'::text, 'enrich'::text, 'reach_out'::text, 'learn'::text])))`
- CHECK `profiles_role_check` — `CHECK (((role IS NULL) OR (role = ANY (ARRAY['founder'::text, 'sales'::text, 'sdr'::text, 'gtm_generalist'::text, 'revops'::text, 'marketing'::text, 'agency'::text]))))`
- FK `profiles_id_fkey` — `FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE`
- PK `profiles_pkey` — `PRIMARY KEY (id)`

**Policies**

- `profile_read` — SELECT USING `((id = auth.uid()) OR (id IN ( SELECT co_member_ids() AS co_member_ids)))`
- `profile_self_write` — UPDATE USING `(id = auth.uid())` WITH CHECK `(id = auth.uid())`

**Triggers**

- `profiles_touch`

## provider_accounts

RLS: **enabled**

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` |
| `org_id` | uuid | NOT NULL |  |
| `capability` | text | NOT NULL |  |
| `provider` | text | NOT NULL |  |
| `is_enabled` | boolean | NOT NULL | `true` |
| `monthly_credit_limit` | bigint | null |  |
| `credential_status` | text | NOT NULL | `'unverified'::text` |
| `credential_checked_at` | timestamp with time zone | null |  |
| `credential_error` | text | null |  |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |
| `updated_at` | timestamp with time zone | NOT NULL | `now()` |
| `deleted_at` | timestamp with time zone | null |  |

**Constraints**

- CHECK `provider_accounts_capability_check` — `CHECK ((capability = ANY (ARRAY['company.search'::text, 'company.enrich'::text, 'person.search'::text, 'person.match'::text, 'email.verify'::text])))`
- CHECK `provider_accounts_credential_status_check` — `CHECK ((credential_status = ANY (ARRAY['unverified'::text, 'valid'::text, 'invalid'::text])))`
- CHECK `provider_accounts_monthly_credit_limit_check` — `CHECK (((monthly_credit_limit IS NULL) OR (monthly_credit_limit >= 0)))`
- FK `provider_accounts_org_id_fkey` — `FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE`
- PK `provider_accounts_pkey` — `PRIMARY KEY (id)`
- UNIQUE `provider_accounts_org_id_capability_key` — `UNIQUE (org_id, capability)`

**Policies**

- `tenant_read` — SELECT USING `(org_id IN ( SELECT user_org_ids() AS user_org_ids))`
- `tenant_write` — ALL USING `has_org_role(org_id, 'admin'::org_role)` WITH CHECK `has_org_role(org_id, 'admin'::org_role)`

**Triggers**

- `provider_accounts_touch`

## provider_breakers

RLS: **enabled**

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` |
| `org_id` | uuid | NOT NULL |  |
| `provider` | text | NOT NULL |  |
| `consecutive_failures` | integer | NOT NULL | `0` |
| `open_until` | timestamp with time zone | null |  |
| `last_error` | text | null |  |
| `last_failure_at` | timestamp with time zone | null |  |
| `last_success_at` | timestamp with time zone | null |  |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |
| `updated_at` | timestamp with time zone | NOT NULL | `now()` |

**Constraints**

- CHECK `provider_breakers_consecutive_failures_check` — `CHECK ((consecutive_failures >= 0))`
- FK `provider_breakers_org_id_fkey` — `FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE`
- PK `provider_breakers_pkey` — `PRIMARY KEY (id)`
- UNIQUE `provider_breakers_org_id_provider_key` — `UNIQUE (org_id, provider)`

**Policies**

- `tenant_read` — SELECT USING `(org_id IN ( SELECT user_org_ids() AS user_org_ids))`

**Triggers**

- `provider_breakers_touch`

## provider_cache

RLS: **enabled**

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` |
| `org_id` | uuid | NOT NULL |  |
| `capability` | text | NOT NULL |  |
| `provider` | text | NOT NULL |  |
| `request_hash` | text | NOT NULL |  |
| `body` | jsonb | NOT NULL |  |
| `raw` | jsonb | null |  |
| `fetched_at` | timestamp with time zone | NOT NULL | `now()` |
| `expires_at` | timestamp with time zone | NOT NULL |  |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |
| `updated_at` | timestamp with time zone | NOT NULL | `now()` |

**Constraints**

- FK `provider_cache_org_id_fkey` — `FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE`
- PK `provider_cache_pkey` — `PRIMARY KEY (id)`
- UNIQUE `provider_cache_org_id_request_hash_key` — `UNIQUE (org_id, request_hash)`

**Indexes**

- `provider_cache_expiry_idx` — `provider_cache USING btree (expires_at)`

**Policies**

- `tenant_read` — SELECT USING `(org_id IN ( SELECT user_org_ids() AS user_org_ids))`

**Triggers**

- `provider_cache_touch`

## provider_calls

RLS: **enabled**

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` |
| `org_id` | uuid | NOT NULL |  |
| `capability` | text | NOT NULL |  |
| `provider` | text | NOT NULL |  |
| `request_hash` | text | NOT NULL |  |
| `credits` | integer | NOT NULL | `0` |
| `outcome` | text | NOT NULL |  |
| `http_status` | integer | null |  |
| `latency_ms` | integer | null |  |
| `attempts` | integer | NOT NULL | `1` |
| `error` | text | null |  |
| `entity_type` | text | null |  |
| `entity_id` | uuid | null |  |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |

**Constraints**

- CHECK `provider_calls_attempts_check` — `CHECK ((attempts >= 1))`
- CHECK `provider_calls_credits_check` — `CHECK ((credits >= 0))`
- CHECK `provider_calls_latency_ms_check` — `CHECK (((latency_ms IS NULL) OR (latency_ms >= 0)))`
- CHECK `provider_calls_outcome_check` — `CHECK ((outcome = ANY (ARRAY['ok'::text, 'cache_hit'::text, 'partial'::text, 'empty'::text, 'rate_limited'::text, 'failed'::text, 'refused'::text])))`
- FK `provider_calls_org_id_fkey` — `FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE`
- PK `provider_calls_pkey` — `PRIMARY KEY (id)`

**Indexes**

- `provider_calls_failures_idx` — `provider_calls USING btree (org_id, provider, created_at DESC) WHERE (outcome = ANY (ARRAY['failed'::text, 'rate_limited'::text]))`
- `provider_calls_hash_idx` — `provider_calls USING btree (org_id, request_hash, created_at DESC)`
- `provider_calls_org_time_idx` — `provider_calls USING btree (org_id, created_at DESC)`

**Policies**

- `tenant_read` — SELECT USING `(org_id IN ( SELECT user_org_ids() AS user_org_ids))`

## public_research

RLS: **enabled**

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` |
| `canonical_domain` | text | NOT NULL |  |
| `understanding` | jsonb | NOT NULL |  |
| `is_live` | boolean | NOT NULL | `false` |
| `claimed_by` | uuid | null |  |
| `claimed_at` | timestamp with time zone | null |  |
| `claimed_org_id` | uuid | null |  |
| `ip_hash` | text | null |  |
| `request_count` | integer | NOT NULL | `1` |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |
| `updated_at` | timestamp with time zone | NOT NULL | `now()` |
| `expires_at` | timestamp with time zone | NOT NULL | `(now() + '30 days'::interval)` |

**Constraints**

- CHECK `public_research_claim_is_whole` — `CHECK (((claimed_by IS NULL) = (claimed_at IS NULL)))`
- CHECK `public_research_request_count_check` — `CHECK ((request_count >= 0))`
- FK `public_research_claimed_by_fkey` — `FOREIGN KEY (claimed_by) REFERENCES auth.users(id) ON DELETE SET NULL`
- FK `public_research_claimed_org_id_fkey` — `FOREIGN KEY (claimed_org_id) REFERENCES organizations(id) ON DELETE SET NULL`
- PK `public_research_pkey` — `PRIMARY KEY (id)`
- UNIQUE `public_research_canonical_domain_key` — `UNIQUE (canonical_domain)`

**Indexes**

- `public_research_expiry_idx` — `public_research USING btree (expires_at)`
- `public_research_unclaimed_idx` — `public_research USING btree (canonical_domain) WHERE (claimed_by IS NULL)`

**Triggers**

- `public_research_touch`

## public_research_attempts

RLS: **enabled**

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | NOT NULL |  |
| `ip_hash` | text | NOT NULL |  |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |

**Constraints**

- PK `public_research_attempts_pkey` — `PRIMARY KEY (id)`

**Indexes**

- `public_research_attempts_ip_idx` — `public_research_attempts USING btree (ip_hash, created_at)`
- `public_research_attempts_time_idx` — `public_research_attempts USING btree (created_at)`

## rate_limits

RLS: **enabled**

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` |
| `org_id` | uuid | NOT NULL |  |
| `user_id` | uuid | null |  |
| `action` | text | NOT NULL |  |
| `window_start` | timestamp with time zone | NOT NULL |  |
| `count` | integer | NOT NULL | `0` |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |

**Constraints**

- CHECK `rate_limits_count_nonneg` — `CHECK ((count >= 0))`
- FK `rate_limits_org_id_fkey` — `FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE`
- FK `rate_limits_user_id_fkey` — `FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE`
- PK `rate_limits_pkey` — `PRIMARY KEY (id)`

**Indexes**

- `rate_limits_org_window_idx` — `UNIQUE rate_limits USING btree (org_id, action, window_start) WHERE (user_id IS NULL)`
- `rate_limits_user_window_idx` — `UNIQUE rate_limits USING btree (org_id, user_id, action, window_start) WHERE (user_id IS NOT NULL)`
- `rate_limits_window_idx` — `rate_limits USING btree (window_start)`

**Policies**

- `rate_limit_read` — SELECT USING `(org_id IN ( SELECT user_org_ids() AS user_org_ids))`

## score_recompute_requests

RLS: **enabled**

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` |
| `org_id` | uuid | NOT NULL |  |
| `icp_id` | uuid | null |  |
| `reason` | text | NOT NULL |  |
| `status` | text | NOT NULL | `'pending'::text` |
| `requested_by` | uuid | null |  |
| `requested_at` | timestamp with time zone | NOT NULL | `now()` |
| `started_at` | timestamp with time zone | null |  |
| `finished_at` | timestamp with time zone | null |  |
| `cursor` | text | null |  |
| `companies_seen` | integer | NOT NULL | `0` |
| `scores_enqueued` | integer | NOT NULL | `0` |
| `error` | text | null |  |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |
| `updated_at` | timestamp with time zone | NOT NULL | `now()` |

**Constraints**

- CHECK `score_recompute_requests_reason_check` — `CHECK ((reason = ANY (ARRAY['rule_change'::text, 'icp_change'::text, 'manual'::text])))`
- CHECK `score_recompute_requests_status_check` — `CHECK ((status = ANY (ARRAY['pending'::text, 'running'::text, 'done'::text, 'failed'::text, 'cancelled'::text])))`
- FK `score_recompute_requests_icp_id_fkey` — `FOREIGN KEY (icp_id) REFERENCES icps(id) ON DELETE CASCADE`
- FK `score_recompute_requests_org_id_fkey` — `FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE`
- FK `score_recompute_requests_requested_by_fkey` — `FOREIGN KEY (requested_by) REFERENCES auth.users(id) ON DELETE SET NULL`
- PK `score_recompute_requests_pkey` — `PRIMARY KEY (id)`

**Indexes**

- `score_recompute_live_idx` — `UNIQUE score_recompute_requests USING btree (org_id, COALESCE((icp_id)::text, ''::text)) WHERE (status = ANY (ARRAY['pending'::text, 'running'::text]))`
- `score_recompute_recent_idx` — `score_recompute_requests USING btree (org_id, requested_at DESC)`

**Policies**

- `tenant_cancel` — UPDATE USING `(has_org_role(org_id, 'member'::org_role) AND (status = ANY (ARRAY['pending'::text, 'running'::text])))` WITH CHECK `(has_org_role(org_id, 'member'::org_role) AND (status = 'cancelled'::text))`
- `tenant_read` — SELECT USING `(org_id IN ( SELECT user_org_ids() AS user_org_ids))`

**Triggers**

- `score_recompute_requests_same_org`
- `score_recompute_requests_touch`

## scoring_rules

RLS: **enabled**

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` |
| `org_id` | uuid | NOT NULL |  |
| `icp_id` | uuid | null |  |
| `name` | text | NOT NULL |  |
| `expression` | jsonb | NOT NULL |  |
| `weight` | numeric | null |  |
| `is_active` | boolean | NOT NULL | `true` |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |
| `updated_at` | timestamp with time zone | NOT NULL | `now()` |
| `deleted_at` | timestamp with time zone | null |  |
| `intent` | rule_intent | null |  |
| `effect` | rule_effect | NOT NULL | `'adjust'::rule_effect` |
| `floor_priority` | opportunity_priority | null |  |
| `rationale` | text | null |  |
| `basis` | text | null |  |
| `origin` | text | NOT NULL | `'user'::text` |
| `proposed_at` | timestamp with time zone | null |  |
| `approved_by` | uuid | null |  |
| `approved_at` | timestamp with time zone | null |  |

**Constraints**

- CHECK `scoring_rules_effect_arguments` — `CHECK ((((effect = 'floor'::rule_effect) AND (floor_priority IS NOT NULL) AND (weight IS NULL)) OR ((effect = 'adjust'::rule_effect) AND (floor_priority IS NULL) AND (weight IS NOT NULL)) OR ((effect = 'veto'::rule_effect) AND (floor_priority IS NULL) AND (weight IS NULL))))`
- CHECK `scoring_rules_origin_check` — `CHECK ((origin = ANY (ARRAY['user'::text, 'drafted'::text, 'learned'::text])))`
- CHECK `scoring_rules_weight_bounded` — `CHECK (((weight IS NULL) OR ((weight >= ('-40'::integer)::numeric) AND (weight <= (40)::numeric))))`
- FK `scoring_rules_approved_by_fkey` — `FOREIGN KEY (approved_by) REFERENCES auth.users(id) ON DELETE SET NULL`
- FK `scoring_rules_icp_id_fkey` — `FOREIGN KEY (icp_id) REFERENCES icps(id) ON DELETE CASCADE`
- FK `scoring_rules_org_id_fkey` — `FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE`
- PK `scoring_rules_pkey` — `PRIMARY KEY (id)`

**Indexes**

- `scoring_rules_active_idx` — `scoring_rules USING btree (org_id, icp_id) WHERE ((is_active = true) AND (deleted_at IS NULL))`

**Policies**

- `tenant_read` — SELECT USING `(org_id IN ( SELECT user_org_ids() AS user_org_ids))`
- `tenant_write` — ALL USING `has_org_role(org_id, 'member'::org_role)` WITH CHECK `has_org_role(org_id, 'member'::org_role)`

**Triggers**

- `scoring_rules_same_org`
- `scoring_rules_touch`

## sequence_steps

RLS: **enabled**

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` |
| `org_id` | uuid | NOT NULL |  |
| `sequence_id` | uuid | NOT NULL |  |
| `position` | integer | NOT NULL |  |
| `kind` | text | NOT NULL |  |
| `delay_hours` | integer | NOT NULL | `0` |
| `template` | jsonb | NOT NULL | `'{}'::jsonb` |
| `conditions` | jsonb | NOT NULL | `'{}'::jsonb` |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |
| `updated_at` | timestamp with time zone | NOT NULL | `now()` |
| `deleted_at` | timestamp with time zone | null |  |

**Constraints**

- CHECK `sequence_steps_kind_check` — `CHECK ((kind = ANY (ARRAY['email'::text, 'wait'::text, 'condition'::text])))`
- FK `sequence_steps_org_id_fkey` — `FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE`
- FK `sequence_steps_sequence_id_fkey` — `FOREIGN KEY (sequence_id) REFERENCES sequences(id) ON DELETE CASCADE`
- PK `sequence_steps_pkey` — `PRIMARY KEY (id)`
- UNIQUE `sequence_steps_org_id_sequence_id_position_key` — `UNIQUE (org_id, sequence_id, "position")`

**Policies**

- `tenant_read` — SELECT USING `(org_id IN ( SELECT user_org_ids() AS user_org_ids))`
- `tenant_write` — ALL USING `has_org_role(org_id, 'member'::org_role)` WITH CHECK `has_org_role(org_id, 'member'::org_role)`

**Triggers**

- `sequence_steps_same_org`
- `sequence_steps_touch`

## sequences

RLS: **enabled**

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` |
| `org_id` | uuid | NOT NULL |  |
| `campaign_id` | uuid | NOT NULL |  |
| `name` | text | NOT NULL |  |
| `version` | integer | NOT NULL | `1` |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |
| `updated_at` | timestamp with time zone | NOT NULL | `now()` |
| `deleted_at` | timestamp with time zone | null |  |

**Constraints**

- FK `sequences_campaign_id_fkey` — `FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE`
- FK `sequences_org_id_fkey` — `FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE`
- PK `sequences_pkey` — `PRIMARY KEY (id)`

**Policies**

- `tenant_read` — SELECT USING `(org_id IN ( SELECT user_org_ids() AS user_org_ids))`
- `tenant_write` — ALL USING `has_org_role(org_id, 'member'::org_role)` WITH CHECK `has_org_role(org_id, 'member'::org_role)`

**Triggers**

- `sequences_same_org`
- `sequences_touch`

## source_documents

RLS: **enabled**

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` |
| `org_id` | uuid | NOT NULL |  |
| `source_id` | uuid | NOT NULL |  |
| `url` | text | NOT NULL |  |
| `canonical_url` | text | null |  |
| `title` | text | null |  |
| `published_at` | timestamp with time zone | null |  |
| `fetched_at` | timestamp with time zone | NOT NULL | `now()` |
| `content_hash` | text | NOT NULL |  |
| `raw_ref` | text | null |  |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |
| `updated_at` | timestamp with time zone | NOT NULL | `now()` |
| `url_hash` | text | null |  |

**Constraints**

- FK `source_documents_org_id_fkey` — `FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE`
- FK `source_documents_source_id_fkey` — `FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE`
- PK `source_documents_pkey` — `PRIMARY KEY (id)`
- UNIQUE `source_documents_org_id_content_hash_key` — `UNIQUE (org_id, content_hash)`

**Indexes**

- `source_documents_url_idx` — `UNIQUE source_documents USING btree (org_id, url_hash) WHERE (url_hash IS NOT NULL)`

**Policies**

- `tenant_read` — SELECT USING `(org_id IN ( SELECT user_org_ids() AS user_org_ids))`
- `tenant_write` — ALL USING `has_org_role(org_id, 'member'::org_role)` WITH CHECK `has_org_role(org_id, 'member'::org_role)`

**Triggers**

- `source_documents_same_org`
- `source_documents_touch`

## source_events

RLS: **enabled**

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` |
| `org_id` | uuid | NOT NULL |  |
| `source_document_id` | uuid | null |  |
| `company_id` | uuid | null |  |
| `event_type` | text | NOT NULL |  |
| `event_date` | timestamp with time zone | null |  |
| `observed_at` | timestamp with time zone | NOT NULL | `now()` |
| `description` | text | null |  |
| `confidence` | confidence | null |  |
| `kind` | claim_kind | NOT NULL | `'inference'::claim_kind` |
| `url` | text | null |  |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |
| `updated_at` | timestamp with time zone | NOT NULL | `now()` |

**Constraints**

- FK `source_events_company_fk` — `FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE`
- FK `source_events_org_id_fkey` — `FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE`
- FK `source_events_source_document_id_fkey` — `FOREIGN KEY (source_document_id) REFERENCES source_documents(id) ON DELETE CASCADE`
- PK `source_events_pkey` — `PRIMARY KEY (id)`

**Indexes**

- `source_events_company_idx` — `source_events USING btree (org_id, company_id, event_date DESC)`

**Policies**

- `tenant_read` — SELECT USING `(org_id IN ( SELECT user_org_ids() AS user_org_ids))`
- `tenant_write` — ALL USING `has_org_role(org_id, 'member'::org_role)` WITH CHECK `has_org_role(org_id, 'member'::org_role)`

**Triggers**

- `source_events_same_org`
- `source_events_touch`

## sources

RLS: **enabled**

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` |
| `org_id` | uuid | NOT NULL |  |
| `icp_id` | uuid | null |  |
| `kind` | source_kind | NOT NULL |  |
| `name` | text | NOT NULL |  |
| `url` | text | null |  |
| `is_enabled` | boolean | NOT NULL | `true` |
| `recommended_by` | text | NOT NULL | `'system'::text` |
| `status` | source_status | NOT NULL | `'ok'::source_status` |
| `failure_count` | integer | NOT NULL | `0` |
| `last_scanned_at` | timestamp with time zone | null |  |
| `last_error` | text | null |  |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |
| `updated_at` | timestamp with time zone | NOT NULL | `now()` |
| `deleted_at` | timestamp with time zone | null |  |
| `scan_interval_minutes` | integer | NOT NULL | `1440` |
| `next_scan_at` | timestamp with time zone | null |  |
| `config` | jsonb | NOT NULL | `'{}'::jsonb` |
| `last_success_at` | timestamp with time zone | null |  |

**Constraints**

- CHECK `sources_recommended_by_check` — `CHECK ((recommended_by = ANY (ARRAY['system'::text, 'user'::text])))`
- CHECK `sources_scan_interval_minutes_check` — `CHECK ((scan_interval_minutes >= 5))`
- FK `sources_icp_id_fkey` — `FOREIGN KEY (icp_id) REFERENCES icps(id) ON DELETE SET NULL`
- FK `sources_org_id_fkey` — `FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE`
- PK `sources_pkey` — `PRIMARY KEY (id)`

**Indexes**

- `sources_due_idx` — `sources USING btree (next_scan_at) WHERE (is_enabled AND (deleted_at IS NULL))`
- `sources_org_status_idx` — `sources USING btree (org_id, status) WHERE is_enabled`

**Policies**

- `tenant_read` — SELECT USING `(org_id IN ( SELECT user_org_ids() AS user_org_ids))`
- `tenant_write` — ALL USING `has_org_role(org_id, 'member'::org_role)` WITH CHECK `has_org_role(org_id, 'member'::org_role)`

**Triggers**

- `sources_same_org`
- `sources_touch`

## subscriptions

RLS: **enabled**

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` |
| `org_id` | uuid | NOT NULL |  |
| `stripe_sub_id` | text | null |  |
| `status` | text | NOT NULL |  |
| `current_period_end` | timestamp with time zone | null |  |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |
| `updated_at` | timestamp with time zone | NOT NULL | `now()` |
| `deleted_at` | timestamp with time zone | null |  |

**Constraints**

- FK `subscriptions_org_id_fkey` — `FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE`
- PK `subscriptions_pkey` — `PRIMARY KEY (id)`
- UNIQUE `subscriptions_stripe_sub_id_key` — `UNIQUE (stripe_sub_id)`

**Policies**

- `subscription_read` — SELECT USING `(org_id IN ( SELECT user_org_ids() AS user_org_ids))`

**Triggers**

- `subscriptions_touch`

## suppressions

RLS: **enabled**

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` |
| `org_id` | uuid | NOT NULL |  |
| `kind` | text | NOT NULL |  |
| `value` | text | NOT NULL |  |
| `reason` | text | null |  |
| `source` | text | null |  |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |
| `updated_at` | timestamp with time zone | NOT NULL | `now()` |
| `value_hash` | text | null |  |
| `is_erasure_residue` | boolean | NOT NULL | `false` |

**Constraints**

- CHECK `suppressions_kind_check` — `CHECK ((kind = ANY (ARRAY['email'::text, 'domain'::text])))`
- FK `suppressions_org_id_fkey` — `FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE`
- PK `suppressions_pkey` — `PRIMARY KEY (id)`
- UNIQUE `suppressions_org_id_kind_value_key` — `UNIQUE (org_id, kind, value)`

**Indexes**

- `suppressions_hash_idx` — `suppressions USING btree (org_id, value_hash) WHERE (value_hash IS NOT NULL)`

**Policies**

- `tenant_read` — SELECT USING `(org_id IN ( SELECT user_org_ids() AS user_org_ids))`
- `tenant_write` — ALL USING `has_org_role(org_id, 'member'::org_role)` WITH CHECK `has_org_role(org_id, 'member'::org_role)`

**Triggers**

- `suppressions_touch`

## threads

RLS: **enabled**

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` |
| `org_id` | uuid | NOT NULL |  |
| `opportunity_id` | uuid | null |  |
| `mailbox_id` | uuid | null |  |
| `subject` | text | null |  |
| `status` | text | NOT NULL | `'open'::text` |
| `classification` | text | null |  |
| `assignee_id` | uuid | null |  |
| `last_message_at` | timestamp with time zone | null |  |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |
| `updated_at` | timestamp with time zone | NOT NULL | `now()` |
| `deleted_at` | timestamp with time zone | null |  |
| `provider_thread_id` | text | null |  |
| `participants` | text[] | NOT NULL | `'{}'::text[]` |

**Constraints**

- FK `threads_assignee_id_fkey` — `FOREIGN KEY (assignee_id) REFERENCES auth.users(id) ON DELETE SET NULL`
- FK `threads_mailbox_id_fkey` — `FOREIGN KEY (mailbox_id) REFERENCES mailboxes(id) ON DELETE SET NULL`
- FK `threads_opportunity_id_fkey` — `FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE SET NULL`
- FK `threads_org_id_fkey` — `FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE`
- PK `threads_pkey` — `PRIMARY KEY (id)`

**Indexes**

- `threads_provider_idx` — `UNIQUE threads USING btree (org_id, mailbox_id, provider_thread_id) WHERE (provider_thread_id IS NOT NULL)`

**Policies**

- `tenant_read` — SELECT USING `(org_id IN ( SELECT user_org_ids() AS user_org_ids))`
- `tenant_write` — ALL USING `has_org_role(org_id, 'member'::org_role)` WITH CHECK `has_org_role(org_id, 'member'::org_role)`

**Triggers**

- `threads_same_org`
- `threads_touch`

## usage_counters

RLS: **enabled**

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` |
| `org_id` | uuid | NOT NULL |  |
| `period` | text | NOT NULL |  |
| `metric` | text | NOT NULL |  |
| `used` | bigint | NOT NULL | `0` |
| `limit` | bigint | null |  |
| `created_at` | timestamp with time zone | NOT NULL | `now()` |
| `updated_at` | timestamp with time zone | NOT NULL | `now()` |

**Constraints**

- FK `usage_counters_org_id_fkey` — `FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE`
- PK `usage_counters_pkey` — `PRIMARY KEY (id)`
- UNIQUE `usage_counters_org_id_period_metric_key` — `UNIQUE (org_id, period, metric)`

**Policies**

- `usage_read` — SELECT USING `(org_id IN ( SELECT user_org_ids() AS user_org_ids))`

**Triggers**

- `usage_counters_touch`

## user_questions

RLS: **enabled**

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` |
| `org_id` | uuid | NOT NULL |  |
| `user_id` | uuid | NOT NULL |  |
| `question_key` | text | NOT NULL |  |
| `status` | text | NOT NULL | `'asked'::text` |
| `asked_at` | timestamp with time zone | NOT NULL | `now()` |
| `answered_at` | timestamp with time zone | null |  |
| `snooze_until` | timestamp with time zone | null |  |
| `answer` | jsonb | null |  |
| `memory_id` | uuid | null |  |
| `updated_at` | timestamp with time zone | NOT NULL | `now()` |

**Constraints**

- CHECK `user_questions_question_key_check` — `CHECK ((question_key ~ '^[a-z][a-z0-9_.]{1,80}$'::text))`
- CHECK `user_questions_status_check` — `CHECK ((status = ANY (ARRAY['asked'::text, 'answered'::text, 'dismissed'::text, 'snoozed'::text])))`
- FK `user_questions_memory_id_fkey` — `FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE SET NULL`
- FK `user_questions_org_id_fkey` — `FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE`
- FK `user_questions_user_id_fkey` — `FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE`
- PK `user_questions_pkey` — `PRIMARY KEY (id)`
- UNIQUE `user_questions_org_id_user_id_question_key_key` — `UNIQUE (org_id, user_id, question_key)`

**Policies**

- `user_questions_own` — ALL USING `((user_id = auth.uid()) AND (org_id IN ( SELECT user_org_ids() AS user_org_ids)))` WITH CHECK `((user_id = auth.uid()) AND (org_id IN ( SELECT user_org_ids() AS user_org_ids)))`

**Triggers**

- `user_questions_same_org`
- `user_questions_touch`

## Views

- `angle_performance`
- `discovery_performance`
- `job_dead_letters`
- `job_health`
- `persona_performance`
- `pipeline_throughput`
- `provider_health`
- `queue_pressure`
- `spend_by_period`

## Enum types

- `claim_kind`: fact, inference, unknown
- `confidence`: low, medium, high
- `memory_scope`: organization, team, user, account, opportunity
- `opportunity_priority`: hot, warm, watch, ignore
- `opportunity_status`: discovered, researching, qualified, assigned, contacted, replied, meeting, proposal, won, lost, archived
- `org_role`: owner, admin, member, viewer
- `rule_effect`: adjust, veto, floor
- `rule_intent`: prioritize, reject, boost, penalty
- `source_kind`: news, blog, jobs, social, github, funding, regulatory, community, podcast, custom
- `source_status`: ok, degraded, unavailable

## Functions (public schema)

| Function | Arguments | Returns | SECURITY DEFINER |
|---|---|---|---|
| `accept_invitation` | `p_token uuid` | TABLE(joined_org_id uuid, joined_org_slug text, joined_role org_role) | yes |
| `active_rules_version` | `p_org uuid` | text | yes |
| `advance_onboarding` | `p_org uuid, p_step text, p_goals text[]` | text | yes |
| `advance_recompute` | `p_request uuid, p_cursor text, p_seen integer, p_enqueued integer, p_done boolean` | text | yes |
| `approve_join_request` | `p_request uuid` | uuid |  |
| `backfill_activities` | `p_org uuid` | jsonb | yes |
| `backlog_cap` | `p_org uuid` | bigint | yes |
| `backlog_state` | `p_org uuid` | TABLE(open_count bigint, cap bigint, saturated boolean) | yes |
| `backlog_state_for_org` | `p_org uuid` | TABLE(open_count bigint, cap bigint, saturated boolean) | yes |
| `bump_icp_version` | `p_org uuid, p_icp uuid, p_diff jsonb, p_quality integer, p_actor uuid` | uuid | yes |
| `bump_icp_version_for_org` | `p_org uuid, p_icp uuid, p_diff jsonb, p_quality integer` | uuid | yes |
| `can_contact` | `p_org uuid, p_email text` | TABLE(allowed boolean, reason text, detail jsonb) | yes |
| `cancel_job` | `p_org uuid, p_job uuid` | boolean | yes |
| `check_quota` | `p_org uuid, p_metric text` | TABLE(used bigint, quota bigint, allowed boolean) | yes |
| `check_quota_internal` | `p_org uuid, p_metric text` | TABLE(used bigint, quota bigint, allowed boolean) | yes |
| `claim_due_discovery_queries` | `p_limit integer` | TABLE(id uuid, org_id uuid) | yes |
| `claim_due_recomputes` | `p_limit integer` | TABLE(id uuid, org_id uuid, icp_id uuid, reason text, cursor text) | yes |
| `claim_job_executions` | `p_limit integer, p_worker text` | SETOF job_executions |  |
| `claim_mailbox_send` | `p_mailbox uuid` | boolean |  |
| `claim_research` |  | TABLE(research_domain text, understanding jsonb, is_live boolean) | yes |
| `co_member_ids` |  | SETOF uuid | yes |
| `consume_rate_limit` | `p_org uuid, p_action text, p_limit integer, p_window_seconds integer, p_per_user boolean` | TABLE(allowed boolean, remaining integer, reset_at timestamp with time zone) | yes |
| `create_organization` | `p_name text, p_slug text, p_domain text` | uuid | yes |
| `delete_organization` | `p_org uuid` | void | yes |
| `delete_own_account` |  | void | yes |
| `demand_forget_erased` |  | trigger | yes |
| `demand_from_activity` |  | trigger | yes |
| `demand_from_outcome` |  | trigger | yes |
| `discoverable_workspaces` |  | TABLE(org_id uuid, org_name text, org_slug text, member_count bigint) | yes |
| `enforce_same_org_refs` |  | trigger | yes |
| `erase_contact` | `p_org uuid, p_email text, p_actor uuid` | jsonb | yes |
| `erase_contact_for_org` | `p_org uuid, p_email text` | jsonb | yes |
| `export_contact` | `p_org uuid, p_email text` | jsonb | yes |
| `export_contact_for_org` | `p_org uuid, p_email text` | jsonb | yes |
| `export_my_learning` | `p_org uuid` | jsonb |  |
| `export_organization` | `p_org uuid` | jsonb | yes |
| `fail_recompute` | `p_request uuid, p_error text` | void | yes |
| `finish_discovery_run` | `p_run uuid, p_status text, p_stop_reason text, p_error text, p_cursor text, p_total bigint` | void | yes |
| `flag_contradictions` | `p_org uuid, p_subject_type text, p_subject uuid` | integer | yes |
| `guard_activity_authorship` |  | trigger |  |
| `guard_invitation_owner` |  | trigger | yes |
| `guard_membership_owner` |  | trigger | yes |
| `guard_organization_reserved` |  | trigger |  |
| `handle_new_user` |  | trigger | yes |
| `has_org_role` | `target_org uuid, min_role org_role` | boolean | yes |
| `increment_usage` | `p_org uuid, p_metric text, p_amount bigint` | TABLE(used bigint, quota bigint, allowed boolean) | yes |
| `increment_usage_internal` | `p_org uuid, p_metric text, p_amount bigint` | TABLE(used bigint, quota bigint, allowed boolean) | yes |
| `is_suppressed` | `p_org uuid, p_email text` | boolean |  |
| `issue_unsubscribe_token` |  | trigger | yes |
| `jsonb_keys_within` | `p_obj jsonb, p_allowed text[]` | boolean |  |
| `mailbox_remaining_today` | `p_mailbox uuid` | integer |  |
| `memories_origin_from_source` |  | trigger |  |
| `merge_companies` | `p_org uuid, p_winner uuid, p_loser uuid, p_reason text, p_actor uuid, p_method text, p_confidence confidence` | uuid | yes |
| `merge_companies_for_org` | `p_org uuid, p_winner uuid, p_loser uuid, p_reason text` | uuid | yes |
| `merge_duplicate_evidence` | `p_org uuid, p_subject_type text, p_subject uuid` | integer | yes |
| `message_opportunity` | `p_message messages` | uuid | yes |
| `migration_0031_applied` |  | boolean |  |
| `migration_0032_applied` |  | boolean |  |
| `migration_0033_applied` |  | boolean |  |
| `migration_0034_applied` |  | boolean |  |
| `migration_0035_applied` |  | boolean |  |
| `migration_0036_applied` |  | boolean |  |
| `migration_0037_applied` |  | boolean |  |
| `migration_0038_applied` |  | boolean |  |
| `migration_0039_applied` |  | boolean |  |
| `migration_0040_applied` |  | boolean |  |
| `migration_0041_applied` |  | boolean |  |
| `migration_0042_applied` |  | boolean |  |
| `migration_0043_applied` |  | boolean |  |
| `migration_0044_applied` |  | boolean |  |
| `migration_0045_applied` |  | boolean |  |
| `migration_0046_applied` |  | boolean |  |
| `migration_0047_applied` |  | boolean |  |
| `open_opportunity_count` | `p_org uuid` | bigint | yes |
| `org_has_hubspot` | `p_org uuid` | boolean | yes |
| `project_message_activity` |  | trigger | yes |
| `project_message_event_activity` |  | trigger | yes |
| `project_opportunity_activity` |  | trigger | yes |
| `project_outcome_activity` |  | trigger | yes |
| `project_override_activity` |  | trigger | yes |
| `provider_budget_for_org` | `p_org uuid, p_provider text` | TABLE(used bigint, "limit" bigint, remaining bigint, allowed boolean) | yes |
| `provider_budget_state` | `p_org uuid, p_provider text` | TABLE(used bigint, "limit" bigint, remaining bigint, allowed boolean) | yes |
| `prune_provider_cache` |  | integer | yes |
| `prune_rate_limits` | `p_older_than interval` | integer | yes |
| `prune_stale_contacts` | `p_org uuid` | integer | yes |
| `purge_expired_research` |  | integer | yes |
| `record_contact_reply` | `p_org uuid, p_email text` | void | yes |
| `record_contact_send` | `p_org uuid, p_email text` | void | yes |
| `record_override` | `p_org uuid, p_subject text, p_entity_type text, p_entity_id uuid, p_system text, p_human text, p_reason text, p_score uuid` | uuid | yes |
| `record_provider_call` | `p_org uuid, p_capability text, p_provider text, p_hash text, p_outcome text, p_credits integer, p_http_status integer, p_latency_ms integer, p_attempts integer, p_error text, p_entity_type text, p_entity_id uuid` | uuid | yes |
| `record_source_failure` | `p_source uuid, p_error text` | void |  |
| `record_source_success` | `p_source uuid` | void |  |
| `record_unsubscribe` | `p_token uuid, p_reason text` | TABLE(suppressed_org_id uuid, suppressed_email text) | yes |
| `request_score_recompute` | `p_org uuid, p_icp uuid, p_reason text` | uuid | yes |
| `request_to_join` | `p_org uuid` | text | yes |
| `requeue_stalled_jobs` | `p_older_than interval` | integer |  |
| `reserve_public_research` | `p_ip_hash text, p_per_ip_hour integer, p_daily integer` | TABLE(allowed boolean, reason text) | yes |
| `resolve_company` | `p_org uuid, p_domain text, p_provider text, p_provider_id text` | TABLE(company_id uuid, matched_on text) | yes |
| `retry_job` | `p_org uuid, p_job uuid` | boolean | yes |
| `saturated_org_ids` |  | SETOF uuid | yes |
| `touch_updated_at` |  | trigger |  |
| `usage_limit` | `p_org uuid, p_metric text` | bigint | yes |
| `user_org_ids` |  | SETOF uuid | yes |
| `write_audit_log` | `p_org uuid, p_action text, p_target_type text, p_target_id uuid, p_meta jsonb` | uuid | yes |
| `write_audit_log_internal` | `p_org uuid, p_action text, p_target_type text, p_target_id uuid, p_meta jsonb` | uuid | yes |
