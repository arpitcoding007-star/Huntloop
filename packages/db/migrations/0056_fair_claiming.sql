-- 0056 — workspaces take turns (pass 16 JOB-202, pass 17 JOB-301).
--
-- ── The problem ──────────────────────────────────────────────────────────
--
-- `claim_job_executions` took the oldest due jobs across every workspace.
-- One workspace that imports 10,000 companies queues 20,000 follow-up jobs
-- (0050's `companies_enqueue_followups`, JOB-301), and every other workspace's
-- sends, syncs and research wait behind all of them. 0019 recorded the risk
-- and deferred the fix to "its own tests"; these are they.
--
-- Two sweepers had the same shape with even smaller windows:
-- `advance_enrollments` takes 5 enrollments a tick and `schedule_sends` 50,
-- both oldest-first across all workspaces. (`schedule_syncs` is already fair:
-- syncing a mailbox moves it to the back, so every inbox comes round.)
--
-- ── The rule ─────────────────────────────────────────────────────────────
--
-- Round-robin by workspace: each workspace with due work gets its oldest item
-- picked first, then each one's second-oldest, and so on, until the batch is
-- full. Inside one workspace, order is unchanged (oldest first). Global jobs
-- (`org_id` null, the sweepers themselves) are one more lane.
--
-- With workspace A holding 1,000 due jobs and B holding 1, a batch of 5 is
-- A, B, A, A, A by age: B is never behind A's backlog.
--
-- ── How ──────────────────────────────────────────────────────────────────
--
-- One lane per workspace with due work, then, per lane, at most `p_limit`
-- oldest rows (a lateral read on the new `(org_id, run_at)` partial index),
-- ranked by their turn. The chosen rows are then locked with
-- `for update skip locked`, exactly as before, so two runners still claim
-- disjoint sets. A row another runner took between the pick and the lock is
-- skipped, and the batch comes back a little short; the next claim fills it.

create index if not exists job_executions_due_org_idx
  on public.job_executions (org_id, run_at)
  where status = 'queued';

create or replace function public.claim_job_executions(
  p_limit  integer default 5,
  p_worker text default 'runner'
)
returns setof public.job_executions
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_limit integer := greatest(p_limit, 1);
begin
  return query
  with lanes as (
    select distinct q.org_id
      from public.job_executions q
     where q.status = 'queued' and q.run_at <= now()
  ),
  candidates as (
    select c.id, c.run_at,
           row_number() over (partition by l.org_id order by c.run_at, c.id) as turn
      from lanes l
      cross join lateral (
        select q.id, q.run_at
          from public.job_executions q
         where q.status = 'queued' and q.run_at <= now()
           and ((l.org_id is null and q.org_id is null) or q.org_id = l.org_id)
         order by q.run_at
         limit v_limit
      ) c
  ),
  picked as (
    select id from candidates order by turn, run_at, id limit v_limit
  )
  update public.job_executions j
     set status     = 'running',
         attempts   = j.attempts + 1,
         locked_at  = now(),
         locked_by  = p_worker,
         started_at = coalesce(j.started_at, now())
   where j.id in (
     select x.id
       from public.job_executions x
      where x.id in (select picked.id from picked)
        and x.status = 'queued'
      for update skip locked
   )
  returning j.*;
end
$$;

-- ── The two sweepers ────────────────────────────────────────────────────
--
-- Same rule, returning ids for the handler to work through. Plain SQL with
-- the caller's rights: the engine calls them with the service role, and a
-- session (were it allowed to call them) would see only its own rows under
-- RLS. Still revoked from sessions below, like `claim_job_executions`.

create or replace function public.due_enrollments_fair(p_now timestamptz, p_limit integer)
returns table (id uuid, org_id uuid)
language sql
stable
set search_path = public, pg_catalog
as $$
  with lanes as (
    select distinct e.org_id
      from public.enrollments e
     where e.status = 'active' and e.deleted_at is null
       and e.next_action_at is not null and e.next_action_at <= p_now
  ),
  candidates as (
    select c.id, c.org_id, c.next_action_at,
           row_number() over (partition by c.org_id order by c.next_action_at, c.id) as turn
      from lanes l
      cross join lateral (
        select e.id, e.org_id, e.next_action_at
          from public.enrollments e
         where e.org_id = l.org_id
           and e.status = 'active' and e.deleted_at is null
           and e.next_action_at is not null and e.next_action_at <= p_now
         order by e.next_action_at
         limit greatest(p_limit, 1)
      ) c
  )
  select c.id, c.org_id from candidates c
   order by c.turn, c.next_action_at, c.id
   limit greatest(p_limit, 1)
$$;

create or replace function public.due_sends_fair(p_now timestamptz, p_limit integer)
returns table (id uuid, org_id uuid, scheduled_at timestamptz)
language sql
stable
set search_path = public, pg_catalog
as $$
  with lanes as (
    select distinct m.org_id
      from public.messages m
     where m.direction = 'outbound' and m.sent_at is null and m.error is null
       and m.deleted_at is null
       and m.scheduled_at is not null and m.scheduled_at <= p_now
       and (m.not_before is null or m.not_before <= p_now)
  ),
  candidates as (
    select c.id, c.org_id, c.scheduled_at,
           row_number() over (partition by c.org_id order by c.scheduled_at, c.id) as turn
      from lanes l
      cross join lateral (
        select m.id, m.org_id, m.scheduled_at
          from public.messages m
         where m.org_id = l.org_id
           and m.direction = 'outbound' and m.sent_at is null and m.error is null
           and m.deleted_at is null
           and m.scheduled_at is not null and m.scheduled_at <= p_now
           and (m.not_before is null or m.not_before <= p_now)
         order by m.scheduled_at
         limit greatest(p_limit, 1)
      ) c
  )
  select c.id, c.org_id, c.scheduled_at from candidates c
   order by c.turn, c.scheduled_at, c.id
   limit greatest(p_limit, 1)
$$;

do $$
begin
  revoke execute on function
    public.claim_job_executions(integer, text),
    public.due_enrollments_fair(timestamptz, integer),
    public.due_sends_fair(timestamptz, integer)
  from public;
exception when undefined_object or undefined_function then null;
end $$;

do $$
begin
  revoke execute on function
    public.claim_job_executions(integer, text),
    public.due_enrollments_fair(timestamptz, integer),
    public.due_sends_fair(timestamptz, integer)
  from anon, authenticated;
  grant execute on function
    public.claim_job_executions(integer, text),
    public.due_enrollments_fair(timestamptz, integer),
    public.due_sends_fair(timestamptz, integer)
  to service_role;
exception when undefined_object or undefined_function then null;
end $$;

-- A probe for `db:doctor` (see 0031).
create or replace function public.migration_0056_applied()
returns boolean
language sql
immutable
set search_path = public, pg_catalog
as $$ select true $$;
