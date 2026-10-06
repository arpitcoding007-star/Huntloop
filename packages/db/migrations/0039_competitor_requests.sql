-- 0039 — competitors a person can act on. COMMAND.md §16.3-D.
--
-- `0015` built competitor intelligence with care — a profile in which every
-- field carries its evidence, a deterministic resolver that links prospects to
-- competitors from what sources say — and then nothing could start it:
-- `research_competitor` had no producer, and there was no screen to name a
-- competitor on, only a free-text list in `organizations.settings` that the
-- resolver never reads.
--
--   research_requested_at   set by "Research" on the Competitors screen;
--                           `schedule_followups` turns it into a
--                           `research_competitor` job and clears it — the same
--                           request-column seam scans, recomputes and CRM
--                           pushes already use, because the request path may
--                           not enqueue.
--   prospect_customers      opt-in, per competitor: customers the profile
--                           names *with evidence* become companies to research
--                           (never contacted automatically). Off by default —
--                           "go after their customers" is a strategy a person
--                           chooses, not one the product assumes.
--   customers_sought_at     when that was last done, so it is done once per
--                           research rather than once per tick.

alter table public.competitors
  add column if not exists research_requested_at timestamptz,
  add column if not exists prospect_customers boolean not null default false,
  add column if not exists customers_sought_at timestamptz;

create index if not exists competitors_research_requested_idx
  on public.competitors (research_requested_at)
  where research_requested_at is not null and deleted_at is null;

create index if not exists competitors_prospect_idx
  on public.competitors (org_id)
  where prospect_customers and deleted_at is null and status = 'active';

-- Companies found through a competitor are attributed to it, so Performance
-- can say whether "their customers" convert. `discovered_via` already holds
-- free text (`manual`, `scan`, `provider:<name>`); `competitor:<id>` joins it.

-- A probe for `db:doctor` (see 0031).
create or replace function public.migration_0039_applied()
returns boolean
language sql
immutable
set search_path = public, pg_catalog
as $$ select true $$;
