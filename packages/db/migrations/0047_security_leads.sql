-- ============================================================================
-- 0047 — Closing the database leads from the 2026-10-11 security audit
--
-- The audit (run-1, `quick` profile) left thirteen leads. Seven of them were
-- reproduced on a fresh copy of these migrations by
-- `scripts/verify-security-leads.ts`. That script now asserts the fixed
-- behaviour and runs in `npm test`. Each section below names its lead.
--
-- "A session" below means a request made with a signed-in user's JWT:
-- `auth.uid()` is set. The engine and pg_cron run as the service role with no
-- `auth.uid()`, and are trusted, the same convention `guard_membership_owner`
-- (0031) uses. Lead 1 needs one exception, explained there.
-- ============================================================================

-- ── Lead 1: an admin could rewrite plan_id and deleted_at ──────────────────
--
-- `org_write` (0001) lets an admin update every column of their own
-- organisation. Every self-serve sign-up is the owner of the workspace it
-- creates, so anyone could set `plan_id` to NULL (no limits, see
-- `usage_limit`) or to a paid plan, and an admin who is not an owner could
-- set `deleted_at` directly, skipping `delete_organization`'s owner check and
-- its shutdown of campaigns, enrollments, sources and discovery.
--
-- The columns below belong to the operator and to `delete_organization`.
-- This guard tests `current_user` rather than `auth.uid()`, because
-- `delete_organization` is a SECURITY DEFINER function a session calls:
-- inside it `auth.uid()` is still the caller, but `current_user` is the
-- function's owner. A session's own UPDATE runs as `authenticated`. For that
-- reason the trigger function is deliberately not SECURITY DEFINER: inside
-- one, `current_user` would always be the owner.
create or replace function public.guard_organization_reserved()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if new.id is distinct from old.id
     or new.plan_id is distinct from old.plan_id
     or new.trial_ends_at is distinct from old.trial_ends_at
     or new.deleted_at is distinct from old.deleted_at
     or new.created_at is distinct from old.created_at then
    raise exception 'A workspace''s plan, trial and deletion are not edited directly'
      using errcode = '42501',
            hint = 'Delete a workspace with delete_organization(); plans are set by the operator.';
  end if;

  return new;
end;
$$;

drop trigger if exists organizations_guard_reserved on public.organizations;
create trigger organizations_guard_reserved
  before update on public.organizations
  for each row execute function public.guard_organization_reserved();

-- ── Lead 2: any member, viewers included, could exhaust the org's quota ────
--
-- `increment_usage` checked only that a membership existed, then added any
-- caller-chosen amount to any metric. One call from a viewer could lock the
-- whole workspace out of AI, email, enrichment and opportunities until the
-- month ended, and no tenant role can reset the counter.
--
-- The only session caller is `countAiRun` (apps/web/lib/ai/budget.ts): one
-- `ai_runs` per delivered run, from a member or above (viewers cannot run
-- models; see `canSpend` in recorder.ts). Every other metric is metered by the
-- engine through `increment_usage_internal`, which only the service role can
-- execute.
create or replace function public.increment_usage(
  p_org    uuid,
  p_metric text,
  p_amount bigint default 1
)
returns table (used bigint, quota bigint, allowed boolean)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if auth.uid() is null then
    raise exception 'increment_usage requires an authenticated caller';
  end if;

  if not public.has_org_role(p_org, 'member') then
    raise exception 'not a member of the requested organisation, or read-only there'
      using errcode = '42501';
  end if;

  if p_metric is distinct from 'ai_runs' then
    raise exception 'increment_usage: % is metered by the engine, not by a session', p_metric
      using errcode = '42501';
  end if;

  if p_amount is distinct from 1 then
    raise exception 'increment_usage: a session meters one run at a time'
      using errcode = '22023';
  end if;

  return query select * from public.increment_usage_internal(p_org, 'ai_runs', 1);
end
$$;

