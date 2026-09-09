-- ============================================================================
-- 0027 — "Three people from your company already use Huntloop"
--
-- ── The problem ──────────────────────────────────────────────────────────
--
-- A second person at a customer signs up, sees an empty onboarding flow, and
-- creates a *second workspace* for a company that already has one. They then
-- build a second ICP, connect a second set of sources, and spend a second set
-- of provider credits hunting the same market — and neither of them finds out
-- until somebody notices two people at the same company describing the same
-- pipeline differently.
--
-- Nothing in the schema could prevent it, because nothing could *see* it. RLS
-- resolves every organisation read through `user_org_ids()`, so a user who is
-- not a member of an org cannot learn that it exists — which is correct, and
-- is exactly what makes this impossible to detect from the application.
--
-- ── What this leaks, deliberately, and to whom ───────────────────────────
--
-- `discoverable_workspaces()` tells the caller which workspaces exist at
-- **their own verified email domain**, and nothing else. Somebody with an
-- `@acme.com` address learns that Acme has a Huntloop workspace.
--
-- That is a real disclosure and it is the right one. The audience is the
-- customer's own colleagues, it is the same trust model every team product
-- uses for domain discovery, and the alternative — silence — produces
-- duplicate workspaces and duplicate bills. What it must never become is a
-- lookup for an arbitrary domain, which is why the function takes no argument
-- and derives the domain from `auth.users` inside itself. There is nothing for
-- a caller to tamper with, exactly as in `claim_research()` (`0025`).
--
-- Two further limits, both load-bearing:
--
--   · Only the org's **name, slug and member count**. Never its ICP, its
--     pipeline, or who the members are. Enough to recognise your employer;
--     not enough to learn anything about their business.
--   · Only orgs that have **opted in** via `is_discoverable`, which defaults
--     to true for a domain-derived workspace and can be turned off. A company
--     that does not want to be findable by its own domain says so once.
-- ============================================================================

-- ── The domain a workspace belongs to ──────────────────────────────────────

alter table public.organizations
  -- Canonicalised by `canonicalizeDomain()` before it is written, so
  -- `www.Acme.com` and `acme.com` are one domain rather than two workspaces
  -- that cannot see each other.
  --
  -- Nullable, and NULL is common: an org created before this migration has no
  -- domain, and one whose product row has no website never gets one. NULL is
  -- never discoverable — see the function below — which is the safe direction.
  add column if not exists primary_domain text,

  -- Whether colleagues may find this workspace by its domain.
  --
  -- Defaults true because the failure it prevents (duplicate workspaces) is
  -- silent and expensive, while the failure it risks (a colleague sees the
  -- company name they already work for) is neither. An org that wants
  -- otherwise turns it off, and the column exists so that is one update rather
  -- than a schema change.
  add column if not exists is_discoverable boolean not null default true;

-- Partial: the only question ever asked of this column is "which discoverable
-- workspaces are at this domain", so an index over the rest is dead weight.
create index if not exists organizations_domain_idx
  on public.organizations (primary_domain)
  where primary_domain is not null
    and is_discoverable
    and deleted_at is null;

comment on column public.organizations.primary_domain is
  'The company domain this workspace is for, canonicalised. Used only by '
  'discoverable_workspaces(), which matches it against the caller''s own '
  'verified email domain — never against a domain a caller supplies.';

-- ── Backfill ───────────────────────────────────────────────────────────────
--
-- From the product's website, which is where the domain came from in the first
-- place for anything created by the onboarding flow. Deliberately crude: strip
-- the scheme, strip `www.`, take the host. Anything that does not yield a
-- plausible hostname is left NULL rather than guessed at, because a wrong
-- domain here puts a stranger's workspace in front of somebody.

update public.organizations o
   set primary_domain = lower(
         split_part(
           regexp_replace(
             regexp_replace(p.website, '^https?://', '', 'i'),
             '^www\.', '', 'i'
           ),
           '/', 1
         )
       )
  from public.products p
 where p.org_id = o.id
   and o.primary_domain is null
   and p.website is not null
   and p.deleted_at is null
   -- A host with a dot and no whitespace. Everything else stays NULL.
   and regexp_replace(regexp_replace(p.website, '^https?://', '', 'i'), '^www\.', '', 'i') ~ '^[^\s/]+\.[^\s/.]{2,}';

-- ── Who else is at my domain ───────────────────────────────────────────────

create or replace function public.discoverable_workspaces()
returns table (org_id uuid, org_name text, org_slug text, member_count bigint)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_user   uuid := auth.uid();
  v_email  text;
  v_domain text;
begin
  if v_user is null then
    raise exception 'discoverable_workspaces requires an authenticated caller';
  end if;

  select (to_jsonb(u) ->> 'email') into v_email
    from auth.users u where u.id = v_user;

  if v_email is null or position('@' in v_email) = 0 then
    return;
  end if;

  v_domain := lower(split_part(v_email, '@', 2));
  if v_domain = '' then
    return;
  end if;

  /* Free-mail domains are refused outright. `gmail.com` is not a company, and
     answering for it would hand every Gmail user the list of every workspace
     anybody ever created from a Gmail address. The application keeps its own
     longer list; this is the floor, in the place that cannot be bypassed. */
  if v_domain in (
    'gmail.com','googlemail.com','outlook.com','hotmail.com','live.com',
    'yahoo.com','icloud.com','me.com','aol.com','proton.me','protonmail.com',
    'gmx.com','mail.com','yandex.com','zoho.com','fastmail.com'
  ) then
    return;
  end if;

  return query
    select o.id,
           o.name,
           o.slug,
           (select count(*) from public.memberships m
             where m.org_id = o.id and m.deleted_at is null)
      from public.organizations o
     where o.primary_domain = v_domain
       and o.is_discoverable
       and o.deleted_at is null
       -- Workspaces the caller already belongs to are not a discovery.
       and not exists (
         select 1 from public.memberships m
          where m.org_id = o.id and m.user_id = v_user and m.deleted_at is null
       );
