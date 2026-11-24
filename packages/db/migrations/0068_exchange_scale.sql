-- 0068 — Workspace purpose, Exchange at scale, demand totals
-- (DN-37; build plan Phase 4 load test; PANEL-208).

-- ── What a workspace is for (DN-37) ─────────────────────────────────────────
-- Set by the first job, then widened by what people actually do. It never
-- narrows and never gates anything: analytics, plans and where sign-in lands.

alter table public.organizations
  add column if not exists purpose text not null default 'seller'
    check (purpose in ('seller', 'buyer', 'both'));

create or replace function public.widen_workspace_purpose()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if new.org_id is not null then
    update public.organizations
       set purpose = 'both'
     where id = new.org_id and purpose = tg_argv[0];
  end if;
  return null;
end
$$;

-- A seller workspace that files a request buys too; a buyer workspace that
-- lists supply or defines who it sells to sells too.
drop trigger if exists exchange_needs_purpose on public.exchange_needs;
create trigger exchange_needs_purpose after insert on public.exchange_needs
  for each row execute function public.widen_workspace_purpose('seller');
drop trigger if exists exchange_provider_profiles_purpose on public.exchange_provider_profiles;
create trigger exchange_provider_profiles_purpose after insert or update of org_id on public.exchange_provider_profiles
  for each row execute function public.widen_workspace_purpose('buyer');
drop trigger if exists icps_purpose on public.icps;
create trigger icps_purpose after insert on public.icps
  for each row execute function public.widen_workspace_purpose('buyer');

update public.organizations o
   set purpose = case
     when o.workspace_kind = 'personal'
      and not exists (select 1 from public.icps i where i.org_id = o.id)
      and not exists (select 1 from public.exchange_provider_profiles p where p.org_id = o.id)
     then 'buyer' else 'both' end
 where o.purpose = 'seller'
   and exists (select 1 from public.exchange_needs n where n.org_id = o.id);

-- ── Alerts (found by the load test) ─────────────────────────────────────────
-- A request with fewer than two measured intent dimensions has no band, and
-- `null = 'hot'` is null: one such match failed the not-null insert and took
-- every Exchange notification in the run with it. And a message alert names the
-- buyer, so it now checks for itself that the introduction was accepted instead
-- of relying on the function that accepts the message.

create or replace function public.exchange_queue_notifications()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_window constant interval := interval '2 days';
  v_alerts int := 0;
  v_intros int := 0;
  v_messages int := 0;
  v_reconfirm int := 0;
  v_n int;
