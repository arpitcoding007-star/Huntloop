# Prioritized backlog

Every open finding from [FINDINGS.md](FINDINGS.md) as a task. Sequenced in
[ROADMAP.md](ROADMAP.md).

**Effort** is elapsed engineering time for someone familiar with the codebase:
**XS** <1h · **S** ½ day · **M** 1–2 days · **L** 3–5 days · **XL** >1 week.

**Priority** is severity moderated by reach and cost. A cheap Low outranks an
expensive Medium when nothing blocks either.

---

## Closed in this pass

Listed so the roadmap starts from an accurate baseline, and so nobody
re-litigates a decision already made.

| ID | Task | Effort |
|---|---|---|
| SEC-01 | Refuse model calls when the caller's org cannot be resolved | S |
| SEC-02 | Security response headers + `poweredByHeader: false` | XS |
| SEO-01 | `metadataBase`, Open Graph, Twitter, title template | S |
| SEO-02 | `robots.ts` and `sitemap.ts` | XS |
| SEO-03 | Exclude crawler routes from the auth matcher | XS |
| UI-01 | `error.tsx` and `global-error.tsx` | S |
| UI-02 | `not-found.tsx` preserving the 404-not-403 decision | XS |
| FEAT-01 | `unbuilt` nav state; 12 dead links stop being links | S |
| REPO-01/02/03/04 | Documentation drift; `NEXT_PUBLIC_SITE_URL` | S |
| AUDIT-00 | `scripts/audit.mjs` — 34 checks, gating CI | M |
| WHYNOW-01 | Latent uuid bug: slug passed where an org id was expected | XS |
| **API-02** | **Rate limiting on all four model-calling paths** | **M** |
| **ANL-01a** | **Sentry error reporting, server + edge + client** | **S** |
| **RL-01** | **Refuse model calls when the limiter cannot be enforced** | **S** |
| **API-01** | **`zod` on every Server Action input** | **S** |
| **API-02b** | **Magic-link limits — documented; Supabase already enforces them** | **S** |
| **UI-06** | **Rate-limit refusals render as `RateLimited`, not `ErrorState`** | **S** |
| **FEAT-02** | **Live opportunity list and detail queries** | **L** |
| **DB-04** | **A partially applied schema no longer reports as fully applied** | **S** |
| **FEAT-07** | **Screens whose figures are invented say so, whatever the data source** | **S** |

### Notes on what closed

**API-02** is Postgres-backed (`migrations/0005_rate_limits.sql`), not Redis —
the limited actions take tens of seconds, so a 5ms round trip to a database we
already have beats provisioning a second stateful service. Per-user *and*
per-org counters, because ten seats looping the same form is the same bill.
Seven database-level tests cover it, including that a non-member cannot
exhaust another org's quota (the function is `SECURITY DEFINER`, so its
internal membership check is the only thing enforcing that) and that a member
cannot write the counters directly. Gated by `SEC-RATELIMIT` and
`SEC-RATELIMIT-RLS`.

**ANL-01a** costs 33 kB of shared First Load JS (103 → 136 kB). The first
build measured 185 kB; tree-shaking tracing and Session Replay via
`DefinePlugin` recovered 49 kB of that. Recorded rather than absorbed quietly,
because it works against PERF-01/PERF-02 — see **PERF-06**.

**API-01** validates shape *and bounds*. The bounds are the part that was
actually missing: the existing per-call-site reasoning about why untrusted
input is harmless was correct about trust and silent about size, so a caller
could hand `whyNowAction` 500 claims of 50 kB each and we would pay Opus to
read all of it. `SEC-VAL` now fails CI if any `"use server"` module skips
parsing — checked by falsification, not assumed.

**API-02b** turned out to need no code. Supabase already enforces magic-link
limits (2 emails/hour on the built-in sender, 30 OTPs/hour project-wide,
60-second per-user window, 360 verifications/hour per IP), and a second
limiter in the app would duplicate them while doing a worse job — a serverless
function cannot reliably identify the caller's IP. Documented in `SETUP.md`
instead, including the trap: moving to custom SMTP, which you must, makes the
email cap yours to set, and the protection then disappears quietly rather than
loudly.

