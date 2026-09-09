-- 0014 — discovery.
--
-- ── What was missing ─────────────────────────────────────────────────────
--
-- Until now the only way a company entered this system was `scan_source`:
-- fetch a feed, extract signals, resolve. That is a *signal* pipeline, and a
-- good one — but it can only find companies somebody wrote about this week.
-- An ICP describing four thousand addressable companies produced zero of them
-- until one appeared in an RSS item.
--
-- This migration is the other half: searching for companies because they
-- match a profile, rather than waiting for them to be mentioned.
--
-- ── Why sources and searches share one abstraction ───────────────────────
--
-- They are the same shape. Both are a thing that runs on a schedule, produces
-- candidate companies, costs something, can fail, and needs its history kept
-- so a person can ask "where did this account come from". The alternative —
-- a `scan_runs` table beside a `discovery_runs` table — means every screen,
-- every health check and every cost query is written twice and drifts.
--
-- So `discovery_runs` covers all three channels: `provider`, `source`, and
-- `import`. `scan_source` keeps its own handler and its own semantics; what
-- it gains is a run row, which is what makes "23 companies this week, 4 from
-- Apollo and 19 from sources" a single query.
--
-- ── The rule the whole file is built around ──────────────────────────────
--
-- **A failed provider call must never look like an empty market.**
--
-- It is the most dangerous confusion available here: a customer who sees
-- "0 companies match your ICP" edits a profile that was fine, or concludes
-- the product does not work. Every state below that could be reached by a
-- failure has its own name, and `status` is never `succeeded` unless the
-- provider actually answered.

-- ── The query ─────────────────────────────────────────────────────────────
--
-- Separate from the run because one query is executed many times — that is
-- the entire point of a saved or recurring search — and because the
-- normalized hash is what makes "we already asked this" answerable across
-- runs.

create table discovery_queries (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,

  -- The profile this came from. Nullable: an ad-hoc search a user built by
  -- hand is legitimate and has no ICP. `icp_version_id` pins *which* version,
  -- so a query saved in March is not silently re-interpreted against a
  -- profile edited in June.
  icp_id         uuid references icps(id) on delete set null,
  icp_version_id uuid references icp_versions(id) on delete set null,

  name        text,

  -- Huntloop's own filter shape, produced by `translateIcp()` and readable
  -- without knowing any vendor. Never a provider's request body: storing that
  -- would make the saved search un-replayable the day the provider is
  -- swapped, which is the coupling architecture principle 12 forbids.
  filters     jsonb not null default '{}'::jsonb,

  -- sha256 of the canonicalized `filters`, hex. Two users who build the same
  -- search get one row and one cache entry.
  filters_hash text not null,

  -- What the ICP said that no configured provider can express. Recorded
  -- rather than dropped, and shown on the screen: a customer whose "uses
  -- Kubernetes" criterion silently vanished would reasonably believe the
  -- results honour it. This is `DSC-02`'s honesty requirement, in a column.
  unmappable  jsonb not null default '[]'::jsonb,

  -- Recurrence. Same shape as `sources.scan_interval_minutes` /
  -- `next_scan_at`, because it is the same problem and the scheduler should
  -- not need two ways to ask "what is due".
  is_saved    boolean not null default false,
  is_enabled  boolean not null default false,
  interval_minutes integer check (interval_minutes is null or interval_minutes >= 60),
  next_run_at timestamptz,

  -- The ceiling for one run of this query, in provider credits. Per-query
  -- rather than only per-org, because the failure this prevents is one
  -- badly-shaped search — "all software companies" — consuming a month of
  -- credits in four minutes while every other search starves.
  credit_budget integer not null default 100 check (credit_budget >= 0),
  max_pages     integer not null default 5 check (max_pages between 1 and 100),

  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,

  unique (org_id, filters_hash)
);

-- The scheduler's query, across every tenant. Partial and narrow for the same
-- reason `sources_due_idx` is: it should be the size of what is due, not the
-- size of the history.
create index discovery_queries_due_idx
  on discovery_queries (next_run_at)
  where is_enabled = true and deleted_at is null;

create index discovery_queries_saved_idx
  on discovery_queries (org_id, updated_at desc)
  where is_saved = true and deleted_at is null;

-- ── The run ───────────────────────────────────────────────────────────────

