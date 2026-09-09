-- 0018 — the learning loop, pointed at more than one thing.
--
-- ── What `0010` built, and what it left ──────────────────────────────────
--
-- `0010` built the machinery properly: append-only runs, independently
-- approvable findings, real foreign-key citations, a constraint tying a
-- decision to a decider, and — the check the tenth pass called the most
-- important one — a closed citation enum so a finding cannot name another
-- tenant's company.
--
-- None of that changes. What changes is what a finding is allowed to be
-- *about*.
--
-- Today the four kinds are `source_performance`, `scoring_adjustment`,
-- `style_guidance` and `icp_refinement`, and only `scoring_adjustment` and
-- `style_guidance` can be applied — into `scoring_rules` and `memories`. So
-- the loop improves how things are ranked and how messages read, and cannot
-- improve the two things upstream of both: who gets found, and who gets
-- contacted.
--
-- That is the gap the plan names as `LRN-02` through `LRN-06`. It is a small
-- migration because `0010` was built to be extended here — the `proposal`
-- jsonb and the `applied_type` / `applied_id` pair were designed for exactly
-- this and needed only more permitted values.
--
-- ── What is deliberately not changed ─────────────────────────────────────
--
-- Approval. Every new kind is still a proposal a person accepts or rejects,
-- and nothing here applies itself. The temptation with discovery feedback in
-- particular is to close the loop automatically — the system found companies,
-- some converted, so it narrows the filter itself. That is a system that
-- quietly stops looking at a segment because of six data points, and the
-- customer finds out months later.

-- ── More kinds ────────────────────────────────────────────────────────────
--
-- CHECK constraints cannot be extended in place; the old one is dropped and a
-- superset replaces it. Every existing value remains valid, so no row is
-- touched and no backfill is needed.

alter table learning_findings
  drop constraint if exists learning_findings_kind_check;

alter table learning_findings
  add constraint learning_findings_kind_check check (kind in (
    -- from 0010, unchanged
    'source_performance', 'scoring_adjustment', 'style_guidance', 'icp_refinement',
    -- new
    --   discovery_query   a filter is finding the wrong companies, or is
    --                     missing a segment that converts
    --   persona_fit       the titles that reply are not the titles the ICP
    --                     predicts
    --   outreach_angle    one angle precedes meetings more than the others.
    --                     Angles are enumerable, so this is counting rather
    --                     than inference — the strongest kind of finding here
    --   contact_selection the system's choice of who to contact is being
    --                     overridden in a consistent direction
    'discovery_query', 'persona_fit', 'outreach_angle', 'contact_selection'
  ));

alter table learning_findings
  drop constraint if exists learning_findings_applied_type_check;

alter table learning_findings
  add constraint learning_findings_applied_type_check check (
    applied_type is null or applied_type in (
      'scoring_rule', 'memory', 'discovery_query', 'persona', 'icp'
    )
  );

-- Citations for the two new subjects. Same pattern as `0010`'s three: real
-- uuid arrays, resolved by the loader under RLS, so a foreign id renders as
-- nothing rather than as somebody else's data.
alter table learning_findings
  add column cited_person_ids uuid[] not null default '{}',
  add column cited_query_ids  uuid[] not null default '{}';

-- ── What a run looked at ──────────────────────────────────────────────────
--
-- `learning_runs` counts outcomes, decisions and ratings. Overrides are the
-- fourth input and the most informative — a person disagreeing with the
-- system is a labelled example, where an outcome is only a correlation.

alter table learning_runs
  add column overrides_considered integer not null default 0,
  -- Which targets this run was asked to look at. Without it, a run that
  -- produced no discovery findings is indistinguishable from a run that never
  -- looked at discovery — and the screen would say "nothing to improve about
  -- your searches" on the strength of a question nobody asked.
  add column targets text[] not null default '{}';

-- ── Angles, made enumerable ───────────────────────────────────────────────
--
-- `LRN-05` only works if the angle used is recorded as a value rather than
-- reconstructed from message text. A model asked "what angle was this?" after
-- the fact is guessing at its own output, and the guess is what gets counted.

alter table messages
  -- The angle this message was written to. Free text, from a small vocabulary
  -- the drafter chooses from; not an enum, because the vocabulary is per-org
  -- and grows.
  add column outreach_angle text,
  -- The opportunity it belongs to, denormalized from the enrollment. The join
  -- through `enrollments` works but breaks for a one-off message with no
  -- enrollment, which is most manual sends — so the attribution the learning
  -- loop needs is missing exactly where a person did something interesting.
  add column opportunity_id uuid references opportunities(id) on delete set null,
  -- The contact fit score that chose this recipient, when one did. Closes the
  -- attribution chain: score → contact → angle → message → reply → outcome.
  add column contact_fit_id uuid references contact_fit_scores(id) on delete set null;

create index messages_angle_idx on messages (org_id, outreach_angle, sent_at desc)
  where outreach_angle is not null and sent_at is not null;
create index messages_opportunity_idx on messages (org_id, opportunity_id, created_at desc)
  where opportunity_id is not null;

-- ── Outcomes, tied to what predicted them ─────────────────────────────────