**UI-06** also corrected a modelling error introduced by RL-01. "Unenforceable"
is no longer tagged as a rate limit, because from the user's side the two are
different events: one is their doing and passes with time, the other is a
deployment fault. Tagging both alike would have put a misconfiguration under
the heading "Too many requests" with a retry time that never arrives.

---

## Closed in the fourth pass — 2026-08-14

Everything the backlog listed as buildable without a hosted Supabase project.
Detail and measurements in the fourth-pass section of
[VERIFICATION.md](VERIFICATION.md).

| ID | Task | Effort |
|---|---|---|
| **SEC-03** | **Nonce CSP, report-only, with a rehearsed path to enforcing** | **L** |
| **TEST-02** | **Playwright: 68 tests, desktop + mobile, gating CI** | **L** |
| **TEST-02b** | **Scripted-client tests for the `lib/ai/*` wrappers** | **S** |
| **SEC-07** | **Next 15.5.23 → 16.3.1; all three advisories cleared** | **M** |
| **PERF-01** | **`next/link` throughout, via a `linkComponent` seam** | **S** |
| **PERF-02** | **Auth off the client SDK — 217 kB → 151 kB** | **M** |
| **ANL-01b** | **PostHog on the onboarding funnel, server-side, 0 kB** | **M** |
| **ANL-02** | **AI spend dashboard over `ai_runs`** | **M** |
| **ANL-03** | **Feedback/help links render only when configured** | **S** |
| **FEAT-04** | **Role-aware UI** | **M** |
| **SEO-04** | **`/` redirects to `/login`** | **S** |
| **SEO-05** | **`app/icon.svg`** | **XS** |
| **UI-04** | **Inter and JetBrains Mono, self-hosted via `next/font`** | **S** |
| **UI-05** | **`loading.tsx` at three route segments** | **S** |
| **A11Y-01** | **`DataTable` keyboard rows, with a unit test** | **XS** |
| **A11Y-02** | **Skip link** | **XS** |
| **A11Y-03** | **`eslint-plugin-jsx-a11y`** | **XS** |
| **REPO-06** | **`npm audit` in CI** | **XS** |
| **REPO-07** | **`CONTRIBUTING.md`** | **XS** |
| **RL-02** | **`prune_rate_limits()` scheduled, and tested** | **XS** |
| **PERF-06** | **Gzipped shared-bundle budget in CI** | **S** |
| **DB-02 / DB-03 / API-03** | **`docs/OPERATIONS.md`** | **S** |
| **NAV-02** *(new)* | **Audit check for placeholder hrefs — found 16** | **XS** |

### Notes on what closed

**SEC-03** ships **report-only**. That is the finished state of the task, not a
half-done one: a wrong CSP blocks one script on one route and the page
half-works, so it observes first. `CSP_ENFORCE=true` flips it, the full browser
suite passes under enforcement today, and `SETUP.md` step 8 has the procedure.
Two failures were found by running it that no reading would have produced —
prerendered pages cannot carry a per-request nonce, and
`upgrade-insecure-requests` is ignored in report-only mode and warns about it
on every page load.

**SEC-07** was done after TEST-02, as the roadmap required. It cost three
follow-on changes, all of which were silent: Turbopack ignores `webpack()`, so
the Sentry tree-shaking config had to move; `middleware.ts` became `proxy.ts`;
and `audit.mjs` read the old path, which would have made two checks pass by
reading an empty string.

**PERF-06** budgets **gzipped** shared chunks. The unit matters — the same
bundle is 787 kB raw and 245 kB gzipped — and the scope matters, for the reason
recorded below: the proxy bundle is 29 kB smaller in CI than in production.
This became urgent rather than optional because Next 16 no longer prints a
First Load JS column at all.

**FEAT-04** hides write affordances; it does not authorize. RLS is the
boundary and refuses the write regardless. The distinction is written into
`lib/data/membership.ts` so nobody later moves a policy out of Postgres to
match the UI.

**FEAT-02** closed because the thing it was waiting for arrived: a migrated
project with rows in it. `npm run db:seed` is the durable half of that — one
organisation, three companies chosen to exercise the states the UI must
distinguish (a fresh trigger with a named buyer, a stale one with no buyer,
three score dimensions left NULL), idempotent, and undone by `--reset`.

