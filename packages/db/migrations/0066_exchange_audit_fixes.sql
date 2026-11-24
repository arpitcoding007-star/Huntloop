-- 0066 — Exchange audit fixes: company firewall, introduction privacy,
-- declared intent, and paused offerings.
--
--   · Firewall: `companies.origin`. 0059 covered people and opportunities, so
--     the company behind an Exchange opportunity was still enriched,
--     researched and signal-fetched. A company with an Exchange opportunity is
--     itself Exchange, permanently; jobs that would read a vendor or a model
--     about it cannot be queued, and their writes are refused. Every cold
--     sequence at it stops, on any of its opportunities, and none can start.
--   · Introductions: suppliers read them through functions only. The table
--     holds `buyer_org_id`, `need_id` and `decided_by`, which RLS cannot hide
--     by column. An introduction nobody accepted reveals nothing, also after
--     it goes stale or is closed by the operator.
--   · Intent: `intent_band`, `intent_dimensions` and `last_confirmed_at` on a
--     request are derived here from what the buyer stated. A session that
--     writes them is refused.
--   · Paused offerings cannot be asked about (0065 hides their cards).
--   · `exchange_matches.explained` keeps the model's judgement and a key of
--     what it read, so an unchanged match is not paid for twice.
--   · Engine-only functions guard themselves, and `engine_only_exposed()`
--     tells `db:doctor` when a session role can execute one.

-- ── 1. The company side of the firewall ─────────────────────────────────────

alter table public.companies
  add column if not exists origin text not null default 'engine';

do $$
begin
  alter table public.companies
    add constraint companies_origin_check check (origin in ('engine', 'import', 'exchange'));
exception when duplicate_object then null;
end
$$;

comment on column public.companies.origin is
  'exchange = a company behind an accepted Exchange introduction: never '
  'enriched, researched or signal-fetched (0066 firewall). Permanent.';

create index if not exists companies_exchange_origin_idx
  on public.companies (org_id) where origin = 'exchange';

drop trigger if exists companies_origin_permanent on public.companies;
create trigger companies_origin_permanent
  before update of origin on public.companies
  for each row execute function public.exchange_origin_is_permanent();

-- An Exchange opportunity makes its company Exchange.
create or replace function public.firewall_mark_exchange_company()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if new.origin = 'exchange' then
    update public.companies set origin = 'exchange'
     where id = new.company_id and origin <> 'exchange';
  end if;
  return new;
end
$$;

drop trigger if exists opportunities_mark_exchange_company on public.opportunities;
create trigger opportunities_mark_exchange_company
  after insert or update of origin, company_id on public.opportunities
  for each row execute function public.firewall_mark_exchange_company();

/* A cold sequence can run on another opportunity of the same company: one per
   targeting profile. Meeting through the Exchange ends all of them, whatever
   state they wait in, and withdraws the mail they had queued. A reply a person
   wrote has no sequence above it, so it is left alone. */
create or replace function public.firewall_stop_sequences(p_company uuid, p_opportunity uuid default null)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_ids uuid[];
begin
  with stopped as (
    update public.enrollments e
       set status = 'stopped',
           parked_reason = 'You met this company through the Exchange, so it is never put in a sequence.',
           next_action_at = null,
           updated_at = now()
      from public.opportunities o
     where o.id = e.opportunity_id
       and o.company_id = p_company
       and (p_opportunity is null or o.id = p_opportunity)
       and e.status in ('active', 'parked', 'paused')
    returning e.id
  )
  select array_agg(id) into v_ids from stopped;

  update public.messages m
     set scheduled_at = null,
         error = 'Not sent: you met this company through the Exchange.'
   where m.enrollment_id = any (v_ids)
     and m.direction = 'outbound'
     and m.sent_at is null
     and m.send_attempted_at is null
     and m.deleted_at is null;
end
$$;

create or replace function public.firewall_company_became_exchange()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  perform public.firewall_stop_sequences(new.id);
  return new;
end
$$;

