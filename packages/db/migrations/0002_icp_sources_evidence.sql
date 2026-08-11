-- ============================================================================
-- 0002 — Product, ICP, sources, and the evidence record
--
-- This is the migration that makes master context §7 and §52 enforceable in
-- the database rather than by convention. If evidence lived in a jsonb blob
-- on a signal row, "never silently convert an inference into a fact" would be
-- a code review rule; here it is a check constraint.
-- ============================================================================

create type claim_kind   as enum ('fact', 'inference', 'unknown');
create type confidence   as enum ('low', 'medium', 'high');
create type source_kind  as enum (
  'news', 'blog', 'jobs', 'social', 'github', 'funding',
  'regulatory', 'community', 'podcast', 'custom'
);
create type source_status as enum ('ok', 'degraded', 'unavailable');

-- ── Product & ICP (master context §8, §9) ──────────────────────────────────

create table products (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  name        text not null,
  website     text,
  description text,
  value_props jsonb not null default '[]'::jsonb,
  proof_points jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create table icps (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations(id) on delete cascade,
  product_id        uuid references products(id) on delete set null,
  name              text not null,
  criteria          jsonb not null default '{}'::jsonb,
  -- §9 asks "what companies are NOT a fit?" as a first-class question, so the
  -- exclusions are their own column rather than negated entries in criteria.
  negative_criteria jsonb not null default '{}'::jsonb,
  is_active         boolean not null default true,
  version           integer not null default 1,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz
);

create index icps_org_active_idx on icps (org_id) where is_active and deleted_at is null;

create table personas (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  icp_id          uuid not null references icps(id) on delete cascade,
  name            text not null,
  title_patterns  text[] not null default '{}',
  seniority       text[] not null default '{}',
  pain_points     jsonb not null default '[]'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

-- ── Sources (master context §10, §58) ──────────────────────────────────────

create table sources (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  icp_id          uuid references icps(id) on delete set null,
  kind            source_kind not null,
  name            text not null,
  url             text,
  is_enabled      boolean not null default true,
  -- §10: Huntloop recommends, the user accepts / removes / adds. Keeping the
  -- provenance of the source itself means the learning loop can later ask
  -- whether system picks or user picks produced better opportunities.
  recommended_by  text not null default 'system'
                    check (recommended_by in ('system', 'user')),
  status          source_status not null default 'ok',
  failure_count   integer not null default 0,
  last_scanned_at timestamptz,
  last_error      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

-- Drives the "source unavailable" card in the Needs You rail (§58).
create index sources_org_status_idx on sources (org_id, status) where is_enabled;

create table source_documents (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  source_id     uuid not null references sources(id) on delete cascade,
  url           text not null,
  canonical_url text,
  title         text,
  published_at  timestamptz,
  fetched_at    timestamptz not null default now(),
  -- §60: the same article reached through two sources is one document.
  content_hash  text not null,
  raw_ref       text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (org_id, content_hash)
);

-- ── Evidence (master context §52) ──────────────────────────────────────────

create table evidence (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  subject_type text not null
                 check (subject_type in ('company', 'opportunity', 'contact', 'signal')),
  subject_id   uuid not null,
  claim        text not null,
  kind         claim_kind not null,
  confidence   confidence,
  source_id    uuid references sources(id) on delete set null,
  source_url   text,
  excerpt      text,
  -- When the thing happened, versus when Huntloop saw it. §81 needs both:
  -- a six-month-old event observed yesterday is still a six-month-old event.
  event_date   timestamptz,
  observed_at  timestamptz not null default now(),
  superseded_by uuid references evidence(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,

  -- §7, enforced rather than reviewed. A fact is something observed at a
  -- source; without a URL there is nothing to observe it at, and the row is
  -- an inference wearing a fact's label.
  constraint evidence_fact_needs_source
    check (kind <> 'fact' or source_url is not null),

  -- An unknown asserts nothing, so it must not carry a confidence — "high
  -- confidence that we don't know" is a category error that would render as
  -- a credible-looking badge.
  constraint evidence_unknown_has_no_confidence
    check (kind <> 'unknown' or confidence is null)
);

create index evidence_subject_idx
  on evidence (org_id, subject_type, subject_id, event_date desc)
  where deleted_at is null and superseded_by is null;

comment on table evidence is
  'Master context §52. One row per claim, with the provenance that lets the '
  'agent answer "why do you think this?" with a source instead of prose.';

-- ── Normalized source events (master context §33) ──────────────────────────

create table source_events (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references organizations(id) on delete cascade,
  source_document_id uuid references source_documents(id) on delete cascade,
  company_id         uuid,   -- FK added in 0003, after companies exists
  event_type         text not null,
  event_date         timestamptz,
  observed_at        timestamptz not null default now(),
  description        text,
  confidence         confidence,
  kind               claim_kind not null default 'inference',
  url                text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

comment on table source_events is
  'The §33 abstraction: the intelligence engine consumes these and never '
  'needs to know whether the origin was Reddit, GitHub, or a press release.';

-- ── RLS ────────────────────────────────────────────────────────────────────

alter table products         enable row level security;
alter table icps             enable row level security;
alter table personas         enable row level security;
alter table sources          enable row level security;
alter table source_documents enable row level security;
alter table evidence         enable row level security;
alter table source_events    enable row level security;

-- Read for any member; write for member and above (viewer is read-only).
do $$
declare t text;
begin
  foreach t in array array[
    'products', 'icps', 'personas', 'sources', 'source_documents',
    'evidence', 'source_events'
  ]
  loop
    execute format($f$
      create policy tenant_read on public.%1$I
        for select using (org_id in (select public.user_org_ids()));

      create policy tenant_write on public.%1$I
        for all
        using (public.has_org_role(org_id, 'member'))
        with check (public.has_org_role(org_id, 'member'));
    $f$, t);

    execute format(
      'create trigger %1$I_touch before update on public.%1$I '
      'for each row execute function public.touch_updated_at()', t
    );
  end loop;
end
$$;