create table discovery_runs (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,

  channel     text not null check (channel in ('provider', 'source', 'import')),

  query_id    uuid references discovery_queries(id) on delete set null,
  source_id   uuid references sources(id) on delete set null,

  provider    text,

  -- Six states. The three ways a run can stop without having failed are
  -- distinct on purpose — see the rule at the top of this file.
  --
  --   queued      enqueued, not started
  --   running     a worker has it
  --   succeeded   the provider answered and we read everything we asked for
  --   partial     the provider answered and we stopped early — budget, page
  --               cap, or the provider's own limit. Results are real and the
  --               cursor is resumable. NOT a failure and NOT complete
  --   failed      the provider errored, timed out, or refused. Results, if
  --               any, are whatever arrived before it broke
  --   refused     we did not call: budget exhausted, breaker open, or no
  --               provider configured. Costs nothing and says so
  status      text not null default 'queued'
              check (status in ('queued', 'running', 'succeeded', 'partial', 'failed', 'refused')),

  -- Why it stopped. Free text would be re-parsed by the screen; an enum is
  -- what lets "how often do runs hit the page cap" be a query.
  stop_reason text check (stop_reason is null or stop_reason in (
    'exhausted', 'page_cap', 'credit_budget', 'org_budget', 'breaker_open',
    'no_provider', 'provider_error', 'timeout', 'cancelled'
  )),

  -- Resumption state. `page_cursor` is whatever the provider's pagination
  -- token is, stored opaquely — a page number for Apollo, something else for
  -- the next vendor, and neither is interpreted here.
  page_cursor    text,
  pages_fetched  integer not null default 0 check (pages_fetched >= 0),

  -- What the provider says exists in total, when it says. This is also the
  -- addressable-count estimate in `0013`, taken from the cheapest possible
  -- call, and it is the only place a market-size number is allowed to come
  -- from.
  total_available bigint check (total_available is null or total_available >= 0),

  -- The four counts a person actually asks for, kept separately because
  -- "returned 200" and "gave us 12 we didn't have" are very different days.
  results_returned integer not null default 0 check (results_returned >= 0),
  companies_new    integer not null default 0 check (companies_new >= 0),
  companies_matched integer not null default 0 check (companies_matched >= 0),
  results_excluded integer not null default 0 check (results_excluded >= 0),

  credits_spent  integer not null default 0 check (credits_spent >= 0),

  error       text,

  requested_by uuid references auth.users(id) on delete set null,
  trigger     text not null default 'manual' check (trigger in ('manual', 'scheduled', 'onboarding')),

  started_at  timestamptz,
  finished_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- A run belongs to exactly one thing. A provider run with a source id, or a
  -- source run with neither, is a row nothing can render correctly.
  constraint discovery_runs_channel_target check (
    (channel = 'provider' and query_id is not null and source_id is null)
    or (channel = 'source' and source_id is not null)
    or (channel = 'import')
  )
);

create index discovery_runs_recent_idx on discovery_runs (org_id, created_at desc);
create index discovery_runs_query_idx on discovery_runs (org_id, query_id, created_at desc);

-- At most one live run per query. The same double-submit argument
-- `learning_runs_one_open_per_org` makes, and here the cost of getting it
-- wrong is two identical paid searches rather than two model calls.
create unique index discovery_runs_one_open_per_query
  on discovery_runs (query_id)
  where status in ('queued', 'running') and query_id is not null;

-- ── The results ───────────────────────────────────────────────────────────
--
-- One row per company the provider returned, whether or not it became
-- anything. The rows that became *nothing* are the valuable ones: without
-- them "why is this company not in my list" has no answer, and an exclusion
-- rule that is quietly filtering half the market is invisible.

create table discovery_results (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  run_id      uuid not null references discovery_runs(id) on delete cascade,
  query_id    uuid references discovery_queries(id) on delete set null,

  -- What the provider said, before resolution. Kept even when the row is
  -- excluded, because that is the evidence for the exclusion.
  provider    text,
  provider_id text,
  raw_name    text,
  raw_domain  text,

  -- Where it ranked in the provider's own response. The learning loop's
  -- question — "do the companies we convert come from the top of the list or
  -- from anywhere in it" — is unanswerable without this, and it is free.
  rank        integer check (rank is null or rank >= 0),

  -- What happened to it.
  --
  --   new         became a company row
  --   matched     resolved to a company we already had
  --   excluded    matched a negative criterion. `exclusion_reason` says which
  --   suppressed  on the org's suppression list, or already an opportunity
  --               that was disqualified. Distinct from `excluded` because the
  --               cause is history rather than profile
  --   invalid     the provider returned something unusable — no domain, a
  --               domain that is not a domain. Counted, because a provider
  --               returning 30% junk is a fact about the provider
  outcome     text not null check (outcome in ('new', 'matched', 'excluded', 'suppressed', 'invalid')),
  exclusion_reason text,

  company_id  uuid references companies(id) on delete set null,

  -- Which filters this result actually satisfied, as reported or as checked.
  -- `DSC-06`: discovery has to be able to say why it surfaced something.
  matched_filters jsonb not null default '[]'::jsonb,

  created_at  timestamptz not null default now(),

  -- One row per company per run. A provider that returns the same
  -- organization on page 1 and page 3 — which they do — counts once.
  unique (run_id, provider, provider_id)
);

