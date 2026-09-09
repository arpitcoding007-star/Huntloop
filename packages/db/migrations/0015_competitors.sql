-- 0015 — competitor intelligence.
--
-- ── What existed, and why it was not enough ──────────────────────────────
--
-- `organizations.settings -> 'voice' -> 'competitors'` — an array of strings,
-- read by `org-profile.ts`, used for exactly one thing: telling the message
-- writer not to claim to be a tool the prospect already uses.
--
-- That is a real use and it stays. But a name in a settings blob cannot
-- answer any of the questions a salesperson actually has, which are: what
-- does this competitor say about themselves, who do they sell to, where do
-- they beat us, where do we beat them, and — the one that changes what gets
-- sent today — is *this prospect* already using one of them.
--
-- ── The rule this subsystem is built on ──────────────────────────────────
--
-- **No competitor claim without provenance.**
--
-- This is stricter than the rest of the system, and deliberately so. A
-- hallucinated funding round is a wrong fact on a screen. A hallucinated
-- competitor weakness is a sentence a salesperson repeats out loud, to a
-- customer, about a named third party. The downside is not a bad score; it is
-- a false statement about another company made by a person who believed it.
--
-- So every field in `competitor_profiles` is nullable, every one has an
-- evidence pointer beside it, and the research task refuses rather than
-- filling in from the model's memory. UNKNOWN is a first-class answer here in
-- a way it is not everywhere else.
--
-- ── Why a competitor is a company ────────────────────────────────────────
--
-- It has a domain, it gets researched, it gets enriched, it has evidence, and
-- it can be a duplicate. Every one of those is a problem `0012` already
-- solved. Giving competitors their own parallel identity model would mean a
-- second resolver, a second merge function, and a second set of bugs.
--
-- So `competitors.company_id` is the identity, and `competitors` is the row
-- that says "this company is a competitor of ours" plus the things that are
-- true of it *as a competitor* rather than as a company.

