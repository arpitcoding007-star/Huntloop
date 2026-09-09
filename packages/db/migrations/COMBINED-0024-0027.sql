-- ============================================================================
-- Huntloop — twelfth pass migrations, 0024 through 0027
--
-- Paste the whole file into the Supabase SQL Editor and run it once.
--
-- Wrapped in a single transaction: these four are one logical change and a
-- partial application is the worst outcome available. 0027 backfills
-- primary_domain from 0026-era product rows, and 0024 backfills onboarding
-- state from icps — so stopping halfway leaves a schema no version of the
-- code expects.
--
-- Every statement is additive: new columns with defaults, new tables, new
-- functions. Nothing is dropped and no existing row loses data. Safe to run
-- against a live database with traffic on it.
-- ============================================================================

begin;


-- ==========================================================================
-- 0024_onboarding.sql
-- ==========================================================================

-- ============================================================================
-- 0024 — Onboarding that survives a page refresh
--
-- ── Why this migration exists ────────────────────────────────────────────
--
-- `ONB-01`, from the twelfth pass. The `/welcome` flow asked four screens
-- worth of questions — the company research, the ICP, the accepted sources —
-- and wrote exactly two rows: `organizations` and `memberships`. Everything
-- else went into `sessionStorage` (`lib/onboarding/draft.ts`), and the last
-- step called `clearDraft()` before navigating to the dashboard.
--
-- So a user answered every question and arrived at a workspace that knew
-- their organisation's name and nothing else. `products`, `icps`, `personas`
-- and `sources` were never written by onboarding at all. The draft module's
-- own header describes itself as a seam awaiting `packages/db`; `packages/db`
-- has been live since `0013`.
--
-- Persisting the answers is application work and needs no migration — the
-- tables have existed since `0002`. What needs a migration is the three facts
-- that had nowhere to live:
--
--   · **who the person is**, beyond a name. `profiles` mirrors `auth.users`
--     and holds email / full_name / avatar_url. Nothing recorded what the
--     user *does*, so no screen could be laid out for them.
--   · **how far through onboarding this workspace is**, so leaving and coming
--     back resumes instead of restarting.
--   · **what the user wants Huntloop to do**, which decides which jobs are
--     worth scheduling for this org at all.
--
-- ── Why progress is on the org and identity is on the profile ────────────
--
-- This split is the load-bearing decision here and it is not arbitrary.
--
-- Onboarding configures a *workspace*: one ICP, one product, one set of
-- sources. Those are org facts. If progress were per-user, the second person
-- to join a configured org would be walked through company research again and
-- would end up creating a second, contradictory ICP — which is precisely the
-- failure `ICP-01` cost a release to fix.
--
-- Role is the opposite. It exists to lay out *this person's* dashboard, and an
-- SDR and the founder who invited them must not share one. So it goes on
-- `profiles`, where each member has their own row, and it is written by the
-- application rather than by `handle_new_user()` — that trigger mirrors
-- `auth.users`, and role is a product fact about the person, not an identity
-- fact.
-- ============================================================================

-- ── Who the user is, to the product ────────────────────────────────────────

alter table public.profiles
  -- A closed set, not free text. This value selects a dashboard layout and a
  -- set of defaults, so an unmappable answer would be a value no code path
  -- handles. `gtm_generalist` is the fallback the UI defaults to, which is
  -- why it is a real member rather than NULL meaning "generalist" — NULL here
  -- means "never asked", and the two need to stay distinguishable so the
  -- product can ask later without re-asking everyone.
  add column if not exists role text
    check (role is null or role in (
      'founder', 'sales', 'sdr', 'gtm_generalist', 'revops', 'marketing', 'agency'
    )),
  -- When this person finished *their* part of onboarding. Distinct from the
  -- org's `onboarding_completed_at` below: an invited teammate completes step
  -- one and nothing else, because the workspace is already configured.
  add column if not exists onboarded_at timestamptz;

comment on column public.profiles.role is
  'What the person does, from the closed set the dashboard has layouts for. '
  'Written by onboarding, never by handle_new_user() — that trigger mirrors '
  'auth.users, and this is a product fact rather than an identity one.';

-- ── How far this workspace has been configured ─────────────────────────────

alter table public.organizations
  -- The step the user should land on next, not the last one they finished.
  -- Stated that way because every reader is a router asking "where do I send
  -- this person", and a column that answers a different question than its
  -- readers ask is how off-by-one bugs get written into a redirect.
  add column if not exists onboarding_step text not null default 'you'
    check (onboarding_step in (
      'you', 'company', 'goals', 'icp', 'sources', 'building', 'review', 'done'
    )),
  add column if not exists onboarding_completed_at timestamptz,

  -- What the person said they wanted Huntloop to do, from the five loop
  -- stages. A real column rather than a key in `settings`, because the
  -- scheduler reads it to decide which jobs to enqueue for this org, and a
  -- scheduled job that mis-parses a settings blob does not fail — it silently
  -- does nothing, at three in the morning, forever.
  --
  -- text[] rather than an enum array: the set is a product decision that will
  -- change, and adding an enum member requires an exclusive lock on every
  -- table using the type. The CHECK below gives the same guarantee at the
  -- cost that matters.
  add column if not exists goals text[] not null default '{}';

