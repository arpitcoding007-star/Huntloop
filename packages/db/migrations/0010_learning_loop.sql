-- ============================================================================
-- 0010 — Learn
--
-- Huntloop's loop is Discover → Understand → Qualify → Prioritize → Act →
-- Track → Learn. Every stage before the last one has had a home in the schema
-- since `0004`: `outcomes` records what happened, `ai_decisions.human_override`
-- records where a person disagreed with the product, and both have been
-- written to and never read. This migration is the read side.
--
-- Three things arrive together because they are one capability:
--
--   1. `learning_runs` / `learning_findings` — a synthesis run, and the
--      individually-approvable conclusions it produced.
--   2. `scoring_rules` gains the columns that let a conclusion become a rule
--      somebody can review, and an *effect* the engine actually evaluates.
--   3. `memories` gains the ingestion metadata that lets a document, rather
--      than only a typed sentence, become org context.
--
-- Plus one thing that is not about learning at all and is here because it is
-- the same shape of problem: a per-org cap on standing un-worked inventory,
-- so Discover cannot outrun Qualify. `usage_counters` caps spend per month;
-- nothing capped how much unread work the engine may pile up, and those are
-- different questions with different right answers.
--
-- ── The rule this migration is most careful about ──────────────────────────
--
-- `scoring_rules.intent` is metadata and nothing else. It exists so a review
-- screen can group rules by why they exist — "these four reject, these two
-- prioritize" — and it is never read by anything that computes. The effect a
-- rule has is stated in `effect`, `weight` and `floor_priority`, explicitly,
-- where a reader can see it.
--
-- That distinction is the whole reason the column is safe to add. A taxonomy
-- that silently changes behaviour is worse than no taxonomy: it reads like
-- configuration, and it is decoration. `verify-migrations.ts` asserts two
-- rules with identical effects and different intents behave identically.
-- ============================================================================

-- ── Scoring rules: taxonomy, provenance, and an effect that is evaluated ────

create type rule_intent as enum ('prioritize', 'reject', 'boost', 'penalty');

-- What a rule DOES. Separate from `intent` on purpose — see the header.
--
--   adjust  Adds `weight` to the qualifier's score. Signed, bounded, and
--           recorded on the score row so the arithmetic is visible rather
--           than folded into a number nobody can decompose.
--   veto    Forces priority to `ignore`. A hard exclusion: "we never sell to
--           companies under 10 people" is not a scoring preference, and
--           expressing it as one means it can be outvoted by a strong trigger.
--   floor   Forces priority to at least `floor_priority`. The mirror image.
create type rule_effect as enum ('adjust', 'veto', 'floor');

alter table scoring_rules
  add column intent          rule_intent,
  add column effect          rule_effect not null default 'adjust',
  add column floor_priority  opportunity_priority,
  -- Why this rule exists, in a sentence a person can disagree with. NOT the
  -- same as `name`: the name is what it is called in a list, this is the
  -- argument for it. The reference system Huntloop is a second draft of stored
  -- only prose and no logic; this schema stores both, and keeps them apart.
  add column rationale       text,
  -- The ICP element a drafted rule was justified by, copied verbatim from the
  -- profile. Null for a hand-written rule, which is justified by whoever wrote
  -- it having decided to.
  add column basis           text,
  add column origin          text not null default 'user'
                             check (origin in ('user', 'drafted', 'learned')),
  add column proposed_at     timestamptz,
  add column approved_by     uuid references auth.users(id) on delete set null,
  add column approved_at     timestamptz;

-- A `floor` rule with nothing to floor to is a rule that does nothing, and an
-- `adjust` rule with no weight is the same. Both are accepted by every type in
-- the row and produce a rule the review screen renders as configured and the
-- engine skips — the exact class of silent no-op this migration's header is
-- about.
alter table scoring_rules
  add constraint scoring_rules_effect_arguments check (
    (effect = 'floor'  and floor_priority is not null and weight is null)
    or
    (effect = 'adjust' and floor_priority is null and weight is not null)
    or
    (effect = 'veto'   and floor_priority is null and weight is null)
  );

