-- 0064 — Exchange alerts and notifications (build plan DN-36, DN-52, DN-53,
-- DN-77, DN-78, DN-81; spec §5 "Should providers be notified proactively?").
--
--   · Preferences (DN-36) live on `notification_preferences`, per person per
--     workspace: supplier alerts off / digest / instant, which categories, a
--     switch for introduction and message emails, and quiet hours. Default is
--     the digest, never instant.
--   · `exchange_notifications` is one row per person per event. It is the
--     in-app feed (read/unread) and the email ledger (sent or not) in one, and
--     its unique `dedupe_key` is what makes queueing safe to run every tick.
--   · `exchange_queue_notifications()` (service only) turns what happened —
--     new matches, introduction requests and decisions, messages, requests
--     due a re-confirm — into rows. It writes the wording itself, from the
--     same bands a card shows, so an alert can never say more about a buyer
--     than the card would: no place, no exact amounts, no buyer words below
--     level 3, no name before acceptance.
--   · Instant alerts are only for HOT requests (EX-9) and only for people who
--     chose instant; everything else waits for the digest.

-- ── Preferences ─────────────────────────────────────────────────────────────

alter table public.notification_preferences
  add column if not exists exchange_alerts text not null default 'digest'
    check (exchange_alerts in ('off', 'digest', 'instant')),
  -- Empty means every category this workspace offers in.
  add column if not exists exchange_alert_category_ids uuid[] not null default '{}',
  -- Introduction requests and decisions, new messages, re-confirm reminders.
  add column if not exists exchange_emails boolean not null default true,
  add column if not exists quiet_start_hour smallint check (quiet_start_hour is null or quiet_start_hour between 0 and 23),
  add column if not exists quiet_end_hour smallint check (quiet_end_hour is null or quiet_end_hour between 0 and 23),
  add column if not exists last_exchange_digest_on date;

-- ── The feed and the email ledger ───────────────────────────────────────────

create table if not exists public.exchange_notifications (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  user_id        uuid not null references auth.users(id) on delete cascade,
  kind           text not null check (kind in
                   ('match_alert', 'intro_requested', 'intro_accepted', 'intro_declined', 'new_message', 'reconfirm')),
  need_id        uuid references public.exchange_needs(id) on delete cascade,
  intro_id       uuid references public.exchange_intros(id) on delete cascade,
  match_id       uuid references public.exchange_matches(id) on delete cascade,
  title          text not null check (length(title) between 1 and 300),
  body           text check (body is null or length(body) <= 600),
  -- A path inside the app, e.g. /acme/exchange/intros/<id>.
  href           text not null check (href ~ '^/'),
  -- instant: emailed now (quiet hours and the daily cap permitting); digest:
  -- in the next Exchange digest; none: in-app only.
  channel        text not null check (channel in ('instant', 'digest', 'none')),
  -- Hot need (EX-9), for the instant rule and the digest's order.
  hot            boolean not null default false,
  dedupe_key     text not null unique,
  email_sent_at  timestamptz,
  read_at        timestamptz,
  created_at     timestamptz not null default now()
);

comment on table public.exchange_notifications is
  'Exchange alerts and updates, one row per person per event (0064): the in-app feed and the email ledger.';

create index if not exists exchange_notifications_user_idx on public.exchange_notifications (user_id, created_at desc);
create index if not exists exchange_notifications_org_fk_idx on public.exchange_notifications (org_id);
create index if not exists exchange_notifications_need_fk_idx on public.exchange_notifications (need_id);
create index if not exists exchange_notifications_intro_fk_idx on public.exchange_notifications (intro_id);
create index if not exists exchange_notifications_match_fk_idx on public.exchange_notifications (match_id);
create index if not exists exchange_notifications_unsent_idx
  on public.exchange_notifications (channel, created_at) where email_sent_at is null;

alter table public.exchange_notifications enable row level security;
drop policy if exists exchange_notifications_own on public.exchange_notifications;
create policy exchange_notifications_own on public.exchange_notifications
  for select using (user_id = auth.uid() and org_id in (select public.user_org_ids()));
-- No write policy: rows come from the engine; read state through the function below.

create or replace function public.exchange_mark_notifications_read(p_org uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_count integer;
begin
  update public.exchange_notifications
     set read_at = now()
   where user_id = auth.uid() and org_id = p_org and read_at is null
     and p_org in (select public.user_org_ids());
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

-- ── Queueing ────────────────────────────────────────────────────────────────

/* Who on the buyer's side hears about a request: the person who filed it,
   while they are still a member; otherwise the workspace's owners. */
create or replace function public.exchange_need_recipients(p_need public.exchange_needs)
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select m.user_id
    from public.memberships m
   where m.org_id = p_need.org_id and m.deleted_at is null
     and (
       m.user_id = p_need.created_by
       or (m.role = 'owner' and not exists (
             select 1 from public.memberships c
              where c.org_id = p_need.org_id and c.user_id = p_need.created_by and c.deleted_at is null))
     )
$$;

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
         n.intent_band = 'hot',
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

-- Old feed rows are not kept forever: read ones after 90 days, any after a year.
create or replace function public.exchange_prune_notifications()
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v int;
begin
  if auth.uid() is not null then
    raise exception 'This runs in the engine, not in a session.' using errcode = '42501';
  end if;
  delete from public.exchange_notifications
   where (read_at is not null and read_at < now() - interval '90 days')
      or created_at < now() - interval '365 days';
  get diagnostics v = row_count;
  return v;
end
$$;

do $$
begin
  revoke all on public.exchange_notifications from anon;
  revoke all on function public.exchange_mark_notifications_read(uuid) from anon;
  revoke all on function public.exchange_need_recipients(public.exchange_needs) from public, anon, authenticated;
  revoke all on function public.exchange_queue_notifications() from public, anon, authenticated;
  revoke all on function public.exchange_prune_notifications() from public, anon, authenticated;
exception when undefined_object then null;
end
$$;

create or replace function public.migration_0064_applied()
returns boolean
language sql
immutable
set search_path = public, pg_catalog
as $$ select true $$;
