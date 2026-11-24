-- ============================================================================
-- 0071 — Gaps from pass 22 (audit/pass-22/PLAN.md, P2 and P3)
--
--  · Assignment emails are each person's choice.
--  · A profile keeps the name a person typed, and only Auth changes its email.
--  · Two Exchange rules, built and OFF: opening a request to introductions
--    needs a confirmed company address (EX-4), and a regulated category shows
--    no anonymous card (EX-10). Both decisions are open, and the seeded
--    `regulated` list (0061) is a starting judgement that includes GPUs and
--    accounting. `exchange_policy` turns each on.
--  · Deleted workspaces can be removed for good. Nothing calls this unless the
--    deployment sets WORKSPACE_PURGE_DAYS.
-- ============================================================================

-- ── Assignment emails ───────────────────────────────────────────────────────

alter table public.notification_preferences
  add column if not exists assignment_emails boolean not null default true;

-- Preferences are private to their owner (0040), and the person assigning is
-- somebody else. This answers one yes-or-no question about a fellow member.
create or replace function public.assignment_email_wanted(p_org uuid, p_user uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
begin
  if p_org is null or not public.has_org_role(p_org, 'viewer') then
    raise exception 'not a member of the requested organisation' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.memberships m
     where m.org_id = p_org and m.user_id = p_user and m.deleted_at is null
  ) then
    return false;
  end if;
  return coalesce((
    select p.assignment_emails from public.notification_preferences p
     where p.org_id = p_org and p.user_id = p_user
  ), true);
end
$$;


-- ── Profiles ────────────────────────────────────────────────────────────────

-- 0007 let the sign-in provider's name win on every sign-in, so a name edited
-- in Settings came back. The provider's now fills a blank only.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_row  jsonb := to_jsonb(new);
  v_meta jsonb := coalesce(v_row -> 'raw_user_meta_data', '{}'::jsonb);
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    v_row ->> 'email',
    nullif(coalesce(v_meta ->> 'full_name', v_meta ->> 'name'), ''),
    nullif(coalesce(v_meta ->> 'avatar_url', v_meta ->> 'picture'), '')
  )
  on conflict (id) do update
    set email      = coalesce(excluded.email, public.profiles.email),
        full_name  = coalesce(public.profiles.full_name, excluded.full_name),
        avatar_url = coalesce(public.profiles.avatar_url, excluded.avatar_url);
  return new;
end
$$;

-- A session may update its own profile row (0007), email included, and product
-- email is sent to that column. The address comes from Auth, confirmed, only.
create or replace function public.guard_profile_email()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if current_user in ('authenticated', 'anon') and new.email is distinct from old.email then
    raise exception 'Your email address is changed through sign-in, not here.' using errcode = '42501';
  end if;
  return new;
end
$$;

drop trigger if exists profiles_guard_email on public.profiles;
create trigger profiles_guard_email before update on public.profiles
  for each row execute function public.guard_profile_email();

-- ── Exchange: who may open a request ────────────────────────────────────────

-- One row, set by the operator in SQL. No session reads or writes it.
create table if not exists public.exchange_policy (
  id                              boolean primary key default true check (id),
  require_company_address         boolean not null default false,
  regulated_hides_anonymous_cards boolean not null default false,
  updated_at                      timestamptz not null default now()
);
insert into public.exchange_policy default values on conflict do nothing;
alter table public.exchange_policy enable row level security;
drop policy if exists no_session_access on public.exchange_policy;
create policy no_session_access on public.exchange_policy for all using (false) with check (false);
comment on table public.exchange_policy is
  'Operator switches for Exchange rules whose decisions are open (0071: EX-4, EX-10).';

-- A live owner or admin with a confirmed address that is not free mail.
create or replace function public.exchange_buyer_verified(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1
      from public.memberships m
      join auth.users u on u.id = m.user_id
     where m.org_id = p_org
       and m.deleted_at is null
       and m.role in ('owner', 'admin')
       and (to_jsonb(u) ->> 'email_confirmed_at') is not null
       and position('@' in coalesce(to_jsonb(u) ->> 'email', '')) > 0
       and lower(split_part(to_jsonb(u) ->> 'email', '@', 2)) not in (
         'gmail.com','googlemail.com','outlook.com','hotmail.com','live.com',
         'yahoo.com','icloud.com','me.com','aol.com','proton.me','protonmail.com',
         'gmx.com','mail.com','yandex.com','zoho.com','fastmail.com'
       )
  );