-- ── Lead 3: references could point into another workspace ──────────────────
--
-- Tenant tables reference each other by `id` alone, and `tenant_write`
-- checks only the new row's own `org_id`. A member could insert an org-A
-- opportunity whose `company_id` is an org-B company, or an org-A enrollment
-- on an org-B opportunity. The engine reads through `OrgScope`, which filters
-- the root table only. Under the service role an embed such as
-- `companies!inner(...)` then returned org B's row: its domain was sent to a
-- provider, and its outreach angle went into an org-A draft.
--
-- One trigger function, given (column, referenced table) pairs, refuses a
-- session write whose reference lands in a different org. SECURITY DEFINER
-- because the referenced row is, by construction, one the session cannot see:
-- under RLS the lookup would find nothing and pass. Only columns that actually
-- changed are looked up, so ordinary updates cost nothing.
--
-- `scripts/verify-security-leads.ts` fails if a foreign key between two
-- tenant tables on a session-writable table is missing from these triggers,
-- so a future migration cannot add a reference and forget this.
create or replace function public.enforce_same_org_refs()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_row  jsonb := to_jsonb(new);
  v_old  jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else null end;
  v_org  uuid  := (to_jsonb(new) ->> 'org_id')::uuid;
  v_col  text;
  v_ref  text;
  v_dst  uuid;
  i      integer := 0;
begin
  if auth.uid() is null then
    return new;
  end if;

  while i < tg_nargs loop
    v_col := tg_argv[i];
    v_ref := v_row ->> v_col;
    if v_ref is not null
       and (v_old is null
            or v_old ->> v_col is distinct from v_ref
            or v_old ->> 'org_id' is distinct from v_row ->> 'org_id') then
      execute format('select org_id from public.%I where id = $1', tg_argv[i + 1])
        into v_dst
        using v_ref::uuid;
      -- A missing row is the foreign key's to refuse, with its own message.
      if v_dst is not null and v_dst is distinct from v_org then
        raise exception '%.% refers to a record in another workspace', tg_table_name, v_col
          using errcode = '42501';
      end if;
    end if;
    i := i + 2;
  end loop;

  return new;
end;
$$;

