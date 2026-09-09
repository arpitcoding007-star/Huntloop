-- 0023 — asking for a recomputation, and being able to see it happen.
--
-- ── The gap ──────────────────────────────────────────────────────────────
--
-- `0016` gave every score its provenance: which prompt, which ICP version,
-- which rule set, and why it was computed. That makes drift answerable — but
-- only for scores that get recomputed, and nothing recomputes them. A score is
-- re-derived when a company happens to receive fresh evidence, so after a rule
-- edit the list a salesperson works from is a mixture of verdicts from before
-- and after the change, ranked together, with nothing on screen saying so.
--
-- ── Why this is a request table and not a button that enqueues ───────────
--
-- `enqueue()` writes through the service-role client, and calling it from a
-- Server Action would put the RLS bypass on a public POST endpoint — the
-- argument `packages/db/src/admin.ts` makes and `lib/data/engine.ts` restates.
-- So the request path writes a *request* through RLS, and the sweeper turns
-- requests into jobs. One writer to `job_executions`, as everywhere else.
--
-- The same shape as `sources.next_scan_at` and `learning_runs.requested`,
-- generalised only as far as this one need — a "generic job request" table
-- would be a second queue with none of the first one's guarantees.
--
-- ── Why a recomputation is a row rather than a fire-and-forget ───────────
--
-- It is the single most expensive thing a customer can ask this product to do:
-- one model call per opportunity, potentially thousands. That deserves a row
-- with a status, a cursor, counts and an end — so it can be watched, resumed
-- after a crash, and cancelled by a person who realises they did not mean it.

