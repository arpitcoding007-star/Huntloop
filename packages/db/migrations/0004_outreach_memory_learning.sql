-- ============================================================================
-- 0004 — Outreach, the per-opportunity agent, memory, and outcomes
--
-- Two things in here carry rules rather than data:
--
--   · messages.evidence_ids — §62 rule 9 and plan §7.4. A personalized claim
--     names the evidence behind it or the message does not send.
--   · memories.scope — §37's hierarchy in one column, so permission-aware
--     retrieval is a single filter in a single module rather than a rule
--     every call site is trusted to remember (§54).
-- ============================================================================

create type memory_scope as enum (
  'organization', 'team', 'user', 'account', 'opportunity'
);

-- ── Mailboxes & campaigns ──────────────────────────────────────────────────

create table mailboxes (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references organizations(id) on delete cascade,
  provider           text not null check (provider in ('gmail', 'outlook', 'smtp')),
  email              text not null,
  display_name       text,
  -- Encrypted at the application layer before insert. Named _enc so a plain
  -- token assigned here is obvious in review.
  oauth_token_enc    text,
  refresh_token_enc  text,
  daily_limit        integer not null default 50,
  sent_today         integer not null default 0,
  health_score       integer check (health_score between 0 and 100),
  warmup_stage       text,
  status             text not null default 'connected',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  unique (org_id, email)
);

create table campaigns (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  name           text not null,
  icp_id         uuid references icps(id) on delete set null,
  product_id     uuid references products(id) on delete set null,
  status         text not null default 'draft',
  -- Master context §46 / spec Part 44: the autonomy ladder, per campaign.
  autonomy_level integer not null default 0 check (autonomy_level between 0 and 5),
  schedule       jsonb not null default '{}'::jsonb,
  sending_config jsonb not null default '{}'::jsonb,
  started_at     timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);

create table sequences (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  campaign_id uuid not null references campaigns(id) on delete cascade,
  name        text not null,
  version     integer not null default 1,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create table sequence_steps (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  sequence_id  uuid not null references sequences(id) on delete cascade,
  position     integer not null,
  kind         text not null check (kind in ('email', 'wait', 'condition')),
  delay_hours  integer not null default 0,
  template     jsonb not null default '{}'::jsonb,
  conditions   jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  unique (org_id, sequence_id, position)
);

create table enrollments (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  campaign_id    uuid not null references campaigns(id) on delete cascade,
  opportunity_id uuid not null references opportunities(id) on delete cascade,
  status         text not null default 'active',
  current_step   integer not null default 0,
  next_action_at timestamptz,
  parked_reason  text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  unique (org_id, campaign_id, opportunity_id)   -- no double-enrollment
);

-- The send scheduler's hot path: "what is due right now, across all orgs".
create index enrollments_due_idx
  on enrollments (org_id, next_action_at)
  where status = 'active';

create table suppressions (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations(id) on delete cascade,
  kind       text not null check (kind in ('email', 'domain')),
  value      text not null,
  reason     text,
  source     text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, kind, value)      -- checked before EVERY send
);

