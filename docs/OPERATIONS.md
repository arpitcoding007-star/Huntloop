# Operations

Deployment, backup, recovery, schema drift, and the API-surface decision.
Written because each of these is cheap to decide now and expensive to discover
later.

Most of this describes hosted services — a Supabase project and two Vercel
projects — that only their owner can change from a dashboard. Every claim below
is therefore marked with whether it has been **checked** or is **assumed**, and
the assumed ones are the work, not the document.

---

## DB-05 · Which migrations are applied

**Applied by hand, one file at a time, in the Supabase SQL editor.** There is
no migration runner and therefore no `schema_migrations` ledger to consult,
which means "is this project up to date?" has no direct answer.

```bash
npm run db:doctor
```

infers it from what each migration creates — one representative object per
file, chosen as the *last* thing that file makes so a half-run file reports as
missing rather than as applied. Exits non-zero when anything is absent.

**Why it exists.** The app's own probe, `isSchemaApplied()`, checks a single
table (`organizations`) and answers the question *it* needs: fresh project, or
migrated one? For a project with `0001`–`0004` applied it answers "migrated",
every screen renders live rows, and nothing indicates that
`consume_rate_limit()` is missing until a model call fails. That was the state
this repository's configured project was found in — see `DB-04` in
[audit/FINDINGS.md](../audit/FINDINGS.md).

**`0006` is invisible to it**, and cannot be otherwise. It creates no table and
no function; it schedules `prune_rate_limits()` with `pg_cron`, and `cron.job`
is not reachable through PostgREST. The check is `select * from cron.job` in
the SQL editor, and it is the only place that half of the migration is ever
confirmed — the test suite runs against PGlite, which has no `pg_cron` at all.

**Before pointing this repo at a different project**, run `db:doctor` against
it first. It lists what is already there, which is the check `SETUP.md` step 1
asks for in prose.

---

## OPS-03 · Vercel projects, and the one that has never built

**Two Vercel projects deploy this repository.** Both fire on every push to
`main`, both are named "Production", and they have behaved differently since
the first commit:

| Project | Root Directory | Every deployment since | State |
|---|---|---|---|
| `huntloop-web` | `apps/web` (inferred) | `df679d6`, 2026-08-12 | **succeeds** |
| `huntloop` | repository root (inferred) | `e55c196`, the initial scaffold | **fails, every time** |

`huntloop` has never produced a successful deployment. Not a regression — it
has never worked, and the failures were invisible because the project that
serves the app is the other one.

### Why the root-rooted project cannot build

Vercel detects a framework by reading `package.json` **in the project's Root
Directory**. In this repository those two files are deliberately different:

```
package.json            workspaces + scripts, and NO dependencies at all
apps/web/package.json   "next": "^16.3.1"
```

So a project rooted at the repository root sees no `next`, detects no
framework, falls back to "Other", and then looks for a static output directory
— `public/` by default, which does not exist here either.

There is no `vercel.json` anywhere to correct any of that, so both projects run
entirely on dashboard settings that nothing in this repository can see or
review. One did exist briefly, declaring the `/api/jobs/tick` cron; it was
removed for a reason unrelated to this section, and "What drives the tick"
below has that story. Note that it would not have helped here either way — a
`vercel.json` is read from the project's Root Directory, so `apps/web/vercel.json`
reaches `huntloop-web` and is invisible to `huntloop`.

That is the whole failure, and it is a settings problem rather than a code one.
Nothing in the build is broken: `npm run verify` builds all 21 routes.

### The fix

Pick one. Both are dashboard actions; neither can be done from this repository.

**A — delete `huntloop` (recommended).** It is a duplicate that has never
served anything. Before deleting, check on that project's settings page:

- **Domains.** If a custom domain is attached to `huntloop` rather than to
  `huntloop-web`, move it first — deleting takes the domain with it.
- **Environment variables.** `huntloop-web` needs its own copy of every
  variable; do not assume they were set on both.

**B — repoint it.** Project Settings → General → **Root Directory** →
`apps/web` → Save. It will then build, and you will have two production
projects deploying the same commit to two URLs, which is worth wanting only if
one of them is a staging target.

### Why there is no `vercel.json` fixing this

Tempting, and deliberately not done. A root-level `vercel.json` with a
`buildCommand` and `outputDirectory` pointing into `apps/web` is the obvious
move, and it is not a supported path for a fully dynamic Next.js app: every
route here is server-rendered on demand and there is a proxy, and Vercel's
Next.js builder expects to run against the app's own directory. The plausible
outcome is not a fixed deployment but a **green build that serves a broken
app**, which is worse than the honest failure — and it would be committed
against a build nobody had run.