do $$
declare
  v_refs constant text[][] := array[
    ['activities', 'company_id', 'companies'],
    ['activities', 'opportunity_id', 'opportunities'],
    ['activities', 'person_id', 'people'],
    ['ai_decisions', 'run_id', 'ai_runs'],
    ['campaigns', 'icp_id', 'icps'],
    ['campaigns', 'product_id', 'products'],
    ['companies', 'discovery_run_id', 'discovery_runs'],
    ['companies', 'merged_into_id', 'companies'],
    ['companies', 'parent_company_id', 'companies'],
    ['company_competitor_signals', 'company_id', 'companies'],
    ['company_competitor_signals', 'competitor_id', 'competitors'],
    ['company_competitor_signals', 'evidence_id', 'evidence'],
    ['company_domains', 'company_id', 'companies'],
    ['company_domains', 'evidence_id', 'evidence'],
    ['company_gaps', 'company_id', 'companies'],
    ['company_gaps', 'evidence_id', 'evidence'],
    ['company_merges', 'loser_id', 'companies'],
    ['company_merges', 'winner_id', 'companies'],
    ['company_problems', 'company_id', 'companies'],
    ['company_problems', 'evidence_id', 'evidence'],
    ['company_triggers', 'company_id', 'companies'],
    ['company_triggers', 'evidence_id', 'evidence'],
    ['competitor_evidence', 'competitor_id', 'competitors'],
    ['competitor_evidence', 'evidence_id', 'evidence'],
    ['competitor_profiles', 'ai_run_id', 'ai_runs'],
    ['competitor_profiles', 'competitor_id', 'competitors'],
    ['competitors', 'company_id', 'companies'],
    ['contact_fit_scores', 'icp_id', 'icps'],
    ['contact_fit_scores', 'icp_version_id', 'icp_versions'],
    ['contact_fit_scores', 'person_id', 'people'],
    ['contact_fit_scores', 'persona_id', 'personas'],
    ['contact_points', 'person_id', 'people'],
    ['conversation_messages', 'conversation_id', 'conversations'],
    ['conversations', 'opportunity_id', 'opportunities'],
    ['conversations', 'product_id', 'products'],
    ['demand_signals', 'company_id', 'companies'],
    ['demand_signals', 'opportunity_id', 'opportunities'],
    ['demand_signals', 'theme_id', 'demand_themes'],
    ['demand_themes', 'merged_into', 'demand_themes'],
    ['discovery_queries', 'icp_id', 'icps'],
    ['discovery_queries', 'icp_version_id', 'icp_versions'],
    ['discovery_results', 'company_id', 'companies'],
    ['discovery_results', 'query_id', 'discovery_queries'],
    ['discovery_results', 'run_id', 'discovery_runs'],
    ['discovery_runs', 'query_id', 'discovery_queries'],
    ['discovery_runs', 'source_id', 'sources'],
    ['enrollments', 'campaign_id', 'campaigns'],
    ['enrollments', 'mailbox_id', 'mailboxes'],
    ['enrollments', 'opportunity_id', 'opportunities'],
    ['evidence', 'source_id', 'sources'],
    ['evidence', 'superseded_by', 'evidence'],
    ['human_overrides', 'consumed_by', 'learning_runs'],
    ['human_overrides', 'score_id', 'opportunity_scores'],
    ['icps', 'current_version_id', 'icp_versions'],
    ['icps', 'product_id', 'products'],
    ['learning_findings', 'run_id', 'learning_runs'],
    ['learning_runs', 'ai_run_id', 'ai_runs'],
    ['memories', 'promoted_from', 'memories'],
    ['merge_candidates', 'company_a_id', 'companies'],
    ['merge_candidates', 'company_b_id', 'companies'],
    ['messages', 'contact_fit_id', 'contact_fit_scores'],
    ['messages', 'enrollment_id', 'enrollments'],
    ['messages', 'mailbox_id', 'mailboxes'],
    ['messages', 'opportunity_id', 'opportunities'],
    ['messages', 'step_id', 'sequence_steps'],
    ['messages', 'thread_id', 'threads'],
    ['opportunities', 'company_id', 'companies'],
    ['opportunities', 'icp_id', 'icps'],
    ['opportunities', 'primary_person_id', 'people'],
    ['opportunity_scores', 'icp_version_id', 'icp_versions'],
    ['opportunity_scores', 'opportunity_id', 'opportunities'],
    ['outcomes', 'campaign_id', 'campaigns'],
    ['outcomes', 'competitor_id', 'competitors'],
    ['outcomes', 'opportunity_id', 'opportunities'],
    ['outcomes', 'person_id', 'people'],
    ['outcomes', 'score_id', 'opportunity_scores'],
    ['people', 'company_id', 'companies'],
    ['people', 'persona_id', 'personas'],
    ['personas', 'icp_id', 'icps'],
    ['score_recompute_requests', 'icp_id', 'icps'],
    ['scoring_rules', 'icp_id', 'icps'],
    ['sequence_steps', 'sequence_id', 'sequences'],
    ['sequences', 'campaign_id', 'campaigns'],
    ['source_documents', 'source_id', 'sources'],
    ['source_events', 'company_id', 'companies'],
    ['source_events', 'source_document_id', 'source_documents'],
    ['sources', 'icp_id', 'icps'],
    ['threads', 'mailbox_id', 'mailboxes'],
    ['threads', 'opportunity_id', 'opportunities'],
    ['user_questions', 'memory_id', 'memories']
  ];
  v_table text;
  v_args  text;
begin
  for v_table in select distinct v_refs[n][1] from generate_subscripts(v_refs, 1) n loop
    select string_agg(quote_literal(v_refs[n][2]) || ', ' || quote_literal(v_refs[n][3]), ', ' order by n)
      into v_args
      from generate_subscripts(v_refs, 1) n
     where v_refs[n][1] = v_table;

    execute format('drop trigger if exists %I on public.%I', v_table || '_same_org', v_table);
    execute format(
      'create trigger %I before insert or update on public.%I '
      'for each row execute function public.enforce_same_org_refs(%s)',
      v_table || '_same_org', v_table, v_args
    );
  end loop;
