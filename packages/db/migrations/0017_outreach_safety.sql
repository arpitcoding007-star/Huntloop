-- 0017 — outreach safety, and the compliance surface.
--
-- ── What already worked ──────────────────────────────────────────────────
--
-- More than the plan assumed. `suppressions` is checked before every send,
-- `is_suppressed()` exists from `0008`, `record_unsubscribe()` handles the
-- token, `claim_mailbox_send()` enforces a per-mailbox daily cap, and
-- `messages_sent_has_provider_id` makes it structurally impossible to record
-- a send that did not happen. None of that is rebuilt here.
--
-- ── What was missing ─────────────────────────────────────────────────────
--
-- **Frequency.** The per-mailbox cap answers "how much may this mailbox
-- send", which is a deliverability question. Nothing answered "how often may
-- we contact this *person*", which is the question a recipient cares about —
-- and with three campaigns and two sequences, nothing prevented one contact
-- receiving three unrelated emails on a Tuesday. That is not a compliance
-- edge case; it is the ordinary behaviour of an automation system nobody
-- bounded.
--
-- **Erasure.** There was no way to answer "delete everything you have about
-- me", and no way to answer it *correctly* — because the naive
-- implementation deletes the suppression too, which makes the person
-- contactable again. That is the trap this migration is most careful about.
--
-- **Retention.** Contact data accumulated forever, with no expression of a
-- policy either way.
--
-- ── The principle ────────────────────────────────────────────────────────
--
-- Every control here is enforced at the database, not in the sending handler.
-- A rule that lives in one code path is a rule that the second code path does
-- not have, and there are already three ways a message gets sent.

-- ── Contact frequency ─────────────────────────────────────────────────────
--
-- One row per (org, email), maintained by the send path. Denormalized on
-- purpose: the alternative is counting `messages` joined through enrollments
-- and opportunities to contact points on every send, which is a four-table
-- aggregate on the hottest path in the system.

create table contact_frequency (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,

  -- The address, lowercased. Not a `person_id`, deliberately: the same human
  -- can exist as two `people` rows under two companies, and a frequency cap
  -- keyed on our row ids would let a duplicate defeat it. The address is the
  -- thing the recipient experiences.
  email         text not null,

  last_sent_at  timestamptz,
  sends_total   integer not null default 0 check (sends_total >= 0),
  -- Rolling 30-day count, trimmed by the same function that increments it.
  sends_30d     integer not null default 0 check (sends_30d >= 0),
  window_start  timestamptz not null default now(),

  -- Set when the person replies. A reply resets the clock in the other
  -- direction: someone who answered is in a conversation, and the cap that
  -- protects a stranger from being pestered should not stop a reply being
  -- answered.
  last_reply_at timestamptz,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  unique (org_id, email)
);

create index contact_frequency_recent_idx on contact_frequency (org_id, last_sent_at desc);

-- ── The policy ────────────────────────────────────────────────────────────
--
-- On the org, with defaults that are permissive enough not to break existing
-- behaviour and restrictive enough to stop the specific failure above.
--
-- Defaults are chosen to be *invisible* to a customer who is already
-- behaving reasonably and hard-stop for one who is not.

alter table organizations
  -- Minimum days between two outbound messages to one address, across every
  -- campaign. 2 is the default because a sequence step at day 3 is normal
  -- practice and a step at day 1 is not.
  add column min_days_between_contacts integer not null default 2
    check (min_days_between_contacts >= 0),
  -- Maximum outbound messages to one address in a rolling 30 days.
  add column max_sends_per_contact_30d integer not null default 6
    check (max_sends_per_contact_30d >= 0),
  -- Maximum people contacted at one company with an open sequence. Stops the
  -- pattern where a company is "worked" by emailing nine people at once,
  -- which is the fastest route to a domain block.
  add column max_contacts_per_company integer not null default 3
    check (max_contacts_per_company >= 1),
  -- Org-wide daily ceiling, above the per-mailbox caps. NULL means the
  -- mailbox caps are the only limit, which is the pre-existing behaviour.
  add column max_sends_per_day integer
    check (max_sends_per_day is null or max_sends_per_day >= 0),

  -- Retention for contact data, in days. NULL means "keep indefinitely",
  -- which is the honest default: silently deleting a customer's prospect
  -- database because we picked 365 would be worse than not having the
  -- feature. It is a policy the customer sets, and the screen explains it.
  add column contact_retention_days integer
    check (contact_retention_days is null or contact_retention_days >= 30);

