-- ============================================================================
-- 0003 — Companies, people, and opportunities
--
-- The heart of the schema. Two decisions here are load-bearing and are
-- deliberately expressed as constraints rather than as conventions:
--
--   · An opportunity's priority always carries its reason (§77 Principle 4).
--   · The eight score dimensions are NULLABLE columns, and NULL means
--     UNKNOWN. §78 forbids the alternative — a 0 asserts "we measured this
--     and it is bad", which is a finding Huntloop did not make.
-- ============================================================================

create type opportunity_priority as enum ('hot', 'warm', 'watch', 'ignore');
create type opportunity_status   as enum (
  'discovered', 'researching', 'qualified', 'assigned', 'contacted',
  'replied', 'meeting', 'proposal', 'won', 'lost', 'archived'
);

-- ── Companies (master context §12) ─────────────────────────────────────────

create table companies (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations(id) on delete cascade,
  -- §59 entity resolution key. Normalized (lowercase, no scheme, no www) by
  -- the application before insert; the unique index is what makes the same
  -- company arriving from GitHub and from a news article one row.
  canonical_domain  text not null,
  name              text not null,
  website           text,
  industry          text,
  employee_count    integer,
  revenue_band      text,
  country           text,
  region            text,
  business_model    text,
  description       text,
  tech_stack        text[] not null default '{}',
  funding           jsonb not null default '{}'::jsonb,
  leadership        jsonb not null default '[]'::jsonb,
  last_researched_at timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  unique (org_id, canonical_domain)
);

alter table source_events
  add constraint source_events_company_fk
  foreign key (company_id) references companies(id) on delete cascade;

create index source_events_company_idx
  on source_events (org_id, company_id, event_date desc);

