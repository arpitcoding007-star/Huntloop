-- ============================================================================
-- 0025 — What we learned about a visitor who has no account yet
--
-- ── Why this table exists ────────────────────────────────────────────────
--
-- The landing page's primary call to action is a domain input, not a button.
-- A visitor types `acme.com`, Huntloop reads the site, and shows them what it
-- understood — before there is an account, a session, or an organisation.
-- That is the whole funnel: the sign-up wall moves to *after* the value
-- instead of in front of it, and the visitor arrives at onboarding with step
-- two already answered.
--
-- Which leaves a research result belonging to nobody. Every other table in
-- this schema is keyed on `org_id`, and this row predates the org by
-- definition.
--
-- ── Why it is a table and not a cache ────────────────────────────────────
--
-- It is both, and the caching half is the cheap half. Two reasons it has to
-- be durable:
--
--   1. **Cost.** Reading a site is several page fetches and a model call. The
--      second visitor from the same company — and there will be a second
--      visitor from the same company, because that is what a landing page is
--      for — must not pay for it again.
--   2. **The claim.** When somebody signs up with an address at a domain we
--      have already researched, that research is theirs, and handing it to
--      them is what makes the funnel continuous rather than a demo followed by
--      an unrelated form.
--
-- ── The security posture, stated plainly ─────────────────────────────────
--
-- RLS is enabled and **no policy is created**. That is deliberate and it is
-- the entire access control: with RLS on and no policy, PostgREST can read
-- nothing here for any role that respects RLS. Writes come from the service
-- role (which bypasses RLS) in a server-side route, and the one read a tenant
-- needs — claiming their own domain at signup — goes through the SECURITY
-- DEFINER function at the bottom, which decides for itself who may see what.
--
-- The alternative, a policy like `for select using (true)`, would turn this
-- into a public index of which companies have been researched, joined to when
-- and from roughly where. That is a competitive-intelligence leak about our
-- own visitors.
-- ============================================================================

create table if not exists public.public_research (
  id               uuid primary key default gen_random_uuid(),

  -- The key. Canonicalised by `canonicalizeDomain()` in `identity.ts` before
  -- it ever reaches here, so `https://www.Acme.com/pricing`, `acme.com` and
  -- `WWW.ACME.COM` are one row rather than three cache misses.
  canonical_domain text not null unique,

  -- The `research_company` result, whole. Stored as the task returned it
  -- rather than shredded into columns: it is replayed into the onboarding
  -- review screen verbatim, and a shape that had to be reassembled from
  -- columns would drift from the shape the screen renders.
  understanding    jsonb not null,

  -- Whether a model actually ran, or the deployment has no key and this is a
  -- worked example. Carried because the review screen says so out loud, and a
  -- cached example silently promoted to a real reading is exactly the §7
  -- failure the onboarding screens already guard against.
  is_live          boolean not null default false,

  -- Claimed when somebody signs up with an email at this domain. Weak
  -- verification — a shared mailbox at the domain is not proof of employment —
  -- so it is used to pre-fill and never to grant access to anything.
  claimed_by       uuid references auth.users(id) on delete set null,
  claimed_at       timestamptz,
  claimed_org_id   uuid references public.organizations(id) on delete set null,

  -- Abuse accounting for an unauthenticated endpoint. Hashed rather than
  -- stored: the question this answers is "is one source hammering us", which a
  -- hash answers exactly as well as an address, and an `inet` column here
  -- would be personal data about people who never became customers.
  ip_hash          text,
  request_count    integer not null default 1 check (request_count >= 0),

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  -- Research goes stale. A company's site changes, and a nine-month-old
  -- reading presented as current would be wrong in exactly the way this
  -- product exists not to be. `enforce_retention` sweeps these; until it runs,
  -- readers filter on it.
  expires_at       timestamptz not null default now() + interval '30 days',

  -- A claimed row names who claimed it. Two columns that must agree or the
  -- claim is unattributable.
  constraint public_research_claim_is_whole
    check ((claimed_by is null) = (claimed_at is null))
);

