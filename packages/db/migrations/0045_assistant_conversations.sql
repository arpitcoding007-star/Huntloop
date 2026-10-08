-- 0045 — several saved Ask Huntloop conversations, each with an optional
-- product focus. COMMAND.md §9.5, §16.3-L (L10).
--
-- 0041 kept the workspace assistant to one conversation per person, enforced
-- by a partial unique index. People keep separate threads for separate jobs
-- ("this week's pipeline", "pricing objections"), so the index goes and the
-- assistant lists a person's conversations instead. Still personal: the
-- `conversation_owner` policy from 0004 is unchanged, so nobody reads a
-- colleague's threads.
--
-- `product_id` narrows a conversation to one product's opportunities — the
-- one-assistant answer to "a co-pilot per product" (§16.6 rejects the
-- per-product assistants). `on delete set null`: removing a product turns its
-- conversations back into whole-workspace ones rather than deleting them.

drop index if exists public.conversations_workspace_idx;

alter table public.conversations
  add column if not exists product_id uuid references public.products(id) on delete set null;

-- The list on the assistant page: a person's conversations, newest first.
create index if not exists conversations_workspace_recent_idx
  on public.conversations (org_id, user_id, last_message_at desc nulls last)
  where scope = 'workspace' and deleted_at is null;

-- A probe for `db:doctor` (see 0031).
create or replace function public.migration_0045_applied()
returns boolean
language sql
immutable
set search_path = public, pg_catalog
as $$ select true $$;
