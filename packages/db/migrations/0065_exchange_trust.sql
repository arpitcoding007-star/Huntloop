-- 0065 — Exchange trust and safety, and market demand (build plan DN-32,
-- DN-55, DN-67, DN-75, DN-86, DN-87).
--
--   · Reports (DN-32): either side of a conversation, or a supplier looking at
--     a card, can report a request, an offering, a supplier profile, an
--     introduction or a message. The reporter reads their own reports and
--     nobody else's; the queue is worked by the operator in SQL, the same way
--     `platform_pauses` is (docs/operations/exchange-moderation.md), through
--     service-only functions that record every decision in the audit log.
--   · Suspensions (DN-75): `exchange_suspensions` puts one workspace out of the
--     Exchange. It is enforced where the data moves, not in the screens: no new
--     introductions or messages (triggers), no cards shown either way, no
--     candidates in recall, no notifications to or about a suspended workspace.
--     Existing data is untouched, so lifting a suspension restores everything.
--   · Spam limits (DN-86, DN-87): a request needs a confirmed email address,
--     and a workspace may file at most 10 a day.
--   · Market demand (DN-55, DN-67): `exchange_market_demand` gives a supplier
--     counts per category and region, and only where at least k = 10 open,
--     counted requests from confirmed, un-suspended buyers share the group.
--     A thinner region is folded into "Worldwide" for the category, or hidden.

-- ── Suspensions ─────────────────────────────────────────────────────────────

create table if not exists public.exchange_suspensions (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade,
  reason     text not null check (length(trim(reason)) > 0),
  report_id  uuid,
  created_at timestamptz not null default now(),
  lifted_at  timestamptz
);

comment on table public.exchange_suspensions is
  'A workspace the operator has put out of the Exchange (0065). Read and written only by the engine.';

create unique index if not exists exchange_suspensions_one_live on public.exchange_suspensions (org_id) where lifted_at is null;
create index if not exists exchange_suspensions_report_fk_idx on public.exchange_suspensions (report_id);

alter table public.exchange_suspensions enable row level security;
drop policy if exists no_session_access on public.exchange_suspensions;
create policy no_session_access on public.exchange_suspensions for all using (false) with check (false);