create table competitors (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,

  -- The identity, reusing `0012` wholesale. Nullable because a competitor a
  -- user names during onboarding has no domain yet and should not be lost
  -- while the resolver works out what it is.
  company_id  uuid references companies(id) on delete set null,

  name        text not null,
  domain      text,

  -- How this competitor entered the system. `discovered` ones are proposals
  -- until a person accepts them — the same posture as recommended sources in
  -- `0002`, and for the same reason: the customer knows their market better
  -- than a search does.
  origin      text not null default 'user'
              check (origin in ('user', 'onboarding', 'discovered', 'mention')),
  status      text not null default 'active'
              check (status in ('proposed', 'active', 'dismissed')),

  -- How directly they compete. Changes what the message writer may do with
  -- them: naming a direct competitor is risky and sometimes right; naming an
  -- adjacent one is usually just confusing.
  tier        text check (tier is null or tier in ('direct', 'adjacent', 'incumbent', 'diy')),

  -- Set by a person, not by the model. "We win on X" is positioning, and
  -- positioning is the customer's to state.
  our_advantage   text,
  their_advantage text,

  last_researched_at timestamptz,

  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

-- One competitor per name per org, case-insensitively. Two rows for "Outreach"
-- and "outreach" is how a list becomes untrustworthy.
create unique index competitors_name_idx
  on competitors (org_id, lower(name))
  where deleted_at is null;

create unique index competitors_domain_idx
  on competitors (org_id, domain)
  where domain is not null and deleted_at is null;

create index competitors_status_idx on competitors (org_id, status)
  where deleted_at is null;

-- ── The profile ───────────────────────────────────────────────────────────
--
-- One row per competitor, every field nullable, every field carrying its own
-- evidence. Separate from `competitors` so that the human-owned columns above
-- and the researched columns here cannot be confused — and so that re-running
-- research replaces a profile without touching what a person wrote.

create table competitor_profiles (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  competitor_id uuid not null references competitors(id) on delete cascade,

  -- Each of these is a claim. `claims` below carries the per-field evidence
  -- and kind, keyed by field name, rather than fourteen nullable
  -- `*_evidence_id` columns — which would be the same information at four
  -- times the width and would still not express "two sources disagree".
  positioning     text,
  value_prop      text,
  target_markets  text[] not null default '{}',
  products        jsonb not null default '[]'::jsonb,
  differentiators jsonb not null default '[]'::jsonb,
  pricing_model   text,
  pricing_detail  text,
  customer_examples jsonb not null default '[]'::jsonb,
  strengths       jsonb not null default '[]'::jsonb,
  weaknesses      jsonb not null default '[]'::jsonb,

  -- field name → { kind, confidence, evidenceIds[], note }. The kind is the
  -- §7 enum, so a screen can render an inference as an inference. A field
  -- present here with kind 'unknown' is the model saying it looked and could
  -- not tell, which is different from the field being absent because nobody
  -- asked.
  claims        jsonb not null default '{}'::jsonb,

  -- Where the ICPs overlap. Computed rather than asserted: it is the
  -- intersection of this profile's `target_markets` with the org's own ICP
  -- segments, and it is the field that makes competitor data actionable
  -- during discovery rather than only during a call.
  icp_overlap   jsonb not null default '[]'::jsonb,

  ai_run_id     uuid references ai_runs(id) on delete set null,
  researched_at timestamptz not null default now(),

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  unique (org_id, competitor_id)
);

-- ── Evidence ──────────────────────────────────────────────────────────────
--
-- A join table rather than an array column on the profile, because the same
-- evidence row legitimately supports several fields and because "show me
-- everything we know about this competitor, newest first" is a query somebody
-- will want and an array cannot serve.

create table competitor_evidence (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  competitor_id uuid not null references competitors(id) on delete cascade,
  evidence_id   uuid not null references evidence(id) on delete cascade,

  -- Which claim this supports. Free text matching a key in
  -- `competitor_profiles.claims`, checked in the application rather than by a
  -- foreign key, because the set of fields is a TypeScript type and
  -- duplicating it as an enum here would be two sources of truth.
  field         text not null,

  created_at    timestamptz not null default now(),

  unique (org_id, competitor_id, evidence_id, field)
);

create index competitor_evidence_competitor_idx
  on competitor_evidence (org_id, competitor_id, created_at desc);

-- ── Competitor signals on a prospect ──────────────────────────────────────
--
-- The point of the whole subsystem. "This company mentions Outreach in three
-- job specs" is worth more than any profile field, because it changes what to
-- say to them this week.

create table company_competitor_signals (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  company_id    uuid not null references companies(id) on delete cascade,
  competitor_id uuid not null references competitors(id) on delete cascade,

  -- What the relationship appears to be. Ordered by how much it should change
  -- the outreach:
  --
  --   uses        evidence they are a customer. The strongest signal, and the
  --               one that makes a displacement angle legitimate
  --   evaluating  evidence they are looking — an RFP, a comparison page
  --   mentions    named without more. Weak, and often just a blog post
  --   former      evidence they left. The best possible time to call
  --   partner     they integrate with them. NOT a competitive signal, and
  --               kept precisely so it is not mistaken for one
  relationship  text not null check (relationship in ('uses', 'evaluating', 'mentions', 'former', 'partner')),

  claim_kind    claim_kind not null default 'inference',
  confidence    confidence not null default 'low',

  evidence_id   uuid references evidence(id) on delete set null,
  -- When the underlying thing was observed, as distinct from when we recorded
  -- it. Same distinction `evidence` makes, and it matters more here: "used a
  -- competitor in 2019" is not a signal.
  observed_at   timestamptz,

  detected_by   text not null default 'system',

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- One row per (company, competitor, relationship). The same job spec
  -- scanned twice must not produce two signals — `0002`'s §60 rule, applied
  -- here.
  unique (org_id, company_id, competitor_id, relationship)
);

create index company_competitor_signals_company_idx
  on company_competitor_signals (org_id, company_id);
create index company_competitor_signals_competitor_idx
  on company_competitor_signals (org_id, competitor_id, observed_at desc);

-- ── RLS ───────────────────────────────────────────────────────────────────

do $$
declare t text;
begin
  foreach t in array array[
    'competitors', 'competitor_profiles', 'competitor_evidence',
    'company_competitor_signals'
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
  end loop;
end
$$;

create trigger competitors_touch before update on public.competitors
  for each row execute function public.touch_updated_at();
create trigger competitor_profiles_touch before update on public.competitor_profiles
  for each row execute function public.touch_updated_at();
create trigger company_competitor_signals_touch before update on public.company_competitor_signals
  for each row execute function public.touch_updated_at();

-- ── Migrating the names out of the settings blob ──────────────────────────
--
-- The array in `organizations.settings` stays where it is and keeps working —
-- `org-profile.ts` reads it, the message writer uses it, and nothing about
-- this migration needs that to stop. What this does is seed `competitors`
-- from it, so an org that named three competitors during onboarding starts
-- with three rows to research rather than an empty screen.
--
-- `status = 'active'` because a name a person typed is not a proposal.

insert into competitors (org_id, name, origin, status)
select o.id, trim(c.value #>> '{}'), 'onboarding', 'active'
from public.organizations o
cross join lateral jsonb_array_elements(
  case
    when jsonb_typeof(o.settings -> 'voice' -> 'competitors') = 'array'
    then o.settings -> 'voice' -> 'competitors'
    else '[]'::jsonb
  end
) as c(value)
where o.deleted_at is null
  and trim(c.value #>> '{}') <> ''
on conflict do nothing;
