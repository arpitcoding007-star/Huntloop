-- 0011 — the provider seam.
--
-- ── What changed, and why it needs three tables ──────────────────────────
--
-- Until now exactly one third-party vendor was reachable from this system:
-- `ENRICHMENT_API_KEY`, one optional call, on a path a customer had to ask
-- for. `providers.ts` says of itself that it is "not a provider abstraction
-- framework", and at that size it was right not to be.
--
-- Apollo changes the size. It sits on the critical path of the product's
-- primary workflow, it bills per credit, and a discovery run issues tens of
-- calls where enrichment issued one. Three properties become load-bearing at
-- that scale, and none of them can live in application memory:
--
--   the ledger    what was spent, by whom, on what, and whether it worked.
--                 A per-credit vendor with no ledger is an invoice you cannot
--                 reconcile and a budget you cannot enforce.
--   the cache     the same question asked twice inside a TTL must be paid for
--                 once. This is the single largest cost lever in the system.
--   the account   which provider serves which capability for which org, and
--                 what that org is allowed to spend.
--
-- ── Why the cache is org-scoped ─────────────────────────────────────────
--
-- A shared cache across tenants is strictly cheaper and is a cross-tenant
-- read with a performance justification. Org A searching "fintech companies
-- in Berlin" and org B reading A's cached response is a leak whether or not
-- the data originated with a third party — it discloses that A ran that
-- query, and the row would be served under B's RLS with A's provenance.
--
-- The cost of the decision is a lower hit rate. That is the correct trade,
-- and it is recorded here so it is not "optimised" later by somebody who sees
-- only the hit rate.
--
-- ── Why a cache hit still writes a ledger row ───────────────────────────
--
-- Because otherwise the hit rate is unmeasurable, and an unmeasured cache is
-- indistinguishable from a broken one. A hit writes `credits = 0` and
-- `outcome = 'cache_hit'`, so "calls made" and "credits spent" are two
-- different columns of the same table rather than two different stories.

-- ── Accounts ──────────────────────────────────────────────────────────────
--
-- One row per (org, capability). The provider serving a capability is
-- configuration, not a constant, and the row is what makes "Apollo for search,
-- Hunter for email" expressible — which the key-shape sniffing in
-- `providers.ts` could not express at all.
--
-- `provider` is deliberately free text rather than an enum. An enum here would
-- make adding a vendor a migration, and the set of vendors is exactly the kind
-- of thing that changes without a schema change being the right unit of work.
-- The registry in `packages/providers` is the closed set; this column records
-- which member of it was chosen.

create table provider_accounts (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,

  -- The five capabilities in `packages/providers/src/contract.ts`. Checked
  -- here rather than left open, because a typo in a capability name would
  -- silently mean "no provider configured" — which the whole system is built
  -- to treat as a normal state, so it would never raise anything.
  capability  text not null check (capability in (
    'company.search', 'company.enrich', 'person.search', 'person.match', 'email.verify'
  )),
  provider    text not null,

  is_enabled  boolean not null default true,

  -- The budget, in provider credits, per calendar month. NULL means "no limit
  -- set here" and falls back to the plan's limit in `usage_counters`; zero
  -- means "explicitly none", which is a different statement and one an admin
  -- may legitimately want to make while investigating a bill.
  monthly_credit_limit bigint check (monthly_credit_limit is null or monthly_credit_limit >= 0),

  -- Set by the boot-time auth ping. Three states, and the middle one is the
  -- one that matters: `unverified` means we have never confirmed the key
  -- works, which is what every deployment looked like before this table.
  -- `PRV-01`'s whole argument is that "wrong credentials" and "no results"
  -- must not be the same observable.
  credential_status text not null default 'unverified'
    check (credential_status in ('unverified', 'valid', 'invalid')),
  credential_checked_at timestamptz,
  credential_error      text,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,

  -- One provider per capability per org. Two would be a fallback chain, which
  -- is DEF-01 and deliberately not built: a chain with one implementation is
  -- speculation, and the seam that would allow it is the registry, not a
  -- second row here.
  unique (org_id, capability)
);

-- ── The ledger ────────────────────────────────────────────────────────────
--
-- Append-only, and never updated. The same argument `opportunity_scores`
-- makes: a row that records what happened stops being a record the moment
-- something is allowed to rewrite it.

