-- 0035 — one outbound message per enrollment step.
--
-- ── OUT-002 ──────────────────────────────────────────────────────────────
--
-- `advance_enrollments` drafts a step's message and then, in a separate
-- write, moves the enrollment to the next step. A run killed between the two
-- (the function limit, a failed update) left the enrollment due at the same
-- step, and the next run drafted it again — a duplicate draft for a person to
-- approve, or at autonomy 2 and above a second email, since the new message
-- has a new id and a new send key.
--
-- Made a database guarantee rather than a handler convention: a step can have
-- one live outbound message per enrollment. The handler treats the conflict
-- as "already drafted", finds that message, and advances.

create unique index if not exists messages_one_per_enrollment_step
  on public.messages (enrollment_id, step_id)
  where direction = 'outbound'
    and enrollment_id is not null
    and step_id is not null
    and deleted_at is null;

-- A probe for `db:doctor` (see 0031).
create or replace function public.migration_0035_applied()
returns boolean
language sql
immutable
set search_path = public, pg_catalog
as $$ select true $$;
