-- 0063 — Exchange introductions, messages and outcomes (build plan DN-28,
-- DN-29, DN-30, DN-53; marketplace spec §8).
--
-- The intro lifecycle:
--
--   supplier asks (need at level 2+) ──► requested ──► buyer declines ──► declined
--                                            │                 (or nobody answers in 14 days ──► stale)
--                                       buyer accepts
--                                            ▼
--   buyer asks (their own choice) ──────► accepted ──► either side reports an outcome ──► closed
--                                            │
--                                no activity for 30 days ──► stale
--
-- Only the buyer accepts. A supplier's request reveals nothing about the
-- buyer; acceptance reveals the buyer's workspace name and the request in
-- full, and is written to the reveal log. Contact details are shared only
-- when the buyer presses "Share my contact details".
--
-- Sessions read these tables (both parties, nobody else) and write only
-- through the functions below, which hold every rule: who may act, in which
-- state, the supplier's weekly cap and decline-rate throttle (DN-86/87).

-- ── Introductions ───────────────────────────────────────────────────────────

create table if not exists public.exchange_intros (
  id                 uuid primary key default gen_random_uuid(),
  need_id            uuid not null references public.exchange_needs(id) on delete cascade,
  offering_id        uuid not null references public.exchange_offerings(id) on delete cascade,
  match_id           uuid references public.exchange_matches(id) on delete set null,
  buyer_org_id       uuid not null references public.organizations(id) on delete cascade,
  provider_org_id    uuid not null references public.organizations(id) on delete cascade,
  -- Who asked: the buyer (from a match) or the supplier (from a card).
  direction          text not null check (direction in ('buyer', 'provider')),
  state              text not null default 'requested'
                       check (state in ('requested', 'accepted', 'declined', 'withdrawn', 'closed', 'stale')),
  message            text check (message is null or length(message) <= 1000),
  requested_by       uuid references auth.users(id) on delete set null,
  decided_by         uuid references auth.users(id) on delete set null,
  decided_at         timestamptz,
  -- Shared by the buyer, by choice: {name, email}.
  contact            jsonb check (contact is null or jsonb_typeof(contact) = 'object'),
  contact_shared_at  timestamptz,
  -- The "Stated need" opportunity in the supplier's workspace (created by the engine on acceptance).
  opportunity_id     uuid references public.opportunities(id) on delete set null,
  last_activity_at   timestamptz not null default now(),
  buyer_read_at      timestamptz,
  provider_read_at   timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (buyer_org_id <> provider_org_id),
  check ((state in ('accepted', 'declined')) = (decided_at is not null) or state in ('closed', 'stale', 'withdrawn'))
);

comment on table public.exchange_intros is
  'An introduction between a buyer''s need and a supplier''s offering (0063, spec §8). Written only through functions.';

-- One live introduction per request and offering.
create unique index if not exists exchange_intros_one_live
  on public.exchange_intros (need_id, offering_id) where state in ('requested', 'accepted');
create index if not exists exchange_intros_need_fk_idx on public.exchange_intros (need_id);
create index if not exists exchange_intros_offering_fk_idx on public.exchange_intros (offering_id);
create index if not exists exchange_intros_match_fk_idx on public.exchange_intros (match_id);
create index if not exists exchange_intros_buyer_idx on public.exchange_intros (buyer_org_id, last_activity_at desc);
create index if not exists exchange_intros_provider_idx on public.exchange_intros (provider_org_id, last_activity_at desc);
create index if not exists exchange_intros_requested_by_fk_idx on public.exchange_intros (requested_by);
create index if not exists exchange_intros_decided_by_fk_idx on public.exchange_intros (decided_by);
create index if not exists exchange_intros_opportunity_fk_idx on public.exchange_intros (opportunity_id);

drop trigger if exists exchange_intros_touch on public.exchange_intros;
create trigger exchange_intros_touch before update on public.exchange_intros
  for each row execute function public.touch_updated_at();

alter table public.exchange_intros enable row level security;
drop policy if exists exchange_intros_read on public.exchange_intros;
create policy exchange_intros_read on public.exchange_intros
  for select using (
    buyer_org_id in (select public.user_org_ids()) or provider_org_id in (select public.user_org_ids())
  );

-- ── Messages ────────────────────────────────────────────────────────────────

