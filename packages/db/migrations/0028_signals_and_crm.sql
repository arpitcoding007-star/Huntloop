-- 0028 — the signal capability's one column, and HubSpot's one table.
--
-- ── Signals ───────────────────────────────────────────────────────────────
--
-- Everything else the signal capability needs already exists: a hiring
-- posting becomes an `evidence` row exactly the way a company's headcount
-- does (`enrich_company`), keyed by the existing `(org_id, subject_type,
-- subject_id, field, source_id, source_url)` dedup target. The one thing
-- missing is a place to remember when a company was last checked, so
-- `schedule_signal_fetches` can find what is stale without a second table
-- duplicating `discovery_queries`' scheduling machinery for a rule that is
-- the same for every org: 48 hours, no per-customer configuration.

alter table companies
  add column last_signal_checked_at timestamptz;

-- Sorted by the scheduler on every tick; nulls (never checked) sort first,
-- which is the priority order it wants.
create index companies_signal_stale_idx on companies (last_signal_checked_at)
  where deleted_at is null;

-- ── CRM sync needs a fourth entity type ──────────────────────────────────
--
-- `external_ids` (`0012`) already models "a foreign system's opinion about
-- our row" generically over entity type, which is exactly what a HubSpot
-- deal id is — HubSpot's opinion about one of our opportunities. Extending
-- the check rather than building a parallel `crm_links` table is the same
-- call `0012` itself argues for: a second table for the same shape is how a
-- schema ends up with `apollo_id`, `hubspot_id`, `hubspot_id_v2`.
--
-- The constraint was declared inline with no name, so Postgres gave it the
-- default single-column name. Replaced rather than dropped-and-forgotten:
-- a table with no entity_type check at all would accept anything.

alter table external_ids
  drop constraint external_ids_entity_type_check;

alter table external_ids
  add constraint external_ids_entity_type_check
  check (entity_type in ('company', 'person', 'competitor', 'opportunity'));

-- ── HubSpot connections ───────────────────────────────────────────────────
--
-- One row per org, unlike Apollo. Apollo is a deployment-wide vendor
-- relationship (`APOLLO_API_KEY`, one key, every org's discovery runs
-- through it) — HubSpot is each customer's own account, so the credential
-- has to live per-org, in the database, not in an environment variable.
--
-- `access_token` holds AES-256-GCM ciphertext, not a token. It is encrypted
-- in the application by `@huntloop/db/secrets` before it ever reaches this
-- column, and decrypted only in `sync_hubspot`, which runs service-role.
--
-- Encrypted in the application rather than with `pgcrypto` for two reasons,
-- and the second is the real one: PGlite — what `npm test` runs every
-- migration against — does not ship the extension, so a pgcrypto column
-- could not be tested by the suite that tests everything else here; and
-- pgcrypto needs the key *in the SQL statement*, which puts it in query
-- logs and in the database process. Encrypting above Postgres means Postgres
-- never holds the key, so a dump of this table is ciphertext and nothing else.
--
-- The column stays `text` and stays admin-only under RLS regardless. Defence
-- in depth: encryption is what makes a stolen dump worthless, and the policy
-- below is what stops a member-level session reading the row in the first
-- place. Neither one makes the other redundant.

create table hubspot_connections (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references organizations(id) on delete cascade,

  access_token     text not null,
  -- HubSpot's own account id for the connected portal. Not secret, and
  -- useful on its own: a support conversation about "which HubSpot account"
  -- does not require decrypting or re-fetching anything.
  hub_id           text,

  connected_by     uuid references auth.users(id) on delete set null,
  connected_at     timestamptz not null default now(),

  last_synced_at   timestamptz,
  last_sync_error  text,

  -- A connection a member disabled without disconnecting — the same
  -- `is_enabled` shape `provider_accounts` already uses for the same reason:
  -- "paused" and "never connected" are different facts and a customer asking
  -- "why did syncing stop" deserves the true one.
  is_enabled       boolean not null default true,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  unique (org_id)
);

create trigger hubspot_connections_touch before update on public.hubspot_connections
  for each row execute function public.touch_updated_at();

alter table public.hubspot_connections enable row level security;

-- Admin-only, both directions. A member who can invite a teammate should not
-- thereby be able to read the token that reaches this org's live CRM, and a
-- member should not be able to point production sync at their own HubSpot
-- account by editing the row.
create policy tenant_read on public.hubspot_connections
  for select using (public.has_org_role(org_id, 'admin'));
create policy tenant_write on public.hubspot_connections
  for all
  using (public.has_org_role(org_id, 'admin'))
  with check (public.has_org_role(org_id, 'admin'));
