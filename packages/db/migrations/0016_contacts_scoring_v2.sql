-- 0016 — contacts that can be chosen, and scores that can be compared.
--
-- ── Two problems, one migration, because they are the same problem ───────
--
-- **Contacts.** `people.is_decision_maker boolean` was the entire model for
-- deciding who to email. A boolean cannot express "the VP of Engineering is
-- the buyer here but the Head of Platform is the one who feels the pain", it
-- cannot rank two people who are both true, and it cannot say why it is true
-- — so a person looking at it has to take it on faith, which is the one thing
-- this product is built not to ask.
--
-- **Scores.** `opportunity_scores` is append-only and keeps `model_score`
-- separate from the rule-adjusted `score`, which is the hard part and is
-- already right. What it cannot say is *what produced it*: which prompt,
-- which model, which version of the profile, which set of rules. So when the
-- average score moves, there is no way to tell a market change from a prompt
-- edit — and the learning loop, whose entire job is attributing outcomes to
-- causes, is reasoning about a variable it cannot see.
--
-- They are one migration because they are one idea: **a judgement that cannot
-- name its inputs cannot be learned from.** Contact selection is a judgement
-- that had no inputs recorded at all; scoring is a judgement that recorded
-- its output and not its context.
--
-- ── What is deliberately preserved ───────────────────────────────────────
--
-- `is_decision_maker` stays. It is read in four places, it is a reasonable
-- summary, and dropping a column to prove a point is how a migration breaks a
-- screen. It becomes *derived* — maintained by the ranking job — rather than
-- authoritative, and the comment on it says so.
--
-- The eight scoring dimensions and the `model_score` / `score` / `rule_trace`
-- split are untouched. §51 says the combination rule is NOT DEFINED and this
-- migration does not define one.

-- ── People, made rankable ─────────────────────────────────────────────────

alter table people
  -- Normalized from the title by `classifyTitle()`, which is deterministic
  -- and testable. Storing the classification rather than re-deriving it on
  -- every read means a rule can filter on it and the reasoning is stable.
  add column department text,
  -- 0–100, from a fixed ladder in `packages/db/src/contact.ts`. A number
  -- rather than the existing `seniority text[]` because ranking needs an
  -- order and "vp" > "director" is not something a text array knows.
  add column seniority_rank integer check (seniority_rank is null or seniority_rank between 0 and 100),

  -- Are they still there? Three states, and `unknown` is the honest default
  -- for every row that predates this column.
  --
  -- The failure this prevents is specific and expensive: a sequence that
  -- keeps emailing someone who left six months ago, bouncing every time,
  -- against the customer's own sending reputation.
  add column employment_status text not null default 'unknown'
    check (employment_status in ('current', 'departed', 'unknown')),
  add column employment_checked_at timestamptz,
  -- Where they went, when a provider tells us. Not chased automatically —
  -- following a champion to a new company is a real sales motion and a real
  -- privacy question, and it is a product decision rather than a schema one.
  add column departed_note text,

  -- Freshness of the record as a whole, distinct from `updated_at`, which
  -- moves when anything at all changes. This one moves only when a provider
  -- or a person actually re-confirmed the facts.
  add column last_verified_at timestamptz,

  -- Which persona this person matches, if any. Set by the ranking job.
  add column persona_id uuid references personas(id) on delete set null;

create index people_company_rank_idx
  on people (org_id, company_id, seniority_rank desc)
  where deleted_at is null;

comment on column people.is_decision_maker is
  'Derived, not authoritative. Maintained by rank_contacts as a summary of '
  'contact_fit_scores; the real answer, with its reasoning, is there. Kept '
  'because four screens read it and because a boolean is the right thing to '
  'show in a table cell.';

-- ── Contact fit ───────────────────────────────────────────────────────────
--
-- Deliberately the same architecture as `opportunity_scores`, down to the
-- column names. Append-only, `model_score` beside `score`, a rule trace, and
-- an explanation that is not optional.
--
-- The reason to mirror rather than invent is not tidiness. It is that the
-- opportunity scoring architecture is the part of this product that has been
-- most carefully thought about — the separation of the model's opinion from
-- the customer's policy is what makes the learning loop answerable — and
-- contact selection has exactly the same structure of problem. A second,
-- differently-shaped scoring system would be a second set of the mistakes
-- that one already avoids.

