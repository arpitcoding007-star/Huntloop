-- 0042 — demand intelligence. COMMAND.md §16.3-I (P6).
--
-- What prospects say is missing, grouped into themes a person curates, so the
-- product roadmap is driven by what lost and stalled deals actually asked for
-- — and so that when a theme ships, the deals that asked for it come back to
-- someone's attention.
--
-- ── Signals ──────────────────────────────────────────────────────────────
--
-- One row per thing a prospect said they need, object to, or are blocked by.
-- Three producers, each pointing at its source row:
--
--   reply      `classify_reply` reads an objection or request a prospect
--              stated in a reply (written by `sync_mailbox`). An inference
--              that cites the message.
--   outcome    a deal closed as lost or not a fit, with a reason a person
--              wrote — or with "missing capability" as its category. Written
--              by a trigger on `outcomes`, so no closing path can forget it.
--   note       an activity a person marked as product feedback. Trigger on
--              `activities`.
--
-- Signals copy one short statement, never a whole message. Erasing a contact
-- redacts the message and the person's activities (0037's `erase_contact`);
-- the triggers at the end delete the signals drawn from them in the same
-- statement, so an erasure cannot leave a paraphrase of what they said.
--
-- ── Themes ───────────────────────────────────────────────────────────────
--
-- Proposed by `cluster_demand` (a model groups unthemed signals, citing them
-- by id), then accepted, merged, rejected or given a status by a person. A
-- theme's status is the roadmap answer: open → planned → shipped, or won't.
-- When one is marked shipped, Needs you surfaces the deals that asked for it.

