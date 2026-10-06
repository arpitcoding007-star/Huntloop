-- 0038 — paid discovery respects the backlog cap. COMMAND.md §16.3-F.
--
-- `0010` built the backlog cap — "standing un-worked opportunities allowed
-- before discovery pauses", 250 by default — and `schedule_scans` honours it.
-- `schedule_discovery` did not. So the free path (reading sources) paused when
-- nobody was reviewing what it found, while the paid path (provider searches
-- that spend credits) kept producing opportunities into the same unread pile.
-- The cap protected attention on the cheap path and not on the expensive one.
--
-- The check goes inside the claim rather than in the scheduler, for the reason
-- `schedule_scans` gives for not advancing a saturated org's sources: the
-- claim advances `next_run_at` as part of claiming (0014 explains why that
-- ordering matters), so a query claimed and then skipped would lose its run
-- for a whole interval as a penalty for the org being behind. Excluded from
-- the claim, it stays due and runs the moment the backlog is worked down.
--
-- "Needs you" surfaces the pause ("Discovery is paused"), so the person whose
-- backlog is full learns it from the product rather than from a quiet week.

create or replace function public.claim_due_discovery_queries(p_limit integer default 10)
returns table (id uuid, org_id uuid)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  return query
  with saturated as (
    select s as org_id from public.saturated_org_ids() s
  ),
  due as (
    select q.id
    from public.discovery_queries q
    join public.organizations o on o.id = q.org_id
    where q.is_enabled = true
      and q.deleted_at is null
      and o.deleted_at is null
      and q.next_run_at is not null
      and q.next_run_at <= now()
      and not exists (select 1 from saturated where saturated.org_id = q.org_id)
      and not exists (
        select 1 from public.discovery_runs r
        where r.query_id = q.id and r.status in ('queued', 'running')
      )
    order by q.next_run_at
    limit greatest(p_limit, 0)
    for update of q skip locked
  )
  update public.discovery_queries q
    set next_run_at = now() + make_interval(mins => coalesce(q.interval_minutes, 1440)),
        updated_at = now()
    from due
    where q.id = due.id
    returning q.id, q.org_id;
end;
$$;

-- A probe for `db:doctor` (see 0031).
create or replace function public.migration_0038_applied()
returns boolean
language sql
immutable
set search_path = public, pg_catalog
as $$ select true $$;
