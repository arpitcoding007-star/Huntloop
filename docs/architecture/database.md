---
description: Schema conventions, RLS design, the function catalogue, and how migrations are applied.
---

# Database

> **Layer:** Internal · **Audience:** engineering, operations

Supabase Postgres. **28 migrations · 69 tables · 63 functions.** Migrations are
plain `.sql` files in `packages/db/migrations/`, numbered and applied in order.

## Conventions

| Convention | Rule |
|---|---|
| Primary key | `uuid`, `default gen_random_uuid()` |
| Tenancy | Every tenant table carries `org_id uuid not null references organizations(id) on delete cascade` |
| Timestamps | `created_at`, `updated_at` (`touch_updated_at` trigger), `deleted_at` for soft delete |
| Extensions | None required — `gen_random_uuid()` is Postgres core since 13 |
| Comments | Every table and non-obvious function carries a `comment on`, citing the spec section it implements |
| Enums | Declared as Postgres types, mirrored in TypeScript, and cross-checked by tests |

## Row Level Security

RLS is **the** security boundary. Every tenant table has it enabled, and every
tenant-isolation policy calls exactly one function:

```sql
create or replace function public.user_org_ids()
returns setof uuid language sql stable security definer
set search_path = public, pg_catalog
as $$
  select org_id from public.memberships
  where user_id = auth.uid() and deleted_at is null
$$;
```

Reads use it directly; writes go through the role check:

```sql
create policy thing_read  on things for select
  using (org_id in (select public.user_org_ids()));

create policy thing_write on things for all
  using      (public.has_org_role(org_id, 'member'))
  with check (public.has_org_role(org_id, 'member'));
```

### The enum-ordinal trick, and its one hazard

`org_role` is declared **most- to least-privileged**:

```sql
create type org_role as enum ('owner', 'admin', 'member', 'viewer');
```

`has_org_role` compares ordinals with `m.role <= min_role`, so "my role is at
or above the minimum".

{% hint style="danger" %}
**Reordering that enum silently changes every policy in the database.** The
migration says so in a `comment on`. Do not reorder it; add new roles at the
end and revisit every policy deliberately.
{% endhint %}

### `SECURITY DEFINER` and the `_for_org` pattern

Some operations legitimately need to bypass RLS — a merge that rewrites rows
across several tables, an invitation acceptance that writes a membership the
caller does not yet have. The pattern is consistent:

| Internal function | Caller-facing wrapper | Who may call it |
|---|---|---|
| `merge_companies` | `merge_companies_for_org` | A member, checked inside |
| `bump_icp_version` | `bump_icp_version_for_org` | A member |
| `erase_contact` | `erase_contact_for_org` | A member |
| `provider_budget_state` | `provider_budget_for_org` | A member |
| `backlog_state` | `backlog_state_for_org` | A member |
| `increment_usage_internal` | `increment_usage` | `service_role` vs. member |
| `check_quota_internal` | `check_quota` | `service_role` vs. member |
| `write_audit_log_internal` | `write_audit_log` | `service_role` vs. member |

Every wrapper is `SECURITY DEFINER` with a membership check **inside it**, and
sets `search_path` explicitly.

## The function catalogue

Grouped by what they are for.

### Tenancy and access
`user_org_ids` · `has_org_role` · `co_member_ids` · `handle_new_user` ·
`accept_invitation` · `discoverable_workspaces` · `request_to_join` ·
`approve_join_request` · `advance_onboarding`

### Metering and money
`usage_limit` · `increment_usage` / `_internal` · `check_quota` / `_internal` ·
`consume_rate_limit` · `prune_rate_limits` · `provider_budget_state` /
`_for_org` · `record_provider_call` · `prune_provider_cache`

### The queue
`claim_job_executions` · `requeue_stalled_jobs` · `retry_job` · `cancel_job`

### Sources and scanning
`record_source_failure` · `record_source_success`

### Discovery
`claim_due_discovery_queries` · `finish_discovery_run`

### Identity and dedupe
`resolve_company` · `merge_companies` / `_for_org` · `merge_duplicate_evidence` ·
`flag_contradictions`

### Scoring
`record_override` · `active_rules_version` · `request_score_recompute` ·
`claim_due_recomputes` · `advance_recompute` · `fail_recompute`

### Outreach safety
`can_contact` · `record_contact_send` · `record_contact_reply` ·
`is_suppressed` · `record_unsubscribe` · `mailbox_remaining_today` ·
`claim_mailbox_send`

### Compliance
`erase_contact` / `_for_org` · `export_contact` · `prune_stale_contacts` ·
`purge_expired_research` · `claim_research`

### Learning and load
`open_opportunity_count` · `backlog_cap` · `backlog_state` / `_for_org` ·
`saturated_org_ids`