end
$$;

-- ── Lead 4: approving a join request restored a removed owner as owner ─────
--
-- Removing a member only soft-deletes their row, so its role stays. The join
-- approval's upsert un-deleted that row as it was, and an admin who is not an
-- owner could bring back an owner. Re-admission now resets the role exactly
-- as `accept_invitation` does (0031): a live membership keeps the stronger
-- of its role and the approved one, and a removed one comes back as 'member'.
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
    set deleted_at = null,
        role       = case when public.memberships.deleted_at is null
                          then least(public.memberships.role, excluded.role)
                          else excluded.role end;

  update public.join_requests
     set status = 'approved', decided_by = auth.uid(), decided_at = now()
   where id = p_request;

  return v_req.org_id;
end;
$$;

-- …and the owner guard now judges ownership by whether the row is a live
-- owner before and after, not by the role column alone. Un-deleting an owner
-- row is granting owner, so it needs an owner. Resetting a removed owner's row
-- to 'member' grants nothing, so the approval above passes it.
--
-- Lead 12 (below) is in here too: an owner invitation admits its invitee only
-- when the invitee's email address is confirmed.
create or replace function public.guard_membership_owner()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_org     uuid := coalesce(new.org_id, old.org_id);
  v_guarded boolean := false;
  v_email   text;
begin
  -- The service role and pg_cron have no auth.uid(); they are trusted.
  if auth.uid() is null then
    return coalesce(new, old);
  end if;

  if tg_op = 'INSERT' then
    v_guarded := new.role = 'owner';
  elsif tg_op = 'UPDATE' then
    v_guarded :=
      (old.role = 'owner' and old.deleted_at is null)
      is distinct from (new.role = 'owner' and new.deleted_at is null);
  else
    v_guarded := old.role = 'owner';
  end if;

  if not v_guarded or public.has_org_role(v_org, 'owner') then
    return coalesce(new, old);
  end if;

  if tg_op in ('INSERT', 'UPDATE') and new.user_id = auth.uid() and new.role = 'owner' then
    -- A new workspace's first owner, written by create_organization.
    if not exists (
      select 1 from public.memberships m
      where m.org_id = v_org and m.role = 'owner' and m.deleted_at is null
    ) then
      return new;
    end if;

    -- An owner invitation, issued by an owner, being accepted by its invitee.
    select lower(to_jsonb(u) ->> 'email') into v_email
      from auth.users u
     where u.id = auth.uid()
       and (to_jsonb(u) ->> 'email_confirmed_at') is not null;
    if exists (
      select 1 from public.invitations i
      where i.org_id = v_org and i.role = 'owner'
        and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
        and lower(i.email) = v_email
    ) then
      return new;
    end if;
  end if;

  raise exception 'Only an owner can grant, change or remove the owner role'
    using errcode = '42501';
end;
$$;

-- ── Lead 5: an admin could raise the provider ceiling above the plan ───────
--
-- `provider_accounts` is admin-writable (0011), and `provider_budget_state`
-- (0033) preferred an account's `monthly_credit_limit` over the plan's
-- `enrich` allowance, with no upper bound. An admin could set it to a billion
-- and spend the platform's shared provider key. The account limit can now
-- only lower the plan's ceiling. An operator who wants to raise one org's
-- ceiling sets `usage_counters."limit"` for `enrich`, which `usage_limit`
-- already reads first and no session can write.
create or replace function public.provider_budget_state(
  p_org      uuid,
  p_provider text
)
returns table (used bigint, "limit" bigint, remaining bigint, allowed boolean)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  with counter as (
    select u.used
    from public.usage_counters u
    where u.org_id = p_org
      and u.period = to_char(now(), 'YYYY-MM')
      and u.metric = 'provider_credits:' || p_provider
  ),
  account_cap as (
    select min(a.monthly_credit_limit) as lim
    from public.provider_accounts a
    where a.org_id = p_org
      and a.provider = p_provider
      and a.deleted_at is null
      and a.monthly_credit_limit is not null
  ),
  plan_cap as (
    select coalesce(public.usage_limit(p_org, 'enrich'), 25) as lim
  ),
  cap as (
    select least(coalesce((select lim from account_cap), (select lim from plan_cap)),
                 (select lim from plan_cap)) as lim
  )
  select
    coalesce((select used from counter), 0)::bigint,
    (select lim from cap)::bigint,
    greatest((select lim from cap) - coalesce((select used from counter), 0), 0)::bigint,
    coalesce((select used from counter), 0) < (select lim from cap);