Root Directory is the mechanism Vercel provides for this. Use it.

### If you set the Root Directory, pin the rest

Once a project is rooted at `apps/web`, its build config can move into the
repository as `apps/web/vercel.json` — which is where it belongs, given that
two dashboards silently disagreeing is what produced this. One caution that
must not be got wrong: **do not pin `installCommand`.** This is an npm
workspace monorepo, `@huntloop/ui`, `@huntloop/db` and `@huntloop/ai` resolve
only from the repository root, and Vercel already installs from the root when
the Root Directory is a workspace package. Pinning `npm install` would make it
run inside `apps/web` and break the build that currently works.

---


---

## What drives the tick, and why no cron is committed

`/api/jobs/tick` is the engine's heartbeat. Nothing in this repository
schedules it, and that is a decision rather than an omission.

### What happened

`apps/web/vercel.json` did declare one:

```json
{ "crons": [{ "path": "/api/jobs/tick", "schedule": "*/5 * * * *" }] }
```

That file failed to deploy on this account:

> Hobby accounts are limited to daily cron jobs. This cron expression
> (`*/5 * * * *`) would run more than once per day.

It is worth being precise that this broke `huntloop-web` — the project that
actually serves the app — not the already-broken `huntloop`. A deployment that
does not deploy is worse than any scheduling problem, so the cron came out.

### Why it was not simply changed to daily

Because a daily tick is not a slow engine, it is a stalled one, and the
arithmetic is short enough to check.

`tick()` claims `limit` jobs (5 by default). The route sets `maxDuration = 60`
and the runner keeps a 20-second reserve, so it stops claiming with 20 seconds
left. Every job in this system either fetches a page or calls a model, and both
take tens of seconds. One invocation therefore completes somewhere between one
and four jobs.

Once per day, that is a handful of jobs per day against a queue fed by every
enabled source, every connected mailbox and every active enrollment. The queue
would grow without bound, `job_executions` would fill with work that never
runs, and the deployment would look correctly configured the whole time.

That is the same failure this document argues against for the root-directory
project one section up: **a green build that does not work is worse than an
honest failure.** A committed daily cron would be exactly that, and it would be
harder to spot, because a scheduled cron in `vercel.json` reads as a working
engine to anyone reviewing the repository.

### The three things that do drive it

Pick one. All three are deployment decisions, which is why none of them is a
file here.

**A — Inngest (free, and already built).** Set `INNGEST_EVENT_KEY` and
`INNGEST_SIGNING_KEY`. `/api/inngest` serves the same `tick()` on Inngest's
schedule and retry semantics, its free tier schedules far more often than
daily, and `isInngestConfigured()` already gates it. This is the recommended
route on Hobby: no plan change, no second service to write.

**B — Vercel Pro.** Restore the file above. Pro removes the daily limit, and
`*/5 * * * *` is the cadence the engine was designed around.

**C — any external scheduler.** `/api/jobs/tick` authenticates with
`Authorization: Bearer $CRON_SECRET` and is otherwise an ordinary HTTP
endpoint. A GitHub Actions schedule, a cron box, or an uptime pinger all work.

### What the product says while none of them is configured

The Sources screen states that nothing is reading the sources on a timer, and
every source reads "never scanned" rather than showing a stale count. That is
the intended behaviour, not a gap to paper over — see §7. The one thing to be
careful of is the inverse: `CRON_SECRET` being set means the endpoint *would*
accept a caller, never that one exists.

---

## DB-02 · Backups, point-in-time recovery, and restoring

> **Status: not yet verified.** Nothing in this repo states which Supabase plan
> the project is on, what its retention is, or whether a restore has ever been
> attempted. Untested backups are not backups — they are a belief about
> backups.

### What Supabase provides, by plan

Confirm the current plan in the dashboard under **Project Settings → Database
→ Backups**, then fill this in:

| | Plan | Backup type | Retention | RPO (worst-case data loss) |
|---|---|---|---|---|
| **Ours** | *(record it)* | *(record it)* | *(record it)* | *(record it)* |

Free and Pro projects get daily logical backups. Point-in-time recovery is a
paid add-on and is the difference between losing up to a day and losing up to
a couple of minutes.

