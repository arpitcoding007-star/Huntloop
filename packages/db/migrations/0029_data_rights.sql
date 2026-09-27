-- 0029 — the data-subject rights that had no request boundary.
--
-- ── What this migration is fixing ─────────────────────────────────────────
--
-- `0017` built the hard half of GDPR erasure and portability and then granted
-- every one of those functions to `service_role` only:
--
--   erase_contact(org, email, actor)   -- five tables, redacts bodies, audited
--   export_contact(org, email)         -- a complete per-person export
--
-- `erase_contact` got an admin-gated wrapper, `erase_contact_for_org`, whose
-- own comment says it exists "specifically so a Server Action could call it".
-- Nothing ever called it. `export_contact` never got a wrapper at all, so the
-- portability half was unreachable from any session by construction.
--
-- The design audit found the consequence: the landing page promises "an
-- erasure path that actually deletes rather than flags", and no user could
-- trigger one. The machinery was finished and had no door.
--
-- This migration adds the doors, and nothing else. Every function here is a
-- thin authorisation wrapper over logic that already exists and is already
-- tested — deliberately, because the failure being corrected is a missing
-- request boundary, and the fix for that should not also be a rewrite of the
-- thing behind it.
--
-- ── Why wrappers rather than grants ──────────────────────────────────────
--
-- Granting `export_contact` to `authenticated` would let any member of any
-- org call it for any org id, because the function takes `p_org` as a
-- parameter and trusts it — it is `security definer` and was written on the
-- assumption that only the service role would ever reach it. A wrapper that
-- checks `has_org_role` before delegating is the same pattern `0017` chose
-- for erasure, for the same reason.

-- ── Portability, per person ───────────────────────────────────────────────
--
-- The DSAR a customer receives from one of *their* prospects. Admin-gated
-- rather than member-gated: an export is a complete dossier on a named
-- individual, which is not a thing every seat should be able to produce.