drop trigger if exists companies_became_exchange on public.companies;
create trigger companies_became_exchange
  after update of origin on public.companies
  for each row
  when (new.origin = 'exchange' and old.origin <> 'exchange')
  execute function public.firewall_company_became_exchange();

-- A merge moves opportunities to the surviving company, with their sequences.
create or replace function public.firewall_opportunity_moved()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if exists (select 1 from public.companies c where c.id = new.company_id and c.origin = 'exchange') then
    perform public.firewall_stop_sequences(new.company_id, new.id);
  end if;
  return new;
end
$$;

drop trigger if exists opportunities_moved_to_exchange on public.opportunities;
create trigger opportunities_moved_to_exchange
  after update of company_id on public.opportunities
  for each row
  when (new.company_id is distinct from old.company_id)
  execute function public.firewall_opportunity_moved();

-- And none starts or resumes afterwards: 0059 asked the opportunity only.
create or replace function public.firewall_refuse_exchange_enrollment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if (tg_op = 'INSERT' or new.opportunity_id is distinct from old.opportunity_id or new.status = 'active')
     and exists (
       select 1 from public.opportunities o
         left join public.companies c on c.id = o.company_id
        where o.id = new.opportunity_id and (o.origin = 'exchange' or c.origin = 'exchange')
     ) then
    raise exception 'A company met through the Exchange cannot be put in a sequence (firewall, 0059).'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

drop trigger if exists enrollments_firewall on public.enrollments;
create trigger enrollments_firewall
  before insert or update of opportunity_id, status on public.enrollments
  for each row execute function public.firewall_refuse_exchange_enrollment();

update public.companies c set origin = 'exchange'
 where c.origin <> 'exchange'
   and exists (select 1 from public.opportunities o where o.company_id = c.id and o.origin = 'exchange');

/* The jobs' own markers. Each is written only when a vendor, a model or the
   company's job board was read, so refusing it refuses the job's result. */
create or replace function public.firewall_refuse_exchange_company()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if new.origin = 'exchange' and (
       (new.last_enriched_at is not null and (tg_op = 'INSERT' or new.last_enriched_at is distinct from old.last_enriched_at))
    or (new.last_researched_at is not null and (tg_op = 'INSERT' or new.last_researched_at is distinct from old.last_researched_at))
    or (new.last_signal_checked_at is not null and (tg_op = 'INSERT' or new.last_signal_checked_at is distinct from old.last_signal_checked_at))
    or (new.research_asked_at is not null and (tg_op = 'INSERT' or new.research_asked_at is distinct from old.research_asked_at))
  ) then
    raise exception 'A company met through the Exchange cannot be enriched or researched (firewall, 0066).'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

drop trigger if exists companies_firewall on public.companies;
create trigger companies_firewall
  before insert or update on public.companies
  for each row execute function public.firewall_refuse_exchange_company();

create or replace function public.firewall_refuse_exchange_enrichment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if new.entity_type = 'person' and exists (
    select 1 from public.people p
     where p.id = new.entity_id and p.origin = 'exchange'
  ) then
    raise exception 'An Exchange person cannot be enriched (firewall, 0059).'
      using errcode = 'check_violation';
  end if;
  if new.entity_type = 'company' and exists (
    select 1 from public.companies c
     where c.id = new.entity_id and c.origin = 'exchange'
  ) then
    raise exception 'An Exchange company cannot be enriched (firewall, 0066).'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

/* The queue refuses quietly: a job about an Exchange company is not an error,
   it is work that must not exist. `enqueue()` reports it as not created. */
create or replace function public.firewall_drop_exchange_company_job()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if exists (
    select 1 from public.companies c
     where c.org_id = new.org_id
       and c.id::text = new.payload ->> 'companyId'
       and c.origin = 'exchange'
  ) then
    return null;
  end if;
  return new;
end
$$;

drop trigger if exists job_executions_firewall on public.job_executions;
create trigger job_executions_firewall
  before insert on public.job_executions
  for each row
  when (new.job_name in ('enrich_company', 'research_company', 'fetch_company_signals', 'profile_company'))
  execute function public.firewall_drop_exchange_company_job();

