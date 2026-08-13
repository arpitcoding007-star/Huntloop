# Final verification report

**Date:** 2026-08-13 · **Baseline commit:** `4e1309a` · **Branch:** `main`

> **Second pass appended at the end** — rate limiting (`API-02`) and error
> reporting (`ANL-01a`). The tables immediately below describe the first pass;
> current totals are 39 database checks and 34 audit checks.

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
