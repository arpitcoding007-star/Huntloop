-- 0067 — Seats, HubSpot status, and the rest of the Exchange's Phase 2 and 3
-- database work (PANEL-402, PANEL-407; DN-82, DN-103, DN-104, DN-105).

-- ── Seats are people (PANEL-402) ────────────────────────────────────────────
-- `check_quota('seats')` read a monthly counter nothing ever incremented, so
-- the limit never applied. A seat is a live member or a pending invitation.

create or replace function public.org_seats(p_org uuid)
returns table (used bigint, quota bigint, allowed boolean)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  with n as (
    select (select count(*) from public.memberships m where m.org_id = p_org and m.deleted_at is null)
         + (select count(*) from public.invitations i
             where i.org_id = p_org and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()) as used,
           public.usage_limit(p_org, 'seats') as quota
  )
  select n.used, n.quota, (n.quota is null or n.used < n.quota)
    from n
   where exists (select 1 from public.memberships m
                  where m.org_id = p_org and m.user_id = auth.uid() and m.deleted_at is null)
$$;

/* The backstop on every path that admits somebody: accepting an invitation and
   approving a join request both land here. Members already in are never
   affected, and the engine and the operator (no session) are not limited. */
create or replace function public.enforce_seat_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_limit bigint;
  v_used bigint;
begin
  if auth.uid() is null or new.deleted_at is not null then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.deleted_at is null then
    return new;
  end if;
  -- An upsert over a live row is not a new seat.
  if tg_op = 'INSERT' and exists (
    select 1 from public.memberships m
     where m.org_id = new.org_id and m.user_id = new.user_id and m.deleted_at is null
  ) then
    return new;
  end if;
  v_limit := public.usage_limit(new.org_id, 'seats');
  if v_limit is null then
    return new;
  end if;
  -- One admission at a time per workspace, so two cannot both see the last seat.
  perform pg_advisory_xact_lock(hashtextextended('seats:' || new.org_id::text, 0));
  select count(*) into v_used from public.memberships m
   where m.org_id = new.org_id and m.deleted_at is null and m.user_id <> new.user_id;
  if v_used >= v_limit then
    raise exception 'This workspace has no free seat: its plan includes %.', v_limit using errcode = 'P0001';
  end if;
  return new;
end
$$;

drop trigger if exists memberships_seat_limit on public.memberships;
create trigger memberships_seat_limit
  before insert or update of deleted_at on public.memberships
  for each row execute function public.enforce_seat_limit();

-- ── HubSpot status for any member, without the token (PANEL-407) ────────────

create or replace function public.hubspot_status(p_org uuid)
returns table (hub_id text, connected_at timestamptz, last_synced_at timestamptz, last_sync_error text, is_enabled boolean)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select h.hub_id::text, h.connected_at, h.last_synced_at, h.last_sync_error, h.is_enabled
    from public.hubspot_connections h
   where h.org_id = p_org and p_org in (select public.user_org_ids())
$$;

-- ── Needs you (DN-82) ───────────────────────────────────────────────────────
-- What waits on this workspace in the Exchange: an introduction to decide, or
-- a message nobody has read. Never more than the introduction list shows: no
-- buyer name before acceptance. The engine's digest asks with no session.