begin
  if auth.uid() is not null then
    raise exception 'This runs in the engine, not in a session.' using errcode = '42501';
  end if;
  -- 1. Supplier alerts: a new match on a request the buyer lets suppliers see (level 2+).
  insert into public.exchange_notifications
    (org_id, user_id, kind, need_id, match_id, title, body, href, channel, hot, dedupe_key)
  select o.org_id, mb.user_id, 'match_alert', n.id, m.id,
         'A buyer is looking for ' || coalesce(c.name, 'something you offer')
           || coalesce(' — ' || public.exchange_magnitude_band(n.quantity) || coalesce(' ' || case when n.visibility >= 3 then n.unit end, ''), ''),
         concat_ws(' · ',
           'Matches “' || o.title || '”',
           'budget ' || public.exchange_budget_band(n.budget_max, n.currency),
           case n.timeline when 'this_month' then 'needed this month' when 'this_quarter' then 'needed this quarter'
                           when 'later' then 'needed later' when 'exploring' then 'exploring' end,
           case when m.score is not null then 'fit ' || m.score || '/100' end),
         '/' || g.slug || '/exchange/supplier',
         case when coalesce(p.exchange_alerts, 'digest') = 'instant' and n.intent_band = 'hot' then 'instant' else 'digest' end,
         coalesce(n.intent_band = 'hot', false),
         'match:' || m.id || ':' || mb.user_id
    from public.exchange_matches m
    join public.exchange_needs n on n.id = m.need_id
    join public.exchange_offerings o on o.id = m.offering_id
    join public.organizations g on g.id = o.org_id
    left join public.exchange_categories c on c.id = n.category_id
    join public.memberships mb on mb.org_id = o.org_id and mb.deleted_at is null
    left join public.notification_preferences p on p.org_id = o.org_id and p.user_id = mb.user_id
   where m.computed_at > now() - v_window
     and m.score is not null
     and o.org_id is not null and o.org_id <> n.org_id
     and o.status = 'active' and o.deleted_at is null
     and n.visibility >= 2 and n.status = 'open' and n.deleted_at is null
     and coalesce(p.exchange_alerts, 'digest') <> 'off'
     and (coalesce(cardinality(p.exchange_alert_category_ids), 0) = 0 or n.category_id = any (p.exchange_alert_category_ids))
     and not exists (select 1 from public.exchange_intros i where i.need_id = n.id and i.offering_id = o.id)
  on conflict (dedupe_key) do nothing;
  get diagnostics v_alerts = row_count;

  -- 2. The buyer: a supplier asks to talk. Names the supplier, never the reverse.
  insert into public.exchange_notifications
    (org_id, user_id, kind, need_id, intro_id, title, body, href, channel, dedupe_key)
  select i.buyer_org_id, r.uid, 'intro_requested', n.id, i.id,
         coalesce(pp.name, 'A supplier') || ' would like to talk about your request',
         '“' || left(n.summary, 120) || '”. They do not know who you are unless you accept.',
         '/' || g.slug || '/exchange/intros/' || i.id,
         case when coalesce(p.exchange_emails, true) then 'instant' else 'none' end,
         'intro_req:' || i.id || ':' || r.uid
    from public.exchange_intros i
    join public.exchange_needs n on n.id = i.need_id
    join public.exchange_offerings o on o.id = i.offering_id
    left join public.exchange_provider_profiles pp on pp.id = o.provider_id
    join public.organizations g on g.id = i.buyer_org_id
    cross join lateral public.exchange_need_recipients(n) as r(uid)
    left join public.notification_preferences p on p.org_id = i.buyer_org_id and p.user_id = r.uid
   where i.state = 'requested' and i.direction = 'provider' and i.created_at > now() - v_window
  on conflict (dedupe_key) do nothing;
  get diagnostics v_n = row_count;
  v_intros := v_intros + v_n;

  -- 3. The supplier: accepted (the buyer may now be named) or declined.
  insert into public.exchange_notifications
    (org_id, user_id, kind, need_id, intro_id, title, body, href, channel, dedupe_key)
  select i.provider_org_id, mb.user_id,
         case when i.state = 'accepted' then 'intro_accepted' else 'intro_declined' end,
         i.need_id, i.id,
         case when i.state = 'accepted'
              then coalesce(bg.name, 'A buyer') || case when i.direction = 'buyer' then ' wants to talk about “' else ' accepted your introduction about “' end || o.title || '”'
              else 'A buyer declined your introduction request about “' || o.title || '”' end,
         case when i.state = 'accepted' then 'You can now see the request in full and message them.' end,
         '/' || g.slug || '/exchange/intros/' || i.id,
         case when coalesce(p.exchange_emails, true) then 'instant' else 'none' end,
         'intro_' || i.state || ':' || i.id || ':' || mb.user_id
    from public.exchange_intros i
    join public.exchange_offerings o on o.id = i.offering_id
    join public.organizations g on g.id = i.provider_org_id
    join public.organizations bg on bg.id = i.buyer_org_id
    join public.memberships mb on mb.org_id = i.provider_org_id and mb.deleted_at is null
    left join public.notification_preferences p on p.org_id = i.provider_org_id and p.user_id = mb.user_id
   where i.state in ('accepted', 'declined') and i.decided_at > now() - v_window
     and not (i.state = 'declined' and i.direction = 'buyer')
  on conflict (dedupe_key) do nothing;
  get diagnostics v_n = row_count;
  v_intros := v_intros + v_n;

  -- 4. New messages, to the other side, at most one per conversation per hour per person.
  insert into public.exchange_notifications
    (org_id, user_id, kind, need_id, intro_id, title, body, href, channel, dedupe_key)
  select x.org_id, x.uid, 'new_message', x.need_id, x.intro_id,
         'New message from ' || x.sender_name,
         left(x.body, 200),
         '/' || x.slug || '/exchange/intros/' || x.intro_id,
         case when coalesce(p.exchange_emails, true) then 'instant' else 'none' end,
         'msg:' || x.intro_id || ':' || x.uid || ':' || to_char(date_trunc('hour', x.created_at), 'YYYYMMDDHH24')
    from (
      (select distinct on (i.id, r.uid, date_trunc('hour', em.created_at))
             i.buyer_org_id as org_id, r.uid, i.need_id, i.id as intro_id, em.body, em.created_at,
             coalesce(pp.name, 'the supplier') as sender_name, g.slug
        from public.exchange_messages em
        join public.exchange_intros i on i.id = em.intro_id
        join public.exchange_needs n on n.id = i.need_id
        join public.exchange_offerings o on o.id = i.offering_id
        left join public.exchange_provider_profiles pp on pp.id = o.provider_id
        join public.organizations g on g.id = i.buyer_org_id
        cross join lateral public.exchange_need_recipients(n) as r(uid)
       where em.sender_side = 'provider' and em.created_at > now() - v_window
         and i.decided_at is not null and i.state not in ('requested', 'declined', 'withdrawn', 'stale')
         and (i.buyer_read_at is null or i.buyer_read_at < em.created_at)
       order by i.id, r.uid, date_trunc('hour', em.created_at), em.created_at)
      union all
      (select distinct on (i.id, mb.user_id, date_trunc('hour', em.created_at))
             i.provider_org_id, mb.user_id, i.need_id, i.id, em.body, em.created_at,
             coalesce(bg.name, 'the buyer'), g.slug
        from public.exchange_messages em
        join public.exchange_intros i on i.id = em.intro_id
        join public.organizations g on g.id = i.provider_org_id
        join public.organizations bg on bg.id = i.buyer_org_id
        join public.memberships mb on mb.org_id = i.provider_org_id and mb.deleted_at is null
       where em.sender_side = 'buyer' and em.created_at > now() - v_window
         and i.decided_at is not null and i.state not in ('requested', 'declined', 'withdrawn', 'stale')
         and (i.provider_read_at is null or i.provider_read_at < em.created_at)
       order by i.id, mb.user_id, date_trunc('hour', em.created_at), em.created_at)
    ) x
    left join public.notification_preferences p on p.org_id = x.org_id and p.user_id = x.uid
  on conflict (dedupe_key) do nothing;
  get diagnostics v_messages = row_count;

  -- 5. Re-confirm (DN-53): halfway to the decide-by date, or every 60 days without one.
  insert into public.exchange_notifications
    (org_id, user_id, kind, need_id, title, body, href, channel, dedupe_key)
  select n.org_id, r.uid, 'reconfirm', n.id,
         'Is this still needed? “' || left(n.summary, 120) || '”',
         'One tap keeps it in front of suppliers. Requests nobody confirms lapse after their decide-by date.',
         '/' || g.slug || '/exchange/requests/' || n.id,
         case when coalesce(p.exchange_emails, true) then 'instant' else 'none' end,
         'reconfirm:' || n.id || ':' || to_char(n.last_confirmed_at, 'YYYYMMDD') || ':' || r.uid
    from public.exchange_needs n
    join public.organizations g on g.id = n.org_id
    cross join lateral public.exchange_need_recipients(n) as r(uid)
    left join public.notification_preferences p on p.org_id = n.org_id and p.user_id = r.uid
   where n.status = 'open' and n.deleted_at is null
     and (
       (n.decide_by is not null
        and now() >= n.created_at + (n.decide_by::timestamptz - n.created_at) / 2
        and n.last_confirmed_at < n.created_at + (n.decide_by::timestamptz - n.created_at) / 2)
       or (n.decide_by is null and n.last_confirmed_at < now() - interval '60 days')
     )
  on conflict (dedupe_key) do nothing;
  get diagnostics v_reconfirm = row_count;

  return jsonb_build_object('alerts', v_alerts, 'intros', v_intros, 'messages', v_messages, 'reconfirm', v_reconfirm);
