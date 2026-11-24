# Exchange moderation: reports, removals and suspensions

Migrations `0065_exchange_trust.sql` and `0066_exchange_audit_fixes.sql`. People report things from the Exchange screens. The operator works the queue in the Supabase SQL editor, with the service role, the same way as the [kill switch](kill-switch.md). There is no in-app admin screen, so no account in the app can moderate. Every decision goes into the audit log of the workspace that reported and the workspace that was reported.

## What can be reported, and by whom

| Subject | Who can report it |
|---|---|
| `need` (a buyer's request) | A supplier that was shown it as a card (level 2 or above), or is in an introduction about it |
| `offering`, `provider` | A buyer that was matched with it |
| `intro`, `message` | Either side of the introduction |

Each reporter can have one open report per subject, and each person can file 10 reports a day. A workspace reads back what it filed through `exchange_my_reports`; the table itself is closed to sessions, because it names the workspace behind an anonymous request. A reporter never learns what was decided, and the reported workspace is never told who reported it.

## Policy switches

Two rules are built and off, because their decisions are open (EX-4, EX-10). Review `exchange_categories.regulated` first: the seeded list includes GPUs and accounting.

```sql
-- Opening a request to introductions needs a confirmed company address.
update exchange_policy set require_company_address = true;
-- A regulated category shows no anonymous card; existing ones become counted only.
update exchange_policy set regulated_hides_anonymous_cards = true;
```

## Read the queue

```sql
select * from public.exchange_report_queue();
```

The queue shows the most-reported workspaces first. `open_reports_on_org` and `distinct_reporters_on_org` show how many reports a workspace has, and from how many different reporters. `subject_type` and `subject_id` say what was reported. To see the actual content:

```sql
select summary, requirement, visibility, status from exchange_needs where id = '<subject_id>';
select title, description, status from exchange_offerings where id = '<subject_id>';
select body, sender_side, created_at from exchange_messages where id = '<subject_id>';
```

## Decide

One call per report. A report can be decided only once.

```sql
-- Nothing wrong.
select public.exchange_resolve_report('<report id>', 'dismiss', 'Genuine request');

-- Take down what was reported. An offering or a provider's offerings → paused;
-- a request → withdrawn and made private; a message → deleted;
-- an introduction → closed.
select public.exchange_resolve_report('<report id>', 'remove', 'Off-platform solicitation');

-- Put the reported workspace out of the Exchange.
select public.exchange_resolve_report('<report id>', 'suspend', 'Repeated fake requests');
```

The text of the `suspend` note is shown to the suspended workspace on every Exchange page, so write it for them to read.

## What a suspension does

The database enforces a suspension, so no screen can get around it.

- No new introductions or messages to or from the workspace. Introductions that already exist stay readable.
- Its requests are no longer shown to suppliers as cards, and are not counted in market demand.
- Its offerings drop out of matching.
- It gets no Exchange notifications, and suppliers get no alerts about its requests.

Nothing is deleted. Lifting a suspension restores everything:

```sql
select public.exchange_lift_suspension('<org id>');
```

To suspend a workspace without a report (for example, from a complaint by email):

```sql
insert into exchange_suspensions (org_id, reason) values ('<org id>', 'Reason shown to the workspace');
```

## Limits that apply without anyone acting

- A request needs a confirmed email address. A workspace can file at most 10 requests a day.
- A supplier can ask for at most 20 introductions a week. New requests are paused when more than 70% of at least 10 recent ones were declined (0063).
- Market demand shows a group only when at least 10 requests from confirmed, non-suspended buyers share it.

## Check that sessions cannot run the engine's functions

`npm run db:doctor` does this once 0066 is applied, and fails on any exposed function. By hand, in the SQL editor (before 0066 too):

```sql
select p.oid::regprocedure as function, r.rolname as role
  from pg_proc p
 cross join pg_roles r
 where p.pronamespace = 'public'::regnamespace
   and r.rolname in ('anon', 'authenticated')
   and p.proname in (
     'exchange_prune', 'exchange_expire', 'exchange_recall_offerings',
     'exchange_queue_notifications', 'exchange_prune_notifications',
     'exchange_need_recipients', 'exchange_intro_side', 'exchange_audit_intro',
     'exchange_report_queue', 'exchange_resolve_report', 'exchange_lift_suspension',
     'exchange_suspended', 'exchange_demand_k', 'write_audit_log_internal',
     'increment_usage_internal', 'check_quota_internal', 'claim_job_executions',
     'prune_job_executions', 'requeue_stalled_jobs')
   and has_function_privilege(r.oid, p.oid, 'execute');
```

No rows means nothing is exposed. The functions also refuse a signed-in caller themselves, so a grant left behind is not on its own a way in.

## Metrics

```sql
select * from public.exchange_metrics(30);
```

`value` is null when there is nothing to divide by. `of_total` is how many rows the value rests on: read a rate from fewer than 20 as an anecdote.
