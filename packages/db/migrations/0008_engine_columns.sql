-- ============================================================================
-- 0008 — The columns the engine needs to actually run
--
-- 0002–0004 modelled the *nouns* completely: a source, a document, a mailbox,
-- a thread, a job execution. What none of them carried was the state a
-- **running** system keeps between ticks — when a source is next due, where a
-- mailbox's sync left off, which provider thread an inbound message belongs
-- to, and which worker has a job in hand.
--
-- Nothing here changes a rule. Every column is nullable or defaulted, so the
-- migration is safe on a populated database and every existing row stays
-- valid.
-- ============================================================================

-- ── Sources: scheduling and failure ────────────────────────────────────────

alter table sources
  -- How often this source is worth re-reading. A job board changes daily; a
  -- regulatory register changes monthly, and scanning it hourly spends money
  -- to re-read the same page.
  add column scan_interval_minutes integer not null default 1440
    check (scan_interval_minutes >= 5),
  -- NULL means "due now, never scanned". The scheduler orders by this, so a
  -- newly added source is picked up on the next tick rather than waiting a
  -- full interval for its first read.
  add column next_scan_at timestamptz,
  -- Per-kind settings: an RSS feed's selector, a GitHub org, a search query.
  add column config jsonb not null default '{}'::jsonb,
  add column last_success_at timestamptz;

-- The scheduler's hot path — "what is due, across all orgs". Deliberately not
-- org-scoped: the job runner sweeps globally and fans out per org.
create index sources_due_idx on sources (next_scan_at)
  where is_enabled and deleted_at is null;

-- §58: a source that fails is marked, retried with backoff, and surfaced.
-- Three consecutive failures degrade it, ten make it unavailable — expressed
-- here rather than in application code so a second writer cannot disagree.
create or replace function public.record_source_failure(
  p_source uuid,
  p_error  text
)
returns void
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_count integer;
begin
  update public.sources
     set failure_count = failure_count + 1,
         last_error    = left(coalesce(p_error, 'unknown error'), 2000),
         last_scanned_at = now(),
         -- Exponential backoff, capped at a day. A source that is down stays
         -- polled, because "unavailable" must be recoverable without a human.
         next_scan_at  = now() + make_interval(
           mins => least(scan_interval_minutes, 60) * least(power(2, failure_count)::integer, 24)
         )
   where id = p_source
   returning failure_count into v_count;

  if v_count is null then
    return;
  end if;

  update public.sources
     set status = case
                    when v_count >= 10 then 'unavailable'::source_status
                    when v_count >= 3  then 'degraded'::source_status
                    else status
                  end
   where id = p_source;
end
$$;

create or replace function public.record_source_success(p_source uuid)
returns void
language sql
set search_path = public, pg_catalog
as $$
  update public.sources
     set failure_count   = 0,
         last_error      = null,
         status          = 'ok',
         last_scanned_at = now(),
         last_success_at = now(),
         next_scan_at    = now() + make_interval(mins => scan_interval_minutes)
   where id = p_source
$$;

-- ── Source documents: the dedup key, made two-level ────────────────────────
--
-- 0002 deduplicates on `content_hash`, which catches the same article reached
-- through two sources. It does not catch the same *URL* re-fetched after a
-- typo fix, which changes the hash and creates a second document for one
-- page. §60 wants one document per page, so the canonical URL is a key too.

alter table source_documents
  add column url_hash text;

update source_documents set url_hash = md5(coalesce(canonical_url, url))
  where url_hash is null;

create unique index source_documents_url_idx
  on source_documents (org_id, url_hash) where url_hash is not null;

-- ── Mailboxes: sending window and sync cursor ──────────────────────────────

alter table mailboxes
  -- `sent_today` alone cannot be read without knowing which day it counts.
  -- Without this column the counter is either never reset or reset by a job
  -- that must run at exactly midnight in a timezone nobody wrote down.
  add column sent_today_on date,
  add column token_expires_at timestamptz,
  add column last_sync_at timestamptz,
  -- Gmail's historyId / Graph's deltaLink. Opaque to us on purpose.
  add column sync_cursor text,
  add column last_error text,
  add column warmup_started_at timestamptz,
  add column warmup_target integer;

