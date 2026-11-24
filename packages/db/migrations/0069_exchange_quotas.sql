-- 0069 — Exchange quotas (DN-38, DN-98). Mechanism only: no plan carries a
-- limit until the billing decision (DN-07) gives one, and an absent limit is
-- no limit. Set with, e.g.:
--   update plans set limits = limits || '{"intro_requests": 20}' where id = 'free';

create or replace function public.exchange_quota_used(p_org uuid, p_metric text)
returns bigint
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select case p_metric
    -- Asked for this calendar month; a withdrawn request still reached the buyer.
    when 'intro_requests' then (select count(*) from public.exchange_intros i
      where i.provider_org_id = p_org and i.direction = 'provider' and i.created_at >= date_trunc('month', now() at time zone 'UTC') at time zone 'UTC')
    when 'needs_open' then (select count(*) from public.exchange_needs n
      where n.org_id = p_org and n.status = 'open' and n.deleted_at is null)
  end
$$;

create or replace function public.enforce_exchange_quota()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_org uuid;
  v_metric text := tg_argv[0];
  v_limit bigint;
begin
  if auth.uid() is null then
    return new;
  end if;
  if v_metric = 'intro_requests' then
    if new.direction <> 'provider' then return new; end if;
    v_org := new.provider_org_id;
  else
    if new.status <> 'open' or new.deleted_at is not null then return new; end if;
    if tg_op = 'UPDATE' and old.status = 'open' and old.deleted_at is null then return new; end if;
    v_org := new.org_id;
  end if;
  v_limit := public.usage_limit(v_org, v_metric);
  if v_limit is null then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('xq:' || v_metric || v_org::text, 0));
  if public.exchange_quota_used(v_org, v_metric) >= v_limit then
    raise exception '%', case v_metric
      when 'intro_requests' then format('Your plan includes %s introduction requests a month, and all are used.', v_limit)
      else format('Your plan includes %s open requests. Close or pause one first.', v_limit) end
      using errcode = 'P0001';
  end if;
  return new;
end
$$;

drop trigger if exists exchange_intros_quota on public.exchange_intros;
create trigger exchange_intros_quota before insert on public.exchange_intros
  for each row execute function public.enforce_exchange_quota('intro_requests');
drop trigger if exists exchange_needs_quota on public.exchange_needs;
create trigger exchange_needs_quota before insert or update of status, deleted_at on public.exchange_needs
  for each row execute function public.enforce_exchange_quota('needs_open');

-- What the screens show. A metric with no limit is not returned.
create or replace function public.exchange_quotas(p_org uuid)
returns table (metric text, used bigint, quota bigint)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select m, public.exchange_quota_used(p_org, m), public.usage_limit(p_org, m)
    from unnest(array['intro_requests', 'needs_open']) m
   where p_org in (select public.user_org_ids())
     and public.usage_limit(p_org, m) is not null
$$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated')
     or not exists (select 1 from pg_roles where rolname = 'anon') then
    return;
  end if;
  revoke all on function public.exchange_quota_used(uuid, text) from public, anon, authenticated;
  revoke all on function public.enforce_exchange_quota() from public, anon, authenticated;
  revoke all on function public.exchange_quotas(uuid) from public, anon;
  grant execute on function public.exchange_quotas(uuid) to authenticated;
end
$$;

create or replace function public.migration_0069_applied()
returns boolean
language sql
immutable
set search_path = public, pg_catalog
as $$ select true $$;
