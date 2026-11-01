-- ============================================================================
-- 0049 — Soft deletes reach outreach; merges keep evidence; send-safety
--        columns belong to the engine
--
-- Pass 15 of the audit (audit/pass-15/03_FINDINGS.md).
--
-- **SEC-101.** Removing a company set `companies.deleted_at` and nothing
-- else. Its opportunities, their active enrollments and their approved,
-- unsent messages carried on: `advance_enrollments` reads enrollments by
-- status and `send_message` reads messages, and neither asked whether the
-- opportunity or company still existed. A merge soft-deleted the loser's
-- colliding opportunity the same way. So a company the user removed was
-- still emailed. A rule in each reader is a rule the next reader forgets, so
-- the propagation lives here, on the rows themselves:
--
--   company soft-deleted  → its live opportunities are soft-deleted
--   opportunity soft-deleted → its active enrollments stop, and its
--                              approved-but-unsent messages are unscheduled
--
-- **FLOW-102.** `merge_companies` (0012) moved domains, people, problems,
-- gaps, triggers, source events and opportunities to the survivor, and left
-- every `evidence` row on the soft-deleted loser — the survivor lost its
-- enrichment, research and signal evidence. Evidence now follows the merge.
-- A loser row that would collide with one the survivor already has (same
-- field and source, both live) is retired rather than moved; the survivor's
-- copy is the same claim from the same source.
--
-- **SEC-103.** Members could `update mailboxes` directly and reset the warm-up
-- ramp, the domain verdict and the send counters that 0048 says are enforced.
-- Those columns are now the engine's. **SEC-102:** the OAuth token ciphertext
-- is no longer readable by a signed-in session at all.
-- ============================================================================

-- ── SEC-101: opportunity soft delete stops its outreach ────────────────────
create or replace function public.stop_outreach_for_deleted_opportunity()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if new.deleted_at is not null and old.deleted_at is null then
    update public.enrollments
       set status = 'stopped',
           parked_reason = 'The opportunity was removed.',
           next_action_at = null,
           updated_at = now()
     where opportunity_id = new.id
       and status = 'active';

    update public.messages m
       set scheduled_at = null,
           error = 'Not sent: the opportunity was removed.'
     where m.direction = 'outbound'
       and m.sent_at is null
       and m.send_attempted_at is null
       and m.deleted_at is null
       and (m.opportunity_id = new.id
            or m.enrollment_id in (select e.id from public.enrollments e where e.opportunity_id = new.id));
  end if;
  return new;
end
$$;

drop trigger if exists opportunities_stop_outreach on public.opportunities;
create trigger opportunities_stop_outreach
  after update of deleted_at on public.opportunities
  for each row execute function public.stop_outreach_for_deleted_opportunity();

-- ── SEC-101 / FLOW-102: company soft delete and merge ──────────────────────
create or replace function public.propagate_company_removal()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if new.deleted_at is not null and old.deleted_at is null then
    -- A merge has already moved the loser's opportunities to the survivor;
    -- whatever is still here is removed with the company.
    update public.opportunities
       set deleted_at = new.deleted_at, updated_at = now()
     where company_id = new.id
       and deleted_at is null;
  end if;

  if new.merged_into_id is not null and old.merged_into_id is distinct from new.merged_into_id then
    -- Retire loser evidence the survivor already holds from the same source.
    update public.evidence l
       set deleted_at = now()
     where l.org_id = new.org_id
       and l.subject_type = 'company'
       and l.subject_id = new.id
       and l.deleted_at is null
       and l.field is not null
       and exists (
         select 1 from public.evidence w
          where w.org_id = l.org_id
            and w.subject_type = 'company'
            and w.subject_id = new.merged_into_id
            and w.deleted_at is null
            and w.field = l.field
            and coalesce(w.source_id::text, '') = coalesce(l.source_id::text, '')
            and coalesce(w.source_url, '') = coalesce(l.source_url, '')
       );

    update public.evidence
       set subject_id = new.merged_into_id
     where org_id = new.org_id
       and subject_type = 'company'
       and subject_id = new.id
       and deleted_at is null;
  end if;
  return new;
