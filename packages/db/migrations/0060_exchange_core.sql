-- ============================================================================
-- 0060 — Exchange core: categories, needs, providers, offerings, matches,
--        intake sessions (build plan DN-21 to DN-27, DN-22)
--
-- docs/product/marketplace-spec.md §7, with the decisions taken on
-- 2026-11-23: every category and every region from the start, matching
-- switched on per category once it has supply.
--
--   · Universal. Categories are rows, not code. A need may have no category
--     yet ("describe what you need"); it is still saved and counted.
--   · Global. Money is stored with its own ISO 4217 currency, places with
--     ISO 3166-1 alpha-2 country codes. Nothing assumes one market.
--   · Gated matching. `exchange_categories.matching_enabled` decides whether
--     needs in a category are matched and providers alerted. Off by default:
--     a category with no supply tells the buyer so instead of matching them
--     to nothing.
--   · Buyers are ordinary workspaces (EX-6, recommended option A): a person
--     uses a personal workspace (`workspace_kind = 'personal'`, 0044) or their
--     company's. So every tenant table here has an `org_id` and the usual
--     `user_org_ids()` boundary.
--
-- The firewall (0059, spec §6) holds by construction:
--   · `exchange_needs` and `exchange_intake_sessions` are readable only by the
--     buyer's own workspace. No policy lets a provider read them; providers
--     will see needs only through security-definer functions that apply the
--     visibility level (spec §5), added with the matched-needs screen.
--   · `exchange_matches` is readable by the buyer's workspace only, for the
--     same reason. Scores are written by the engine, never by a session.
--
-- Nothing in the app reads or writes these tables yet. The Exchange UI ships
-- behind a flag in a later change.
-- ============================================================================

-- ── Categories (global, read-only to sessions) ──────────────────────────────
create table if not exists public.exchange_categories (
  id                uuid primary key default gen_random_uuid(),
  slug              text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  parent_id         uuid references public.exchange_categories(id) on delete restrict,
  name              text not null check (length(name) between 1 and 120),
  description       text,
  -- What is traded here: goods, services, or both. Drives which questions
  -- the intake asks (quantity and delivery for goods, scope and start date
  -- for services).
  kind              text not null default 'both' check (kind in ('goods', 'services', 'both')),
  -- The attributes a need or offering in this category can state:
  -- [{ "key": "quantity", "label": "Quantity", "type": "number", "required": true }, …].
  -- A leaf with none inherits its parent's.
  attributes        jsonb not null default '[]'::jsonb check (jsonb_typeof(attributes) = 'array'),
  -- Needs extra care: verified buyers only, no anonymous cards (EX-10).
  regulated         boolean not null default false,
  -- Off until the category has enough active providers to match against.
  matching_enabled  boolean not null default false,
  active            boolean not null default true,
  sort              smallint not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (parent_id is null or parent_id <> id)
);

comment on table public.exchange_categories is
  'Exchange taxonomy (0060). Global, no org_id: data, edited by the platform, '
  'read by every signed-in session. matching_enabled gates matching per category.';

create index if not exists exchange_categories_parent_idx
  on public.exchange_categories (parent_id, sort);

alter table public.exchange_categories enable row level security;
drop policy if exists exchange_categories_read on public.exchange_categories;
create policy exchange_categories_read on public.exchange_categories
  for select using (active);

drop trigger if exists exchange_categories_touch on public.exchange_categories;
create trigger exchange_categories_touch before update on public.exchange_categories
  for each row execute function public.touch_updated_at();