-- ── May we send to this address? ──────────────────────────────────────────
--
-- One function, called by every send path, returning a decision *and* the
-- reason. A boolean would mean the outreach screen says "blocked" with no
-- explanation, and the support ticket that follows costs more than the column.
--
-- Suppression is checked here too, even though `is_suppressed` already
-- exists, so that there is exactly one question a caller has to ask. Two
-- guards means one of them eventually gets skipped.

create or replace function public.can_contact(
  p_org   uuid,
  p_email text
)
returns table (allowed boolean, reason text, detail jsonb)
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_email     text := lower(trim(p_email));
  v_hash      text;
  v_org       record;
  v_freq      record;
  v_today     integer;
begin
  if v_email is null or v_email = '' then
    return query select false, 'invalid_address', '{}'::jsonb;
    return;
  end if;

  v_hash := encode(sha256(v_email::bytea), 'hex');

  -- Two suppression checks, not one, and the second is the whole reason
  -- erasure is safe.
  --
  -- `is_suppressed` compares the plaintext address, which is right for an
  -- ordinary unsubscribe. After an erasure there is no plaintext address left
  -- to compare — that is what erasure means — and only the hash survives. A
  -- caller that checked the first and not the second would find nothing,
  -- conclude the person was contactable, and send the one email the erasure
  -- existed to prevent.
  if public.is_suppressed(p_org, v_email) then
    return query select false, 'suppressed', '{}'::jsonb;
    return;
  end if;

  if exists (
    select 1 from public.suppressions s
    where s.org_id = p_org and s.value_hash = v_hash
  ) then
    return query select false, 'suppressed', '{}'::jsonb;
    return;
  end if;

  select min_days_between_contacts, max_sends_per_contact_30d, max_sends_per_day
    into v_org
  from public.organizations where id = p_org;

  if not found then
    return query select false, 'unknown_org', '{}'::jsonb;
    return;
  end if;

  select * into v_freq
  from public.contact_frequency
  where org_id = p_org and email = v_email;

  if found then
    -- A reply lifts the cadence cap. Continuing a conversation somebody
    -- started is not cold outreach, and treating it as such makes the product
    -- rude in the one case where it should be responsive.
    if v_freq.last_sent_at is not null
       and (v_freq.last_reply_at is null or v_freq.last_reply_at < v_freq.last_sent_at)
       and v_freq.last_sent_at > now() - make_interval(days => v_org.min_days_between_contacts)
    then
      return query select false, 'too_soon',
        jsonb_build_object(
          'lastSentAt', v_freq.last_sent_at,
          'minDays', v_org.min_days_between_contacts
        );
      return;
    end if;

    if v_freq.window_start > now() - interval '30 days'
       and v_freq.sends_30d >= v_org.max_sends_per_contact_30d
    then
      return query select false, 'frequency_cap',
        jsonb_build_object('sends30d', v_freq.sends_30d, 'cap', v_org.max_sends_per_contact_30d);
      return;
    end if;
  end if;

  if v_org.max_sends_per_day is not null then
    select count(*) into v_today
    from public.messages m
    where m.org_id = p_org
      and m.direction = 'outbound'
      and m.sent_at >= date_trunc('day', now());

    if v_today >= v_org.max_sends_per_day then
      return query select false, 'org_daily_cap',
        jsonb_build_object('sentToday', v_today, 'cap', v_org.max_sends_per_day);
      return;
    end if;
  end if;

  return query select true, 'ok', '{}'::jsonb;
end;
$$;

-- ── Recording a send ──────────────────────────────────────────────────────
--
-- Called after the provider accepts, never before. The window is rolled here
-- rather than by a scheduled job, because a counter that is only correct
-- after a nightly sweep is a counter that is wrong all day.

create or replace function public.record_contact_send(p_org uuid, p_email text)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare v_email text := lower(trim(p_email));
begin
  if v_email is null or v_email = '' then return; end if;

  insert into public.contact_frequency (org_id, email, last_sent_at, sends_total, sends_30d, window_start)
  values (p_org, v_email, now(), 1, 1, now())
  on conflict (org_id, email) do update
    set last_sent_at = now(),
        sends_total  = public.contact_frequency.sends_total + 1,
        -- Rolling window: if the current one is older than 30 days it starts
        -- again at 1 rather than accumulating forever.
        sends_30d    = case
                         when public.contact_frequency.window_start < now() - interval '30 days'
                         then 1
                         else public.contact_frequency.sends_30d + 1
                       end,
        window_start = case
                         when public.contact_frequency.window_start < now() - interval '30 days'
                         then now()
                         else public.contact_frequency.window_start
                       end,
        updated_at   = now();