The refusal it replaced was worth its year. Writing the join blind would have
embedded `evidence`, which has no foreign key to embed through; would have
compared a URL segment against a `uuid` column, turning a stale bookmark into
a 500; and would have filtered soft deletes only at the top level. All three
are now comments in `lib/data/opportunities.ts`, next to the code that got
them right.

**FEAT-07** is the one to read if you read only one. Closing `FEAT-02` made the
data-source banner go quiet — correctly — and that banner was the only thing
marking the Command Center's hard-coded `180 discovered` and `2 meetings` as
invented. A database made the §7 problem *worse*. `DemoFigures` has no quiet
state and `FEAT-DEMO` fails the build without it, so the marking can now only
be removed by a visible edit rather than by a configuration change somewhere
else.

**DB-04** came out of connecting to a real project rather than from reading
code, which is the whole argument for doing so. `isSchemaApplied()` probes
`organizations` and answered "migrated" for a project missing `0005`, so the
app looked live while every model call threw an unreadable PostgREST error.
The limiter now recognises its own missing schema and takes the refusal path
it already had for "no database to count in" — same fail-closed behaviour, a
message the user can read, and a Sentry alert naming the migration. The probe
itself was deliberately left alone: widening it would hide real rows behind a
setup banner, which is worse. `npm run db:doctor` is the check.

---

## Closed in the sixth pass — 2026-08-15

| ID | Task | Effort |
|---|---|---|
| **DB-05** | **`0005` and `0006` applied to the configured project** | **XS** |

Applied by hand in the SQL editor, which is the only route available while
`DATABASE_URL` is empty — the publishable and secret keys talk to PostgREST,
which reads and writes rows and cannot execute DDL.

**Verified beyond the name.** `db:doctor` asks only whether PostgREST exposes
`consume_rate_limit`, which a stub would satisfy. The deployed function was
driven directly instead, and behaved like the file in this repo: it refused a
caller it could not identify (`P0001 · consume_rate_limit requires an
authenticated caller` — the guard that is load-bearing, because SECURITY
DEFINER bypasses RLS), `prune_rate_limits()` ran and returned a count, and the
refused call wrote **no** counter row, which places the membership guard before
the upsert where it belongs.

**What could not be verified from here**, and is now `DB-05b` above: `0006`'s
`pg_cron` schedule. `cron.job` is not exposed through PostgREST.

**What this did not unblock, contrary to the note it replaces.** `AI-01` still
needs a key. `isAiConfigured()` is checked *before* `resolveRecorder()` and
before the limiter in all four wrappers, so with no `ANTHROPIC_API_KEY` the
limiter is never reached — meaning the "every model-calling path refuses"
phrasing used across these documents was only ever true of a deployment that
*had* a key. Corrected in SETUP.md rather than left to be rediscovered.

---

## P0 — Before the next production deploy

**Nothing in code.** `SEC-03` was the last one.

The prediction in the previous pass — that the next P0 would come from a hosted
project — was right, and it did: connecting to one found `DB-04`, a partially
applied schema reporting as fully applied. That is fixed, and `DB-05`, the
paste it left behind, is done: all five migrations are applied and the
limiter has been driven against the live project.

The remaining human items are no longer *blocking* anything — they are keys
(`ANTHROPIC_API_KEY`, a Sentry DSN, `DATABASE_URL`) and one check in a SQL
editor.

---

## P1 — This cycle

### DB-05b · Confirm `0006` actually scheduled · **XS** · Phase 4
All that survives of `DB-05`, which is otherwise closed — see below.

`0006` creates no table and no function of its own; it schedules
`prune_rate_limits()` with `pg_cron`. `cron.job` is not reachable through
PostgREST, so neither `db:doctor` nor any script can see it, and PGlite has no
`pg_cron` so no test has ever exercised it. `select * from cron.job` in the SQL
editor is the only check there is, and it has not been run.

**If the list is empty**, `0006` printed a notice instead of scheduling and
`rate_limits` grows forever — a slow leak, not an outage, which is why it needs
a deliberate check rather than a wait-and-see.

