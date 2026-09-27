---
description: What is tested, what is deliberately not, and the gates that stand between a branch and main.
---

# Testing

> **Layer:** Developer / Internal · **Audience:** engineering

## The numbers

Verified by running the suites on 2026-09-16.

| Suite | Runner | Count | Proves |
|---|---|---|---|
| `packages/db` migrations | PGlite | **236** | Schema rules, constraints, **cross-tenant isolation** |
| `packages/db` rules | Node | **59** | The scoring-rule evaluator |
| `packages/db` pure | Node | **121** | Identity, ICP, discovery translation, contact, crypto |
| `packages/db` admin-import check | Node | — | `apps/` never imports the service-role client |
| `packages/jobs` | Node | **199** | Queue, runner, handlers, mailbox adapters |
| `packages/ai` | Node | **198** | Prompts, schemas, claim validation, all 12 tasks |
| `packages/providers` | Node | **81** | Adapters, cache, budget, breaker, registry routing |
| `packages/crm` | Node | **20** | HubSpot contract |
| `apps/web` | Vitest | **108** | CSV, validation, rate limit, safe-next, ICP, opportunity map, spend guard |
| `packages/ui` | Vitest + jsdom | **22** | Sidebar, DataTable, HoverPanel |
| **Total `npm test`** | | **1,024** | |
| `e2e/` | Playwright | **90** | Routing, headers, CSP, app shell, modules, engage |
| `scripts/audit.mjs` | Node | **40** | Repository, security, SEO, routes |

## The isolation suite

The most important thing in the repository.

```bash
npm test   # includes it
```

It runs all 28 migrations against **PGlite** — Postgres in-process, no server
and no Docker — then asserts the rules the schema is supposed to enforce:

* A **fact cannot exist without a source**.
* An unmeasured score dimension stays `NULL` rather than becoming `0`.
* A scoped memory cannot be subject-less.
* Two rules with the same `effect` and different `intent` behave identically.
* **Org A cannot read or write org B** — run as a **non-superuser** role, so
  RLS genuinely applies.

{% hint style="info" %}
PGlite is the reason this always runs. An isolation test that only runs when
someone remembers to point it at staging is an isolation test that stops
running.
{% endhint %}

## Browser tests

```bash
npx playwright test
```

Two projects — **desktop** (Desktop Chrome) and **mobile** (Pixel 7) — because
the responsive drawer is real behaviour and a viewport project is the cheapest
way to keep it working. Chromium only: the suite asserts routing, headers,
focus order and responsive behaviour, none of which is engine-specific.

| Spec | Covers |
|---|---|
| `smoke.spec.ts` | The app loads |
| `routing.spec.ts` | Public prefixes, redirects, 404s |
| `app-shell.spec.ts` | Nav, drawer, skip link, focus order |
| `modules.spec.ts` | Every `/[org]` destination renders |
| `engage.spec.ts` | Outreach, inbox, pipeline |
| `csp.spec.ts` | The nonce-based policy, including under `CSP_ENFORCE=true` |

### The server runs with empty Supabase credentials

Not a shortcut. With no credentials the app runs in demo mode: the proxy passes
everything through, loaders return fixtures, and a banner says so. That makes
the entire UI reachable without a login, so the specs can cover the shell,
navigation, filters and accessibility **without ever handling anyone's
credentials** — and it is exactly the configuration CI builds.

{% hint style="warning" %}
**The empty strings are load-bearing.** `@next/env` skips any variable already
present in `process.env`, and an empty string counts as present — so they
override a developer's real `.env.local`. Without them this suite would pass
locally while testing a different application than it tests in CI.
{% endhint %}

### What it therefore does not cover

Stated plainly rather than left to be discovered: **real sign-in, the OAuth
callback, and the membership guard's 404.** All three need a live Supabase
project.

## The repository audit

```bash
npm run audit:site
```

40 checks across nine phases. The mechanizable half of the audit program — a
nav link onto a 404, a missing security header, a model-calling path that does
not resolve its org — comes back as a failing CI step rather than as a document
nobody re-reads.

| Phase | Checks |
|---|---|
| 1 Repository | `REPO-01` Node floor matches · `REPO-02` every env var the code reads is in `.env.example` · CI runs typecheck/lint/test/build |
| 2 Frontend | `UX-404`, `UX-ERR`, `UX-GERR` — the three error boundaries exist |
| 3 Features | `NAV-01` no nav link onto a 404 · `NAV-02` no placeholder `href` · `NAV-03` every button acts, navigates, submits, or says why it cannot · `FEAT-FIXTURE` · `FEAT-DEMO` |
| 4 Backend | `PRV-CHK` no vendor named outside its adapter |
| 5 Security | Five header checks · `SEC-CSP` · `SEC-CSP-MODE` · `SEC-ADMIN` · `SEC-SPEND` · `SEC-RATELIMIT` · `SEC-QUOTA` · `SEC-RATELIMIT-RLS` · `SEC-VAL` |
| 6 Performance | `PERF-01` internal links use `next/link` |
| 8 SEO | `SEO-ROBOTS` · `SEO-SITEMAP` · `SEO-BASE` · `SEO-OG` · `SEO-MW` · `SEO-ICON` |
| 9 Testing | Every workspace has a test script · `TEST-E2E` |

`--strict` promotes warnings to failures; `--json` emits machine-readable
output.

## Everything at once

```bash
npm run verify
```

`typecheck` → `lint` → `test` → `audit:site` → `build` → `audit:bundle`.

## CI

Two parallel jobs, both gating, in `.github/workflows/ci.yml`.

**`verify`** — typecheck, lint, `npm test`, `audit:site`, `npm audit
--audit-level=high` *(reports; does not block)*, build with **empty
credentials**, bundle budget.

**`e2e`** — split out because installing a browser has no business delaying
feedback from typecheck and lint.

{% hint style="info" %}
The build runs with empty Supabase credentials on purpose: **if that step starts
failing without them, something has begun reading the database at build time**,
which would also break preview deploys.
{% endhint %}

`npm audit` is set to `--audit-level=high` rather than the default `low`,
because a gate that fires on every low-severity transitive advisory gets
disabled within a month — and a disabled gate protects nothing. It is
`continue-on-error` because a new advisory can be published against an
unchanged dependency tree, and that must not turn an unrelated PR red.

## What is deliberately untested

| Gap | Why it matters |
|---|---|
| **No AI task has called the real API** | All 12 are tested against a scripted client. Live behaviour is unverified |
| **No load test** | The rate limiter is proven by database-level tests and by nothing driving it through HTTP |
| **No live vendor call** | Apollo, Hunter, ZeroBounce and HubSpot have never been called with a real key in a verified environment |
| **No schema-drift check in CI** | `packages/db/src/types.ts` is maintained by hand |

## Writing a test

* **Schema or constraint?** `packages/db/scripts/verify-migrations.ts`.
* **Pure domain logic?** `verify-pure.ts` or `verify-rules.ts` — no framework.
* **A job handler?** `packages/jobs/scripts/verify-jobs.ts`, with a stubbed
  scope.
* **A prompt or parser?** `packages/ai/scripts/verify-tasks.ts`, with a scripted
  client.
* **A React component?** Vitest + Testing Library in the owning package.
* **A route, a header, or focus order?** Playwright.
* **A rule that should hold across the whole repo?** A check in
  `scripts/audit.mjs` — that is where "this must never regress" belongs.

## Related

* [Code conventions](conventions.md)
* [Development setup](setup.md)
