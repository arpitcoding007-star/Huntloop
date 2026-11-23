-- ============================================================================
-- 0059 — The declared/enriched firewall (Exchange spec §6; build plan DN-34,
--        DN-83)
--
-- Exchange (docs/product/marketplace-spec.md) will let a buyer state a need
-- and, when they accept an intro, create a person and an opportunity in the
-- provider's workspace. Those rows hold what someone *told* us, with consent
-- for one purpose. The seller engine exists to enrich people who never signed
-- up and put them in cold sequences. If an Exchange-origin row ever reaches
-- that path, the product's trust promise is broken and cannot be repaired.
--
-- The rule is enforced by the database, not by convention:
--
--   1. `origin` on `people` and `opportunities`: 'engine' (default),
--      'import', or 'exchange'.
--   2. Once 'exchange', always 'exchange'. An update that changes it is
--      refused, so no code path can launder a row into the engine.
--   3. An enrollment (a cold sequence) can never point at an Exchange
--      opportunity.
--   4. No enrichment record, and no provider-sourced contact point, can be
--      written for an Exchange person.
--
-- The job handlers refuse earlier, before any paid provider call
-- (packages/jobs/src/firewall.ts). These triggers are the backstop that
-- holds when a handler forgets, and `scripts/audit.mjs` FW-01 fails the
-- build if a guarded handler stops calling the guard.
--
-- Nothing in the app writes 'exchange' yet. Until Exchange ships this only
-- adds refusals for a value no row has, so it changes no current behaviour.
-- ============================================================================

-- ── 1. The column ───────────────────────────────────────────────────────────
alter table public.people
  add column if not exists origin text not null default 'engine';
alter table public.opportunities
  add column if not exists origin text not null default 'engine';

do $$
begin
  alter table public.people
    add constraint people_origin_check check (origin in ('engine', 'import', 'exchange'));
exception when duplicate_object then null;
end
$$;
do $$
begin
  alter table public.opportunities
    add constraint opportunities_origin_check check (origin in ('engine', 'import', 'exchange'));
exception when duplicate_object then null;
end
$$;

comment on column public.people.origin is
  'Where this person came from. exchange = they stated a need on Exchange and '
  'accepted an intro: never enriched, never sequenced (0059 firewall).';
comment on column public.opportunities.origin is
  'Where this opportunity came from. exchange = an accepted Exchange intro: '
  'never enrolled in a sequence (0059 firewall).';

create index if not exists people_exchange_origin_idx
  on public.people (org_id) where origin = 'exchange';
create index if not exists opportunities_exchange_origin_idx
  on public.opportunities (org_id) where origin = 'exchange';

-- ── 2. Exchange is permanent ────────────────────────────────────────────────
create or replace function public.exchange_origin_is_permanent()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if old.origin = 'exchange' and new.origin is distinct from 'exchange' then
    raise exception 'An Exchange-origin row cannot change its origin (firewall, 0059).'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

drop trigger if exists people_origin_permanent on public.people;
create trigger people_origin_permanent
  before update of origin on public.people
  for each row execute function public.exchange_origin_is_permanent();

drop trigger if exists opportunities_origin_permanent on public.opportunities;
create trigger opportunities_origin_permanent
  before update of origin on public.opportunities
  for each row execute function public.exchange_origin_is_permanent();

-- ── 3. No sequence for an Exchange opportunity ──────────────────────────────
create or replace function public.firewall_refuse_exchange_enrollment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if exists (
    select 1 from public.opportunities o
     where o.id = new.opportunity_id and o.origin = 'exchange'
  ) then
    raise exception 'An Exchange opportunity cannot be enrolled in a sequence (firewall, 0059).'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

drop trigger if exists enrollments_firewall on public.enrollments;
create trigger enrollments_firewall
  before insert or update of opportunity_id on public.enrollments
  for each row execute function public.firewall_refuse_exchange_enrollment();

-- ── 4. No enrichment for an Exchange person ─────────────────────────────────
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
  return new;
end
$$;

drop trigger if exists enrichment_records_firewall on public.enrichment_records;
create trigger enrichment_records_firewall
  before insert or update of entity_id, entity_type on public.enrichment_records
  for each row execute function public.firewall_refuse_exchange_enrichment();

/* A contact point with a provider came from a data vendor. An Exchange
   person's contact details are only ever the ones they gave (provider null). */
create or replace function public.firewall_refuse_exchange_provider_contact()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if new.provider is not null and exists (
    select 1 from public.people p
     where p.id = new.person_id and p.origin = 'exchange'
  ) then
    raise exception 'An Exchange person cannot hold provider-sourced contact details (firewall, 0059).'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

drop trigger if exists contact_points_firewall on public.contact_points;
create trigger contact_points_firewall
  before insert or update of provider, person_id on public.contact_points
  for each row execute function public.firewall_refuse_exchange_provider_contact();

do $$
begin
  revoke all on function public.firewall_refuse_exchange_enrollment() from public, anon, authenticated;
  revoke all on function public.firewall_refuse_exchange_enrichment() from public, anon, authenticated;
  revoke all on function public.firewall_refuse_exchange_provider_contact() from public, anon, authenticated;
exception when undefined_object then null;
end
$$;

-- A probe for `db:doctor` (see 0031).
create or replace function public.migration_0059_applied()
returns boolean
language sql
immutable
set search_path = public, pg_catalog
as $$ select true $$;