-- Today's remaining send allowance, with the daily reset folded in.
--
-- A function rather than a scheduled reset job: the counter is only ever read
-- immediately before a send, so "reset at midnight" and "treat a stale date as
-- zero" are indistinguishable to every caller — and the second one cannot be
-- missed by a job that failed to run.
create or replace function public.mailbox_remaining_today(p_mailbox uuid)
returns integer
language sql
stable
set search_path = public, pg_catalog
as $$
  select greatest(
    m.daily_limit - case
      when m.sent_today_on = (now() at time zone 'utc')::date then m.sent_today
      else 0
    end,
    0
  )
  from public.mailboxes m where m.id = p_mailbox
$$;

create or replace function public.claim_mailbox_send(p_mailbox uuid)
returns boolean
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_today date := (now() at time zone 'utc')::date;
  v_ok    boolean;
begin
  update public.mailboxes
     set sent_today    = case when sent_today_on = v_today then sent_today + 1 else 1 end,
         sent_today_on = v_today
   where id = p_mailbox
     and deleted_at is null
     and status = 'connected'
     and (sent_today_on is distinct from v_today or sent_today < daily_limit)
   returning true into v_ok;

  return coalesce(v_ok, false);
end
$$;

comment on function public.claim_mailbox_send is
  'Reserves one send against today''s limit, atomically. Returns false when '
  'the mailbox is full or disconnected — the caller must not send on false. '
  'Claiming before sending rather than counting after means a crash '
  'over-counts instead of over-sending.';

-- ── Threads and messages: matching an inbound reply to what we sent ────────

alter table threads
  add column provider_thread_id text,
  add column participants text[] not null default '{}';

create unique index threads_provider_idx
  on threads (org_id, mailbox_id, provider_thread_id)
  where provider_thread_id is not null;

alter table messages
  -- RFC 5322 Message-ID of this message, and of the one it answers. The
  -- provider thread id is the fast path; these two are the fallback, and the
  -- only thing that works when a reply arrives at a different mailbox.
  add column message_id_header text,
  add column in_reply_to text,
  add column from_email text,
  add column to_email text,
  add column error text,
  -- Presented in the List-Unsubscribe header and the footer link. A column
  -- rather than an HMAC of the row id, so that revoking one link is a delete
  -- and does not require rotating a signing secret shared by every link ever
  -- issued.
  add column unsubscribe_token uuid not null default gen_random_uuid();

create index messages_thread_idx on messages (org_id, thread_id, created_at);
create index messages_scheduled_idx on messages (scheduled_at)
  where direction = 'outbound' and sent_at is null and deleted_at is null;
create unique index messages_unsubscribe_idx on messages (unsubscribe_token);

-- ── Unsubscribe, from a link nobody is signed in to click ──────────────────

create or replace function public.record_unsubscribe(p_token uuid, p_reason text default null)
-- Prefixed for the reason given on accept_invitation in 0007: an OUT
-- parameter named org_id would shadow the column of the same name in the
-- INSERT statements below.
returns table (suppressed_org_id uuid, suppressed_email text)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_msg public.messages%rowtype;
begin
  select * into v_msg from public.messages where unsubscribe_token = p_token;
  if not found or v_msg.to_email is null then
    raise exception 'that unsubscribe link is not valid';
  end if;

  insert into public.suppressions (org_id, kind, value, reason, source)
  values (v_msg.org_id, 'email', lower(v_msg.to_email),
          coalesce(p_reason, 'Unsubscribed from an email'), 'unsubscribe')
  on conflict (org_id, kind, value) do nothing;

  insert into public.message_events (org_id, message_id, kind, payload)
  values (v_msg.org_id, v_msg.id, 'unsubscribed',
          jsonb_build_object('reason', p_reason));

  -- Stop every sequence this address is in, not just this one. A person who
  -- unsubscribes from one campaign has not consented to the other three, and
  -- `is_suppressed` is only consulted at send time — which would leave the
  -- enrollments sitting "active" with a next action that can never fire.
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
  'not need to be. Takes only an unguessable single-purpose token and can '
  'do exactly two things with it: suppress that address and record why.';

-- ── Suppression, asked as a question ───────────────────────────────────────

create or replace function public.is_suppressed(p_org uuid, p_email text)
returns boolean
language sql
stable
set search_path = public, pg_catalog
as $$
  select exists (
    select 1 from public.suppressions s
    where s.org_id = p_org
      and (
        (s.kind = 'email'  and s.value = lower(p_email)) or
        (s.kind = 'domain' and s.value = lower(split_part(p_email, '@', 2)))
      )
  )
