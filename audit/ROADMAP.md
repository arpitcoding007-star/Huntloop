# Implementation roadmap

The [backlog](BACKLOG.md) sequenced. Four releases, ordered by one rule:

> **Nothing that costs money or leaks data ships un-instrumented, and nothing
> gets upgraded before something can tell you it broke.**

That single rule produces most of the ordering below. Sentry comes before CSP
because a CSP needs somewhere to send violation reports. Playwright comes
before the Next 16 upgrade because upgrading a framework with no end-to-end
tests is how a subtle regression reaches production. Rate limiting comes before
the live queries because the expensive paths should be bounded before more of
them exist.

Effort totals assume one engineer. They are the sum of the tasks, with no
allowance for review, discovery, or the live-Supabase dependency — treat them
as a floor.

---

## R0 — Done

Shipped during the audit. Baseline for everything below.

**The critical fix:** model calls now refuse when the caller's org cannot be
resolved. Before this, any caller naming an org slug they didn't belong to got
a real Opus call with `web_fetch`, billed to us and recorded against nothing.

Also: security headers · `error.tsx` / `global-error.tsx` / `not-found.tsx` ·
`robots.ts` / `sitemap.ts` / `metadataBase` / Open Graph · crawler routes
excluded from the auth guard · 12 dead nav links marked unbuilt ·
documentation reconciled with reality · **`scripts/audit.mjs`, 32 checks,
gating CI**.

The last one is the durable part. Every finding closed above now has a check
behind it, so it fails a build rather than reappearing quietly.

---

## R1 — Make it safe to run in production · ~1.5 weeks

**Goal:** the app can be exposed to real users and real money without anything
unbounded or unobserved.

| Order | Task | Effort | Why here |
|---|---|---|---|
| 1 | **ANL-01a** Sentry | S | Everything after this is easier to debug, and a Server Component crash is currently invisible |
| 2 | **API-02** Rate limiting | M | SEC-01 closed the unauthenticated hole; an authenticated member can still loop a billable Opus call |
| 3 | **API-01** `zod` on action inputs | S | Public POST endpoints, runtime-unvalidated. Makes structural what is currently argued per call site |
| 4 | **SEC-03** Nonce CSP | L | Report-only for a week first. Needs Sentry (step 1) for reports |
| 5 | **REPO-06** `npm audit` in CI | XS | Cheap; nothing currently surfaces advisories |
| 6 | **SEO-05** `app/icon.svg` | XS | Cheap; stops every browser 404ing on `/favicon.ico` |

**Exit:** `npm run audit:site` has zero `SEC-*` warnings. A load test against
`analyzeUrlAction` is bounded. A deliberately thrown error appears in Sentry.

---

## R2 — Make it real · ~2 weeks

**Goal:** the product stops rendering fixtures and starts being testable.

Requires a migrated Supabase project with seed data — see
[AGENT-REACH.md](AGENT-REACH.md) for what only a human can provide.

| Order | Task | Effort | Why here |
|---|---|---|---|
| 1 | **TEST-02** Playwright: sign-in → onboarding → analyze | L | Everything after this is safer. Do it *before* FEAT-02 so the live queries land against a suite |
| 2 | **TEST-02b** Scripted-client tests for `lib/ai/*` wrappers | S | Converts SEC-01 from "fixed" to "cannot regress". Reuses the pattern `packages/ai` already has |
| 3 | **FEAT-02** Live opportunity queries | L | The largest functional gap. Deliberately deferred until there is a database to run against |
| 4 | **FEAT-04** Role-aware UI | M | Wants real data to gate. A viewer currently sees write actions that fail at the database |
| 5 | **PERF-01** `next/link` | S | Independent, but pairs naturally with touching these screens |

**Exit:** `audit.mjs` `FEAT-FIXTURE` and `PERF-01` pass. The dashboard and both
opportunity screens read Postgres. CI runs a browser suite.

---

## R3 — Make it observable and pleasant · ~1.5 weeks

**Goal:** you can see what users do, and the app feels finished.

| Order | Task | Effort |
|---|---|---|
| 1 | **ANL-01b** PostHog — onboarding funnel first | M |
| 2 | **ANL-02** Cost dashboard over `ai_runs` | M |
| 3 | **SEC-07** Next 15 → 16 (clears all 3 advisories) | M |
| 4 | **UI-04** Load the fonts, or drop them from the token | S |
| 5 | **UI-05** `loading.tsx` at route segments | S |
| 6 | **A11Y-01/02/03** Skip link · `DataTable` keyboard · `jsx-a11y` | S total |
| 7 | **PERF-02** Auth pages off the client Supabase SDK | M |

**On ordering:** the Next upgrade sits at position 3, after R2 delivered
Playwright. Doing it earlier would mean upgrading a major framework version
with no end-to-end coverage.

**On ANL-02:** the schema, the pre-call write invariant, and the cache-aware
cost model are all already built. This is the screen that was never written —
unusually high value for M effort.

**Exit:** onboarding drop-off is visible per step. Spend per org is visible.
Zero high-severity advisories. `audit.mjs` runs with `--strict` and passes.

---

## R4 — Position it · scope TBD

**Goal:** the product has a front door.

| Task | Effort |
|---|---|
| **SEO-04** Decide what `/` serves — landing page, or redirect to `/login` | S–XL |
| **DB-02** Document backup / PITR / recovery, and test a restore | S |
| **DB-03** Generated Supabase types in CI | S |
| **REPO-07** Branch strategy and protection | XS |
| **API-03** API versioning decision, before any external integration | S |
| **ANL-03** Wire up the feedback link | S |

`SEO-04` is a product decision with a wide effort range, which is why it is
isolated here rather than padding an engineering estimate. Until it lands,
`https://huntloop.example/` serves the internal component gallery to every
crawler and first-time visitor.

Once there is public content, re-run Phase 8 properly — the content-SEO half
of that phase is genuinely N/A today, and will not be then.

---

## Re-audit cadence

The program is only worth what its last run proved.

| When | What |
|---|---|
| Every PR | `npm run audit:site` — automatic, gating |
| Every release | Re-run the phases the release touched. Add a script check for each finding closed |
| Quarterly | Full 10-phase pass. Update `FINDINGS.md`, re-baseline the backlog |
| On new integration | Phase 5 in full, plus Phase 1 for the new configuration surface |

The quarterly pass exists to catch what a script cannot: whether the
information architecture still matches the product, whether the roadmap is
still the right one, and whether decisions recorded as **Accepted** are still
the right trade-offs. Three are on file today — re-examine each one rather than
assuming it carries forward.