-- Bounded, and bounded well inside the scale it applies to.
--
-- ±40 on a 0–100 score is already enough for a rule to overturn a verdict,
-- which is the most a deterministic rule should be able to do to a judgement
-- that was made with the evidence in front of it. Without a bound, a drafted
-- rule with a hallucinated weight of 500 silently becomes the only thing that
-- decides anything — which is precisely how the reference system's unvalidated
-- `Number.isFinite(w) ? w : 0` failed.
alter table scoring_rules
  add constraint scoring_rules_weight_bounded
    check (weight is null or (weight >= -40 and weight <= 40));

comment on column scoring_rules.intent is
  'Metadata. Grouping for the review screen. NEVER read by the evaluator — '
  'see packages/db/src/rules.ts and the negative test in verify-migrations.ts.';

create index scoring_rules_active_idx
  on scoring_rules (org_id, icp_id)
  where is_active = true and deleted_at is null;

-- ── The score row records what the rules did to it ─────────────────────────
--
-- `score` stays the number everything sorts and renders by. `model_score` is
-- what the qualifier said before any rule ran, and `rule_trace` names every
-- rule that fired and what it did.
--
-- Both are here because §51 forbids inventing a combination rule and passing
-- it off as Huntloop's judgement. A deterministic adjustment is not that — it
-- is a customer's own policy, applied on top — but it only stays honest while
-- the two numbers are separable. Folding a rule's ±15 into `score` and
-- discarding the original would make the model's opinion unrecoverable, and
-- the learning loop reads exactly that column to ask whether the model was
-- right.
alter table opportunity_scores
  add column model_score integer check (model_score between 0 and 100),
  add column rule_trace  jsonb not null default '[]'::jsonb;

comment on column opportunity_scores.model_score is
  'The qualifier''s score before scoring_rules were applied. Equal to `score` '
  'when no rule fired. The learning loop compares THIS against outcomes — a '
  'rule the customer wrote is not evidence about the model.';

-- ── Memory ingestion (master context §20, §37; audit M-32) ─────────────────
--
-- `memories` has always been able to hold a sentence somebody typed. What it
-- could not hold is a document: the write path took `content` and nothing
-- else, so "here is our positioning deck, use it" had no way in.
--
-- The columns are metadata about where the text came from, not a second
-- storage mechanism. `content` remains the only thing any reader reads —
-- `advance_enrollments`' loadGuidance() does not change, and neither does
-- anything added later. That is the point of extending this table rather than
-- building the parallel one the reference system's dead `agent_knowledge`
-- would have become.
alter table memories
  add column source_type  text not null default 'text'
                          check (source_type in ('text', 'url', 'file', 'image')),
  add column tags         text[] not null default '{}',
  -- Where it came from, when that is a place. A URL for `url`, a filename for
  -- `file`/`image`, null for text somebody typed.
  add column source_url   text,
  add column source_label text,
  -- True when `content` is shorter than what was ingested. Stored rather than
  -- inferred, because "this is the whole document" and "this is the first
  -- 8,000 characters of it" are different claims and §7 does not let the
  -- second be presented as the first. The reference system truncated at 10,000
  -- characters and told nobody, which is the same bug from the other side.
  add column truncated    boolean not null default false;

create index memories_tags_idx on memories using gin (tags)
  where deleted_at is null;

-- ── Quality rating on an AI decision (audit M-20) ──────────────────────────
--
-- `human_override` already exists and means something specific: the corrected
-- value. It is the best training signal this product gets for free, and it is
-- only produced when somebody cared enough to fix the output.
--
-- Most outputs are neither corrected nor perfect. "This qualification was
-- reasonable" and "this one was nonsense but I moved on" are both real
-- judgements that leave no trace today, and they are the ones a synthesis pass
-- most needs — an override tells you the model was wrong about one company, a
-- corpus of ratings tells you which *kind* of company it is wrong about.
--
-- Deliberately a separate column rather than a value written into
-- `human_override`. Overloading it would make "the user rated this poor" and
-- "the user replaced the verdict with this" indistinguishable to every reader,
-- including the synthesis task.
alter table ai_decisions
  add column quality_rating text
    check (quality_rating in ('excellent', 'good', 'average', 'poor')),
  add column quality_note   text,
  add column rated_by       uuid references auth.users(id) on delete set null,
  add column rated_at       timestamptz;

