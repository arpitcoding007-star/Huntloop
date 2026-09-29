-- 0036 — imported and hand-added companies get qualified.
--
-- ── FLOW-007 ─────────────────────────────────────────────────────────────
--
-- CSV import and "add company" wrote companies and stopped. Nothing selected
-- a company that had never been researched and had no opportunity, so one of
-- the three ways into the product dead-ended: a user who brought their own
-- list got no fit, no score and no evidence for any of it.
--
-- `schedule_followups` now enqueues `research_company` for them (which then
-- scores). `research_requested_at` is its marker: set when the job is
-- enqueued, so a company whose research is refused or fails — no model key,
-- an exhausted quota — is asked about at most once a day rather than every
-- tick.

alter table public.companies
  add column if not exists research_requested_at timestamptz;

create index if not exists companies_unresearched_idx
  on public.companies (research_requested_at nulls first)
  where last_researched_at is null and deleted_at is null;

-- A probe for `db:doctor` (see 0031).
create or replace function public.migration_0036_applied()
returns boolean
language sql
immutable
set search_path = public, pg_catalog
as $$ select true $$;