create table if not exists public.exchange_messages (
  id              uuid primary key default gen_random_uuid(),
  intro_id        uuid not null references public.exchange_intros(id) on delete cascade,
  sender_org_id   uuid references public.organizations(id) on delete set null,
  sender_user_id  uuid references auth.users(id) on delete set null,
  sender_side     text not null check (sender_side in ('buyer', 'provider')),
  body            text not null check (length(body) between 1 and 4000),
  created_at      timestamptz not null default now()
);

comment on table public.exchange_messages is
  'Two-party messages inside an accepted introduction (0063). Never enriched, sequenced or synced.';

create index if not exists exchange_messages_intro_idx on public.exchange_messages (intro_id, created_at);
create index if not exists exchange_messages_sender_org_fk_idx on public.exchange_messages (sender_org_id);
create index if not exists exchange_messages_sender_user_fk_idx on public.exchange_messages (sender_user_id);

alter table public.exchange_messages enable row level security;
drop policy if exists exchange_messages_read on public.exchange_messages;
create policy exchange_messages_read on public.exchange_messages
  for select using (
    exists (
      select 1 from public.exchange_intros i
       where i.id = intro_id
         and (i.buyer_org_id in (select public.user_org_ids()) or i.provider_org_id in (select public.user_org_ids()))
    )
  );

-- ── Outcomes (both sides report; disagreements are kept) ────────────────────

create table if not exists public.exchange_outcomes (
  id           uuid primary key default gen_random_uuid(),
  intro_id     uuid not null references public.exchange_intros(id) on delete cascade,
  org_id       uuid not null references public.organizations(id) on delete cascade,
  side         text not null check (side in ('buyer', 'provider')),
  outcome      text not null check (outcome in ('won', 'lost', 'no_decision', 'not_a_fit')),
  reason       text check (reason is null or length(reason) <= 500),
  reported_by  uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (intro_id, side)
);

create index if not exists exchange_outcomes_org_fk_idx on public.exchange_outcomes (org_id);
create index if not exists exchange_outcomes_reported_by_fk_idx on public.exchange_outcomes (reported_by);

alter table public.exchange_outcomes enable row level security;
drop policy if exists exchange_outcomes_read on public.exchange_outcomes;
create policy exchange_outcomes_read on public.exchange_outcomes
  for select using (
    exists (
      select 1 from public.exchange_intros i
       where i.id = intro_id
         and (i.buyer_org_id in (select public.user_org_ids()) or i.provider_org_id in (select public.user_org_ids()))
    )
  );

-- ── Helpers ─────────────────────────────────────────────────────────────────

-- Which side the caller is on, as a member who may act ('buyer', 'provider'), or null.
create or replace function public.exchange_intro_side(p_intro public.exchange_intros)
returns text
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select case
    when public.has_org_role(p_intro.buyer_org_id, 'member') then 'buyer'
    when public.has_org_role(p_intro.provider_org_id, 'member') then 'provider'
  end
$$;