### Utility
`touch_updated_at` · `jsonb_keys_within` · `write_audit_log` / `_internal` ·
`bump_icp_version` / `_for_org`

## Migration history

| # | Migration | What it added |
|---|---|---|
| 0001 | `identity` | Orgs, memberships, plans, subscriptions, usage, audit; `user_org_ids`, `has_org_role` |
| 0002 | `icp_sources_evidence` | Products, ICPs, personas, sources, documents, **evidence**, source events |
| 0003 | `companies_opportunities` | Companies, problems, gaps, triggers, people, contact points, **opportunities**, scoring rules, scores |
| 0004 | `outreach_memory_learning` | Mailboxes, campaigns, sequences, enrollments, suppressions, threads, messages, memories, `ai_runs`, outcomes, **`job_executions`** |
| 0005 | `rate_limits` | `consume_rate_limit` in Postgres |
| 0006 | `prune_schedule` | Pruning schedule |
| 0007 | `profiles_invites_accounting` | Profiles, invitations, `accept_invitation`, quota functions |
| 0008 | `engine_columns` | The claim/retry/backoff machinery; mailbox allowances; unsubscribe |
| 0009 | `service_role_surface` | The `_internal` variants |
| 0010 | `learning_loop` | Rule intent/effect, learning runs and findings, backlog functions |
| 0011 | `providers` | Provider accounts, calls, cache, breakers, budget |
| 0012 | `entity_identity` | `company_domains`, `external_ids`, merges, merge candidates |
| 0013 | `icp_v2` | ICP versioning, 15 criteria keys, `jsonb_keys_within` |
| 0014 | `discovery` | Discovery queries, runs, results |
| 0015 | `competitors` | Competitors, profiles, signals |
| 0016 | `contacts_scoring_v2` | `contact_fit_scores`, `human_overrides`, drift indexes |
| 0017 | `outreach_safety` | `can_contact`, cadence caps, erasure, retention |
| 0018 | `learning_targets` | Finding targets, message angles, outcome scoring |
| 0019 | `ops_views` | `retry_job`, `cancel_job` |
| 0020 | `evidence_v2` | Field-level evidence, `flag_contradictions` |
| 0021 | `competitor_evidence` | Evidence about competitors |
| 0022 | `evidence_dedupe` | Claim hashing, `evidence_citations`, `merge_duplicate_evidence` |
| 0023 | `score_recompute` | The recompute request seam |
| 0024 | `onboarding` | Onboarding step/role/goal columns with `CHECK`s |
| 0025 | `anonymous_research` | `public_research`, `claim_research`, expiry |
| 0026 | `product_research` | Product research columns |
| 0027 | `org_directory` | Org domain, discoverable workspaces, join requests |
| 0028 | `signals_and_crm` | Signal staleness, `hubspot_connections` |

`COMBINED-0024-0027.sql` exists so four migrations can be pasted in one go.

## Applying migrations

{% hint style="danger" %}
**Migrations are applied by hand, one file at a time, in the Supabase SQL
editor.** There is no automated migration step. This is the largest operational
risk in the project.
{% endhint %}

`npm run db:doctor` exists because of it. A half-applied schema does not
announce itself — the app's own probe checks one table and will happily report
a project missing the rate-limit migration as fully migrated. That is not
hypothetical; it is the state this repo's configured project was once found in.

```bash
npm run db:doctor        # which migrations this project has actually had applied
npm run db:seed          # one worked organisation, three opportunities
npm run db:seed -- --reset
```

The seed writes rows shaped to exercise the states the interface has to tell
apart: a fresh trigger with a named decision maker, a contact with no verified
address, and an opportunity with no buyer and three score dimensions left
unmeasured. It is idempotent and scoped to one organisation.

See [Migrations](../operations/migrations.md) for the operational procedure.

## What the test suite proves

`npm test` runs all 28 migrations against **PGlite** — Postgres in-process, no
server and no Docker — and asserts **236 checks**, including:

* A fact cannot exist without a source.
* An unmeasured score dimension stays `NULL` rather than becoming `0`.
* A scoped memory cannot be subject-less.
* Two rules with the same effect and different `intent` behave identically.
* **Org A cannot read or write org B** — run as a non-superuser role, so RLS
  genuinely applies.

{% hint style="info" %}
The isolation suite runs on PGlite specifically so it *always* runs. An
isolation test that only runs when someone remembers to point it at staging is
an isolation test that stops running.
{% endhint %}

## Schema drift

`packages/db/src/types.ts` is maintained by hand. `docs/OPERATIONS.md` (DB-03)
describes generating row types from the live project and diffing them. There is
no automated drift check in CI.

## Related

* [Data model](data-model.md) — entity by entity
* [Migrations](../operations/migrations.md)
* [Tenancy and permissions](../security/tenancy-and-permissions.md)