end
$$;

-- ── Supplier cards ──────────────────────────────────────────────────────────
-- Same rules as 0065. The k-anonymity counts are computed once rather than per
-- card, and the 200 best cards are returned: PostgREST cut the list at its own
-- cap, after every card had been written to the buyer's reveal log.

create or replace function public.exchange_matched_cards(p_org uuid)
returns table (
  match_id       uuid,
  need_id        uuid,
  offering_id    uuid,
  offering_title text,
  category_id    uuid,
  level          smallint,
  quantity_band  text,
  budget_band    text,
  place          text,
  timeline       text,
  summary        text,
  must_haves     text,
  unit           text,
  score          smallint,
  computed_at    timestamptz
)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
#variable_conflict use_column
declare
  v_name text;
begin
  if p_org is not null and public.exchange_suspended(p_org) then
    return;
  end if;
  if p_org is null or not (p_org in (select public.user_org_ids())) then
    raise exception 'not a member of the requested organisation'
      using errcode = '42501';
  end if;

  select p.name into v_name
    from public.exchange_provider_profiles p
   where p.org_id = p_org and p.deleted_at is null
   order by p.created_at
   limit 1;

  return query
  with visible as (
    select n.category_id, n.country, public.exchange_region(n.country) as region
      from public.exchange_needs n
     where n.visibility >= 2 and n.status = 'open' and n.deleted_at is null
       and not public.exchange_suspended(n.org_id)
  ),
  -- Counted once each, not once per card (Phase 4 load test).
  by_country as (select category_id, country, count(*) as n from visible where country is not null group by 1, 2),
  by_region as (select category_id, region, count(*) as n from visible where region is not null group by 1, 2),
  -- The 200 best. Only a card that is returned is logged as seen.
  best as (
    select m.id, m.need_id, m.offering_id, m.score, m.computed_at
      from public.exchange_matches m
      join public.exchange_needs n on n.id = m.need_id
      join public.exchange_offerings o on o.id = m.offering_id
     where m.provider_org_id = p_org
       and n.org_id <> p_org
       and n.visibility >= 2 and n.status = 'open' and n.deleted_at is null
       and not public.exchange_suspended(n.org_id)
       and o.deleted_at is null and o.status = 'active'
     order by m.score desc nulls last, m.computed_at desc, m.id
     limit 200
  ),
  cards as (
    select m.id as match_id, n.id as need_id, o.id as offering_id, o.title as offering_title,
           n.category_id, n.visibility as level, n.org_id as buyer_org,
           public.exchange_magnitude_band(n.quantity) as quantity_band,
           public.exchange_budget_band(n.budget_max, n.currency) as budget_band,
           case
             when n.country is null then null
             when (select v.n from by_country v
                    where v.category_id is not distinct from n.category_id and v.country = n.country)
                  >= public.exchange_card_k() then n.country
             when (select v.n from by_region v
                    where v.category_id is not distinct from n.category_id
                      and v.region = public.exchange_region(n.country))
                  >= public.exchange_card_k() then public.exchange_region(n.country)
             else 'Worldwide'
           end as place,
           n.timeline,
           case when n.visibility >= 3 then n.summary end as summary,
           case when n.visibility >= 3 then n.requirement -> 'must_haves' ->> 'value' end as must_haves,
           case when n.visibility >= 3 then n.unit end as unit,
           m.score, m.computed_at
      from best m
      join public.exchange_needs n on n.id = m.need_id
      join public.exchange_offerings o on o.id = m.offering_id
  ),
  logged as (
    insert into public.exchange_reveal_log as r (need_id, org_id, viewer_org_id, viewer_name, level, what)
    select distinct on (c.need_id) c.need_id, c.buyer_org, p_org, v_name, c.level, 'card'
      from cards c
    on conflict (need_id, viewer_org_id, what, day) do update
      set views = r.views + 1, last_seen_at = now(), level = excluded.level, viewer_name = excluded.viewer_name
    returning 1
  )
  select c.match_id, c.need_id, c.offering_id, c.offering_title, c.category_id, c.level,
         c.quantity_band, c.budget_band, c.place, c.timeline, c.summary, c.must_haves, c.unit,
         c.score, c.computed_at
    from cards c
   where (select count(*) from logged) >= 0
   order by c.score desc nulls last, c.computed_at desc;
