-- 0012 — canonical identity.
--
-- ── The problem this fixes ───────────────────────────────────────────────
--
-- `companies` is keyed on `(org_id, canonical_domain)`. That key is correct,
-- cheap, and sufficient for the volume a feed scanner produces: a press
-- release names one domain, and the same press release syndicated to three
-- outlets names the same one.
--
-- A discovery provider does not behave that way. It returns the domain it has
-- on file, which may be the marketing site while the news names the product
-- site, the acquired brand while the news names the acquirer, or `acme.io`
-- while the article links `www.acme.com` — which redirects to it. Under a
-- single-column key each of those is a new company, and the duplicates are
-- not visible until somebody notices they have pitched the same account four
-- times.
--
-- Duplicates created at provider volume are also the one class of data defect
-- that gets harder to fix with time, because every downstream row — evidence,
-- scores, opportunities, sent messages — attaches to whichever duplicate
-- happened to exist that day. This migration therefore ships BEFORE any
-- provider search does, and the plan makes that a hard ordering constraint.
--
-- ── The shape ────────────────────────────────────────────────────────────
--
--   company_domains   every domain that is this company, and how we know
--   external_ids      every provider's id for anything of ours
--   company_merges    what was merged into what, by whom, and enough to undo
--   companies.parent  the one hierarchy relationship the product needs
--
-- `companies.canonical_domain` stays exactly as it is, including its unique
-- index. It remains the display key and the fast path; `company_domains` is
-- the *resolution* key. Moving the constraint would be a rewrite of a live
-- table for no gain — the new table has its own unique index, and a company
-- always has a row in it for its own canonical domain.

-- ── Every domain that is this company ─────────────────────────────────────

create table company_domains (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  company_id  uuid not null references companies(id) on delete cascade,

  -- Normalized before insert by `canonicalizeDomain()` in
  -- `@huntloop/db/identity`: lowercased, scheme and `www.` and trailing dot
  -- removed, punycode applied, port and path discarded. Enforced here as far
  -- as a CHECK can — no scheme, no slash, no space, no uppercase — because
  -- the one thing that must never happen is two rows that are the same domain
  -- written differently, which would defeat the unique index below.
  domain      text not null check (
    domain = lower(domain)
    and domain !~ '[/\s]'
    and domain not like '%:%'
    and domain like '%.%'
  ),

  -- How this domain relates to the company. The kinds are not cosmetic — each
  -- one licenses a different inference:
  --
  --   primary     the domain we would show a user. Exactly one per company.
  --   alternate   a second live domain (a country site, a product site, a
  --               brand). Resolves to the company; does not replace primary.
  --   redirect    observed to redirect to another of this company's domains.
  --               Recorded so the redirect is not re-fetched on every resolve
  --   former      used to be this company (a rename, or a brand retired).
  --               Resolves, but must never be presented as current — a
  --               salesperson emailing @oldname.com is the visible failure
  --   acquired    belonged to a company this one acquired. Resolves to the
  --               acquirer, and the distinction from `former` is that the
  --               acquired entity may still exist
  kind        text not null default 'alternate'
              check (kind in ('primary', 'alternate', 'redirect', 'former', 'acquired')),

  -- How we know. `evidence_id` is the §52 answer and is nullable because the
  -- primary domain of a company created from a CSV import has no evidence
  -- beyond the import itself — which `discovered_via` on the company records.
  evidence_id uuid references evidence(id) on delete set null,
  -- Where the claim came from, when there is no evidence row: 'seed',
  -- 'import', 'provider:apollo', 'redirect-probe', 'user'. Free text for the
  -- same reason `provider_accounts.provider` is.
  asserted_by text not null default 'system',
  confidence  confidence not null default 'medium',

  -- Set by the `resolve_entity` job when it actually followed the redirect.
  -- NULL means "asserted, never probed", which is a different fact.
  verified_at timestamptz,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- The resolution key. One domain belongs to one company within an org.
  --
  -- This is the constraint that makes deduplication real: two discovery runs
  -- that find `acme.io` and `www.acme.com` both attempt an insert here, and
  -- the second one conflicts rather than creating a second company.
  unique (org_id, domain)
);

create index company_domains_company_idx on company_domains (org_id, company_id);

-- Exactly one primary per company. A company with two primaries is a company
-- whose display name flips depending on which row a query happened to read.
create unique index company_domains_one_primary
  on company_domains (org_id, company_id)
  where kind = 'primary';