create table provider_calls (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,

  capability   text not null,
  provider     text not null,

  -- sha256 of the normalized request, hex. The join key to `provider_cache`,
  -- and what makes "how many times did we ask this exact question" answerable.
  request_hash text not null,

  -- What it cost, in the provider's own credit unit. Zero for a cache hit and
  -- for a refusal, which is why `outcome` exists beside it: a table where
  -- cost is the only signal cannot distinguish "free" from "did not happen".
  credits      integer not null default 0 check (credits >= 0),

  -- What happened. Seven values, because collapsing them loses the exact
  -- distinctions the retry logic and the discovery runner are built on:
  --
  --   ok           the provider answered
  --   cache_hit    we did not ask; the answer was already ours
  --   partial      the provider answered with less than was requested and
  --                said so — a page cap, usually. NOT an error, and the
  --                difference between this and `ok` is what an incremental
  --                cursor is resumed from
  --   empty        the provider answered, and the answer is "nothing".
  --                Cacheable, unlike every row below it
  --   rate_limited 429. Retryable, and the signal that a budget is too loose
  --   failed       the provider errored. NOT cacheable — an outage that got
  --                cached as "no results" is the failure this whole column
  --                exists to prevent
  --   refused      we did not call, because a budget or a breaker said no
  outcome      text not null check (outcome in (
    'ok', 'cache_hit', 'partial', 'empty', 'rate_limited', 'failed', 'refused'
  )),

  http_status  integer,
  latency_ms   integer check (latency_ms is null or latency_ms >= 0),
  attempts     integer not null default 1 check (attempts >= 1),
  error        text,

  -- What the call was for, when there is one. Nullable and untyped on purpose:
  -- a foreign key would need one column per entity kind, and the ledger's job
  -- is accounting rather than referential integrity. Same shape as
  -- `ai_decisions.entity_type` / `entity_id`, which `0010` settled.
  entity_type  text,
  entity_id    uuid,

  created_at   timestamptz not null default now()
);

-- The cost screen's query: one org, one period, grouped.
create index provider_calls_org_time_idx
  on provider_calls (org_id, created_at desc);

-- "How often did we ask this?" — and the reconciliation join to the cache.
create index provider_calls_hash_idx
  on provider_calls (org_id, request_hash, created_at desc);

-- The health view's query. Partial, because failures are the small minority
-- and an index the size of the whole ledger to find them is the wrong shape.
create index provider_calls_failures_idx
  on provider_calls (org_id, provider, created_at desc)
  where outcome in ('failed', 'rate_limited');

-- ── The cache ─────────────────────────────────────────────────────────────

create table provider_cache (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,

  capability   text not null,
  provider     text not null,
  request_hash text not null,

  -- The adapter's *normalized* result, not the vendor's raw body. Storing the
  -- raw body would mean the mapping runs again on every hit — so a mapping bug
  -- fixed today would still be served from cache tomorrow — and would put
  -- vendor-shaped JSON in a table the rest of the system reads.
  body         jsonb not null,

  -- Kept for the same reason `enrichment_records.raw` is: when the mapping is
  -- wrong, the only way to know what the provider actually said is to have
  -- kept it. Bounded by the adapters, which truncate before storing.
  raw          jsonb,

  fetched_at   timestamptz not null default now(),
  -- TTL per capability, decided by the adapter and written here rather than
  -- inferred at read time, so changing the policy does not retroactively
  -- expire or extend rows that were stored under the old one.
  expires_at   timestamptz not null,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  unique (org_id, request_hash)
);

create index provider_cache_expiry_idx on provider_cache (expires_at);

-- ── The breaker ───────────────────────────────────────────────────────────
--
-- Circuit state in a table rather than in memory, because this runs on
-- serverless functions: an in-process breaker on N instances is N independent
-- breakers, each of which has to learn the outage separately, which is N times
-- the failed calls and N times the bill. `PERF-05` accepted a per-instance
-- cache for a HEAD request; a breaker guarding a paid vendor is the case where
-- that trade goes the other way.
--
-- Org-scoped, deliberately. A vendor outage is global, but so is a single
-- org's expired key, and one org's bad credentials must not open the breaker
-- for everybody else.

create table provider_breakers (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  provider       text not null,

  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  -- When set and in the future, calls are refused without being made.
  open_until     timestamptz,
  last_error     text,
  last_failure_at timestamptz,
  last_success_at timestamptz,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  unique (org_id, provider)
);

-- ── Recording a call ──────────────────────────────────────────────────────
--
-- One function, because the three writes have to agree: the ledger row, the
-- usage counter, and the breaker. Doing them as three statements from the
-- application means a crash between the first and the third leaves a spend
-- that no budget can see — which is precisely the failure mode a budget
-- exists to prevent.
--
-- `usage_counters` already has the `(org, period, metric, used, limit)` shape
-- `0001` gave it, so provider credits are a new *metric*, not a new system.

