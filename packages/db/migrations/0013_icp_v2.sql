-- 0013 — the ICP, typed and versioned.
--
-- ── Why this migration exists ────────────────────────────────────────────
--
-- `ICP-01`, from the R6 pass, is the most instructive defect in this repo's
-- history. The seed wrote `criteria` as `{industries, employee_count,
-- signals}`; the only reader looked for `{segments, sizes, regions,
-- triggers}`. jsonb accepted both. The reader degraded every missing key to
-- an empty list exactly as designed. And so `qualify` and `why_now` judged
-- every company against a profile asserting *nothing*, in a tone that reads
-- as a finding.
--
-- It was fixed by making the two agree. That closes the incident and leaves
-- the class open, because nothing prevents the next disagreement — and the
-- next one arrives the moment a provider query translator becomes a third
-- reader of the same blob.
--
-- The fix for the class is a schema both sides import, and it lives in
-- `packages/db/src/icp.ts` because it has to be one artifact, not one per
-- language. What this migration does is the half that has to be in the
-- database: a version history, so a score can name the profile it was
-- computed against, and a shape check strong enough that a blob written by
-- something that never read the schema is rejected at the boundary.
--
-- ── Why versions are a table and not an integer ──────────────────────────
--
-- `icps.version integer` has existed since `0002` and nothing has ever
-- incremented it. That is worse than not having it: every score in the system
-- claims to have been computed against version 1 of a profile that has been
-- edited nine times.
--
-- A version has to be a *snapshot*, because the question it answers is "what
-- did the profile say when this score was computed" and an integer cannot
-- answer that. Once it is a snapshot it may as well be immutable, and once it
-- is immutable the drift analysis in `SCO-01` becomes a join rather than an
-- archaeology project.

-- ── The snapshot ──────────────────────────────────────────────────────────

create table icp_versions (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  icp_id      uuid not null references icps(id) on delete cascade,

  version     integer not null check (version >= 1),

  -- The whole profile as it stood. Denormalized on purpose: a version that
  -- pointed back at mutable rows would not be a version.
  name              text not null,
  criteria          jsonb not null,
  negative_criteria jsonb not null default '{}'::jsonb,
  -- Personas belong to the profile, so they are part of the snapshot. Stored
  -- as an array rather than a second versioned table, because nothing ever
  -- needs to query one persona of one historical version — it is read whole
  -- or not at all.
  personas          jsonb not null default '[]'::jsonb,

  -- What changed from the previous version, computed at write time. Kept so
  -- the learning loop can attribute a shift in reply rate to a specific edit
  -- without diffing two blobs at read time.
  diff        jsonb not null default '{}'::jsonb,

  -- The completeness score at the time. See `icp_quality` below.
  quality     integer check (quality is null or quality between 0 and 100),

  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),

  unique (org_id, icp_id, version)
);

create index icp_versions_recent_idx on icp_versions (org_id, icp_id, version desc);

-- ── Quality and reach, on the profile itself ──────────────────────────────

alter table icps
  -- A deterministic completeness score, 0–100, computed by `scoreIcp()` in
  -- `packages/db/src/icp.ts`. Deterministic is load-bearing: an AI-assigned
  -- "ICP quality: 72" is a number with no method behind it, which is the
  -- §16 failure this product exists not to commit. This one is a weighted
  -- count of which fields are populated and how specific they are, and the
  -- screen can show the working.
  add column quality_score integer check (quality_score is null or quality_score between 0 and 100),

  -- The addressable-company estimate, and where it came from.
  --
  -- Never inferred. It is the `total_entries` a provider reports for a
  -- zero-row search — one cheap call — or it is null. A market-size number
  -- invented by a model and displayed next to real ones is the most
  -- expensive kind of §7 violation, because it is the number a customer
  -- repeats to their board.
  add column addressable_estimate bigint check (addressable_estimate is null or addressable_estimate >= 0),
  add column addressable_source text
    check (addressable_source is null or addressable_source in ('provider', 'manual')),
  add column addressable_at timestamptz,

  -- Bumped by `bump_icp_version()` below rather than by the application, so
  -- there is exactly one writer and no read-modify-write race between two
  -- admins editing the same profile.
  add column current_version_id uuid references icp_versions(id) on delete set null;