create table threads (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  opportunity_id  uuid references opportunities(id) on delete set null,
  mailbox_id      uuid references mailboxes(id) on delete set null,
  subject         text,
  status          text not null default 'open',
  classification  text,
  assignee_id     uuid references auth.users(id) on delete set null,
  last_message_at timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

create table messages (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references organizations(id) on delete cascade,
  enrollment_id       uuid references enrollments(id) on delete set null,
  step_id             uuid references sequence_steps(id) on delete set null,
  mailbox_id          uuid references mailboxes(id) on delete set null,
  thread_id           uuid references threads(id) on delete set null,
  direction           text not null check (direction in ('outbound', 'inbound')),
  subject             text,
  body_html           text,
  body_text           text,
  ai_generated        boolean not null default false,
  approved_by         uuid references auth.users(id) on delete set null,
  -- §62 rule 9: every personalized claim names the evidence backing it. A
  -- message whose evidence_ids do not cover its claims fails validation and
  -- goes to human review rather than out the door.
  evidence_ids        uuid[] not null default '{}',
  scheduled_at        timestamptz,
  sent_at             timestamptz,
  provider_message_id text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,

  -- §78 "Outreach failure: record the failure and do not falsely mark the
  -- message as sent." An outbound message cannot claim a send time without
  -- the provider id that proves it left.
  constraint messages_sent_has_provider_id
    check (direction <> 'outbound' or sent_at is null or provider_message_id is not null)
);

create table message_events (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  message_id  uuid not null references messages(id) on delete cascade,
  kind        text not null check (kind in (
                'delivered', 'bounced', 'opened', 'clicked',
                'replied', 'complained', 'unsubscribed', 'failed')),
  payload     jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index message_events_lookup_idx on message_events (org_id, message_id, kind);

-- ── The per-opportunity agent (master context §19) ─────────────────────────

create table conversations (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  opportunity_id  uuid not null references opportunities(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  title           text,
  last_message_at timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  -- §19: "every lead/opportunity should have its own discussion window", and
  -- §21 makes it personal to the salesperson rather than shared by default.
  unique (org_id, opportunity_id, user_id)
);

create table conversation_messages (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references organizations(id) on delete cascade,
  conversation_id    uuid not null references conversations(id) on delete cascade,
  role               text not null check (role in ('user', 'assistant', 'system')),
  content            text not null,
  ai_run_id          uuid,
  -- §62 rule 4: cite or identify evidence when making important claims. The
  -- agent's answer to "why do you think this?" is these ids.
  cited_evidence_ids uuid[] not null default '{}',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index conversation_messages_idx
  on conversation_messages (org_id, conversation_id, created_at);

-- ── Memory (master context §20, §21, §37, §54) ─────────────────────────────

create table memories (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  scope       memory_scope not null,
  -- The subject the scope refers to: a user id, a team id, a company id, an
  -- opportunity id. NULL for organization scope, which is the org itself.
  scope_id    uuid,
  kind        text not null default 'durable' check (kind in ('durable', 'conversational')),
  key         text,
  content     text not null,
  source      text not null default 'user' check (source in ('user', 'derived')),
  confidence  confidence,
  created_by  uuid references auth.users(id) on delete set null,
  expires_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,

  -- Organization scope is the org itself and takes no subject; every other
  -- scope is meaningless without one. Without this, a user-scoped memory with
  -- a NULL scope_id would match every user's retrieval filter — which is the
  -- §37 leak the whole scope column exists to prevent.
  constraint memories_scope_id_presence
    check ((scope = 'organization') = (scope_id is null))
);

create index memories_retrieval_idx
  on memories (org_id, scope, scope_id)
  where deleted_at is null;

comment on table memories is
  'Master context §37. Retrieval MUST filter on (org_id, scope, scope_id) in '
  'packages/db only — never per call site. §54: nothing global-scoped lives '
  'here, because global learning must not see one tenant''s private data.';

-- ── AI accounting & outcomes ───────────────────────────────────────────────

create table ai_runs (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations(id) on delete cascade,
  task              text not null,
  model             text not null,
  prompt_version    text not null,
  input_hash        text,
  input_tokens      integer not null default 0,
  output_tokens     integer not null default 0,
  cache_read_tokens integer not null default 0,
  cost_cents        numeric not null default 0,
  latency_ms        integer,
  status            text not null default 'started',
  error             text,
  entity_type       text,
  entity_id         uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Written BEFORE the model call (plan §6 invariant 2), so a crashed job still
-- appears in cost accounting rather than vanishing from the bill.
create index ai_runs_cost_idx on ai_runs (org_id, task, created_at desc);
create index ai_runs_dedupe_idx on ai_runs (org_id, task, input_hash);

create table ai_decisions (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  run_id         uuid references ai_runs(id) on delete set null,
  decision_type  text not null,
  output         jsonb not null,
  confidence     confidence,
  -- The human override record IS the training signal (plan §5). Keeping the
  -- original output alongside it is the whole point; overwriting would
  -- destroy the only labelled data the learning loop ever gets for free.
  human_override jsonb,
  overridden_by  uuid references auth.users(id) on delete set null,
  overridden_at  timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table outcomes (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  opportunity_id uuid references opportunities(id) on delete set null,
  campaign_id    uuid references campaigns(id) on delete set null,
  kind           text not null check (kind in (
                   'reply', 'positive', 'meeting', 'proposal', 'won', 'lost')),
  value_cents    bigint,
  occurred_at    timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index outcomes_learning_idx on outcomes (org_id, kind, occurred_at desc);

create table events (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  user_id     uuid references auth.users(id) on delete set null,
  name        text not null,
  properties  jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index events_idx on events (org_id, name, occurred_at desc);

create table job_executions (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid references organizations(id) on delete cascade,
  job_name    text not null,
  status      text not null default 'queued',
  attempts    integer not null default 0,
  payload     jsonb not null default '{}'::jsonb,
  error       text,
  started_at  timestamptz,
  finished_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index job_executions_idx on job_executions (org_id, job_name, created_at desc);

-- ── RLS ────────────────────────────────────────────────────────────────────

do $$
declare t text;
begin
  foreach t in array array[
    'mailboxes', 'campaigns', 'sequences', 'sequence_steps', 'enrollments',
    'suppressions', 'threads', 'messages', 'message_events',
    'memories', 'ai_runs', 'ai_decisions', 'outcomes', 'events',
    'job_executions'
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
    execute format(
      'create trigger %1$I_touch before update on public.%1$I '
      'for each row execute function public.touch_updated_at()', t
    );
  end loop;
end
$$;

-- Conversations are the exception: §21 makes a salesperson's own agent
-- conversation personal, so org membership alone is not enough to read it.
-- A manager who needs oversight gets it through a reviewed, audited path,
-- not by every member being able to read every colleague's chat.
alter table conversations         enable row level security;
alter table conversation_messages enable row level security;

create policy conversation_owner on conversations
  for all
  using (user_id = auth.uid() and org_id in (select public.user_org_ids()))
  with check (user_id = auth.uid() and org_id in (select public.user_org_ids()));

create policy conversation_messages_owner on conversation_messages
  for all
  using (
    org_id in (select public.user_org_ids())
    and conversation_id in (select id from public.conversations where user_id = auth.uid())
  )
  with check (
    org_id in (select public.user_org_ids())
    and conversation_id in (select id from public.conversations where user_id = auth.uid())
  );

create trigger conversations_touch before update on conversations
  for each row execute function public.touch_updated_at();
create trigger conversation_messages_touch before update on conversation_messages
  for each row execute function public.touch_updated_at();