alter table outcomes
  -- The score row that stood when this outcome happened. `SCO-01` gave scores
  -- a provenance; this is what makes it useful — "the model said 82 and they
  -- said no" is only a data point if the 82 can be found again.
  add column score_id uuid references opportunity_scores(id) on delete set null,
  add column person_id uuid references people(id) on delete set null,
  add column outreach_angle text;

-- `disqualified` joins the six kinds `0004` defined.
--
-- It is the single most informative negative outcome available and there was
-- no way to record it: `lost` means a deal that was pursued and did not
-- close, which is a different fact and arrives months later. "We looked at
-- this and it was not a fit" arrives in seconds, happens far more often, and
-- is exactly the label the scoring loop needs — and until now the only place
-- it could go was nowhere.
--
-- `reason` beside it, because "not a fit" without a why cannot become a rule
-- proposal, and turning disqualifications into exclusions is the whole point.

alter table outcomes
  drop constraint if exists outcomes_kind_check;

alter table outcomes
  add constraint outcomes_kind_check check (kind in (
    'reply', 'positive', 'meeting', 'proposal', 'won', 'lost', 'disqualified'
  ));

alter table outcomes
  add column reason text;

create index outcomes_score_idx on outcomes (org_id, score_id)
  where score_id is not null;

-- ── Angle performance ─────────────────────────────────────────────────────
--
-- A view rather than a table, because it is entirely derived and a table
-- would be a cache that goes stale silently. `LRN-05`'s "this is counting,
-- not inference" is literal: there is no model in this path at all.
--
-- Written as a view so the learning task reads the same numbers the screen
-- shows. Two implementations of "reply rate by angle" is how a finding comes
-- to disagree with the dashboard that motivated it.

create or replace view angle_performance as
select
  m.org_id,
  m.outreach_angle                                          as angle,
  count(*) filter (where m.direction = 'outbound' and m.sent_at is not null) as sent,
  count(distinct m.thread_id) filter (
    where exists (
      select 1 from public.messages r
      where r.thread_id = m.thread_id and r.direction = 'inbound'
    )
  )                                                          as replied,
  count(*) filter (where o.kind = 'meeting')                 as meetings,
  min(m.sent_at)                                             as first_sent_at,
  max(m.sent_at)                                             as last_sent_at
from public.messages m
left join public.outcomes o
  on o.org_id = m.org_id
 and o.opportunity_id = m.opportunity_id
 and o.outreach_angle = m.outreach_angle
where m.outreach_angle is not null
  and m.deleted_at is null
group by m.org_id, m.outreach_angle;

-- ── Discovery performance ─────────────────────────────────────────────────
--
-- The same idea for `LRN-03`: which queries produced companies that became
-- something. The denominator is what makes it honest — a query that found two
-- companies and converted one is not a better query than one that found four
-- hundred and converted forty.

create or replace view discovery_performance as
select
  q.org_id,
  q.id                                                as query_id,
  q.name                                              as query_name,
  count(distinct d.company_id)                        as companies,
  count(distinct o.id)                                as opportunities,
  count(distinct o.id) filter (where o.priority in ('hot', 'warm')) as qualified,
  count(distinct oc.id) filter (where oc.kind = 'meeting')          as meetings,
  count(distinct oc.id) filter (where oc.kind = 'disqualified')     as disqualified,
  max(r.created_at)                                   as last_run_at
from public.discovery_queries q
left join public.discovery_runs r on r.query_id = q.id
left join public.discovery_results d on d.run_id = r.id and d.company_id is not null
left join public.opportunities o on o.company_id = d.company_id and o.deleted_at is null
left join public.outcomes oc on oc.opportunity_id = o.id
where q.deleted_at is null
group by q.org_id, q.id, q.name;

-- ── Persona performance ───────────────────────────────────────────────────

create or replace view persona_performance as
select
  p.org_id,
  p.id                                                as persona_id,
  p.name                                              as persona_name,
  p.icp_id,
  count(distinct pe.id)                               as contacts,
  count(distinct m.id) filter (where m.direction = 'outbound' and m.sent_at is not null) as sent,
  count(distinct m.thread_id) filter (
    where exists (
      select 1 from public.messages r2
      where r2.thread_id = m.thread_id and r2.direction = 'inbound'
    )
  )                                                    as replied
from public.personas p
left join public.people pe on pe.persona_id = p.id and pe.deleted_at is null
left join public.contact_points cp on cp.person_id = pe.id and cp.kind = 'email'
left join public.messages m on m.org_id = p.org_id and lower(m.to_email) = lower(cp.value)
where p.deleted_at is null
group by p.org_id, p.id, p.name, p.icp_id;

-- ── Views and RLS ─────────────────────────────────────────────────────────
--
-- A view runs with the privileges of its *owner* unless it is declared
-- `security_invoker`, which means a plain view over RLS-protected tables is a
-- hole straight through the tenant boundary — the one Critical risk in this
-- repo's own severity table.
--
-- `security_invoker = true` makes the underlying policies apply to whoever
-- selects from it, which is the only acceptable setting for a view over
-- tenant data. Postgres 15+, which Supabase runs.

alter view angle_performance set (security_invoker = true);
alter view discovery_performance set (security_invoker = true);
alter view persona_performance set (security_invoker = true);
