-- 0032 — evidence that can actually be upserted, and provenance the engine
-- stopped overwriting.
--
-- ── TRUST-001 · provider evidence never landed ───────────────────────────
--
-- `evidence_one_per_source_field` (0020) is an expression index —
-- `coalesce(source_id::text, '')`, `coalesce(source_url, '')` — with a
-- `where field is not null and deleted_at is null` predicate. PostgREST's
-- `on_conflict` names plain columns, and Postgres can infer neither an
-- expression nor a partial index from a plain column list, so every upsert in
-- enrich_company, fetch_company_signals, research_competitor and sync_hubspot
-- failed with 42P10. None of them read the error: the company columns were
-- filled, the evidence behind them was not, and hiring signals never arrived.
--
-- `live_source_key` is the same identity as a stored column: NULL for a
-- field-less or soft-deleted row, so those can never collide (unique indexes
-- treat NULLs as distinct), and a plain index over it that `on_conflict` can
-- name. Non-partial on purpose — a predicate is exactly what PostgREST cannot
-- supply. The 0020 index stays; it enforces the same rule on live rows.
--
-- ── FLOW-003 · enrichment silenced research for thirty days ──────────────
--
-- `enrich_company` wrote `last_researched_at`, the column `research_company`
-- checks before spending a model run. Enriching a company therefore marked it
-- researched, and the research that produces "what they sell", "who buys" and
-- the problem statement was skipped. Enrichment gets its own column.
--
-- ── FLOW-004 · a human's priority lasted until the next rescore ──────────
--
-- `score_opportunity` upserts `priority` unconditionally, so a user's
-- correction was reverted by the next scan, research or rule recompute.
-- `priority_set_by` records who set it; the scorer keeps a user's value.
--
-- ── TRUST-004 · one vocabulary for email verification ────────────────────
--
-- Four writers used four vocabularies and the readers disagreed about them.
-- Existing values are mapped onto one set, which is then enforced.

-- TRUST-001.
alter table public.evidence
  add column if not exists live_source_key text generated always as (
    case
      when field is not null and deleted_at is null
        then coalesce(source_id::text, '') || '|' || coalesce(source_url, '')
    end
  ) stored;

create unique index if not exists evidence_live_source_key_uidx
  on public.evidence (org_id, subject_type, subject_id, field, live_source_key);

-- FLOW-003.
alter table public.companies
  add column if not exists last_enriched_at timestamptz;

-- FLOW-004.
alter table public.opportunities
  add column if not exists priority_set_by text not null default 'system';

do $$
begin
  alter table public.opportunities
    add constraint opportunities_priority_set_by_check
    check (priority_set_by in ('system', 'user'));
exception when duplicate_object then null;
end $$;

-- Overrides already recorded are the user's.
update public.opportunities o
  set priority_set_by = 'user'
  where exists (
    select 1 from public.human_overrides h
    where h.org_id = o.org_id and h.entity_id = o.id
      and h.entity_type = 'opportunity' and h.subject = 'opportunity_priority'
  );

-- TRUST-004.
update public.contact_points
  set verification_status = case verification_status
    when 'verified' then 'deliverable'
    when 'valid' then 'deliverable'
    when 'invalid' then 'undeliverable'
    else 'unknown'
  end
  where verification_status is not null
    and verification_status not in
      ('unverified', 'provider_verified', 'deliverable', 'risky', 'undeliverable', 'unknown');

do $$
begin
  alter table public.contact_points
    add constraint contact_points_verification_status_check
    check (verification_status is null or verification_status in
      ('unverified', 'provider_verified', 'deliverable', 'risky', 'undeliverable', 'unknown'));
exception when duplicate_object then null;
end $$;

-- A probe for `db:doctor` (see 0031).
create or replace function public.migration_0032_applied()
returns boolean
language sql
immutable
set search_path = public, pg_catalog
as $$ select true $$;