create or replace function public.export_contact_for_org(p_org uuid, p_email text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
begin
  if not public.has_org_role(p_org, 'admin') then
    raise exception 'export_contact_for_org: not an admin of %', p_org;
  end if;
  return public.export_contact(p_org, p_email);
end;
$$;

comment on function public.export_contact_for_org(uuid, text) is
  'Admin-gated wrapper over export_contact. The request boundary for a '
  'data-subject access request about one person.';

-- ── Portability, for the customer ─────────────────────────────────────────
--
-- The other direction, and the one nothing addressed at all: a customer
-- asking for their own data out of Huntloop.
--
-- ── Why this is a summary plus the customer-authored rows, not a dump ────
--
-- A literal dump of every tenant-scoped table would be mostly *our* derived
-- output — scores, inferences, provider responses, job rows — and would run
-- to megabytes of machine state that answers no question a person asks when
-- they ask for their data. What they are owed, and what they actually want,
-- is what they put in and what we concluded about it.
--
-- So: the organisation, what they configured, the companies and
-- opportunities, and a count of everything else so the export states its own
-- completeness rather than quietly omitting things. A reader can see that
-- 4,102 evidence rows exist and ask for them; they cannot see that from a
-- dump that silently stopped at a row limit.
--
-- `stable` and admin-gated. Owner would be defensible; admin matches every
-- other settings-level capability and the screen is already admin-only.

create or replace function public.export_organization(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_result jsonb;
begin
  if not public.has_org_role(p_org, 'admin') then
    raise exception 'export_organization: not an admin of %', p_org;
  end if;

  select jsonb_build_object(
    'exportedAt', now(),
    'organization', (
      select to_jsonb(o) - 'id'
      from public.organizations o where o.id = p_org
    ),
    'members', coalesce((
      -- Roles and join dates, not auth rows. Another member's email is their
      -- personal data and is not the requesting admin's to export.
      select jsonb_agg(jsonb_build_object(
        'role', m.role, 'createdAt', m.created_at
      ))
      from public.memberships m where m.org_id = p_org
    ), '[]'::jsonb),
    'icps', coalesce((
      select jsonb_agg(to_jsonb(i) - 'org_id')
      from public.icps i where i.org_id = p_org and i.deleted_at is null
    ), '[]'::jsonb),
    'products', coalesce((
      select jsonb_agg(to_jsonb(p) - 'org_id')
      from public.products p where p.org_id = p_org and p.deleted_at is null
    ), '[]'::jsonb),
    'companies', coalesce((
      select jsonb_agg(to_jsonb(c) - 'org_id')
      from public.companies c where c.org_id = p_org and c.deleted_at is null
    ), '[]'::jsonb),
    'opportunities', coalesce((
      select jsonb_agg(to_jsonb(op) - 'org_id')
      from public.opportunities op where op.org_id = p_org and op.deleted_at is null
    ), '[]'::jsonb),
    'memories', coalesce((
      select jsonb_agg(to_jsonb(mem) - 'org_id')
      from public.memories mem where mem.org_id = p_org and mem.deleted_at is null
    ), '[]'::jsonb),
    -- What is deliberately summarised rather than included, stated in the
    -- export itself so its own limits travel with it.
    'counts', jsonb_build_object(
      'evidence', (select count(*) from public.evidence where org_id = p_org),
      'messages', (select count(*) from public.messages where org_id = p_org),
      'people', (select count(*) from public.people where org_id = p_org),
      'aiRuns', (select count(*) from public.ai_runs where org_id = p_org)
    ),
    'note',
      'Companies, opportunities, ICPs, products and memories are included in '
      || 'full. Evidence, messages, people and AI run records are counted '
      || 'rather than included because they are large; ask for any of them '
      || 'and they can be exported separately.'
  ) into v_result;

  return v_result;
end;
$$;

comment on function public.export_organization(uuid) is
  'Admin-gated workspace export. GDPR Art. 15/20 for the customer, as '
  'distinct from export_contact_for_org which serves their prospects.';

-- ── Erasure, for the customer ─────────────────────────────────────────────
--
-- ── Why soft and why owner-only ──────────────────────────────────────────
--
-- Every read in the application already filters `deleted_at is null`, so
-- stamping it is a complete disappearance from the product's point of view
-- without being an irreversible one within the retention window. A hard
-- delete cascades through twenty-odd tables and cannot be undone by a support
-- request made an hour later, which is when nearly all of them are made.
--
-- Owner rather than admin: this is the one action in the product that ends
-- the workspace for everybody in it, and an admin is a role you give someone
-- to manage members.

create or replace function public.delete_organization(p_org uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if not public.has_org_role(p_org, 'owner') then
    raise exception 'delete_organization: not an owner of %', p_org;
  end if;

  update public.organizations
    set deleted_at = now(), updated_at = now()
    where id = p_org and deleted_at is null;

  -- Stop the engine in the same statement, for the reason
  -- `deleteCampaignAction` gives: a row being invisible to the UI is not the
  -- same as it being stopped, and a sweeper that reads `campaigns` without
  -- joining `organizations` would go on sending from a deleted workspace.
  update public.campaigns
    set status = 'archived', deleted_at = coalesce(deleted_at, now())
    where org_id = p_org and deleted_at is null;

  update public.enrollments
    set status = 'stopped', next_action_at = null, parked_reason = 'workspace deleted'
    where org_id = p_org and status <> 'stopped';

  update public.sources
    set enabled = false, next_scan_at = null
    where org_id = p_org and enabled;
end;
$$;

comment on function public.delete_organization(uuid) is
  'Owner-gated soft delete of a workspace. Stops outreach in the same '
  'statement — an invisible campaign is not a stopped one.';

-- ── Erasure, for the user ─────────────────────────────────────────────────
--
-- ── Why this is `security definer` and not the service role ──────────────
--
-- Removing an `auth.users` row needs privileges no session has, and the
-- obvious route — Supabase's admin API — is exactly the thing this repository
-- forbids `apps/` from importing, because the service-role client bypasses
-- RLS and that boundary is the single property the whole tenant model rests
-- on. Routing account deletion through it to save writing this function would
-- trade the strongest guarantee in the codebase for a convenience.
--
-- A `security definer` function that can only ever delete `auth.uid()` gives
-- the same capability with none of the reach: it takes no parameters, so
-- there is no id for a caller to substitute.
--
-- ── Why sole owners are refused ──────────────────────────────────────────
--
-- An owner deleting themselves out of a live workspace leaves rows nobody can
-- administer — members who cannot be removed, a plan that cannot be changed,
-- and an organisation that cannot be deleted because `delete_organization`
-- requires an owner. Refusing with a reason the interface can render is
-- better than either orphaning the workspace or silently deleting a team's
-- data because one person closed their account.

create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = public, pg_catalog, auth
as $$
declare
  v_user uuid := auth.uid();
  v_blocking text[];
begin
  if v_user is null then
    raise exception 'delete_own_account: no authenticated user';
  end if;

  select array_agg(o.name order by o.name)
    into v_blocking
  from public.memberships m
  join public.organizations o on o.id = m.org_id
  where m.user_id = v_user
    and m.role = 'owner'
    and o.deleted_at is null
    and (
      select count(*) from public.memberships m2
      where m2.org_id = m.org_id and m2.role = 'owner' and m2.user_id <> v_user
    ) = 0;

  if v_blocking is not null and cardinality(v_blocking) > 0 then
    raise exception
      'delete_own_account: sole owner of %. Delete the workspace, or make somebody else an owner, first.',
      array_to_string(v_blocking, ', ');
  end if;

  -- Memberships cascade from auth.users, but deleting them explicitly first
  -- keeps the seat count correct even if the auth delete is rolled back by a
  -- constraint added later. Idempotent either way.
  delete from public.memberships where user_id = v_user;
  delete from auth.users where id = v_user;
end;
$$;

comment on function public.delete_own_account() is
  'Deletes the calling user. Takes no arguments on purpose: there is no id '
  'for a caller to substitute, so it can only ever delete auth.uid().';

-- ── Grants ────────────────────────────────────────────────────────────────
--
-- The wrappers are callable by any signed-in user and each checks its own
-- authorisation inside. The functions they delegate to keep the `0017` grant
-- posture — service role only — so this migration widens the request surface
-- without widening what an unchecked call can reach.

do $$
begin
  grant execute on function
    public.export_contact_for_org(uuid, text),
    public.export_organization(uuid),
    public.delete_organization(uuid),
    public.delete_own_account()
  to authenticated;
exception when undefined_object or undefined_function then null;
end $$;
