-- 0037 — the daily loop: one history per account, and what needs a person next.
--
-- COMMAND.md §16.5 is the plan this implements. In one sentence: Huntloop
-- recorded most of what happened to an opportunity in five different places,
-- and recorded none of what a salesperson did outside its own mailbox, so it
-- could not show a relationship's history, could not say what had gone quiet,
-- and its learning loop never saw a lost deal's reason.
--
-- ── What this migration adds ─────────────────────────────────────────────
--
--   activities          an append-only ledger, one row per thing that
--                       happened to an opportunity: emails both ways,
--                       bounces, stage / band / owner changes, overrides,
--                       recorded outcomes, and the touches a person logs by
--                       hand (LinkedIn, calls, meetings, notes).
--   attention_snoozes   per-person snoozes for "Needs you" items, so a
--                       snooze follows somebody between devices.
--   opportunities       next_step / next_step_due_at — one next step per
--                       opportunity, which is what a follow-up date is.
--   outcomes            reason_category / competitor_id / recorded_by — the
--                       why behind a loss or a disqualification (0018 gave
--                       `reason` and nothing ever wrote it).
--   messages            edited_* / original_* / rejected_* — a person
--                       changing or refusing an AI draft, kept as a fact
--                       about the draft rather than overwritten.
--
-- ── Why the ledger is fed by triggers ────────────────────────────────────
--
-- Five writers move the facts the ledger records: the sender, the mailbox
-- sync, the scorer, the pipeline board and the assignment screen, across two
-- packages. Asking each of them to also write an activity row is asking five
-- call sites to stay in agreement forever — and the first one that forgets
-- produces a timeline that silently lies by omission. A trigger on the source
-- table cannot forget.
--
-- The cost of that choice is that a trigger runs inside the write that fired
-- it, so a broken projection could fail a send. That is unacceptable, and it
-- is designed out rather than hoped away: every projection body is wrapped in
-- an exception block that downgrades any failure to a WARNING and lets the
-- source write commit. The ledger is a read model. Losing one of its rows is a
-- gap `backfill_activities` can repair; losing a send is not repairable.
--
-- ── Why the ledger does not copy content ─────────────────────────────────
--
-- An email activity stores no subject and no body — only a pointer to the
-- message. Copying them would put a second copy of a person's correspondence
-- somewhere `erase_contact` would have to remember to look. The only free text
-- in the ledger is what a person typed into a manual activity, and that is
-- covered by erasure below.
--
-- ── What sessions may write ──────────────────────────────────────────────
--
-- Only manual activities, only as themselves. Every system kind is written by
-- a SECURITY DEFINER trigger, so a member cannot plant an `email_sent` row
-- through PostgREST and make the timeline claim a send that never happened.

-- ── Draft review (P0-1) ───────────────────────────────────────────────────

alter table public.messages
  add column if not exists edited_by          uuid references auth.users(id) on delete set null,
  add column if not exists edited_at          timestamptz,
  -- The model's own words, kept only when a person changed them. Master
  -- context §27 asks whether a message was AI-generated *and* whether it was
  -- human-edited; without the original the second question has no answer.
  add column if not exists original_subject   text,
  add column if not exists original_body_text text,
  add column if not exists rejected_by        uuid references auth.users(id) on delete set null,
  add column if not exists rejected_at        timestamptz,
  add column if not exists rejection_reason   text
    check (rejection_reason is null or length(rejection_reason) <= 500);

-- The approval queue: outbound, unsent, unapproved, live.
create index if not exists messages_awaiting_approval_idx
  on public.messages (org_id, created_at desc)
  where direction = 'outbound' and sent_at is null and scheduled_at is null
    and deleted_at is null;

-- ── Next step (one per opportunity) ───────────────────────────────────────

alter table public.opportunities
  add column if not exists next_step        text
    check (next_step is null or length(next_step) between 1 and 280),
  add column if not exists next_step_due_at timestamptz,
  add column if not exists next_step_set_by uuid references auth.users(id) on delete set null,
  add column if not exists next_step_set_at timestamptz;

create index if not exists opportunities_next_step_due_idx
  on public.opportunities (org_id, next_step_due_at)
  where next_step_due_at is not null and deleted_at is null;