create table contact_fit_scores (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  person_id   uuid not null references people(id) on delete cascade,
  -- Fit is relative to a profile. The same person is a strong contact for one
  -- ICP and irrelevant for another, and a score with no ICP attached is an
  -- average of incompatible questions.
  icp_id      uuid references icps(id) on delete set null,
  icp_version_id uuid references icp_versions(id) on delete set null,
  persona_id  uuid references personas(id) on delete set null,

  -- 0–100. The final number, after rules.
  score       integer not null check (score between 0 and 100),
  -- What the deterministic matcher produced, before any customer rule. Kept
  -- separate for the same reason `model_score` is: a customer's rule being
  -- wrong is not evidence about the matcher.
  base_score  integer check (base_score is null or base_score between 0 and 100),

  -- The named dimensions. An object, not a number, because "why is this
  -- person a 72" has to be answerable and an average is not an answer.
  --   titleMatch . seniorityFit . departmentFit . personaMatch
  --   contactability . recency
  dimensions  jsonb not null default '{}'::jsonb,

  -- Every rule that fired, in order, with its effect. Same shape as
  -- `opportunity_scores.rule_trace`.
  rule_trace  jsonb not null default '[]'::jsonb,

  confidence  confidence not null default 'medium',

  -- The sentence a person reads. NOT NULL for the same reason
  -- `opportunities.priority_reason` is: a ranking with no stated reason is a
  -- number the user has to trust blindly.
  reason      text not null,
  -- The angle this *person* suggests, which is not the same as the company's.
  -- A CTO and a VP Sales at the same company get different openings from the
  -- same trigger.
  recommended_angle text,

  computed_at timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

-- The hot read: "who at this company, best first". Ordering by score then
-- computed_at makes it deterministic when two people tie.
create index contact_fit_current_idx
  on contact_fit_scores (org_id, person_id, computed_at desc);
create index contact_fit_ranking_idx
  on contact_fit_scores (org_id, icp_id, score desc, computed_at desc);

-- ── Choosing one ──────────────────────────────────────────────────────────

alter table opportunities
  -- The narrative for the person, alongside the existing narrative for the
  -- company. Nullable, like every other §14 field, because an opportunity
  -- with no contact chosen yet genuinely has no answer.
  add column why_this_person text,
  add column contact_selected_at timestamptz,
  -- 'system' or 'user'. The learning loop's most valuable question is how
  -- often a person overrides the choice, and it cannot ask without this.
  add column contact_selected_by text not null default 'system'
    check (contact_selected_by in ('system', 'user'));

-- ── Score provenance ──────────────────────────────────────────────────────
--
-- Three new columns plus a reason, all nullable, all backfill-free. Every
-- existing row keeps saying what it said; it just cannot say what produced
-- it, which is the truth about those rows.
--
-- `model_version` is NOT added here — `0003` has had it since the beginning,
-- NOT NULL, and it is already written by the scorer. What was missing is
-- everything *around* the model: which prompt, which profile, which rules.
-- The model id alone answers "was this Opus or Sonnet" and nothing else, and
-- a prompt edit changes scores far more often than a model swap does.

alter table opportunity_scores
  add column prompt_version  text,
  add column icp_version_id  uuid references icp_versions(id) on delete set null,
  -- A hash of the active rule set at computation time, not a foreign key: the
  -- rules are many rows and the question is "were they the same as now",
  -- which a hash answers in one comparison.
  add column rules_version   text,
  -- Why this score was computed. Distinguishes a score that reflects new
  -- evidence from one produced by a mass recomputation after a rule change —
  -- which matters enormously when reading a score history.
  add column computed_reason text
    check (computed_reason is null or computed_reason in (
      'initial', 'new_evidence', 'rule_change', 'icp_change', 'manual', 'scheduled'
    ));

-- Drift is asked one of two ways — "did scores move when the model changed"
-- and "did scores move when the prompt changed" — and the second is the one
-- that happens weekly. Not partial: `model_version` is NOT NULL, so a partial
-- index on it being present would cover every row and merely lie about it.
create index opportunity_scores_drift_idx
  on opportunity_scores (org_id, model_version, computed_at desc);
create index opportunity_scores_prompt_drift_idx
  on opportunity_scores (org_id, prompt_version, computed_at desc)
  where prompt_version is not null;

-- ── Human overrides ───────────────────────────────────────────────────────
--
-- The highest-value data this product receives, and until now it was thrown
-- away. When a salesperson looks at a `hot` opportunity and marks it `ignore`,
-- they have just supplied a labelled training example for free — and the old
-- behaviour was to update a column and lose the fact that a disagreement ever
-- happened.
--
-- One table for both kinds of override, because the learning loop wants to
-- read "every time a person disagreed with the system" as one list. Two
-- tables would mean two queries and an ordering problem.

create table human_overrides (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,

  subject     text not null check (subject in (
    'opportunity_priority', 'opportunity_score', 'primary_contact',
    'contact_fit', 'company_excluded'
  )),
  entity_type text not null check (entity_type in ('opportunity', 'person', 'company')),
  entity_id   uuid not null,

  -- What the system said and what the person said, as text so that the same
  -- table holds a priority band, a score, and a person's id without five
  -- nullable typed columns that are mostly null.
  system_value text,
  human_value  text not null,

  -- Optional, and worth asking for. A reason is what turns "they disagreed"
  -- into something a rule proposal can be derived from.
  reason      text,

  -- The score row the person was looking at, when there is one. Pins the
  -- disagreement to a specific verdict rather than to whatever the current
  -- one happens to be by the time the loop reads it.
  score_id    uuid references opportunity_scores(id) on delete set null,

  actor_id    uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),

  -- Set once a learning run has taken this into account, so the same
  -- correction is not counted in five consecutive analyses and mistaken for
  -- five people agreeing.
  consumed_at timestamptz,
  consumed_by uuid references learning_runs(id) on delete set null
);