create table if not exists public.demand_themes (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  title        text not null check (length(title) between 1 and 160),
  description  text check (description is null or length(description) <= 1000),
  kind         text not null default 'request'
                 check (kind in ('request', 'objection', 'blocker')),
  status       text not null default 'proposed'
                 check (status in ('proposed', 'open', 'planned', 'shipped', 'wont', 'rejected', 'merged')),
  merged_into  uuid references public.demand_themes(id) on delete set null,
  origin       text not null default 'model' check (origin in ('model', 'user')),
  shipped_at   timestamptz,
  decided_by   uuid references auth.users(id) on delete set null,
  decided_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists demand_themes_org_idx
  on public.demand_themes (org_id, status, updated_at desc);

create table if not exists public.demand_signals (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  kind           text not null check (kind in ('request', 'objection', 'blocker')),
  statement      text not null check (length(statement) between 1 and 500),
  source_type    text not null check (source_type in ('reply', 'outcome', 'note')),
  source_id      uuid not null,
  opportunity_id uuid references public.opportunities(id) on delete set null,
  company_id     uuid references public.companies(id) on delete set null,
  claim_kind     claim_kind not null default 'inference',
  theme_id       uuid references public.demand_themes(id) on delete set null,
  -- Set when a grouping run has considered this signal, so a rejected
  -- proposal is not proposed again until something new arrives.
  clustered_at   timestamptz,
  occurred_at    timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  -- One signal per source and statement: a re-sync or a re-fired trigger
  -- cannot double-count what somebody said.
  unique (org_id, source_type, source_id, statement)
);

create index if not exists demand_signals_theme_idx
  on public.demand_signals (org_id, theme_id);
create index if not exists demand_signals_unclustered_idx
  on public.demand_signals (org_id, created_at)
  where clustered_at is null and theme_id is null;
create index if not exists demand_signals_opportunity_idx
  on public.demand_signals (org_id, opportunity_id)
  where opportunity_id is not null;

-- When a person asked for grouping, and when it last ran, per workspace.
create table if not exists public.demand_state (
  org_id            uuid primary key references public.organizations(id) on delete cascade,
  requested_at      timestamptz,
  last_clustered_at timestamptz,
  updated_at        timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['demand_themes', 'demand_signals', 'demand_state']
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
  end loop;
end
$$;

create trigger demand_themes_touch before update on public.demand_themes
  for each row execute function public.touch_updated_at();
create trigger demand_state_touch before update on public.demand_state
  for each row execute function public.touch_updated_at();

-- ── Notes a person marks as product feedback ──────────────────────────────

alter table public.activities
  add column if not exists product_feedback boolean not null default false;

-- ── Producers ─────────────────────────────────────────────────────────────
--
-- Exception-isolated like 0037's projections: a failure here is a WARNING and
-- the source write commits. A missing signal is a gap; a failed close is not
-- acceptable.

create or replace function public.demand_from_outcome()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_company uuid;
  v_text    text;
begin
  begin
    if new.kind not in ('lost', 'disqualified') or new.opportunity_id is null then
      return new;
    end if;
    v_text := nullif(btrim(coalesce(new.reason, '')), '');
    if v_text is null and new.reason_category is distinct from 'missing_capability' then
      return new;
    end if;
    select company_id into v_company from public.opportunities where id = new.opportunity_id;
    insert into public.demand_signals
      (org_id, kind, statement, source_type, source_id, opportunity_id, company_id, claim_kind, occurred_at)
    values
      (new.org_id,
       case when new.reason_category = 'missing_capability' then 'request' else 'objection' end,
       left(coalesce(v_text, 'Missing capability (no detail recorded)'), 500),
       'outcome', new.id, new.opportunity_id, v_company, 'fact', coalesce(new.occurred_at, now()))
    on conflict (org_id, source_type, source_id, statement) do nothing;
  exception when others then
    raise warning 'demand_from_outcome: %', sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists outcomes_demand on public.outcomes;
create trigger outcomes_demand after insert on public.outcomes
  for each row execute function public.demand_from_outcome();

create or replace function public.demand_from_activity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  begin
    if new.product_feedback and new.origin = 'manual'
       and (tg_op = 'INSERT' or old.product_feedback is distinct from true) then
      insert into public.demand_signals
        (org_id, kind, statement, source_type, source_id, opportunity_id, company_id, claim_kind, occurred_at)
      values
        (new.org_id, 'request', left(coalesce(nullif(btrim(new.body), ''), new.summary), 500),
         'note', new.id, new.opportunity_id, new.company_id, 'fact', new.occurred_at)
      on conflict (org_id, source_type, source_id, statement) do nothing;
    end if;
  exception when others then
    raise warning 'demand_from_activity: %', sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists activities_demand on public.activities;
create trigger activities_demand after insert or update of product_feedback on public.activities
  for each row execute function public.demand_from_activity();

-- ── Erasure follows the source ────────────────────────────────────────────

create or replace function public.demand_forget_erased()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  -- Nested, not `and`-chained: PL/pgSQL resolves every field an expression
  -- names, so `new.subject` on an activities row raises even when the
  -- table-name test before it is false.
  if tg_table_name = 'messages' then
    if new.subject = '[erased]' and old.subject is distinct from '[erased]' then
      delete from public.demand_signals
        where org_id = new.org_id and source_type = 'reply' and source_id = new.id;
    end if;
  elsif tg_table_name = 'activities' then
    if new.summary = '[erased]' and old.summary is distinct from '[erased]' then
      delete from public.demand_signals
        where org_id = new.org_id and source_type = 'note' and source_id = new.id;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists messages_demand_erasure on public.messages;
create trigger messages_demand_erasure after update of subject on public.messages
  for each row execute function public.demand_forget_erased();
drop trigger if exists activities_demand_erasure on public.activities;
create trigger activities_demand_erasure after update of summary on public.activities
  for each row execute function public.demand_forget_erased();

-- Functions run by triggers only; nobody calls them directly.
do $$
begin
  revoke execute on function public.demand_from_outcome() from public, anon, authenticated;
  revoke execute on function public.demand_from_activity() from public, anon, authenticated;
  revoke execute on function public.demand_forget_erased() from public, anon, authenticated;
exception when undefined_object or undefined_function then null;
end $$;

-- A probe for `db:doctor` (see 0031).
create or replace function public.migration_0042_applied()
returns boolean
language sql
immutable
set search_path = public, pg_catalog
as $$ select true $$;