-- The shape check.
--
-- Deliberately weak: object, not scalar; no unknown top-level keys. Full
-- validation is the zod schema's job and belongs where it can produce a
-- message a person can act on. What this stops is the specific `ICP-01`
-- failure — a writer that never read the schema putting an unrecognised
-- top-level key in and every reader silently seeing an empty profile.
--
-- Listed rather than open, and it fails loudly. A new field is a migration,
-- which is the correct amount of friction for a change that every reader and
-- the provider query translator have to agree about.

-- A CHECK may not contain a subquery, and "every key is in this set" needs
-- one — `jsonb_object_keys` is set-returning. So the predicate is a function,
-- which a CHECK may call.
--
-- The known caveat: Postgres does not re-validate existing rows when the
-- function body changes. That is acceptable *because* changing the allowed
-- key set is a migration, and a migration is where a backfill and a
-- re-validation belong. It would not be acceptable if the set were
-- configuration.

create or replace function public.jsonb_keys_within(p_obj jsonb, p_allowed text[])
returns boolean
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select p_obj is null
      or jsonb_typeof(p_obj) <> 'object'
      or not exists (
           select 1 from jsonb_object_keys(p_obj) k where k <> all(p_allowed)
         )
$$;

alter table icps
  add constraint icps_criteria_is_object
    check (jsonb_typeof(criteria) = 'object'),
  add constraint icps_negative_is_object
    check (jsonb_typeof(negative_criteria) = 'object'),
-- The four names at the top of each list are the ones `ICP-01` settled, and
-- they are unchanged. Every reader in `apps/web/lib/data/icp.ts` and every
-- seeded row uses them, and renaming them to something tidier would be
-- re-committing `ICP-01` in the name of fixing it.
--
-- `sizes` and `employeeRange` both being here is deliberate and is not
-- duplication. `sizes` is a list of human bands — "11–50", "51–200" — which
-- is what a person writes and what the screen shows. `employeeRange` is
-- `{min, max}`, which is what a provider filter takes. `parseIcp()` derives
-- the second from the first when it is absent, so an existing profile needs
-- no edit to become searchable; an admin who wants a range the bands cannot
-- express sets it directly.

  add constraint icps_criteria_known_keys
    check (public.jsonb_keys_within(criteria, array[
      -- v1, unchanged
      'segments', 'sizes', 'regions', 'triggers',
      -- v2
      'industries', 'employeeRange', 'revenueBands', 'technologies',
      'businessModels', 'painPoints', 'useCases', 'buyingSignals',
      'keywords', 'exampleCompanies', 'notes'
    ])),
  add constraint icps_negative_known_keys
    check (public.jsonb_keys_within(negative_criteria, array[
      -- v1, unchanged
      'exclusions',
      -- v2
      'industries', 'regions', 'sizes', 'technologies', 'businessModels',
      'employeeRange', 'keywords', 'domains', 'signals', 'notes'
    ]));

-- ── Personas, made usable for contact matching ────────────────────────────
--
-- `personas` has had `title_patterns` and `seniority` since `0002` and
-- nothing has matched against them, because there was nothing to match: the
-- contact model was one boolean. Phase 5 changes that, and these are the
-- columns its fit scoring reads.

alter table personas
  add column departments   text[] not null default '{}',
  -- Titles that look right and are not. "VP of Sales" is a buyer for one
  -- product and a competitor's champion for another, and without exclusions
  -- the only way to express that is a narrower pattern — which also excludes
  -- the titles you wanted.
  add column exclude_titles text[] not null default '{}',
  -- Rank among this ICP's personas, 1 = the person to reach first. Used as
  -- the tiebreak in contact ranking, so two equally-fitting contacts resolve
  -- deterministically rather than by row order.
  add column priority      integer not null default 1 check (priority >= 1),
  add column is_primary    boolean not null default false;

create index personas_icp_idx on personas (org_id, icp_id, priority)
  where deleted_at is null;

-- ── Writing a version ─────────────────────────────────────────────────────
--
-- One function, because the three writes have to agree: the snapshot, the
-- integer on the profile, and the pointer to the current snapshot. Doing it
-- from the application means two admins saving at the same second both read
-- version 4 and both write version 5, and the unique index turns the second
-- one into an error the user did not cause.
--
-- Here the read and the write are one statement under the row lock the
-- update takes, so the second caller waits and gets 6.