-- ── Provider ids ──────────────────────────────────────────────────────────
--
-- Deliberately generic over entity type rather than a column on each table.
-- Three reasons, in order of weight:
--
--   1. Apollo has ids for organizations and for people, and adding a
--      `apollo_id` column per table means a migration per provider per entity
--      — which is how a schema acquires `clearbit_id`, `zoominfo_id`,
--      `apollo_id_v2` and a column nobody dares drop.
--   2. Architecture principle 6: Huntloop's ids are canonical and a provider
--      id is an *attribute*. A column on the entity table makes the provider
--      id look like part of the identity. A separate table makes it look like
--      what it is — a foreign system's opinion about our row.
--   3. It is the join that makes incremental discovery cheap: "which of these
--      200 Apollo ids have we already seen" is one indexed query.

create table external_ids (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,

  entity_type  text not null check (entity_type in ('company', 'person', 'competitor')),
  entity_id    uuid not null,

  provider     text not null,
  provider_id  text not null,

  -- The provider's own last-modified stamp where it exposes one. Nullable,
  -- and used by incremental discovery to skip re-enriching a record the
  -- provider has not touched. Without it, "incremental" means "we asked
  -- again and paid again".
  provider_updated_at timestamptz,

  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- One provider id maps to one of our entities. The reverse is not unique:
  -- our company legitimately has an Apollo id and a Clearbit id, and may have
  -- two Apollo ids if Apollo itself has duplicates — which it does, and which
  -- is the point of `ENT-05` flagging rather than merging blindly.
  unique (org_id, provider, provider_id)
);

create index external_ids_entity_idx on external_ids (org_id, entity_type, entity_id);

-- ── Merges ────────────────────────────────────────────────────────────────
--
-- Recorded rather than performed-and-forgotten, because a merge is the one
-- destructive operation in this schema that a person initiates on a hunch.
-- "These two are the same company" is a judgement, judgements are wrong
-- sometimes, and a merge with no record is unrecoverable by construction.

create table company_merges (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,

  winner_id   uuid not null references companies(id) on delete cascade,
  -- Not a foreign key with cascade to `companies`, because the loser row is
  -- soft-deleted rather than removed and must survive to be undone. It is
  -- still a reference — the row exists — but the merge record outliving a
  -- hard delete of the loser is the correct behaviour, so `set null` it is.
  loser_id    uuid references companies(id) on delete set null,

  -- What moved. Counted per table at merge time, so an undo knows what it is
  -- looking for and a reviewer can see the size of what happened without
  -- re-deriving it.
  moved       jsonb not null default '{}'::jsonb,

  reason      text not null,
  -- 'auto' merges happen only at `high` confidence from an exact provider-id
  -- or exact-domain match. Everything softer is proposed and waits for a
  -- person — see `ENT-05`.
  method      text not null default 'manual' check (method in ('manual', 'auto')),
  confidence  confidence not null default 'high',

  merged_by   uuid references auth.users(id) on delete set null,
  merged_at   timestamptz not null default now(),

  -- Set when the merge is reversed. The row is never deleted: "this was
  -- merged and then unmerged" is more useful history than no history.
  reverted_at timestamptz,
  reverted_by uuid references auth.users(id) on delete set null,

  created_at  timestamptz not null default now()
);

create index company_merges_org_idx on company_merges (org_id, merged_at desc);
create index company_merges_loser_idx on company_merges (org_id, loser_id);

-- ── Proposed merges, awaiting a person ────────────────────────────────────
--
-- Separate from `company_merges` on purpose. A proposal is not a merge, and
-- putting both in one table with a `status` column would mean every query
-- about what actually happened has to remember to filter — which is the kind
-- of filter that gets forgotten exactly once, in the query that feeds the
-- undo.