create or replace function public.exchange_suspended(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (select 1 from public.exchange_suspensions s where s.org_id = p_org and s.lifted_at is null)
$$;

-- No new introduction or message, from or to a suspended workspace.
create or replace function public.exchange_refuse_suspended()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_intro public.exchange_intros;
begin
  if tg_table_name = 'exchange_intros' then
    if public.exchange_suspended(new.buyer_org_id) or public.exchange_suspended(new.provider_org_id) then
      raise exception 'Introductions are unavailable while a workspace is suspended from the Exchange.' using errcode = 'P0001';
    end if;
  else
    select * into v_intro from public.exchange_intros where id = new.intro_id;
    if public.exchange_suspended(v_intro.buyer_org_id) or public.exchange_suspended(v_intro.provider_org_id) then
      raise exception 'Messages are unavailable while a workspace is suspended from the Exchange.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists exchange_intros_suspended on public.exchange_intros;
create trigger exchange_intros_suspended before insert on public.exchange_intros
  for each row execute function public.exchange_refuse_suspended();
drop trigger if exists exchange_messages_suspended on public.exchange_messages;
create trigger exchange_messages_suspended before insert on public.exchange_messages
  for each row execute function public.exchange_refuse_suspended();

-- No notification to a suspended workspace, nor an alert about a suspended buyer's request.
create or replace function public.exchange_skip_suspended_notice()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if public.exchange_suspended(new.org_id) then
    return null;
  end if;
  if new.kind = 'match_alert' and new.need_id is not null
     and exists (select 1 from public.exchange_needs n where n.id = new.need_id and public.exchange_suspended(n.org_id)) then
    return null;
  end if;
  return new;
end
$$;

drop trigger if exists exchange_notifications_suspended on public.exchange_notifications;
create trigger exchange_notifications_suspended before insert on public.exchange_notifications
  for each row execute function public.exchange_skip_suspended_notice();

-- Recall: a suspended workspace's offerings are not candidates.
create or replace function public.exchange_recall_offerings(p_need uuid, p_limit integer)
returns setof uuid
language sql
stable
set search_path = public, pg_catalog
as $$
  with need as (
    select n.category_id,
           nullif(array_to_string(tsvector_to_array(n.search), ' | '), '') as words
      from public.exchange_needs n
     where n.id = p_need
  )
  select o.id
    from public.exchange_offerings o, need
   where o.category_id = need.category_id
     and o.status = 'active' and o.deleted_at is null
     and (o.org_id is null or not public.exchange_suspended(o.org_id))
   order by case when need.words is null then 0
                 else ts_rank(o.search, to_tsquery('simple', need.words)) end desc,
            o.updated_at desc
   limit greatest(1, least(coalesce(p_limit, 500), 1000))
$$;

-- ── Spam limits (DN-86, DN-87) ──────────────────────────────────────────────

create or replace function public.exchange_need_limits()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_confirmed timestamptz;
  v_today int;
begin
  -- The engine (no session) is not rate-limited; a person is.
  if auth.uid() is null then
    return new;
  end if;
  select u.email_confirmed_at into v_confirmed from auth.users u where u.id = auth.uid();
  if v_confirmed is null then
    raise exception 'Confirm your email address before filing a request. We sent you a link when you signed up.' using errcode = 'P0001';
  end if;
  select count(*) into v_today from public.exchange_needs
   where org_id = new.org_id and created_at > now() - interval '1 day';
  if v_today >= 10 then
    raise exception 'This workspace has filed 10 requests in the last day, the most a day allows. Try again tomorrow, or edit one you have.' using errcode = 'P0001';
  end if;
  return new;
end
$$;

drop trigger if exists exchange_needs_limits on public.exchange_needs;
create trigger exchange_needs_limits before insert on public.exchange_needs
  for each row execute function public.exchange_need_limits();

-- ── Reports (DN-32) ─────────────────────────────────────────────────────────

create table if not exists public.exchange_reports (
  id               uuid primary key default gen_random_uuid(),
  reporter_org_id  uuid not null references public.organizations(id) on delete cascade,
  reporter_user_id uuid references auth.users(id) on delete set null default auth.uid(),
  subject_type     text not null check (subject_type in ('need', 'offering', 'provider', 'intro', 'message')),
  subject_id       uuid not null,
  -- The workspace the report is about, resolved when it is filed.
  subject_org_id   uuid references public.organizations(id) on delete set null,
  reason           text not null check (reason in
                     ('spam', 'fake_buyer', 'misrepresentation', 'prohibited', 'harassment', 'privacy', 'other')),
  detail           text check (detail is null or length(detail) <= 1000),
  state            text not null default 'open' check (state in ('open', 'actioned', 'dismissed')),
  resolution       text check (resolution is null or length(resolution) <= 1000),
  resolved_at      timestamptz,
  created_at       timestamptz not null default now()
);

comment on table public.exchange_reports is
  'Trust and safety reports (0065). The reporter reads their own through exchange_my_reports; the operator works the queue in SQL.';

create unique index if not exists exchange_reports_one_open
  on public.exchange_reports (reporter_org_id, subject_type, subject_id) where state = 'open';
create index if not exists exchange_reports_queue_idx on public.exchange_reports (state, created_at);
create index if not exists exchange_reports_reporter_user_fk_idx on public.exchange_reports (reporter_user_id);
create index if not exists exchange_reports_subject_org_fk_idx on public.exchange_reports (subject_org_id);
create index if not exists exchange_reports_reporter_org_idx on public.exchange_reports (reporter_org_id, created_at desc);

alter table public.exchange_reports enable row level security;
drop policy if exists exchange_reports_own on public.exchange_reports;
drop policy if exists no_session_access on public.exchange_reports;
create policy no_session_access on public.exchange_reports for all using (false) with check (false);
-- Filed through `exchange_report`, read back through `exchange_my_reports`.
-- The table holds `subject_org_id`: a supplier reporting a request it saw as
-- an anonymous card would read the buyer's workspace there.

alter table public.exchange_suspensions drop constraint if exists exchange_suspensions_report_id_fkey;
alter table public.exchange_suspensions
  add constraint exchange_suspensions_report_id_fkey foreign key (report_id) references public.exchange_reports(id) on delete set null;

create or replace function public.exchange_report(
  p_subject_type text,
  p_subject_id uuid,
  p_reason text,
  p_detail text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_org uuid;
  v_subject_org uuid;
  v_user uuid := auth.uid();
  v_id uuid;
  v_recent int;
  v_intro public.exchange_intros;
begin
  if v_user is null then
    raise exception 'Sign in to report something.' using errcode = '42501';
  end if;
  if p_detail is not null and length(p_detail) > 1000 then
    raise exception 'A report is at most 1,000 characters.' using errcode = '22001';
  end if;

  -- Which of the caller's workspaces is filing, and who the report is about.
  if p_subject_type = 'need' then
    select p.org_id, n.org_id into v_org, v_subject_org
      from public.exchange_needs n
      join public.exchange_matches m on m.need_id = n.id
      join public.exchange_offerings o on o.id = m.offering_id
      join public.exchange_provider_profiles p on p.id = o.provider_id
     where n.id = p_subject_id and n.visibility >= 2 and n.deleted_at is null
       and p.org_id in (select public.user_org_ids())
     limit 1;
    if v_org is null then
      select i.provider_org_id, i.buyer_org_id into v_org, v_subject_org
        from public.exchange_intros i
       where i.need_id = p_subject_id and i.provider_org_id in (select public.user_org_ids()) limit 1;
    end if;
  elsif p_subject_type = 'offering' then
    select o.org_id into v_subject_org from public.exchange_offerings o
     where o.id = p_subject_id and o.status = 'active' and o.deleted_at is null;
    select n.org_id into v_org from public.exchange_matches m
      join public.exchange_needs n on n.id = m.need_id
     where m.offering_id = p_subject_id and n.org_id in (select public.user_org_ids()) limit 1;
  elsif p_subject_type = 'provider' then
    select p.org_id into v_subject_org from public.exchange_provider_profiles p
     where p.id = p_subject_id and p.deleted_at is null;
    select n.org_id into v_org from public.exchange_matches m
      join public.exchange_needs n on n.id = m.need_id
      join public.exchange_offerings o on o.id = m.offering_id
     where o.provider_id = p_subject_id and n.org_id in (select public.user_org_ids()) limit 1;
  elsif p_subject_type in ('intro', 'message') then
    if p_subject_type = 'message' then
      select i.* into v_intro from public.exchange_intros i
        join public.exchange_messages em on em.intro_id = i.id where em.id = p_subject_id;
      select em.sender_org_id into v_subject_org from public.exchange_messages em where em.id = p_subject_id;
    else
      select * into v_intro from public.exchange_intros where id = p_subject_id;
    end if;
    if v_intro.id is not null then
      if v_intro.buyer_org_id in (select public.user_org_ids()) then
        v_org := v_intro.buyer_org_id;
        v_subject_org := coalesce(v_subject_org, v_intro.provider_org_id);
      elsif v_intro.provider_org_id in (select public.user_org_ids()) then
        v_org := v_intro.provider_org_id;
        v_subject_org := coalesce(v_subject_org, v_intro.buyer_org_id);
      end if;
    end if;
  else
    raise exception 'Unknown subject %', p_subject_type using errcode = '22023';
  end if;

  -- The same answer whether it does not exist or the caller may not see it.
  if v_org is null or v_subject_org is null then
    raise exception 'That cannot be reported from here.' using errcode = 'P0002';
  end if;
  if v_subject_org = v_org then
    raise exception 'That is your own workspace.' using errcode = 'P0001';
  end if;
  if not public.has_org_role(v_org, 'member') then
    raise exception 'not a member of the requested organisation, or read-only there' using errcode = '42501';
  end if;
  if p_reason not in ('spam', 'fake_buyer', 'misrepresentation', 'prohibited', 'harassment', 'privacy', 'other') then
    raise exception 'Unknown reason %', p_reason using errcode = '22023';
  end if;

  select count(*) into v_recent from public.exchange_reports where reporter_user_id = v_user and created_at > now() - interval '1 day';
  if v_recent >= 10 then
    raise exception 'You have filed 10 reports today, the most a day allows.' using errcode = 'P0001';
  end if;

  select id into v_id from public.exchange_reports
   where reporter_org_id = v_org and subject_type = p_subject_type and subject_id = p_subject_id and state = 'open';
  if v_id is not null then
    return v_id;
  end if;

  insert into public.exchange_reports (reporter_org_id, subject_type, subject_id, subject_org_id, reason, detail)
  values (v_org, p_subject_type, p_subject_id, v_subject_org, p_reason, nullif(trim(coalesce(p_detail, '')), ''))
  returning id into v_id;

  perform public.write_audit_log_internal(v_org, 'exchange.report_filed', 'exchange_report', v_id,
    jsonb_build_object('subject', p_subject_type, 'reason', p_reason));
  return v_id;
end
$$;

/* The workspace's own reports: what it filed, not who that turned out to be
   about and not what was decided (docs/operations/exchange-moderation.md). */
create or replace function public.exchange_my_reports(p_org uuid)
returns table (
  id           uuid,
  subject_type text,
  subject_id   uuid,
  reason       text,
  detail       text,
  created_at   timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
#variable_conflict use_column
begin
  if p_org is null or not (p_org in (select public.user_org_ids())) then
    raise exception 'not a member of the requested organisation' using errcode = '42501';
  end if;
  return query
  select r.id, r.subject_type, r.subject_id, r.reason, r.detail, r.created_at
    from public.exchange_reports r
   where r.reporter_org_id = p_org
   order by r.created_at desc
   limit 500;
end
$$;

-- The operator's queue and decisions (service only; see the runbook).
create or replace function public.exchange_report_queue()
returns table (
  report_id      uuid,
  filed_at       timestamptz,
  reason         text,
  detail         text,
  subject_type   text,
  subject_id     uuid,
  subject_org    uuid,
  subject_org_name text,
  open_reports_on_org bigint,
  distinct_reporters_on_org bigint,
  org_suspended  boolean
)
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
  select r.id, r.created_at, r.reason, r.detail, r.subject_type, r.subject_id, r.subject_org_id, g.name,
         (select count(*) from public.exchange_reports x where x.subject_org_id = r.subject_org_id and x.state = 'open'),
         (select count(distinct x.reporter_org_id) from public.exchange_reports x where x.subject_org_id = r.subject_org_id and x.state = 'open'),
         public.exchange_suspended(r.subject_org_id)
    from public.exchange_reports r
    left join public.organizations g on g.id = r.subject_org_id
   where r.state = 'open'
   order by 9 desc, r.created_at;
end
$$;

/* One decision per call: 'dismiss', 'remove' (pauses an offering, withdraws a
   request, or deletes a message — what the report was about), or 'suspend'
   (puts the subject's workspace out of the Exchange). Every decision is
   written to the audit log of the reporter and of the subject. */
create or replace function public.exchange_resolve_report(p_report uuid, p_action text, p_note text default null)
returns text
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_r public.exchange_reports;
  v_state text;
  v_intro uuid;
begin
  if auth.uid() is not null then
    raise exception 'This runs in the engine, not in a session.' using errcode = '42501';
  end if;
  if p_action not in ('dismiss', 'remove', 'suspend') then
    raise exception 'Unknown action %. Use dismiss, remove or suspend.', p_action using errcode = '22023';
  end if;
  select * into v_r from public.exchange_reports where id = p_report for update;
  if v_r.id is null then
    raise exception 'No such report.' using errcode = 'P0002';
  end if;
  if v_r.state <> 'open' then
    raise exception 'That report is already %.', v_r.state using errcode = 'P0001';
  end if;

  if p_action = 'remove' then
    if v_r.subject_type = 'offering' then
      update public.exchange_offerings set status = 'paused' where id = v_r.subject_id;
    elsif v_r.subject_type = 'need' then
      update public.exchange_needs set status = 'withdrawn', visibility = 0 where id = v_r.subject_id;
    elsif v_r.subject_type = 'message' then
      delete from public.exchange_messages where id = v_r.subject_id;
    elsif v_r.subject_type = 'provider' then
      update public.exchange_offerings set status = 'paused' where provider_id = v_r.subject_id;
    elsif v_r.subject_type = 'intro' then
      update public.exchange_intros set state = 'closed' where id = v_r.subject_id and state in ('requested', 'accepted');
    end if;
  elsif p_action = 'suspend' then
    if v_r.subject_org_id is null then
      raise exception 'That report has no workspace to suspend.' using errcode = 'P0001';
    end if;
    insert into public.exchange_suspensions (org_id, reason, report_id)
    values (v_r.subject_org_id, coalesce(nullif(trim(coalesce(p_note, '')), ''), 'Suspended after report ' || v_r.id), v_r.id)
    on conflict (org_id) where lifted_at is null do nothing;
  end if;

  v_state := case when p_action = 'dismiss' then 'dismissed' else 'actioned' end;
  update public.exchange_reports
     set state = v_state, resolved_at = now(), resolution = nullif(trim(coalesce(p_note, '')), '')
   where id = p_report;

  perform public.write_audit_log_internal(v_r.reporter_org_id, 'exchange.report_' || v_state, 'exchange_report', v_r.id,
    jsonb_build_object('action', p_action));
  if v_r.subject_org_id is not null and p_action <> 'dismiss' then
    perform public.write_audit_log_internal(v_r.subject_org_id, 'exchange.moderated', 'exchange_report', v_r.id,
      jsonb_build_object('action', p_action, 'reason', v_r.reason));
  end if;
  return v_state;
end
$$;

create or replace function public.exchange_lift_suspension(p_org uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_n int;
begin
  if auth.uid() is not null then
    raise exception 'This runs in the engine, not in a session.' using errcode = '42501';
  end if;
  update public.exchange_suspensions set lifted_at = now() where org_id = p_org and lifted_at is null;
  get diagnostics v_n = row_count;
  if v_n > 0 then
    perform public.write_audit_log_internal(p_org, 'exchange.suspension_lifted', 'organization', p_org, '{}'::jsonb);
  end if;
  return v_n > 0;
end
$$;

/* Whether the caller's workspace is suspended, for the screens. */
create or replace function public.exchange_my_suspension(p_org uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select s.reason from public.exchange_suspensions s
   where s.org_id = p_org and s.lifted_at is null and p_org in (select public.user_org_ids())
$$;

-- ── Market demand (DN-55, DN-67) ────────────────────────────────────────────

create or replace function public.exchange_demand_k()
returns integer language sql immutable set search_path = public, pg_catalog as $$ select 10 $$;

/* Counts of open, counted requests (level 1 and up) by category and region,
   for a workspace with a supplier profile. A group is shown only with at
   least k requests, from confirmed, un-suspended buyers other than the
   caller's own. A region thinner than k is folded into the category's
   "Worldwide" row if that reaches k; otherwise it is not shown at all. */
create or replace function public.exchange_market_demand(p_org uuid)
returns table (
  category_id  uuid,
  region       text,
  open_requests bigint,
  new_30d      bigint,
  hot          bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
#variable_conflict use_column
begin
  if p_org is null or not (p_org in (select public.user_org_ids())) then
    raise exception 'not a member of the requested organisation' using errcode = '42501';
  end if;
  if public.exchange_suspended(p_org)
     or not exists (select 1 from public.exchange_provider_profiles p where p.org_id = p_org and p.deleted_at is null) then
    return;
  end if;
  return query
  with base as (
    select n.category_id, public.exchange_region(n.country) as region, n.created_at, n.intent_band
      from public.exchange_needs n
      join auth.users u on u.id = n.created_by
     where n.status = 'open' and n.deleted_at is null and n.visibility >= 1
       and n.category_id is not null
       and u.email_confirmed_at is not null
       and n.org_id <> p_org
       and not public.exchange_suspended(n.org_id)
  ),
  by_region as (
    select b.category_id, coalesce(b.region, 'Worldwide') as region, count(*) as open_requests,
           count(*) filter (where b.created_at > now() - interval '30 days') as new_30d,
           count(*) filter (where b.intent_band = 'hot') as hot
      from base b group by 1, 2
  ),
  shown as (
    select * from by_region where open_requests >= public.exchange_demand_k()
  ),
  folded as (
    select r.category_id, 'Worldwide'::text as region, sum(r.open_requests)::bigint as open_requests,
           sum(r.new_30d)::bigint as new_30d, sum(r.hot)::bigint as hot
      from by_region r
     where r.open_requests < public.exchange_demand_k()
       and not exists (select 1 from shown s where s.category_id = r.category_id and s.region = 'Worldwide')
     group by r.category_id
    having sum(r.open_requests) >= public.exchange_demand_k()
  )
  select s.category_id, s.region, s.open_requests, s.new_30d, s.hot from shown s
  union all
  select f.category_id, f.region, f.open_requests, f.new_30d, f.hot from folded f
  order by 3 desc;
end
$$;

do $$
begin
  revoke all on public.exchange_reports from anon, authenticated;
  revoke all on public.exchange_suspensions from anon, authenticated;
  revoke all on function public.exchange_suspended(uuid) from public, anon, authenticated;
  revoke all on function public.exchange_refuse_suspended() from public, anon, authenticated;
  revoke all on function public.exchange_skip_suspended_notice() from public, anon, authenticated;
  revoke all on function public.exchange_need_limits() from public, anon, authenticated;
  revoke all on function public.exchange_report(text, uuid, text, text) from anon;
  revoke all on function public.exchange_my_reports(uuid) from anon;
  revoke all on function public.exchange_report_queue() from public, anon, authenticated;
  revoke all on function public.exchange_resolve_report(uuid, text, text) from public, anon, authenticated;
  revoke all on function public.exchange_lift_suspension(uuid) from public, anon, authenticated;
  revoke all on function public.exchange_my_suspension(uuid) from anon;
  revoke all on function public.exchange_demand_k() from public, anon, authenticated;
  revoke all on function public.exchange_market_demand(uuid) from anon;
exception when undefined_object then null;
end
$$;

create or replace function public.migration_0065_applied()
returns boolean
language sql
immutable
set search_path = public, pg_catalog
as $$ select true $$;

-- ── The card function, with suspensions applied (redefines 0062's) ──────────

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
    select n.id, n.category_id, n.country, public.exchange_region(n.country) as region
      from public.exchange_needs n
     where n.visibility >= 2 and n.status = 'open' and n.deleted_at is null
       and not public.exchange_suspended(n.org_id)
  ),
  cards as (
    select m.id as match_id, n.id as need_id, o.id as offering_id, o.title as offering_title,
           n.category_id, n.visibility as level, n.org_id as buyer_org,
           public.exchange_magnitude_band(n.quantity) as quantity_band,
           public.exchange_budget_band(n.budget_max, n.currency) as budget_band,
           case
             when n.country is null then null
             when (select count(*) from visible v
                    where v.category_id is not distinct from n.category_id and v.country = n.country)
                  >= public.exchange_card_k() then n.country
             when (select count(*) from visible v
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
      from public.exchange_matches m
      join public.exchange_needs n on n.id = m.need_id
      join public.exchange_offerings o on o.id = m.offering_id
     where m.provider_org_id = p_org
       and n.org_id <> p_org
       and n.visibility >= 2 and n.status = 'open' and n.deleted_at is null
       and not public.exchange_suspended(n.org_id)
       and o.deleted_at is null and o.status = 'active'
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