$$;


create or replace function public.exchange_need_visibility()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_regulated boolean;
  v_policy public.exchange_policy;
begin
  -- A person is checked; the engine and the operator are not. An edit that
  -- leaves both alone is not a new decision.
  if auth.uid() is null or new.visibility < 2 then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and new.visibility is not distinct from old.visibility
     and new.category_id is not distinct from old.category_id then
    return new;
  end if;

  select * into v_policy from public.exchange_policy limit 1;

  select c.regulated or coalesce(p.regulated, false) into v_regulated
    from public.exchange_categories c
    left join public.exchange_categories p on p.id = c.parent_id
   where c.id = new.category_id;

  if coalesce(v_policy.regulated_hides_anonymous_cards, false)
     and coalesce(v_regulated, false) and new.visibility = 2 then
    raise exception 'This is a regulated category, so it has no anonymous cards. Keep the request counted only, or open it to introductions.' using errcode = 'P0001';
  end if;

  if coalesce(v_policy.require_company_address, false)
     and new.visibility = 3 and not public.exchange_buyer_verified(new.org_id) then
    raise exception 'Opening a request to introductions needs an owner or admin with a confirmed company email address. You can use an anonymous card or counted only until then.' using errcode = 'P0001';
  end if;

  return new;
end
$$;

drop trigger if exists exchange_needs_visibility on public.exchange_needs;
create trigger exchange_needs_visibility before insert or update on public.exchange_needs
  for each row execute function public.exchange_need_visibility();

-- Takes down anonymous cards the rule no longer allows: when it is switched
-- on, and when a category becomes regulated while it is.
create or replace function public.exchange_apply_regulated()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if exists (select 1 from public.exchange_policy where regulated_hides_anonymous_cards) then
    update public.exchange_needs n
       set visibility = 1, updated_at = now()
     where n.visibility = 2
       and exists (
         select 1 from public.exchange_categories c
         left join public.exchange_categories p on p.id = c.parent_id
          where c.id = n.category_id and (c.regulated or coalesce(p.regulated, false))
       );
  end if;
  return null;
end
$$;

drop trigger if exists exchange_categories_regulated on public.exchange_categories;
create trigger exchange_categories_regulated after update of regulated on public.exchange_categories
  for each statement execute function public.exchange_apply_regulated();
drop trigger if exists exchange_policy_applies on public.exchange_policy;
create trigger exchange_policy_applies after update on public.exchange_policy
  for each statement execute function public.exchange_apply_regulated();

-- ── Removing deleted workspaces for good ────────────────────────────────────

-- Irreversible. Refuses fewer than 30 days whatever the caller asks for, and
-- takes a few at a time. Only the engine may call it.
create or replace function public.purge_deleted_organizations(p_days integer, p_limit integer default 5)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_id    uuid;
  v_count integer := 0;
begin
  if auth.uid() is not null then
    raise exception 'purge_deleted_organizations is for the engine' using errcode = '42501';
  end if;
  if p_days is null or p_days < 30 then
    raise exception 'purge_deleted_organizations: at least 30 days, not %', p_days using errcode = '22023';
  end if;
  for v_id in
    select o.id from public.organizations o
     where o.deleted_at is not null and o.deleted_at < now() - make_interval(days => p_days)
     order by o.deleted_at
     limit least(greatest(p_limit, 1), 25)
     for update skip locked
  loop
    delete from public.organizations where id = v_id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end
$$;


do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated')
     or not exists (select 1 from pg_roles where rolname = 'anon') then
    return;
  end if;
  revoke all on function public.assignment_email_wanted(uuid, uuid) from public, anon;
  grant execute on function public.assignment_email_wanted(uuid, uuid) to authenticated;
  revoke all on public.exchange_policy from anon, authenticated;
  revoke all on function public.exchange_buyer_verified(uuid) from public, anon, authenticated;
  revoke all on function public.exchange_need_visibility() from public, anon, authenticated;
  revoke all on function public.exchange_apply_regulated() from public, anon, authenticated;
  revoke all on function public.purge_deleted_organizations(integer, integer) from public, anon, authenticated;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.purge_deleted_organizations(integer, integer) to service_role;
  end if;
end
$$;

create or replace function public.migration_0071_applied()
returns boolean
language sql
immutable
set search_path = public, pg_catalog
as $$ select true $$;
