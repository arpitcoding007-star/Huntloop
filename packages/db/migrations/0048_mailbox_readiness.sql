-- ============================================================================
-- 0048 — Mailbox readiness: a warm-up ramp that is enforced, and a domain check
--
-- P1-3 and P1-4 of the outreach-safety plan
-- (docs/competitive/harvey/06-gaps-and-roadmap.md).
--
-- **Warm-up.** `0008` added `warmup_started_at` and `warmup_target`, and
-- nothing read them: a mailbox connected this morning could send its full
-- `daily_limit` today, which is how a new domain lands in the spam folder on
-- day one. The cap is now ramped in the database, in the one function every
-- send claims through, so no code path can skip it.
--
--   cap(day n) = least(daily_limit, warmup_target, 10 + 5·n)   n = whole days since warm-up began
--
-- New mailboxes start warming up when they are connected (the column default
-- below). Existing rows keep `warmup_started_at` NULL, which means "already
-- warm": they were sending before this migration and a ramp now would cut a
-- working mailbox to ten a day.
--
-- **Domain.** The result of `check_mailbox_domain` (MX, SPF, DMARC, DKIM),
-- stored on the mailbox so the send path and the outreach screen read one
-- answer. `fail` blocks cold sequence sends; replies are never blocked.
-- ============================================================================

alter table public.mailboxes
  alter column warmup_started_at set default now(),
  add column if not exists domain_status text
    check (domain_status in ('pass', 'warn', 'fail')),
  add column if not exists domain_report jsonb,
  add column if not exists domain_checked_at timestamptz;

comment on column public.mailboxes.domain_status is
  'Latest check_mailbox_domain verdict. fail blocks cold sends; NULL is not yet checked.';

-- **Deferral.** A send that is right but early — outside the recipient's
-- business hours, or before the inbox has been read — waits on `not_before`
-- instead of failing. A failure burns one of three attempts and, once spent,
-- strands the message; `schedule_sends` skips a message until its
-- `not_before` passes, so waiting costs nothing and starves nothing.
alter table public.messages
  add column if not exists not_before timestamptz;

comment on column public.messages.not_before is
  'send_message deferred this send until then (business hours, inbox freshness, bounce pause). NULL = no wait.';

-- Today's effective cap: the configured limit, lowered by the warm-up ramp.
create or replace function public.mailbox_daily_cap(p_mailbox uuid)
returns integer
language sql
stable
set search_path = public, pg_catalog
as $$
  select least(
    m.daily_limit,
    coalesce(m.warmup_target, m.daily_limit),
    case
      when m.warmup_started_at is null then m.daily_limit
      else 10 + 5 * greatest(floor(extract(epoch from (now() - m.warmup_started_at)) / 86400), 0)::integer
    end
  )
  from public.mailboxes m where m.id = p_mailbox
$$;

comment on function public.mailbox_daily_cap is
  'daily_limit, lowered during warm-up to 10 + 5 per whole day since warmup_started_at (and by warmup_target).';

create or replace function public.mailbox_remaining_today(p_mailbox uuid)
returns integer
language sql
stable
set search_path = public, pg_catalog
as $$
  select greatest(
    public.mailbox_daily_cap(m.id) - case
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
     and (case when sent_today_on = v_today then sent_today else 0 end)
         < public.mailbox_daily_cap(p_mailbox)
   returning true into v_ok;

  return coalesce(v_ok, false);
end
$$;

revoke execute on function public.mailbox_daily_cap(uuid) from public;

-- The named roles exist on Supabase and not in a bare Postgres (the PGlite
-- test harness), so this half tolerates their absence, as in 0046.
do $$
begin
  revoke execute on function public.mailbox_daily_cap(uuid) from anon;
  grant execute on function public.mailbox_daily_cap(uuid) to authenticated, service_role;
exception when undefined_object then null;
end $$;

-- A probe for `db:doctor` (see 0031).
create or replace function public.migration_0048_applied()
returns boolean
language sql
immutable
set search_path = public, pg_catalog
as $$ select true $$;
