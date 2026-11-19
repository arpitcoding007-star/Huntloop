-- 0052 — the real credit cost, the inbox's indexes, and a workspace domain
-- somebody actually holds an address at.
--
-- ── HL-1605 / PROV-201 · reserve what the call costs ─────────────────────
--
-- 0050's `reserve_provider_credit` held exactly one credit, whatever the call
-- cost. An Apollo person match costs two, so with one credit left the
-- reservation said yes and the call overspent the cap. The function now takes
-- the call's cost and allows it only when the whole cost fits. The old
-- two-argument version is dropped rather than overloaded: PostgREST cannot
-- choose between two functions that both accept (p_org, p_provider), and
-- the new one keeps that call working through its default.
--
-- ── PERF-301 · the inbox is quadratic ────────────────────────────────────
--
-- Every composite index on these tables leads with `org_id`, and PostgREST
-- joins an embedded resource on the foreign key alone. So the inbox
-- (`threads` → `messages` → `message_events`) scanned `message_events` once
-- per message. Measured on PGlite with 3,000 threads and 30,000 messages:
-- 46.7 s before these three indexes, 0.74 s after.
--
-- ── SEC-302 · a workspace's domain is a claim until somebody holds it ────
--
-- `organizations.primary_domain` is whatever its creator typed, and
-- `discoverable_workspaces()` offered the workspace to everybody with a
-- verified address at that domain. Anyone could appear as "your company's
-- workspace" to every employee of a company they do not work at. A workspace
-- is now discoverable at a domain only when one of its owners or admins has a
-- confirmed address there. `request_to_join` asks this same function, so it
-- inherits the rule.

-- ── HL-1605 ─────────────────────────────────────────────────────────────────
drop function if exists public.reserve_provider_credit(uuid, text);

create or replace function public.reserve_provider_credit(
  p_org      uuid,
  p_provider text,
  p_credits  integer default 1
)
returns table (used bigint, "limit" bigint, remaining bigint, allowed boolean)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_state record;
  v_cost  integer := greatest(coalesce(p_credits, 1), 1);
  v_ok    boolean;
begin
  perform pg_advisory_xact_lock(hashtext('provider_credits:' || p_org::text || ':' || p_provider));

  select s.used, s."limit", s.remaining, s.allowed
    into v_state
    from public.provider_budget_state(p_org, p_provider) s;

  -- The whole cost must fit, not just the first credit of it.
  v_ok := coalesce(v_state.allowed, false)
          and (v_state."limit" is null or coalesce(v_state.remaining, 0) >= v_cost);

  if v_ok then
    insert into public.usage_counters (org_id, period, metric, used)
    values (p_org, to_char(now(), 'YYYY-MM'), 'provider_credits:' || p_provider, v_cost)
    on conflict (org_id, period, metric)
      do update set used = public.usage_counters.used + v_cost,
                    updated_at = now();
  end if;

  return query select v_state.used::bigint, v_state."limit"::bigint,
                      v_state.remaining::bigint, v_ok;
end;
$$;

revoke execute on function public.reserve_provider_credit(uuid, text, integer) from public;
do $$
begin
  revoke execute on function public.reserve_provider_credit(uuid, text, integer) from anon, authenticated;
  grant execute on function public.reserve_provider_credit(uuid, text, integer) to service_role;
exception when undefined_object then null;
end $$;

-- ── PERF-301 ────────────────────────────────────────────────────────────────
create index if not exists message_events_message_idx
  on public.message_events (message_id);
create index if not exists messages_thread_created_idx
  on public.messages (thread_id, created_at);
create index if not exists threads_org_last_message_idx
  on public.threads (org_id, last_message_at desc nulls last)
  where deleted_at is null;

-- ── SEC-302 ─────────────────────────────────────────────────────────────────
create or replace function public.discoverable_workspaces()
returns table (org_id uuid, org_name text, org_slug text, member_count bigint)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_user   uuid := auth.uid();
  v_email  text;
  v_domain text;
begin
  if v_user is null then
    raise exception 'discoverable_workspaces requires an authenticated caller';
  end if;

  select (to_jsonb(u) ->> 'email') into v_email
    from auth.users u where u.id = v_user;

  if v_email is null or position('@' in v_email) = 0 then
    return;
  end if;

  v_domain := lower(split_part(v_email, '@', 2));
  if v_domain = '' then
    return;
  end if;

  if v_domain in (
    'gmail.com','googlemail.com','outlook.com','hotmail.com','live.com',
    'yahoo.com','icloud.com','me.com','aol.com','proton.me','protonmail.com',
    'gmx.com','mail.com','yandex.com','zoho.com','fastmail.com'
  ) then
    return;
  end if;

  return query
    select o.id,
           o.name,
           o.slug,
           (select count(*) from public.memberships m
             where m.org_id = o.id and m.deleted_at is null)
      from public.organizations o
     where o.primary_domain = v_domain
       and o.is_discoverable
       and o.deleted_at is null
       and not exists (
         select 1 from public.memberships m
          where m.org_id = o.id and m.user_id = v_user and m.deleted_at is null
       )
       -- SEC-302: somebody who runs the workspace holds a confirmed address
       -- at the domain it claims.
       and exists (
         select 1
           from public.memberships m
           join auth.users u on u.id = m.user_id
          where m.org_id = o.id
            and m.deleted_at is null
            and m.role in ('owner', 'admin')
            and (to_jsonb(u) ->> 'email_confirmed_at') is not null
            and lower(split_part(to_jsonb(u) ->> 'email', '@', 2)) = v_domain
       );
end;
$$;

do $$
begin
  revoke execute on function public.discoverable_workspaces() from public, anon;
  grant execute on function public.discoverable_workspaces() to authenticated, service_role;
exception when undefined_object or undefined_function then null;
end $$;

-- A probe for `db:doctor` (see 0031).
create or replace function public.migration_0052_applied()
returns boolean
language sql
immutable
set search_path = public, pg_catalog
as $$ select true $$;
