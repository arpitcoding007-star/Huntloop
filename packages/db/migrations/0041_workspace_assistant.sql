-- 0041 — the workspace assistant's conversations. COMMAND.md §16.3-G (P4).
--
-- `conversations` was one thread per (opportunity, person). The assistant
-- talks about the whole workspace, so a conversation now has a scope:
--
--   opportunity  the existing per-opportunity agent; needs an opportunity
--   workspace    the assistant; has none, and there is one per person
--
-- An assistant answer cites typed references (`opportunity:<id>`,
-- `metric:<id>`, …) rather than evidence ids, and may propose actions a person
-- can take. Both are kept with the message so a replayed conversation shows
-- what each answer rested on and offered — and so it is plain afterwards that
-- an action was only ever proposed.

alter table public.conversations
  add column if not exists scope text not null default 'opportunity'
    check (scope in ('opportunity', 'workspace'));

alter table public.conversations
  alter column opportunity_id drop not null;

alter table public.conversations
  drop constraint if exists conversations_scope_subject;
alter table public.conversations
  add constraint conversations_scope_subject
    check ((scope = 'opportunity') = (opportunity_id is not null));

-- One workspace conversation per person per workspace. The existing
-- (org_id, opportunity_id, user_id) unique constraint still governs the
-- opportunity scope; NULLs are distinct there, so this index is what keeps
-- the workspace scope single.
create unique index if not exists conversations_workspace_idx
  on public.conversations (org_id, user_id)
  where scope = 'workspace' and deleted_at is null;

alter table public.conversation_messages
  add column if not exists citations jsonb not null default '[]'::jsonb,
  add column if not exists actions   jsonb not null default '[]'::jsonb;

-- A probe for `db:doctor` (see 0031).
create or replace function public.migration_0041_applied()
returns boolean
language sql
immutable
set search_path = public, pg_catalog
as $$ select true $$;
