---
description: The standard this codebase holds itself to, and the mechanisms that keep it there.
---

# Code conventions

> **Layer:** Developer · **Audience:** engineering, AI agents

`CONTRIBUTING.md` at the repository root is the normative version. This page
summarises it and adds what a new contributor most often gets wrong.

## Branching and commits

`main` is the only long-lived branch and is always deployable. Branch from it,
merge back to it. No `develop`, no release branches.

```
feat/nonce-csp      fix/rate-limit-partial-index
chore/next-16       audit/phase-5-rerun
```

Keep branches under a few days old — a week-old branch in a codebase moving
this fast is a merge conflict with the migrations directory.

Commit messages are **present tense, describing what the change does to the
system**:

> `Refuse when the limiter cannot run, and say so as a limit not a failure`

not `updated rate-limit.ts`. The commit log is the only place the *reasoning*
survives at the granularity of a change, so a message that restates the diff
wastes the one slot where "why" fits.

**One concern per commit.** A migration and the screen that reads it may share
a commit; a migration and an unrelated lint fix may not.

## Pull requests are required for

* `packages/db/migrations/**` — schema changes are the least reversible thing in
  the repo
* `apps/web/lib/ai/**` and `packages/ai/**` — these paths spend money
* `proxy.ts`, `next.config.ts`, RLS policies, and the tenant-boundary lint rule
  — the security boundary and the mechanisms guarding it

## The two rules that are not optional

### 1. Never present the unverified as established

This is the product's central rule, and **it applies to the app's claims about
itself**, not just to prospect data.

A nav item that 404s, a Feedback link pointing at `"#"`, a query written blind
against a database nobody has run it on — each is the same failure. If something
is not built, **say so in the UI.**

The audit checks that back this up: `NAV-01`, `NAV-02`, `NAV-03`,
`FEAT-FIXTURE`, `FEAT-DEMO`.

### 2. Comments explain *why*, and record the rejected alternative

The "what" is in the code already. When you make a decision a reasonable person
would make differently, write down what you considered and why you landed where
you did. That is what makes the next change safe to reason about.

This codebase has an unusually high comment density and it is deliberate. Read
a few files before writing new ones — `packages/providers/src/call.ts`,
`packages/jobs/src/queue.ts` and `packages/db/src/rules.ts` are good examples
of the house style.

{% hint style="info" %}
There are **zero** `TODO` / `FIXME` markers in the entire codebase. A thing that
is not done is either stated in the UI, tracked in this book, or built.
{% endhint %}

## Structural rules, each mechanically enforced

| Rule | Enforced by |
|---|---|
| `apps/` never imports the service-role client | `SEC-ADMIN` + `check-admin-imports.ts` |
| No vendor name outside `packages/providers/src/adapters/` | `PRV-CHK` |
| Every Server Action validates its input at runtime | `SEC-VAL` |
| Every model-calling wrapper resolves its org, consumes a rate limit, and checks the quota | `SEC-SPEND`, `SEC-RATELIMIT`, `SEC-QUOTA` |
| Every nav item points at a real route | `NAV-01` |
| Every `/[org]` screen reads a loader or declares demo figures | `FEAT-DEMO` |
| Internal links use `next/link` | `PERF-01` |
| Every env var the code reads is documented | `REPO-02` |

**If you want a rule to hold forever, add a check to `scripts/audit.mjs`.** That
is where "this must never regress" belongs — not in a document.

## Derive, never retype

Enum members, step names, priorities, claim kinds, score dimensions: import
them from the package that owns them. A hand-copied union **drifts silently** —
the schema keeps validating and starts rejecting the new member as invalid
input.

Every vocabulary also has a `CHECK` constraint saying the same thing. That
duplication is the correct kind: the database is the last line and cannot be
bypassed; the TypeScript union is the first line and produces a sentence a
person can read.

## Adding a feature — the checklist

1. **Migration** (if the schema changes): a new numbered file, never an edit to
   an existing one. Comment the table. Add `CHECK`s. Enable RLS and write both
   policies. Add assertions to `verify-migrations.ts`.
2. **Loader** in `lib/data/<domain>.ts`, returning `Loaded<T>` via `load()`.
3. **Page** — a Server Component that renders `DemoFigures` when
   `source !== "live"`.
4. **Action** — Zod schema, `parseForm`, `mutate`, `recordAudit`,
   `revalidatePath`.
5. **Nav** — add the item and the route in the **same commit**.
6. **Tests** — see [Testing](testing.md).
7. **Docs** — see [Documentation conventions](../meta-documentation-conventions.md).
8. `npm run verify`.

## Adding a job

1. Add the name to the `JobName` union in `queue.ts` — this is a **compile
   error** until step 2.
2. Write `packages/jobs/src/handlers/<name>.ts`. Make it **idempotent**: it can
   run twice.
3. Register it in `registry.ts`.
4. **Give it a caller.** Four handlers in this repo are registered, tested and
   enqueued by nothing. Do not add a fifth.
5. If it is a sweeper, add it to `SWEEPERS` in `runner.ts` and to the `sweep()`
   list — and decide whether it belongs in `HOURLY` or `DAILY`.
6. Add checks to `verify-jobs.ts`.

## Naming

| Use | Not |
|---|---|
| company | account |
| opportunity | lead, deal (except inside `packages/crm`) |
| person / contact point | contact record |
| source | feed, channel |
| trigger / signal | event (reserved for the `events` table) |
| priority | rating, grade |

## Related

* [Testing](testing.md)
* [Documentation conventions](../meta-documentation-conventions.md)
* `CONTRIBUTING.md` at the repository root
