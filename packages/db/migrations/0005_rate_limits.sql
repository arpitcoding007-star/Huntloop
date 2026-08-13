-- ============================================================================
-- 0005 — Rate limiting for billable work
--
-- Backlog API-02. The companion to the fix in apps/web/lib/ai/recorder.ts:
-- that stopped a *non-member* from spending our Anthropic budget; this bounds
-- how fast a legitimate member can.
--
-- Why in Postgres rather than Redis. The obvious answer is Upstash or Vercel
-- KV, and for a hot path it would be right. This is not a hot path: the
-- actions being limited fetch several pages and reason over them, so they take
-- tens of seconds. A 5ms round trip to a database we already have, already
-- authenticate against, and already back up is not the cost worth optimizing —
-- and a second stateful service is a second thing to provision, secure, pay
-- for, and explain in SETUP.md.
--
-- Fixed window rather than sliding or token bucket. A fixed window admits up
-- to 2x the limit across a boundary, which for "how many company analyses per
-- hour" is a non-problem. It costs one row and one upsert. A sliding window
-- costs a row per event.
-- ============================================================================

create table rate_limits (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,

  -- Null means the limit is org-wide rather than per-person. Both exist:
  -- a per-user limit stops one person looping a form, and an org-wide limit
  -- stops ten seats doing it at once — which is the same bill.
  user_id      uuid references auth.users(id) on delete cascade,

  -- Matches ai_runs.task where the limit guards a model call, so the two
  -- tables can be read together when working out who spent what.
  action       text not null,

  -- Start of the fixed window, floored to the window size. Part of the unique
  -- key, which is what makes the counter an upsert rather than a transaction.
  window_start timestamptz not null,
  count        integer not null default 0,
  created_at   timestamptz not null default now(),

  -- `coalesce` is not usable in a unique constraint, and NULL never equals
  -- NULL, so a plain `unique (org_id, user_id, action, window_start)` would
  -- let every org-wide row insert a duplicate instead of incrementing. Two
  -- partial unique indexes, below, express it correctly.
  constraint rate_limits_count_nonneg check (count >= 0)
);

comment on table rate_limits is
  'Fixed-window counters for billable actions. Written only through '
  'consume_rate_limit(); nothing should insert here directly.';

create unique index rate_limits_user_window_idx
  on rate_limits (org_id, user_id, action, window_start)
  where user_id is not null;

create unique index rate_limits_org_window_idx
  on rate_limits (org_id, action, window_start)
  where user_id is null;

-- Sweeping expired windows. Without this the table grows forever, and the
-- delete would degrade into a sequential scan exactly when it is largest.
create index rate_limits_window_idx on rate_limits (window_start);

-- ── Consumption ────────────────────────────────────────────────────────────

-- SECURITY DEFINER, because the caller must be able to increment a counter
-- that constrains them — and a row a tenant can edit is not a rate limit.
-- The RLS policy below grants read only.
--
-- That makes the membership check inside this function load-bearing rather
-- than defensive: SECURITY DEFINER bypasses RLS, so without it any
-- authenticated user could consume (and therefore exhaust) another org's
-- quota. search_path is pinned for the reason given in 0001.
create or replace function public.consume_rate_limit(
  p_org            uuid,
  p_action         text,
  p_limit          integer,
  p_window_seconds integer,
  p_per_user       boolean default true
)
returns table (allowed boolean, remaining integer, reset_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_user   uuid := auth.uid();
  v_start  timestamptz;
  v_count  integer;
begin
  if v_user is null then
    raise exception 'consume_rate_limit requires an authenticated caller';
  end if;

  -- Not a member → not entitled to this org's quota. Same reasoning as
  -- resolveMembership(): do not distinguish "no such org" from "not yours".
  if not exists (
    select 1 from public.memberships m
    where m.org_id = p_org and m.user_id = v_user and m.deleted_at is null
  ) then
    raise exception 'not a member of the requested organisation';
  end if;

  -- Floor to the window. to_timestamp(floor(epoch / n) * n) rather than
  -- date_trunc, so the window size is a free parameter instead of being
  -- limited to Postgres' named units.
  v_start := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );

  -- Two statements, not one with a CASE in the VALUES list.
  --
  -- ON CONFLICT can only use a partial index as its arbiter when the row
  -- being inserted satisfies that index's predicate. A single statement
  -- inserting `case when p_per_user then v_user else null end` would name the
  -- `user_id is not null` index while sometimes inserting a NULL user — and
  -- for those rows the arbiter simply never matches, so every call inserts
  -- afresh instead of incrementing, until the *other* partial index raises a
  -- unique violation. The limit would silently not be a limit.
  if p_per_user then
    insert into public.rate_limits (org_id, user_id, action, window_start, count)
    values (p_org, v_user, p_action, v_start, 1)
    on conflict (org_id, user_id, action, window_start) where user_id is not null
    do update set count = public.rate_limits.count + 1
    returning public.rate_limits.count into v_count;
  else
    insert into public.rate_limits (org_id, user_id, action, window_start, count)
    values (p_org, null, p_action, v_start, 1)
    on conflict (org_id, action, window_start) where user_id is null
    do update set count = public.rate_limits.count + 1
    returning public.rate_limits.count into v_count;
  end if;

  return query select
    v_count <= p_limit,
    greatest(p_limit - v_count, 0),
    v_start + make_interval(secs => p_window_seconds);
end;
$$;

comment on function public.consume_rate_limit is
  'Increments and tests a fixed-window counter. Always increments, including '
  'on a denied call — a caller that keeps hammering should not have its '
  'window reset by being refused.';

-- Housekeeping. Called by a scheduled job; safe to run at any time.
create or replace function public.prune_rate_limits(p_older_than interval default interval '1 day')
returns integer
language sql
security definer
set search_path = public, pg_catalog
as $$
  with deleted as (
    delete from public.rate_limits
    where window_start < now() - p_older_than
    returning 1
  )
  select count(*)::integer from deleted
$$;

-- ── RLS ────────────────────────────────────────────────────────────────────

alter table rate_limits enable row level security;

-- Read only, and only your own org's. There is deliberately no write policy:
-- every write goes through consume_rate_limit(), which is SECURITY DEFINER.
-- A tenant that can UPDATE this table does not have a rate limit.
create policy rate_limit_read on rate_limits
  for select using (org_id in (select public.user_org_ids()));