create table merge_candidates (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,

  -- Ordered by the application so the same pair always produces the same row
  -- regardless of which side was discovered first. Without that the unique
  -- index below would let (A,B) and (B,A) both exist.
  company_a_id uuid not null references companies(id) on delete cascade,
  company_b_id uuid not null references companies(id) on delete cascade,

  -- Why we think they are the same. Named rather than scored, because a
  -- reviewer needs to know *which* signal fired: "same Apollo id" and "similar
  -- name in the same country" warrant very different amounts of trust.
  matched_on  text not null check (matched_on in (
    'provider_id', 'domain', 'redirect', 'normalized_name', 'name_and_country'
  )),
  confidence  confidence not null,
  detail      jsonb not null default '{}'::jsonb,

  status      text not null default 'pending'
              check (status in ('pending', 'merged', 'rejected')),
  -- A rejected pair is never proposed again. Storing the rejection is the
  -- only thing that stops the resolver re-suggesting the same wrong pair
  -- every time it runs, which is how a review queue becomes noise.
  decided_by  uuid references auth.users(id) on delete set null,
  decided_at  timestamptz,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint merge_candidates_distinct check (company_a_id <> company_b_id),
  unique (org_id, company_a_id, company_b_id)
);

create index merge_candidates_pending_idx
  on merge_candidates (org_id, created_at desc)
  where status = 'pending';

-- ── Hierarchy ─────────────────────────────────────────────────────────────
--
-- One nullable self-reference, and no more. A corporate structure is a graph
-- and modelling it properly is a project; what the product actually needs is
-- one question answered — "is this account part of a group we are already
-- talking to?" — and a parent pointer answers it.
--
-- `on delete set null` rather than cascade: deleting a parent must not delete
-- its subsidiaries, which is a data-loss bug waiting for the first customer
-- who cleans up a duplicate holding company.

alter table companies
  add column parent_company_id uuid references companies(id) on delete set null,
  add column relationship_kind text
    check (relationship_kind is null or relationship_kind in ('subsidiary', 'division', 'brand', 'acquired')),
  -- Set when a merge folds this row into another. The row stays, soft-deleted,
  -- with a pointer — so a link from an old email, an old job payload or an
  -- external system resolves to the survivor instead of 404ing.
  add column merged_into_id uuid references companies(id) on delete set null;

create index companies_parent_idx on companies (org_id, parent_company_id)
  where parent_company_id is not null;

-- A company cannot be its own parent. Cycles deeper than one are not checked:
-- detecting them needs a recursive query per write, and the failure mode of a
-- two-step cycle is a confusing screen rather than a corrupt one.
alter table companies
  add constraint companies_not_own_parent check (parent_company_id is null or parent_company_id <> id);

alter table companies
  add constraint companies_not_own_merge_target check (merged_into_id is null or merged_into_id <> id);

-- ── Backfill ──────────────────────────────────────────────────────────────
--
-- Every existing company gets its canonical domain as its primary. Without
-- this the resolver would find nothing for rows that predate the table, and
-- would helpfully create duplicates of every company already in the system —
-- which is the exact defect it exists to prevent, caused by its own arrival.
--
-- `on conflict do nothing` because the migration is replayed in the test
-- suite and against a project where it may have been partly applied.

insert into company_domains (org_id, company_id, domain, kind, asserted_by, confidence)
select c.org_id, c.id, c.canonical_domain, 'primary', 'backfill', 'high'
from companies c
where c.canonical_domain is not null
  and c.canonical_domain = lower(c.canonical_domain)
  and c.canonical_domain !~ '[/\s]'
  and c.canonical_domain not like '%:%'
  and c.canonical_domain like '%.%'
on conflict (org_id, domain) do nothing;

-- ── Resolution ────────────────────────────────────────────────────────────
--
-- The read half of entity resolution, as a function rather than as a query in
-- the application, because it is called on the hot path of every discovery
-- result and must be one round trip.
--
-- Deliberately does NOT do fuzzy matching. Exact domain, then exact provider
-- id, and nothing else. Fuzzy matching decides to *propose*, not to resolve,
-- and it lives in `packages/db/src/identity.ts` where it can be unit-tested
-- against a table of cases — which is not a thing SQL is good at.

create or replace function public.resolve_company(
  p_org         uuid,
  p_domain      text default null,
  p_provider    text default null,
  p_provider_id text default null
)
returns table (company_id uuid, matched_on text)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  -- Domain first. It is the stronger signal: a provider id identifies a row
  -- in the provider's database, and providers have duplicates; a domain
  -- identifies a company on the internet.
  --
  -- Each arm is parenthesised because a bare `limit` binds to the whole
  -- UNION rather than to the arm, which is both a syntax error here and the
  -- wrong meaning if it were not.
  (
    select d.company_id, 'domain'::text as matched_on
    from public.company_domains d
    join public.companies c on c.id = d.company_id
    where d.org_id = p_org
      and p_domain is not null
      and d.domain = p_domain
      and c.deleted_at is null
    limit 1
  )

  union all

  (
    select x.entity_id, 'provider_id'::text as matched_on
    from public.external_ids x
    join public.companies c on c.id = x.entity_id
    where x.org_id = p_org
      and x.entity_type = 'company'
      and p_provider is not null
      and p_provider_id is not null
      and x.provider = p_provider
      and x.provider_id = p_provider_id
      and c.deleted_at is null
      -- Only when the domain arm found nothing. `union all` does not
      -- short-circuit, so the exclusion has to be written.
      and not exists (
        select 1 from public.company_domains d2
        where d2.org_id = p_org and p_domain is not null and d2.domain = p_domain
      )
    limit 1
  );