end;
$$;

comment on function public.discoverable_workspaces is
  'Workspaces at the caller''s own verified email domain. Takes no argument on '
  'purpose: the domain is derived from auth.users, so it cannot be pointed at '
  'a company the caller has no address at.';

do $$
begin
  revoke execute on function public.discoverable_workspaces() from public, anon;
  grant execute on function public.discoverable_workspaces() to authenticated, service_role;
exception when undefined_object or undefined_function then null;
end $$;

-- ── Asking to join ─────────────────────────────────────────────────────────
--
-- Detection without a way to act on it is a worse product than no detection:
-- "three colleagues already use Huntloop" followed by no button leaves
-- somebody with a problem they cannot solve and a workspace they still have to
-- duplicate.
--
-- This is deliberately not an invitation in reverse. An invitation is issued
-- by an admin to an address they chose; a join request is made by a person to
-- an org that must approve it. They need different tables because they trust
-- different parties.

create table if not exists public.join_requests (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,

  -- Recorded at request time rather than read from auth.users at approval
  -- time. An admin approving next week is approving the address that asked,
  -- and a user who changed their email in between has not thereby been
  -- approved for the new one.
  email       text not null,

  status      text not null default 'pending'
                check (status in ('pending', 'approved', 'declined')),
  decided_by  uuid references auth.users(id) on delete set null,
  decided_at  timestamptz,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- One live request per person per org. Partial, so a declined request can be
-- made again later — circumstances change, and a permanent block on asking is
-- not something a mis-click should be able to create.
create unique index if not exists join_requests_pending_idx
  on public.join_requests (org_id, user_id)
  where status = 'pending';

create index if not exists join_requests_org_idx
  on public.join_requests (org_id) where status = 'pending';

alter table public.join_requests enable row level security;

-- Admins see and decide their org's requests. There is deliberately no policy
-- letting a requester read the table: they are not a member, every policy in
-- this schema refuses them, and the two things they need — making a request
-- and knowing it was made — go through the functions below.
create policy join_request_admin on public.join_requests
  for all using (public.has_org_role(org_id, 'admin'))
  with check (public.has_org_role(org_id, 'admin'));

create trigger join_requests_touch before update on public.join_requests
  for each row execute function public.touch_updated_at();

/*
 * Ask to join.
 *
 * SECURITY DEFINER because the caller is by definition not a member. The
 * checks inside are therefore the whole authorization, and the second one is
 * the load-bearing one: a request may only be made to an org the caller could
 * already *see* through `discoverable_workspaces()`. Without it this becomes a
 * way to send an unsolicited request to any org whose uuid you can guess, and
 * an admin screen full of strangers.
 */
create or replace function public.request_to_join(p_org uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_user  uuid := auth.uid();
  v_email text;
begin
  if v_user is null then
    raise exception 'request_to_join requires an authenticated caller';
  end if;

  if not exists (select 1 from public.discoverable_workspaces() w where w.org_id = p_org) then
    raise exception 'that workspace is not one you can ask to join';
  end if;

  select (to_jsonb(u) ->> 'email') into v_email from auth.users u where u.id = v_user;

  insert into public.join_requests (org_id, user_id, email)
  values (p_org, v_user, v_email)
  -- Asking twice is not an error. The partial unique index makes the second
  -- insert a no-op, and the caller is told the truth either way.
  on conflict do nothing;

  return 'pending';
end;
$$;

/*
 * Approve one, and create the membership in the same statement.
 *
 * Not SECURITY DEFINER: the caller is an admin of the org, `join_request_admin`
 * lets them update the row, and `membership_write` lets them create the
 * membership. Everything this needs is already granted, so running it as the
 * definer would be taking a privilege the caller does not need.
 */
create or replace function public.approve_join_request(p_request uuid)
returns uuid
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_req public.join_requests%rowtype;
begin
  -- The RLS policy is what makes this safe: a non-admin's select finds
  -- nothing, and the raise below is what they get.
  select * into v_req from public.join_requests
   where id = p_request and status = 'pending';

  if not found then
    raise exception 'that join request is no longer pending';
  end if;

  insert into public.memberships (org_id, user_id, role, invited_by)
  values (v_req.org_id, v_req.user_id, 'member', auth.uid())
  on conflict (org_id, user_id) do update
    set deleted_at = null;

  update public.join_requests
     set status = 'approved', decided_by = auth.uid(), decided_at = now()
   where id = p_request;

  return v_req.org_id;
end;
$$;

do $$
begin
  revoke execute on function public.request_to_join(uuid) from public, anon;
  grant execute on function public.request_to_join(uuid) to authenticated, service_role;
  revoke execute on function public.approve_join_request(uuid) from public, anon;
  grant execute on function public.approve_join_request(uuid) to authenticated, service_role;
exception when undefined_object or undefined_function then null;
end $$;