-- ── Why a deal ended ──────────────────────────────────────────────────────

alter table public.outcomes
  add column if not exists reason_category text
    check (reason_category is null or reason_category in (
      'no_need', 'no_budget', 'timing', 'chose_competitor', 'missing_capability',
      'no_response', 'not_a_fit', 'wrong_contact', 'other')),
  add column if not exists competitor_id uuid references public.competitors(id) on delete set null,
  add column if not exists recorded_by   uuid references auth.users(id) on delete set null;

alter table public.outcomes
  drop constraint if exists outcomes_reason_length;
alter table public.outcomes
  add constraint outcomes_reason_length check (reason is null or length(reason) <= 1000);

-- ── The ledger ────────────────────────────────────────────────────────────

create table if not exists public.activities (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  opportunity_id uuid references public.opportunities(id) on delete cascade,
  company_id     uuid references public.companies(id) on delete cascade,
  person_id      uuid references public.people(id) on delete set null,
  kind           text not null check (kind in (
                   -- written by triggers
                   'discovered', 'email_sent', 'email_received', 'email_bounced',
                   'email_complained', 'email_unsubscribed', 'draft_rejected',
                   'stage_changed', 'priority_changed', 'owner_changed',
                   'override_recorded', 'outcome_recorded',
                   -- written by people
                   'note', 'call', 'meeting', 'message', 'connection_request')),
  channel        text not null check (channel in
                   ('email', 'linkedin', 'phone', 'meeting', 'chat', 'other', 'system')),
  direction      text not null check (direction in ('outbound', 'inbound', 'internal')),
  actor_type     text not null check (actor_type in ('user', 'system', 'contact')),
  actor_id       uuid references auth.users(id) on delete set null,
  occurred_at    timestamptz not null,
  summary        text not null check (length(summary) between 1 and 500),
  body           text check (body is null or length(body) <= 10000),
  ref_type       text check (ref_type is null or ref_type in (
                   'opportunity', 'message', 'message_event', 'outcome', 'human_override')),
  ref_id         uuid,
  payload        jsonb not null default '{}'::jsonb,
  origin         text not null check (origin in ('trigger', 'manual', 'backfill')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,

  constraint activities_has_subject
    check (opportunity_id is not null or company_id is not null),
  constraint activities_ref_pair
    check ((ref_type is null) = (ref_id is null)),
  -- A hand-written row names who wrote it, and is one of the hand-written kinds.
  constraint activities_manual_shape
    check (origin <> 'manual' or (
      actor_id is not null and actor_type = 'user'
      and kind in ('note', 'call', 'meeting', 'message', 'connection_request'))),
  -- Only a hand-written row carries free text.
  constraint activities_body_is_manual
    check (body is null or origin = 'manual')
);

-- Idempotent projection: the same source row can never be projected twice,
-- which is what makes `backfill_activities` safe to re-run.
create unique index if not exists activities_projection_key
  on public.activities (org_id, ref_type, ref_id, kind)
  where ref_id is not null;

create index if not exists activities_opportunity_idx
  on public.activities (org_id, opportunity_id, occurred_at desc)
  where deleted_at is null;
create index if not exists activities_company_idx
  on public.activities (org_id, company_id, occurred_at desc)
  where deleted_at is null;
create index if not exists activities_kind_idx
  on public.activities (org_id, kind, occurred_at desc)
  where deleted_at is null;
create index if not exists activities_person_idx
  on public.activities (org_id, person_id)
  where person_id is not null;

alter table public.activities enable row level security;

create policy activities_read on public.activities
  for select using (org_id in (select public.user_org_ids()));

-- Manual rows only, written as yourself.
create policy activities_insert_manual on public.activities
  for insert with check (
    public.has_org_role(org_id, 'member')
    and origin = 'manual'
    and actor_id = auth.uid()
  );

-- Edit or soft-delete your own manual rows; an admin may tidy anyone's.
create policy activities_update_manual on public.activities
  for update
  using (
    origin = 'manual'
    and public.has_org_role(org_id, 'member')
    and (actor_id = auth.uid() or public.has_org_role(org_id, 'admin'))
  )
  with check (
    origin = 'manual'
    and public.has_org_role(org_id, 'member')
  );
-- No delete policy: the ledger is soft-deleted only.

create trigger activities_touch before update on public.activities
  for each row execute function public.touch_updated_at();

-- ── Snoozes ───────────────────────────────────────────────────────────────

create table if not exists public.attention_snoozes (
  org_id        uuid not null references public.organizations(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  -- `<kind>:<id>`, e.g. `quiet:<opportunity id>`. Opaque to the database.
  item_key      text not null check (length(item_key) between 3 and 200),
  snoozed_until timestamptz not null,
  created_at    timestamptz not null default now(),
  primary key (org_id, user_id, item_key)
);

alter table public.attention_snoozes enable row level security;

-- A snooze is a personal preference: nobody else reads or writes yours.
create policy snoozes_own on public.attention_snoozes
  for all
  using (user_id = auth.uid() and org_id in (select public.user_org_ids()))
  with check (user_id = auth.uid() and public.has_org_role(org_id, 'viewer'));

-- ── Projection helpers ────────────────────────────────────────────────────

-- The opportunity a message belongs to: its own column (0018), else its
-- thread's, else its enrollment's.
create or replace function public.message_opportunity(p_message public.messages)
returns uuid
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select coalesce(
    p_message.opportunity_id,
    (select t.opportunity_id from public.threads t where t.id = p_message.thread_id),
    (select e.opportunity_id from public.enrollments e where e.id = p_message.enrollment_id)
  )
$$;

-- ── Projection: messages ──────────────────────────────────────────────────

create or replace function public.project_message_activity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_opp     uuid;
  v_company uuid;
begin
  begin
    if new.deleted_at is not null and new.rejected_at is null then
      return new;
    end if;

    v_opp := public.message_opportunity(new);
    if v_opp is null then
      return new;   -- an unmatched inbound message has no account to sit on yet
    end if;
    select company_id into v_company from public.opportunities where id = v_opp;

    -- Sent: the moment `sent_at` first gets a value.
    if new.direction = 'outbound' and new.sent_at is not null
       and (tg_op = 'INSERT' or old.sent_at is null) then
      insert into public.activities
        (org_id, opportunity_id, company_id, kind, channel, direction, actor_type,
         actor_id, occurred_at, summary, ref_type, ref_id, payload, origin)
      values
        (new.org_id, v_opp, v_company, 'email_sent', 'email', 'outbound',
         case when new.approved_by is not null or not new.ai_generated then 'user' else 'system' end,
         new.approved_by, new.sent_at,
         case when new.ai_generated then 'Email sent (drafted by Huntloop)' else 'Email sent' end,
         'message', new.id,
         jsonb_build_object('aiGenerated', new.ai_generated, 'edited', new.edited_at is not null),
         'trigger')
      on conflict do nothing;
    end if;

    -- Received: on arrival.
    if new.direction = 'inbound' and tg_op = 'INSERT' then
      insert into public.activities
        (org_id, opportunity_id, company_id, kind, channel, direction, actor_type,
         occurred_at, summary, ref_type, ref_id, origin)
      values
        (new.org_id, v_opp, v_company, 'email_received', 'email', 'inbound', 'contact',
         coalesce(new.created_at, now()), 'Email received', 'message', new.id, 'trigger')
      on conflict do nothing;
    end if;

    -- Rejected by a person in the Inbox.
    if new.rejected_at is not null and (tg_op = 'INSERT' or old.rejected_at is null) then
      insert into public.activities
        (org_id, opportunity_id, company_id, kind, channel, direction, actor_type,
         actor_id, occurred_at, summary, ref_type, ref_id, payload, origin)
      values
        (new.org_id, v_opp, v_company, 'draft_rejected', 'email', 'internal', 'user',
         new.rejected_by, new.rejected_at, 'Draft rejected', 'message', new.id,
         jsonb_build_object('reason', new.rejection_reason), 'trigger')
      on conflict do nothing;
    end if;
  exception when others then
    raise warning 'project_message_activity: % (%)', sqlerrm, sqlstate;
  end;
  return new;
end;
$$;

drop trigger if exists messages_project_activity on public.messages;
create trigger messages_project_activity
  after insert or update of sent_at, rejected_at on public.messages
  for each row execute function public.project_message_activity();

-- ── Projection: delivery events ───────────────────────────────────────────

create or replace function public.project_message_event_activity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_message public.messages;
  v_opp     uuid;
  v_company uuid;
  v_kind    text;
begin
  begin
    v_kind := case new.kind
      when 'bounced' then 'email_bounced'
      when 'complained' then 'email_complained'
      when 'unsubscribed' then 'email_unsubscribed'
      else null end;
    -- Opens and clicks are deliberately not history: they are noisy, often
    -- machine-generated, and not something a person did.
    if v_kind is null then return new; end if;

    select * into v_message from public.messages where id = new.message_id;
    if v_message.id is null then return new; end if;
    v_opp := public.message_opportunity(v_message);
    if v_opp is null then return new; end if;
    select company_id into v_company from public.opportunities where id = v_opp;

    insert into public.activities
      (org_id, opportunity_id, company_id, kind, channel, direction, actor_type,
       occurred_at, summary, ref_type, ref_id, origin)
    values
      (new.org_id, v_opp, v_company, v_kind, 'email', 'inbound', 'system',
       coalesce(new.occurred_at, now()),
       case v_kind
         when 'email_bounced' then 'Email bounced'
         when 'email_complained' then 'Marked as spam'
         else 'Unsubscribed' end,
       'message_event', new.id, 'trigger')
    on conflict do nothing;
  exception when others then
    raise warning 'project_message_event_activity: % (%)', sqlerrm, sqlstate;
  end;
  return new;
end;
$$;

drop trigger if exists message_events_project_activity on public.message_events;
create trigger message_events_project_activity
  after insert on public.message_events
  for each row execute function public.project_message_event_activity();

-- ── Projection: opportunities ─────────────────────────────────────────────

create or replace function public.project_opportunity_activity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_actor uuid := auth.uid();
  v_type  text := case when auth.uid() is null then 'system' else 'user' end;
begin
  begin
    if tg_op = 'INSERT' then
      insert into public.activities
        (org_id, opportunity_id, company_id, kind, channel, direction, actor_type,
         actor_id, occurred_at, summary, ref_type, ref_id, payload, origin)
      values
        (new.org_id, new.id, new.company_id, 'discovered', 'system', 'internal', v_type,
         v_actor, coalesce(new.first_seen_at, now()), 'Opportunity found',
         'opportunity', new.id,
         jsonb_build_object('priority', new.priority, 'via', new.discovered_via),
         'trigger')
      on conflict do nothing;
      return new;
    end if;

    if new.status is distinct from old.status then
      insert into public.activities
        (org_id, opportunity_id, company_id, kind, channel, direction, actor_type,
         actor_id, occurred_at, summary, payload, origin)
      values
        (new.org_id, new.id, new.company_id, 'stage_changed', 'system', 'internal', v_type,
         v_actor, now(), 'Moved to ' || new.status,
         jsonb_build_object('from', old.status, 'to', new.status), 'trigger');
    end if;

    -- A person's band change is projected from `human_overrides`, which
    -- carries their reason; recording it here too would say it twice. Only
    -- the engine's band changes come through this branch, and only when the
    -- band actually moved — a rescore inside the same band is not history.
    if new.priority is distinct from old.priority and v_actor is null then
      insert into public.activities
        (org_id, opportunity_id, company_id, kind, channel, direction, actor_type,
         occurred_at, summary, payload, origin)
      values
        (new.org_id, new.id, new.company_id, 'priority_changed', 'system', 'internal',
         'system', now(), 'Priority ' || old.priority || ' → ' || new.priority,
         jsonb_build_object('from', old.priority, 'to', new.priority), 'trigger');
    end if;

    if new.owner_id is distinct from old.owner_id then
      insert into public.activities
        (org_id, opportunity_id, company_id, kind, channel, direction, actor_type,
         actor_id, occurred_at, summary, payload, origin)
      values
        (new.org_id, new.id, new.company_id, 'owner_changed', 'system', 'internal', v_type,
         v_actor, now(),
         case when new.owner_id is null then 'Unassigned' else 'Owner changed' end,
         jsonb_build_object('from', old.owner_id, 'to', new.owner_id), 'trigger');
    end if;
  exception when others then
    raise warning 'project_opportunity_activity: % (%)', sqlerrm, sqlstate;
  end;
  return new;
end;
$$;

drop trigger if exists opportunities_project_activity on public.opportunities;
create trigger opportunities_project_activity
  after insert or update of status, priority, owner_id on public.opportunities
  for each row execute function public.project_opportunity_activity();

-- ── Projection: human overrides ───────────────────────────────────────────

create or replace function public.project_override_activity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_opp     uuid;
  v_company uuid;
begin
  begin
    if new.entity_type = 'opportunity' then
      v_opp := new.entity_id;
      select company_id into v_company from public.opportunities where id = v_opp;
    elsif new.entity_type = 'company' then
      v_company := new.entity_id;
    else
      return new;   -- person-level overrides have no account timeline yet
    end if;
    if v_opp is null and v_company is null then return new; end if;

    insert into public.activities
      (org_id, opportunity_id, company_id, kind, channel, direction, actor_type,
       actor_id, occurred_at, summary, ref_type, ref_id, payload, origin)
    values
      (new.org_id, v_opp, v_company, 'override_recorded', 'system', 'internal', 'user',
       new.actor_id, new.created_at,
       case new.subject
         when 'opportunity_priority' then
           'Priority ' || coalesce(new.system_value, '?') || ' → ' || new.human_value || ' (your call)'
         when 'company_excluded' then 'Company excluded'
         else 'Correction recorded' end,
       'human_override', new.id,
       jsonb_build_object('subject', new.subject, 'from', new.system_value,
                          'to', new.human_value, 'reason', new.reason),
       'trigger')
    on conflict do nothing;
  exception when others then
    raise warning 'project_override_activity: % (%)', sqlerrm, sqlstate;
  end;
  return new;
end;
$$;

drop trigger if exists human_overrides_project_activity on public.human_overrides;
create trigger human_overrides_project_activity
  after insert on public.human_overrides
  for each row execute function public.project_override_activity();

-- ── Projection: outcomes that carry a why ─────────────────────────────────

create or replace function public.project_outcome_activity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_company uuid;
begin
  begin
    -- Stages already appear as stage changes. An outcome is only its own
    -- history when it says something a stage cannot: why it was lost, or
    -- that it was never a fit.
    if new.opportunity_id is null then return new; end if;
    if new.kind not in ('lost', 'disqualified', 'won') then return new; end if;
    if new.kind in ('lost', 'won') and new.reason is null and new.reason_category is null then
      return new;
    end if;
    select company_id into v_company from public.opportunities where id = new.opportunity_id;

    insert into public.activities
      (org_id, opportunity_id, company_id, kind, channel, direction, actor_type,
       actor_id, occurred_at, summary, ref_type, ref_id, payload, origin)
    values
      (new.org_id, new.opportunity_id, v_company, 'outcome_recorded', 'system', 'internal',
       case when new.recorded_by is null then 'system' else 'user' end,
       new.recorded_by, new.occurred_at,
       case new.kind
         when 'disqualified' then 'Marked not a fit'
         when 'lost' then 'Lost'
         else 'Won' end,
       'outcome', new.id,
       jsonb_build_object('kind', new.kind, 'category', new.reason_category,
                          'reason', new.reason, 'competitorId', new.competitor_id),
       'trigger')
    on conflict do nothing;
  exception when others then
    raise warning 'project_outcome_activity: % (%)', sqlerrm, sqlstate;
  end;
  return new;
end;
$$;

drop trigger if exists outcomes_project_activity on public.outcomes;
create trigger outcomes_project_activity
  after insert or update of reason, reason_category on public.outcomes
  for each row execute function public.project_outcome_activity();

-- ── Backfill ──────────────────────────────────────────────────────────────
--
-- Projects what already exists. Idempotent on the projection key, so it is
-- safe to re-run — per org, or for everyone when p_org is null. Stage history
-- from before this migration cannot be reconstructed; recorded outcomes stand
-- in for the milestones they mark, and the timeline says so.

create or replace function public.backfill_activities(p_org uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_n      integer;
  v_result jsonb := '{}'::jsonb;
begin
  insert into public.activities
    (org_id, opportunity_id, company_id, kind, channel, direction, actor_type,
     occurred_at, summary, ref_type, ref_id, payload, origin)
  select o.org_id, o.id, o.company_id, 'discovered', 'system', 'internal', 'system',
         o.first_seen_at, 'Opportunity found', 'opportunity', o.id,
         jsonb_build_object('priority', o.priority, 'via', o.discovered_via), 'backfill'
  from public.opportunities o
  where (p_org is null or o.org_id = p_org) and o.deleted_at is null
  on conflict do nothing;
  get diagnostics v_n = row_count;
  v_result := v_result || jsonb_build_object('discovered', v_n);

  insert into public.activities
    (org_id, opportunity_id, company_id, kind, channel, direction, actor_type,
     actor_id, occurred_at, summary, ref_type, ref_id, payload, origin)
  select m.org_id, x.opp, op.company_id,
         case when m.direction = 'outbound' then 'email_sent' else 'email_received' end,
         'email', m.direction,
         case when m.direction = 'inbound' then 'contact'
              when m.approved_by is not null or not m.ai_generated then 'user'
              else 'system' end,
         case when m.direction = 'outbound' then m.approved_by end,
         coalesce(m.sent_at, m.created_at),
         case when m.direction = 'inbound' then 'Email received'
              when m.ai_generated then 'Email sent (drafted by Huntloop)'
              else 'Email sent' end,
         'message', m.id,
         case when m.direction = 'outbound'
              then jsonb_build_object('aiGenerated', m.ai_generated) else '{}'::jsonb end,
         'backfill'
  from public.messages m
  cross join lateral (select public.message_opportunity(m) as opp) x
  join public.opportunities op on op.id = x.opp
  where (p_org is null or m.org_id = p_org)
    and m.deleted_at is null
    and (m.direction = 'inbound' or m.sent_at is not null)
  on conflict do nothing;
  get diagnostics v_n = row_count;
  v_result := v_result || jsonb_build_object('emails', v_n);

  insert into public.activities
    (org_id, opportunity_id, company_id, kind, channel, direction, actor_type,
     occurred_at, summary, ref_type, ref_id, origin)
  select e.org_id, x.opp, op.company_id,
         case e.kind when 'bounced' then 'email_bounced'
                     when 'complained' then 'email_complained'
                     else 'email_unsubscribed' end,
         'email', 'inbound', 'system', e.occurred_at,
         case e.kind when 'bounced' then 'Email bounced'
                     when 'complained' then 'Marked as spam'
                     else 'Unsubscribed' end,
         'message_event', e.id, 'backfill'
  from public.message_events e
  join public.messages m on m.id = e.message_id
  cross join lateral (select public.message_opportunity(m) as opp) x
  join public.opportunities op on op.id = x.opp
  where (p_org is null or e.org_id = p_org)
    and e.kind in ('bounced', 'complained', 'unsubscribed')
  on conflict do nothing;
  get diagnostics v_n = row_count;
  v_result := v_result || jsonb_build_object('events', v_n);

  -- Milestones from before the ledger, standing in for stage history. Skipped
  -- where the ledger already recorded the move, so a re-run never doubles one.
  insert into public.activities
    (org_id, opportunity_id, company_id, kind, channel, direction, actor_type,
     occurred_at, summary, ref_type, ref_id, payload, origin)
  select oc.org_id, oc.opportunity_id, op.company_id, 'stage_changed', 'system', 'internal',
         'system', oc.occurred_at, 'Moved to ' || oc.kind, 'outcome', oc.id,
         jsonb_build_object('to', oc.kind, 'reconstructed', true), 'backfill'
  from public.outcomes oc
  join public.opportunities op on op.id = oc.opportunity_id
  where (p_org is null or oc.org_id = p_org)
    and oc.kind in ('meeting', 'proposal', 'won', 'lost')
    and not exists (
      select 1 from public.activities a
      where a.opportunity_id = oc.opportunity_id
        and a.kind = 'stage_changed'
        and a.payload ->> 'to' = oc.kind
        and a.origin = 'trigger')
  on conflict do nothing;
  get diagnostics v_n = row_count;
  v_result := v_result || jsonb_build_object('milestones', v_n);

  insert into public.activities
    (org_id, opportunity_id, company_id, kind, channel, direction, actor_type,
     actor_id, occurred_at, summary, ref_type, ref_id, payload, origin)
  select h.org_id, h.entity_id, op.company_id, 'override_recorded', 'system', 'internal',
         'user', h.actor_id, h.created_at,
         case h.subject
           when 'opportunity_priority' then
             'Priority ' || coalesce(h.system_value, '?') || ' → ' || h.human_value || ' (your call)'
           else 'Correction recorded' end,
         'human_override', h.id,
         jsonb_build_object('subject', h.subject, 'from', h.system_value,
                            'to', h.human_value, 'reason', h.reason),
         'backfill'
  from public.human_overrides h
  join public.opportunities op on op.id = h.entity_id
  where (p_org is null or h.org_id = p_org) and h.entity_type = 'opportunity'
  on conflict do nothing;
  get diagnostics v_n = row_count;
  v_result := v_result || jsonb_build_object('overrides', v_n);

  return v_result;
end;
$$;

-- Engine and migration only.
revoke execute on function public.backfill_activities(uuid) from public;
revoke execute on function public.message_opportunity(public.messages) from public;
do $$
begin
  revoke execute on function public.backfill_activities(uuid) from anon, authenticated;
  revoke execute on function public.message_opportunity(public.messages) from anon, authenticated;
exception when undefined_object then null;
end $$;
do $$
begin
  grant execute on function public.backfill_activities(uuid) to service_role;
exception when undefined_object then null;
end $$;

select public.backfill_activities(null);

-- ── Data rights: the ledger joins erasure and export ──────────────────────
--
-- `erase_contact` from 0017, with three additions and nothing removed:
--   · inbound mail *from* the person is redacted as well as mail to them
--     (the original only matched `to_email`, so a prospect's own replies
--     survived their erasure);
--   · the AI original kept beside an edited draft is redacted with it;
--   · hand-written activities about the person lose their text.

create or replace function public.erase_contact(
  p_org   uuid,
  p_email text,
  p_actor uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_email  text := lower(trim(p_email));
  v_hash   text;
  v_people uuid[];
  v_result jsonb := '{}'::jsonb;
  v_n      integer;
begin
  if v_email is null or v_email = '' then
    raise exception 'erase_contact: no address given';
  end if;

  v_hash := encode(sha256(v_email::bytea), 'hex');

  -- Suppression first, by hash: a crash below leaves the person protected.
  insert into public.suppressions (org_id, kind, value, value_hash, reason, source, is_erasure_residue)
  values (p_org, 'email', v_hash, v_hash, 'erasure request', 'gdpr', true)
  on conflict (org_id, kind, value) do update
    set value_hash = excluded.value_hash,
        is_erasure_residue = true,
        updated_at = now();

  select array_agg(distinct cp.person_id) into v_people
  from public.contact_points cp
  where cp.org_id = p_org and cp.kind = 'email' and lower(cp.value) = v_email;

  delete from public.contact_points
  where org_id = p_org and kind = 'email' and lower(value) = v_email;
  get diagnostics v_n = row_count;
  v_result := v_result || jsonb_build_object('contact_points', v_n);

  update public.messages m
    set body_html = null,
        body_text = null,
        original_body_text = null,
        original_subject = null,
        subject = '[erased]',
        to_email = case when lower(m.to_email) = v_email then v_hash else m.to_email end,
        from_email = case when lower(m.from_email) = v_email then v_hash else m.from_email end,
        updated_at = now()
    where m.org_id = p_org
      and (lower(m.to_email) = v_email or lower(m.from_email) = v_email);
  get diagnostics v_n = row_count;
  v_result := v_result || jsonb_build_object('messages_redacted', v_n);

  if v_people is not null then
    delete from public.enrichment_records
    where org_id = p_org and entity_type = 'person' and entity_id = any(v_people);
    get diagnostics v_n = row_count;
    v_result := v_result || jsonb_build_object('enrichment_records', v_n);

    update public.activities
      set body = null, summary = '[erased]', updated_at = now()
      where org_id = p_org and person_id = any(v_people) and origin = 'manual';
    get diagnostics v_n = row_count;
    v_result := v_result || jsonb_build_object('activities_redacted', v_n);

    update public.people
      set first_name = null, last_name = null, linkedin_url = null,
          departed_note = null, deleted_at = coalesce(deleted_at, now()),
          updated_at = now()
      where org_id = p_org and id = any(v_people);
    get diagnostics v_n = row_count;
    v_result := v_result || jsonb_build_object('people', v_n);
  end if;

  insert into public.audit_logs (org_id, actor_id, action, target_type, target_id, meta)
  values (p_org, p_actor, 'contact.erased', 'contact', null,
          jsonb_build_object('hash', v_hash, 'result', v_result));

  return v_result;
end;
$$;

-- `export_contact` from 0017, plus the person's activities.
create or replace function public.export_contact(p_org uuid, p_email text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select jsonb_build_object(
    'email', lower(trim(p_email)),
    'exportedAt', now(),
    'people', coalesce((
      select jsonb_agg(to_jsonb(pe) - 'org_id')
      from public.people pe
      join public.contact_points cp on cp.person_id = pe.id
      where cp.org_id = p_org and cp.kind = 'email' and lower(cp.value) = lower(trim(p_email))
    ), '[]'::jsonb),
    'contactPoints', coalesce((
      select jsonb_agg(to_jsonb(cp) - 'org_id')
      from public.contact_points cp
      where cp.org_id = p_org and cp.kind = 'email' and lower(cp.value) = lower(trim(p_email))
    ), '[]'::jsonb),
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'direction', m.direction, 'subject', m.subject,
        'sentAt', m.sent_at, 'createdAt', m.created_at
      ))
      from public.messages m
      where m.org_id = p_org
        and (lower(m.to_email) = lower(trim(p_email)) or lower(m.from_email) = lower(trim(p_email)))
    ), '[]'::jsonb),
    'activities', coalesce((
      select jsonb_agg(jsonb_build_object(
        'kind', a.kind, 'channel', a.channel, 'direction', a.direction,
        'occurredAt', a.occurred_at, 'summary', a.summary, 'body', a.body
      ))
      from public.activities a
      join public.contact_points cp3 on cp3.person_id = a.person_id
      where a.org_id = p_org and a.deleted_at is null
        and cp3.kind = 'email' and lower(cp3.value) = lower(trim(p_email))
    ), '[]'::jsonb),
    'enrichment', coalesce((
      select jsonb_agg(jsonb_build_object(
        'provider', er.provider, 'field', er.field, 'fetchedAt', er.fetched_at
      ))
      from public.enrichment_records er
      join public.contact_points cp2 on cp2.person_id = er.entity_id
      where er.org_id = p_org and er.entity_type = 'person'
        and cp2.kind = 'email' and lower(cp2.value) = lower(trim(p_email))
    ), '[]'::jsonb),
    'suppressed', public.is_suppressed(p_org, lower(trim(p_email))),
    'frequency', coalesce((
      select to_jsonb(f) - 'org_id' from public.contact_frequency f
      where f.org_id = p_org and f.email = lower(trim(p_email))
    ), 'null'::jsonb)
  );
$$;

-- `export_organization` from 0029, plus the ledger in full.
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
    'activities', coalesce((
      select jsonb_agg(to_jsonb(a) - 'org_id' order by a.occurred_at)
      from public.activities a where a.org_id = p_org and a.deleted_at is null
    ), '[]'::jsonb),
    'memories', coalesce((
      select jsonb_agg(to_jsonb(mem) - 'org_id')
      from public.memories mem where mem.org_id = p_org and mem.deleted_at is null
    ), '[]'::jsonb),
    'counts', jsonb_build_object(
      'evidence', (select count(*) from public.evidence where org_id = p_org),
      'messages', (select count(*) from public.messages where org_id = p_org),
      'people', (select count(*) from public.people where org_id = p_org),
      'aiRuns', (select count(*) from public.ai_runs where org_id = p_org)
    ),
    'note',
      'Companies, opportunities, activities, ICPs, products and memories are '
      || 'included in full. Evidence, messages, people and AI run records are '
      || 'counted rather than included because they are large; ask for any of '
      || 'them and they can be exported separately.'
  ) into v_result;

  return v_result;
end;
$$;

-- A probe for `db:doctor` (see 0031).
create or replace function public.migration_0037_applied()
returns boolean
language sql
immutable
set search_path = public, pg_catalog
as $$ select true $$;