-- ── Needs (buyer side, declared data) ───────────────────────────────────────
create table if not exists public.exchange_needs (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations(id) on delete cascade,
  created_by         uuid references auth.users(id) on delete set null default auth.uid(),
  -- buy: I need a product or service. partner: I want a business partner.
  kind               text not null default 'buy' check (kind in ('buy', 'partner')),
  -- Null while uncategorised: "describe what you need" is saved as stated.
  category_id        uuid references public.exchange_categories(id) on delete set null,
  summary            text not null check (length(summary) between 1 and 500),
  -- The full structured requirement, every field carrying
  -- { "value": …, "kind": "fact" | "inference" | "unknown" }.
  requirement        jsonb not null default '{}'::jsonb check (jsonb_typeof(requirement) = 'object'),
  quantity           numeric check (quantity is null or quantity > 0),
  unit               text check (unit is null or length(unit) <= 40),
  budget_min         numeric check (budget_min is null or budget_min >= 0),
  budget_max         numeric check (budget_max is null or budget_max >= 0),
  currency           text check (currency is null or currency ~ '^[A-Z]{3}$'),
  country            text check (country is null or country ~ '^[A-Z]{2}$'),
  region             text check (region is null or length(region) <= 120),
  deliver_to         text check (deliver_to is null or length(deliver_to) <= 200),
  decide_by          date,
  -- The buyer's own answer to "when do you want to decide?".
  timeline           text check (timeline is null or timeline in
                       ('this_month', 'this_quarter', 'later', 'exploring')),
  -- A guess read from the wording. An inference, stored apart from anything
  -- the buyer said, and never shown as their answer (spec §3 rule 1).
  urgency_inferred   text check (urgency_inferred is null or urgency_inferred in ('high', 'medium', 'low')),
  -- Spec §5. 0 private · 1 counted (default) · 2 anonymous card · 3 open to intros.
  visibility         smallint not null default 1 check (visibility between 0 and 3),
  status             text not null default 'open' check (status in
                       ('draft', 'open', 'paused', 'fulfilled', 'expired', 'withdrawn')),
  last_confirmed_at  timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  check (budget_min is null or budget_max is null or budget_min <= budget_max),
  -- An amount without a currency is not an amount.
  check ((budget_min is null and budget_max is null) or currency is not null)
);

comment on table public.exchange_needs is
  'What a buyer said they need (0060). Declared data: readable only by the '
  'buyer''s own workspace, never enriched or sequenced (0059 firewall).';

create index if not exists exchange_needs_org_idx
  on public.exchange_needs (org_id, created_at desc) where deleted_at is null;
create index if not exists exchange_needs_open_idx
  on public.exchange_needs (category_id, country) where status = 'open' and deleted_at is null;

alter table public.exchange_needs enable row level security;
drop policy if exists exchange_needs_read on public.exchange_needs;
create policy exchange_needs_read on public.exchange_needs
  for select using (org_id in (select public.user_org_ids()));
drop policy if exists exchange_needs_insert on public.exchange_needs;
create policy exchange_needs_insert on public.exchange_needs
  for insert with check (public.has_org_role(org_id, 'member'));
drop policy if exists exchange_needs_update on public.exchange_needs;
create policy exchange_needs_update on public.exchange_needs
  for update using (public.has_org_role(org_id, 'member'))
  with check (public.has_org_role(org_id, 'member'));

drop trigger if exists exchange_needs_touch on public.exchange_needs;
create trigger exchange_needs_touch before update on public.exchange_needs
  for each row execute function public.touch_updated_at();

-- ── Provider profiles (the public catalogue) ────────────────────────────────
create table if not exists public.exchange_provider_profiles (
  id            uuid primary key default gen_random_uuid(),
  -- Null while unclaimed (EX-3): a listing built from public sources.
  org_id        uuid references public.organizations(id) on delete set null,
  kind          text not null default 'company' check (kind in ('company', 'individual')),
  name          text not null check (length(name) between 1 and 200),
  -- Lower-case, no scheme. Null for an individual with no business domain (EX-7).
  domain        text check (domain is null or domain ~ '^[a-z0-9.-]+\.[a-z]{2,}$'),
  description   text,
  country       text check (country is null or country ~ '^[A-Z]{2}$'),
  source        text not null default 'claimed' check (source in ('claimed', 'public')),
  claimed_at    timestamptz,
  -- Set by the platform only (domain verification, SEC-302), never by a session.
  verified_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  check ((org_id is null) = (claimed_at is null))
);

create unique index if not exists exchange_provider_profiles_domain_key
  on public.exchange_provider_profiles (domain) where domain is not null and deleted_at is null;
create index if not exists exchange_provider_profiles_org_idx
  on public.exchange_provider_profiles (org_id) where org_id is not null;

alter table public.exchange_provider_profiles enable row level security;
drop policy if exists exchange_provider_profiles_read on public.exchange_provider_profiles;
create policy exchange_provider_profiles_read on public.exchange_provider_profiles
  for select using (deleted_at is null);
drop policy if exists exchange_provider_profiles_insert on public.exchange_provider_profiles;
create policy exchange_provider_profiles_insert on public.exchange_provider_profiles
  for insert with check (org_id is not null and public.has_org_role(org_id, 'admin'));
drop policy if exists exchange_provider_profiles_update on public.exchange_provider_profiles;
create policy exchange_provider_profiles_update on public.exchange_provider_profiles
  for update using (org_id is not null and public.has_org_role(org_id, 'admin'))
  with check (org_id is not null and public.has_org_role(org_id, 'admin'));

