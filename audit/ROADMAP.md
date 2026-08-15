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

Shipped during the audit. Baseline for everything below. R1 steps 1–2 have
since landed too; see that section.

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

## R1 — Make it safe to run in production · **Done**

**Goal:** the app can be exposed to real users and real money without anything
unbounded or unobserved.

| Order | Task | Status |
|---|---|---|
| 1 | **ANL-01a** Sentry | **Done** — server, edge, and client |
| 2 | **API-02** Rate limiting | **Done** — Postgres fixed-window, per-user and per-org, 7 tests |
| 3 | **RL-01** Close the unlimited-demo-mode configuration | **Done** — refuses when unenforceable *and* production |
| 4 | **API-01** `zod` on action inputs | **Done** — shape and bounds; found a `FormData` coercion bug |
| 5 | **API-02b** Magic-link limits | **Done** — no code needed; Supabase enforces them, documented |
| 6 | **UI-06** Render refusals as `RateLimited` | **Done** |
| 7 | **SEC-03** Nonce CSP | **Done** — report-only, with a rehearsed path to enforcing |
| 8 | **REPO-06** `npm audit` in CI | **Done** |
| 9 | **SEO-05** `app/icon.svg` | **Done** |

**Exit criteria, and where each stands:**

- `npm run audit:site` has zero `SEC-*` warnings — **met.**
- A deliberately thrown error appears in Sentry — **not met.** Needs a real
  DSN, and it is still the first thing to do after provisioning, because the
  wiring is verified only by build and types. The CSP report endpoint depends
  on it too.
- A load test against `analyzeUrlAction` is bounded — **not run.** The limiter
  is proven at the database level by seven tests; nothing has driven it through
  HTTP.

---

## R2 — Make it real · blocked on provisioning

**Goal:** the product stops rendering fixtures and starts being testable
against real rows.

| Order | Task | Status |
|---|---|---|
| 1 | **TEST-02** Playwright | **Done** — 68 tests, desktop + mobile, gating CI |
| 2 | **TEST-02b** Scripted-client tests for `lib/ai/*` | **Done** — SEC-01 is now "cannot regress", verified by falsification |
| 3 | **FEAT-02** Live opportunity queries | **Blocked** — needs a migrated project with seed data |
| 4 | **FEAT-04** Role-aware UI | **Done** — shipped against fixtures, live branch written |
| 5 | **PERF-01** `next/link` | **Done** |

Steps 1, 2, 4 and 5 landed ahead of the ordering, because none of them needed a
database. Step 3 is the whole of what is left, and the reason it is left is
recorded in `lib/data/opportunities.ts`: writing that join blind produces a
query that reads as finished and has never returned a row.

**Exit:** `audit.mjs` `FEAT-FIXTURE` passes. It is the only warning left.

---

## R3 — Make it observable and pleasant · **Done**

| Order | Task | Status |
|---|---|---|
| 1 | **ANL-01b** PostHog — onboarding funnel first | **Done** — server-side, 0 kB of client bundle |
| 2 | **ANL-02** Cost dashboard over `ai_runs` | **Done** |
| 3 | **SEC-07** Next 15 → 16 | **Done** — all three advisories cleared |
| 4 | **UI-04** Fonts | **Done** — Inter and JetBrains Mono self-hosted |
| 5 | **UI-05** `loading.tsx` | **Done** — three route segments |
| 6 | **A11Y-01/02/03** | **Done** |
| 7 | **PERF-02** Auth off the client SDK | **Done** — 217 kB → 151 kB |

**On the ordering:** the Next upgrade stayed at position 3, after R2 delivered
Playwright, and that was the right call — it needed three follow-on changes
that were all silent, and the browser suite is what proved the app still
worked. See the fourth pass in [VERIFICATION.md](VERIFICATION.md).

**Exit:** onboarding drop-off is instrumented per step. Spend per org has a
screen. Zero high-severity advisories. All met — though the funnel emits
nothing until `NEXT_PUBLIC_POSTHOG_KEY` is set, and the spend screen shows demo
figures until there is a database.

---

## R4 — Position it · mostly done

**Goal:** the product has a front door.

| Task | Status |
|---|---|
| **SEO-04** Decide what `/` serves | **Done** — redirects to `/login` |
| **DB-02** Backup / PITR / recovery | **Documented, not rehearsed** — `docs/OPERATIONS.md` |
| **DB-03** Generated Supabase types in CI | **Designed, blocked** — needs a project ref, and would be CI's first secret |
| **REPO-07** Branch strategy | **Done** — `CONTRIBUTING.md`; protection still needs a repo admin |
| **API-03** API versioning | **Decided** — no public API; Server Actions are not one. Recorded in `docs/OPERATIONS.md` |
| **ANL-03** Feedback link | **Done** — renders only when `NEXT_PUBLIC_FEEDBACK_URL` is set |

`/` now redirects to `/login`, which is the honest minimum for an
authenticated product with no public content: it stops the internal component
gallery being the canonical URL, the Open Graph `url`, and the first thing
every crawler and visitor saw.

A real landing page is `SEO-06` in the backlog rather than a line here, because
it is a marketing project with an effort range from a day to a fortnight and
padding an engineering roadmap with it helps nobody.

Once there is public content, re-run Phase 8 properly — the content-SEO half
of that phase is genuinely N/A today, and will not be then.

---

## R5 — What only provisioning unblocks

Nothing in this release is engineering-limited. Every item is waiting on a
credential or a hosted service, and they are listed here so that the roadmap
does not read as though work remains where it does not.

| Needs | Unblocks |
|---|---|
| A migrated Supabase project with seed data | `FEAT-02`, `TEST-02c`, `DB-03`, `OPS-02`, and the first real `ANL-02` figures |
| `ANTHROPIC_API_KEY` | `AI-01` — four tasks that have never called the real API |
| A Sentry DSN | `OPS-01` — a week of quiet CSP reports, then `CSP_ENFORCE=true` |
| `NEXT_PUBLIC_POSTHOG_KEY` | The onboarding funnel emitting anything at all |

See [AGENT-REACH.md](AGENT-REACH.md) for the full account of what only a human
can provide.

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
