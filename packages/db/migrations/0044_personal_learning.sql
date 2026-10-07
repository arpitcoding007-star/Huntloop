-- 0044 — personal mode and the learning layer. COMMAND.md §16.3-K.
--
-- Huntloop learns how each person works, and keeps four kinds of knowledge
-- apart (docs/product/personalization-plan.md §4):
--
--   stated     a person told us            memories.origin = 'stated'
--   learned    concluded from behaviour    memories.origin = 'learned', with evidence
--   task-only  for one request             never stored here — it lives in the request
--   long-term  either of the first two, status = 'active'
--
-- ── A personal memory is now private (the blocker) ───────────────────────
--
-- `0004` put `memories` under the generic tenant policy, so every member could
-- read *and edit* a memory scoped to a colleague. A layer that learns how one
-- person writes cannot sit on that. User-scoped rows are now readable and
-- writable by their subject alone — the same rule `0004` gave conversations.
-- An admin sees a colleague's personal memory only once its owner shares it
-- (`shared_at`), and promotes it by writing an organisation-scope copy with
-- `promoted_from` set; the personal row is never edited by anyone else.
--
-- Owner decision (COMMAND.md §16.7, K decision 5): a user-scoped memory a colleague wrote *about*
-- somebody stays with the person it is about. Its author stops seeing it.
--
-- `export_organization` (an admin, SECURITY DEFINER) is redefined so it no
-- longer exports colleagues' personal memories; `export_my_learning` gives a
-- person everything Huntloop holds about how they work.
--
-- ── What else ────────────────────────────────────────────────────────────
--
--   organizations.workspace_kind   'personal' for a one-person workspace with
--                                  no company behind it (K1)
--   profiles.goals                 what *this person* wants, beside the org's
--   profiles.learning_paused       stops new observations immediately
--   preference_signals             what a person did — never what they read
--   memory_evidence                the observations behind a learned memory
--   preference_state               when a person's signals were last learned from
--   user_questions                 just-in-time questions, asked once (K4)
--   messages / conversation_messages.applied_memory_ids
--                                  what a draft or an answer was written with

-- ── Workspaces and people ─────────────────────────────────────────────────

alter table public.organizations
  add column if not exists workspace_kind text not null default 'company'
    check (workspace_kind in ('company', 'personal'));

comment on column public.organizations.workspace_kind is
  'personal: one person''s workspace, created without a company website. '
  'It becomes an ordinary team workspace by inviting people into it.';

alter table public.profiles
  add column if not exists goals text[] not null default '{}',
  add column if not exists learning_paused boolean not null default false;

alter table public.profiles drop constraint if exists profiles_goals_known;
alter table public.profiles
  add constraint profiles_goals_known check (
    cardinality(goals) <= 2
    and goals <@ array['discover', 'qualify', 'enrich', 'reach_out', 'learn']::text[]
  );

comment on column public.profiles.goals is
  'What this person wants Huntloop to do. The dashboard reads it before '
  'organizations.goals, which stays what the scheduler reads.';

-- ── Memories: provenance, status, evidence ────────────────────────────────

alter table public.memories
  add column if not exists origin text not null default 'stated'
    check (origin in ('stated', 'learned', 'promoted')),
  add column if not exists category text
    check (category is null or category in (
      'writing_style', 'output_format', 'research', 'targeting', 'workflow', 'context', 'interface'
    )),
  -- low: may apply itself, labelled, with undo. high: proposed until accepted.
  add column if not exists risk text not null default 'low' check (risk in ('low', 'high')),
  add column if not exists status text not null default 'active'
    check (status in ('proposed', 'active', 'paused', 'rejected')),
  -- Task names it applies to. Empty means every task that reads memories.
  add column if not exists applies_to text[] not null default '{}',
  add column if not exists support integer not null default 0 check (support >= 0),
  add column if not exists contradicts integer not null default 0 check (contradicts >= 0),
  add column if not exists last_reinforced_at timestamptz,
  add column if not exists last_applied_at timestamptz,
  add column if not exists shared_at timestamptz,
  add column if not exists promoted_from uuid references public.memories(id) on delete set null;