create index human_overrides_org_idx on human_overrides (org_id, created_at desc);
create index human_overrides_entity_idx on human_overrides (org_id, entity_type, entity_id, created_at desc);
create index human_overrides_unconsumed_idx
  on human_overrides (org_id, created_at)
  where consumed_at is null;

-- ── Recording one ─────────────────────────────────────────────────────────
--
-- A function rather than an insert from the application, so that the override
-- and the change it describes cannot diverge — and so a Server Action does
-- not have to remember to write it. Forgetting is the default outcome for
-- anything a caller has to remember.

create or replace function public.record_override(
  p_org        uuid,
  p_subject    text,
  p_entity_type text,
  p_entity_id  uuid,
  p_system     text,
  p_human      text,
  p_reason     text default null,
  p_score      uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare v_id uuid;
begin
  if not public.has_org_role(p_org, 'member') then
    raise exception 'record_override: not a member of %', p_org;
  end if;

  -- A "change" to the same value is not a disagreement. Recording it would
  -- pollute the only clean signal in the system with the noise of somebody
  -- re-saving a form.
  if p_system is not distinct from p_human then
    return null;
  end if;

  insert into public.human_overrides (
    org_id, subject, entity_type, entity_id, system_value, human_value,
    reason, score_id, actor_id
  )
  values (p_org, p_subject, p_entity_type, p_entity_id, p_system, p_human,
          p_reason, p_score, auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

-- ── Rule fingerprint ──────────────────────────────────────────────────────
--
-- What `opportunity_scores.rules_version` is set from. In the database rather
-- than the application because the scorer and any future re-scorer must agree
-- exactly, and two implementations of "hash the active rules" would not.

create or replace function public.active_rules_version(p_org uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select coalesce(
    md5(string_agg(
      r.id::text || ':' || coalesce(r.effect::text, '') || ':' ||
      coalesce(r.weight::text, '') || ':' || coalesce(r.expression::text, ''),
      '|' order by r.id
    )),
    'none'
  )
  from public.scoring_rules r
  where r.org_id = p_org
    and r.is_active = true
    and r.deleted_at is null;
$$;

-- ── RLS ───────────────────────────────────────────────────────────────────

do $$
declare t text;
begin
  foreach t in array array['contact_fit_scores', 'human_overrides']
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

-- Neither table gets a touch trigger: both are append-only and neither has an
-- `updated_at`. `human_overrides.consumed_at` is set once by the learning run
-- and is not a general-purpose update.

-- ── Lockdown ──────────────────────────────────────────────────────────────

do $$
begin
  revoke execute on function public.active_rules_version(uuid) from public, anon, authenticated;
  grant execute on function public.active_rules_version(uuid) to service_role;
exception when undefined_object or undefined_function then null;
end $$;