create index ai_decisions_rated_idx
  on ai_decisions (org_id, decision_type, rated_at desc)
  where quality_rating is not null;

-- Also gives `ai_decisions` the entity columns it needed to be readable at
-- all. Without these, a decision row can be found by run and by type and not
-- by "which opportunity was this about" — which is how every screen that
-- would show a rating control has to reach it.
alter table ai_decisions
  add column entity_type text,
  add column entity_id   uuid;

create index ai_decisions_entity_idx
  on ai_decisions (org_id, entity_type, entity_id, created_at desc);

-- ── Learning runs and findings (audit M-28 / M-29) ─────────────────────────

create table learning_runs (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,

  -- The lifecycle, and why there are five states rather than three.
  --
  --   requested     A person pressed the button. The request path writes this
  --                 row and nothing else: `enqueue()` goes through the
  --                 service-role client, and calling it from a Server Action
  --                 would put the RLS bypass on a public POST endpoint. So the
  --                 app writes a request to a tenant table and the sweeper
  --                 turns it into a job — the same seam `sources.next_scan_at`
  --                 already uses, with exactly one writer to `job_executions`.
  --   running       A worker has picked it up.
  --   ready         Findings are stored and waiting to be reviewed.
  --   insufficient  Not enough has happened yet. Deliberately NOT `failed`: a
  --                 red state for a customer who has done nothing wrong is a
  --                 support ticket, and the difference between "we could not"
  --                 and "there was nothing to say" is the whole point of §7.
  --   failed        Something went wrong, and `error` says what.
  status      text not null default 'requested'
              check (status in ('requested', 'running', 'ready', 'insufficient', 'failed')),
  -- Who asked. NULL for the scheduled sweep, which is the honest record: the
  -- same reason `write_audit_log_internal` leaves `actor_id` null rather than
  -- substituting the owner.
  triggered_by uuid references auth.users(id) on delete set null,
  trigger      text not null default 'manual'
               check (trigger in ('manual', 'scheduled')),

  -- The window the run looked at, stored so a finding can be re-read months
  -- later against the data that produced it. Without it, "replies are better
  -- when the trigger is fresh" is a claim with no denominator.
  window_start timestamptz not null,
  window_end   timestamptz not null,

  outcomes_considered  integer not null default 0,
  decisions_considered integer not null default 0,
  ratings_considered   integer not null default 0,

  summary     text,
  error       text,
  -- The `ai_runs` row this cost. Nullable because the run row is created
  -- before the model call, same invariant as ai_runs itself.
  ai_run_id   uuid references ai_runs(id) on delete set null,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,

  constraint learning_runs_window check (window_end > window_start)
);

create index learning_runs_recent_idx
  on learning_runs (org_id, created_at desc)
  where deleted_at is null;

-- The sweeper's own query: "has anybody asked for one?", across every tenant.
-- Partial, because `requested` is a state a row is in for seconds and the
-- index should be the size of the queue rather than the size of the history.
create index learning_runs_requested_idx
  on learning_runs (created_at)
  where status = 'requested' and deleted_at is null;

-- At most one analysis outstanding per org.
--
-- This is the rate limit that actually matters for this feature, and it is a
-- constraint rather than a check in application code because the failure it
-- prevents is a double-submit: two clicks a second apart both pass any
-- read-then-write guard, and each one costs an Opus call over three hundred
-- records. A unique violation is a cheap, specific, unambiguous "one is
-- already running" — which is exactly what the screen needs to say.
create unique index learning_runs_one_open_per_org
  on learning_runs (org_id)
  where status in ('requested', 'running') and deleted_at is null;

