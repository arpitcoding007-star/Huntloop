-- 0054 — hot-path FK indexes, a date on "why now", and an activation view.
--
-- ── PERF-302 (pass 17) · foreign keys with nothing to search by ──────────
--
-- 142 single-column foreign keys have no index whose first column is the FK.
-- Every composite index here leads with `org_id`, and two things do not use
-- `org_id`: PostgREST embeds (`companies(people(...))` joins on the FK alone)
-- and `ON DELETE CASCADE` / `SET NULL` from the parent, which scans the child.
-- PERF-301 measured what that costs on the inbox (46.7 s → 0.74 s).
--
-- These are the seventeen on paths a screen embeds or a delete/merge
-- cascades through. The rest are on small or rarely-joined tables (audit
-- columns like `approved_by`, `recorded_by`), where an index costs writes and
-- buys nothing. `verify-migrations.ts` holds the remaining count as a ceiling,
-- so a new FK has to come with an index or raise the ceiling on purpose.
--
-- Plain `create index`, not `concurrently`, like 0052: the SQL editor runs a
-- file as one transaction, and `concurrently` cannot run inside one. On the
-- current data sizes each build takes milliseconds.
--
-- Named `*_fk_idx` on purpose. Six of the obvious names (`people_company_idx`,
-- `messages_opportunity_idx`, ...) already exist as composites leading with
-- `org_id`, and `create index if not exists` skips silently on a name match,
-- whatever the columns. The first draft of this file did exactly that.
--
-- ── TRUST-301 (pass 17) · and why "why now" was always empty ─────────────
--
-- The audit found model prose like "closed three days ago" shown with no date
-- for when it was written. Tracing it found something larger: nothing in the
-- live code path writes `opportunities.why_now`. The Analyze screen asks the
-- model and shows the answer, but saving the verdict does not carry it (the
-- why-now is not covered by the verdict's seal, RT-001), and no job writes it.
-- Only the seed did. So on a real workspace the "Why now" block on every
-- opportunity read "Not established by the evidence on file", whatever the
-- evidence said.
--
-- The app now works it out server-side, from the evidence in the database,
-- and stores it here with the moment it was written. The page shows that
-- date, and the task is told never to write relative time.
--
-- ── ANL-301 (pass 17) · nothing measured whether it works ────────────────
--
-- `org_activation` is one row per workspace with the first moment each step
-- of the loop happened, and 30-day counts. Derived from tables that already
-- exist, so it needs no new tracking and sends nothing anywhere.
-- `security_invoker`, like every view since 0019: a member sees their own
-- workspaces' rows, the service role sees all of them.

-- ── PERF-302 ────────────────────────────────────────────────────────────
create index if not exists opportunities_company_fk_idx        on public.opportunities (company_id);
create index if not exists opportunity_scores_opportunity_fk_idx on public.opportunity_scores (opportunity_id);
create index if not exists people_company_fk_idx               on public.people (company_id);
create index if not exists contact_points_person_fk_idx        on public.contact_points (person_id);
create index if not exists enrollments_opportunity_fk_idx      on public.enrollments (opportunity_id);
create index if not exists enrollments_campaign_fk_idx         on public.enrollments (campaign_id);
create index if not exists messages_opportunity_fk_idx         on public.messages (opportunity_id);
create index if not exists messages_step_fk_idx                on public.messages (step_id);
create index if not exists threads_opportunity_fk_idx          on public.threads (opportunity_id);
create index if not exists activities_opportunity_fk_idx       on public.activities (opportunity_id);
create index if not exists activities_company_fk_idx           on public.activities (company_id);
create index if not exists company_triggers_company_fk_idx     on public.company_triggers (company_id);
create index if not exists source_events_company_fk_idx        on public.source_events (company_id);
create index if not exists source_events_document_fk_idx       on public.source_events (source_document_id);
create index if not exists conversation_messages_conversation_fk_idx on public.conversation_messages (conversation_id);
create index if not exists sequence_steps_sequence_fk_idx      on public.sequence_steps (sequence_id);
create index if not exists outcomes_opportunity_fk_idx         on public.outcomes (opportunity_id);

-- ── TRUST-301 ───────────────────────────────────────────────────────────
alter table public.opportunities
  add column if not exists why_now_written_at timestamptz;

comment on column public.opportunities.why_now_written_at is
  'When `why_now` was written (by the app, from the evidence on file). Null '
  'when it never was, or for text written before 0054. Shown beside the text, '
  'because a timing argument without a date reads as current forever.';

-- ── ANL-301 ─────────────────────────────────────────────────────────────
create or replace view public.org_activation as
select
  o.id                       as org_id,
  o.slug,
  o.created_at               as signed_up_at,
  o.onboarding_completed_at,
  (select min(s.computed_at)
     from public.opportunity_scores s
     join public.opportunities op on op.id = s.opportunity_id
    where s.org_id = o.id
      and op.priority in ('hot', 'warm')
      and op.deleted_at is null)                        as first_warm_at,
  (select min(m.sent_at)
     from public.messages m
    where m.org_id = o.id and m.direction = 'outbound'
      and m.sent_at is not null and m.deleted_at is null) as first_send_at,
  (select min(m.created_at)
     from public.messages m
    where m.org_id = o.id and m.direction = 'inbound'
      and m.deleted_at is null)                         as first_reply_at,
  (select min(x.occurred_at)
     from public.outcomes x
    where x.org_id = o.id and x.kind = 'meeting')       as first_meeting_at,
  (select count(*)
     from public.messages m
    where m.org_id = o.id and m.direction = 'outbound'
      and m.sent_at > now() - interval '30 days'
      and m.deleted_at is null)                         as sent_30d,
  (select count(*)
     from public.messages m
    where m.org_id = o.id and m.direction = 'inbound'
      and m.created_at > now() - interval '30 days'
      and m.deleted_at is null)                         as replies_30d,
  (select count(*)
     from public.messages m
    where m.org_id = o.id and m.direction = 'outbound'
      and m.ai_generated
      and m.created_at > now() - interval '30 days')    as drafts_30d,
  (select count(*)
     from public.messages m
    where m.org_id = o.id and m.direction = 'outbound'
      and m.rejected_by is not null
      and m.created_at > now() - interval '30 days')    as drafts_rejected_30d,
  (select count(*)
     from public.outcomes x
    where x.org_id = o.id and x.kind = 'meeting'
      and x.occurred_at > now() - interval '30 days')   as meetings_30d
from public.organizations o
where o.deleted_at is null;

alter view public.org_activation set (security_invoker = true);

comment on view public.org_activation is
  'ANL-301. One row per workspace: when each step of the loop first happened '
  '(warm opportunity, send, reply, meeting) and 30-day counts. Activation is '
  'first_send_at within 7 days of signed_up_at. security_invoker, so a session '
  'sees only its own workspaces.';

do $$
begin
  revoke all on public.org_activation from anon;
  grant select on public.org_activation to authenticated, service_role;
exception when undefined_object then null;
end $$;

-- A probe for `db:doctor` (see 0031).
create or replace function public.migration_0054_applied()
returns boolean
language sql
immutable
set search_path = public, pg_catalog
as $$ select true $$;
