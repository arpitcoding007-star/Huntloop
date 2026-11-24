-- 0070 — Pass 21 integrity fixes. Each block names its finding
-- (audit/pass-21/03_FINDINGS.md).

-- ── ENG-002: enrichment refresh marks what it asked for ────────────────────
-- The sweep re-selected the same ten unenrichable companies every tick
-- (no domain, out of credits, no provider), so nobody else's were refreshed.
-- Marked when enqueued, like `research_requested_at` (0036).
alter table public.companies add column if not exists enrich_requested_at timestamptz;

-- ── DB-001: a deleted workspace confers no role ─────────────────────────────
-- `user_org_ids` already skipped deleted organizations (0031); this did not,
-- so a deleted workspace's members kept every write the policies gate on it.
create or replace function public.has_org_role(target_org uuid, min_role org_role)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1
    from public.memberships m
    join public.organizations o on o.id = m.org_id
    where m.org_id = target_org
      and m.user_id = auth.uid()
      and m.deleted_at is null
      and o.deleted_at is null
      -- owner < admin < member < viewer: a lower ordinal is more authority.
      and m.role <= min_role
  )
$$;

-- ── DB-001: deleting a workspace takes it off the Exchange ──────────────────
create or replace function public.delete_organization(p_org uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if not public.has_org_role(p_org, 'owner') then
    raise exception 'delete_organization: not an owner of %', p_org;
  end if;

  update public.organizations
    set deleted_at = now(), updated_at = now()
    where id = p_org and deleted_at is null;

  update public.campaigns
    set status = 'archived', deleted_at = coalesce(deleted_at, now())
    where org_id = p_org and deleted_at is null;

  update public.enrollments
    set status = 'stopped', next_action_at = null, parked_reason = 'workspace deleted'
    where org_id = p_org and status <> 'stopped';

  update public.sources
    set is_enabled = false, next_scan_at = null
    where org_id = p_org and is_enabled;

  update public.discovery_queries
    set is_enabled = false, next_run_at = null, updated_at = now()
    where org_id = p_org and is_enabled;

  -- The Exchange: no listing, no open need and no pending intro outlives it.
  update public.exchange_offerings
    set status = 'paused', updated_at = now()
    where org_id = p_org and status <> 'paused' and deleted_at is null;

  update public.exchange_provider_profiles
    set deleted_at = now(), updated_at = now()
    where org_id = p_org and deleted_at is null;

  update public.exchange_needs
    set status = 'withdrawn', updated_at = now()
    where org_id = p_org and status in ('draft', 'open', 'paused') and deleted_at is null;

  update public.exchange_intros
    set state = 'withdrawn', updated_at = now()
    where (buyer_org_id = p_org or provider_org_id = p_org) and state = 'requested';
end;
$$;

-- ── DB-002: a claimed profile no longer blocks removing its workspace ───────
-- `on delete set null` broke the table's own check (org_id null ⇔ unclaimed),
-- so hard-deleting any organization that had claimed a profile failed.
do $$
begin
  alter table public.exchange_provider_profiles
    drop constraint if exists exchange_provider_profiles_org_id_fkey;
  alter table public.exchange_provider_profiles
    add constraint exchange_provider_profiles_org_id_fkey
    foreign key (org_id) references public.organizations(id) on delete cascade;
end $$;

-- ── DB-004: a live workspace always keeps a live owner ──────────────────────
-- The app checked this; the database did not. A sole owner could leave over
-- REST, and any admin could then take "first owner" for themselves.
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
  v_was_live_owner boolean;
  v_is_live_owner  boolean;
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

  -- The last live owner of a live workspace cannot stop being one.
  if tg_op in ('UPDATE', 'DELETE') then
    v_was_live_owner := old.role = 'owner' and old.deleted_at is null;
    v_is_live_owner := tg_op = 'UPDATE' and new.role = 'owner' and new.deleted_at is null;
    if v_was_live_owner and not v_is_live_owner
       and exists (select 1 from public.organizations o where o.id = v_org and o.deleted_at is null)
       and not exists (
         select 1 from public.memberships m
          where m.org_id = v_org and m.id <> old.id
            and m.role = 'owner' and m.deleted_at is null
       ) then
      raise exception 'A workspace needs at least one owner. Make somebody else an owner first.'
        using errcode = '42501';
    end if;
  end if;

  if not v_guarded or public.has_org_role(v_org, 'owner') then
    return coalesce(new, old);
  end if;

  if tg_op in ('INSERT', 'UPDATE') and new.user_id = auth.uid() and new.role = 'owner' then
    -- A new workspace's first owner, written by create_organization: the
    -- workspace has no member at all yet. An existing admin is a member, so
    -- this can no longer be used to promote oneself.
    if tg_op = 'INSERT' and not exists (
      select 1 from public.memberships m where m.org_id = v_org
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

-- ── DB-008 / OUT-204: the per-mailbox cap is bounded and not a session's ────
-- Any member could set daily_limit to a million, removing the reputation cap
-- on the customer's domain. No screen edits it; the engine and service role do.
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
     or new.sent_today_on is distinct from old.sent_today_on
     or new.daily_limit is distinct from old.daily_limit then
    raise exception 'Warm-up, domain readiness, the daily limit and send counters are set by the engine, not by a session.'
      using errcode = '42501';
  end if;
  return new;
end
$$;

update public.mailboxes set daily_limit = 500 where daily_limit > 500;
update public.mailboxes set daily_limit = 1 where daily_limit < 1;
alter table public.mailboxes drop constraint if exists mailboxes_daily_limit_range;
alter table public.mailboxes
  add constraint mailboxes_daily_limit_range check (daily_limit between 1 and 500);

-- A hard delete of a mailbox (and its send history's link) is an admin's call.
-- Disconnecting is an update and stays a member's.
drop policy if exists tenant_write on public.mailboxes;
drop policy if exists mailboxes_insert on public.mailboxes;
drop policy if exists mailboxes_update on public.mailboxes;
drop policy if exists mailboxes_delete on public.mailboxes;
create policy mailboxes_insert on public.mailboxes
  for insert with check (public.has_org_role(org_id, 'member'));
create policy mailboxes_update on public.mailboxes
  for update using (public.has_org_role(org_id, 'member'))
  with check (public.has_org_role(org_id, 'member'));
create policy mailboxes_delete on public.mailboxes
  for delete using (public.has_org_role(org_id, 'admin'));

-- ── DB-005: erasure removes every identifier, not only the address ──────────
create or replace function public.erase_contact(
  p_org   uuid,
  p_email text,
  p_actor uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_email  text := lower(trim(p_email));
  v_hash   text;
  v_people uuid[];
  v_result jsonb := '{}'::jsonb;
  v_n      integer;
begin
  if v_email is null or v_email = '' then
    raise exception 'erase_contact: no address given';
  end if;

  v_hash := encode(sha256(v_email::bytea), 'hex');

  -- Suppression first, by hash: a crash below leaves the person protected.
  insert into public.suppressions (org_id, kind, value, value_hash, reason, source, is_erasure_residue)
  values (p_org, 'email', v_hash, v_hash, 'erasure request', 'gdpr', true)
  on conflict (org_id, kind, value) do update
    set value_hash = excluded.value_hash,
        is_erasure_residue = true,
        updated_at = now();

  select array_agg(distinct cp.person_id) into v_people
  from public.contact_points cp
  where cp.org_id = p_org and cp.kind = 'email' and lower(cp.value) = v_email;

  -- The address, and every other way to reach the same person (phone, LinkedIn).
  delete from public.contact_points
  where org_id = p_org
    and ((kind = 'email' and lower(value) = v_email)
         or (v_people is not null and person_id = any(v_people)));
  get diagnostics v_n = row_count;
  v_result := v_result || jsonb_build_object('contact_points', v_n);

  update public.messages m
    set body_html = null,
        body_text = null,
        original_body_text = null,
        original_subject = null,
        subject = '[erased]',
        to_email = case when lower(m.to_email) = v_email then v_hash else m.to_email end,
        from_email = case when lower(m.from_email) = v_email then v_hash else m.from_email end,
        updated_at = now()
    where m.org_id = p_org
      and (lower(m.to_email) = v_email or lower(m.from_email) = v_email);
  get diagnostics v_n = row_count;
  v_result := v_result || jsonb_build_object('messages_redacted', v_n);

  -- Threads carry the address in plain text among their participants.
  update public.threads t
    set subject = '[erased]',
        participants = array(
          select case when lower(p) = v_email then v_hash else p end
            from unnest(t.participants) as p
        ),
        updated_at = now()
    where t.org_id = p_org
      and exists (select 1 from unnest(t.participants) as p where lower(p) = v_email);
  get diagnostics v_n = row_count;
  v_result := v_result || jsonb_build_object('threads_redacted', v_n);

  if v_people is not null then
    delete from public.enrichment_records
    where org_id = p_org and entity_type = 'person' and entity_id = any(v_people);
    get diagnostics v_n = row_count;
    v_result := v_result || jsonb_build_object('enrichment_records', v_n);

    update public.activities
      set body = null, summary = '[erased]', updated_at = now()
      where org_id = p_org and person_id = any(v_people) and origin = 'manual';
    get diagnostics v_n = row_count;
    v_result := v_result || jsonb_build_object('activities_redacted', v_n);

    update public.people
      set first_name = null, last_name = null, linkedin_url = null, title = null,
          departed_note = null, deleted_at = coalesce(deleted_at, now()),
          updated_at = now()
      where org_id = p_org and id = any(v_people);
    get diagnostics v_n = row_count;
    v_result := v_result || jsonb_build_object('people', v_n);
  end if;

  insert into public.audit_logs (org_id, actor_id, action, target_type, target_id, meta)
  values (p_org, p_actor, 'contact.erased', 'contact', null,
          jsonb_build_object('hash', v_hash, 'result', v_result));

  return v_result;
end;
$$;

-- ── TRUST-001 / DB-007 / TRUST-002: a profile's domain is its owner's ───────
-- SEC-302 (0052) for the Exchange: a session may claim a domain only when an
-- owner or admin of the workspace has a confirmed address there. And
-- "Verified" no longer outlives what was verified: renaming or re-pointing a
-- verified profile clears it.
create or replace function public.exchange_profile_verification_is_platform_only()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if auth.uid() is not null then
    if tg_op = 'INSERT' and new.verified_at is not null then
      raise exception 'A provider profile is verified by the platform, not by its owner.'
        using errcode = 'insufficient_privilege';
    end if;
    if tg_op = 'UPDATE' and new.verified_at is distinct from old.verified_at then
      raise exception 'A provider profile is verified by the platform, not by its owner.'
        using errcode = 'insufficient_privilege';
    end if;

    if new.domain is not null
       and (tg_op = 'INSERT' or new.domain is distinct from old.domain)
       and not exists (
         select 1
           from public.memberships m
           join auth.users u on u.id = m.user_id
          where m.org_id = new.org_id
            and m.deleted_at is null
            and m.role in ('owner', 'admin')
            and (to_jsonb(u) ->> 'email_confirmed_at') is not null
            and lower(split_part(to_jsonb(u) ->> 'email', '@', 2)) = lower(new.domain)
       ) then
      raise exception 'Only a workspace whose owner or admin has a confirmed address at % can claim it.', new.domain
        using errcode = 'insufficient_privilege';
    end if;

    if tg_op = 'UPDATE' and old.verified_at is not null
       and (new.domain is distinct from old.domain or new.name is distinct from old.name) then
      new.verified_at := null;
    end if;
  end if;
  return new;
end
$$;

-- ── DB-011: discovery needs a confirmed address ─────────────────────────────
-- 0052 checked the workspace's admins; the person asking was trusted on an
-- address nobody had proven, so a sign-up at any domain saw who works there.
create or replace function public.discoverable_workspaces()
returns table (org_id uuid, org_name text, org_slug text, member_count bigint)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_user   uuid := auth.uid();
  v_email  text;
  v_domain text;
begin
  if v_user is null then
    raise exception 'discoverable_workspaces requires an authenticated caller';
  end if;

  -- DB-011: only a proven address says which company somebody works at.
  select (to_jsonb(u) ->> 'email') into v_email
    from auth.users u
   where u.id = v_user
     and (to_jsonb(u) ->> 'email_confirmed_at') is not null;

  if v_email is null or position('@' in v_email) = 0 then
    return;
  end if;

  v_domain := lower(split_part(v_email, '@', 2));
  if v_domain = '' then
    return;
  end if;

  if v_domain in (
    'gmail.com','googlemail.com','outlook.com','hotmail.com','live.com',
    'yahoo.com','icloud.com','me.com','aol.com','proton.me','protonmail.com',
    'gmx.com','mail.com','yandex.com','zoho.com','fastmail.com'
  ) then
    return;
  end if;

  return query
    select o.id,
           o.name,
           o.slug,
           (select count(*) from public.memberships m
             where m.org_id = o.id and m.deleted_at is null)
      from public.organizations o
     where o.primary_domain = v_domain
       and o.is_discoverable
       and o.deleted_at is null
       and not exists (
         select 1 from public.memberships m
          where m.org_id = o.id and m.user_id = v_user and m.deleted_at is null
       )
       -- SEC-302: somebody who runs the workspace holds a confirmed address
       -- at the domain it claims.
       and exists (
         select 1
           from public.memberships m
           join auth.users u on u.id = m.user_id
          where m.org_id = o.id
            and m.deleted_at is null
            and m.role in ('owner', 'admin')
            and (to_jsonb(u) ->> 'email_confirmed_at') is not null
            and lower(split_part(to_jsonb(u) ->> 'email', '@', 2)) = v_domain
       );
end;
$$;

-- ── DB-010: the export carries the customer's set-up ───────────────────────
create or replace function public.export_organization(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_result jsonb;
begin
  if not public.has_org_role(p_org, 'admin') then
    raise exception 'export_organization: not an admin of %', p_org;
  end if;

  select jsonb_build_object(
    'exportedAt', now(),
    'organization', (
      select to_jsonb(o) - 'id'
      from public.organizations o where o.id = p_org
    ),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'role', m.role, 'createdAt', m.created_at
      ))
      from public.memberships m where m.org_id = p_org
    ), '[]'::jsonb),
    'icps', coalesce((
      select jsonb_agg(to_jsonb(i) - 'org_id')
      from public.icps i where i.org_id = p_org and i.deleted_at is null
    ), '[]'::jsonb),
    'products', coalesce((
      select jsonb_agg(to_jsonb(p) - 'org_id')
      from public.products p where p.org_id = p_org and p.deleted_at is null
    ), '[]'::jsonb),
    'companies', coalesce((
      select jsonb_agg(to_jsonb(c) - 'org_id')
      from public.companies c where c.org_id = p_org and c.deleted_at is null
    ), '[]'::jsonb),
    'opportunities', coalesce((
      select jsonb_agg(to_jsonb(op) - 'org_id')
      from public.opportunities op where op.org_id = p_org and op.deleted_at is null
    ), '[]'::jsonb),
    'activities', coalesce((
      select jsonb_agg(to_jsonb(a) - 'org_id' order by a.occurred_at)
      from public.activities a where a.org_id = p_org and a.deleted_at is null
    ), '[]'::jsonb),
    'memories', coalesce((
      select jsonb_agg(to_jsonb(mem) - 'org_id')
      from public.memories mem
      where mem.org_id = p_org and mem.deleted_at is null
        and (mem.scope <> 'user' or mem.scope_id = auth.uid())
    ), '[]'::jsonb),
    -- DB-010: the outreach set-up and the Exchange listings are the
    -- customer's own work, small, and were missing.
    'campaigns', coalesce((
      select jsonb_agg(to_jsonb(x) - 'org_id')
      from public.campaigns x where x.org_id = p_org and x.deleted_at is null
    ), '[]'::jsonb),
    'sequences', coalesce((
      select jsonb_agg(to_jsonb(x) - 'org_id')
      from public.sequences x where x.org_id = p_org and x.deleted_at is null
    ), '[]'::jsonb),
    'sequenceSteps', coalesce((
      select jsonb_agg(to_jsonb(x) - 'org_id')
      from public.sequence_steps x where x.org_id = p_org and x.deleted_at is null
    ), '[]'::jsonb),
    'exchangeRequests', coalesce((
      select jsonb_agg(to_jsonb(x) - 'org_id')
      from public.exchange_needs x where x.org_id = p_org and x.deleted_at is null
    ), '[]'::jsonb),
    'exchangeOfferings', coalesce((
      select jsonb_agg(to_jsonb(x) - 'org_id')
      from public.exchange_offerings x where x.org_id = p_org and x.deleted_at is null
    ), '[]'::jsonb),
    'exchangeProfile', (
      select to_jsonb(x) - 'org_id'
      from public.exchange_provider_profiles x
      where x.org_id = p_org and x.deleted_at is null
      limit 1
    ),
    'counts', jsonb_build_object(
      'evidence', (select count(*) from public.evidence where org_id = p_org),
      'messages', (select count(*) from public.messages where org_id = p_org),
      'people', (select count(*) from public.people where org_id = p_org),
      'aiRuns', (select count(*) from public.ai_runs where org_id = p_org),
      'contactPoints', (select count(*) from public.contact_points where org_id = p_org),
      'enrollments', (select count(*) from public.enrollments where org_id = p_org)
    ),
    'note',
      'Companies, opportunities, activities, ICPs, products, memories, '
      || 'campaigns, sequences and Exchange listings are '
      || 'included in full. Evidence, messages, people and AI run records are '
      || 'counted rather than included because they are large; ask for any of '
      || 'them and they can be exported separately. Colleagues'' personal '
      || 'preferences are private to them and are not included.'
  ) into v_result;

  return v_result;
end;
$$;

create or replace function public.migration_0070_applied()
returns boolean
language sql
immutable
set search_path = public, pg_catalog
as $$ select true $$;
