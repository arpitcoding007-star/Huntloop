-- 0062 — Exchange, the rest of Phase 2 (build plan DN-26, DN-33, DN-40, DN-41, DN-51).
--
--   · Intent on needs (DN-51): named dimensions and a band, computed in code
--     from what the buyer confirmed. Null band when too little is known.
--   · Offering evidence (DN-26): public proof behind an offering — an
--     authorised-partner page, a price list. A fact must cite a source.
--   · The anonymous card (marketplace spec §5): the only way a supplier reads a
--     buyer's request. Level 2 and above only, no free text below level 3,
--     place widened until at least k = 10 open cards share it, and every card
--     shown is written to the reveal log the buyer reads (DN-33).
--   · Recall (DN-41): full-text vectors on offerings and needs, and a
--     service-only function that ranks a category's offerings against a need's
--     words before scoring. `simple` configuration: the Exchange is global and
--     stemming English would favour English listings.
--   · Retention (DN-40): removed requests, finished or abandoned questionnaire
--     transcripts, and old reveal-log rows are deleted on a schedule.

-- ── Intent (DN-51) ──────────────────────────────────────────────────────────

alter table public.exchange_needs
  add column if not exists intent_dimensions jsonb not null default '{}'::jsonb
    check (jsonb_typeof(intent_dimensions) = 'object'),
  add column if not exists intent_band text
    check (intent_band is null or intent_band in ('hot', 'warm', 'cool'));

-- ── Offering evidence (DN-26) ───────────────────────────────────────────────

