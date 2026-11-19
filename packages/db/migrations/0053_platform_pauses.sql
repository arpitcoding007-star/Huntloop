-- 0053 — a kill switch (pass 16, PROD-207 / HL-1606).
--
-- Until now the only way to stop sending, model spend or provider spend in an
-- emergency was to unset CRON_SECRET and redeploy, which stops *every* job,
-- or to edit `messages` and `job_executions` by hand. This is one row.
--
--   insert into platform_pauses (scope, reason) values ('sends', 'Bounce spike, investigating');
--   insert into platform_pauses (scope, org_id, reason) values ('ai', '<org uuid>', 'Runaway spend');
--   update platform_pauses set lifted_at = now() where id = '<id>';
--
-- `scope` is what stops: `sends` (send_message defers, nothing leaves),
-- `ai` (no model call starts, in jobs or in the app), `providers` (no paid
-- vendor call starts). `org_id` null means every workspace. Checked at the
-- moment of each send or call, so a pause takes effect on the next one, with
-- no deploy. Runbook: docs/operations/kill-switch.md.
--
-- Writable only by the service role (the SQL editor). Sessions cannot read
-- the table; they ask `platform_paused`, which answers only for the caller's
-- own workspaces and the global switch.

create table if not exists public.platform_pauses (
  id         uuid primary key default gen_random_uuid(),
  scope      text not null check (scope in ('sends', 'ai', 'providers')),
  org_id     uuid references public.organizations(id) on delete cascade,
  reason     text not null check (length(trim(reason)) > 0),
  created_at timestamptz not null default now(),
  lifted_at  timestamptz
);

create index if not exists platform_pauses_live_idx
  on public.platform_pauses (scope, org_id)
  where lifted_at is null;

alter table public.platform_pauses enable row level security;
-- Refuses every session, stated rather than implied (the 0047 pattern for
-- `message_unsubscribe_tokens`). The service role bypasses RLS.
drop policy if exists no_session_access on public.platform_pauses;
create policy no_session_access on public.platform_pauses
  for all using (false) with check (false);

do $$
begin
  revoke all on public.platform_pauses from anon, authenticated;
exception when undefined_object then null;
end $$;

-- The reason a scope is paused for this org, or null. Global pauses win.
create or replace function public.platform_paused(p_scope text, p_org uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select p.reason
    from public.platform_pauses p
   where p.scope = p_scope
     and p.lifted_at is null
     and (p.org_id is null or p.org_id = p_org)
     -- A session asks only about its own workspaces (or the global switch).
     and (auth.uid() is null
          or p.org_id is null
          or p_org in (select public.user_org_ids()))
   order by (p.org_id is null) desc, p.created_at desc
   limit 1
$$;

revoke execute on function public.platform_paused(text, uuid) from public;
do $$
begin
  revoke execute on function public.platform_paused(text, uuid) from anon;
  grant execute on function public.platform_paused(text, uuid) to authenticated, service_role;
exception when undefined_object then null;
end $$;

-- A probe for `db:doctor` (see 0031).
create or replace function public.migration_0053_applied()
returns boolean
language sql
immutable
set search_path = public, pg_catalog
as $$ select true $$;
