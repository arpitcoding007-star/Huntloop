-- ============================================================================
-- 0050 — Provider credits are reserved, not checked; one send per address
--        at a time
--
-- Pass 15 of the audit (audit/pass-15/03_FINDINGS.md), follow-ups.
--
-- **PROV-015.** `callProvider` asked `provider_budget_state` whether credit was
-- left, then called the vendor, then `record_provider_call` counted the spend.
-- A tick runs four jobs at once, so four calls could each read "1 left" and
-- all four spend it. `reserve_provider_credit` takes the one credit a call
-- needs to be allowed, under a lock, in the same statement that decides; the
-- ledger then counts the real spend and `settle_provider_credit` hands the
-- reservation back. Between the two the counter is one high, never low.
--
-- **OUT-013.** `can_contact` (0017) reads `contact_frequency`, which
-- `record_contact_send` rolls only after the provider accepted. Two lanes
-- sending two different messages to the same address both passed the gate
-- and both sent. `claim_contact_lane` lets one message per address be in
-- flight; the other waits. A lane lasts ten minutes, longer than any send
-- job's deadline, and by then `record_contact_send` has made `can_contact`
-- the judge again.
--
-- **FLOW-106.** A trigger queues `resolve_entity` and `profile_company` for
-- every company created or restored, whatever created it.
-- ============================================================================

-- ── PROV-015: reserve before the call ──────────────────────────────────────
create or replace function public.reserve_provider_credit(
  p_org      uuid,
  p_provider text
)
returns table (used bigint, "limit" bigint, remaining bigint, allowed boolean)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_state record;
begin
  -- One org and provider at a time. The counter row may not exist yet, so a
  -- row lock has nothing to hold; an advisory lock does.
  perform pg_advisory_xact_lock(hashtext('provider_credits:' || p_org::text || ':' || p_provider));

  select s.used, s."limit", s.remaining, s.allowed
    into v_state
    from public.provider_budget_state(p_org, p_provider) s;

  if coalesce(v_state.allowed, false) then
    insert into public.usage_counters (org_id, period, metric, used)
    values (p_org, to_char(now(), 'YYYY-MM'), 'provider_credits:' || p_provider, 1)
    on conflict (org_id, period, metric)
      do update set used = public.usage_counters.used + 1,
                    updated_at = now();
  end if;

  return query select v_state.used::bigint, v_state."limit"::bigint,
                      v_state.remaining::bigint, coalesce(v_state.allowed, false);
end;
$$;

-- Gives a reservation back once `record_provider_call` has counted the real
-- spend. Never below zero, so a month boundary between the two cannot leave
-- a negative counter.
create or replace function public.settle_provider_credit(
  p_org      uuid,
  p_provider text,
  p_reserved integer default 1
)
returns void
language sql
security definer
set search_path = public, pg_catalog
as $$
  update public.usage_counters
     set used = greatest(used - greatest(coalesce(p_reserved, 0), 0), 0),
         updated_at = now()
   where org_id = p_org
     and period = to_char(now(), 'YYYY-MM')
     and metric = 'provider_credits:' || p_provider;
$$;

-- ── OUT-013: one message per address in flight ─────────────────────────────
-- The address is stored as a digest: a lane is a lock, not a record of who
-- was emailed, and erasure should have nothing to find here.
create table if not exists public.contact_send_lanes (
  org_id     uuid not null references public.organizations(id) on delete cascade,
  address    text not null,
  message_id uuid not null,
  claimed_at timestamptz not null default now(),
  primary key (org_id, address)
);

alter table public.contact_send_lanes enable row level security;

-- Stated, as for `message_unsubscribe_tokens` (0047): no session, of any role.
drop policy if exists no_session_access on public.contact_send_lanes;
create policy no_session_access on public.contact_send_lanes
  for all using (false) with check (false);

comment on table public.contact_send_lanes is
  'One in-flight send per recipient address (md5 of the lower-cased address). '
  'Engine only: RLS on, and a policy that refuses every session.';

create or replace function public.claim_contact_lane(
  p_org     uuid,
  p_email   text,
  p_message uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_address text := md5(lower(trim(p_email)));
  v_holder  uuid;
begin
  -- Stale lanes go first, so the table never holds more than the sends of
  -- the last ten minutes.
  delete from public.contact_send_lanes
   where org_id = p_org
     and claimed_at < now() - interval '10 minutes';

  insert into public.contact_send_lanes (org_id, address, message_id)
  values (p_org, v_address, p_message)
  on conflict (org_id, address) do update
    set message_id = excluded.message_id,
        claimed_at = now()
    where public.contact_send_lanes.message_id = excluded.message_id
  returning message_id into v_holder;

  return v_holder is not distinct from p_message;
end;
$$;

-- Frees a lane whose send was refused outright, so a retry need not wait.
create or replace function public.release_contact_lane(
  p_org     uuid,
  p_message uuid
)
returns void
language sql
security definer
set search_path = public, pg_catalog
as $$
  delete from public.contact_send_lanes
   where org_id = p_org
     and message_id = p_message;
$$;

do $$
begin
  revoke execute on function
    public.reserve_provider_credit(uuid, text),
    public.settle_provider_credit(uuid, text, integer),
    public.claim_contact_lane(uuid, text, uuid),
    public.release_contact_lane(uuid, uuid)
  from public, anon, authenticated;

  grant execute on function
    public.reserve_provider_credit(uuid, text),
    public.settle_provider_credit(uuid, text, integer),
    public.claim_contact_lane(uuid, text, uuid),
    public.release_contact_lane(uuid, uuid)
  to service_role;
exception when undefined_object then null;
end $$;

revoke execute on function
  public.reserve_provider_credit(uuid, text),
  public.settle_provider_credit(uuid, text, integer),
  public.claim_contact_lane(uuid, text, uuid),
  public.release_contact_lane(uuid, uuid)
from public;

-- ── OUT-014: a waiting send says why ───────────────────────────────────────
-- `send_message` defers by setting `not_before` (0048), and nothing on any
-- screen said so: a held message read as stuck. The reason goes beside it.
alter table public.messages
  add column if not exists wait_reason text;

comment on column public.messages.wait_reason is
  'Why send_message deferred this message until not_before. Cleared when it sends.';

-- ── FLOW-106: every new company is resolved and profiled ────────────────────
-- `discover_companies` queued `resolve_entity` and `profile_company` for the
-- companies it created; a company added by hand, by import, by a scanned
-- article or by the analyze page got neither, so its duplicates went unseen
-- and its homepage facts unread. A trigger is the one place every create
-- path passes. The keys are the ones discovery uses, so a company discovery
-- also queues is queued once.
create or replace function public.enqueue_company_followups()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if tg_op = 'INSERT' or (old.deleted_at is not null and new.deleted_at is null) then
    insert into public.job_executions (org_id, job_name, payload, idempotency_key, status)
    values
      (new.org_id, 'resolve_entity',
       jsonb_build_object('entityType', 'company', 'entityId', new.id),
       'resolve:company:' || new.id, 'queued'),
      (new.org_id, 'profile_company',
       jsonb_build_object('companyId', new.id),
       'profile:' || new.id, 'queued')
    on conflict do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists companies_enqueue_followups on public.companies;
create trigger companies_enqueue_followups
  after insert or update of deleted_at on public.companies
  for each row
  when (new.deleted_at is null)
  execute function public.enqueue_company_followups();

revoke execute on function public.enqueue_company_followups() from public;

-- A probe for `db:doctor` (see 0031).
create or replace function public.migration_0050_applied()
returns boolean
language sql
immutable
set search_path = public, pg_catalog
as $$ select true $$;