create or replace function public.record_provider_call(
  p_org         uuid,
  p_capability  text,
  p_provider    text,
  p_hash        text,
  p_outcome     text,
  p_credits     integer default 0,
  p_http_status integer default null,
  p_latency_ms  integer default null,
  p_attempts    integer default 1,
  p_error       text default null,
  p_entity_type text default null,
  p_entity_id   uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_id     uuid;
  v_metric text;
begin
  insert into public.provider_calls (
    org_id, capability, provider, request_hash, outcome, credits,
    http_status, latency_ms, attempts, error, entity_type, entity_id
  )
  values (
    p_org, p_capability, p_provider, p_hash, p_outcome, coalesce(p_credits, 0),
    p_http_status, p_latency_ms, coalesce(p_attempts, 1), p_error,
    p_entity_type, p_entity_id
  )
  returning id into v_id;

  -- Credits are counted per provider, not per capability. The bill arrives
  -- per provider, and a budget that cannot be compared against an invoice is
  -- a number rather than a control.
  if coalesce(p_credits, 0) > 0 then
    v_metric := 'provider_credits:' || p_provider;
    insert into public.usage_counters (org_id, period, metric, used)
    values (p_org, to_char(now(), 'YYYY-MM'), v_metric, p_credits)
    on conflict (org_id, period, metric)
      do update set used = public.usage_counters.used + excluded.used,
                    updated_at = now();
  end if;

  -- The breaker counts consecutive transport failures only. A 429 is the
  -- provider working correctly and telling us to slow down, and an `empty` is
  -- an answer; opening a circuit on either would take the system offline for
  -- doing exactly what it was asked.
  if p_outcome = 'failed' then
    insert into public.provider_breakers (org_id, provider, consecutive_failures, last_error, last_failure_at)
    values (p_org, p_provider, 1, p_error, now())
    on conflict (org_id, provider) do update
      set consecutive_failures = public.provider_breakers.consecutive_failures + 1,
          last_error           = excluded.last_error,
          last_failure_at      = excluded.last_failure_at,
          -- Five consecutive failures, then two minutes closed. Short on
          -- purpose: the breaker exists to stop a burst of doomed paid calls,
          -- not to keep a recovered vendor offline. A long window would mean
          -- one bad minute costs an hour of discovery.
          open_until           = case
                                   when public.provider_breakers.consecutive_failures + 1 >= 5
                                   then now() + interval '2 minutes'
                                   else public.provider_breakers.open_until
                                 end,
          updated_at           = now();
  elsif p_outcome in ('ok', 'partial', 'empty') then
    insert into public.provider_breakers (org_id, provider, consecutive_failures, last_success_at)
    values (p_org, p_provider, 0, now())
    on conflict (org_id, provider) do update
      set consecutive_failures = 0,
          open_until           = null,
          last_success_at      = now(),
          updated_at           = now();
  end if;

  return v_id;
end;
$$;

-- ── Is this org allowed to spend? ─────────────────────────────────────────
--
-- Returns the decision *and* the numbers behind it, because a refusal a user
-- cannot see the reason for is a bug report. Same shape as `backlog_state`.
--
-- Fails OPEN when no limit is configured, matching `withinAiBudget`: an
-- unconfigured budget is not a budget of zero. Fails CLOSED when a limit
-- exists and is reached — that is the entire point.

create or replace function public.provider_budget_state(
  p_org      uuid,
  p_provider text
)
returns table (used bigint, "limit" bigint, remaining bigint, allowed boolean)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  with counter as (
    select u.used
    from public.usage_counters u
    where u.org_id = p_org
      and u.period = to_char(now(), 'YYYY-MM')
      and u.metric = 'provider_credits:' || p_provider
  ),
  cap as (
    select min(a.monthly_credit_limit) as lim
    from public.provider_accounts a
    where a.org_id = p_org
      and a.provider = p_provider
      and a.deleted_at is null
      and a.monthly_credit_limit is not null
  )
  select
    coalesce((select used from counter), 0)::bigint,
    (select lim from cap)::bigint,
    case when (select lim from cap) is null then null
         else greatest((select lim from cap) - coalesce((select used from counter), 0), 0)
    end::bigint,
    case when (select lim from cap) is null then true
         else coalesce((select used from counter), 0) < (select lim from cap)
    end;
$$;

-- ── RLS ───────────────────────────────────────────────────────────────────
--
-- The generated pair, so the structural test at the bottom of
-- verify-migrations.ts covers these four without being told about them.
--
-- One deviation, on `provider_accounts`: writes are `admin`, not `member`.
-- Configuring which vendor is called and what it may spend is a spending
-- decision, and `0001` already draws that line at admin for `organizations`.

do $$
declare t text;
begin
  foreach t in array array['provider_calls', 'provider_cache', 'provider_breakers']
  loop
    execute format('alter table public.%1$I enable row level security', t);
    execute format($f$
      create policy tenant_read on public.%1$I
        for select using (org_id in (select public.user_org_ids()));
      create policy tenant_write on public.%1$I
        for all
        using (public.has_org_role(org_id, 'member'))
        with check (public.has_org_role(org_id, 'member'));
    $f$, t);
  end loop;
end
$$;

alter table public.provider_accounts enable row level security;

create policy tenant_read on public.provider_accounts
  for select using (org_id in (select public.user_org_ids()));

create policy tenant_write on public.provider_accounts
  for all
  using (public.has_org_role(org_id, 'admin'))
  with check (public.has_org_role(org_id, 'admin'));

create trigger provider_accounts_touch before update on public.provider_accounts
  for each row execute function public.touch_updated_at();
create trigger provider_cache_touch before update on public.provider_cache
  for each row execute function public.touch_updated_at();
create trigger provider_breakers_touch before update on public.provider_breakers
  for each row execute function public.touch_updated_at();

-- `provider_calls` gets no touch trigger, because it has no `updated_at`. It
-- is append-only, and a column implying otherwise would invite an update.

-- ── Pruning ───────────────────────────────────────────────────────────────
--
-- The cache is the one table here that grows without bound and has no
-- retention value once expired — a stale search result is not history, it is
-- a stale search result. Same pattern as `0006`'s rate-limit prune, and it is
-- scheduled the same way.

create or replace function public.prune_provider_cache()
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare removed integer;
begin
  delete from public.provider_cache where expires_at < now() - interval '1 day';
  get diagnostics removed = row_count;
  return removed;
end;
$$;

-- Scheduled exactly the way `0006` schedules its sweep, including the guard.
-- Everything after the availability check is dynamic, because the `cron`
-- schema does not exist until the extension is created and plpgsql would
-- otherwise try to resolve `cron.schedule` while parsing the block that
-- creates it.

do $$
declare
  v_scheduled boolean;
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice
      'pg_cron is unavailable here, so prune_provider_cache() is not scheduled. '
      'Expected under PGlite; on a hosted project this means expired cache rows '
      'accumulate and provider_cache grows without bound.';
    return;
  end if;

  execute 'create extension if not exists pg_cron';

  execute 'select exists (select 1 from cron.job where jobname = $1)'
    into v_scheduled
    using 'prune-provider-cache';

  if v_scheduled then
    execute 'select cron.unschedule($1)' using 'prune-provider-cache';
  end if;

  -- 04:17 UTC, an hour after the rate-limit sweep. Two deletes racing for the
  -- same autovacuum window is a self-inflicted wound.
  execute 'select cron.schedule($1, $2, $3)'
    using 'prune-provider-cache',
          '17 4 * * *',
          'select public.prune_provider_cache()';
end
$$;

-- ── Lockdown ──────────────────────────────────────────────────────────────

do $$
begin
  revoke execute on function
    public.record_provider_call(uuid, text, text, text, text, integer, integer, integer, integer, text, text, uuid),
    public.prune_provider_cache()
  from public, anon, authenticated;

  grant execute on function
    public.record_provider_call(uuid, text, text, text, text, integer, integer, integer, integer, text, text, uuid),
    public.prune_provider_cache()
  to service_role;
exception when undefined_object or undefined_function then null;
end $$;

-- `provider_budget_state` is readable by a member about their own org — it is
-- the query the cost screen runs — but the membership check has to be in the
-- function, not in the caller. Same `_for_org` split as `0009` and `0010`.

create or replace function public.provider_budget_for_org(p_org uuid, p_provider text)
returns table (used bigint, "limit" bigint, remaining bigint, allowed boolean)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select b.used, b."limit", b.remaining, b.allowed
  from public.provider_budget_state(p_org, p_provider) b
  where exists (
    select 1 from public.memberships m
    where m.org_id = p_org and m.user_id = auth.uid() and m.deleted_at is null
  )
$$;

do $$
begin
  revoke execute on function public.provider_budget_state(uuid, text) from public, anon, authenticated;
  grant execute on function public.provider_budget_state(uuid, text) to service_role;
exception when undefined_object or undefined_function then null;
end $$;