/* A session may describe its profile but not vouch for it. */
create or replace function public.exchange_profile_verification_is_platform_only()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if auth.uid() is not null then
    if tg_op = 'INSERT' and new.verified_at is not null then
      raise exception 'A provider profile is verified by the platform, not by its owner.'
        using errcode = 'insufficient_privilege';
    end if;
    if tg_op = 'UPDATE' and new.verified_at is distinct from old.verified_at then
      raise exception 'A provider profile is verified by the platform, not by its owner.'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists exchange_provider_profiles_verification on public.exchange_provider_profiles;
create trigger exchange_provider_profiles_verification
  before insert or update on public.exchange_provider_profiles
  for each row execute function public.exchange_profile_verification_is_platform_only();

drop trigger if exists exchange_provider_profiles_touch on public.exchange_provider_profiles;
create trigger exchange_provider_profiles_touch before update on public.exchange_provider_profiles
  for each row execute function public.touch_updated_at();

-- ── Offerings (provider side) ───────────────────────────────────────────────
create table if not exists public.exchange_offerings (
  id                  uuid primary key default gen_random_uuid(),
  provider_id         uuid not null references public.exchange_provider_profiles(id) on delete cascade,
  -- Copied from the provider by trigger, so RLS can use it. Null while unclaimed.
  org_id              uuid references public.organizations(id) on delete cascade,
  category_id         uuid references public.exchange_categories(id) on delete set null,
  title               text not null check (length(title) between 1 and 200),
  description         text,
  attributes          jsonb not null default '{}'::jsonb check (jsonb_typeof(attributes) = 'object'),
  price_model         text check (price_model is null or price_model in
                        ('fixed', 'range', 'quote', 'subscription', 'hourly')),
  price_from          numeric check (price_from is null or price_from >= 0),
  price_to            numeric check (price_to is null or price_to >= 0),
  currency            text check (currency is null or currency ~ '^[A-Z]{3}$'),
  moq                 numeric check (moq is null or moq > 0),
  capacity            text check (capacity is null or length(capacity) <= 200),
  -- Stated by the provider, with the date it was true. UNKNOWN when absent.
  availability        text check (availability is null or availability in
                        ('in_stock', 'made_to_order', 'available', 'limited', 'unavailable')),
  availability_as_of  timestamptz,
  serves_global       boolean not null default false,
  serves_countries    text[] not null default '{}'
                        check (array_position(serves_countries, null) is null),
  product_id          uuid references public.products(id) on delete set null,
  status              text not null default 'draft' check (status in ('draft', 'active', 'paused')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,
  check (price_from is null or price_to is null or price_from <= price_to),
  check ((price_from is null and price_to is null) or currency is not null),
  -- An availability claim without a date reads as current forever.
  check (availability is null or availability_as_of is not null)
);

create index if not exists exchange_offerings_match_idx
  on public.exchange_offerings (category_id) where status = 'active' and deleted_at is null;
create index if not exists exchange_offerings_provider_idx
  on public.exchange_offerings (provider_id);
create index if not exists exchange_offerings_org_idx
  on public.exchange_offerings (org_id) where org_id is not null;

/* org_id follows the provider, and a linked product must be the same org's. */
create or replace function public.exchange_offering_follows_provider()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_org uuid;
begin
  select p.org_id into v_org from public.exchange_provider_profiles p where p.id = new.provider_id;
  new.org_id := v_org;
  if new.product_id is not null and not exists (
    select 1 from public.products pr where pr.id = new.product_id and pr.org_id = v_org
  ) then
    raise exception 'exchange_offerings.product_id refers to a record in another workspace'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

drop trigger if exists exchange_offerings_follow_provider on public.exchange_offerings;
create trigger exchange_offerings_follow_provider
  before insert or update of provider_id, product_id, org_id on public.exchange_offerings
  for each row execute function public.exchange_offering_follows_provider();

alter table public.exchange_offerings enable row level security;
drop policy if exists exchange_offerings_read on public.exchange_offerings;
create policy exchange_offerings_read on public.exchange_offerings
  for select using (
    (status = 'active' and deleted_at is null)
    or org_id in (select public.user_org_ids())
  );
drop policy if exists exchange_offerings_insert on public.exchange_offerings;
create policy exchange_offerings_insert on public.exchange_offerings
  for insert with check (
    exists (
      select 1 from public.exchange_provider_profiles p
       where p.id = provider_id and p.org_id is not null and public.has_org_role(p.org_id, 'member')
    )
  );
drop policy if exists exchange_offerings_update on public.exchange_offerings;
create policy exchange_offerings_update on public.exchange_offerings
  for update using (org_id is not null and public.has_org_role(org_id, 'member'))
  with check (org_id is not null and public.has_org_role(org_id, 'member'));

drop trigger if exists exchange_offerings_touch on public.exchange_offerings;
create trigger exchange_offerings_touch before update on public.exchange_offerings
  for each row execute function public.touch_updated_at();

-- ── Matches (engine-written, buyer-read) ────────────────────────────────────
create table if not exists public.exchange_matches (
  id              uuid primary key default gen_random_uuid(),
  need_id         uuid not null references public.exchange_needs(id) on delete cascade,
  offering_id     uuid not null references public.exchange_offerings(id) on delete cascade,
  -- The buyer's workspace (copied from the need) and the provider's.
  org_id          uuid not null references public.organizations(id) on delete cascade,
  provider_org_id uuid references public.organizations(id) on delete set null,
  -- Null when too little is known to score; never a made-up zero.
  score           smallint check (score is null or score between 0 and 100),
  -- Named dimensions (spec §9), each null when unmeasured.
  dimensions      jsonb not null default '{}'::jsonb check (jsonb_typeof(dimensions) = 'object'),
  explanation     text,
  cited           jsonb not null default '[]'::jsonb check (jsonb_typeof(cited) = 'array'),
  computed_at     timestamptz not null default now(),
  buyer_state     text not null default 'new' check (buyer_state in ('new', 'shortlisted', 'dismissed')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (need_id, offering_id)
);

create index if not exists exchange_matches_org_idx
  on public.exchange_matches (org_id, need_id, score desc nulls last);
create index if not exists exchange_matches_offering_idx
  on public.exchange_matches (offering_id);

/* Matches are written by the engine. A session may only move buyer_state. And
   nobody is ever matched to themselves: a workspace's own offering is not a
   supplier for its own need. */
create or replace function public.exchange_match_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if tg_op = 'INSERT' or new.need_id is distinct from old.need_id or new.offering_id is distinct from old.offering_id then
    select n.org_id into new.org_id from public.exchange_needs n where n.id = new.need_id;
    select o.org_id into new.provider_org_id from public.exchange_offerings o where o.id = new.offering_id;
    if new.provider_org_id is not null and new.provider_org_id = new.org_id then
      raise exception 'A workspace is never matched to its own offering.'
        using errcode = 'check_violation';
    end if;
  end if;
  if auth.uid() is not null then
    if tg_op = 'INSERT' then
      raise exception 'Matches are computed by the engine, not written by a session.'
        using errcode = 'insufficient_privilege';
    end if;
    if new.score is distinct from old.score
       or new.dimensions is distinct from old.dimensions
       or new.explanation is distinct from old.explanation
       or new.cited is distinct from old.cited
       or new.need_id is distinct from old.need_id
       or new.offering_id is distinct from old.offering_id then
      raise exception 'A session may only shortlist or dismiss a match.'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists exchange_matches_guard on public.exchange_matches;
create trigger exchange_matches_guard
  before insert or update on public.exchange_matches
  for each row execute function public.exchange_match_guard();

alter table public.exchange_matches enable row level security;
drop policy if exists exchange_matches_read on public.exchange_matches;
create policy exchange_matches_read on public.exchange_matches
  for select using (org_id in (select public.user_org_ids()));

/* No write policy at all. A match joins a buyer's need to another workspace's
   offering on purpose, so the same-workspace guard (0047) cannot apply to it;
   instead no session writes the table. The one thing a buyer may change — the
   shortlist — goes through this function. */
create or replace function public.exchange_set_match_state(p_match uuid, p_state text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_org uuid;
begin
  if p_state not in ('new', 'shortlisted', 'dismissed') then
    raise exception 'Unknown match state %', p_state using errcode = '22023';
  end if;
  select m.org_id into v_org from public.exchange_matches m where m.id = p_match;
  if v_org is null or not public.has_org_role(v_org, 'member') then
    raise exception 'not a member of the requested organisation, or read-only there'
      using errcode = '42501';
  end if;
  -- The guard trigger still sees the session, and allows a change to
  -- buyer_state alone.
  update public.exchange_matches set buyer_state = p_state where id = p_match;
  return true;
end
$$;

drop trigger if exists exchange_matches_touch on public.exchange_matches;
create trigger exchange_matches_touch before update on public.exchange_matches
  for each row execute function public.touch_updated_at();

-- ── Intake sessions (the questionnaire's draft) ─────────────────────────────
create table if not exists public.exchange_intake_sessions (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade default auth.uid(),
  direction    text not null check (direction in ('buy', 'sell', 'partner')),
  category_id  uuid references public.exchange_categories(id) on delete set null,
  requirement  jsonb not null default '{}'::jsonb check (jsonb_typeof(requirement) = 'object'),
  -- [{ "role": "assistant" | "user", "content": "…", "at": "…" }, …]
  transcript   jsonb not null default '[]'::jsonb check (jsonb_typeof(transcript) = 'array'),
  turns        smallint not null default 0 check (turns between 0 and 50),
  status       text not null default 'active' check (status in ('active', 'completed', 'abandoned')),
  need_id      uuid references public.exchange_needs(id) on delete set null,
  offering_id  uuid references public.exchange_offerings(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists exchange_intake_sessions_user_idx
  on public.exchange_intake_sessions (user_id, updated_at desc);

alter table public.exchange_intake_sessions enable row level security;
drop policy if exists exchange_intake_sessions_own on public.exchange_intake_sessions;
create policy exchange_intake_sessions_own on public.exchange_intake_sessions
  for all
  using (user_id = auth.uid() and org_id in (select public.user_org_ids()))
  with check (user_id = auth.uid() and public.has_org_role(org_id, 'member'));

drop trigger if exists exchange_intake_sessions_touch on public.exchange_intake_sessions;
create trigger exchange_intake_sessions_touch before update on public.exchange_intake_sessions
  for each row execute function public.touch_updated_at();

-- ── Same-workspace references (0047's guard) ───────────────────────────────
-- An offering's provider and product, and an intake session's need and
-- offering, are always in the session's own workspace. An unclaimed
-- provider (org_id null) passes, as the guard intends for a missing org.
-- The offering's org_id is set from its provider first: triggers fire in name
-- order, and exchange_offerings_follow_provider sorts before _same_org.
drop trigger if exists exchange_offerings_same_org on public.exchange_offerings;
create trigger exchange_offerings_same_org
  before insert or update on public.exchange_offerings
  for each row execute function public.enforce_same_org_refs(
    'provider_id', 'exchange_provider_profiles', 'product_id', 'products');

drop trigger if exists exchange_intake_sessions_same_org on public.exchange_intake_sessions;
create trigger exchange_intake_sessions_same_org
  before insert or update on public.exchange_intake_sessions
  for each row execute function public.enforce_same_org_refs(
    'need_id', 'exchange_needs', 'offering_id', 'exchange_offerings');

-- ── Foreign-key indexes (the 0054 ratchet: no new FK lands unindexed) ───────
create index if not exists exchange_needs_created_by_fk_idx      on public.exchange_needs (created_by);
create index if not exists exchange_offerings_product_fk_idx     on public.exchange_offerings (product_id);
create index if not exists exchange_matches_provider_org_fk_idx  on public.exchange_matches (provider_org_id);
create index if not exists exchange_intake_sessions_org_fk_idx   on public.exchange_intake_sessions (org_id);
create index if not exists exchange_intake_sessions_category_fk_idx on public.exchange_intake_sessions (category_id);
create index if not exists exchange_intake_sessions_need_fk_idx  on public.exchange_intake_sessions (need_id);
create index if not exists exchange_intake_sessions_offering_fk_idx on public.exchange_intake_sessions (offering_id);

-- ── Grants ──────────────────────────────────────────────────────────────────
do $$
begin
  revoke all on public.exchange_categories from anon;
  revoke all on public.exchange_needs from anon;
  revoke all on public.exchange_provider_profiles from anon;
  revoke all on public.exchange_offerings from anon;
  revoke all on public.exchange_matches from anon;
  revoke all on public.exchange_intake_sessions from anon;
  revoke all on function public.exchange_offering_follows_provider() from public, anon, authenticated;
  revoke all on function public.exchange_match_guard() from public, anon, authenticated;
  revoke all on function public.exchange_set_match_state(uuid, text) from anon;
exception when undefined_object then null;
end
$$;

-- A probe for `db:doctor` (see 0031).
create or replace function public.migration_0060_applied()
returns boolean
language sql
immutable
set search_path = public, pg_catalog
as $$ select true $$;
