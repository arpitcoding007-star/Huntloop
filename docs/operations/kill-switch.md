# Kill switch: pausing sends, model calls or provider spend

Migration `0053_platform_pauses.sql`. One row stops one kind of work, for one workspace or for all of them. It takes effect on the next send or call, with **no deploy**.

| Scope | What stops | What the user sees |
|---|---|---|
| `sends` | `send_message` defers every message 15 minutes at a time. Nothing leaves; nothing is lost | Inbox: "Waiting to send · Sending is paused by an operator: <reason>" |
| `ai` | Every model call: jobs (`runForOrg`), the app (`resolveRecorder`), and anonymous `/discover` research (global pauses only) | The action's error: "Model calls are paused by an operator: <reason>" |
| `providers` | Every paid vendor call (Apollo, Hunter, ZeroBounce). Cached answers are still served, since they cost nothing | The calling job records a `paused` refusal; ledger row with 0 credits |

Other jobs (discovery bookkeeping, syncs, retention) keep running. To stop **everything**, the old lever still works: unset `CRON_SECRET` in Vercel and redeploy, or disable `tick.yml`.

## Pause

Supabase → SQL editor (service role):

```sql
-- Every workspace
insert into platform_pauses (scope, reason) values ('sends', 'Bounce spike on 2026-11-20, investigating');

-- One workspace
insert into platform_pauses (scope, org_id, reason)
select 'ai', id, 'Runaway model spend' from organizations where slug = 'acme';
```

`reason` is required and is shown to the people waiting, so write it for them.

## See what is paused

```sql
select id, scope, org_id, reason, created_at from platform_pauses where lifted_at is null;
```

## Lift

```sql
update platform_pauses set lifted_at = now() where id = '<id>';
```

Deferred sends go out on the next tick after their 15-minute wait. Nothing has to be re-queued.

## Behaviour when the switch cannot be read

- **Sends:** they wait (fail closed). A send that should not have gone cannot be taken back.
- **Model and provider calls:** they proceed (fail open), the same documented posture as the AI and provider budgets. A housekeeping read failing must not stop the product.
- **Before 0053 is applied:** nothing can be paused, and the engine logs `platform_paused is missing` once per process.
