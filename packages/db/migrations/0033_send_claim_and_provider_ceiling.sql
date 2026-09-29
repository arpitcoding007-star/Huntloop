-- 0033 — one send per message, and a provider budget that is never infinite.
--
-- ── OUT-001 · a message could be sent twice ──────────────────────────────
--
-- `send_message` checked `sent_at` and then called the provider, and wrote
-- `sent_at` afterwards without checking the write. The queue is at-least-once:
-- a function killed after the provider accepted, a lost response, a stalled
-- job requeued after ten minutes, or a failed `sent_at` update all ran the
-- handler again with `sent_at` still null — and mailed the prospect twice.
--
-- `send_attempted_at` is claimed with a conditional update *before* the
-- provider call. Only one run can win it. The handler releases it only when
-- the provider definitely refused the message (a 4xx); anything ambiguous —
-- a timeout, a 5xx, a response with no id — keeps the claim and leaves the
-- message for a person, because re-sending on a guess is the one outcome
-- outreach cannot undo.
--
-- ── PROV-002 · provider spend had no ceiling by default ──────────────────
--
-- `provider_budget_state` allowed everything when no account-level
-- `monthly_credit_limit` was set, and nothing in the product sets one. Every
-- self-serve workspace could spend the platform's provider credits without
-- limit. The column's own comment (0011) says a NULL falls back to the plan;
-- the function never did. It now does: the account limit, else the plan's
-- `enrich` allowance, else the Free allowance.

alter table public.messages
  add column if not exists send_attempted_at timestamptz;

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
  cap as (
    select coalesce(
      (select lim from account_cap),
      public.usage_limit(p_org, 'enrich'),
      25
    ) as lim
  )
  select
    coalesce((select used from counter), 0)::bigint,
    (select lim from cap)::bigint,
    greatest((select lim from cap) - coalesce((select used from counter), 0), 0)::bigint,
    coalesce((select used from counter), 0) < (select lim from cap);
$$;

-- A probe for `db:doctor` (see 0031).
create or replace function public.migration_0033_applied()
returns boolean
language sql
immutable
set search_path = public, pg_catalog
as $$ select true $$;
