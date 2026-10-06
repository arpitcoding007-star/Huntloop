-- 0040 — the decision brief's research requests, deal value, and product email.
--
-- COMMAND.md §16 P3 (C), the P2 owner decision on deal value, and the
-- transactional email the owner chose Resend for (§16.7 decision 1).
--
-- ── companies.research_asked_at ──────────────────────────────────────────
--
-- "Research this" on an opportunity's brief. `research_requested_at` (0036)
-- cannot carry it: the sweeper only researches companies that have no
-- opportunity yet, because a company with one has been qualified already. A
-- person asking for fresh research on a company they are working is a
-- different request, and it gets its own column. `schedule_followups` turns it
-- into a forced `research_company` job (which rescores) and clears it.
--
-- ── opportunities.estimated_value_cents ──────────────────────────────────
--
-- Optional. A person types it; nothing estimates it. It is what Performance
-- needs for pipeline value and what demand intelligence needs for "value at
-- stake". Null means nobody said, and every aggregate treats it as unknown
-- rather than as zero.
--
-- ── notification_preferences ─────────────────────────────────────────────
--
-- One row per person per workspace. The daily digest is on by default and is
-- only ever sent when something needs the person; every digest carries a
-- one-click way to turn it off. A missing row means the defaults.
-- `last_digest_on` is the person's local date of the last digest, and the
-- sender claims a day with a conditional update on it, so two overlapping
-- ticks cannot send the same digest twice.

alter table public.companies
  add column if not exists research_asked_at timestamptz;

create index if not exists companies_research_asked_idx
  on public.companies (research_asked_at)
  where research_asked_at is not null and deleted_at is null;

alter table public.opportunities
  add column if not exists estimated_value_cents bigint
    check (estimated_value_cents is null or estimated_value_cents between 0 and 100000000000),
  add column if not exists estimated_value_currency text not null default 'USD'
    check (estimated_value_currency ~ '^[A-Z]{3}$');

create table if not exists public.notification_preferences (
  org_id          uuid not null references public.organizations(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  daily_digest    boolean not null default true,
  -- The hour, in the person's own time zone, the digest is sent.
  digest_hour     smallint not null default 8 check (digest_hour between 0 and 23),
  -- An IANA zone name. Validated by the application against Intl's list.
  timezone        text not null default 'UTC' check (length(timezone) between 1 and 64),
  last_digest_on  date,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (org_id, user_id)
);

alter table public.notification_preferences enable row level security;

-- Personal: nobody else reads or writes yours. The digest sender uses the
-- service role.
create policy notification_preferences_own on public.notification_preferences
  for all
  using (user_id = auth.uid() and org_id in (select public.user_org_ids()))
  with check (user_id = auth.uid() and public.has_org_role(org_id, 'viewer'));

create trigger notification_preferences_touch before update on public.notification_preferences
  for each row execute function public.touch_updated_at();

-- ── Join-request emails ───────────────────────────────────────────────────
--
-- Admins hear about a request; the requester hears about an approval. Each is
-- sent once by the `send_notifications` sweeper, which sets the marker in the
-- same pass. A deployment without email leaves them null, and only requests
-- from the last week are sent once it has email — a month-old request is not
-- news.

alter table public.join_requests
  add column if not exists admins_notified_at    timestamptz,
  add column if not exists requester_notified_at timestamptz;

create index if not exists join_requests_unnotified_idx
  on public.join_requests (created_at)
  where admins_notified_at is null and status = 'pending';

create index if not exists join_requests_approved_unnotified_idx
  on public.join_requests (decided_at)
  where requester_notified_at is null and status = 'approved';

-- A probe for `db:doctor` (see 0031).
create or replace function public.migration_0040_applied()
returns boolean
language sql
immutable
set search_path = public, pg_catalog
as $$ select true $$;