$$;

-- ── Lead 6: every member could read the unsubscribe tokens ─────────────────
--
-- The token is the only thing `record_unsubscribe` checks, and it can be
-- called with no session. It lived on `messages`, which every member reads,
-- viewers included. So a viewer could suppress contacts and stop sequences,
-- which their role forbids. A removed member could keep doing it with tokens
-- they had already read.
--
-- The tokens move to a table no session can read (RLS, and a policy that
-- refuses everyone), like `public_research` (0025). Only the service role,
-- which sends the mail, reads them. Existing tokens are copied, so links
-- already in people's inboxes keep working.
create table if not exists public.message_unsubscribe_tokens (
  message_id uuid primary key references public.messages(id) on delete cascade,
  org_id     uuid not null references public.organizations(id) on delete cascade,
  token      uuid not null unique default gen_random_uuid(),
  created_at timestamptz not null default now()
);

comment on table public.message_unsubscribe_tokens is
  'The unsubscribe token for each outbound message. No session may read it: only '
  'the service role reads it (send_message, to build the link), and only '
  'record_unsubscribe() resolves it.';

alter table public.message_unsubscribe_tokens enable row level security;

-- Stated rather than left implicit: no session reads or writes a token, of
-- any role. (RLS with no policy means the same, but every other table with an
-- `org_id` has a policy, and the harness asserts that.)
drop policy if exists no_session_access on public.message_unsubscribe_tokens;
create policy no_session_access on public.message_unsubscribe_tokens
  for all using (false) with check (false);

-- Conditional, so a replay after the column is gone (below) is a no-op.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'messages' and column_name = 'unsubscribe_token'
  ) then
    insert into public.message_unsubscribe_tokens (message_id, org_id, token)
    select m.id, m.org_id, m.unsubscribe_token
      from public.messages m
     where m.direction = 'outbound'
    on conflict (message_id) do nothing;
  end if;
end
$$;

create or replace function public.issue_unsubscribe_token()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  insert into public.message_unsubscribe_tokens (message_id, org_id)
  values (new.id, new.org_id)
  on conflict (message_id) do nothing;
  return new;
end;
$$;

drop trigger if exists messages_issue_unsubscribe_token on public.messages;
create trigger messages_issue_unsubscribe_token
  after insert on public.messages
  for each row when (new.direction = 'outbound')
  execute function public.issue_unsubscribe_token();

alter table public.messages drop column if exists unsubscribe_token;

-- Same signature and behaviour, reading the new table. One difference: the
-- 'unsubscribed' event is written once per message, not once per click, so
-- mail clients and link scanners that open the link repeatedly do not pile up
-- events.
create or replace function public.record_unsubscribe(p_token uuid, p_reason text default null)
returns table (suppressed_org_id uuid, suppressed_email text)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_msg public.messages%rowtype;
begin
  select m.* into v_msg
    from public.message_unsubscribe_tokens t
    join public.messages m on m.id = t.message_id
   where t.token = p_token;
  if not found or v_msg.to_email is null then
    raise exception 'that unsubscribe link is not valid';
  end if;

  insert into public.suppressions (org_id, kind, value, reason, source)
  values (v_msg.org_id, 'email', lower(v_msg.to_email),
          coalesce(p_reason, 'Unsubscribed from an email'), 'unsubscribe')
  on conflict (org_id, kind, value) do nothing;

  if not exists (
    select 1 from public.message_events e
     where e.message_id = v_msg.id and e.kind = 'unsubscribed'
  ) then
    insert into public.message_events (org_id, message_id, kind, payload)
    values (v_msg.org_id, v_msg.id, 'unsubscribed',
            jsonb_build_object('reason', p_reason));
  end if;

  -- Every sequence this address is in, not just this one (see 0008).
  update public.enrollments e
     set status = 'stopped',
         parked_reason = 'Recipient unsubscribed',
         next_action_at = null
   where e.org_id = v_msg.org_id
     and e.status = 'active'
     and e.opportunity_id in (
       select o.id
         from public.opportunities o
         join public.people p
           on p.company_id = o.company_id and p.org_id = o.org_id
         join public.contact_points cp
           on cp.person_id = p.id and cp.org_id = o.org_id
        where cp.kind = 'email' and lower(cp.value) = lower(v_msg.to_email)
     );

  return query select v_msg.org_id, lower(v_msg.to_email);