-- ── 2. Introductions: the buyer reads the table, the supplier the functions ──

drop policy if exists exchange_intros_read on public.exchange_intros;
create policy exchange_intros_read on public.exchange_intros
  for select using (buyer_org_id in (select public.user_org_ids()));

/* Whether the caller's workspace is a party to an introduction that was
   accepted. The messages and outcomes policies ask this instead of joining
   the table, which a supplier can no longer read. */
create or replace function public.exchange_is_intro_party(p_intro uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1 from public.exchange_intros i
     where i.id = p_intro and i.decided_at is not null and i.state <> 'declined'
       and (i.buyer_org_id in (select public.user_org_ids())
            or i.provider_org_id in (select public.user_org_ids()))
  )
$$;

drop policy if exists exchange_messages_read on public.exchange_messages;
create policy exchange_messages_read on public.exchange_messages
  for select using (public.exchange_is_intro_party(intro_id));

drop policy if exists exchange_outcomes_read on public.exchange_outcomes;
create policy exchange_outcomes_read on public.exchange_outcomes
  for select using (public.exchange_is_intro_party(intro_id));

-- "Accepted" is `decided_at` set on an introduction that was not declined.
-- 'stale' and 'closed' alone do not mean it: a request nobody answered in 14
-- days goes stale too, and used to reveal the buyer when it did.