end
$$;

-- ── Which requests to match next ────────────────────────────────────────────
-- The scheduler read the most recently confirmed requests and filtered them in
-- code, so past its read limit the rest were never matched at all. Never
-- matched first, then the stalest.

create or replace function public.exchange_needs_due(p_limit integer)
returns table (need_id uuid, org_id uuid, key text)
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
#variable_conflict use_column
begin
  if auth.uid() is not null then
    raise exception 'This runs in the engine, not in a session.' using errcode = '42501';
  end if;
  return query
  with changed as (
    select o.category_id, max(o.updated_at) as at
      from public.exchange_offerings o
     where o.status = 'active' and o.deleted_at is null and o.updated_at > now() - interval '2 days'
     group by o.category_id
  ),
  matched as (
    select m.need_id, max(m.computed_at) as at from public.exchange_matches m group by m.need_id
  )
  , due as (
    select n.id, n.org_id, n.created_at, m.at,
           -- Queued once a day, and once more per supply change since the last match.
           'match_needs:' || n.id || ':' || case
             when c.at > coalesce(m.at, 'epoch'::timestamptz) then to_char(c.at at time zone 'UTC', 'YYYYMMDDHH24MISSUS')
             else to_char(now() at time zone 'UTC', 'YYYY-MM-DD') end as key
      from public.exchange_needs n
      join public.exchange_categories k on k.id = n.category_id and k.matching_enabled and k.active
      left join matched m on m.need_id = n.id
      left join changed c on c.category_id = n.category_id
     where n.status = 'open' and n.deleted_at is null
       and (m.at is null or m.at <= now() - interval '1 day' or c.at > m.at)
  )
  select d.id, d.org_id, d.key
    from due d
   -- Already queued, so it must not hold a place in the limit.
   where not exists (select 1 from public.job_executions j where j.org_id = d.org_id and j.idempotency_key = d.key)
   order by d.at nulls first, d.created_at, d.id
   limit greatest(1, least(coalesce(p_limit, 200), 1000));
