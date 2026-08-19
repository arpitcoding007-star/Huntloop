-- ============================================================================
-- 0007 — Identity that has a name, invitations, and the two write paths
--        0001 declared but never opened
--
-- Four things, all of which existed as a *table* already and had no way to
-- get a row into it from the application:
--
--   · profiles       — backlog TEAM-01. `memberships` names people by uuid,
--                      and the names live in `auth.users`, which a tenant
--                      cannot read and which needs the service-role client
--                      `apps/web` is forbidden to import. A mirrored row,
--                      written by a trigger and readable by co-members, is
--                      the only shape that does not require the bypass.
--   · invitations    — backlog TEAM-02. Creating a user is `auth.admin`, but
--                      *inviting* one need not be: an invitation is a row,
--                      and acceptance is the invitee signing in normally and
--                      redeeming it. That path holds no privileged key.
--   · audit_logs     — 0001 gave it a read policy for admins and no write
--                      policy at all, on the correct principle that a tenant
--                      which can edit its own audit trail does not have one.
--                      The consequence, unstated there, is that nothing in
--                      the product could write one either.
--   · usage_counters — same shape, same consequence.
--
-- The last two follow `consume_rate_limit()` exactly: SECURITY DEFINER, an
-- explicit membership check inside (because DEFINER bypasses RLS, so that
-- check is the only thing enforcing the tenant boundary), and a pinned
-- search_path.
-- ============================================================================

-- ── Who a user id refers to ────────────────────────────────────────────────

create table profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text,
  full_name  text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table profiles is
  'A readable identity for a user id. Mirrored from auth.users by trigger; '
  'auth.users itself is not readable by tenants. Never a source of truth — '
  'the row is a projection, and auth.users wins on conflict.';

-- Co-membership as a function, for the same reason `user_org_ids()` is one:
-- a STABLE SECURITY DEFINER function is evaluated once per statement, and
-- the equivalent subquery inlined into the policy is evaluated per row.
create or replace function public.co_member_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select distinct m.user_id
  from public.memberships m
  where m.deleted_at is null
    and m.org_id in (
      select org_id from public.memberships
      where user_id = auth.uid() and deleted_at is null
    )
$$;

comment on function public.co_member_ids is
  'Users who share at least one organisation with the caller. The exact '
  'extent of whose name you may see — not "every user", which would make '
  'profiles a directory of the whole customer base.';

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  -- to_jsonb(new) rather than new.raw_user_meta_data directly: this trigger
  -- also runs against the auth.users stub in verify-migrations.ts, which has
  -- no metadata column. A missing key yields NULL here instead of a runtime
  -- error, so the same file is valid against Supabase and against PGlite.
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
        full_name  = coalesce(excluded.full_name, public.profiles.full_name),
        avatar_url = coalesce(excluded.avatar_url, public.profiles.avatar_url);
  return new;
end
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert or update on auth.users
  for each row execute function public.handle_new_user();

-- Everyone who already exists. Without this, every account created before
-- this migration stays a uuid forever.
insert into public.profiles (id, email)
select u.id, (to_jsonb(u) ->> 'email') from auth.users u
on conflict (id) do nothing;

alter table profiles enable row level security;

create policy profile_read on profiles
  for select using (id = auth.uid() or id in (select public.co_member_ids()));

create policy profile_self_write on profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

create trigger profiles_touch before update on profiles
  for each row execute function public.touch_updated_at();

-- ── Invitations ────────────────────────────────────────────────────────────