create or replace function public.exchange_attention(p_org uuid)
returns table (kind text, intro_id uuid, title text, subject text, at timestamptz)
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
#variable_conflict use_column
begin
  if auth.uid() is not null and not (p_org in (select public.user_org_ids())) then
    raise exception 'not a member of the requested organisation' using errcode = '42501';
  end if;
  return query
  (select 'exchange-intro'::text, i.id,
          coalesce(pp.name, 'A supplier')::text, left(n.summary, 120)::text, i.created_at
     from public.exchange_intros i
     join public.exchange_needs n on n.id = i.need_id
     join public.exchange_offerings o on o.id = i.offering_id
     left join public.exchange_provider_profiles pp on pp.id = o.provider_id
    where i.buyer_org_id = p_org and i.state = 'requested' and i.direction = 'provider'
    order by i.created_at limit 50)
  union all
  (select 'exchange-message'::text, i.id,
          case when i.buyer_org_id = p_org then coalesce(pp.name, 'A supplier')
               else coalesce(g.name, 'A buyer') end::text,
          o.title::text, max(m.created_at)
     from public.exchange_intros i
     join public.exchange_messages m on m.intro_id = i.id
     join public.exchange_offerings o on o.id = i.offering_id
     left join public.exchange_provider_profiles pp on pp.id = o.provider_id
     left join public.organizations g on g.id = i.buyer_org_id
    where i.state = 'accepted' and i.decided_at is not null
      and ((i.buyer_org_id = p_org and m.sender_side = 'provider'
            and (i.buyer_read_at is null or i.buyer_read_at < m.created_at))
        or (i.provider_org_id = p_org and m.sender_side = 'buyer'
            and (i.provider_read_at is null or i.provider_read_at < m.created_at)))
    group by i.id, pp.name, g.name, o.title
    order by max(m.created_at) limit 50);
end
$$;

-- ── Metrics (DN-103, DN-104, DN-105) ────────────────────────────────────────
-- For the operator, in SQL: they span workspaces, and the product has no
-- platform-admin role (the decision recorded with 0065). A rate with nothing
-- to divide by is null, never 0.

create or replace function public.exchange_metrics(p_days integer default 30)
returns table (metric text, value numeric, of_total bigint, note text)
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
#variable_conflict use_column
declare
  v_since timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 365)));
begin
  if auth.uid() is not null then
    raise exception 'This runs in the engine, not in a session.' using errcode = '42501';
  end if;
  return query
  with needs as (
    select n.id, n.created_at,
           exists (select 1 from public.exchange_matches m where m.need_id = n.id) as matched,
           (select min(m.created_at) from public.exchange_matches m where m.need_id = n.id) as first_match
      from public.exchange_needs n where n.created_at >= v_since
  ),
  intros as (
    select i.*, exists (select 1 from public.exchange_outcomes x where x.intro_id = i.id) as reported
      from public.exchange_intros i where i.created_at >= v_since
  ),
  sessions as (select * from public.exchange_intake_sessions s where s.created_at >= v_since),
  -- Every field a questionnaire asked about, and how it was left.
  fields as (
    select f.key, f.value ->> 'source' as source, f.value ->> 'value' as value
      from sessions s cross join lateral jsonb_each(s.requirement) f
     where jsonb_typeof(f.value) = 'object'
  ),
  cost as (
    select coalesce(sum(r.cost_cents), 0) as cents, count(*) as runs,
           count(*) filter (where r.status in ('failed', 'error')) as failed
      from public.ai_runs r
     where r.created_at >= v_since and r.task in ('intake_classify', 'intake_turn', 'explain_match')
  )
  select 'requests_filed', (select count(*) from needs)::numeric, (select count(*) from needs), 'new requests'
  union all
  select 'match_coverage', (select avg(matched::int) from needs), (select count(*) from needs), 'share with at least one match'
  union all
  select 'hours_to_first_match',
         (select percentile_cont(0.5) within group (order by extract(epoch from first_match - created_at) / 3600)::numeric from needs where first_match is not null),
         (select count(*) from needs where first_match is not null), 'median'
  union all
  select 'intro_acceptance',
         (select avg((decided_at is not null and state <> 'declined')::int) from intros where direction = 'provider' and state <> 'withdrawn' and (decided_at is not null or state = 'stale')),
         (select count(*) from intros where direction = 'provider' and state <> 'withdrawn' and (decided_at is not null or state = 'stale')),
         'share of supplier requests accepted; unanswered counts against'
  union all
  select 'accepted_intros_per_request',
         (select count(*) from intros where decided_at is not null and state <> 'declined')::numeric / nullif((select count(*) from needs), 0),
         (select count(*) from needs), 'accepted introductions / requests filed'
  union all
  select 'outcome_rate',
         (select avg(reported::int) from intros where decided_at is not null and state <> 'declined'),
         (select count(*) from intros where decided_at is not null and state <> 'declined'), 'accepted introductions with an outcome'
  union all
  select 'intake_completion', (select avg((status = 'completed')::int) from sessions), (select count(*) from sessions), 'questionnaires that ended in a request'
  union all
  select 'intake_turns',
         (select percentile_cont(0.5) within group (order by turns)::numeric from sessions where status = 'completed'),
         (select count(*) from sessions where status = 'completed'), 'median turns of completed questionnaires'
  union all
  select 'skip_rate', (select avg((source = 'skipped')::int) from fields), (select count(*) from fields), 'share of fields skipped'
  union all
  select 'skipped:' || key, avg((source = 'skipped')::int), count(*), 'skip rate of this question' from fields group by key
  union all
  select 'ai_cost_cents_per_request', (select cents from cost) / nullif((select count(*) from needs), 0), (select runs from cost), 'budget is 10 cents (plan, Phase 2 exit)'
  union all
  select 'ai_failure_rate', (select failed from cost)::numeric / nullif((select runs from cost), 0), (select runs from cost), 'questionnaire and matching model calls that failed';