$$;

comment on function public.is_suppressed is
  'Checked before EVERY send, as 0004 says on the suppressions table. Domain '
  'suppression matches the address''s domain, which is the whole reason the '
  'kind column exists — a per-address list cannot express "never this '
  'customer''s employer".';

-- ── Job executions: a queue you can actually claim from ────────────────────

alter table job_executions
  add column run_at timestamptz not null default now(),
  add column max_attempts integer not null default 3,
  add column locked_at timestamptz,
  add column locked_by text,
  add column result jsonb,
  -- Two enqueues of the same work collapse into one row. NULL opts out, which
  -- is right for jobs that are legitimately repeatable (a manual rescan).
  add column idempotency_key text;

create unique index job_executions_idempotency_idx
  on job_executions (job_name, idempotency_key)
  where idempotency_key is not null and status in ('queued', 'running');

create index job_executions_due_idx on job_executions (run_at)
  where status = 'queued';

-- Claim work, atomically, for one worker.
--
-- `for update skip locked` is the whole point and is not expressible through
-- PostgREST, which is why this is a function rather than two queries in the
-- runner. Without it two concurrent runners take the same row and every job
-- runs twice.
create or replace function public.claim_job_executions(
  p_limit  integer default 5,
  p_worker text default 'runner'
)
returns setof public.job_executions
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  return query
  update public.job_executions j
     set status    = 'running',
         attempts  = j.attempts + 1,
         locked_at = now(),
         locked_by = p_worker,
         started_at = coalesce(j.started_at, now())
   where j.id in (
     select id from public.job_executions
      where status = 'queued' and run_at <= now()
      order by run_at
      limit greatest(p_limit, 1)
      for update skip locked
   )
  returning j.*;
end
$$;

-- Reclaim work whose worker died mid-flight.
--
-- A row stuck in `running` is indistinguishable from one being worked on, so
-- the only usable signal is age. Ten minutes is longer than any handler here
-- should take and short enough that a crash is not an outage.
create or replace function public.requeue_stalled_jobs(p_older_than interval default interval '10 minutes')
returns integer
language sql
set search_path = public, pg_catalog
as $$
  with revived as (
    update public.job_executions
       set status = case when attempts >= max_attempts then 'failed' else 'queued' end,
           error  = case when attempts >= max_attempts
                         then 'Abandoned: the worker did not report back'
                         else error end,
           finished_at = case when attempts >= max_attempts then now() else finished_at end,
           locked_at = null,
           locked_by = null
     where status = 'running' and locked_at < now() - p_older_than
     returning 1
  )
  select count(*)::integer from revived
$$;

-- The queue is written by the job runner, which holds the service-role key
-- and bypasses RLS. `claim_*` and `requeue_*` must not be reachable by a
-- tenant session: they return other orgs' payloads and would let one tenant
-- starve another's queue.
--
-- Wrapped, because `anon` / `authenticated` / `service_role` are Supabase
-- roles and do not exist in the PGlite harness this file is also tested in.
do $$
begin
  revoke execute on function
    public.claim_job_executions(integer, text),
    public.requeue_stalled_jobs(interval)
  from public;
exception when undefined_object or undefined_function then null;
end $$;

do $$
begin
  revoke execute on function
    public.claim_job_executions(integer, text),
    public.requeue_stalled_jobs(interval)
  from anon, authenticated;
  grant execute on function
    public.claim_job_executions(integer, text),
    public.requeue_stalled_jobs(interval)
  to service_role;
exception when undefined_object or undefined_function then null;
end $$;

-- ── Enrollment scheduling ──────────────────────────────────────────────────

alter table enrollments
  add column last_step_at timestamptz,
  add column mailbox_id uuid references mailboxes(id) on delete set null;

-- ── Opportunity provenance ─────────────────────────────────────────────────
--
-- Which route put this row here: a scan, a CSV import, the analyze screen, or
-- a person. The learning loop in 0004 can compare outcomes by origin, and it
-- has nothing to compare on today.
alter table opportunities
  add column discovered_via text not null default 'manual',
  add column last_scored_at timestamptz;

alter table companies
  add column discovered_via text not null default 'manual';