-- §12 splits problems, gaps and triggers apart instead of collapsing them
-- into one "signals" bag, because §78 needs them independently addressable:
-- "strong trigger but unclear problem" has to be a representable state.
create table company_problems (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  company_id  uuid not null references companies(id) on delete cascade,
  problem     text not null,
  severity    integer check (severity between 0 and 100),
  evidence_id uuid references evidence(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create table company_gaps (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references organizations(id) on delete cascade,
  company_id       uuid not null references companies(id) on delete cascade,
  gap              text not null,
  current_approach text,
  evidence_id      uuid references evidence(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);

create table company_triggers (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  company_id   uuid not null references companies(id) on delete cascade,
  trigger_type text not null,
  event_date   timestamptz not null,
  strength     integer check (strength between 0 and 100),
  evidence_id  uuid references evidence(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

-- "Why now" reads this newest-first, on every opportunity page load.
create index company_triggers_recent_idx
  on company_triggers (org_id, company_id, event_date desc)
  where deleted_at is null;

-- ── People & contact points (master context §25) ───────────────────────────

create table people (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references organizations(id) on delete cascade,
  company_id       uuid not null references companies(id) on delete cascade,
  first_name       text,
  last_name        text,
  title            text,
  seniority        text,
  linkedin_url     text,
  is_decision_maker boolean not null default false,
  source           text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);

create index people_company_idx on people (org_id, company_id);

create table contact_points (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references organizations(id) on delete cascade,
  person_id           uuid not null references people(id) on delete cascade,
  kind                text not null check (kind in ('email', 'phone', 'linkedin')),
  value               text not null,
  verification_status text not null default 'unverified',
  -- §25: contact data carries confidence and provenance. A guessed address
  -- and a verified one are not the same fact, and the UI must be able to say
  -- which it has.
  confidence          confidence,
  provider            text,
  verified_at         timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,
  unique (org_id, kind, value)
);

create table enrichment_records (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  entity_type text not null,
  entity_id   uuid not null,
  provider    text not null,
  field       text not null,
  value       text,
  confidence  confidence,
  cost_cents  integer not null default 0,
  raw         jsonb,
  fetched_at  timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- §58: "preserve evidence and confidence instead of arbitrarily overwriting".
-- Keeping every provider answer as its own row is what makes that possible;
-- the resolution happens on read, not by clobbering on write.
create index enrichment_entity_idx
  on enrichment_records (org_id, entity_type, entity_id, field, fetched_at desc);

-- ── Opportunities (master context §14, §15, §51) ───────────────────────────

create table opportunities (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations(id) on delete cascade,
  company_id        uuid not null references companies(id) on delete cascade,
  icp_id            uuid references icps(id) on delete set null,
  primary_person_id uuid references people(id) on delete set null,

  priority          opportunity_priority not null default 'watch',
  -- NOT NULL by design. The verdict is a claim, and §77 Principle 4 makes
  -- claims explainable; PriorityBadge already requires the reason at the type
  -- level, and this is the same rule one layer down.
  priority_reason   text not null,

  status            opportunity_status not null default 'discovered',
  owner_id          uuid references auth.users(id) on delete set null,

  -- The §14 narrative fields. All nullable: an opportunity that has been
  -- discovered but not yet researched genuinely has no why-now, and an empty
  -- string would be a claim that we looked and found nothing.
  why_this_company   text,
  identified_problem text,
  potential_gap      text,
  why_now            text,
  current_approach   text,
  potential_use_case text,
  outreach_angle     text,
  confidence         confidence,

  first_seen_at     timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,

  -- One opportunity per company per ICP. The same company can legitimately be
  -- an opportunity against two different ICPs with different reasoning.
  --
  -- NULLS NOT DISTINCT (Postgres 15+) matters here: an opportunity discovered
  -- before any ICP was attached has icp_id NULL, and under default NULL
  -- semantics every such row is unique — so the same company would duplicate
  -- on every rescan, which is exactly what §60 forbids.
  unique nulls not distinct (org_id, company_id, icp_id)
);

-- The Command Center's priority row and the list's default sort. Priority
-- first, recency second — NOT score. §78 requires that a strong trigger
-- cannot lift a poor-fit company, so the verdict orders the list and the
-- score is detail within it.
create index opportunities_priority_idx
  on opportunities (org_id, priority, first_seen_at desc)
  where deleted_at is null;

create index opportunities_owner_idx
  on opportunities (org_id, owner_id, status)
  where deleted_at is null;

create table scoring_rules (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations(id) on delete cascade,
  icp_id     uuid references icps(id) on delete cascade,
  name       text not null,
  expression jsonb not null,
  weight     numeric,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table opportunity_scores (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  opportunity_id uuid not null references opportunities(id) on delete cascade,
  model_version  text not null,
  score          integer not null check (score between 0 and 100),

  -- The eight dimensions of §51, each nullable. NULL is UNKNOWN and renders
  -- as UNKNOWN. There is deliberately NO `weights` column: §51 records the
  -- combination rule as NOT DEFINED and warns against inventing one and
  -- treating it as Huntloop's logic. When a real weighting exists it arrives
  -- as its own versioned table, not as a jsonb guess bolted on here.
  icp_fit                      integer check (icp_fit between 0 and 100),
  problem_severity             integer check (problem_severity between 0 and 100),
  evidence_strength            integer check (evidence_strength between 0 and 100),
  trigger_strength             integer check (trigger_strength between 0 and 100),
  trigger_freshness            integer check (trigger_freshness between 0 and 100),
  buying_likelihood            integer check (buying_likelihood between 0 and 100),
  product_relevance            integer check (product_relevance between 0 and 100),
  decision_maker_accessibility integer check (decision_maker_accessibility between 0 and 100),

  confidence     confidence,
  -- NOT NULL: §51 and §77 Principle 4 forbid an unexplained score, and
  -- ScorePill requires the explanation to render at all.
  explanation    text not null,
  computed_at    timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index opportunity_scores_current_idx
  on opportunity_scores (org_id, opportunity_id, computed_at desc);

-- ── RLS ────────────────────────────────────────────────────────────────────

do $$
declare t text;
begin
  foreach t in array array[
    'companies', 'company_problems', 'company_gaps', 'company_triggers',
    'people', 'contact_points', 'enrichment_records',
    'opportunities', 'scoring_rules', 'opportunity_scores'
  ]
  loop
    execute format('alter table public.%1$I enable row level security', t);

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
