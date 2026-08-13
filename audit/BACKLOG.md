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
| AUDIT-00 | `scripts/audit.mjs` — 32 checks, gating CI | M |
| WHYNOW-01 | Latent uuid bug: slug passed where an org id was expected | XS |

---

## P0 — Before the next production deploy

Nothing here is optional. Each is either a security or cost control, or the
thing that tells you when one has failed.

### SEC-03 · Nonce-based Content-Security-Policy · **L** · Phase 5
Generate a per-request nonce in middleware, thread it to the document, emit
`script-src 'nonce-…' 'strict-dynamic'`. Report-only first, for at least a
week, before enforcing.
**Why L, not S:** Next injects inline bootstrap scripts. `unsafe-inline`
certifies nothing, so a real CSP means nonce plumbing plus a report endpoint,
and it breaks production silently when wrong.
**Depends on:** ANL-01 (needs somewhere to send violation reports).
**Done when:** `audit.mjs` `SEC-CSP` passes.

### API-02 · Rate limiting on Server Actions and auth · **M** · Phase 4
Per-user and per-org limits on the four model-calling actions; per-IP limits on
magic-link requests. `RateLimited` already exists in the design system, unused.
**Why:** `SEC-01` closed the unauthenticated hole. An authenticated member can
still loop `analyzeUrlAction`, and every call is a billable Opus request.
**Blocks:** nothing. **Depends on:** nothing (Upstash/Vercel KV, or Postgres).

### ANL-01a · Error reporting (Sentry) · **S** · Phase 10
Wire `SENTRY_DSN` (already reserved). Report from `error.tsx`, `global-error.tsx`,
and Server Actions.
**Why P0:** the new error boundary currently `console.error`s, which in
production is nobody. Every finding below is harder to work on without this,
and a Server Component crash is invisible today.

### API-01 · Runtime validation on Server Action inputs · **S** · Phase 4
Add `zod`; parse every action argument at the boundary.
**Why:** Server Actions are public POST endpoints and TypeScript is erased at
runtime. The existing per-call-site reasoning about why untrusted input is
harmless is sound but hand-derived; this makes it structural.
**Done when:** `audit.mjs` `SEC-VAL` passes.

---

## P1 — This cycle

### PERF-01 · Client-side navigation · **S** · Phase 6
Add a `linkComponent` prop to `Sidebar`/`TopBar` (keeping `packages/ui`
framework-agnostic, which was the original and correct reason for raw `<a>`),
and pass `next/link` from `apps/web`. Convert the 7 internal anchors in
`apps/web/app`.
**Why P1 and not P2:** every internal navigation is currently a full document
reload. Largest user-perceived performance win available, at S effort.
**Done when:** `audit.mjs` `PERF-01` passes.

### TEST-02 · End-to-end suite · **L** · Phase 9
Playwright, first spec covering sign-in → onboarding → analyze.
**Why:** no frontend test of any kind exists. The `next` redirect validation is
a security control with no test. `SEC-01` lived in exactly the layer that has
no coverage.
**Second spec:** the `apps/web/lib/ai/*` wrappers with a scripted `ModelClient`
— the pattern `packages/ai` already uses — asserting each refuses an
unresolvable org. That converts SEC-01 from "fixed" to "cannot regress".

### FEAT-02 · Live opportunity queries · **L** · Phase 3
Finish `listOpportunities()` and `getOpportunity()` against real rows, joining
evidence, triggers, and buyers for the §47 page.
**Why not sooner:** deliberately unfinished, for a good documented reason —
writing the join blind produces a query that reads as finished and has never
returned a row. Needs a live Supabase project with seed data.
**Depends on:** a migrated project (see [AGENT-REACH.md](AGENT-REACH.md)).
**Done when:** `audit.mjs` `FEAT-FIXTURE` passes.

### SEO-04 · Decide what `/` serves · **S** (+ design) · Phase 8
Today it redirects to the design-system gallery — which is the canonical URL,
the Open Graph `url`, and the first thing any visitor sees.
**Product decision, not a code change.** Minimum viable: redirect to `/login`
for authenticated-product positioning. Better: an actual landing page.

### FEAT-04 · Role-aware UI · **M** · Phase 3
`resolveMembership()` already returns the role and no screen reads it. A viewer
sees write actions that fail at the database. `PermissionDenied` exists, unused.
**Not a security finding** — RLS holds. A UX one.

### ANL-01b · Product analytics · **M** · Phase 10
PostHog (`NEXT_PUBLIC_POSTHOG_KEY` reserved). Instrument the onboarding funnel
first: it is a four-step pipeline where each step feeds the next, and nothing
measures where people drop out.

### UI-04 · Load the fonts, or stop declaring them · **S** · Phase 2
`next/font` for Inter and JetBrains Mono, **or** delete them from the token and
commit to the system stack. Either is fine; the current state promises a font
it does not deliver, and the type scale was tuned against Inter.

### SEC-07 · Next 15 → 16 · **M** · Phase 5
Clears all three high-severity advisories. Semver-major; schedule with time to
test rather than as an `audit fix --force`.
**Do after TEST-02** — upgrading a framework with no end-to-end tests is how a
subtle regression ships.

---

## P2 — Schedule

| ID | Task | Effort | Phase | Note |
|---|---|---|---|---|
| A11Y-02 | Skip link to `<main>` | XS | 7 | ~17 nav items before content on every page |
| A11Y-01 | Keyboard support for `DataTable` clickable rows | XS | 7 | Latent — no current caller, but a trap for the next |
| A11Y-03 | `eslint-plugin-jsx-a11y` | XS | 7 | Current quality came from care; care doesn't survive turnover |
| SEO-05 | `app/icon.svg` | XS | 8 | Every browser currently 404s on `/favicon.ico` |
| REPO-06 | `npm audit` gate in CI | XS | 1 | Nothing would have surfaced SEC-07 |
| UI-05 | `loading.tsx` at route segments | S | 2 | Most visible on `/analyze` — tens of seconds |
| PERF-02 | Move auth off the client Supabase SDK | M | 6 | 180 kB vs 103 kB baseline, on the first page visitors load |
| ANL-02 | Cost dashboard over `ai_runs` | M | 10 | Schema and cost model done; no screen reads it |
| DB-02 | Document backup / PITR / recovery | S | 4 | Untested backups are not backups |
| DB-03 | Generated types in CI | S | 4 | Hand-written types can drift with nothing detecting it |
| REPO-07 | Document branch strategy + protection | XS | 1 | Fine for one developer; write it down before two |

---

## P3 — Opportunistic

| ID | Task | Effort | Phase |
|---|---|---|---|
| API-03 | API versioning decision (before any external integration) | S | 4 |
| PERF-04 | `EXPLAIN ANALYZE` the live list queries | S | 6 |
| PERF-05 | Revisit per-worker schema-probe caches | XS | 6 |
| ANL-03 | Wire up the feedback link | S | 10 |
| SEC-08 | Sanitization policy if model output is ever rendered as markup | — | 5 |

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

```
ANL-01a (Sentry) ──────► SEC-03 (CSP needs a report endpoint)

TEST-02 (E2E) ─────────► SEC-07 (don't upgrade a framework untested)

Live Supabase project ─► FEAT-02 ──► PERF-04 (can't profile queries that don't run)
                                └──► ANL-02 (dashboard needs rows)

FEAT-02 ───────────────► FEAT-04 (role-aware UI wants real data to gate)
```

Everything else is independent and parallelizable.
