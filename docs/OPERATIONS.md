# Operations

Backup, recovery, schema drift, and the API-surface decision. Written because
each of these is cheap to decide now and expensive to discover later.

Nothing here can be verified from this repository — it all describes a hosted
Supabase project that only its owner can see. Every claim below is therefore
marked with whether it has been **checked** or is **assumed**, and the assumed
ones are the work, not the document.

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
