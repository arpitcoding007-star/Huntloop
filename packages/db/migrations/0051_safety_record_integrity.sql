-- 0051 — safety records a member cannot undo (pass 16, DB-201).
--
-- 0003 and 0004 gave `people`, `opportunities`, `enrollments`, `messages` and
-- `suppressions` one generic `tenant_write FOR ALL` policy at member level.
-- The tenant boundary held; inside a tenant, any member acting through
-- PostgREST directly (no UI path does this) could:
--
--   * delete a suppression, after which `can_contact` allows the address
--     again: a send after an unsubscribe;
--   * set `messages.approved_by` to any user id, so the audit trail names a
--     person who never approved the email;
--   * mark a message sent, or clear the claim that makes a send at-most-once;
--   * hard-delete an opportunity, which skips 0049's soft-delete trigger and
--     leaves its scheduled mail for `schedule_sends` to pick up.
--
-- None of this changes what the application does. The inventory at pass 16:
-- no session code deletes from these five tables, nothing in the app writes
-- `suppressions` (the writers are `record_unsubscribe`, bounce handling and
-- `erase_contact`, all service role or SECURITY DEFINER), and every session
-- write to `messages` sets approver fields to the caller.
--
-- Sessions are told apart from the engine the same way 0049's
-- `guard_mailbox_safety` does: `current_user`. The service role, SECURITY
-- DEFINER functions and referential actions run as other roles.

-- ── Suppressions: sessions may add, never remove or rewrite ─────────────────
drop policy if exists tenant_write on public.suppressions;
drop policy if exists tenant_insert on public.suppressions;
create policy tenant_insert on public.suppressions
  for insert with check (public.has_org_role(org_id, 'member'));

-- ── No session hard deletes: the app only ever soft-deletes these ──────────
-- As 0031 did for `companies`. A hard delete cascades past the audit log and
-- past every trigger that stops outreach on a soft delete.
do $$
declare t text;
begin
  foreach t in array array['people', 'opportunities', 'enrollments', 'messages']
  loop
    execute format('drop policy if exists tenant_write on public.%1$I', t);
    execute format('drop policy if exists tenant_insert on public.%1$I', t);
    execute format('drop policy if exists tenant_update on public.%1$I', t);
    execute format($f$
      create policy tenant_insert on public.%1$I
        for insert with check (public.has_org_role(org_id, 'member'));
      create policy tenant_update on public.%1$I
        for update
        using (public.has_org_role(org_id, 'member'))
        with check (public.has_org_role(org_id, 'member'));
    $f$, t);
  end loop;
end
$$;

-- ── Messages: the send record and the approver are the engine's and yours ──
--
-- A session may:
--   * write approved_by / rejected_by / edited_by only as itself (or clear
--     them on a message that has not been sent);
--   * never write sent_at, send_attempted_at, provider_message_id or
--     message_id_header, which only a real send produces;
--   * never insert an inbound message, which would look like a reply and stop
--     a sequence or train the classifier;
--   * change nothing at all on a message whose send was claimed, because that
--     row is the record of an email that may already be in someone's inbox;
--   * schedule a message only by approving it as itself, and rewrite an
--     approved message's words or recipient only by withdrawing the approval
--     in the same change (pass 17, SEC-301).
create or replace function public.guard_message_integrity()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_me uuid := auth.uid();
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.direction is distinct from 'outbound' then
      raise exception 'Inbound messages are recorded by mailbox sync, not by a session.'
        using errcode = '42501';
    end if;
    if new.sent_at is not null or new.send_attempted_at is not null
       or new.provider_message_id is not null or new.message_id_header is not null then
      raise exception 'A message is marked sent by the send, not by a session.'
        using errcode = '42501';
    end if;
    if (new.approved_by is not null and new.approved_by is distinct from v_me)
       or (new.rejected_by is not null and new.rejected_by is distinct from v_me)
       or (new.edited_by is not null and new.edited_by is distinct from v_me) then
      raise exception 'A message can only be approved, rejected or edited as yourself.'
        using errcode = '42501';
    end if;
    -- SEC-301: a message written ready to send (a reply typed in the inbox)
    -- is approved by the person who wrote it, on the row.
    if new.scheduled_at is not null and new.approved_by is distinct from v_me then
      raise exception 'A message is scheduled to send only by approving it as yourself.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- UPDATE
  if old.sent_at is not null or old.send_attempted_at is not null then
    raise exception 'A message that was sent, or whose send began, is a record and cannot be changed.'
      using errcode = '42501';
  end if;
  if new.sent_at is distinct from old.sent_at
     or new.send_attempted_at is distinct from old.send_attempted_at
     or new.provider_message_id is distinct from old.provider_message_id
     or new.message_id_header is distinct from old.message_id_header
     or new.direction is distinct from old.direction then
    raise exception 'A message is marked sent by the send, not by a session.'
      using errcode = '42501';
  end if;
  if (new.approved_by is distinct from old.approved_by and new.approved_by is not null and new.approved_by is distinct from v_me)
     or (new.rejected_by is distinct from old.rejected_by and new.rejected_by is not null and new.rejected_by is distinct from v_me)
     or (new.edited_by is distinct from old.edited_by and new.edited_by is not null and new.edited_by is distinct from v_me) then
    raise exception 'A message can only be approved, rejected or edited as yourself.'
      using errcode = '42501';
  end if;

  -- SEC-301: approval is the act, not the column. Guarding only the approver
  -- columns left two ways round it: schedule a draft with nobody named as
  -- approver, or rewrite an approved message so it leaves under somebody
  -- else's approval with words or a recipient they never saw.
  if old.scheduled_at is null and new.scheduled_at is not null
     and new.approved_by is distinct from v_me then
    raise exception 'A message is scheduled to send only by approving it as yourself.'
      using errcode = '42501';
  end if;
  if old.scheduled_at is not null
     and (new.subject is distinct from old.subject
          or new.body_text is distinct from old.body_text
          or new.body_html is distinct from old.body_html
          or new.to_email is distinct from old.to_email)
     and (new.scheduled_at is not null or new.approved_by is not null) then
    raise exception 'An approved message cannot be rewritten. Withdraw the approval (clear scheduled_at and approved_by) in the same change, then approve it again.'
      using errcode = '42501';
  end if;
  return new;
end
$$;

drop trigger if exists messages_guard_integrity on public.messages;
create trigger messages_guard_integrity
  before insert or update on public.messages
  for each row execute function public.guard_message_integrity();

revoke execute on function public.guard_message_integrity() from public;

-- ── Enrollment status is one of four (DB-202, the part DB-201 depends on) ──
-- `send_message` (OUT-201) reads this column to decide whether mail may go,
-- so an invented value must not be writable. NOT VALID first so a database
-- holding an unexpected legacy value still migrates; validated when it can be.
alter table public.enrollments drop constraint if exists enrollments_status_check;
alter table public.enrollments
  add constraint enrollments_status_check
  check (status in ('active', 'paused', 'parked', 'stopped')) not valid;
do $$
begin
  alter table public.enrollments validate constraint enrollments_status_check;
exception when check_violation then
  raise notice 'enrollments_status_check left NOT VALID: existing rows hold other values. New writes are checked.';
end $$;

-- A probe for `db:doctor` (see 0031).
create or replace function public.migration_0051_applied()
returns boolean
language sql
immutable
set search_path = public, pg_catalog
as $$ select true $$;
