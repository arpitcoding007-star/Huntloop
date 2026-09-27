---
description: From a clean checkout to a running app, in three tiers of configuration.
---

# Development setup

> **Layer:** Developer · **Audience:** engineering

## Prerequisites

* **Node ≥ 22.6.** The floor is 22.6, not 20, because `packages/ai`,
  `packages/db`, `packages/crm`, `packages/jobs` and `packages/providers` run
  their test suites through `node --experimental-strip-types`, which lands
  there. It is pinned in the root `engines` field, and `REPO-01` in the audit
  script fails if the README and `package.json` disagree.
* Git. No Docker, no local Postgres — the migration suite runs on PGlite
  in-process.

## Zero-config: demo mode

```bash
npm install
npm run dev
```

* App: [http://localhost:3100](http://localhost:3100)
* Design gallery: [http://localhost:3100/kitchen-sink](http://localhost:3100/kitchen-sink)

With no credentials, every screen runs on fixtures, `DataSourceBanner` says the
deployment is unconfigured, and `DemoFigures` marks each screen whose numbers
are illustrative. The whole UI is reachable without anyone's login — this is
also how the Playwright suite runs in CI.

## Tier 2: a real database

```bash
cp .env.example apps/web/.env.local   # then fill it in
```

Minimum for a live database:

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=
```

Then apply the migrations. **There is no automated migration step** — they go
into the Supabase SQL editor by hand, in order, one file at a time.
`COMBINED-0024-0027.sql` exists so four of them can be pasted in one go.

```bash
npm run db:doctor        # which migrations this project has ACTUALLY had applied
npm run db:seed          # one worked organisation, three opportunities
npm run db:seed -- --reset
```

{% hint style="warning" %}
Run `db:doctor`, not the app's own probe. The probe checks one table and will
happily report a project missing the rate-limit migration as fully migrated.
That is not hypothetical — it is a state this repo's configured project was
found in. See [Migrations](../operations/migrations.md).
{% endhint %}

The full walkthrough, including creating a login and setting up sign-in rate
limits, is in [`SETUP.md`](https://github.com/) at the repository root.

## Tier 3: the parts that cost money

Add these only when you want to exercise the thing they unlock.

| Variable | Unlocks | Without it |
|---|---|---|
| `ANTHROPIC_API_KEY` | All 12 AI tasks | Screens show a worked example, **labelled as one** |
| `APOLLO_API_KEY` | Discovery, enrichment, signals, reach count | Discovery finds nothing; the reach counter says "cannot count" rather than "0" |
| `EMAIL_VERIFICATION_API_KEY` | ZeroBounce | Every address stays `unverified` |
| `MAILBOX_ENCRYPTION_KEY` | Mailbox **and** CRM connections | Connecting either is refused rather than storing plain text |
| `CRON_SECRET` | The engine heartbeat | `/api/jobs/tick` returns **503** — nothing runs on a timer |

```bash
openssl rand -hex 32     # MAILBOX_ENCRYPTION_KEY and CRON_SECRET
```

See [Environment variables](environment-variables.md) for all 30+.

## Running the engine locally

The engine is driven by HTTP, so drive it by hand:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3100/api/jobs/tick
```

It returns a `TickReport`: what it claimed, what succeeded, what failed, and
whether the deadline stopped it early. Each call sweeps **and** ticks.

To loop it locally, any scheduler works — `/api/jobs/tick` is an ordinary
endpoint with a bearer token.

## Verifying a change

```bash
npm run verify
```

Runs, in order: `typecheck` → `lint` → `test` → `audit:site` → `build` →
`audit:bundle`.

Individually:

```bash
npm run typecheck    # every workspace
npm test             # 1,024 assertions across 7 workspaces
npm run lint         # eslint flat config
npm run audit:site   # 40 repository / security / SEO / route checks
npx playwright test  # 90 browser tests, desktop and mobile
```

{% hint style="danger" %}
`npm test` includes the cross-tenant isolation suite, which runs as a
**non-superuser** role so RLS genuinely applies. **Run it before every merge.**
It also fails the build if anything under `apps/` imports the service-role
client — the one thing that can turn the tenant boundary back into a matter of
discipline.
{% endhint %}

## Helper scripts

| Script | Purpose |
|---|---|
| `scripts/dev-demo.mjs` | Start the demo dev server on Windows without going through `cmd.exe` |
| `scripts/dev-demo-prod.mjs` | The same against a production build |
| `scripts/dev-session.mjs` | A dev session helper |
| `scripts/query.mjs` | Ad-hoc query against the configured project |
| `scripts/check-queries.mjs` | Checks every loader's query against the live project, not against the ERD |
| `scripts/bundle-budget.mjs` | Budgets the shared client chunks after a build |

## Where things are

```
apps/web/app/(app)/[org]/<feature>/
  page.tsx        Server Component — reads lib/data, decides what to render
  actions.ts      "use server" — validate, mutate, audit, revalidate
  <Feature>.tsx   Client Component — the interactive part

apps/web/lib/data/<domain>.ts    Every read for that domain. Returns Loaded<T>.
apps/web/lib/validation.ts       A Zod schema for every action input
packages/db/migrations/          The schema. Append-only, numbered.
packages/jobs/src/handlers/      One file per job
```

## Related

* [Code conventions](conventions.md) — read this before the first PR
* [Testing](testing.md)
* [Troubleshooting](troubleshooting.md)
