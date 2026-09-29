-- 0031 — closing the write paths pass 14 found open.
--
-- Every change here narrows what a signed-in session may do directly through
-- PostgREST. None of it changes what the application does: each table made
-- read-only below is written only by the service role (the job engine) or by a
-- SECURITY DEFINER function, which RLS does not apply to.
--
-- ── SEC-001 · the job queue was member-writable ──────────────────────────
--
-- `job_executions` sat in 0004's generic member-writable loop. The queue's
-- only writer is the service role (`packages/jobs/src/queue.ts`); the app reads
-- it (`lib/data/engine.ts`) and changes it only through the admin-gated
-- `retry_job` / `cancel_job` functions (0019). A member-writable queue let any
-- member enqueue admin-only work and — because the idempotency index was not
-- scoped by org — occupy a global sweeper's slot and stall every tenant.
--
-- ── SEC-007 / PROV-009 · ledgers and provenance were member-writable ─────
--
-- `provider_calls` (the spend ledger), `provider_cache` (answers served as
-- provider data), `provider_breakers`, `message_events` and
-- `evidence_citations` are engine-written. A member could plant a cached
-- "Apollo" answer or erase the ledger that enforces the credit budget.
--
-- `companies` keeps member insert/update — the app creates and edits them —
-- but loses DELETE: the app only ever soft-deletes, and a hard delete cascades
-- through people, contact points, opportunities and enrollments past the audit
-- log.
--
-- ── SEC-005 / SEC-006 · definer functions callable by any session ────────
--
-- Revoking from PUBLIC does not revoke Supabase's explicit grants to `anon`
-- and `authenticated`. `merge_duplicate_evidence` takes any org id and has no
-- membership check; `prune_rate_limits` clears every tenant's windows. Both
-- have one legitimate caller: the service role / pg_cron.
--
-- ── SEC-002 · an admin could make themselves owner ───────────────────────
--
-- `membership_write` asks "are you an admin", not "may you grant owner". A
-- trigger now requires an owner to grant, change or remove the owner role.
-- The one exception is a workspace's first owner, which `create_organization`
-- writes for a caller who is by definition not an owner yet.
--
-- ── SEC-009 · deleting a workspace did not stop it ───────────────────────
--
-- `delete_organization` stopped outreach and sources but left discovery
-- running, and `user_org_ids()` kept returning the deleted org, so members
-- kept direct API access to it.
--
-- It also referenced `sources.enabled`, which does not exist (the column is
-- `is_enabled`), so `delete_organization` has failed on every call since 0029.
--
-- ── DB-002 · contact points had no person index ──────────────────────────

-- Engine-written tables: read-only for sessions.
do $$
declare t text;
begin
  foreach t in array array[
    'job_executions', 'provider_calls', 'provider_cache', 'provider_breakers',
    'message_events', 'evidence_citations'
  ]
  loop
    execute format('drop policy if exists tenant_write on public.%1$I', t);
  end loop;
end
$$;

-- The idempotency key now collapses per org. Sweepers carry no org_id, and
-- NULLS NOT DISTINCT keeps their global keys colliding with each other.
drop index if exists public.job_executions_idempotency_idx;
create unique index job_executions_idempotency_idx
  on public.job_executions (job_name, idempotency_key, org_id) nulls not distinct
  where idempotency_key is not null and status in ('queued', 'running');

-- Companies: insert and update, no delete.
drop policy if exists tenant_write on public.companies;
drop policy if exists tenant_insert on public.companies;
drop policy if exists tenant_update on public.companies;
create policy tenant_insert on public.companies
  for insert with check (public.has_org_role(org_id, 'member'));
create policy tenant_update on public.companies
  for update
  using (public.has_org_role(org_id, 'member'))
  with check (public.has_org_role(org_id, 'member'));

-- Definer functions with one legitimate caller. PUBLIC is revoked on its own
-- line so it cannot be skipped by the role-guarded blocks below, which tolerate
-- a database without Supabase's roles (the PGlite harness).
revoke execute on function public.merge_duplicate_evidence(uuid, text, uuid) from public;
revoke execute on function public.prune_rate_limits(interval) from public;

do $$
begin
  revoke execute on function public.merge_duplicate_evidence(uuid, text, uuid) from anon, authenticated;
  revoke execute on function public.prune_rate_limits(interval) from anon, authenticated;
exception when undefined_object then null;
end $$;

do $$
begin
  grant execute on function public.merge_duplicate_evidence(uuid, text, uuid) to service_role;
  grant execute on function public.prune_rate_limits(interval) to service_role;
exception when undefined_object then null;
end $$;

-- Owner changes need an owner.
--
-- Only a change that grants, alters or removes the owner role is guarded — not
-- every write to an owner's row. `accept_invitation` stamps `accepted_at` on an
-- owner invitation as the invitee, who is not an owner yet, and that must pass.
create or replace function public.guard_membership_owner()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_org     uuid := coalesce(new.org_id, old.org_id);
  v_guarded boolean := false;
  v_email   text;
