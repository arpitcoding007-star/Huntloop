-- ============================================================================
-- 0057 — A removed ICP stops its paid searches (PANEL-401, audit pass 20)
--
-- Removing an ICP set `icps.deleted_at` and nothing else. Its discovery
-- queries stayed enabled, and `claim_due_discovery_queries` (0038) filters on
-- the query and the organisation, never on the ICP. So the engine ran a paid
-- provider search every day for a profile the user had deleted.
-- `discover_companies` then found no live ICP to exclude by, so exclusions
-- were dropped, and `score_opportunity` skipped every result.
--
-- The app retired a profile-built search only as a side effect of building a
-- new one (`retireSuperseded`, FLOW-008). Deleting an ICP, or making active
-- one whose criteria translate to no search, never got there.
--
-- Three parts, same reasoning as 0049 (a rule in each reader is a rule the
-- next reader forgets):
--
--   1. The claim skips any query whose ICP is soft-deleted. This is the
--      guarantee: whatever wrote the row, no paid search runs for a profile
--      that no longer exists.
--   2. A trigger disables an ICP's queries when it is soft-deleted, so the
--      rows say what the engine does. A saved search shown as "enabled" that
--      never runs would be a new way of misleading the user.
--   3. A backfill disables the queries already pointing at a deleted ICP.
--
-- A query with no ICP (`icp_id` null, an ad-hoc search) is unaffected.
-- ============================================================================

-- ── 1. The claim ────────────────────────────────────────────────────────────
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
      -- 0057: never for a profile that has been removed.
      and (
        q.icp_id is null
        or exists (
          select 1 from public.icps i
          where i.id = q.icp_id and i.org_id = q.org_id and i.deleted_at is null
        )
      )
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

-- ── 2. Removing an ICP disables its searches ───────────────────────────────
-- Invoker rights, like 0049's propagation triggers: removing an ICP and
-- writing `discovery_queries` both need the member role (0014 tenant_write).
create or replace function public.retire_discovery_for_deleted_icp()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if new.deleted_at is not null and old.deleted_at is null then
    update public.discovery_queries
       set is_enabled = false,
           next_run_at = null
     where org_id = new.org_id
       and icp_id = new.id
       and is_enabled = true;
  end if;
  return new;
end
$$;

drop trigger if exists icps_retire_discovery on public.icps;
create trigger icps_retire_discovery
  after update of deleted_at on public.icps
  for each row execute function public.retire_discovery_for_deleted_icp();

-- ── 3. Backfill ─────────────────────────────────────────────────────────────
update public.discovery_queries q
   set is_enabled = false,
       next_run_at = null
  from public.icps i
 where i.id = q.icp_id
   and i.deleted_at is not null
   and q.is_enabled = true;

-- A probe for `db:doctor` (see 0031).
create or replace function public.migration_0057_applied()
returns boolean
language sql
immutable
set search_path = public, pg_catalog
as $$ select true $$;
