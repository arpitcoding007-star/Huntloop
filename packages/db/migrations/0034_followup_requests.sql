-- 0034 — the work the loop was never asked to do.
--
-- ── MAP-001 / CRM-001 / PROV-001 ─────────────────────────────────────────
--
-- Three handlers were built, registered and tested, and nothing enqueued them
-- after onboarding:
--
--   · sync_hubspot    — the integrations screen said "push an opportunity to
--                       start", and there was no way to push one;
--   · rank_contacts   — people were found only during onboarding's first run,
--                       so every later discovery had no buyer to contact;
--   · enrich_company  — provider data was read once and never refreshed.
--
-- The request path may not enqueue (lib/data/engine.ts), so each gets the
-- seam this schema already uses for scans and recomputes: a column a Server
-- Action writes, and a bounded sweeper (`schedule_followups`) that turns it
-- into a job. Enrichment needs no new column — `last_enriched_at` (0032) is
-- its own marker.
--
--   crm_sync_requested_at   set by "Push to HubSpot"; cleared when enqueued.
--   contacts_sought_at      set when contact discovery is enqueued, so an
--                           opportunity nobody could be found for is not
--                           re-searched every tick at a credit each.

alter table public.opportunities
  add column if not exists crm_sync_requested_at timestamptz,
  add column if not exists contacts_sought_at timestamptz;

create index if not exists opportunities_crm_sync_requested_idx
  on public.opportunities (crm_sync_requested_at)
  where crm_sync_requested_at is not null and deleted_at is null;

create index if not exists opportunities_contacts_unsought_idx
  on public.opportunities (org_id, priority)
  where contacts_sought_at is null and deleted_at is null;

-- Whether this org has HubSpot connected, for any member. The table is
-- admin-only because it holds the token (0028); the opportunity page only
-- needs to know whether a "Push to HubSpot" control means anything.
create or replace function public.org_has_hubspot(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1 from public.hubspot_connections h
    where h.org_id = p_org and h.is_enabled
  )
  and p_org in (select public.user_org_ids())
$$;

-- A probe for `db:doctor` (see 0031).
create or replace function public.migration_0034_applied()
returns boolean
language sql
immutable
set search_path = public, pg_catalog
as $$ select true $$;
