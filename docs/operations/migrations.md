---
description: How schema changes are written, applied and verified — and the biggest operational risk in the project.
---

# Migrations

> **Layer:** Internal · **Audience:** operations, engineering

{% hint style="danger" %}
**Migrations are applied to hosted projects by hand, in the Supabase SQL
editor.** There is no automated step, no `schema_migrations` ledger, and
therefore no fact of the matter about what has run — only a belief.

This is the **largest operational risk in the project.** Automating it is the
highest-value infrastructure work available.
{% endhint %}

## The rules

### 1. Numbered, ordered, never edited once applied anywhere

Add `0029_…` rather than changing `0028_…`, **even if `0028` is a day old.** A
migration that has run somewhere and then changes is a schema that differs per
environment with nothing detecting it.

### 2. Every migration runs against PGlite in `npm test`

If it needs an extension PGlite does not have, guard it the way
`0006_prune_schedule.sql` does, and **say plainly in the file which half is
therefore unverified.**

### 3. Add a probe to `db:doctor`

When you add a migration, add its probe to the list in
`packages/db/scripts/doctor.ts`.

{% hint style="info" %}
**Pick the *last* object the file creates**, so a half-run file reports as
missing rather than as applied. A migration half-pasted into the SQL editor is
a real and common failure.
{% endhint %}

### 4. Comment the table, add CHECKs, enable RLS, write both policies

A new tenant table with no `select` policy is invisible; with no `with check`
on its write policy it is writable cross-tenant. Both halves, every time.

### 5. Add assertions to `verify-migrations.ts`

The migration suite is 236 checks because each migration added its own. A
constraint with no test is a constraint the next refactor removes silently.

## Applying them

```bash
# 1. What has this project ACTUALLY had applied?
npm run db:doctor

# 2. Paste the missing files, in order, into the Supabase SQL editor.
#    COMBINED-0024-0027.sql exists so four can go in one paste.

# 3. Confirm.
npm run db:doctor      # exits 1 when anything is missing
```

`db:doctor` infers state from **what each file creates**, which is less precise
than a ledger and needs no privileges the app does not already have. Its exit
code is 1 when anything is missing, so it can gate a deploy script.

## Why `db:doctor` exists

The app's own probe checks **one table** — `organizations` — which is the right
check for "is this a fresh project or a migrated one?" and the **wrong** check
for "is the schema complete".

{% hint style="warning" %}
That difference is not hypothetical. This project was found with `0001`–`0004`
applied and `0005` missing. It reported as fully live on every screen while
**every model call refused**, because `consume_rate_limit()` did not exist.
{% endhint %}

## `DATABASE_URL`

The Supabase publishable and secret keys talk to the web API, which reads and
writes rows and **cannot change the schema**. `DATABASE_URL` is the only
credential that can `CREATE TABLE`.

Setting it would allow scripted migrations. It is also what `EXPLAIN ANALYZE`
needs — PostgREST will not return a query plan, so query-plan work cannot start
until it is set.

Use the **Transaction pooler** connection string for serverless.

## Seeding

```bash
npm run db:seed
npm run db:seed -- --reset
```

A development tool, not a fixture loader — the unit suites run against PGlite
and stay self-contained.

It runs on the **service-role client, which bypasses RLS entirely**, so being
scoped to the organisation it names is the only thing preventing it from
reaching another tenant. Keep it idempotent and keep it scoped.

{% hint style="info" %}
**Add rows that exercise a state the interface must distinguish, not rows that
look impressive.** The seed's third company has no buyer and three unmeasured
score dimensions precisely because a dataset where every column is populated
proves nothing about the `NULL` path — which is the one that ships.
{% endhint %}

## Schema drift

`packages/db/src/types.ts` is maintained **by hand**. There is no automated
drift check in CI.

`docs/OPERATIONS.md` (DB-03) describes generating row types from the live
project and diffing them against `types.ts`. Doing that on a schedule is
straightforward once `DATABASE_URL` is set.

## Rollback

There is none, and the schema is written to make that acceptable: every
migration is **additive**. A Vercel instant-rollback runs older application code
against a newer schema, which works because nothing is dropped or renamed.

{% hint style="warning" %}
This is a property to **preserve deliberately**, not one to rely on blindly. A
migration that drops a column or narrows a `CHECK` breaks it, and nothing in CI
will tell you.
{% endhint %}

## The 28 migrations

See [Database — migration history](../architecture/database.md#migration-history)
for what each one added.

## Related

* [Database](../architecture/database.md)
* [Deployment](deployment.md)
* [Operations runbook](../OPERATIONS.md)