### TEST-02c · Browser specs that need a real session · **M** · Phase 9
The Playwright suite runs in demo mode, which is a real configuration of this
app and the one CI builds — but it cannot reach:

- sign-in, and the OAuth callback
- the org membership guard's **404-not-403**, which is a security decision with
  no browser test
- `RateLimited` rendering, which needs 21 requests in an hour against a real
  limiter

**Now partly discharged, outside the suite.** The live opportunity queries and
the membership guard's 404 have both been driven in a real browser against the
seeded project — see the fifth pass in [VERIFICATION.md](VERIFICATION.md).
That is evidence, not a regression test: nothing re-runs it.

**Why it is still not in the suite.** `playwright.config.ts` builds with empty
Supabase credentials on purpose, and `NEXT_PUBLIC_*` are inlined at build time,
so one build cannot serve both modes. A live project means a second build with
real credentials into its own `distDir`, a second web server, and a Playwright
project pointed at it — which doubles CI's slowest step to cover paths CI has
no credentials for anyway. The shape that works is a `live` project gated on an
explicit base URL, run by a developer against a seeded project, not by CI.

**Depends on:** a seeded test user in *two* orgs — the 404 test needs an org
the user is not a member of, and `db:seed --slug other` provides it.

### AI-01 · Run the four tasks against the real API once · **S**
`research_company`, `recommend_sources`, `qualify_opportunity` and
`explain_why_now` are unit-tested against a scripted client and have **never
called Anthropic**. Every claim about their behaviour is a claim about the
scripted client.
**Depends on:** `ANTHROPIC_API_KEY`.

### OPS-01 · Enforce the CSP · **XS** · Phase 5
The policy ships report-only and the full browser suite passes under
`CSP_ENFORCE=true`, so the work is done and the *decision* is what remains.
Needs a Sentry DSN, then roughly a week of quiet reports.
**Procedure:** SETUP.md step 8.

### OPS-02 · Rehearse a restore · **S** · Phase 4
[docs/OPERATIONS.md](../docs/OPERATIONS.md) records the plan, the procedure and
what is *not* backed up. The unchecked box is the one that matters: restore
into a throwaway project once, end to end, and write down the measured RTO.
**Depends on:** a hosted project.

---

## P2 — Schedule

| ID | Task | Effort | Phase | Note |
|---|---|---|---|---|
| DB-03 | Generated Supabase types in CI | S | 4 | Design recorded in docs/OPERATIONS.md; needs a project ref and the first CI secret |
| PERF-04 | `EXPLAIN ANALYZE` the live list queries | S | 6 | Now measurable — the queries run against seeded rows. Needs `DATABASE_URL`; PostgREST cannot return a plan |
| UI-07 | A missing opportunity answers 200, not 404 | S | 2 | Streaming commits the status before `notFound()` runs. Fixing it costs the loading skeletons or a routing tree shaped around a status code — see FINDINGS.md |
| ANL-04 | Per-org AI budgets and alerting | M | 10 | The spend screen shows the bill; nothing acts on it. `rate_limits` bounds rate, not total |
| PERF-05 | Revisit per-worker schema-probe caches | XS | 6 | One extra round trip per cold start |
| API-03 | Build the versioned surface *when* an integration needs it | S | 4 | Decision recorded in docs/OPERATIONS.md; the work is deferred, not the decision |
| SEC-08 | Sanitization policy if model output is ever rendered as markup | — | 5 | Standing constraint, not a task |
| SEO-06 | A landing page for `/` | XL | 8 | `/` redirects to `/login` today — deliberate, and the honest minimum until there is copy worth serving |
| REPO-08 | Branch protection on `main` | XS | 1 | Needs a repo admin in the GitHub UI; checklist in CONTRIBUTING.md |

---

## Interface review — open items

The full pass is [UX-REVIEW.md](UX-REVIEW.md); six of its fourteen findings
closed in the commit that added it. These are the rest, and `UX-05` is the one
worth doing first — it is the only item in this backlog that changes what the
product *is* rather than how well it behaves.

