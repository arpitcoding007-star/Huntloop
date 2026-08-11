-- ============================================================================
-- 0001 — Identity, membership, billing, audit
--
-- Plan §5 "Identity & billing". This migration also establishes the two
-- helper functions every later migration depends on, so it must run first.
-- ============================================================================

-- No `create extension pgcrypto`: gen_random_uuid() has been in Postgres core
-- since 13, and Supabase runs 15+. Requiring the extension would need
-- privileges this schema does not otherwise need.

-- ── Enums ──────────────────────────────────────────────────────────────────
create type org_role as enum ('owner', 'admin', 'member', 'viewer');

-- ── Tables ─────────────────────────────────────────────────────────────────

create table organizations (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  slug          text not null unique,
  plan_id       text,
  trial_ends_at timestamptz,
  settings      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

comment on table organizations is
  'Tenant root (master context §38). Every tenant-scoped table references this.';

create table memberships (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       org_role not null default 'member',
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (org_id, user_id)
);

-- Every RLS policy in this schema resolves through memberships, so this index
-- is on the hot path of literally every tenant query.
create index memberships_user_idx on memberships (user_id, org_id);

create table plans (
  id          text primary key,
  name        text not null,
  price_cents integer not null default 0,
  limits      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create table subscriptions (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references organizations(id) on delete cascade,
  stripe_sub_id        text unique,
  status               text not null,
  current_period_end   timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz
);

create table usage_counters (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations(id) on delete cascade,
  period     text not null,                       -- 'YYYY-MM'
  metric     text not null,                       -- leads|enrich|ai_tokens|emails
  used       bigint not null default 0,
  "limit"    bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, period, metric)
);

create table audit_logs (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  actor_id    uuid references auth.users(id) on delete set null,
  action      text not null,
  target_type text,
  target_id   uuid,
  meta        jsonb not null default '{}'::jsonb,
  ip          inet,
  created_at  timestamptz not null default now()
);

create index audit_logs_org_idx on audit_logs (org_id, created_at desc);

-- ── Authorization helpers ──────────────────────────────────────────────────

-- SECURITY DEFINER so the function can read memberships without recursing
-- through memberships' own RLS policy. STABLE so Postgres may evaluate it
-- once per statement rather than once per row — without that, the policies
-- below turn every sequential scan into N function calls.
--
-- search_path is pinned: a SECURITY DEFINER function with a mutable
-- search_path is a privilege-escalation primitive, because a caller who can
-- create a schema earlier in the path can shadow the tables named here.
create or replace function public.user_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select org_id
  from public.memberships
  where user_id = auth.uid()
    and deleted_at is null
$$;

comment on function public.user_org_ids is
  'Orgs the current user belongs to. The single definition of the tenant '
  'boundary — every tenant_isolation policy calls this and nothing else.';

create or replace function public.has_org_role(target_org uuid, min_role org_role)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1
    from public.memberships m
    where m.org_id = target_org
      and m.user_id = auth.uid()
      and m.deleted_at is null
      -- Enum ordinal comparison: the org_role enum is declared
      -- owner < admin < member < viewer, so a LOWER ordinal means MORE
      -- authority and the test is "my role is at or above the minimum".
      and m.role <= min_role
  )
$$;

comment on function public.has_org_role is
  'Write-side authorization. Relies on org_role being declared most- to '
  'least-privileged; reordering that enum silently changes every policy.';

-- ── RLS ────────────────────────────────────────────────────────────────────

alter table organizations  enable row level security;
alter table memberships    enable row level security;
alter table subscriptions  enable row level security;
alter table usage_counters enable row level security;
alter table audit_logs     enable row level security;
alter table plans          enable row level security;

create policy org_read on organizations
  for select using (id in (select public.user_org_ids()));

create policy org_write on organizations
  for update using (public.has_org_role(id, 'admin'))
  with check (public.has_org_role(id, 'admin'));

create policy membership_read on memberships
  for select using (org_id in (select public.user_org_ids()));

create policy membership_write on memberships
  for all using (public.has_org_role(org_id, 'admin'))
  with check (public.has_org_role(org_id, 'admin'));

create policy subscription_read on subscriptions
  for select using (org_id in (select public.user_org_ids()));

create policy usage_read on usage_counters
  for select using (org_id in (select public.user_org_ids()));

-- Audit logs are readable by admins and writable by nobody through the API.
-- Append-only from the service role; a tenant that can edit its own audit
-- trail does not have one.
create policy audit_read on audit_logs
  for select using (public.has_org_role(org_id, 'admin'));

-- Plans are catalogue data, not tenant data.
create policy plans_read on plans for select using (true);

-- ── updated_at ─────────────────────────────────────────────────────────────

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end
$$;

create trigger organizations_touch before update on organizations
  for each row execute function public.touch_updated_at();
create trigger memberships_touch before update on memberships
  for each row execute function public.touch_updated_at();
create trigger subscriptions_touch before update on subscriptions
  for each row execute function public.touch_updated_at();
create trigger usage_counters_touch before update on usage_counters
  for each row execute function public.touch_updated_at();