create or replace function public.exchange_audit_intro(p_intro public.exchange_intros, p_action text, p_meta jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  perform public.write_audit_log_internal(p_intro.buyer_org_id, p_action, 'exchange_intro', p_intro.id, p_meta);
  perform public.write_audit_log_internal(p_intro.provider_org_id, p_action, 'exchange_intro', p_intro.id, p_meta);
end
$$;

-- Supplier limits (DN-86, DN-87).
create or replace function public.exchange_intro_weekly_cap()
returns integer language sql immutable set search_path = public, pg_catalog as $$ select 20 $$;

-- ── Request ─────────────────────────────────────────────────────────────────

create or replace function public.exchange_request_intro(p_match uuid, p_message text default null)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
#variable_conflict use_column
declare
  v_match   public.exchange_matches;
  v_need    public.exchange_needs;
  v_offer   public.exchange_offerings;
  v_side    text;
  v_id      uuid;
  v_recent  integer;
  v_decided integer;
  v_declined integer;
  v_row     public.exchange_intros;
begin
  if p_message is not null and length(p_message) > 1000 then
    raise exception 'An introduction message is at most 1,000 characters.' using errcode = '22001';
  end if;

  select * into v_match from public.exchange_matches where id = p_match;
  if v_match.id is null then
    raise exception 'That match no longer exists.' using errcode = 'P0002';
  end if;
  select * into v_need from public.exchange_needs where id = v_match.need_id;
  select * into v_offer from public.exchange_offerings where id = v_match.offering_id;
  if v_need.deleted_at is not null or v_need.status <> 'open' or v_offer.deleted_at is not null or v_offer.org_id is null then
    raise exception 'This request or offering is no longer open.' using errcode = 'P0001';
  end if;

  if public.has_org_role(v_need.org_id, 'member') then
    v_side := 'buyer';
  elsif public.has_org_role(v_offer.org_id, 'member') then
    v_side := 'provider';
    if v_need.visibility < 2 then
      -- Do not confirm the request exists: the same answer as a match that does not.
      raise exception 'That match no longer exists.' using errcode = 'P0002';
    end if;
    select count(*) into v_recent from public.exchange_intros
     where provider_org_id = v_offer.org_id and direction = 'provider' and created_at > now() - interval '7 days';
    if v_recent >= public.exchange_intro_weekly_cap() then
      raise exception 'Your workspace has asked for % introductions this week, the most a week allows. The count resets as each request turns seven days old.', v_recent
        using errcode = 'P0001';
    end if;
    select count(*), count(*) filter (where state = 'declined') into v_decided, v_declined
      from public.exchange_intros
     where provider_org_id = v_offer.org_id and direction = 'provider'
       and decided_at > now() - interval '30 days';
    if v_decided >= 10 and v_declined::numeric / v_decided > 0.7 then
      raise exception 'Most of your recent introduction requests were declined, so new ones are paused for now. Buyers decline requests that do not fit what they asked for.'
        using errcode = 'P0001';
    end if;
  else
    raise exception 'not a member of the requested organisation, or read-only there' using errcode = '42501';
  end if;

  select id into v_id from public.exchange_intros
   where need_id = v_need.id and offering_id = v_offer.id and state in ('requested', 'accepted');
  if v_id is not null then
    return v_id;
  end if;

  insert into public.exchange_intros as i (
    need_id, offering_id, match_id, buyer_org_id, provider_org_id, direction, state, message,
    requested_by, decided_by, decided_at
  ) values (
    v_need.id, v_offer.id, v_match.id, v_need.org_id, v_offer.org_id, v_side,
    case when v_side = 'buyer' then 'accepted' else 'requested' end,
    nullif(trim(p_message), ''),
    auth.uid(),
    case when v_side = 'buyer' then auth.uid() end,
    case when v_side = 'buyer' then now() end
  )
  returning * into v_row;

  if v_side = 'buyer' then
    -- The buyer chose to introduce themselves: that is the reveal.
    insert into public.exchange_reveal_log (need_id, org_id, viewer_org_id, viewer_name, level, what)
    values (v_need.id, v_need.org_id, v_offer.org_id,
            (select p.name from public.exchange_provider_profiles p where p.id = v_offer.provider_id),
            greatest(v_need.visibility, 1), 'intro')
    on conflict (need_id, viewer_org_id, what, day) do update set views = exchange_reveal_log.views + 1, last_seen_at = now();
  end if;

  perform public.exchange_audit_intro(v_row, 'exchange.intro_requested', jsonb_build_object('direction', v_side, 'state', v_row.state));
  return v_row.id;
end
$$;

-- ── Decide (the buyer only) ─────────────────────────────────────────────────

create or replace function public.exchange_decide_intro(p_intro uuid, p_accept boolean)
returns text
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_row  public.exchange_intros;
  v_need public.exchange_needs;
begin
  select * into v_row from public.exchange_intros where id = p_intro for update;
  if v_row.id is null or not public.has_org_role(v_row.buyer_org_id, 'member') then
    raise exception 'Only the buyer can accept or decline an introduction.' using errcode = '42501';
  end if;
  if v_row.state <> 'requested' then
    raise exception 'This introduction is already %.', v_row.state using errcode = 'P0001';
  end if;

  update public.exchange_intros
     set state = case when p_accept then 'accepted' else 'declined' end,
         decided_by = auth.uid(), decided_at = now(), last_activity_at = now()
   where id = p_intro
   returning * into v_row;

  if p_accept then
    select * into v_need from public.exchange_needs where id = v_row.need_id;
    insert into public.exchange_reveal_log (need_id, org_id, viewer_org_id, viewer_name, level, what)
    values (v_row.need_id, v_row.buyer_org_id, v_row.provider_org_id,
            (select p.name from public.exchange_provider_profiles p
               join public.exchange_offerings o on o.provider_id = p.id where o.id = v_row.offering_id),
            greatest(v_need.visibility, 1), 'intro')
    on conflict (need_id, viewer_org_id, what, day) do update set views = exchange_reveal_log.views + 1, last_seen_at = now();
  end if;

  perform public.exchange_audit_intro(v_row, 'exchange.intro_' || v_row.state, '{}'::jsonb);
  return v_row.state;
end
$$;

-- ── Withdraw (the side that asked, while it is still a request) ─────────────

create or replace function public.exchange_withdraw_intro(p_intro uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_row public.exchange_intros;
begin
  select * into v_row from public.exchange_intros where id = p_intro for update;
  if v_row.id is null or public.exchange_intro_side(v_row) is distinct from v_row.direction then
    raise exception 'Only the side that asked can withdraw a request.' using errcode = '42501';
  end if;
  if v_row.state <> 'requested' then
    raise exception 'Only a pending request can be withdrawn; this one is %.', v_row.state using errcode = 'P0001';
  end if;
  update public.exchange_intros set state = 'withdrawn', last_activity_at = now() where id = p_intro returning * into v_row;
  perform public.exchange_audit_intro(v_row, 'exchange.intro_withdrawn', '{}'::jsonb);
end
$$;

-- ── Messages and read state ─────────────────────────────────────────────────

create or replace function public.exchange_send_message(p_intro uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_row  public.exchange_intros;
  v_side text;
  v_id   uuid;
begin
  if p_body is null or length(trim(p_body)) = 0 or length(p_body) > 4000 then
    raise exception 'A message is between 1 and 4,000 characters.' using errcode = '22001';
  end if;
  select * into v_row from public.exchange_intros where id = p_intro;
  v_side := case when v_row.id is null then null else public.exchange_intro_side(v_row) end;
  if v_side is null then
    raise exception 'not a party to this introduction' using errcode = '42501';
  end if;
  if v_row.state <> 'accepted' then
    raise exception 'Messages open once the buyer accepts, and close when an outcome is reported; this introduction is %.', v_row.state
      using errcode = 'P0001';
  end if;
  insert into public.exchange_messages (intro_id, sender_org_id, sender_user_id, sender_side, body)
  values (p_intro,
          case when v_side = 'buyer' then v_row.buyer_org_id else v_row.provider_org_id end,
          auth.uid(), v_side, trim(p_body))
  returning id into v_id;
  update public.exchange_intros
     set last_activity_at = now(),
         buyer_read_at = case when v_side = 'buyer' then now() else buyer_read_at end,
         provider_read_at = case when v_side = 'provider' then now() else provider_read_at end
   where id = p_intro;
  return v_id;
end
$$;

create or replace function public.exchange_mark_intro_read(p_intro uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_row public.exchange_intros;
begin
  select * into v_row from public.exchange_intros where id = p_intro;
  if v_row.id is null then return; end if;
  if v_row.buyer_org_id in (select public.user_org_ids()) then
    update public.exchange_intros set buyer_read_at = now() where id = p_intro;
  end if;
  if v_row.provider_org_id in (select public.user_org_ids()) then
    update public.exchange_intros set provider_read_at = now() where id = p_intro;
  end if;
end
$$;

-- ── Contact details (the buyer's choice, never automatic) ───────────────────

create or replace function public.exchange_share_contact(p_intro uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_row public.exchange_intros;
  v_name text;
  v_email text;
begin
  select * into v_row from public.exchange_intros where id = p_intro for update;
  if v_row.id is null or not public.has_org_role(v_row.buyer_org_id, 'member') then
    raise exception 'Only the buyer can share their contact details.' using errcode = '42501';
  end if;
  if v_row.state <> 'accepted' then
    raise exception 'Contact details can be shared only in an accepted introduction.' using errcode = 'P0001';
  end if;
  select p.full_name, p.email into v_name, v_email from public.profiles p where p.id = auth.uid();
  update public.exchange_intros
     set contact = jsonb_build_object('name', v_name, 'email', v_email),
         contact_shared_at = now(), last_activity_at = now()
   where id = p_intro
   returning * into v_row;
  perform public.exchange_audit_intro(v_row, 'exchange.contact_shared', '{}'::jsonb);
end
$$;

-- ── Outcomes ────────────────────────────────────────────────────────────────

create or replace function public.exchange_report_outcome(p_intro uuid, p_outcome text, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_row  public.exchange_intros;
  v_side text;
  v_kind text;
begin
  if p_outcome not in ('won', 'lost', 'no_decision', 'not_a_fit') then
    raise exception 'Unknown outcome %', p_outcome using errcode = '22023';
  end if;
  select * into v_row from public.exchange_intros where id = p_intro for update;
  v_side := case when v_row.id is null then null else public.exchange_intro_side(v_row) end;
  if v_side is null then
    raise exception 'not a party to this introduction' using errcode = '42501';
  end if;
  if v_row.state not in ('accepted', 'closed', 'stale') then
    raise exception 'An outcome can be reported only after an introduction was accepted.' using errcode = 'P0001';
  end if;

  insert into public.exchange_outcomes (intro_id, org_id, side, outcome, reason, reported_by)
  values (p_intro,
          case when v_side = 'buyer' then v_row.buyer_org_id else v_row.provider_org_id end,
          v_side, p_outcome, nullif(trim(coalesce(p_reason, '')), ''), auth.uid())
  on conflict (intro_id, side) do update
    set outcome = excluded.outcome, reason = excluded.reason, reported_by = excluded.reported_by, updated_at = now();

  update public.exchange_intros set state = 'closed', last_activity_at = now() where id = p_intro returning * into v_row;

  -- The supplier's report also feeds its own learning loop (spec §8).
  v_kind := case p_outcome when 'won' then 'won' when 'lost' then 'lost' when 'not_a_fit' then 'disqualified' end;
  if v_side = 'provider' and v_kind is not null and v_row.opportunity_id is not null then
    insert into public.outcomes (org_id, opportunity_id, kind, reason, recorded_by)
    values (v_row.provider_org_id, v_row.opportunity_id, v_kind, nullif(trim(coalesce(p_reason, '')), ''), auth.uid());
  end if;

  perform public.exchange_audit_intro(v_row, 'exchange.outcome_reported', jsonb_build_object('side', v_side, 'outcome', p_outcome));
end
$$;

-- ── What each side may see of an introduction ───────────────────────────────
-- The buyer's identity and the request in full only once accepted. Before
-- that, the supplier sees the same bands a card shows.

create or replace function public.exchange_intro_list(p_org uuid)
returns table (
  id               uuid,
  side             text,
  direction        text,
  state            text,
  need_id          uuid,
  offering_title   text,
  provider_name    text,
  buyer_name       text,
  need_summary     text,
  category_id      uuid,
  message          text,
  unread           boolean,
  last_activity_at timestamptz,
  created_at       timestamptz
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
  select i.id,
         case when i.buyer_org_id = p_org then 'buyer' else 'provider' end,
         i.direction, i.state, i.need_id,
         o.title,
         (select p.name from public.exchange_provider_profiles p where p.id = o.provider_id),
         case when i.buyer_org_id = p_org or i.state in ('accepted', 'closed', 'stale')
              then (select g.name from public.organizations g where g.id = i.buyer_org_id) end,
         case when i.buyer_org_id = p_org or i.state in ('accepted', 'closed', 'stale') or n.visibility >= 3
              then n.summary end,
         n.category_id,
         i.message,
         case when i.buyer_org_id = p_org then coalesce(i.buyer_read_at, '-infinity') < i.last_activity_at
              else coalesce(i.provider_read_at, '-infinity') < i.last_activity_at end,
         i.last_activity_at, i.created_at
    from public.exchange_intros i
    join public.exchange_needs n on n.id = i.need_id
    join public.exchange_offerings o on o.id = i.offering_id
   where i.buyer_org_id = p_org or i.provider_org_id = p_org
   order by i.last_activity_at desc
   limit 500;
end
$$;

create or replace function public.exchange_intro_detail(p_intro uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_row    public.exchange_intros;
  v_need   public.exchange_needs;
  v_offer  public.exchange_offerings;
  v_buyer  boolean;
  v_open   boolean;
begin
  select * into v_row from public.exchange_intros where id = p_intro;
  if v_row.id is null then return null; end if;
  if v_row.buyer_org_id in (select public.user_org_ids()) then
    v_buyer := true;
  elsif v_row.provider_org_id in (select public.user_org_ids()) then
    v_buyer := false;
  else
    return null;
  end if;
  select * into v_need from public.exchange_needs where id = v_row.need_id;
  select * into v_offer from public.exchange_offerings where id = v_row.offering_id;
  v_open := v_buyer or v_row.state in ('accepted', 'closed', 'stale');

  return jsonb_build_object(
    'id', v_row.id,
    'side', case when v_buyer then 'buyer' else 'provider' end,
    'direction', v_row.direction,
    'state', v_row.state,
    'message', v_row.message,
    'createdAt', v_row.created_at,
    'decidedAt', v_row.decided_at,
    'lastActivityAt', v_row.last_activity_at,
    'opportunityId', case when v_buyer then null else v_row.opportunity_id end,
    'contact', case when v_open then v_row.contact end,
    'contactSharedAt', v_row.contact_shared_at,
    'buyerName', case when v_open then (select g.name from public.organizations g where g.id = v_row.buyer_org_id) end,
    'providerName', (select p.name from public.exchange_provider_profiles p where p.id = v_offer.provider_id),
    'offering', jsonb_build_object('id', v_offer.id, 'title', v_offer.title, 'description', v_offer.description),
    'need', jsonb_build_object(
      'id', v_need.id,
      'categoryId', v_need.category_id,
      'summary', case when v_open or v_need.visibility >= 3 then v_need.summary end,
      'requirement', case when v_open then v_need.requirement end,
      'quantity', case when v_open then v_need.quantity end,
      'unit', case when v_open then v_need.unit end,
      'budgetMax', case when v_open then v_need.budget_max end,
      'currency', case when v_open then v_need.currency end,
      'country', case when v_open then v_need.country end,
      'deliverTo', case when v_open then v_need.deliver_to end,
      'timeline', v_need.timeline,
      'quantityBand', public.exchange_magnitude_band(v_need.quantity),
      'budgetBand', public.exchange_budget_band(v_need.budget_max, v_need.currency)
    ),
    'outcomes', coalesce((
      select jsonb_agg(jsonb_build_object('side', x.side, 'outcome', x.outcome, 'reason', x.reason, 'at', x.updated_at) order by x.side)
        from public.exchange_outcomes x where x.intro_id = v_row.id), '[]'::jsonb)
  );
end
$$;

-- ── Expiry (DN-53): unanswered requests, quiet introductions, lapsed needs ──

create or replace function public.exchange_expire()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_requested int;
  v_quiet int;
  v_needs int;
begin
  update public.exchange_intros set state = 'stale'
   where state = 'requested' and created_at < now() - interval '14 days';
  get diagnostics v_requested = row_count;
  update public.exchange_intros set state = 'stale'
   where state = 'accepted' and last_activity_at < now() - interval '30 days';
  get diagnostics v_quiet = row_count;
  -- A need past its decide-by date by 14 days, and not re-confirmed since, has lapsed.
  update public.exchange_needs set status = 'expired'
   where status = 'open' and deleted_at is null and decide_by is not null
     and decide_by + 14 < current_date and last_confirmed_at::date < decide_by;
  get diagnostics v_needs = row_count;
  return jsonb_build_object('requests_stale', v_requested, 'intros_stale', v_quiet, 'needs_expired', v_needs);
end
$$;

do $$
begin
  revoke all on public.exchange_intros from anon;
  revoke all on public.exchange_messages from anon;
  revoke all on public.exchange_outcomes from anon;
  revoke all on function public.exchange_intro_side(public.exchange_intros) from public, anon, authenticated;
  revoke all on function public.exchange_audit_intro(public.exchange_intros, text, jsonb) from public, anon, authenticated;
  revoke all on function public.exchange_request_intro(uuid, text) from anon;
  revoke all on function public.exchange_decide_intro(uuid, boolean) from anon;
  revoke all on function public.exchange_withdraw_intro(uuid) from anon;
  revoke all on function public.exchange_send_message(uuid, text) from anon;
  revoke all on function public.exchange_mark_intro_read(uuid) from anon;
  revoke all on function public.exchange_share_contact(uuid) from anon;
  revoke all on function public.exchange_report_outcome(uuid, text, text) from anon;
  revoke all on function public.exchange_intro_list(uuid) from anon;
  revoke all on function public.exchange_intro_detail(uuid) from anon;
  revoke all on function public.exchange_expire() from public, anon, authenticated;
exception when undefined_object then null;
end
$$;

create or replace function public.migration_0063_applied()
returns boolean
language sql
immutable
set search_path = public, pg_catalog
as $$ select true $$;
