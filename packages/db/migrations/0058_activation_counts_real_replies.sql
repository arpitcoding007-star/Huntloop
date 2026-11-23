-- ============================================================================
-- 0058 — "Is the loop working?" counts replies, not inbound mail (PANEL-313)
--
-- 0054's `org_activation` took `first_reply_at` and `replies_30d` from every
-- `messages` row with `direction = 'inbound'`. `sync_mailbox` stores inbound
-- mail it cannot match to a thread too (`thread_id` null): newsletters,
-- out-of-office notices, bounces. So a workspace could show a reply rate over
-- 100%, and the panel disagreed with the Performance funnel.
--
-- A reply is what `sync_mailbox` records as one: an `outcomes` row of kind
-- 'reply' or 'positive' (written once per matched, classified reply). The
-- same source the learning loop and Performance read.
--
-- Also: `drafts_rejected_30d` now filters on `ai_generated`, as its
-- denominator `drafts_30d` does, so the ratio compares like with like.
--
-- Same columns, same order and types: `create or replace view` keeps every
-- grant and the `security_invoker` setting below is re-asserted anyway.
-- ============================================================================

create or replace view public.org_activation as
select
  o.id                       as org_id,
  o.slug,
  o.created_at               as signed_up_at,
  o.onboarding_completed_at,
  (select min(s.computed_at)
     from public.opportunity_scores s
     join public.opportunities op on op.id = s.opportunity_id
    where s.org_id = o.id
      and op.priority in ('hot', 'warm')
      and op.deleted_at is null)                        as first_warm_at,
  (select min(m.sent_at)
     from public.messages m
    where m.org_id = o.id and m.direction = 'outbound'
      and m.sent_at is not null and m.deleted_at is null) as first_send_at,
  (select min(x.occurred_at)
     from public.outcomes x
    where x.org_id = o.id
      and x.kind in ('reply', 'positive'))              as first_reply_at,
  (select min(x.occurred_at)
     from public.outcomes x
    where x.org_id = o.id and x.kind = 'meeting')       as first_meeting_at,
  (select count(*)
     from public.messages m
    where m.org_id = o.id and m.direction = 'outbound'
      and m.sent_at > now() - interval '30 days'
      and m.deleted_at is null)                         as sent_30d,
  (select count(*)
     from public.outcomes x
    where x.org_id = o.id
      and x.kind in ('reply', 'positive')
      and x.occurred_at > now() - interval '30 days')   as replies_30d,
  (select count(*)
     from public.messages m
    where m.org_id = o.id and m.direction = 'outbound'
      and m.ai_generated
      and m.created_at > now() - interval '30 days')    as drafts_30d,
  (select count(*)
     from public.messages m
    where m.org_id = o.id and m.direction = 'outbound'
      and m.ai_generated
      and m.rejected_by is not null
      and m.created_at > now() - interval '30 days')    as drafts_rejected_30d,
  (select count(*)
     from public.outcomes x
    where x.org_id = o.id and x.kind = 'meeting'
      and x.occurred_at > now() - interval '30 days')   as meetings_30d
from public.organizations o
where o.deleted_at is null;

alter view public.org_activation set (security_invoker = true);

comment on view public.org_activation is
  'ANL-301, PANEL-313. One row per workspace: when each step of the loop first '
  'happened (warm opportunity, send, reply, meeting) and 30-day counts. A reply '
  'is an outcomes row of kind reply/positive, not any inbound mail. Activation '
  'is first_send_at within 7 days of signed_up_at. security_invoker, so a '
  'session sees only its own workspaces.';

do $$
begin
  revoke all on public.org_activation from anon;
  grant select on public.org_activation to authenticated, service_role;
exception when undefined_object then null;
end
$$;

-- A probe for `db:doctor` (see 0031).
create or replace function public.migration_0058_applied()
returns boolean
language sql
immutable
set search_path = public, pg_catalog
as $$ select true $$;