create index if not exists public_research_expiry_idx
  on public.public_research (expires_at);

-- Unclaimed and unexpired: the set the claim path searches at signup.
create index if not exists public_research_unclaimed_idx
  on public.public_research (canonical_domain)
  where claimed_by is null;

comment on table public.public_research is
  'Research produced for a visitor with no account. Pre-tenant data: RLS is '
  'on with no policy, so nothing reads it through PostgREST — the service '
  'role writes it and claim_research() hands it back.';

alter table public.public_research enable row level security;

-- No policy. See the header. This is not an omission and adding one to
-- "make it readable" would undo the access control.

create trigger public_research_touch before update on public.public_research
  for each row execute function public.touch_updated_at();

-- ── Claiming ───────────────────────────────────────────────────────────────
--
-- Called once, right after a user signs in for the first time, with the domain
-- of their email address. Returns the research if there is unexpired,
-- unclaimed research for that domain — and marks it claimed in the same
-- statement, so two tabs racing produce one claim.
--
-- SECURITY DEFINER because the caller is a signed-in user and the table has no
-- policy that would let them see the row. The authorization is inside:
--
--   1. There is a signed-in user.
--   2. The domain is passed by the *caller*, so it is checked against the
--      caller's own verified email address rather than trusted. This is the
--      load-bearing check — without it any signed-in user could claim the
--      research for any company, which is a free read of what we understood
--      about somebody else's business.
--
-- (2) is why the function takes no domain argument at all. Deriving it from
-- `auth.users` inside the function means there is nothing for a caller to
-- tamper with, which is a stronger guarantee than validating an argument.

create or replace function public.claim_research()
returns table (research_domain text, understanding jsonb, is_live boolean)
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
    raise exception 'claim_research requires an authenticated caller';
  end if;

  select (to_jsonb(u) ->> 'email') into v_email
    from auth.users u where u.id = v_user;

  if v_email is null or position('@' in v_email) = 0 then
    return;
  end if;

  -- Lowercased to match `canonicalizeDomain`, which lowercases. A domain is
  -- case-insensitive and two casings must not be two cache entries.
  v_domain := lower(split_part(v_email, '@', 2));
  if v_domain = '' then
    return;
  end if;

  -- Claim and read in one statement. Two statements would let two sign-ins
  -- from the same domain in the same second both see it unclaimed and both
  -- claim it — harmless here, but the same shape as a real double-spend, and
  -- writing it correctly costs nothing.
  return query
    update public.public_research r
       set claimed_by = v_user,
           claimed_at = now()
     where r.canonical_domain = v_domain
       and r.claimed_by is null
       and r.expires_at > now()
    returning r.canonical_domain, r.understanding, r.is_live;
end;
$$;

comment on function public.claim_research is
  'Hands a new user the research done for their email domain before they had '
  'an account. Takes no argument on purpose: the domain is derived from the '
  'caller''s verified address, so there is nothing to tamper with.';

do $$
begin
  revoke execute on function public.claim_research() from public, anon;
  grant execute on function public.claim_research() to authenticated, service_role;
exception when undefined_object or undefined_function then null;
end $$;

-- ── Retention ──────────────────────────────────────────────────────────────
--
-- Swept rather than left to accumulate. This is data about people who are not
-- customers and in most cases never will be, which is the category where "we
-- kept it because storage is cheap" is the wrong answer.
--
-- Claimed rows are deleted too, and on the same schedule. The claim copied
-- what it needed into the org's own `products` row; keeping the original after
-- that is keeping a second copy of a customer's data outside their tenant.

create or replace function public.purge_expired_research()
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_deleted integer;
begin
  delete from public.public_research where expires_at <= now();
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

do $$
begin
  revoke execute on function public.purge_expired_research() from public, anon, authenticated;
  grant execute on function public.purge_expired_research() to service_role;
exception when undefined_object or undefined_function then null;
end $$;