alter table public.memories drop constraint if exists memories_shared_is_personal;
alter table public.memories
  add constraint memories_shared_is_personal check (shared_at is null or scope = 'user');

-- `source` said who concluded it; `origin` says the same with a third value.
-- Writers that predate `origin` (Learn's "Accept") keep setting only `source`,
-- so the trigger keeps the two agreeing.
update public.memories set origin = 'learned' where source = 'derived' and origin = 'stated';

create or replace function public.memories_origin_from_source()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if new.source = 'derived' and new.origin = 'stated' then
    new.origin := 'learned';
  end if;
  return new;
end;
$$;

drop trigger if exists memories_origin on public.memories;
create trigger memories_origin before insert on public.memories
  for each row execute function public.memories_origin_from_source();

drop index if exists public.memories_retrieval_idx;
create index memories_retrieval_idx
  on public.memories (org_id, scope, scope_id)
  where deleted_at is null and status = 'active';

drop policy if exists tenant_read on public.memories;
drop policy if exists tenant_write on public.memories;
drop policy if exists memories_read on public.memories;
drop policy if exists memories_write_shared on public.memories;
drop policy if exists memories_write_own on public.memories;

create policy memories_read on public.memories
  for select using (
    org_id in (select public.user_org_ids())
    and (
      scope <> 'user'
      or scope_id = auth.uid()
      or (shared_at is not null and public.has_org_role(org_id, 'admin'))
    )
  );

create policy memories_write_shared on public.memories
  for all
  using (scope <> 'user' and public.has_org_role(org_id, 'member'))
  with check (scope <> 'user' and public.has_org_role(org_id, 'member'));

-- Any member, viewers included: a viewer has preferences too, and writing
-- their own changes nothing anybody else sees.
create policy memories_write_own on public.memories
  for all
  using (scope = 'user' and scope_id = auth.uid() and org_id in (select public.user_org_ids()))
  with check (scope = 'user' and scope_id = auth.uid() and org_id in (select public.user_org_ids()));

comment on table public.memories is
  'Master context §37. Retrieval MUST filter on (org_id, scope, scope_id) in '
  'packages/db only — never per call site. User-scoped rows are private to '
  'their subject (0044). §54: nothing global-scoped lives here.';

-- ── Signals: what a person did ────────────────────────────────────────────

create table if not exists public.preference_signals (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  kind         text not null check (kind in (
    'draft_edited', 'draft_rejected', 'draft_regenerated', 'assistant_correction',
    'score_override', 'disqualified', 'question_answered', 'applied_dismissed',
    'task_instruction'
  )),
  subject_type text,
  subject_id   uuid,
  -- A reason, an instruction, a correction — what the person typed. Short.
  note         text check (note is null or length(note) <= 1000),
  -- Computed deterministically when the signal is written (word deltas, …).
  features     jsonb not null default '{}'::jsonb,
  -- Set by the learner once it has considered this signal.
  learned_at   timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists preference_signals_user_idx
  on public.preference_signals (org_id, user_id, created_at desc);
create index if not exists preference_signals_pending_idx
  on public.preference_signals (org_id, user_id)
  where learned_at is null;

alter table public.preference_signals enable row level security;

drop policy if exists preference_signals_own on public.preference_signals;
create policy preference_signals_own on public.preference_signals
  for select using (user_id = auth.uid() and org_id in (select public.user_org_ids()));
drop policy if exists preference_signals_insert on public.preference_signals;
create policy preference_signals_insert on public.preference_signals
  for insert with check (user_id = auth.uid() and org_id in (select public.user_org_ids()));
drop policy if exists preference_signals_delete on public.preference_signals;
create policy preference_signals_delete on public.preference_signals
  for delete using (user_id = auth.uid() and org_id in (select public.user_org_ids()));

comment on table public.preference_signals is
  'Observations of a person''s own actions (0044). Never written from content '
  'they read — a prospect''s email is not a preference. Private to the person.';

create table if not exists public.memory_evidence (
  memory_id  uuid not null references public.memories(id) on delete cascade,
  signal_id  uuid not null references public.preference_signals(id) on delete cascade,
  org_id     uuid not null references public.organizations(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (memory_id, signal_id)
);

alter table public.memory_evidence enable row level security;
drop policy if exists memory_evidence_own on public.memory_evidence;
create policy memory_evidence_own on public.memory_evidence
  for select using (user_id = auth.uid() and org_id in (select public.user_org_ids()));
drop policy if exists memory_evidence_delete on public.memory_evidence;
create policy memory_evidence_delete on public.memory_evidence
  for delete using (user_id = auth.uid() and org_id in (select public.user_org_ids()));

create table if not exists public.preference_state (
  org_id          uuid not null references public.organizations(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  last_learned_at timestamptz,
  requested_at    timestamptz,
  primary key (org_id, user_id)
);

alter table public.preference_state enable row level security;
drop policy if exists preference_state_own on public.preference_state;
create policy preference_state_own on public.preference_state
  for all
  using (user_id = auth.uid() and org_id in (select public.user_org_ids()))
  with check (user_id = auth.uid() and org_id in (select public.user_org_ids()));

-- ── Questions, asked once ─────────────────────────────────────────────────

create table if not exists public.user_questions (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  question_key text not null check (question_key ~ '^[a-z][a-z0-9_.]{1,80}$'),
  status       text not null default 'asked'
    check (status in ('asked', 'answered', 'dismissed', 'snoozed')),
  asked_at     timestamptz not null default now(),
  answered_at  timestamptz,
  snooze_until timestamptz,
  answer       jsonb,
  memory_id    uuid references public.memories(id) on delete set null,
  updated_at   timestamptz not null default now(),
  unique (org_id, user_id, question_key)
);

alter table public.user_questions enable row level security;
drop policy if exists user_questions_own on public.user_questions;
create policy user_questions_own on public.user_questions
  for all
  using (user_id = auth.uid() and org_id in (select public.user_org_ids()))
  with check (user_id = auth.uid() and org_id in (select public.user_org_ids()));

drop trigger if exists user_questions_touch on public.user_questions;
create trigger user_questions_touch before update on public.user_questions
  for each row execute function public.touch_updated_at();

-- ── What an output was written with ───────────────────────────────────────

alter table public.messages
  add column if not exists applied_memory_ids uuid[] not null default '{}';
alter table public.conversation_messages
  add column if not exists applied_memory_ids uuid[] not null default '{}';

-- ── Data rights ───────────────────────────────────────────────────────────

-- `export_organization` from 0037, without colleagues' personal memories.
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
      from public.memories mem
      where mem.org_id = p_org and mem.deleted_at is null
        and (mem.scope <> 'user' or mem.scope_id = auth.uid())
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
      || 'them and they can be exported separately. Colleagues'' personal '
      || 'preferences are private to them and are not included.'
  ) into v_result;

  return v_result;
end;
$$;

-- Everything Huntloop holds about how the caller works, in one workspace.
-- Invoker rights: RLS already limits every table read here to the caller.
create or replace function public.export_my_learning(p_org uuid)
returns jsonb
language sql
stable
set search_path = public, pg_catalog
as $$
  select jsonb_build_object(
    'exportedAt', now(),
    'memories', coalesce((
      select jsonb_agg(to_jsonb(m) - 'org_id' order by m.created_at)
      from public.memories m
      where m.org_id = p_org and m.scope = 'user' and m.scope_id = auth.uid()
    ), '[]'::jsonb),
    'signals', coalesce((
      select jsonb_agg(to_jsonb(s) - 'org_id' order by s.created_at)
      from public.preference_signals s
      where s.org_id = p_org and s.user_id = auth.uid()
    ), '[]'::jsonb),
    'questions', coalesce((
      select jsonb_agg(to_jsonb(q) - 'org_id' order by q.asked_at)
      from public.user_questions q
      where q.org_id = p_org and q.user_id = auth.uid()
    ), '[]'::jsonb)
  );
$$;

-- A probe for `db:doctor` (see 0031).
create or replace function public.migration_0044_applied()
returns boolean
language sql
immutable
set search_path = public, pg_catalog
as $$ select true $$;
