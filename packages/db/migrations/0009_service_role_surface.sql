-- ============================================================================
-- 0009 — The same accounting, for a caller who is not a person
--
-- `0007` gave `usage_counters` and `audit_logs` write paths, and both begin:
--
--     if auth.uid() is null then raise exception ... end if;
--
-- which is correct for a Server Action and wrong for the job runner. A
-- scheduled scan has no signed-in user, so `auth.uid()` is null, so every one
-- of those functions refuses the very process that most needs to meter itself.
--
-- The wrong fix is to relax the guard — "allow a null caller" turns a
-- membership check into no check, and the anon key also presents as a null
-- caller. What is actually different about the runner is that it holds the
-- service-role key, and the way to express that is a second entry point that
-- only that role may execute.
--
-- So: each function splits into a public half that authenticates and an
-- internal half that does the work. The public half keeps its behaviour
-- exactly. The internal half is REVOKEd from `public`, `anon` and
-- `authenticated`, and GRANTed to `service_role` — which is the same
-- lockdown `0008` applies to `claim_job_executions`, and for the same reason.
-- ============================================================================

-- ── The work, without the authentication ───────────────────────────────────

create or replace function public.increment_usage_internal(
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
  v_period text := to_char(now() at time zone 'utc', 'YYYY-MM');
  v_used   bigint;
  v_limit  bigint;
begin
  v_limit := public.usage_limit(p_org, p_metric);

  insert into public.usage_counters (org_id, period, metric, used)
  values (p_org, v_period, p_metric, greatest(p_amount, 0))
  on conflict (org_id, period, metric)
  do update set used = public.usage_counters.used + greatest(p_amount, 0)
  returning public.usage_counters.used into v_used;

  return query select v_used, v_limit, (v_limit is null or v_used <= v_limit);
end
$$;

create or replace function public.check_quota_internal(p_org uuid, p_metric text)
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
$$;

-- The audit trail, written by the system rather than by a person.
--
-- `actor_id` is NULL, and that is the honest record: nobody clicked anything.
-- Substituting the org owner would put a person's name against a scheduled
-- job, which is worse than an empty column in exactly the situation an audit
-- trail exists for.
create or replace function public.write_audit_log_internal(
  p_org         uuid,
  p_action      text,
  p_target_type text default null,
  p_target_id   uuid default null,
  p_meta        jsonb default '{}'::jsonb
)
returns uuid
language sql
security definer
set search_path = public, pg_catalog
as $$
  insert into public.audit_logs (org_id, actor_id, action, target_type, target_id, meta)
  values (p_org, null, p_action, p_target_type, p_target_id, coalesce(p_meta, '{}'::jsonb))
  returning id
$$;

-- ── The public halves, now delegating ──────────────────────────────────────
--
-- Rewritten rather than left alone, so there is one implementation of the
-- upsert and the limit resolution. Two copies of an accounting rule is how the
-- billing screen and the engine end up disagreeing about the same number.

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
  v_user uuid := auth.uid();
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

  return query select * from public.increment_usage_internal(p_org, p_metric, p_amount);
end
$$;

create or replace function public.check_quota(p_org uuid, p_metric text)
returns table (used bigint, quota bigint, allowed boolean)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select q.used, q.quota, q.allowed
  from public.check_quota_internal(p_org, p_metric) q
  where exists (
    select 1 from public.memberships m
    where m.org_id = p_org and m.user_id = auth.uid() and m.deleted_at is null
  )
$$;

-- ── Lockdown ───────────────────────────────────────────────────────────────
--
-- Same shape as 0008's, including the two DO blocks: `public` always exists,
-- while `anon`, `authenticated` and `service_role` are Supabase roles that the
-- PGlite harness does not have. Splitting them means the first REVOKE — the
-- one that actually removes the default PUBLIC EXECUTE grant, and therefore
-- the one doing the work — lands in both environments.

do $$
begin
  revoke execute on function
    public.increment_usage_internal(uuid, text, bigint),
    public.check_quota_internal(uuid, text),
    public.write_audit_log_internal(uuid, text, text, uuid, jsonb)
  from public;
exception when undefined_object or undefined_function then null;
end $$;

do $$
begin
  revoke execute on function
    public.increment_usage_internal(uuid, text, bigint),
    public.check_quota_internal(uuid, text),
    public.write_audit_log_internal(uuid, text, text, uuid, jsonb)
  from anon, authenticated;

  grant execute on function
    public.increment_usage_internal(uuid, text, bigint),
    public.check_quota_internal(uuid, text),
    public.write_audit_log_internal(uuid, text, text, uuid, jsonb)
  to service_role;
exception when undefined_object or undefined_function then null;
end $$;