create table invitations (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  email       text not null,
  role        org_role not null default 'member',
  -- Random, unguessable, and the only thing an invitee presents. Stored in
  -- full rather than hashed: it is single-use, short-lived, scoped to one
  -- org, and redeemable only by a signed-in user whose address matches — so
  -- a database reader holding it has already read `memberships` anyway.
  token       uuid not null default gen_random_uuid() unique,
  invited_by  uuid references auth.users(id) on delete set null,
  expires_at  timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null,
  revoked_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- One live invitation per address per org. Partial, so a revoked or accepted
-- invitation does not block re-inviting someone later.
create unique index invitations_pending_idx
  on invitations (org_id, lower(email))
  where accepted_at is null and revoked_at is null;

alter table invitations enable row level security;

-- Admins manage their org's invitations. There is deliberately no policy that
-- lets an invitee read their own row: they hold the token, and redemption
-- goes through the SECURITY DEFINER function below rather than through a
-- select that would have to expose the table to callers who are not members.
create policy invitation_admin on invitations
  for all using (public.has_org_role(org_id, 'admin'))
  with check (public.has_org_role(org_id, 'admin'));

create trigger invitations_touch before update on invitations
  for each row execute function public.touch_updated_at();

-- Redeem an invitation.
--
-- SECURITY DEFINER because the caller is by definition *not* yet a member, so
-- every RLS policy in this schema refuses them. The three checks inside are
-- therefore the whole of the authorization:
--
--   1. There is a signed-in user (auth.uid()).
--   2. The token is live — not accepted, not revoked, not expired.
--   3. The signed-in user's address matches the invited one, case-folded.
--
-- (3) is the load-bearing one. Without it a leaked token joins anybody to the
-- org, which is the whole risk of an invitation system.
-- The OUT columns are prefixed rather than named org_id / slug / role.
-- Inside a PL/pgSQL function an OUT parameter is a variable, and a variable
-- sharing a name with a column makes every unqualified reference to that
-- column ambiguous — including the ones in the INSERT below, which is a
-- compile-time-clean, run-time-only failure.
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
        role       = excluded.role;

  update public.invitations
    set accepted_at = now(), accepted_by = v_user
  where id = v_inv.id;

  return query
    select o.id, o.slug, v_inv.role
    from public.organizations o where o.id = v_inv.org_id;
end
$$;

-- ── The audit trail, openable from one end only ────────────────────────────

create or replace function public.write_audit_log(
  p_org         uuid,
  p_action      text,
  p_target_type text default null,
  p_target_id   uuid default null,
  p_meta        jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_user uuid := auth.uid();
  v_id   uuid;
begin
  if v_user is null then
    raise exception 'write_audit_log requires an authenticated caller';
  end if;

  if not exists (
    select 1 from public.memberships m
    where m.org_id = p_org and m.user_id = v_user and m.deleted_at is null
  ) then
    raise exception 'not a member of the requested organisation';
  end if;

  insert into public.audit_logs (org_id, actor_id, action, target_type, target_id, meta)
  values (p_org, v_user, p_action, p_target_type, p_target_id, coalesce(p_meta, '{}'::jsonb))
  returning id into v_id;

  return v_id;
end
$$;

comment on function public.write_audit_log is
  'Append-only. There is no update or delete counterpart, and none should be '
  'added: the value of the record is that the party it describes cannot '
  'change it.';

-- ── Usage counters and quota ───────────────────────────────────────────────

-- The limit for one metric, resolved from the org's plan.
--
-- Reads an explicit `usage_counters."limit"` first so an org can carry a
-- negotiated override, and falls back to the plan catalogue. NULL means
-- unlimited, which is a real answer and not the same as zero.
create or replace function public.usage_limit(p_org uuid, p_metric text)
returns bigint
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select coalesce(
    (select c."limit" from public.usage_counters c
      where c.org_id = p_org and c.metric = p_metric and c."limit" is not null
      order by c.period desc limit 1),
    (select (p.limits ->> p_metric)::bigint
       from public.organizations o
       join public.plans p on p.id = o.plan_id
      where o.id = p_org)
  )
$$;

create or replace function public.increment_usage(
  p_org    uuid,
  p_metric text,
  p_amount bigint default 1
)
returns table (used bigint, quota bigint, allowed boolean)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_user   uuid := auth.uid();
  v_period text := to_char(now() at time zone 'utc', 'YYYY-MM');
  v_used   bigint;
  v_limit  bigint;
begin
  if v_user is null then
    raise exception 'increment_usage requires an authenticated caller';
  end if;

  if not exists (
    select 1 from public.memberships m
    where m.org_id = p_org and m.user_id = v_user and m.deleted_at is null
  ) then
    raise exception 'not a member of the requested organisation';
  end if;

  v_limit := public.usage_limit(p_org, p_metric);

  insert into public.usage_counters (org_id, period, metric, used)
  values (p_org, v_period, p_metric, greatest(p_amount, 0))
  on conflict (org_id, period, metric)
  do update set used = public.usage_counters.used + greatest(p_amount, 0)
  returning public.usage_counters.used into v_used;

  -- Reports rather than refuses. The counter is metering, and a metric that
  -- silently stopped counting once over limit would make the overage
  -- invisible exactly when it matters. Enforcement is the caller's decision,
  -- made against `allowed` before doing the work.
  return query select v_used, v_limit, (v_limit is null or v_used <= v_limit);
end
$$;

-- Read-only counterpart: what would happen, without spending anything.
create or replace function public.check_quota(p_org uuid, p_metric text)
returns table (used bigint, quota bigint, allowed boolean)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select
    coalesce(c.used, 0)::bigint,
    public.usage_limit(p_org, p_metric),
    (public.usage_limit(p_org, p_metric) is null
      or coalesce(c.used, 0) < public.usage_limit(p_org, p_metric))
  from (select 1) _
  left join public.usage_counters c
    on c.org_id  = p_org
   and c.metric  = p_metric
   and c.period  = to_char(now() at time zone 'utc', 'YYYY-MM')
  where exists (
    select 1 from public.memberships m
    where m.org_id = p_org and m.user_id = auth.uid() and m.deleted_at is null
  )
$$;

-- ── The plan catalogue ─────────────────────────────────────────────────────
--
-- Seeded here rather than by `db:seed`, because `plans` is catalogue data
-- shared by every tenant — the same reason 0001 gave it a `for select using
-- (true)` policy rather than a tenant one. `on conflict do nothing` so an
-- operator who has edited prices in production keeps them.

insert into plans (id, name, price_cents, limits) values
  ('free',   'Free',   0,     '{"opportunities": 50,    "ai_runs": 100,   "emails": 0,     "enrich": 25,    "seats": 2}'::jsonb),
  ('growth', 'Growth', 9900,  '{"opportunities": 1000,  "ai_runs": 3000,  "emails": 5000,  "enrich": 1000,  "seats": 10}'::jsonb),
  ('scale',  'Scale',  29900, '{"opportunities": 10000, "ai_runs": 20000, "emails": 50000, "enrich": 10000, "seats": 50}'::jsonb)
on conflict (id) do nothing;

-- An org with no plan is on Free, not on nothing: `usage_limit` joins through
-- `plan_id`, and a NULL there resolves every limit to NULL, which reads as
-- unlimited. That is the wrong direction for this failure to fall.
alter table organizations alter column plan_id set default 'free';
update organizations set plan_id = 'free' where plan_id is null;
alter table organizations
  add constraint organizations_plan_fk foreign key (plan_id) references plans(id);
