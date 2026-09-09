-- 0019 — the operator's view.
--
-- ── The question this answers ────────────────────────────────────────────
--
-- `JOB-01`: a job that exhausts its attempts sets `status = 'failed'` and is
-- never read by anything. There is no screen, no digest, and no query anybody
-- runs — so the observable behaviour of a permanently broken source, a
-- revoked mailbox token or an expired provider key is *silence*. The product
-- appears to work and quietly does less every week.
--
-- The audit brief asks for six answers: what failed, why, whose, can it
-- retry, what did it cost, and what happened next. Each of those is a query
-- somebody would otherwise write by hand at three in the morning, so each is
-- a view here.
--
-- ── Why views rather than a table the runner maintains ───────────────────
--
-- Because a maintained table is a cache, and an ops cache that is stale
-- during an incident is worse than no cache — it is a dashboard that says
-- everything is fine. These are derived, always current, and cost a query
-- against indexes that already exist.
--
-- ── security_invoker ─────────────────────────────────────────────────────
--
-- Every view here is `security_invoker = true`. A view over tenant tables
-- without it runs as its owner and hands one org's rows to another, which is
-- the single Critical risk in this repo's severity table. `0018` makes the
-- same note; it is repeated because the failure is silent and the setting is
-- easy to forget on the next view somebody adds.

-- ── Job health ────────────────────────────────────────────────────────────
--
-- One row per (org, job name, status). The shape the ops screen renders
-- directly, so the page is one select rather than five.

create or replace view job_health as
select
  j.org_id,
  j.job_name,
  j.status,
  count(*)                                   as jobs,
  max(j.created_at)                          as newest,
  min(j.run_at) filter (where j.status = 'queued') as oldest_due,
  -- Backlog age in seconds. The number that actually tells an operator
  -- whether the engine is keeping up: a queue of 400 that is 30 seconds old
  -- is healthy, and a queue of 3 that is six hours old is not.
  extract(epoch from (now() - min(j.run_at) filter (where j.status = 'queued')))::bigint
                                             as oldest_due_seconds,
  sum(j.attempts)                            as attempts_total,
  count(*) filter (where j.attempts >= j.max_attempts) as exhausted
from public.job_executions j
group by j.org_id, j.job_name, j.status;

alter view job_health set (security_invoker = true);

-- ── The dead letter queue ─────────────────────────────────────────────────
--
-- Everything that failed and will not be retried by anything. This is the
-- list `JOB-01` says nobody could see; it is deliberately a view of its own
-- rather than a filter on `job_health`, because "show me what is broken" is
-- the query somebody runs under pressure and it should not require getting a
-- predicate right.

create or replace view job_dead_letters as
select
  j.id,
  j.org_id,
  j.job_name,
  j.payload,
  j.error,
  j.attempts,
  j.max_attempts,
  j.run_at,
  j.created_at,
  j.updated_at,
  -- Whether a retry is even meaningful. A job whose handler no longer exists,
  -- or whose row is gone, will fail again identically — and a retry button
  -- that produces the same failure teaches people to stop pressing it.
  (j.attempts < j.max_attempts)              as retryable
from public.job_executions j
where j.status = 'failed';

alter view job_dead_letters set (security_invoker = true);

-- ── Provider health ───────────────────────────────────────────────────────
--
-- Rolling 24 hours, per provider. `success_rate` is deliberately computed
-- over calls that were actually *made* — a refusal or a cache hit is not a
-- provider failure, and counting them would make a well-cached system look
-- broken.

