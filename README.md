# Huntloop

AI-native sales intelligence. Most tools help salespeople *find* prospects; Huntloop
exists to explain **why a prospect is worth contacting right now**.

> **SIGNAL → CONTEXT → INTENT → OPPORTUNITY**

The unit of the product is a **qualified opportunity with evidence**, not a lead. Three
rules follow from that and are load-bearing everywhere in this repo:

1. **Fact ≠ inference ≠ unknown.** Every claim carries which one it is. An inference is
   never silently promoted to a fact, and "we don't know" is a valid answer.
2. **Scores are explainable.** Eight named dimensions, each shown, with no invented
   weights presented as the model's arithmetic. An unmeasured dimension reads UNKNOWN,
   never zero.
3. **Why now.** A strong opportunity has a recent trigger, and old evidence stops
   counting as current.

### Documents, in precedence order

1. **[HuntLoop — Master Product, Technical & Engineering Context.md](HuntLoop%20—%20Master%20Product,%20Technical%20&%20Engineering%20Context.md)** — governing product intent. What the product *is*.
2. [Project_Creation.md](Project_Creation.md) — execution spec: phases, cost model, UI states, API shape. Authoritative where it does not contradict the above.
3. [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) — build plan, architecture decisions, design system. See §0.0 for the precedence rule and §0.0.1 for the reconciliation between (1) and (2).

The code always outranks all three on the question of what exists. A requirement
described in a document is not evidence that it is implemented.

What is built today: every destination in the sidebar. All seventeen read
through `apps/web/lib/data/*`, so each one is either showing rows from your
database or rendering `DemoFigures` to say it is not — there is no third state
where invented numbers are presented as real. What is *not* built is the part
that needs something outside the app: nothing scans a source on a timer,
nothing sends an email, and nobody can be invited. Each of those says so where
it would otherwise be a button. See [audit/BACKLOG.md](audit/BACKLOG.md).

## Stack

| Layer | Choice |
|---|---|
| Frontend | Next.js 16 (App Router, Turbopack), TypeScript, Tailwind v4 |
| Backend | Supabase — Postgres + Auth + Storage, tenant isolation via RLS |
| Jobs | Durable job runner (Inngest / Trigger.dev) |
| AI | Claude (Anthropic) |
| Billing | Stripe |

## Layout

```
apps/web            Next.js app — marketing + product + admin
packages/ui         Design system: tokens + components
packages/db         Migrations, RLS policies, Supabase clients
```

The design system's color and chrome derive from Supabase; the dashboard
information architecture derives from Kima BD OS. Tokens are canonical in
`packages/ui/src/tokens.css` — see IMPLEMENTATION_PLAN.md §1.

Semantic rule:

- **green** — system state, primary action, and a **source-verified fact**
- **violet** — a model produced this, which includes every **inference**
- **gray** — **unknown**: nothing on file

The epistemic half of that rule is not decoration. Colour is the fastest place an
inference could quietly become a fact, so the palette carries the distinction too.

Priority (`HOT` / `WARM` / `WATCH` / `IGNORE`) is a fifth, ranked scale that aliases
existing hues. It always ships with the word and a dot shape as well as the colour —
nothing in this UI is communicated by colour alone.

## Local development

Requires Node 22.6+ — the version in `package.json`'s `engines` field. The
floor is 22.6 rather than 20 because `packages/ai` and `packages/db` run their
test suites through `node --experimental-strip-types`, which lands there.

```bash
npm install
cp .env.example apps/web/.env.local   # then fill it in
npm run dev
```

- App: http://localhost:3100
- Design system gallery: http://localhost:3100/kitchen-sink

```bash
npm run typecheck   # all workspaces
npm run build       # production build
```

```bash
npm test
```