end
$$;

-- `engine_only_exposed()` (0066), with this file's engine-only functions.
create or replace function public.engine_only_exposed()
returns table (function_name text, role_name text)
language sql
stable
set search_path = public, pg_catalog
as $$
  select p.oid::regprocedure::text, r.rolname::text
    from pg_proc p
    cross join pg_roles r
   where p.pronamespace = 'public'::regnamespace
     and r.rolname in ('anon', 'authenticated')
     and p.proname in (
       'exchange_prune', 'exchange_expire', 'exchange_recall_offerings',
       'exchange_queue_notifications', 'exchange_prune_notifications', 'exchange_need_recipients',
       'exchange_intro_side', 'exchange_audit_intro', 'exchange_report_queue',
       'exchange_resolve_report', 'exchange_lift_suspension', 'exchange_suspended',
       'exchange_demand_k', 'exchange_score_intent', 'engine_only_exposed', 'firewall_stop_sequences',
       'exchange_metrics',
       'write_audit_log_internal', 'increment_usage_internal', 'check_quota_internal',
       'claim_job_executions', 'prune_job_executions', 'requeue_stalled_jobs',
       'reserve_provider_credit', 'settle_provider_credit',
       'claim_contact_lane', 'release_contact_lane', 'due_sends_fair',
       'claim_due_discovery_queries')
     and has_function_privilege(r.oid, p.oid, 'execute')
$$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated')
     or not exists (select 1 from pg_roles where rolname = 'anon') then
    return;
  end if;
  revoke all on function public.exchange_metrics(integer) from public, anon, authenticated;
  revoke all on function public.engine_only_exposed() from public, anon, authenticated;
  revoke all on function public.enforce_seat_limit() from public, anon, authenticated;
  revoke all on function public.org_seats(uuid) from public, anon;
  revoke all on function public.hubspot_status(uuid) from public, anon;
  revoke all on function public.exchange_attention(uuid) from public, anon;
  grant execute on function public.org_seats(uuid) to authenticated;
  grant execute on function public.hubspot_status(uuid) to authenticated;
  grant execute on function public.exchange_attention(uuid) to authenticated;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.exchange_metrics(integer) to service_role;
    grant execute on function public.engine_only_exposed() to service_role;
    grant execute on function public.exchange_attention(uuid) to service_role;
  end if;
end
$$;

create or replace function public.migration_0067_applied()
returns boolean
language sql
immutable
set search_path = public, pg_catalog
as $$ select true $$;