create or replace view provider_health as
select
  c.org_id,
  c.provider,
  c.capability,
  count(*)                                                        as calls,
  count(*) filter (where c.outcome = 'cache_hit')                 as cache_hits,
  count(*) filter (where c.outcome in ('ok', 'partial', 'empty'))  as succeeded,
  count(*) filter (where c.outcome = 'failed')                    as failed,
  count(*) filter (where c.outcome = 'rate_limited')              as rate_limited,
  count(*) filter (where c.outcome = 'refused')                   as refused,
  sum(c.credits)                                                  as credits,
  -- p50 and p95 rather than a mean. A mean latency over a set containing one
  -- 15-second timeout and ninety-nine 200ms calls reports 350ms and describes
  -- nothing that happened.
  percentile_disc(0.5) within group (order by c.latency_ms)
    filter (where c.latency_ms is not null)                       as p50_ms,
  percentile_disc(0.95) within group (order by c.latency_ms)
    filter (where c.latency_ms is not null)                       as p95_ms,
  max(c.created_at)                                               as last_call_at,
  max(c.created_at) filter (where c.outcome = 'failed')           as last_failure_at
from public.provider_calls c
where c.created_at > now() - interval '24 hours'
group by c.org_id, c.provider, c.capability;

alter view provider_health set (security_invoker = true);

-- ── Spend, in one place ───────────────────────────────────────────────────
--
-- `ai_runs` and `provider_calls` are two ledgers in two units — tokens and
-- credits — and the cost screen previously read only the first. A customer
-- asking "what did last month cost" wants one answer, and getting it from two
-- tables with different shapes is how a dashboard ends up showing half the
-- bill.
--
-- Units stay separate on purpose. Converting credits to a currency needs a
-- price list that changes per contract, and inventing one here would put a
-- fabricated number on a billing screen — the §7 failure in the place it
-- would do the most damage.

create or replace view spend_by_period as
select
  r.org_id,
  to_char(r.created_at, 'YYYY-MM')       as period,
  'ai'::text                             as kind,
  coalesce(r.model, 'unknown')           as unit,
  count(*)                               as calls,
  sum(coalesce(r.input_tokens, 0) + coalesce(r.output_tokens, 0))::bigint as tokens,
  0::bigint                              as credits,
  -- numeric, not bigint. `ai_runs.cost_cents` is numeric because a single
  -- Haiku call costs a fraction of a cent, and casting the sum to an integer
  -- reports a month of cheap calls as zero — a cost dashboard that says a
  -- system is free is worse than one that says nothing.
  sum(coalesce(r.cost_cents, 0))         as cost_cents
from public.ai_runs r
group by r.org_id, to_char(r.created_at, 'YYYY-MM'), r.model

union all

select
  c.org_id,
  to_char(c.created_at, 'YYYY-MM'),
  'provider',
  c.provider,
  count(*),
  0::bigint,
  sum(c.credits)::bigint,
  0::numeric
from public.provider_calls c
group by c.org_id, to_char(c.created_at, 'YYYY-MM'), c.provider;

alter view spend_by_period set (security_invoker = true);

-- ── The pipeline, as throughput ───────────────────────────────────────────
--
-- "Discovery throughput" and "qualification throughput" from the brief. Per
-- day, per org, so a stall is visible as a gap rather than as a number that
-- is merely lower than somebody remembers.

create or replace view pipeline_throughput as
select
  x.org_id,
  x.day,
  sum(x.companies_discovered)  as companies_discovered,
  sum(x.opportunities_created) as opportunities_created,
  sum(x.opportunities_scored)  as opportunities_scored,
  sum(x.messages_sent)         as messages_sent,
  sum(x.replies_received)      as replies_received
from (
  select c.org_id, date_trunc('day', c.created_at) as day,
         count(*) as companies_discovered, 0 as opportunities_created,
         0 as opportunities_scored, 0 as messages_sent, 0 as replies_received
  from public.companies c where c.deleted_at is null
  group by c.org_id, date_trunc('day', c.created_at)

  union all

  select o.org_id, date_trunc('day', o.created_at), 0, count(*), 0, 0, 0
  from public.opportunities o where o.deleted_at is null
  group by o.org_id, date_trunc('day', o.created_at)

  union all

  select s.org_id, date_trunc('day', s.computed_at), 0, 0, count(*), 0, 0
  from public.opportunity_scores s
  group by s.org_id, date_trunc('day', s.computed_at)

  union all

  select m.org_id, date_trunc('day', m.sent_at), 0, 0, 0, count(*), 0
  from public.messages m
  where m.direction = 'outbound' and m.sent_at is not null and m.deleted_at is null
  group by m.org_id, date_trunc('day', m.sent_at)

  union all

  select m.org_id, date_trunc('day', m.created_at), 0, 0, 0, 0, count(*)
  from public.messages m
  where m.direction = 'inbound' and m.deleted_at is null
  group by m.org_id, date_trunc('day', m.created_at)
) x
group by x.org_id, x.day;