$$;

-- ── Merging ───────────────────────────────────────────────────────────────
--
-- One function, one transaction. Six tables have to move together, and a
-- merge that moved four of them would leave a company whose evidence belongs
-- to a row the user can no longer see.
--
-- What it does NOT do is delete the loser. Soft delete plus `merged_into_id`
-- keeps every existing foreign key valid, keeps old links working, and is
-- what makes the undo a possible thing to write rather than a restore from
-- backup.

create or replace function public.merge_companies(
  p_org      uuid,
  p_winner   uuid,
  p_loser    uuid,
  p_reason   text,
  p_actor    uuid default null,
  p_method   text default 'manual',
  p_confidence confidence default 'high'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_merge uuid;
  v_moved jsonb := '{}'::jsonb;
  v_n     integer;
begin
  if p_winner = p_loser then
    raise exception 'merge_companies: winner and loser are the same company';
  end if;

  -- Both must be in the org named. This is the check that makes the function
  -- safe to expose to a Server Action: without it, a caller who could name
  -- any two uuids could move another tenant's rows onto their own company.
  if not exists (
    select 1 from public.companies where id = p_winner and org_id = p_org and deleted_at is null
  ) then
    raise exception 'merge_companies: winner % is not a live company in org %', p_winner, p_org;
  end if;

  if not exists (
    select 1 from public.companies where id = p_loser and org_id = p_org and deleted_at is null
  ) then
    raise exception 'merge_companies: loser % is not a live company in org %', p_loser, p_org;
  end if;

  -- Domains move first, because the unique index on (org, domain) means a
  -- conflict here has to be resolved before anything else is touched. A
  -- domain the winner already owns is simply dropped from the loser.
  delete from public.company_domains d
  where d.org_id = p_org and d.company_id = p_loser
    and exists (
      select 1 from public.company_domains w
      where w.org_id = p_org and w.company_id = p_winner and w.domain = d.domain
    );

  -- Whatever survives becomes an alternate. Two primaries would violate
  -- `company_domains_one_primary`, and the winner's is the one that stays.
  update public.company_domains
    set company_id = p_winner,
        kind = case when kind = 'primary' then 'alternate' else kind end,
        updated_at = now()
    where org_id = p_org and company_id = p_loser;
  get diagnostics v_n = row_count;
  v_moved := v_moved || jsonb_build_object('company_domains', v_n);

  -- Provider ids: same conflict rule. `(org, provider, provider_id)` is
  -- unique, so a shared id is dropped rather than moved.
  delete from public.external_ids x
  where x.org_id = p_org and x.entity_type = 'company' and x.entity_id = p_loser
    and exists (
      select 1 from public.external_ids w
      where w.org_id = p_org and w.entity_type = 'company' and w.entity_id = p_winner
        and w.provider = x.provider and w.provider_id = x.provider_id
    );

  update public.external_ids
    set entity_id = p_winner, updated_at = now()
    where org_id = p_org and entity_type = 'company' and entity_id = p_loser;
  get diagnostics v_n = row_count;
  v_moved := v_moved || jsonb_build_object('external_ids', v_n);

  update public.people set company_id = p_winner, updated_at = now()
    where org_id = p_org and company_id = p_loser;
  get diagnostics v_n = row_count;
  v_moved := v_moved || jsonb_build_object('people', v_n);

  update public.company_problems set company_id = p_winner, updated_at = now()
    where org_id = p_org and company_id = p_loser;
  get diagnostics v_n = row_count;
  v_moved := v_moved || jsonb_build_object('company_problems', v_n);

  update public.company_gaps set company_id = p_winner, updated_at = now()
    where org_id = p_org and company_id = p_loser;
  get diagnostics v_n = row_count;
  v_moved := v_moved || jsonb_build_object('company_gaps', v_n);

  update public.company_triggers set company_id = p_winner, updated_at = now()
    where org_id = p_org and company_id = p_loser;
  get diagnostics v_n = row_count;
  v_moved := v_moved || jsonb_build_object('company_triggers', v_n);

  update public.source_events set company_id = p_winner
    where org_id = p_org and company_id = p_loser;
  get diagnostics v_n = row_count;
  v_moved := v_moved || jsonb_build_object('source_events', v_n);

  -- Opportunities are the delicate one. `(org, company, icp)` is unique with
  -- NULLS NOT DISTINCT, so moving the loser's opportunity onto the winner
  -- collides whenever both were qualified against the same ICP.
  --
  -- The colliding one is soft-deleted rather than merged field by field.
  -- Combining two verdicts would mean inventing a rule for which `why_now`
  -- survives, and an invented rule presented as Huntloop's reasoning is
  -- exactly what §7 forbids. The winner's verdict stands; the loser's is
  -- retained, deleted, and reachable from the merge record.
  update public.opportunities o
    set deleted_at = now(), updated_at = now()
    where o.org_id = p_org and o.company_id = p_loser
      and exists (
        select 1 from public.opportunities w
        where w.org_id = p_org and w.company_id = p_winner and w.deleted_at is null
          and w.icp_id is not distinct from o.icp_id
      );
  get diagnostics v_n = row_count;
  v_moved := v_moved || jsonb_build_object('opportunities_superseded', v_n);

  update public.opportunities set company_id = p_winner, updated_at = now()
    where org_id = p_org and company_id = p_loser and deleted_at is null;
  get diagnostics v_n = row_count;
  v_moved := v_moved || jsonb_build_object('opportunities', v_n);

  -- The loser itself: soft-deleted, pointing at the survivor.
  update public.companies
    set deleted_at = coalesce(deleted_at, now()),
        merged_into_id = p_winner,
        updated_at = now()
    where id = p_loser and org_id = p_org;

  insert into public.company_merges (org_id, winner_id, loser_id, moved, reason, method, confidence, merged_by)
  values (p_org, p_winner, p_loser, v_moved, p_reason, p_method, p_confidence, p_actor)
  returning id into v_merge;

  -- Any pending proposal about this pair is now settled.
  update public.merge_candidates
    set status = 'merged', decided_by = p_actor, decided_at = now(), updated_at = now()
    where org_id = p_org
      and status = 'pending'
      and ((company_a_id = p_winner and company_b_id = p_loser)
        or (company_a_id = p_loser and company_b_id = p_winner));

  return v_merge;
end;
$$;

-- ── RLS ───────────────────────────────────────────────────────────────────

do $$
declare t text;
begin
  foreach t in array array['company_domains', 'external_ids', 'company_merges', 'merge_candidates']
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
  end loop;
end
$$;

create trigger company_domains_touch before update on public.company_domains
  for each row execute function public.touch_updated_at();
create trigger external_ids_touch before update on public.external_ids
  for each row execute function public.touch_updated_at();
create trigger merge_candidates_touch before update on public.merge_candidates
  for each row execute function public.touch_updated_at();

-- `company_merges` is append-only apart from the two revert columns, and has
-- no `updated_at`. Same reasoning as `provider_calls`.

-- ── Lockdown ──────────────────────────────────────────────────────────────
--
-- `merge_companies` takes an org and checks membership of nothing — it is the
-- engine's function, and the engine has already resolved its tenant. A member
-- reaching it directly could name any org. So it is service-role only, and
-- the wrapper below is what a Server Action calls.

create or replace function public.merge_companies_for_org(
  p_org    uuid,
  p_winner uuid,
  p_loser  uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if not public.has_org_role(p_org, 'member') then
    raise exception 'merge_companies_for_org: not a member of %', p_org;
  end if;
  return public.merge_companies(p_org, p_winner, p_loser, p_reason, auth.uid(), 'manual', 'high');
end;
$$;

do $$
begin
  revoke execute on function
    public.merge_companies(uuid, uuid, uuid, text, uuid, text, confidence),
    public.resolve_company(uuid, text, text, text)
  from public, anon, authenticated;

  grant execute on function
    public.merge_companies(uuid, uuid, uuid, text, uuid, text, confidence),
    public.resolve_company(uuid, text, text, text)
  to service_role;
exception when undefined_object or undefined_function then null;
end $$;