-- Every entry must be one of the five, and there may be at most two.
--
-- The cap is a product rule and it belongs here rather than only in the form:
-- the answer's entire job is to *rank* the dashboard, and a user who selected
-- all five has expressed no ranking. A form is one writer; a constraint covers
-- the seed, the API, and whatever writes this next.
alter table public.organizations
  drop constraint if exists organizations_goals_known;

alter table public.organizations
  add constraint organizations_goals_known check (
    cardinality(goals) <= 2
    and goals <@ array['discover', 'qualify', 'enrich', 'reach_out', 'learn']::text[]
  );

-- The router's index. Partial, because a finished org is never looked up by
-- this column — the only question anyone asks of it is "which workspaces are
-- still mid-setup", and once `onboarding_completed_at` is set the row is dead
-- weight in the index forever.
create index if not exists organizations_onboarding_idx
  on public.organizations (onboarding_step)
  where onboarding_completed_at is null;

comment on column public.organizations.onboarding_step is
  'The step to send the user to NEXT, not the last one completed. Every '
  'reader is a router; a column that answers a different question than its '
  'readers ask is an off-by-one waiting to be written into a redirect.';

-- ── Backfill ───────────────────────────────────────────────────────────────
--
-- Every organisation that already exists predates this flow, and marching an
-- established workspace back through company research would be the worst
-- possible reading of a default. The test for "already set up" is an active
-- ICP: that is the artifact onboarding exists to produce, and an org with one
-- has, by definition, got past the step that produces it.
--
-- Orgs without one are left at their default of `you`, which is correct —
-- they genuinely have not been configured, and they will now be offered the
-- flow that configures them.

update public.organizations o
   set onboarding_step = 'done',
       onboarding_completed_at = coalesce(o.updated_at, o.created_at, now())
 where o.onboarding_completed_at is null
   and exists (
     select 1 from public.icps i
      where i.org_id = o.id
        and i.is_active
        and i.deleted_at is null
   );

-- ── Reading progress without exposing the whole row ────────────────────────
--
-- The router runs before a page renders and needs two facts: where to send
-- this person, and whether they personally have finished step one. Both are
-- readable through existing policies (`org_read` on organizations,
-- `profile_read` on profiles), so no new policy is needed and none is added —
-- a policy that grants what an existing one already grants is a second place
-- to get the tenant boundary wrong.
--
-- What *is* needed is a write path. `org_write` in `0001` requires admin, and
-- advancing your own onboarding is not an administrative act: the person doing
-- it is the owner in the common case and an ordinary member in the invited
-- case. Rather than loosening `org_write` — which also guards the org's name
-- and would then let any member rename the workspace — this is a narrow
-- SECURITY DEFINER function that can change exactly these three columns.

create or replace function public.advance_onboarding(
  p_org   uuid,
  p_step  text,
  p_goals text[] default null
)
returns text
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_user uuid := auth.uid();
  v_step text;
begin
  if v_user is null then
    raise exception 'advance_onboarding requires an authenticated caller';
  end if;

  -- DEFINER bypasses RLS, so this membership test is the entire tenant
  -- boundary for this function. Same shape as `write_audit_log` in `0007`.
  if not exists (
    select 1 from public.memberships m
     where m.org_id = p_org and m.user_id = v_user and m.deleted_at is null
  ) then
    raise exception 'not a member of the requested organisation';
  end if;

  if p_step is null or p_step not in (
    'you', 'company', 'goals', 'icp', 'sources', 'building', 'review', 'done'
  ) then
    raise exception 'advance_onboarding: % is not an onboarding step', p_step;
  end if;

  update public.organizations
     set onboarding_step = p_step,
         goals = coalesce(p_goals, goals),
         -- Set once and never cleared. "When did this workspace finish
         -- setting up" is a fact about the past, and a user who revisits the
         -- ICP screen a month later has not un-onboarded.
         onboarding_completed_at = case
           when p_step = 'done' then coalesce(onboarding_completed_at, now())
           else onboarding_completed_at
         end
   where id = p_org
   returning onboarding_step into v_step;

  if v_step is null then
    raise exception 'advance_onboarding: organisation % not found', p_org;
  end if;

  return v_step;
end;
$$;

comment on function public.advance_onboarding is
  'Advances a workspace through onboarding. Narrow by design: org_write '
  'requires admin because it also guards the org name, and advancing your own '
  'setup is not an administrative act.';

-- ── Setting your own role ──────────────────────────────────────────────────
--
-- `profile_self_write` in `0007` already permits this — `for update using (id
-- = auth.uid())` covers the new columns, because a policy is over rows rather
-- than columns. So there is deliberately no function here: the application
-- updates its own profile row directly and RLS holds.
--
-- Worth stating explicitly because the asymmetry looks like an oversight. It
-- is not. A user owns their profile row; nobody owns the organisation row
-- alone.