create or replace function public.bump_icp_version(
  p_org    uuid,
  p_icp    uuid,
  p_diff   jsonb default '{}'::jsonb,
  p_quality integer default null,
  p_actor  uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_version integer;
  v_id      uuid;
  v_icp     record;
begin
  -- `for update` is the whole concurrency story. Without it the select and
  -- the insert are two statements with a gap between them, and the gap is
  -- exactly one unique violation wide.
  select * into v_icp
  from public.icps
  where id = p_icp and org_id = p_org and deleted_at is null
  for update;

  if not found then
    raise exception 'bump_icp_version: icp % not found in org %', p_icp, p_org;
  end if;

  select coalesce(max(version), 0) + 1 into v_version
  from public.icp_versions
  where org_id = p_org and icp_id = p_icp;

  insert into public.icp_versions (
    org_id, icp_id, version, name, criteria, negative_criteria, personas, diff, quality, created_by
  )
  select
    p_org, p_icp, v_version, v_icp.name, v_icp.criteria, v_icp.negative_criteria,
    coalesce(
      (
        select jsonb_agg(jsonb_build_object(
          'id', pr.id, 'name', pr.name,
          'titlePatterns', to_jsonb(pr.title_patterns),
          'seniority', to_jsonb(pr.seniority),
          'departments', to_jsonb(pr.departments),
          'excludeTitles', to_jsonb(pr.exclude_titles),
          'priority', pr.priority,
          'isPrimary', pr.is_primary,
          'painPoints', pr.pain_points
        ))
        from public.personas pr
        where pr.org_id = p_org and pr.icp_id = p_icp and pr.deleted_at is null
      ),
      '[]'::jsonb
    ),
    coalesce(p_diff, '{}'::jsonb),
    p_quality,
    p_actor
  returning id into v_id;

  update public.icps
    set version = v_version,
        current_version_id = v_id,
        quality_score = coalesce(p_quality, quality_score),
        updated_at = now()
    where id = p_icp and org_id = p_org;

  return v_id;
end;
$$;

-- ── Backfill ──────────────────────────────────────────────────────────────
--
-- Every existing profile gets version 1, so nothing in the system references
-- a version that does not exist. Personas are included, which means the
-- backfilled snapshot is genuinely what the profile says today rather than a
-- placeholder — a placeholder version would be worse than none, because a
-- score citing it would look grounded and would not be.

do $$
declare r record;
begin
  for r in select id, org_id from public.icps where deleted_at is null loop
    if not exists (select 1 from public.icp_versions where icp_id = r.id) then
      perform public.bump_icp_version(
        r.org_id, r.id,
        jsonb_build_object('reason', 'backfill at 0013'),
        null, null
      );
    end if;
  end loop;
end $$;

-- ── RLS ───────────────────────────────────────────────────────────────────
--
-- Read for members, write for nobody. `icp_versions` is append-only and is
-- written exclusively by `bump_icp_version`, which is SECURITY DEFINER — so
-- there is no legitimate direct insert, and a policy permitting one would be
-- a way to fabricate the profile a score claims to have been computed
-- against.

alter table public.icp_versions enable row level security;

create policy tenant_read on public.icp_versions
  for select using (org_id in (select public.user_org_ids()));

-- ── Lockdown ──────────────────────────────────────────────────────────────

create or replace function public.bump_icp_version_for_org(
  p_org     uuid,
  p_icp     uuid,
  p_diff    jsonb default '{}'::jsonb,
  p_quality integer default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  -- Editing the profile is an admin act — it changes what the engine spends
  -- money looking for. `0001` draws the same line for `organizations`.
  if not public.has_org_role(p_org, 'admin') then
    raise exception 'bump_icp_version_for_org: not an admin of %', p_org;
  end if;
  return public.bump_icp_version(p_org, p_icp, p_diff, p_quality, auth.uid());
end;
$$;

do $$
begin
  revoke execute on function
    public.bump_icp_version(uuid, uuid, jsonb, integer, uuid)
  from public, anon, authenticated;

  grant execute on function
    public.bump_icp_version(uuid, uuid, jsonb, integer, uuid)
  to service_role;
exception when undefined_object or undefined_function then null;
end $$;