end;
$$;

create or replace function public.record_contact_reply(p_org uuid, p_email text)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare v_email text := lower(trim(p_email));
begin
  if v_email is null or v_email = '' then return; end if;
  insert into public.contact_frequency (org_id, email, last_reply_at)
  values (p_org, v_email, now())
  on conflict (org_id, email) do update
    set last_reply_at = now(), updated_at = now();
end;
$$;

-- ── Erasure ───────────────────────────────────────────────────────────────
--
-- The trap, stated plainly: deleting everything about a person deletes the
-- record that they asked never to be contacted. The next import of the same
-- list makes them contactable again, and the second email is worse than the
-- first because it proves the erasure did nothing.
--
-- So erasure keeps exactly one thing — a suppression keyed on a *hash* of the
-- address. The address itself is gone; what remains is the ability to answer
-- "is this address suppressed" without being able to enumerate who.

alter table suppressions
  add column value_hash text,
  -- Set when the row is all that survives an erasure. Keeps the two kinds
  -- distinguishable, because a hashed suppression cannot be shown on a screen
  -- and the screen needs to know that rather than rendering a hash.
  add column is_erasure_residue boolean not null default false;

create index suppressions_hash_idx on suppressions (org_id, value_hash)
  where value_hash is not null;

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

  -- `sha256(bytea)` is core Postgres since 11 and needs no extension.
  -- `digest()` would have meant `create extension pgcrypto`, which `0001`
  -- deliberately avoided for `gen_random_uuid()` and which is not worth
  -- reversing for one hash.
  v_hash := encode(sha256(v_email::bytea), 'hex');

  -- The suppression goes in FIRST and by hash, so that a crash anywhere below
  -- leaves the person protected rather than exposed. Order matters here in a
  -- way it rarely does.
  insert into public.suppressions (org_id, kind, value, value_hash, reason, source, is_erasure_residue)
  values (p_org, 'email', v_hash, v_hash, 'erasure request', 'gdpr', true)
  on conflict (org_id, kind, value) do update
    set value_hash = excluded.value_hash,
        is_erasure_residue = true,
        updated_at = now();

  select array_agg(distinct cp.person_id) into v_people
  from public.contact_points cp
  where cp.org_id = p_org and cp.kind = 'email' and lower(cp.value) = v_email;

  delete from public.contact_points
  where org_id = p_org and kind = 'email' and lower(value) = v_email;
  get diagnostics v_n = row_count;
  v_result := v_result || jsonb_build_object('contact_points', v_n);

  -- Message bodies are redacted rather than deleted. The row is the record
  -- that a message was sent, which the org needs for its own compliance and
  -- which deleting would destroy; the content is what the request is about.
  update public.messages m
    set body_html = null,
        body_text = null,
        subject = '[erased]',
        to_email = v_hash,
        updated_at = now()
    where m.org_id = p_org and lower(m.to_email) = v_email;
  get diagnostics v_n = row_count;
  v_result := v_result || jsonb_build_object('messages_redacted', v_n);

  if v_people is not null then
    delete from public.enrichment_records
    where org_id = p_org and entity_type = 'person' and entity_id = any(v_people);
    get diagnostics v_n = row_count;
    v_result := v_result || jsonb_build_object('enrichment_records', v_n);

    update public.people
      set first_name = null, last_name = null, linkedin_url = null,
          departed_note = null, deleted_at = coalesce(deleted_at, now()),
          updated_at = now()
      where org_id = p_org and id = any(v_people);
    get diagnostics v_n = row_count;
    v_result := v_result || jsonb_build_object('people', v_n);
  end if;

  -- The audit row records the hash, never the address. An erasure log that
  -- kept the address would be the one place the deleted data survived, which
  -- is a compliance failure wearing a compliance feature's clothes.
  insert into public.audit_logs (org_id, actor_id, action, target_type, target_id, meta)
  values (p_org, p_actor, 'contact.erased', 'contact', null,
          jsonb_build_object('hash', v_hash, 'result', v_result));

  return v_result;
end;
$$;

-- ── Retention sweep ───────────────────────────────────────────────────────
--
-- Enqueued by the scheduler for orgs that have set a policy. Deliberately
-- narrow: it removes contact *points* and enrichment for people with no
-- outreach history, and does not touch companies, opportunities or anything a
-- person authored. An automatic delete that removed a customer's pipeline
-- would be a catastrophe caused by a feature they turned on to be careful.

