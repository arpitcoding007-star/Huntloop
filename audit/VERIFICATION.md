# Final verification report

**Date:** 2026-08-13 · **Baseline commit:** `4e1309a` · **Branch:** `main`

> **Five further passes are appended at the end.** The tables immediately
> below describe the first pass only.
>
> **Current totals (sixth pass, 2026-08-15):** 42 database checks · 75
> `apps/web` and `packages/ui` unit tests · 111 prompt-contract checks · 68
> browser tests · 37 audit checks, 0 failing, **0 warnings** · 0 dependency
> advisories. **All 5 migrations applied. No P0 items remain.**
>
> The fifth pass is the first run against a live database. It closed
> `FEAT-02` — the last warning — and found three things no amount of reading
> would have: **`FEAT-07`**, where connecting a database *removed* the
> demo-data marking from the Command Center; `DB-04`, a partially applied
> schema reporting as complete; and `UI-07`, a soft 404.
>
> The sixth pass completed the schema and drove `consume_rate_limit()` against
> the live project, which is a stronger claim than `db:doctor`'s — that probe
> only asks whether PostgREST exposes the name. Its finding was in the prose,
> not the code: **"every model-calling path refuses until `0005` is applied"
> was only ever true of a deployment holding an AI key**, because
> `isAiConfigured()` is checked two guards earlier. What remains needs a key,
> a DSN, a password, or one query in a SQL editor.

Everything below was run against the working tree after the fixes described in
[FINDINGS.md](FINDINGS.md). Reproduce the whole thing with:

```bash
npm run verify
```

---

## Toolchain

| Gate | Command | Before | After |
|---|---|---|---|
| Types | `npm run typecheck` | Clean (4 workspaces) | **Clean** |
| Lint | `npm run lint` | Clean | **Clean** |
| Schema + tenant isolation | `npm test` | 31/31 | **31/31** |
| Admin-import boundary | (part of `npm test`) | 50 files clean | **56 files clean** |
| Audit | `npm run audit:site` | *did not exist* | **32 checks · 0 failing · 8 warning** |
| Build | `npm run build` | 16 routes | **18 routes** |

`npm run verify` exits **0**.

The two new routes are `/robots.txt` and `/sitemap.xml`. The `_not-found` route
now resolves to the written 404 rather than the framework default.

---

## Runtime verification

Against the dev server on `:3100`.

**Security headers** — `curl -sI http://localhost:3100/login`:

```
Strict-Transport-Security: max-age=63072000; includeSubDomains
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Content-Security-Policy: frame-ancestors 'none'
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()
```

`X-Powered-By` is absent, as intended.

**Crawler routes.** This is where verification earned its place. First attempt
after adding `robots.ts`:

```
$ curl -s http://localhost:3100/robots.txt
/login?next=%2Frobots.txt
```

Both files were correct; the middleware matcher was not — `robots.txt` and
`sitemap.xml` are *routes* here, not static files, so they fell through to the
auth guard and every crawler received a 307. Recorded as `SEO-03`, fixed, and
now gated by `audit.mjs` `SEO-MW`. After the fix both serve correctly:
`robots.txt` returns the policy with the sitemap reference, `sitemap.xml`
returns three URLs.

**Console and server logs.** No browser console errors, no server errors.

**Auth guard.** `GET /acme/dashboard` unauthenticated redirects to the sign-in
page. Confirms the middleware guard is active against the locally configured
Supabase project. Page title renders as `Sign in · Huntloop`, confirming the
new `title.template` works and does not double the suffix.

---

## The critical fix, specifically

`SEC-01` — unauthenticated, unmetered AI spend.

**Verified by inspection and type-checking, not by execution.** Triggering the
original bug would have meant issuing a real `claude-opus-5` call with
`web_fetch` against a live API key, which is the exact cost the fix exists to
prevent.

What was confirmed:

1. `organizations` RLS resolves through `user_org_ids()` — read directly in
   `packages/db/migrations/0001_identity.sql`. This establishes that "no row"
   means "not a member", which is the premise of the finding.
2. All four wrappers (`research`, `sources`, `qualify`, `why-now`) now return
   before `runTask` when the org does not resolve. `resolveRecorder`'s return
   type is a discriminated union, so **the compiler enforces this** — a caller
   that ignores the refusal cannot destructure `recorder`.
3. `audit.mjs` `SEC-SPEND` fails CI if any wrapper reaching `runTask` lacks the
   guard. Passing.

