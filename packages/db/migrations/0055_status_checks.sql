-- 0055 — the remaining status columns get CHECKs (pass 16, DB-202).
--
-- `enrollments.status` got its CHECK in 0051. Five more status columns were
-- free `text`, so a typo or a direct write could create a state no code path
-- ever leaves (a job `'done'` is never claimed, retried or shown as failed).
-- Each list below is every value the code writes or reads, taken from:
--
--   mailboxes.status        connected (OAuth callback), disconnected
--                           (`disconnectMailboxAction`, `mailbox/index.ts`)
--   job_executions.status   queued, running, succeeded, failed (`queue.ts`),
--                           cancelled (`cancel_job`, 0019)
--   campaigns.status        draft, active, paused, archived (`campaignSchema`)
--   threads.status          open, snoozed, closed (`threadStatusSchema`)
--   threads.classification  the seven `REPLY_CLASSES` of `classify_reply`, or
--                           null while unclassified
--   ai_runs.status          started, succeeded, failed (both run recorders)
--
-- ── Why NOT VALID, then a validate that may fail softly ──────────────────
--
-- `not valid` makes the rule apply to every write from now on without
-- scanning the table. The `validate` then checks the existing rows. If a
-- production row already holds a value outside the list, the validate fails
-- with a notice instead of aborting the whole migration: new writes are still
-- protected, and the notice names the column so the odd rows can be fixed and
-- the constraint validated by hand. On a clean database every constraint ends
-- up validated.
--
-- A new status value now needs a migration. That is the point: a state the
-- code can enter must be one some code path also knows how to leave.

do $$
declare
  c record;
begin
  for c in
    select * from (values
      ('mailboxes',      'mailboxes_status_check',
         $c$status in ('connected', 'disconnected')$c$),
      ('job_executions', 'job_executions_status_check',
         $c$status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')$c$),
      ('campaigns',      'campaigns_status_check',
         $c$status in ('draft', 'active', 'paused', 'archived')$c$),
      ('threads',        'threads_status_check',
         $c$status in ('open', 'snoozed', 'closed')$c$),
      ('threads',        'threads_classification_check',
         $c$classification is null or classification in
            ('positive', 'neutral', 'negative', 'unsubscribe', 'out_of_office', 'bounce', 'wrong_person')$c$),
      ('ai_runs',        'ai_runs_status_check',
         $c$status in ('started', 'succeeded', 'failed')$c$)
    ) as t(tbl, name, expr)
  loop
    if not exists (
      select 1 from pg_constraint
       where conname = c.name and conrelid = format('public.%I', c.tbl)::regclass
    ) then
      execute format('alter table public.%I add constraint %I check (%s) not valid', c.tbl, c.name, c.expr);
    end if;

    begin
      execute format('alter table public.%I validate constraint %I', c.tbl, c.name);
    exception when check_violation then
      raise notice '0055: %.% has rows outside the allowed values; new writes are checked, existing rows are not. Fix them, then: alter table public.% validate constraint %;',
        c.tbl, c.name, c.tbl, c.name;
    end;
  end loop;
end $$;

-- A probe for `db:doctor` (see 0031).
create or replace function public.migration_0055_applied()
returns boolean
language sql
immutable
set search_path = public, pg_catalog
as $$ select true $$;