create index discovery_results_run_idx on discovery_results (run_id, rank);
create index discovery_results_company_idx on discovery_results (org_id, company_id)
  where company_id is not null;

-- "Have we seen this provider id before, for this query?" — the incremental
-- cursor's read, and the reason a re-run does not re-pay for known rows.
create index discovery_results_seen_idx
  on discovery_results (org_id, provider, provider_id);

-- ── Provenance on the company ─────────────────────────────────────────────
--
-- `companies.discovered_via` has been a free-text column since `0008` with
-- 'manual' as its default. It stays; what it gains is a pointer to the run,
-- so "where did this come from" resolves to a specific search on a specific
-- day rather than to the word "apollo".

alter table companies
  add column discovery_run_id uuid references discovery_runs(id) on delete set null;

create index companies_discovery_run_idx on companies (org_id, discovery_run_id)
  where discovery_run_id is not null;

-- ── Claiming a due query ──────────────────────────────────────────────────
--
-- The same shape as `claim_job_executions`: the scheduler must not hand the
-- same query to two ticks, and `for update skip locked` is how that is
-- guaranteed rather than hoped for.
--
-- It advances `next_run_at` as part of the claim. Doing it after the run
-- would mean a crashed worker leaves a query permanently due, which is an
-- infinite loop with a credit card attached.

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
    where q.is_enabled = true
      and q.deleted_at is null
      and q.next_run_at is not null
      and q.next_run_at <= now()
      -- Never two live runs of one query. The unique index would reject the
      -- insert anyway; skipping here means the tick does not burn a claim on
      -- a query it cannot start.
      and not exists (
        select 1 from public.discovery_runs r
        where r.query_id = q.id and r.status in ('queued', 'running')
      )
    order by q.next_run_at
    limit greatest(p_limit, 0)
    for update skip locked
  )
  update public.discovery_queries q
    set next_run_at = now() + make_interval(mins => coalesce(q.interval_minutes, 1440)),
        updated_at = now()
    from due
    where q.id = due.id
    returning q.id, q.org_id;
end;
$$;

-- ── Finishing a run ───────────────────────────────────────────────────────
--
-- The counts are derived from `discovery_results` rather than accumulated by
-- the handler, because a handler that increments as it goes and then dies
-- leaves a run whose numbers disagree with its own rows. Deriving them makes
-- the run row a *view* of the results, and re-running the function is
-- harmless — which is what makes the handler idempotent.

create or replace function public.finish_discovery_run(
  p_run    uuid,
  p_status text,
  p_stop_reason text default null,
  p_error  text default null,
  p_cursor text default null,
  p_total  bigint default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  update public.discovery_runs r
    set status = p_status,
        stop_reason = p_stop_reason,
        error = p_error,
        page_cursor = coalesce(p_cursor, r.page_cursor),
        total_available = coalesce(p_total, r.total_available),
        results_returned = (select count(*) from public.discovery_results d where d.run_id = p_run),
        companies_new = (select count(*) from public.discovery_results d where d.run_id = p_run and d.outcome = 'new'),
        companies_matched = (select count(*) from public.discovery_results d where d.run_id = p_run and d.outcome = 'matched'),
        results_excluded = (select count(*) from public.discovery_results d where d.run_id = p_run and d.outcome in ('excluded', 'suppressed', 'invalid')),
        credits_spent = coalesce((
          select sum(c.credits) from public.provider_calls c
          where c.entity_type = 'discovery_run' and c.entity_id = p_run
        ), r.credits_spent),
        finished_at = case when p_status in ('queued', 'running') then null else now() end,
        updated_at = now()
    where r.id = p_run;
end;
$$;

-- ── RLS ───────────────────────────────────────────────────────────────────

do $$
declare t text;
begin
  foreach t in array array['discovery_queries', 'discovery_runs', 'discovery_results']
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

create trigger discovery_queries_touch before update on public.discovery_queries
  for each row execute function public.touch_updated_at();
create trigger discovery_runs_touch before update on public.discovery_runs
  for each row execute function public.touch_updated_at();

-- ── Lockdown ──────────────────────────────────────────────────────────────

do $$
begin
  revoke execute on function
    public.claim_due_discovery_queries(integer),
    public.finish_discovery_run(uuid, text, text, text, text, bigint)
  from public, anon, authenticated;

  grant execute on function
    public.claim_due_discovery_queries(integer),
    public.finish_discovery_run(uuid, text, text, text, text, bigint)
  to service_role;
exception when undefined_object or undefined_function then null;
end $$;