-- One conclusion. Independently approvable, independently rejectable.
--
-- The reference system stored a whole analysis as one row of eight string
-- arrays, approved or archived as a unit — so a report containing one good
-- idea and four bad ones offered a choice between applying all five and
-- applying none. Normalising is not tidiness; it is the difference between a
-- review and a coin flip.
create table learning_findings (
  id      uuid primary key default gen_random_uuid(),
  org_id  uuid not null references organizations(id) on delete cascade,
  run_id  uuid not null references learning_runs(id) on delete cascade,

  -- What kind of conclusion this is, which decides where approving it lands.
  --   source_performance  a source produces (or does not produce) outcomes
  --   scoring_adjustment  a pattern that should change how things are scored
  --   style_guidance      something about how outreach should be written
  --   icp_refinement      the profile itself is off
  kind    text not null check (kind in (
            'source_performance', 'scoring_adjustment',
            'style_guidance', 'icp_refinement')),

  headline text not null,
  detail   text not null,
  -- What to do about it, in the user's terms. Separate from `proposal`, which
  -- is the machine-readable version of the same sentence.
  recommendation text not null,
  confidence confidence,

  -- Citations, as real foreign keys rather than name strings.
  --
  -- The reference system wrote `best_sources: ["LinkedIn — Series B buyers"]`,
  -- a string matching a source's name by convention. Rename the source and the
  -- finding silently becomes about nothing. These are uuid arrays; the loader
  -- resolves them under RLS, so an id from another tenant renders as nothing
  -- rather than as somebody else's data — which is the structural half of the
  -- guarantee the task's parse() makes at the boundary.
  cited_opportunity_ids uuid[] not null default '{}',
  cited_company_ids     uuid[] not null default '{}',
  cited_source_ids      uuid[] not null default '{}',

  -- How much this rests on. A finding drawn from three outcomes and one drawn
  -- from ninety are both findings, and only one of them should change a rule.
  supporting_count   integer not null default 0,
  contradicting_count integer not null default 0,

  -- The machine-readable form of `recommendation`, shaped by `kind`. A
  -- scoring_adjustment carries a scoring_rules row; a style_guidance carries
  -- the memory content. NULL where a finding is worth reading and not worth
  -- automating — which is a legitimate and common answer.
  proposal jsonb,

  status   text not null default 'pending'
           check (status in ('pending', 'approved', 'rejected')),
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,

  -- Where approving it landed. Kept so the review screen can link a finding to
  -- the rule or memory it became, and so a second approval of the same finding
  -- is visibly a no-op rather than a duplicate.
  applied_type text check (applied_type in ('scoring_rule', 'memory')),
  applied_id   uuid,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A decided finding names who decided it. Without this, `status` can say
  -- approved with no record of by whom, which is the one thing an approval is
  -- for.
  constraint learning_findings_decision check (
    (status = 'pending') = (decided_at is null)
  )
);

create index learning_findings_run_idx
  on learning_findings (org_id, run_id, status);

create index learning_findings_pending_idx
  on learning_findings (org_id, status, created_at desc)
  where status = 'pending';

-- ── Backlog: capping inventory, not spend (audit M-14) ─────────────────────
--
-- `usage_counters` answers "has this org spent its monthly budget". It cannot
-- answer "is there already more unread work here than anyone can get through",
-- because it accumulates per period and inventory is a level, not a flow.
--
-- The reference system had exactly this control as `UNWORKED_LEAD_CAP = 40`, a
-- hardcoded constant, with a comment explaining it was a first-tenant
-- simplification. Huntloop is multi-tenant from `0001`, so this is per-org and
-- configurable — the one place the reference system's own author said they
-- would have done it differently.

-- Standing, un-worked opportunities.
--
-- `discovered`/`researching`/`qualified` are the statuses where nobody has
-- acted yet. `assigned` onward means a person has it, and counting those would
-- penalise an org for having a working pipeline.
--
-- `ignore` is excluded even though it is un-actioned: it is a *decided*
-- verdict. The qualifier looked and said no, which is the system working. A
-- cap that counted those would stop discovery precisely because discovery was
-- correctly filtering.
create or replace function public.open_opportunity_count(p_org uuid)
returns bigint
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select count(*)::bigint
  from public.opportunities o
  where o.org_id = p_org
    and o.deleted_at is null
    and o.status in ('discovered', 'researching', 'qualified')
    and o.priority <> 'ignore'
