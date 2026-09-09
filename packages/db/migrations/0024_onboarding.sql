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