**The decision to make:** whether losing a day of opportunities, evidence and
`ai_runs` rows is acceptable. It probably is today — there is no customer data
yet — and it stops being acceptable the day there is. PITR is not something to
enable *after* the incident that needed it.

### What a restore actually involves

Write this down before it is needed, because the middle of an incident is the
worst time to learn a console:

1. **Stop writes.** Put the app in maintenance or unset the Supabase env vars
   on Vercel — a restore that races live traffic produces a database in a state
   neither backup nor present.
2. **Restore** from the dashboard. Supabase restores into the same project and
   overwrites; there is no "restore to a copy and compare" without a second
   project.
3. **Re-check the migration list.** A restore returns the schema to its state
   at that moment, which may be *behind* `packages/db/migrations`. Re-apply
   anything newer, in order.
4. **Re-run the isolation suite against the restored project.** `npm test`
   proves the SQL is right; it does not prove *this* project is configured
   right, and a restore is exactly when that can change.
5. **Re-verify auth.** Confirm the app uses the `authenticated` role and not
   the service role.

### The rehearsal

- [ ] Record the plan, backup type and retention in the table above
- [ ] Decide on PITR, and write down the reasoning either way
- [ ] Restore into a **throwaway project** once, end to end, and time it
- [ ] Record the measured RTO here, so the number is real rather than hoped for

That third item is the one that turns this from a document into a capability.

### What is *not* backed up

Worth stating, because it is the part people assume is covered:

- **Environment variables.** They live in Vercel, not Supabase. Losing the
  project's env config loses `ANTHROPIC_API_KEY`, the Sentry DSN and the
  Supabase keys. Keep them in a password manager as well.
- **Storage objects**, if any are ever added — a separate backup story.
- **Auth users** are included in Supabase's backups, but a restore rolls back
  *sign-ups* too. Anyone who joined after the restore point is gone.

---

## DB-03 · Schema drift between Postgres and the TypeScript types

`packages/db/src/types.ts` is hand-written. That is a deliberate trade, stated
in the file's own header: generation needs a live project, this package must
typecheck offline, and the SQL wins on any conflict.

The trade is sound and it has one hole — **nothing detects the drift.** A
column renamed in a migration leaves a type that still compiles and is now a
lie, and the first symptom is a runtime `undefined` somewhere far away.

### The check

Once a Supabase project is stably available, add to CI:

```bash
npx supabase gen types typescript --project-id "$SUPABASE_PROJECT_ID" > /tmp/generated.ts
# then diff the generated row types against packages/db/src/types.ts
```

Two things make this less trivial than it looks, and both should be decided
before writing it:

1. **`types.ts` is deliberately a subset** — it types the columns the app
   reads, not every column. So the check is "does every type we declare match
   the database", not "are the two files identical". A naive `diff` fails on
   every run and gets disabled within a week.
2. **It needs a credential in CI**, which is the first secret this repository's
   CI would hold. Use a read-only project ref and scope it to the check.

Until that exists, the guard is the migration test: `npm test` runs every
migration against real Postgres and asserts the constraints, so a *schema* that
contradicts itself fails. A schema that merely contradicts `types.ts` does not.

---

## API-03 · API versioning

**Decision: there is no public API, and Server Actions must not be treated as
one.**

The app's entire server surface is Server Actions plus three route handlers
(`/auth/callback`, `/auth/signout`, `/api/csp-report`). Next generates an
opaque id for each action and that id changes between builds, which makes them
unusable as a contract — and that is a feature: it means nobody can quietly
start depending on one.

**Before the first external integration**, whichever comes first — a customer
integration, a public API, a webhook consumer, or the Agent Reach worker
described in [AGENT-REACH.md](../audit/AGENT-REACH.md) writing results back —
make this decision explicitly:

- A versioned REST surface under `/api/v1/*`, with its own authentication that
  is **not** a Supabase session cookie (a worker has no browser), its own rate
  limits, and a deprecation policy written down before the first consumer.
- Server Actions stay internal, for the app's own forms.

The thing to avoid is the middle: a route handler added "just for the worker",
unversioned, authenticated by a shared secret, that three integrations later
cannot be changed. That is how an accidental public API happens, and it happens
in one commit.

---

## Related

- [SETUP.md](../SETUP.md) — first-time setup, including turning the CSP on
- [CONTRIBUTING.md](../CONTRIBUTING.md) — branching, CI gates, migration rules
- [audit/BACKLOG.md](../audit/BACKLOG.md) — where DB-02, DB-03 and API-03 came from