-- The result gains `match_id`: a supplier's card finds its introduction by the
-- match it already holds, now that `need_id` is withheld.
drop function if exists public.exchange_intro_list(uuid);
create or replace function public.exchange_intro_list(p_org uuid)
returns table (
  id               uuid,
  match_id         uuid,
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
  select i.id, i.match_id,
         case when i.buyer_org_id = p_org then 'buyer' else 'provider' end,
         i.direction, i.state,
         case when i.buyer_org_id = p_org or (i.decided_at is not null and i.state in ('accepted', 'closed', 'stale')) then i.need_id end,
         o.title,
         (select p.name from public.exchange_provider_profiles p where p.id = o.provider_id),
         case when i.buyer_org_id = p_org or (i.decided_at is not null and i.state in ('accepted', 'closed', 'stale'))
              then (select g.name from public.organizations g where g.id = i.buyer_org_id) end,
         case when i.buyer_org_id = p_org or (i.decided_at is not null and i.state in ('accepted', 'closed', 'stale')) or n.visibility >= 3
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
  v_open := v_buyer or (v_row.decided_at is not null and v_row.state in ('accepted', 'closed', 'stale'));

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
      'id', case when v_open then v_need.id end,
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
  if v_row.decided_at is null or v_row.state not in ('accepted', 'closed', 'stale') then
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

-- A paused or draft offering cannot be asked about, by either side.

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
  if v_need.deleted_at is not null or v_need.status <> 'open' or v_offer.deleted_at is not null
     or v_offer.status <> 'active' or v_offer.org_id is null then
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

-- ── 3. Declared intent is derived, never written by a session ───────────────

/* DN-51, the one place it is computed. Named dimensions from what the buyer
   confirmed: specificity (share of the category's required fields answered),
   budget (100 when stated with a currency), timeline. Null is UNKNOWN, and
   the band needs two measured dimensions. */
create or replace function public.exchange_score_intent(
  p_category uuid,
  p_requirement jsonb,
  p_budget_max numeric,
  p_currency text,
  p_timeline text,
  out dimensions jsonb,
  out band text
)
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_attrs jsonb;
  v_parent jsonb;
  v_required int;
  v_answered int;
  v_specificity int;
  v_budget int;
  v_timeline int;
  v_measured int;
  v_mean numeric;
begin
  select c.attributes, p.attributes into v_attrs, v_parent
    from public.exchange_categories c
    left join public.exchange_categories p on p.id = c.parent_id
   where c.id = p_category;
  -- A leaf with no usable attributes inherits its parent's.
  if not exists (
    select 1 from jsonb_array_elements(coalesce(v_attrs, '[]'::jsonb)) a
     where jsonb_typeof(a -> 'key') = 'string' and jsonb_typeof(a -> 'label') = 'string'
  ) then
    v_attrs := v_parent;
  end if;
  select count(*),
         count(*) filter (where coalesce(p_requirement -> (a ->> 'key') ->> 'value', '') <> '')
    into v_required, v_answered
    from jsonb_array_elements(coalesce(v_attrs, '[]'::jsonb)) a
   where jsonb_typeof(a -> 'key') = 'string' and jsonb_typeof(a -> 'label') = 'string'
     and a -> 'required' = 'true'::jsonb;

  v_specificity := case when v_required > 0 then round(v_answered * 100.0 / v_required)::int end;
  v_budget := case when p_budget_max is not null and p_currency is not null then 100 end;
  v_timeline := case p_timeline when 'this_month' then 100 when 'this_quarter' then 70
                                when 'later' then 30 when 'exploring' then 10 end;

  dimensions := jsonb_build_object('specificity', v_specificity, 'budget', v_budget, 'timeline', v_timeline);
  select count(x), avg(x) into v_measured, v_mean from unnest(array[v_specificity, v_budget, v_timeline]) x;
  band := case when v_measured < 2 then null
               when v_mean >= 75 then 'hot' when v_mean >= 50 then 'warm' else 'cool' end;
end
$$;

/* A session states a request; it does not grade it, date its confirmation, or
   backdate it past the daily limit (0065). The engine (no session) is exempt. */
create or replace function public.exchange_need_declared()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.intent_band is not null or new.intent_dimensions <> '{}'::jsonb then
      raise exception 'Intent is computed from the request, not written with it.' using errcode = '42501';
    end if;
    new.created_by := auth.uid();
    new.created_at := now();
    new.last_confirmed_at := now();
  else
    if new.intent_band is distinct from old.intent_band
       or new.intent_dimensions is distinct from old.intent_dimensions then
      raise exception 'Intent is computed from the request, not written with it.' using errcode = '42501';
    end if;
    if new.last_confirmed_at is distinct from old.last_confirmed_at
       and coalesce(current_setting('huntloop.exchange_confirm', true), '') <> 'on' then
      raise exception 'A request is confirmed with Still needed, not by writing the date.' using errcode = '42501';
    end if;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    -- Reopening is a confirmation.
    if new.status = 'open' and old.status <> 'open' then
      new.last_confirmed_at := now();
    end if;
    if new.category_id is not distinct from old.category_id
       and new.requirement is not distinct from old.requirement
       and new.budget_max is not distinct from old.budget_max
       and new.currency is not distinct from old.currency
       and new.timeline is not distinct from old.timeline then
      return new;
    end if;
  end if;
  select s.dimensions, s.band into new.intent_dimensions, new.intent_band
    from public.exchange_score_intent(new.category_id, new.requirement, new.budget_max, new.currency, new.timeline) s;
  return new;
end
$$;

drop trigger if exists exchange_needs_declared on public.exchange_needs;
create trigger exchange_needs_declared before insert or update on public.exchange_needs
  for each row execute function public.exchange_need_declared();

/* "Still needed" (DN-63): the one way a person dates a confirmation. */
create or replace function public.exchange_confirm_need(p_need uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_org uuid;
  v_n int;
begin
  select n.org_id into v_org from public.exchange_needs n where n.id = p_need and n.deleted_at is null;
  if v_org is null or not public.has_org_role(v_org, 'member') then
    raise exception 'not a member of the requested organisation, or read-only there' using errcode = '42501';
  end if;
  perform set_config('huntloop.exchange_confirm', 'on', true);
  update public.exchange_needs set status = 'open', last_confirmed_at = now()
   where id = p_need and status in ('open', 'paused', 'expired');
  get diagnostics v_n = row_count;
  perform set_config('huntloop.exchange_confirm', '', true);
  return v_n > 0;
end
$$;

-- ── 4. The model's judgement, kept with what it read ────────────────────────

alter table public.exchange_matches
  add column if not exists explained jsonb
    check (explained is null or jsonb_typeof(explained) = 'object');

comment on column public.exchange_matches.explained is
  'explain_match''s answer for this candidate and a key of everything it read '
  '(0066). Same key, same answer: the model is not asked again.';

-- ── 5. Engine-only functions guard themselves ───────────────────────────────

create or replace function public.exchange_prune()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_needs int;
  v_sessions int;
  v_reveals int;
begin
  if auth.uid() is not null then
    raise exception 'This runs in the engine, not in a session.' using errcode = '42501';
  end if;
  -- A removed request is kept 30 days (an undo window and the audit trail), then deleted with its matches.
  delete from public.exchange_needs where deleted_at is not null and deleted_at < now() - interval '30 days';
  get diagnostics v_needs = row_count;
  -- Questionnaire transcripts: finished ones after 90 days, abandoned drafts after 30.
  delete from public.exchange_intake_sessions
   where (status <> 'active' and updated_at < now() - interval '90 days')
      or (status = 'active' and updated_at < now() - interval '30 days');
  get diagnostics v_sessions = row_count;
  delete from public.exchange_reveal_log where last_seen_at < now() - interval '365 days';
  get diagnostics v_reveals = row_count;
  return jsonb_build_object('needs', v_needs, 'intake_sessions', v_sessions, 'reveal_log', v_reveals);
end
$$;

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
  if auth.uid() is not null then
    raise exception 'This runs in the engine, not in a session.' using errcode = '42501';
  end if;
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

/* Every function only the engine (or another definer function) may run that
   a session role can execute. `db:doctor` fails on any row. */
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
       'write_audit_log_internal', 'increment_usage_internal', 'check_quota_internal',
       'claim_job_executions', 'prune_job_executions', 'requeue_stalled_jobs',
       'reserve_provider_credit', 'settle_provider_credit',
       'claim_contact_lane', 'release_contact_lane', 'due_sends_fair',
       'claim_due_discovery_queries')
     and has_function_privilege(r.oid, p.oid, 'execute')
$$;

-- Supabase grants new functions to anon and authenticated by default, so each
-- revoke names them, not only public.
do $$
declare
  v_fn text;
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated')
     or not exists (select 1 from pg_roles where rolname = 'anon') then
    return;
  end if;
  for v_fn in
    select p.oid::regprocedure::text from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in (
         'exchange_prune', 'exchange_expire', 'exchange_recall_offerings',
         'exchange_queue_notifications', 'exchange_prune_notifications', 'exchange_need_recipients',
         'exchange_intro_side', 'exchange_audit_intro', 'exchange_report_queue',
         'exchange_resolve_report', 'exchange_lift_suspension', 'exchange_suspended',
         'exchange_demand_k', 'exchange_score_intent', 'engine_only_exposed',
         'exchange_need_declared', 'firewall_mark_exchange_company',
         'firewall_stop_sequences', 'firewall_company_became_exchange',
         'firewall_opportunity_moved', 'firewall_refuse_exchange_enrollment',
         'firewall_refuse_exchange_company', 'firewall_refuse_exchange_enrichment',
         'firewall_drop_exchange_company_job')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', v_fn);
  end loop;
  revoke all on function public.exchange_intro_list(uuid) from public, anon;
  grant execute on function public.exchange_intro_list(uuid) to authenticated;
  revoke all on function public.exchange_confirm_need(uuid) from public, anon;
  grant execute on function public.exchange_confirm_need(uuid) to authenticated;
  revoke all on function public.exchange_is_intro_party(uuid) from public, anon;
  grant execute on function public.exchange_is_intro_party(uuid) to authenticated;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.engine_only_exposed() to service_role;
    grant execute on function public.exchange_prune() to service_role;
    grant execute on function public.exchange_expire() to service_role;
    grant execute on function public.exchange_suspended(uuid) to service_role;
    grant execute on function public.exchange_recall_offerings(uuid, integer) to service_role;
    grant execute on function public.exchange_queue_notifications() to service_role;
    grant execute on function public.exchange_prune_notifications() to service_role;
  end if;
end
$$;

create or replace function public.migration_0066_applied()
returns boolean
language sql
immutable
set search_path = public, pg_catalog
as $$ select true $$;