The regression test that would close this properly is **TEST-02b** in the
[backlog](BACKLOG.md): scripted-`ModelClient` tests asserting each wrapper
refuses an unresolvable org, following the pattern `packages/ai` already uses
to prove the §7 rules without a network or a key.

---

## Remaining warnings

Eight, all tracked in the [backlog](BACKLOG.md). None gate the build; all are
deliberate.

| Check | Backlog |
|---|---|
| `SEC-CSP` — no `script-src` policy | **SEC-03** (P0) — needs nonce plumbing, its own task |
| `SEC-VAL` — no runtime input validation | **API-01** (P0) |
| `PERF-01` — 7 raw internal links | **PERF-01** (P1) |
| `FEAT-FIXTURE` — 2 screens on fixtures | **FEAT-02** (P1) |
| `TEST-web`, `TEST-ui` — no test script | **TEST-02** (P1) |
| `TEST-E2E` — no browser suite | **TEST-02** (P1) |
| `SEO-ICON` — no favicon | **SEO-05** (P2) |

---

## Not verified

Stated plainly rather than left to inference.

- **The nav "Soon" rendering and the 404 page were not confirmed visually.**
  Both sit behind the auth guard on this machine, and reaching them would have
  required handling the developer's sign-in credentials. Confirmed by
  typecheck, production build, and `audit.mjs` `NAV-01` (which parses the nav
  against the route tree) instead.
- **No live model call was made.** The AI wrappers were verified by types and
  static analysis; no `ANTHROPIC_API_KEY` request was issued.
- **Query performance was not measured.** The main list queries do not execute
  yet (`FEAT-02`). Re-audit Phase 6 with `EXPLAIN ANALYZE` once they do.
- **The three dependency advisories are still open** (`SEC-07`). All resolve
  via a Next 15 → 16 major upgrade, scheduled in R3 of the
  [roadmap](ROADMAP.md) — deliberately after Playwright lands, so the upgrade
  happens against a test suite.

---

## Files changed

**New**

```
audit/README.md              The audit program
audit/FINDINGS.md            Findings, all 10 phases
audit/BACKLOG.md             Prioritized tasks
audit/ROADMAP.md             Sequenced releases
audit/AGENT-REACH.md         Manual-requirements analysis
audit/VERIFICATION.md        This file
scripts/audit.mjs            32 automated checks, gating CI
apps/web/lib/site-url.ts     Canonical origin resolution
apps/web/app/not-found.tsx   404 preserving the 404-not-403 decision
apps/web/app/error.tsx       Route error boundary
apps/web/app/global-error.tsx  Root-layout boundary
apps/web/app/robots.ts       Crawler policy
apps/web/app/sitemap.ts      Sitemap
```

**Modified**

```
apps/web/lib/ai/recorder.ts       SEC-01 — refuse unresolvable orgs
apps/web/lib/ai/{research,sources,qualify,why-now}.ts
                                  SEC-01 call sites; why-now uuid bug
apps/web/next.config.ts           Security headers, poweredByHeader off
apps/web/middleware.ts            Exclude crawler routes from the guard
apps/web/app/layout.tsx           metadataBase, OG, Twitter, title template
apps/web/app/(app)/[org]/OrgShell.tsx   12 destinations marked unbuilt
packages/ui/src/components/Sidebar.tsx  `unbuilt` nav state
eslint.config.mjs                 Node globals for scripts/**/*.mjs
package.json                      audit:site, added to verify
.github/workflows/ci.yml          Audit step
.env.example                      NEXT_PUBLIC_SITE_URL, legacy aliases
README.md                         Status, Node floor, key name, site URL
+ 11 page files                   Title suffix removed (template supplies it)
```

No migrations were added or altered. No dependencies were added or removed.

---

# Second pass — R1 items 1 and 2

**Date:** 2026-08-13 · **Baseline:** `431ad03`