end
$$;

-- ── Demand totals (PANEL-208) ───────────────────────────────────────────────
-- Counted in SQL: the page counted the rows PostgREST returned, which stops at
-- its cap. SECURITY INVOKER, so RLS decides what is counted.

create or replace function public.demand_weights(p_org uuid)
returns table (theme_id uuid, signals bigint, opportunities bigint, value_cents numeric, lost bigint)
language sql
stable
set search_path = public, pg_catalog
as $$
  with deals as (
    select distinct s.theme_id, o.id, o.status::text as status, coalesce(o.estimated_value_cents, 0) as cents
      from public.demand_signals s
      join public.opportunities o on o.id = s.opportunity_id
     where s.org_id = p_org
  )
  select t.theme_id, t.signals,
         (select count(*) from deals d where d.theme_id is not distinct from t.theme_id),
         (select coalesce(sum(d.cents), 0) from deals d where d.theme_id is not distinct from t.theme_id and d.status <> 'won'),
         (select count(*) from deals d where d.theme_id is not distinct from t.theme_id and d.status in ('lost', 'archived'))
    from (select s.theme_id, count(*) as signals from public.demand_signals s where s.org_id = p_org group by s.theme_id) t
$$;

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
       'exchange_metrics', 'exchange_needs_due', 
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
  revoke all on function public.exchange_needs_due(integer) from public, anon, authenticated;
  revoke all on function public.widen_workspace_purpose() from public, anon, authenticated;
  revoke all on function public.demand_weights(uuid) from public, anon;
  grant execute on function public.demand_weights(uuid) to authenticated;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.exchange_needs_due(integer) to service_role;
  end if;
end
$$;

create or replace function public.migration_0068_applied()
returns boolean
language sql
immutable
set search_path = public, pg_catalog
as $$ select true $$;