begin
  -- The service role and pg_cron have no auth.uid(); they are trusted.
  if auth.uid() is null then
    return coalesce(new, old);
  end if;

  if tg_op = 'INSERT' then
    v_guarded := new.role = 'owner';
  elsif tg_op = 'UPDATE' then
    v_guarded :=
      (new.role is distinct from old.role and 'owner' in (new.role, old.role))
      or (old.role = 'owner' and old.deleted_at is null and new.deleted_at is not null);
  else
    v_guarded := old.role = 'owner';
  end if;

  if not v_guarded or public.has_org_role(v_org, 'owner') then
    return coalesce(new, old);
  end if;

  if tg_op in ('INSERT', 'UPDATE') and new.user_id = auth.uid() and new.role = 'owner' then
    -- A new workspace's first owner, written by create_organization.
    if not exists (
      select 1 from public.memberships m
      where m.org_id = v_org and m.role = 'owner' and m.deleted_at is null
    ) then
      return new;
    end if;

    -- An owner invitation, issued by an owner, being accepted by its invitee.
    select lower(to_jsonb(u) ->> 'email') into v_email from auth.users u where u.id = auth.uid();
    if exists (
      select 1 from public.invitations i
      where i.org_id = v_org and i.role = 'owner'
        and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
        and lower(i.email) = v_email
    ) then
      return new;
    end if;
  end if;

  raise exception 'Only an owner can grant, change or remove the owner role'
    using errcode = '42501';
end;
$$;

create or replace function public.guard_invitation_owner()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if (tg_op = 'INSERT' and new.role = 'owner')
     or (tg_op = 'UPDATE' and new.role is distinct from old.role
         and 'owner' in (new.role, old.role)) then
    if not public.has_org_role(new.org_id, 'owner') then
      raise exception 'Only an owner can invite an owner'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists memberships_guard_owner on public.memberships;
create trigger memberships_guard_owner
  before insert or update or delete on public.memberships
  for each row execute function public.guard_membership_owner();

drop trigger if exists invitations_guard_owner on public.invitations;
create trigger invitations_guard_owner
  before insert or update on public.invitations
  for each row execute function public.guard_invitation_owner();

-- SEC-015: accepting an invitation never lowers an existing role. The enum is
-- declared most- to least-privileged, so `least` keeps the stronger one.
create or replace function public.accept_invitation(p_token uuid)
returns table (joined_org_id uuid, joined_org_slug text, joined_role org_role)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_user  uuid := auth.uid();
  v_email text;
  v_inv   public.invitations%rowtype;
  v_role  org_role;
begin
  if v_user is null then
    raise exception 'accept_invitation requires an authenticated caller';
  end if;

  select (to_jsonb(u) ->> 'email') into v_email from auth.users u where u.id = v_user;

  select * into v_inv from public.invitations
  where token = p_token
    and accepted_at is null
    and revoked_at is null
    and expires_at > now();

  if not found then
    raise exception 'that invitation is no longer valid';
  end if;

  if v_email is null or lower(v_email) <> lower(v_inv.email) then
    raise exception 'that invitation was issued to a different email address';
  end if;

  insert into public.memberships (org_id, user_id, role, invited_by)
  values (v_inv.org_id, v_user, v_inv.role, v_inv.invited_by)
  on conflict (org_id, user_id) do update
    set deleted_at = null,
        role       = case when public.memberships.deleted_at is null
                          then least(public.memberships.role, excluded.role)
                          else excluded.role end
  returning role into v_role;

  update public.invitations
    set accepted_at = now(), accepted_by = v_user
  where id = v_inv.id;

  return query
    select o.id, o.slug, v_role
    from public.organizations o where o.id = v_inv.org_id;
end
$$;

-- A deleted workspace is invisible to its members and stops discovering.
create or replace function public.user_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select m.org_id
  from public.memberships m
  join public.organizations o on o.id = m.org_id
  where m.user_id = auth.uid()
    and m.deleted_at is null
    and o.deleted_at is null
$$;

create or replace function public.claim_due_discovery_queries(p_limit integer default 10)
returns table (id uuid, org_id uuid)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  return query
  with due as (
    select q.id
    from public.discovery_queries q
    join public.organizations o on o.id = q.org_id
    where q.is_enabled = true
      and q.deleted_at is null
      and o.deleted_at is null
      and q.next_run_at is not null
      and q.next_run_at <= now()
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

create or replace function public.delete_organization(p_org uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if not public.has_org_role(p_org, 'owner') then
    raise exception 'delete_organization: not an owner of %', p_org;
  end if;

  update public.organizations
    set deleted_at = now(), updated_at = now()
    where id = p_org and deleted_at is null;

  update public.campaigns
    set status = 'archived', deleted_at = coalesce(deleted_at, now())
    where org_id = p_org and deleted_at is null;

  update public.enrollments
    set status = 'stopped', next_action_at = null, parked_reason = 'workspace deleted'
    where org_id = p_org and status <> 'stopped';

  -- 0029 wrote `enabled`, a column `sources` has never had, so every call
  -- failed and no workspace could be deleted. The column is `is_enabled`.
  update public.sources
    set is_enabled = false, next_scan_at = null
    where org_id = p_org and is_enabled;

  update public.discovery_queries
    set is_enabled = false, next_run_at = null, updated_at = now()
    where org_id = p_org and is_enabled;
end;
$$;

-- DB-002.
create index if not exists contact_points_person_idx
  on public.contact_points (org_id, person_id)
  where deleted_at is null;

-- ── A probe for `db:doctor` ──────────────────────────────────────────────
-- Everything above is a policy, trigger or redefined function, none of which
-- PostgREST exposes, so doctor had nothing to look for. This returns the
-- latest applied migration's number; later migrations replace it.
create or replace function public.schema_version()
returns integer
language sql
immutable
set search_path = public, pg_catalog
as $$ select 31 $$;