Closes `API-02` (rate limiting) and `ANL-01a` (error reporting), the first two
items of [R1](ROADMAP.md#r1--make-it-safe-to-run-in-production--15-weeks).

## Toolchain

| Gate | Before this pass | After |
|---|---|---|
| Types | Clean | **Clean** |
| Lint | Clean | **Clean** |
| Database suite | 31/31 | **39/39** |
| Admin-import boundary | 56 files | **61 files** |
| Audit | 32 checks · 0 failing · 8 warn | **34 checks · 0 failing · 8 warn** |
| Build | 18 routes | **18 routes** |

`npm run verify` exits **0**.

## Rate limiting

Seven new database-level tests, all passing:

```
✓ third call past a limit of 2 is denied
✓ remaining counts down and floors at zero
✓ a denied call still increments the counter
✓ a different action has its own window
✓ org-wide mode accumulates rather than inserting afresh
✓ a non-member cannot consume another org's quota
✓ a member cannot write rate_limits directly
```

Two of those exist because they caught real bugs rather than to pad the count:

- *"org-wide mode accumulates"* — the first implementation used one
  `INSERT … ON CONFLICT` naming the `user_id IS NOT NULL` partial index while
  sometimes inserting a NULL user. `ON CONFLICT` can only use a partial index
  as arbiter when the inserted row satisfies its predicate, so those rows never
  matched and every call inserted afresh. The limit would not have limited.
- *"a non-member cannot consume another org's quota"* — `consume_rate_limit()`
  is `SECURITY DEFINER` and therefore bypasses RLS, which makes the membership
  check inside it the entire boundary rather than a convenience.

The structural RLS test caught the new table automatically, which is the check
earning its keep: `rate_limits` was covered before anyone thought about it.

**Falsification.** The new `SEC-RATELIMIT` audit check was verified by removing
the guard from `sources.ts` and confirming the check fails, then restoring it:

```
=== with guard removed ===
  [FAIL] SEC-RATELIMIT   Every model-calling wrapper consumes a rate-limit budget
  34 checks · 1 failing · 8 warning
=== restored ===
  [ ok ] SEC-RATELIMIT
  34 checks · 0 failing · 8 warning
```

A check that has never been seen to fail is not known to work. This is the
discipline [README.md](README.md#adding-a-check) asks for, applied to itself.

## Error reporting

Verified: the build succeeds with **empty credentials**, matching what CI does
— no DSN, no auth token, no warnings. `Sentry.init` with an undefined DSN is a
no-op, and source-map upload is skipped unless all three of `SENTRY_AUTH_TOKEN`,
`SENTRY_ORG`, and `SENTRY_PROJECT` are set.

**Bundle cost, measured at each step:**

| | Shared First Load JS | Middleware |
|---|---|---|
| Before Sentry | 103 kB | 92.5 kB |
| After Sentry, default config | 185 kB | 129 kB |
| After tree-shaking flags | **136 kB** | **125 kB** |

The `DefinePlugin` flags matter because `tracesSampleRate: 0` and
`replaysSessionSampleRate: 0` disable the *behaviour* while still shipping the
*code*. Net cost is +33 kB, accepted, and recorded as `PERF-06` — a bundle
budget in CI, because nothing would have caught this without someone reading
the build output.

## Not verified

- **No error was deliberately thrown against a live Sentry project.** There is
  no DSN configured here. The wiring is verified by build and by types; that
  an event actually arrives needs a DSN and one deliberate throw, and is the
  first thing to do after provisioning the project.
- **Rate limiting was verified at the database layer, not end to end.** The
  seven tests run the real function against real Postgres. The application
  wiring (`lib/rate-limit.ts` → the four wrappers) is covered by types and by
  `SEC-RATELIMIT`, not by an integration test — that arrives with `TEST-02`.
- **`prune_rate_limits()` has no caller.** The function exists; nothing
  schedules it, so the table grows until something does. Tracked as `RL-02`.

---

# Third pass — the rest of R1's small items

**Date:** 2026-08-13 · **Baseline:** `a2fd596`

Closes `RL-01`, `API-01`, `API-02b` and `UI-06`, leaving `SEC-03` (a
nonce-based CSP) as the only remaining P0 item.

## Toolchain

`npm run verify` exits **0** — 39 database checks, 34 audit checks, 0 failing,
**7 warnings** (down from 8: `SEC-VAL` now passes).

## What each one turned out to be

**RL-01** — `consumeRateLimit` now refuses when it cannot count, but only where
that matters. Locally, no database is a normal state and refusing would break
onboarding-before-migration; in production it means auth, metering and limits
are all absent at once. The gate is `NODE_ENV`, not a production-URL check,
because preview deploys also build as production, are also publicly reachable,
and bill to the same account. The operator finds out through Sentry; the user
gets a message that says nothing about why, since "this server has an AI key
and no database" is a map of what to attack.

**API-01** — validates shape *and bounds*. The bounds were the real gap: the
existing reasoning about untrusted input was correct about trust and silent
about size. Found one live bug on the way — `createOrganisation` did
`String(formData.get("name"))`, and a `FormData` entry is `string | File`, so
`String(file)` gives `"[object File]"`: non-empty, slugifies to `objectfile`,
and creates an organisation. Now parsed rather than coerced.

`SEC-VAL` was strengthened from "is zod installed" to "does every
`"use server"` module actually parse", matching on `parseInput(`/`safeParse(`
rather than on the import, since an unused import satisfies a grep and
validates nothing. Falsified:

```
=== validation stripped from one action ===
  [FAIL] SEC-VAL   Every Server Action validates its inputs at runtime
=== restored ===
  [ ok ] SEC-VAL
```

**API-02b** — needed no code, which is the finding. Supabase already enforces
magic-link limits at the auth layer (2 emails/hour on the built-in sender, 30
OTPs/hour project-wide, a 60-second per-user window, 360 verifications/hour per
IP). A limiter in the app would duplicate them and do it worse, because a
serverless function cannot reliably identify the caller's IP. Documented in
`SETUP.md` with the trap named: moving to custom SMTP — which you must, since 2
per hour is unusable — makes the email cap yours to set, and the protection
then disappears quietly.

**UI-06** — rate-limit refusals render as `RateLimited` with a retry time
instead of `ErrorState` with a "Try again" button that will not work for
another forty minutes. On the sources step the retry button is dropped
entirely on that branch.

This also corrected a modelling error from RL-01: `unenforceable` is no longer
tagged as a rate limit. From the user's side the two are different events — one
is their doing and passes with time, the other is a deployment fault — and
tagging them alike would have put a misconfiguration under the heading "Too
many requests" with a retry time that never arrives.

## A measurement worth keeping

Same commit, same command, only the environment differing:

| | Shared First Load JS | Middleware |
|---|---|---|
| Empty Supabase credentials (what CI does) | 136 kB | **125 kB** |
| Real credentials (what production does) | 136 kB | **154 kB** |

`NEXT_PUBLIC_*` values are inlined at build time, so with empty strings webpack
proves the early return in `middleware.ts` is always taken and drops the whole
Supabase client path behind it. CI builds with empty credentials deliberately —
that step exists to prove nothing reads the database at build time — so **CI's
middleware figure understates the deployed one by 29 kB and always will.**

This changes how `PERF-06` has to be built: a budget reading CI's output would
be guarding a bundle nobody ships. Recorded in the backlog.

## Not verified

- **No live rate-limit refusal was rendered.** `RateLimited` is wired and
  typechecked, but reaching it needs a real database and 21 requests in an
  hour. Covered by types and `audit.mjs`, not by a browser.
- **The Supabase auth rate limits were read from Supabase's documentation, not
  confirmed against this project's dashboard.** Defaults change and can have
  been edited. Check **Authentication → Rate Limits** before relying on the
  numbers in `SETUP.md`.
- **`RL-01`'s production branch was not executed.** Triggering it needs a
  production build with an AI key and no database. Verified by reading, types,
  and the fact that the non-production branch is exercised on every local run.

---

# Fourth pass — the eight-phase completion run

**Date:** 2026-08-14 · **Baseline:** `0cfffd1` · **Branch:** `main`

Everything the backlog listed as buildable without a hosted Supabase project
was built, in eight phases, each verified before the next began. This section
records what was measured rather than what was intended.

## Toolchain, before and after

| Gate | Command | Before | After |
|---|---|---|---|
| Types | `npm run typecheck` | Clean (4 workspaces) | **Clean** |
| Lint | `npm run lint` | Clean, no a11y rules | **Clean, with `jsx-a11y`** |
| Schema + tenant isolation | `npm test` | 39/39 | **42/42** |
| Admin-import boundary | (part of `npm test`) | 61 files clean | **80 files clean** |
| Unit — `apps/web` | `npm test` | *did not exist* | **34 passing** |
| Unit — `packages/ui` | `npm test` | *did not exist* | **7 passing** |
| Browser | `npx playwright test` | *did not exist* | **68 passing, 2 skipped** |
| Audit | `npm run audit:site` | 34 checks · 7 warning | **36 checks · 0 failing · 1 warning** |
| Bundle | `npm run audit:bundle` | *did not exist* | **244.6 kB gzipped of 275 kB** |
| Advisories | `npm audit` | 3 high | **0** |
| Build | `npm run build` | 18 routes, Next 15.5.23 | **20 routes, Next 16.3.1** |

## Measured, not assumed

**Auth pages, PERF-02.** `/login` and `/signup` went **217 kB → 151 kB** First
Load JS. Confirmed structurally as well as numerically: `GoTrueClient`,
`supabase-js` and their symbols appear in **zero** client chunks. Both
submissions are Server Actions now.

**PostHog cost nothing.** Shared First Load JS was unchanged after adding
analytics, because `posthog-node` runs server-side only. That was the reason
for choosing it over `posthog-js`, and the number is the evidence.

**The Sentry tree-shaking was already inert.** The `webpack()` `DefinePlugin`
block became dead on Next 16 (Turbopack never calls `webpack()`), and was
replaced with `bundleSizeOptimizations`. Two clean builds with `.next` deleted
between them, with and without that block: **1013.9 kB of client chunks either
way**, and zero occurrences of `rrweb`, `replayIntegration` or
`ReplayContainer` in both. `instrumentation-client.ts` never adds those
integrations, so on SDK v10 the code is not in the module graph at all. The
49 kB the second pass recorded was real when measured, against an older SDK.
The option is kept because it costs nothing and one line in another file would
make it load-bearing again.

**The bundle budget needed the right unit.** The shared client chunks are
787.3 kB raw, 244.6 kB gzipped, 211.4 kB brotli. Next's old First Load JS
column was gzipped, so a budget in raw bytes would have been off by a factor of
three — either never firing or always. `scripts/bundle-budget.mjs` measures
gzip, and budgets the *shared* chunks only, for the reason recorded in the
third pass: the proxy bundle is 29 kB smaller in CI than in production and
always will be.

## Found by verification, not by reading

Four things a static reading would have shipped:

1. **A statically prerendered page cannot carry a per-request CSP nonce.** The
   Playwright CSP suite caught it on `/login` under `CSP_ENFORCE=true`: the
   page renders perfectly and never hydrates. Fixed by `force-dynamic` at the
   root layout, with `robots.ts` and `sitemap.ts` opting back out.
2. **`upgrade-insecure-requests` is ignored in a report-only policy**, and
   browsers say so in the console on every page load. Now emitted only when
   enforcing.
3. **`DataTable` is a Client Component**, so the analytics page could not build
   its `columns` — `render` is a function and functions cannot cross the
   boundary. Every request logged an error while the nav test still passed,
   because a check that a route *answers* is not a check that it works. The
   spend table is now its own client component and has its own spec.
4. **Sixteen `href="#"` placeholders** that neither `jsx-a11y` nor `PERF-01`
   could see — eight on the Command Center, eight in the gallery — because they
   were props on a component that renders an anchor three files away. `NAV-02`
   greps for them now, and was itself verified by falsification.

## Checks verified by falsification

Each was confirmed to fail when the thing it guards was removed, then restored:

| Check | Broken deliberately | Result |
|---|---|---|
| `audit.mjs` `NAV-02` | Added `href="#"` to a StatCard | Failed, named the file |
| `spend-guard.test.ts` | Deleted the org guard in `qualify.ts` | Failed on the wrapper |
| `DataTable.test.tsx` | Removed `tabIndex` from the row | Failed on keyboard reachability |

## Still not verified, and why

- **No live Supabase project.** The membership guard's 404, real sign-in, the
  OAuth callback, and the live opportunity queries remain unexercised. The
  browser suite runs in demo mode — a real configuration of this app, and the
  one CI builds, but not the configured one.
- **No AI key has ever been used.** All four tasks remain unit-tested against a
  scripted client and have never called the real API.
- **The CSP has not been enforced in production.** It has been proven to work
  under enforcement locally — the full suite passes with `CSP_ENFORCE=true` —
  which is the rehearsal, not the event.
- **`0006_prune_schedule.sql` schedules nothing here.** PGlite has no `pg_cron`,
  so the migration's guard skips it by design. The function it schedules *is*
  now tested; the scheduling is not. `select * from cron.job` is the check on a
  real project.
- **Sentry has still never received an event.** Wiring is verified by build and
  types only, and the CSP report endpoint depends on it.

---

# Fifth pass — against a live database, for the first time

**Date:** 2026-08-15 · **Baseline:** `0cfffd1` · **Branch:** `main`

Every previous pass verified this application against fixtures, PGlite, or a
demo-mode build. This one ran it against the hosted Supabase project the repo
is configured for, signed in as a real member with row-level security on.

That distinction is the point of the pass. Four passes of careful work left one
audit warning and a page of claims that began "once there is a database". This
records which of those claims survived contact with one.

## What the project actually contained

Not what `SETUP.md` assumed. Probed before anything was written to it:

| | Found |
|---|---|
| Reachable with the configured keys | Yes |
| Migrations applied | `0001`–`0004` |
| Migrations **not** applied | **`0005_rate_limits.sql`** |
| Rows in any table | **Zero** |
| Tables belonging to another product | None — the project is Huntloop-only |

The last row mattered before anything else did. `SETUP.md` step 1 warns that
this project might be shared with another product, in which case applying
Huntloop's migrations would be very hard to undo. The 40 tables present are all
Huntloop's, so it is not.

The `0005` gap is `DB-04`, and it is the finding of this pass. See below.

## Toolchain

| Gate | Command | Result |
|---|---|---|
| Types | `npm run typecheck` | **Clean** (4 workspaces) |
| Lint | `npm run lint` | **Clean** |
| Schema + tenant isolation | `npm test` | **42/42** |
| Admin-import boundary | (part of `npm test`) | Clean |
| Unit — `apps/web` | `npm test` | **68 passing** (34 before) |
| Unit — `packages/ui` | `npm test` | **7 passing** |
| Prompt contracts — `packages/ai` | `npm test` | **111/111** |
| Audit | `npm run audit:site` | **37 checks · 0 failing · 0 warning** |
| Bundle | `npm run audit:bundle` | **244.6 kB gzipped of 275 kB** |
| Build | `npm run build` | **21 routes** |

`npm run verify` exits **0**. `FEAT-FIXTURE` is no longer a warning, which
leaves the audit with none for the first time.

## Measured against real rows

**The list query returns rows.** Run as the signed-in member, not with the
service key — so RLS was in the path, and a query that only works as superuser
would have returned nothing:

```
Alphio AI            hot    91   Funding — Series A              6 days ago
Northwind Logistics  warm   74   Hiring — integration engineers  13 days ago
Cormorant Health     watch  48   Regulatory approval             4 months ago  STALE
```

Ordering is priority, then score — the verdict first, exactly as §78 requires
and as `opportunities_priority_idx` is built for.

**The detail page assembles from four sources in two round trips.** Company,
opportunity, latest score, triggers, people and contact points arrive in one
nested embed; evidence in a second query, because it cannot be embedded at all.
Rendered: eight score dimensions with three of Cormorant's left as UNKNOWN,
five evidence rows split 2 fact / 1 inference / 2 unknown, source labels
derived from the stored URLs, and a decision maker with a verified address
beside one without — rendering "No verified address" rather than a guess.

**A null narrative field renders as a finding.** Cormorant's
`identified_problem` is NULL in the database and the page shows UNKNOWN — "Not
established by the evidence on file" — rather than an empty section. That is
§78 working through a database column, and it is the reason the seed leaves
those columns NULL instead of storing the string "Not established".

**The membership guard's 404 is real.** `/notanorg/opportunities` answers
**404** for a signed-in user who is not a member. This was listed under "still
not verified" in the fourth pass; it now has a measurement.

## What only running it revealed

Four things, and the pattern is the same one as every previous pass: none were
visible to typecheck, lint, or review.

1. **`evidence` cannot be embedded.** Its subject is polymorphic, so there is
   no foreign key for PostgREST to follow. The blind version of this join —
   which had been written and correctly refused to ship — would have nested it
   and failed at runtime, on the page the product is judged on.

2. **A non-uuid id raises rather than returning nothing.** `/opportunities/
   alphio-ai`, a link this app itself served for months, meets a `uuid` column
   and produces `22P02 invalid input syntax` — a 500 where a 404 belongs.
   Rejected before the query now.

3. **`DB-04` — a partial schema reports as complete.** With `0005` missing,
   `isSchemaApplied()` said "migrated", every screen rendered live rows, and
   every model call threw `Could not find the function
   public.consume_rate_limit`. Safe — it failed closed and spent nothing — but
   unreadable, and this is the *normal* state during setup, because migrations
   are applied by hand one file at a time.

4. **`UI-07` — a missing opportunity answers 200.** Measured on a production
   build, signed in. `notFound()` in a layout sets the status; `notFound()` in
   a page under a `loading.tsx` boundary cannot, because the shell has already
   flushed. Recorded, not fixed — the fix costs either the loading skeletons or
   a routing tree shaped around a status code, and that is a product decision.

5. **`FEAT-07` — connecting a database removed the demo-data marking.** The
   one that matters most, and the one this pass created. `DataSourceBanner`
   goes quiet when a database is connected, which is correct for the question
   it answers and wrong for the Command Center, whose figures are hard-coded
   in every configuration. So the moment the opportunity screens started
   showing real rows, `180 discovered` and `2 meetings` sat beside them with
   nothing saying they were invented — and a `Live` badge above them.

   `FEAT-FIXTURE` could not see it: the numbers were written inline, not
   imported from `lib/fixtures`. `DemoFigures` has no quiet state, and the new
   `FEAT-DEMO` check **fails** the build if a screen under `/[org]` neither
   reads through `lib/data` nor renders it. Falsified by removing it from the
   sources screen: the check failed and named the file.

   Worth stating plainly, because it is the argument for running the thing:
   four passes of review did not find this, and it appeared within minutes of
   a database being connected — not as a regression, but because fixing
   `FEAT-02` removed the accident that had been covering it.

## What was made repeatable

The browser evidence above was gathered once, by hand. The rules it confirmed
are now held still by tests, because a one-off measurement stops being true the
moment someone refactors.

The pure row-to-screen mapping moved to `lib/data/opportunity-map.ts` — the
same move `safe-next.ts` got, and for the same reason: it is where the
product's rules about *not asserting things* live, it was the only
implementation, and it had no test. **34 new tests**, taking `apps/web` from 34
to 68.

Verified by falsification, each break reverted afterwards:

| Rule | Broken deliberately | Result |
|---|---|---|
| §78 — an unmeasured dimension is not a zero | `?? "unknown"` → `?? 0` on one dimension | 2 failed, both naming §78 |
| §78 — the verdict orders the list, not the score | Dropped the priority term from the comparator | Failed on "a low-scoring hot above a high-scoring warm" |
| §78 — do not fabricate contact details | Dropped `verification_status === "verified"` | Failed on "does not show an unverified address" |

The third is the one worth noting. Removing that clause makes an unverified
address render as a `mailto:` — a guess that gets sent — and every other test
still passed, which is exactly the shape of change a review waves through.

`process.exit()` also turned out to abort the process on Windows once a
Supabase client is open — `Assertion failed: !(handle->flags &
UV_HANDLE_CLOSING)` — returning a 32-bit abort code instead of 0 or 1 and
truncating unflushed stdout. Both new scripts end by setting `exitCode` and
letting the process finish, which is why they can be trusted in a shell.

## Still not verified, and why

Supersedes the same section in the fourth pass. The first two entries were
discharged the next day — see the sixth pass below.

- **`0005` and `0006` are still not applied.** Applying them needs the database
  password (`DATABASE_URL` is empty) or a paste into the SQL editor. Until
  then `consume_rate_limit()` does not exist, and every model-calling path
  refuses — correctly, and now legibly. `npm run db:doctor` is the check.
- **`0006`'s scheduled half has still never run.** PGlite has no `pg_cron`, so
  the test suite proves the file parses and nothing more. `select * from
  cron.job` on the real project is the check, and it cannot be run until the
  file is.
- **No AI key has ever been used.** All four tasks remain unit-tested against a
  scripted client and have never called the real API.
- **Sentry has still never received an event**, so the CSP report endpoint has
  still never delivered one, and `OPS-01` still cannot start its clock.
- **No load test.** The limiter is proven at the database level by seven tests
  and by nothing driving it through HTTP — and it cannot be, until `0005` is
  applied.
- **The live evidence above is evidence, not regression coverage.** It was
  driven through a real browser once. Nothing re-runs it; `TEST-02c` is the
  task that would, and the reason it is not done is recorded there.

---

# Sixth pass — the schema completed, and the limiter driven

**Date:** 2026-08-15 · **Baseline:** `5d46aea` · **Branch:** `main`

A short pass with one subject: `0005_rate_limits.sql` and `0006_prune_schedule.sql`
were applied to the configured project, by hand in the Supabase SQL editor.
This records what was checked afterwards, and — more usefully — the one thing
the pass proved about the *documentation* rather than the code.

## Why the check is not `db:doctor`

`npm run db:doctor` reports all five migrations applied. That is worth exactly
what its method is worth, and its method is a single request for PostgREST's
OpenAPI document, asking whether the name `consume_rate_limit` appears in it.

An empty function with the right signature would satisfy that. So would a
function whose membership guard had been dropped to make an error go away.
Neither is likely; both are invisible to the probe; and the whole argument of
the fifth pass was that probes which infer state from one signal are how
`DB-04` happened in the first place.

So the deployed function was driven directly, through PostgREST, with the
service key.

## What the live function did

| Check | Result |
|---|---|
| `rate_limits` table readable | HTTP 200 |
| `consume_rate_limit()` with no identity | **HTTP 400 · `P0001` · *"consume_rate_limit requires an authenticated caller"*** |
| `prune_rate_limits()` | HTTP 200, returned a count |
| Counter rows written by the refused call | **none** |

The second row is the one that matters, and it is worth being precise about
why. `consume_rate_limit()` is `SECURITY DEFINER`, so it bypasses RLS by
construction; the `auth.uid()` guard at the top of its body is therefore not
defensive, it is *the* boundary between a stranger and another org's quota.
The service key carries no `auth.uid()`, which makes an unauthenticated call
the one branch reachable from a script — and it is the branch worth reaching.
The error text matches `0005_rate_limits.sql` exactly.

The fourth row places that guard **before** the upsert. A function that
counted first and checked membership second would have left a row behind; the
table is empty, so it does not.

Together these establish that the deployed object is this repository's object,
which is a different and stronger claim than "the name resolves".

## What the pass found, and it was in the prose

The documents in this directory, `SETUP.md`, and the backlog all said some
version of *"until `0005` is applied, every model-calling path refuses"*.

That is true only of a deployment **that has an `ANTHROPIC_API_KEY`**. All four
wrappers check `isAiConfigured()` first — before `resolveRecorder()`, before
`consumeRateLimit()` — and return a worked example labelled `unconfigured`
when there is no key:

```
research.ts:59   if (!isAiConfigured()) return { ok: true, result: { source: "unconfigured", … } }
research.ts:66   const resolved = await resolveRecorder(orgSlug)
research.ts:74   const budget = await consumeRateLimit(orgId, "research_company")
```

The project in `.env.local` has no key. So the state those documents described
as a refusal has never been reachable on it, and the migration everyone was
told was "the one thing blocking the AI features" was blocking a path that
stops two guards earlier.

It was still worth applying — the cap must exist before a key does, which is
the ordering rule this roadmap is built on — but the *reason* given for it was
wrong, and it was wrong in the direction that flatters the writer: it made a
prerequisite sound like a blocker. Corrected in `SETUP.md`, `BACKLOG.md` and
`ROADMAP.md` rather than left for someone to rediscover.

This is the same class of defect as `FEAT-07` and `DB-04`, in the only place
those two could not reach: a statement about behaviour that no test asserts,
because it is prose.

## Toolchain

Unchanged from the fifth pass, re-run on `5d46aea` after the migrations landed.

| Gate | Command | Result |
|---|---|---|
| Types | `npm run typecheck` | **Clean** |
| Lint | `npm run lint` | **Clean** |
| Schema + tenant isolation | `npm test` | **42/42** |
| Audit | `npm run audit:site` | **37 checks · 0 failing · 0 warning** |
| Bundle | `npm run audit:bundle` | **244.6 kB gzipped of 275 kB** |
| Build | `npm run build` | **21 routes** |
| Migrations | `npm run db:doctor` | **All 5 applied** |

No code changed in this pass. The gates were re-run because the database
underneath them did.

## Still not verified, and why

Supersedes the same section in the fifth pass. Three of its six entries stand
unchanged; the two about `0005` are discharged, and one is narrower.

- **`0006`'s scheduled half has still never run.** Narrower than before but not
  closed: `0006` is applied, and whether it *scheduled* remains unknown.
  `cron.job` is not exposed through PostgREST, so no script in this repo can
  see it — `db:doctor` prints `[?]` against `0006` for exactly this reason.
  `select * from cron.job` in the SQL editor is the only check. It is `DB-05b`.
- **No AI key has ever been used.** Unchanged. All four tasks remain
  unit-tested against a scripted client. The limiter they now consume from is
  real; the calls it would meter are still hypothetical.
- **Sentry has still never received an event**, so the CSP report endpoint has
  still never delivered one, and `OPS-01` still cannot start its clock.
- **No load test.** The blocker named here in the fifth pass is gone —
  `consume_rate_limit()` exists — but nothing has driven it through HTTP, and
  doing so needs a signed-in session, which needs a magic link from a real
  inbox. Still `TEST-02c`.
- **The allow path has never run against this project.** Everything above
  exercises the refusal branch, because a script cannot hold an `auth.uid()`.
  That a member is granted quota, that the counter increments, and that the
  window rolls over are proven by the 22 PGlite tests and by nothing else.