end
$$;

comment on function public.record_unsubscribe is
  'SECURITY DEFINER because the person clicking is not signed in and must '
  'not need to be. Takes only an unguessable token that no tenant session '
  'can read (0047), suppresses that address, records why once, and stops '
  'its active sequences.';

-- ── Lead 7: a member could re-attribute an activity to a colleague ─────────
--
-- `activities_update_manual` bound the author in USING only. Its WITH CHECK
-- left `actor_id` free, so a member could set their own note, call or meeting
-- to a colleague's name. The policy now binds the new row as the insert
-- policy does. A trigger also fixes who wrote a row, where, and how: no
-- session, admins included, may change `actor_id`, `actor_type`, `origin` or
-- `org_id` after the fact.
alter policy activities_update_manual on public.activities
  using (
    origin = 'manual'
    and public.has_org_role(org_id, 'member')
    and (actor_id = auth.uid() or public.has_org_role(org_id, 'admin'))
  )
  with check (
    origin = 'manual'
    and public.has_org_role(org_id, 'member')
    and (actor_id = auth.uid() or public.has_org_role(org_id, 'admin'))
  );

create or replace function public.guard_activity_authorship()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if new.actor_id is distinct from old.actor_id
     or new.actor_type is distinct from old.actor_type
     or new.origin is distinct from old.origin
     or new.org_id is distinct from old.org_id then
    raise exception 'An activity''s author, origin and workspace cannot be changed'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists activities_guard_authorship on public.activities;
create trigger activities_guard_authorship
  before update on public.activities
  for each row execute function public.guard_activity_authorship();

-- ── Lead 11: /discover's allowance counted only finished readings ──────────
--
-- `anonymousAllowance` counted `public_research` rows, which are written
-- after a model call succeeds. Concurrent requests all read the same count
-- and all went ahead. Failed runs, which still cost tokens, never counted,
-- and neither did refreshes of an expired row. A paid attempt is now reserved
-- here before the model is called. The reservation is serialised by an
-- advisory lock, so two visitors cannot both read "four of five".
create table if not exists public.public_research_attempts (
  id         bigint generated always as identity primary key,
  ip_hash    text not null,
  created_at timestamptz not null default now()
);

comment on table public.public_research_attempts is
  'One row per paid anonymous research attempt, reserved before the model '
  'call by reserve_public_research(). RLS on, no policy, as public_research.';

create index if not exists public_research_attempts_ip_idx
  on public.public_research_attempts (ip_hash, created_at);
create index if not exists public_research_attempts_time_idx
  on public.public_research_attempts (created_at);

alter table public.public_research_attempts enable row level security;

create or replace function public.reserve_public_research(
  p_ip_hash     text,
  p_per_ip_hour integer,
  p_daily       integer
)
returns table (allowed boolean, reason text)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_ip  integer;
  v_day integer;
begin
  perform pg_advisory_xact_lock(hashtext('public.reserve_public_research'));

  select count(*) into v_ip
    from public.public_research_attempts a
   where a.ip_hash = p_ip_hash and a.created_at > now() - interval '1 hour';
  if v_ip >= p_per_ip_hour then
    return query select false, 'rate_limited'::text;
    return;
  end if;

  select count(*) into v_day
    from public.public_research_attempts a
   where a.created_at > now() - interval '24 hours';
  if v_day >= p_daily then
    return query select false, 'over_budget'::text;
    return;
  end if;

  insert into public.public_research_attempts (ip_hash) values (p_ip_hash);
  return query select true, null::text;