$$;

-- The cap for one org.
--
-- `organizations.settings -> 'engine' ->> 'backlogCap'`, falling back to 250.
-- An explicit 0 means unlimited, which is a real answer an operator may want
-- and is not the same as "the key is missing".
--
-- 250 rather than the reference system's 40: that number was chosen for one
-- tenant working leads by hand, and Huntloop qualifies before a human sees
-- anything. The failure this guards against is a runaway scanner, not a busy
-- week, and a default that trips on a busy week gets raised to infinity by the
-- first person it inconveniences.
create or replace function public.backlog_cap(p_org uuid)
returns bigint
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select coalesce(
    nullif(o.settings -> 'engine' ->> 'backlogCap', '')::bigint,
    250
  )
  from public.organizations o
  where o.id = p_org
$$;

create or replace function public.backlog_state(p_org uuid)
returns table (open_count bigint, cap bigint, saturated boolean)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select
    public.open_opportunity_count(p_org),
    public.backlog_cap(p_org),
    coalesce(public.backlog_cap(p_org), 0) > 0
      and public.open_opportunity_count(p_org) >= public.backlog_cap(p_org)
$$;

-- Every saturated org, in one query.
--
-- `schedule_scans` is a cross-tenant sweep that reads at most fifty due
-- sources per tick. Asking `backlog_state` once per source would be fifty
-- round trips to answer a question with at most a handful of distinct answers;
-- this is one. Written as a set-returning function rather than a view so the
-- service-role grant below can name it.
create or replace function public.saturated_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select o.id
  from public.organizations o
  where o.deleted_at is null
    and coalesce(nullif(o.settings -> 'engine' ->> 'backlogCap', '')::bigint, 250) > 0
    and (
      select count(*)
      from public.opportunities p
      where p.org_id = o.id
        and p.deleted_at is null
        and p.status in ('discovered', 'researching', 'qualified')
        and p.priority <> 'ignore'
    ) >= coalesce(nullif(o.settings -> 'engine' ->> 'backlogCap', '')::bigint, 250)
$$;

-- ── RLS ────────────────────────────────────────────────────────────────────
--
-- Same generated pair as every other tenant table, so the structural test at
-- the bottom of verify-migrations.ts — "every table with an org_id has RLS
-- enabled, and at least one policy" — covers these two without being told
-- about them.

do $$
declare t text;
begin
  foreach t in array array['learning_runs', 'learning_findings']
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

-- ── Lockdown ───────────────────────────────────────────────────────────────
--
-- `saturated_org_ids` is cross-tenant by construction and belongs to the
-- scheduler alone. The other three take an org id and are safe for a member to
-- call about their own org — but only through a membership check, which is
-- what the `_for_org` wrapper below is. Same split as `0009`'s.

create or replace function public.backlog_state_for_org(p_org uuid)
returns table (open_count bigint, cap bigint, saturated boolean)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select b.open_count, b.cap, b.saturated
  from public.backlog_state(p_org) b
  where exists (
    select 1 from public.memberships m
    where m.org_id = p_org and m.user_id = auth.uid() and m.deleted_at is null
  )
$$;

do $$
begin
  revoke execute on function
    public.open_opportunity_count(uuid),
    public.backlog_cap(uuid),
    public.backlog_state(uuid),
    public.saturated_org_ids()
  from public;
exception when undefined_object or undefined_function then null;
end $$;

do $$
begin
  revoke execute on function
    public.open_opportunity_count(uuid),
    public.backlog_cap(uuid),
    public.backlog_state(uuid),
    public.saturated_org_ids()
  from anon, authenticated;

  grant execute on function
    public.open_opportunity_count(uuid),
    public.backlog_cap(uuid),
    public.backlog_state(uuid),
    public.saturated_org_ids()
  to service_role;
exception when undefined_object or undefined_function then null;
end $$;