alter view pipeline_throughput set (security_invoker = true);

-- ── Retrying a dead job ───────────────────────────────────────────────────
--
-- The button behind `job_dead_letters.retryable`. A function rather than an
-- update from the app for the usual reason — `job_executions` is written by
-- the service-role client and `apps/` may not import it — and because the
-- reset has to be complete: clearing the lock and the error as well as the
-- status, or the runner will claim a row that still looks locked.

create or replace function public.retry_job(p_org uuid, p_job uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare v_n integer;
begin
  if not public.has_org_role(p_org, 'admin') then
    raise exception 'retry_job: not an admin of %', p_org;
  end if;

  update public.job_executions
    set status = 'queued',
        -- Attempts are NOT reset. A person retrying a job that has already
        -- failed three times should get one more attempt, not another three
        -- — and the count is the record of how much this has cost so far.
        max_attempts = attempts + 1,
        run_at = now(),
        locked_at = null,
        locked_by = null,
        error = null,
        updated_at = now()
    where id = p_job and org_id = p_org and status = 'failed';

  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;

create or replace function public.cancel_job(p_org uuid, p_job uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare v_n integer;
begin
  if not public.has_org_role(p_org, 'admin') then
    raise exception 'cancel_job: not an admin of %', p_org;
  end if;

  -- Only queued work can be cancelled. A running job holds a lock and may be
  -- mid-way through a paid call; marking it cancelled would not stop it and
  -- would make the record lie about what happened.
  update public.job_executions
    set status = 'cancelled', error = 'cancelled by an administrator', updated_at = now()
    where id = p_job and org_id = p_org and status = 'queued';

  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;

-- ── Per-org fairness ──────────────────────────────────────────────────────
--
-- The scaling failure the plan calls most likely once discovery ships: one
-- org enqueues five thousand `research_company` jobs, `claim_job_executions`
-- orders by `run_at`, and every other tenant waits behind them. Nothing is
-- broken and nothing alerts; the product is simply dead for everyone else
-- until the backlog drains.
--
-- This is the read that makes it visible. The fix — round-robin claiming — is
-- a change to `claim_job_executions` and is deliberately not made here: it
-- alters the behaviour of the one function the whole engine depends on, and
-- it should land with its own tests rather than inside a migration about
-- views. What ships now is the ability to see the problem.

create or replace view queue_pressure as
select
  j.org_id,
  count(*) filter (where j.status = 'queued')  as queued,
  count(*) filter (where j.status = 'running') as running,
  min(j.run_at) filter (where j.status = 'queued') as oldest_due,
  -- This org's share of everything currently queued. A number above ~0.8 with
  -- more than one active tenant is the situation described above.
  round(
    count(*) filter (where j.status = 'queued')::numeric
    / nullif((select count(*) from public.job_executions where status = 'queued'), 0),
    3
  )                                            as share_of_queue
from public.job_executions j
where j.status in ('queued', 'running')
group by j.org_id;

alter view queue_pressure set (security_invoker = true);

-- ── Lockdown ──────────────────────────────────────────────────────────────

do $$
begin
  revoke execute on function
    public.retry_job(uuid, uuid),
    public.cancel_job(uuid, uuid)
  from public;
  grant execute on function
    public.retry_job(uuid, uuid),
    public.cancel_job(uuid, uuid)
  to authenticated, service_role;
exception when undefined_object or undefined_function then null;
end $$;