create or replace function public.prune_stale_contacts(p_org uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_days    integer;
  v_removed integer := 0;
begin
  select contact_retention_days into v_days from public.organizations where id = p_org;
  if v_days is null then return 0; end if;

  delete from public.contact_points cp
  where cp.org_id = p_org
    and cp.created_at < now() - make_interval(days => v_days)
    and not exists (
      select 1 from public.messages m
      where m.org_id = p_org and lower(m.to_email) = lower(cp.value)
    )
    and not exists (
      select 1 from public.opportunities o
      join public.people pe on pe.id = o.primary_person_id
      where o.org_id = p_org and pe.id = cp.person_id and o.deleted_at is null
    );

  get diagnostics v_removed = row_count;
  return v_removed;
end;
$$;

-- ── Export ────────────────────────────────────────────────────────────────
--
-- Everything held about one address, as one JSON document. A function rather
-- than a query in the application because the list of places a contact
-- appears is a property of the schema and will drift the moment it is
-- maintained anywhere else.

create or replace function public.export_contact(p_org uuid, p_email text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select jsonb_build_object(
    'email', lower(trim(p_email)),
    'exportedAt', now(),
    'people', coalesce((
      select jsonb_agg(to_jsonb(pe) - 'org_id')
      from public.people pe
      join public.contact_points cp on cp.person_id = pe.id
      where cp.org_id = p_org and cp.kind = 'email' and lower(cp.value) = lower(trim(p_email))
    ), '[]'::jsonb),
    'contactPoints', coalesce((
      select jsonb_agg(to_jsonb(cp) - 'org_id')
      from public.contact_points cp
      where cp.org_id = p_org and cp.kind = 'email' and lower(cp.value) = lower(trim(p_email))
    ), '[]'::jsonb),
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'direction', m.direction, 'subject', m.subject,
        'sentAt', m.sent_at, 'createdAt', m.created_at
      ))
      from public.messages m
      where m.org_id = p_org and lower(m.to_email) = lower(trim(p_email))
    ), '[]'::jsonb),
    'enrichment', coalesce((
      select jsonb_agg(jsonb_build_object(
        'provider', er.provider, 'field', er.field, 'fetchedAt', er.fetched_at
      ))
      from public.enrichment_records er
      join public.contact_points cp2 on cp2.person_id = er.entity_id
      where er.org_id = p_org and er.entity_type = 'person'
        and cp2.kind = 'email' and lower(cp2.value) = lower(trim(p_email))
    ), '[]'::jsonb),
    'suppressed', public.is_suppressed(p_org, lower(trim(p_email))),
    'frequency', coalesce((
      select to_jsonb(f) - 'org_id' from public.contact_frequency f
      where f.org_id = p_org and f.email = lower(trim(p_email))
    ), 'null'::jsonb)
  );
$$;

-- ── RLS ───────────────────────────────────────────────────────────────────

alter table public.contact_frequency enable row level security;

create policy tenant_read on public.contact_frequency
  for select using (org_id in (select public.user_org_ids()));
create policy tenant_write on public.contact_frequency
  for all
  using (public.has_org_role(org_id, 'member'))
  with check (public.has_org_role(org_id, 'member'));

create trigger contact_frequency_touch before update on public.contact_frequency
  for each row execute function public.touch_updated_at();

-- ── Lockdown ──────────────────────────────────────────────────────────────
--
-- `erase_contact` is destructive and irreversible, so it is admin-gated
-- through a wrapper and service-role otherwise. The rest are engine
-- functions.

create or replace function public.erase_contact_for_org(p_org uuid, p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if not public.has_org_role(p_org, 'admin') then
    raise exception 'erase_contact_for_org: not an admin of %', p_org;
  end if;
  return public.erase_contact(p_org, p_email, auth.uid());
end;
$$;

do $$
begin
  revoke execute on function
    public.can_contact(uuid, text),
    public.record_contact_send(uuid, text),
    public.record_contact_reply(uuid, text),
    public.erase_contact(uuid, text, uuid),
    public.prune_stale_contacts(uuid),
    public.export_contact(uuid, text)
  from public, anon, authenticated;

  grant execute on function
    public.can_contact(uuid, text),
    public.record_contact_send(uuid, text),
    public.record_contact_reply(uuid, text),
    public.erase_contact(uuid, text, uuid),
    public.prune_stale_contacts(uuid),
    public.export_contact(uuid, text)
  to service_role;
exception when undefined_object or undefined_function then null;
end $$;