end
$$;

drop trigger if exists companies_propagate_removal on public.companies;
create trigger companies_propagate_removal
  after update of deleted_at, merged_into_id on public.companies
  for each row execute function public.propagate_company_removal();

-- ── SEC-103: send-safety columns are the engine's ──────────────────────────
-- Same test as `guard_organization_reserved` (0047): a session's own UPDATE
-- runs as `authenticated`; the engine runs as the service role.
create or replace function public.guard_mailbox_safety()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if new.warmup_started_at is distinct from old.warmup_started_at
     or new.warmup_target is distinct from old.warmup_target
     or new.domain_status is distinct from old.domain_status
     or new.domain_report is distinct from old.domain_report
     or new.domain_checked_at is distinct from old.domain_checked_at
     or new.sent_today is distinct from old.sent_today
     or new.sent_today_on is distinct from old.sent_today_on then
    raise exception 'Warm-up, domain readiness and send counters are set by the engine, not by a session.'
      using errcode = '42501';
  end if;
  return new;
end
$$;

drop trigger if exists mailboxes_guard_safety on public.mailboxes;
create trigger mailboxes_guard_safety
  before update on public.mailboxes
  for each row execute function public.guard_mailbox_safety();

-- ── SEC-102 / DB-105: least privilege ──────────────────────────────────────
-- The named roles exist on Supabase and not in a bare Postgres (the PGlite
-- harness), so this half tolerates their absence, as in 0046 and 0048.
--
-- A column revoke does not override a table-level grant, so the table grant
-- is replaced by a grant on every other column. A column added to
-- `mailboxes` later is therefore unreadable by sessions until it is granted
-- here too — deliberately, for a table that holds credentials.
do $$
declare v_cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into v_cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'mailboxes'
     and column_name not in ('oauth_token_enc', 'refresh_token_enc');
  revoke select on public.mailboxes from authenticated, anon;
  execute format('grant select (%s) on public.mailboxes to authenticated', v_cols);
  revoke execute on function public.claim_mailbox_send(uuid) from public, anon;
  revoke execute on function public.mailbox_remaining_today(uuid) from public, anon;
  grant execute on function public.claim_mailbox_send(uuid), public.mailbox_remaining_today(uuid)
    to authenticated, service_role;
exception when undefined_object then null;
end $$;

-- ── JOB-011 / DB-104: the queue's history, and the send sweep's index ──────
-- Every tick writes about nine sweeper rows, forever; nothing deleted them.
-- Finished jobs older than the window are history nobody reads — `ai_runs`
-- and `provider_calls` are where spend lives. Called daily by
-- `enforce_retention`.
create or replace function public.prune_job_executions(p_older_than interval default interval '30 days')
returns integer
language sql
set search_path = public, pg_catalog
as $$
  with gone as (
    delete from public.job_executions
     where status in ('succeeded', 'failed', 'cancelled')
       and coalesce(finished_at, updated_at) < now() - p_older_than
    returning 1
  )
  select count(*)::integer from gone
$$;

revoke execute on function public.prune_job_executions(interval) from public;
do $$
begin
  revoke execute on function public.prune_job_executions(interval) from anon, authenticated;
  grant execute on function public.prune_job_executions(interval) to service_role;
exception when undefined_object then null;
end $$;

-- `sweep()` asks whether this period's run of a sweeper exists in any status;
-- the idempotency index covers only queued and running rows.
create index if not exists job_executions_name_key_idx
  on public.job_executions (job_name, idempotency_key)
  where idempotency_key is not null;

-- `schedule_sends` reads approved, unsent, error-free messages; held and
-- deferred rows no longer sit inside its range.
create index if not exists messages_sendable_idx
  on public.messages (scheduled_at)
  where direction = 'outbound' and sent_at is null and error is null and deleted_at is null;

-- A probe for `db:doctor` (see 0031).
create or replace function public.migration_0049_applied()
returns boolean
language sql
immutable
set search_path = public, pg_catalog
as $$ select true $$;
