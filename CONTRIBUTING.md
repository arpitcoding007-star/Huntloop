# Contributing

Written down because it is currently one developer's habit, and a habit is not
a process (audit REPO-07). The point of writing it now is that the second
person should not have to reverse-engineer it from the commit log.

---

## Branching

`main` is the only long-lived branch, and it is always deployable. Everything
else is short-lived and named for what it does:

```
feat/nonce-csp
fix/rate-limit-partial-index
chore/next-16
audit/phase-5-rerun
```

**Branch from `main`, merge back to `main`.** No `develop`, no release
branches. There is one environment that matters and continuous deployment to
it; a staging branch would be a second thing to keep in sync for no benefit at
this size.

Keep branches under a few days old. A week-old branch in a codebase moving this
fast is a merge conflict with the migrations directory.

## Commits

Present tense, describing what the change does to the system rather than what
you did to the files:

> `Refuse when the limiter cannot run, and say so as a limit not a failure`

Not `updated rate-limit.ts`. The commit log is the only place the *reasoning*
survives at the granularity of a change, so a message that restates the diff
wastes the one slot where "why" fits.

**One concern per commit.** A migration and the screen that reads it can share
a commit; a migration and an unrelated lint fix cannot.

## Pull requests

Required for anything touching:

- `packages/db/migrations/**` — schema changes are the least reversible thing
  in the repo
- Anything under `apps/web/lib/ai/**` or `packages/ai/**` — these paths spend
  money
- `proxy.ts`, `next.config.ts`, RLS policies, or the ESLint tenant-boundary
  rule — the security boundary and the two mechanisms guarding it

Direct pushes to `main` are acceptable for documentation, copy, and additive UI
work. This is a judgement call today and stops being one the moment there are
two people.

## What CI enforces

`.github/workflows/ci.yml` runs on every push to `main` and every pull request:

| Step | Fails the build on |
|---|---|
| `npm run typecheck` | Type errors, all four workspaces |
| `npm run lint` | ESLint, including the ban on importing the service-role client into `apps/` and the `jsx-a11y` rules |
| `npm test` | Migrations against real Postgres (PGlite), schema constraints, **tenant isolation**, and a scan for admin-client imports |
| `npm run audit:site` | The mechanized audit findings — a nav link onto a 404, a missing security header, a Server Action without input validation, a model-calling path that does not resolve its org |
| `npm audit --audit-level=high` | Reports only. A new advisory against an unchanged tree must not redden an unrelated PR |
| `npm run build` | Production build, deliberately with **empty** Supabase credentials, to prove nothing reads the database at build time |
| `npm run audit:bundle` | Gzipped shared client JS over budget. Next 16 stopped printing a First Load JS column, so this is the only place the number is visible |
| `npx playwright test` | 68 browser tests across desktop and mobile, in a separate job so a browser download does not delay typecheck feedback |

Run the whole set locally before pushing:

```bash
npm run verify && npx playwright test
```

`verify` is typecheck → lint → tests → audit → build → bundle budget, in that
order, stopping at the first failure.

## Branch protection

Not configured yet — this needs a repository admin in the GitHub UI and cannot
be committed. Set on `main` when there is a second contributor:

- [ ] Require a pull request before merging
- [ ] Require the `verify` **and** `e2e` status checks to pass
- [ ] Require branches to be up to date before merging
- [ ] Block force pushes and deletion

Until then, CI runs on pushes to `main` and reports after the fact rather than
before. That is the actual state, and it is worth knowing which of the two you
are relying on.

## Migrations

Numbered, ordered, and **never edited once applied anywhere**. Add `0007_…`
rather than changing `0006_…`, even if `0006` is a day old — a migration that
has run somewhere and then changes is a schema that differs per environment
with nothing detecting it.

Every migration runs against PGlite in `npm test`. If it needs an extension
PGlite does not have, guard it the way `0006_prune_schedule.sql` does and say
plainly in the file which half is therefore unverified.

## The standard the codebase holds itself to

Read a few files before writing new ones — the conventions are visible and
consistent. Two that are not optional:

**Never present the unverified as established.** This is the product's central
rule (§7) and it applies to the app's claims about itself, not just to prospect
data. A nav item that 404s, a Feedback link pointing at `"#"`, a query written
blind against a database nobody has run it on — each is the same failure, and
the audit found all three. If something is not built, say so in the UI.

**Comments explain why, and record the alternative that was rejected.** The
"what" is in the code already. When you make a decision that a reasonable
person would make differently, write down what you considered and why you
landed where you did — that is what makes the next change safe to reason about.