-- ── Lockdown ───────────────────────────────────────────────────────────────

do $$
begin
  -- Callable by a signed-in user, which is the whole point: the caller is a
  -- member advancing their own workspace. `anon` is excluded because an
  -- unauthenticated caller has no `auth.uid()` and would only ever hit the
  -- raise above — granting it would be advertising a function that cannot
  -- work.
  revoke execute on function public.advance_onboarding(uuid, text, text[])
    from public, anon;
  grant execute on function public.advance_onboarding(uuid, text, text[])
    to authenticated, service_role;
exception when undefined_object or undefined_function then null;
end $$;


-- ==========================================================================
-- 0025_anonymous_research.sql
-- ==========================================================================

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


-- ==========================================================================
-- 0026_product_research.sql
-- ==========================================================================

-- ============================================================================
-- 0026 — The research a product row was built from, kept
--
-- ── Why this is a second onboarding migration ────────────────────────────
--
-- `0024` made onboarding persist its answers. Writing the code that consumes
-- them surfaced something `0024` had not: `research_company` establishes five
-- things about a company — what it sells, who buys it, the problem it solves,
-- its business model, and the likely buying trigger — and `products` has a
-- column for exactly one of them.
--
-- `description` took `sells`, `value_props` took `problem`, and the other
-- three were dropped on the floor. That was survivable while nothing read
-- them. It stopped being survivable the moment `draft_icp` existed, because
-- that task's entire honesty mechanism is a closed set of citations built from
-- those five sentences: a field it returns must quote the research sentence it
-- followed from. With two of the five sentences persisted, the ICP could only
-- ever be drafted from two, and re-drafting it later — after an edit, on a new
-- device, or a month on — would silently produce a thinner profile than the
-- first run did.
--
-- ── Why a jsonb column and not five text columns ─────────────────────────
--
-- Because the thing being stored is not five strings. Every finding carries a
-- claim kind (`fact` / `inference` / `unknown`), a confidence, and — for a
-- fact — the URL it was read on. That structure is the whole reason the
-- onboarding review screen can show a user which parts of their profile the
-- site *stated* and which parts a model *concluded*, and flattening it to text
-- would throw away precisely the distinction this codebase is built around.
--
-- Five columns would also have to grow to six the day `RESEARCH_FIELDS` does,
-- and `RESEARCH_FIELDS` is a product decision that lives in `packages/ai`.
--
-- ── Why not `evidence` ───────────────────────────────────────────────────
--
-- The obvious home, and it does not fit. `evidence.subject_id` references a
-- subject, and the four permitted subject types are company, opportunity,
-- contact and signal — where `company` means a row in `companies`, which holds
-- *prospects*. The customer's own company is not one and must not become one:
-- inventing a row there to satisfy the foreign key would put a fabricated
-- prospect in every workspace, and it would be scored, ranked and possibly
-- contacted.
--
-- So the research lives with the product it describes, which is the thing it
-- is actually about.
-- ============================================================================

alter table public.products
  -- The `CompanyUnderstanding` from `research_company`, whole and as returned.
  --
  -- Denormalised on purpose and not read by SQL: nothing filters on it, and
  -- the readers are `draft_icp` (which needs the sentences) and the onboarding
  -- review screen (which needs the claim kinds). Shredding it into columns
  -- would give both of them reassembly work and would give the reassembly two
  -- chances to disagree.
  add column if not exists research jsonb,

  -- When it was read, and whether a model actually did the reading.
  --
  -- `research_is_live = false` means the deployment had no ANTHROPIC_API_KEY
  -- and the row holds the worked example every onboarding screen labels as
  -- such. Storing that distinction is what stops a demo profile being promoted
  -- to a real one by the next thing that reads it — the same §7 rule the
  -- screens enforce visually, made durable.
  add column if not exists researched_at timestamptz,
  add column if not exists research_is_live boolean not null default false;

-- A shape check, deliberately weak — the same posture `0013` takes with
-- `icps.criteria`. Full validation belongs where it can produce a message a
-- person can act on. What this stops is a scalar or an array landing in a
-- column every reader will treat as an object with a `findings` array.
alter table public.products
  drop constraint if exists products_research_is_object;

alter table public.products
  add constraint products_research_is_object
    check (research is null or jsonb_typeof(research) = 'object');

comment on column public.products.research is
  'The research_company output this product row was built from, whole. Kept '
  'because draft_icp cites these sentences and the review screen renders '
  'their claim kinds — both of which are lost if only the prose survives.';

comment on column public.products.research_is_live is
  'False when no model was configured and this is the labelled worked example. '
  'Durable version of the warning the onboarding screens show, so nothing '
  'downstream promotes a demo profile to a real one.';

-- No RLS changes. `products` has carried `tenant_read` / `tenant_write` since
-- `0002`, and a policy is over rows rather than columns, so the new columns
-- are already covered by both. Adding a policy here would be a second place to
-- get the tenant boundary wrong.


-- ==========================================================================
-- 0027_org_directory.sql
-- ==========================================================================

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


commit;