end;
$$;

-- The sweep 0025 defined was never scheduled. It now also clears attempts,
-- which are only ever counted over the last day.
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
  delete from public.public_research_attempts where created_at < now() - interval '2 days';
  return v_deleted;
end;
$$;

revoke execute on function public.reserve_public_research(text, integer, integer) from public;
revoke execute on function public.purge_expired_research() from public;

do $$
begin
  revoke execute on function public.reserve_public_research(text, integer, integer) from anon, authenticated;
  grant execute on function public.reserve_public_research(text, integer, integer) to service_role;
  revoke execute on function public.purge_expired_research() from anon, authenticated;
  grant execute on function public.purge_expired_research() to service_role;
exception when undefined_object then null;
end $$;

-- Scheduled the way 0006 and 0011 schedule theirs, including the guard.
do $$
declare
  v_scheduled boolean;
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice
      'pg_cron is unavailable here, so purge_expired_research() is not scheduled. '
      'Expected under PGlite.';
    return;
  end if;

  execute 'create extension if not exists pg_cron';

  execute 'select exists (select 1 from cron.job where jobname = $1)'
    into v_scheduled
    using 'purge-expired-research';

  if v_scheduled then
    execute 'select cron.unschedule($1)' using 'purge-expired-research';
  end if;

  -- 05:17 UTC, an hour after the provider-cache sweep.
  execute 'select cron.schedule($1, $2, $3)'
    using 'purge-expired-research',
          '17 5 * * *',
          'select public.purge_expired_research()';
end
$$;

-- ── Lead 12: invitations accepted by an unconfirmed address ────────────────
--
-- Redeeming an invitation was bound only to `auth.users.email`. If the
-- project ever issues a session for an address nobody has confirmed (password
-- sign-up with "Confirm email" off, an anonymous user linked to an email, a
-- provider that does not verify), whoever holds a leaked token could register
-- the invited address first and join. The app's own sign-in (magic link,
-- Google) confirms the address, so this changes nothing for real invitees.
-- It moves the proof of ownership from project settings into the function.
create or replace function public.accept_invitation(p_token uuid)
returns table (joined_org_id uuid, joined_org_slug text, joined_role org_role)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_user      uuid := auth.uid();
  v_email     text;
  v_confirmed boolean;
  v_inv       public.invitations%rowtype;
  v_role      org_role;
begin
  if v_user is null then
    raise exception 'accept_invitation requires an authenticated caller';
  end if;

  select (to_jsonb(u) ->> 'email'), (to_jsonb(u) ->> 'email_confirmed_at') is not null
    into v_email, v_confirmed
    from auth.users u where u.id = v_user;

  select * into v_inv from public.invitations
  where token = p_token
    and accepted_at is null
    and revoked_at is null
    and expires_at > now();

  if not found then
    raise exception 'that invitation is no longer valid';
  end if;

  if v_email is null or lower(v_email) <> lower(v_inv.email) then
    raise exception 'that invitation was issued to a different email address';
  end if;

  if not coalesce(v_confirmed, false) then
    raise exception 'confirm your email address before accepting this invitation';
  end if;

  insert into public.memberships (org_id, user_id, role, invited_by)
  values (v_inv.org_id, v_user, v_inv.role, v_inv.invited_by)
  on conflict (org_id, user_id) do update
    set deleted_at = null,
        role       = case when public.memberships.deleted_at is null
                          then least(public.memberships.role, excluded.role)
                          else excluded.role end
  returning role into v_role;

  update public.invitations
    set accepted_at = now(), accepted_by = v_user
  where id = v_inv.id;

  return query
    select o.id, o.slug, v_role
    from public.organizations o where o.id = v_inv.org_id;
end
$$;

-- A probe for `db:doctor` (see 0031).
create or replace function public.migration_0047_applied()
returns boolean
language sql
immutable
set search_path = public, pg_catalog
as $$ select true $$;