| ID | Task | Effort | Note |
|---|---|---|---|
| **UX-05** | **A qualification can be saved, and lands on its detail page** | **M** | Analyze discards the most valuable thing the product produces. One insert plus one redirect turns four disconnected screens into a loop — and closes UX-03 by making the button real |
| UX-07 | Onboarding lands somewhere real | S | It currently ends on the Command Center, the one screen whose figures are entirely invented |
| UX-13 | `HoverPanel` opens on tap; fix the `pointer-events`/`overflow` contradiction | XS | Score and priority explanations are unreachable on a phone — the two places §51 and §77 P4 are discharged |
| UX-14 | A confirmation state, with undo | S | The sixth member of the `States.tsx` family. Every write added from here needs it |
| UX-09 | One priority control on `/opportunities`, not two | S | Four stat cards and five chips, same buckets, same counts — and the card is a link on one screen and inert on the next |
| UX-10 | Filter state in the URL via `history.replaceState` | S | The deep link is true on arrival and wrong after the first click. No `router.push`, so the stated objection does not apply |
| UX-11 | Promote the action rail below 1440px | S | "Needs you" sits ~2000px down on a 1280px laptop |
| UX-08 | Give row selection a verb, or remove it | S | Its only action was `Add to campaign`, now `pending` |
| UX-15 | A command palette | M | Optional. UX-02 removed the ⌘K affordance rather than building one; a dozen verbs have no screen of their own and a palette can host them first |

---

### Note on PERF-06 — why the budget measures what it measures

*Kept after PERF-06 shipped, because it is the reasoning behind the scope
of `scripts/bundle-budget.mjs` and would otherwise be re-derived.*

Measured 2026-08-13, same commit, same command, only the environment differing:

| | Shared First Load JS | Middleware |
|---|---|---|
| Empty Supabase credentials (what CI does) | 136 kB | **125 kB** |
| Real credentials (what production does) | 136 kB | **154 kB** |

`NEXT_PUBLIC_*` variables are inlined at build time, so with empty strings
webpack can prove `if (!url \|\| !key) return` is always taken in
`middleware.ts` and drops the entire Supabase client path after it. CI builds
with empty credentials **on purpose** — that step exists to prove nothing reads
the database at build time — so CI's middleware figure understates the
deployed one by 29 kB and always will.

A budget that reads CI's output would therefore be measuring a bundle nobody
ships. Either build a second time with placeholder non-empty values, or budget
only the shared client chunks, which are credential-independent.

---

## P3 — Opportunistic

*Emptied in the fourth pass — every item either shipped or moved up to P2,
where it now sits behind a stated dependency rather than behind "someday".*

---

## Accepted — not defects

| ID | Decision | Why it stands |
|---|---|---|
| REPO-05 | No Docker | Vercel + hosted Supabase + in-process PGlite. Nothing to containerize |
| UI-03 | Dark mode only | Deliberate; `color-scheme: dark` is set, and tokens make a second theme additive |
| FEAT-05 | Onboarding draft in `sessionStorage` | Designed as a seam; `sessionStorage` chosen over `localStorage` on purpose |
| FEAT-06 | `AgentPanel` has no model | Says so in the product rather than pretending |

---

## Dependency graph

**The root node is gone, and that is the useful thing to see.** Two versions of
this graph had "a hosted, migrated Supabase project" fanning out to five items.
It is now provisioned, migrated, seeded and verified, and every one of those
items has either closed or fallen back to a credential of its own:

```
ANTHROPIC_API_KEY ──────► AI-01     (four tasks that have never called the API)

Sentry DSN ─────────────► OPS-01    (a week of quiet CSP reports, then enforce)

DATABASE_URL ───────────┬─► PERF-04 (PostgREST will not return a query plan)
                        └─► DB-03   (type generation)

A seeded second org ────► TEST-02c  (the 404 guard needs an org you are not in)

select * from cron.job ─► DB-05b    (the half of 0006 nothing can see from code)
```

`FEAT-02`, `ANL-02` and `FEAT-04` are off the graph entirely — the first closed
when the rows arrived, and the other two shipped against fixtures with the live
branch written, so they lit up rather than needing to be built.

What is left has **no internal edges**: nothing above blocks anything else
above, so all five can be done in any order or none. **The backlog is no longer
the constraint, and neither is provisioning — what remains is four keys and a
query.** See [AGENT-REACH.md](AGENT-REACH.md) for what only a human can supply.