create table if not exists public.exchange_offering_evidence (
  id            uuid primary key default gen_random_uuid(),
  offering_id   uuid not null references public.exchange_offerings(id) on delete cascade,
  -- Follows the offering (trigger below), whatever was sent.
  org_id        uuid references public.organizations(id) on delete cascade,
  kind          text not null default 'fact' check (kind in ('fact', 'inference', 'unknown')),
  claim         text not null check (length(claim) between 1 and 500),
  source_url    text check (source_url is null or (source_url ~ '^https?://' and length(source_url) <= 2048)),
  source_title  text check (source_title is null or length(source_title) <= 200),
  observed_at   timestamptz not null default now(),
  created_by    uuid references auth.users(id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now(),
  -- A fact is something a page says; with no page it is a claim, not a fact.
  check (kind <> 'fact' or source_url is not null)
);

comment on table public.exchange_offering_evidence is
  'Public proof behind an Exchange offering (0062). A fact cites its source.';

create or replace function public.exchange_evidence_follows_offering()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  select o.org_id into new.org_id from public.exchange_offerings o where o.id = new.offering_id;
  return new;
end
$$;

drop trigger if exists exchange_offering_evidence_follows on public.exchange_offering_evidence;
create trigger exchange_offering_evidence_follows
  before insert or update on public.exchange_offering_evidence
  for each row execute function public.exchange_evidence_follows_offering();

drop trigger if exists exchange_offering_evidence_same_org on public.exchange_offering_evidence;
create trigger exchange_offering_evidence_same_org
  before insert or update on public.exchange_offering_evidence
  for each row execute function public.enforce_same_org_refs('offering_id', 'exchange_offerings');

alter table public.exchange_offering_evidence enable row level security;
drop policy if exists exchange_offering_evidence_read on public.exchange_offering_evidence;
create policy exchange_offering_evidence_read on public.exchange_offering_evidence
  for select using (
    org_id in (select public.user_org_ids())
    or exists (
      select 1 from public.exchange_offerings o
       where o.id = offering_id and o.status = 'active' and o.deleted_at is null
    )
  );
drop policy if exists exchange_offering_evidence_insert on public.exchange_offering_evidence;
create policy exchange_offering_evidence_insert on public.exchange_offering_evidence
  for insert with check (org_id is not null and public.has_org_role(org_id, 'member'));
drop policy if exists exchange_offering_evidence_delete on public.exchange_offering_evidence;
create policy exchange_offering_evidence_delete on public.exchange_offering_evidence
  for delete using (org_id is not null and public.has_org_role(org_id, 'member'));

create index if not exists exchange_offering_evidence_offering_idx on public.exchange_offering_evidence (offering_id);
create index if not exists exchange_offering_evidence_org_fk_idx on public.exchange_offering_evidence (org_id);
create index if not exists exchange_offering_evidence_created_by_fk_idx on public.exchange_offering_evidence (created_by);

-- ── Reveal log (DN-33) ──────────────────────────────────────────────────────
-- One row per need × viewing workspace × kind × day, with a view count, so the
-- buyer can read who has seen what without a row per page load.

create table if not exists public.exchange_reveal_log (
  id             uuid primary key default gen_random_uuid(),
  need_id        uuid not null references public.exchange_needs(id) on delete cascade,
  -- The buyer's workspace: the reader of this log.
  org_id         uuid not null references public.organizations(id) on delete cascade,
  viewer_org_id  uuid references public.organizations(id) on delete set null,
  -- The supplier's public profile name when it looked; null if it had none.
  viewer_name    text,
  level          smallint not null check (level between 1 and 3),
  what           text not null default 'card' check (what in ('card', 'intro')),
  day            date not null default current_date,
  views          integer not null default 1 check (views > 0),
  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  unique (need_id, viewer_org_id, what, day)
);

comment on table public.exchange_reveal_log is
  'Every time a supplier was shown a buyer''s request, and at which level (0062, spec §5).';

alter table public.exchange_reveal_log enable row level security;
drop policy if exists exchange_reveal_log_read on public.exchange_reveal_log;
create policy exchange_reveal_log_read on public.exchange_reveal_log
  for select using (org_id in (select public.user_org_ids()));
-- No write policy: rows are written only by `exchange_matched_cards`.

create index if not exists exchange_reveal_log_org_idx on public.exchange_reveal_log (org_id, last_seen_at desc);
create index if not exists exchange_reveal_log_viewer_fk_idx on public.exchange_reveal_log (viewer_org_id);

-- ── Bands: what a card shows instead of the exact value ─────────────────────
-- Mirrored in apps/web/lib/exchange/card.ts for the visibility preview; the
-- tests on both sides pin the same examples.

create or replace function public.exchange_region(p_country text)
returns text
language sql
immutable
set search_path = public, pg_catalog
as $$
  select case
    when p_country is null then null
    when p_country in ('AT','BE','BG','CH','CZ','DE','DK','ES','FI','FR','GB','GR','HU','IE','IT','NL','NO','PL','PT','RO','RS','SE','UA') then 'Europe'
    when p_country in ('US','CA') then 'North America'
    when p_country in ('AR','BR','CL','CO','MX','PE') then 'Latin America'
    when p_country in ('AE','EG','IL','KE','MA','NG','QA','SA','TR','ZA') then 'Middle East & Africa'
    when p_country in ('BD','IN','LK','PK') then 'South Asia'
    when p_country in ('CN','HK','JP','KR','TW') then 'East Asia'
    when p_country in ('ID','MY','PH','SG','TH','VN') then 'Southeast Asia'
    when p_country in ('AU','NZ') then 'Oceania'
    else 'Elsewhere'
  end
$$;

create or replace function public.exchange_compact(p numeric)
returns text
language sql
immutable
set search_path = public, pg_catalog
as $$
  select case
    when p >= 1e9 then trim(to_char(p / 1e9, 'FM999990')) || 'B'
    when p >= 1e6 then trim(to_char(p / 1e6, 'FM999990')) || 'M'
    when p >= 1e3 then trim(to_char(p / 1e3, 'FM999990')) || 'K'
    else trim(to_char(p, 'FM999990'))
  end
$$;

-- An order of magnitude: 200 → '100–1K'; 6,000,000 EUR → 'EUR 1M–10M'.
create or replace function public.exchange_magnitude_band(p numeric)
returns text
language sql
immutable
set search_path = public, pg_catalog
as $$
  select case
    when p is null or p <= 0 then null
    when p < 10 then '1–10'
    else public.exchange_compact(power(10, floor(log(p)))::numeric)
         || '–' || public.exchange_compact(power(10, floor(log(p)) + 1)::numeric)
  end
$$;

create or replace function public.exchange_budget_band(p_amount numeric, p_currency text)
returns text
language sql
immutable
set search_path = public, pg_catalog
as $$
  select case
    when p_amount is null or p_currency is null then null
    else p_currency || ' ' || public.exchange_magnitude_band(p_amount)
  end
$$;

-- ── The anonymous card (spec §5) ────────────────────────────────────────────

-- k: how many open, card-visible requests must share a place before it is shown.
create or replace function public.exchange_card_k()
returns integer
language sql
immutable
set search_path = public, pg_catalog
as $$ select 10 $$;

/* What a supplier workspace may see of the requests it was matched to.
   Level 2: category, quantity and budget bands, place (widened to k), timeline.
   Level 3: the same, plus the buyer's own words (summary, must-haves, unit).
   Never: the buyer's name, workspace, contact, exact amounts.
   Each card returned is logged for the buyer. */
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
       and o.deleted_at is null
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

-- ── Recall (DN-41) ──────────────────────────────────────────────────────────

alter table public.exchange_offerings
  add column if not exists search tsvector
    generated always as (to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(description, ''))) stored;
alter table public.exchange_needs
  add column if not exists search tsvector
    generated always as (to_tsvector('simple', coalesce(summary, ''))) stored;

create index if not exists exchange_offerings_search_idx on public.exchange_offerings using gin (search);
create index if not exists exchange_needs_search_idx on public.exchange_needs using gin (search);

/* A category's active offerings, best text match to the need first. Any word
   in common counts (OR), so a need is never left with no candidates because
   it was worded differently; ties fall back to the most recently updated. */
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
   order by case when need.words is null then 0
                 else ts_rank(o.search, to_tsquery('simple', need.words)) end desc,
            o.updated_at desc
   limit greatest(1, least(coalesce(p_limit, 500), 1000))
$$;

-- ── Retention (DN-40) ───────────────────────────────────────────────────────

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

do $$
begin
  revoke all on public.exchange_offering_evidence from anon;
  revoke all on public.exchange_reveal_log from anon;
  revoke all on function public.exchange_evidence_follows_offering() from public, anon, authenticated;
  revoke all on function public.exchange_matched_cards(uuid) from anon;
  revoke all on function public.exchange_recall_offerings(uuid, integer) from public, anon, authenticated;
  revoke all on function public.exchange_prune() from public, anon, authenticated;
exception when undefined_object then null;
end
$$;

-- A probe for `db:doctor` (see 0031).
create or replace function public.migration_0062_applied()
returns boolean
language sql
immutable
set search_path = public, pg_catalog
as $$ select true $$;