`npm test` runs the migrations against a real Postgres — PGlite, in-process, so
no server or Docker is needed — and asserts the rules the schema is supposed to
enforce: a fact cannot exist without a source, an unmeasured score dimension
stays NULL rather than becoming 0, a scoped memory cannot be subject-less, and
**org A cannot read or write org B**. That last one runs as a non-superuser role
so RLS genuinely applies; run it before every merge.

It also fails the build if anything under `apps/` imports the service-role
client, which bypasses RLS and is the one thing that can turn the tenant
boundary back into a matter of discipline.

Branching, commit conventions, what CI gates, and which paths need a pull
request are in [CONTRIBUTING.md](CONTRIBUTING.md).

## Connecting Supabase

The app runs on demo data until Supabase is connected and migrated. Follow
[SETUP.md](SETUP.md) — it covers the steps that need a human: choosing a
project, copying keys, running the migrations, and creating your first login.

Three commands do the parts that don't:

```bash
npm run db:doctor       # which migrations this project has actually had applied
npm run db:seed         # one worked organisation, three opportunities
npm run db:seed -- --reset
```

`db:doctor` exists because migrations are applied by hand, one file at a time,
and a half-applied schema does not announce itself — the app's own probe checks
one table and will happily report a project missing the rate-limit migration as
fully migrated. It is not hypothetical; it is the state this repo's configured
project was found in.

`db:seed` writes rows shaped to exercise the states the interface has to tell
apart: a fresh trigger with a named decision maker, a contact with no verified
address, and an opportunity with no buyer and three score dimensions left
unmeasured. It is idempotent and scoped to one organisation.

## Status

The design system, the database schema, four AI tasks, authentication, and ten
screens exist.

What works end to end: sign-in (magic link + Google), the org membership guard,
onboarding (company research → ICP → source recommendations), the analyze
screen, which runs a real qualification and why-now against a pasted URL, the
AI spend dashboard over `ai_runs`, and **the opportunity list and detail pages,
which read the database** — the join, the evidence, the triggers, the buyers.

What does not: the Command Center and sources screens still render illustrative
figures, and now say so on the screen itself in every configuration — a check
fails the build if one of them stops. Eleven of the seventeen nav destinations
are not built and are marked "Soon" rather than linked. Nothing yet *finds*
companies or computes a score — those screens display what is in the database
faithfully, and nothing puts anything there but the seed.

Three things have never run, and it is worth knowing which:

- **No AI task has called the real API.** All four are tested against a
  scripted client. Add `ANTHROPIC_API_KEY` and they run for the first time.
- **No load test.** The rate limiter is proven by seven database-level tests
  and by nothing driving it through HTTP.
- **The Content-Security-Policy is report-only.** It carries a per-request
  nonce and passes its whole suite under `CSP_ENFORCE=true`; enforcing it in
  production is a deliberate later step. See SETUP.md step 8.

### Verifying it

```bash
npm run verify          # typecheck · lint · tests · audit · build · bundle budget
npx playwright test     # 68 browser tests, desktop and mobile
```

See [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) §11 for the build plan,
[audit/FINDINGS.md](audit/FINDINGS.md) for an audited account of the gap
between the two, and [docs/OPERATIONS.md](docs/OPERATIONS.md) for backups,
schema drift, and the API-surface decision.

## Deploying to Vercel

This is an npm-workspaces monorepo, so the defaults do not work:

| Setting | Value |
|---|---|
| Framework Preset | **Next.js** (not "Other") |
| Root Directory | **`apps/web`** (not `./`) |
| Install Command | leave default — Vercel installs from the workspace root |

Add every variable from `.env.example` under Project → Settings →
Environment Variables. `SUPABASE_SECRET_KEY` must never carry the
`NEXT_PUBLIC_` prefix.

Set `NEXT_PUBLIC_SITE_URL` to the production origin. Without it, canonical and
Open Graph URLs fall back to the per-deployment Vercel host — or to
`localhost:3100` — and get published that way. See `apps/web/lib/site-url.ts`.