create table score_recompute_requests (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,

  -- Which profile to rescore against. Null means the org's active one, which
  -- is what a rule change implies: rules are org-wide.
  icp_id       uuid references icps(id) on delete cascade,

  -- Recorded onto every score this produces, through
  -- `opportunity_scores.computed_reason`. The three values are the three
  -- things that can invalidate a score without the company having changed.
  reason       text not null
               check (reason in ('rule_change', 'icp_change', 'manual')),

  status       text not null default 'pending'
               check (status in ('pending', 'running', 'done', 'failed', 'cancelled')),

  -- Null for a recomputation the system started. `write_audit_log_internal`'s
  -- reasoning: putting an owner's id against a machine's decision is worse
  -- than an empty column in exactly the situation this record exists for.
  requested_by uuid references auth.users(id) on delete set null,
  requested_at timestamptz not null default now(),
  started_at   timestamptz,
  finished_at  timestamptz,

  -- Where the fan-out got to. A recomputation spans many ticks, and a crash
  -- halfway must resume rather than restart — restarting would re-score every
  -- company it had already paid for.
  cursor       text,

  companies_seen  integer not null default 0,
  scores_enqueued integer not null default 0,
  error        text,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- One live recomputation per profile per org.
--
-- Two overlapping passes over the same opportunities would each enqueue a
-- score for every company; the queue's idempotency key would collapse most of
-- them, which sounds like it makes this index unnecessary. It does not: the
-- two passes would hold different cursors, finish at different times, and
-- report different counts for the same work — and a customer looking at two
-- half-finished recomputations cannot tell which number is true.
create unique index score_recompute_live_idx
  on score_recompute_requests (org_id, coalesce(icp_id::text, ''))
  where status in ('pending', 'running');

create index score_recompute_recent_idx
  on score_recompute_requests (org_id, requested_at desc);

alter table public.score_recompute_requests enable row level security;

create policy tenant_read on public.score_recompute_requests
  for select using (org_id in (select public.user_org_ids()));

-- Read through RLS, written through the function below.
--
-- No `for all` write policy on purpose: an INSERT policy would let a member
-- create a request in any state — including `done`, which would silently
-- cancel a live recomputation by taking its slot in the unique index. The
-- function is the only writer, and it decides the state.
create policy tenant_cancel on public.score_recompute_requests
  for update
  using (public.has_org_role(org_id, 'member') and status in ('pending', 'running'))
  with check (public.has_org_role(org_id, 'member') and status = 'cancelled');

create trigger score_recompute_requests_touch
  before update on public.score_recompute_requests
  for each row execute function public.touch_updated_at();

-- ── Requesting ────────────────────────────────────────────────────────────
--
-- Returns the request id, or null when one is already live. Null is an answer
-- rather than an error: "it is already running" is what the screen needs to
-- say, and raising would make a second click look like a failure.

create or replace function public.request_score_recompute(
  p_org    uuid,
  p_icp    uuid default null,
  p_reason text default 'manual'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare v_id uuid;
begin
  if not public.has_org_role(p_org, 'member') then
    raise exception 'request_score_recompute: not a member of %', p_org;
  end if;

  insert into public.score_recompute_requests (org_id, icp_id, reason, requested_by)
  values (p_org, p_icp, p_reason, auth.uid())
  on conflict do nothing
  returning id into v_id;

  return v_id;
end;
$$;

-- ── Claiming ──────────────────────────────────────────────────────────────
--
-- `for update skip locked`, the same claim `claim_due_discovery_queries` uses
-- and for the same reason: two ticks overlapping must not both start the same
-- recomputation, and a lock that waits would make the slower tick block rather
-- than move on to other work.

create or replace function public.claim_due_recomputes(p_limit integer default 5)
returns table (id uuid, org_id uuid, icp_id uuid, reason text, cursor text)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  return query
  with due as (
    select r.id
    from public.score_recompute_requests r
    where r.status = 'pending'
    order by r.requested_at
    limit greatest(p_limit, 0)
    for update skip locked
  )
  update public.score_recompute_requests r
    set status = 'running',
        started_at = coalesce(r.started_at, now()),
        updated_at = now()
    from due
    where r.id = due.id
    returning r.id, r.org_id, r.icp_id, r.reason, r.cursor;
end;
$$;

-- ── Progress and completion ───────────────────────────────────────────────
--
-- The counts accumulate rather than being derived, which is the opposite of
-- `finish_discovery_run`'s choice, and the difference is worth stating: a
-- discovery run's results are rows in a table that can be counted afterwards.
-- A recomputation's output is jobs in a queue that are consumed and gone, so
-- there is nothing left to count. Accumulating is therefore the only honest
-- option here — and the cursor makes it safe, because a resumed pass starts
-- where the last one stopped instead of counting the same companies twice.

create or replace function public.advance_recompute(
  p_request  uuid,
  p_cursor   text,
  p_seen     integer,
  p_enqueued integer,
  p_done     boolean
)
returns text
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare v_status text;
begin
  update public.score_recompute_requests r
    set cursor = coalesce(p_cursor, r.cursor),
        companies_seen  = r.companies_seen + greatest(coalesce(p_seen, 0), 0),
        scores_enqueued = r.scores_enqueued + greatest(coalesce(p_enqueued, 0), 0),
        -- A request cancelled mid-pass stays cancelled. The handler is not
        -- told to stop by being interrupted; it is told by this returning a
        -- status it does not expect, which is the only signal that survives a
        -- job already in flight.
        status = case
                   when r.status = 'cancelled' then 'cancelled'
                   when p_done then 'done'
                   else 'running'
                 end,
        finished_at = case
                        when r.status = 'cancelled' then coalesce(r.finished_at, now())
                        when p_done then now()
                        else r.finished_at
                      end,
        updated_at = now()
    where r.id = p_request
    returning r.status into v_status;

  return v_status;
end;
$$;

create or replace function public.fail_recompute(p_request uuid, p_error text)
returns void
language sql
security definer
set search_path = public, pg_catalog
as $$
  update public.score_recompute_requests
    set status = 'failed', error = left(coalesce(p_error, ''), 1000),
        finished_at = now(), updated_at = now()
    where id = p_request and status <> 'cancelled';
$$;

do $$
begin
  revoke execute on function
    public.request_score_recompute(uuid, uuid, text),
    public.claim_due_recomputes(integer),
    public.advance_recompute(uuid, text, integer, integer, boolean),
    public.fail_recompute(uuid, text)
  from public, anon, authenticated;

  -- Only the request is reachable from a session; the rest are the engine's.
  grant execute on function public.request_score_recompute(uuid, uuid, text)
    to authenticated;

  grant execute on function
    public.request_score_recompute(uuid, uuid, text),
    public.claim_due_recomputes(integer),
    public.advance_recompute(uuid, text, integer, integer, boolean),
    public.fail_recompute(uuid, text)
  to service_role;
-- Same tolerance as `0014`'s lockdown block: the Supabase roles do not exist
-- in the migration test's bare Postgres, and a grant that cannot be made there
-- must not stop the schema from being verified.
exception when undefined_object or undefined_function then null;
end
$$;

comment on table score_recompute_requests is
  'SCO-03. A customer asking for their opportunities to be rescored after a '
  'rule or profile change, with the cursor and counts that let it span many '
  'ticks, be watched, and be cancelled.';
