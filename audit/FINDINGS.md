# Huntloop — full audit findings

**Date:** 2026-08-13 · **Commit at audit start:** `4e1309a` · **Branch:** `main`
**Scope:** the whole repository — 120 tracked files, 4 workspaces.

Findings carry a stable ID (`AREA-nn`) used by [BACKLOG.md](BACKLOG.md).
Status is one of **Fixed** (done in this pass, verified), **Open**, or
**Accepted** (a real trade-off, deliberately kept).

---

## Verdict

This is a well-engineered codebase, and saying so plainly matters because it
changes what the audit is *for*. The typical audit of a project at this stage
finds an absent tenant boundary, a service-role key in a client bundle, and
`any` sprayed across the data layer. None of that is here.

What is here instead:

- Tenant isolation is enforced in Postgres via RLS, and **31 automated checks
  prove it** — including a test that runs as a non-superuser so the policies
  genuinely apply, and asserts that org A cannot read or write org B.
- The single largest risk (the service-role client reaching a request path) is
  blocked by *two* independent mechanisms, on purpose.
- Epistemics — fact / inference / unknown — are enforced at three layers:
  CHECK constraints in the database, validation at the model boundary, and
  distinct colours in the design system.
- Typecheck, lint, tests, and build were all green before this audit began.

So the findings below are not "this is broken". They cluster into three real
themes:

1. **Cost and abuse control is the weak axis, not tenant isolation.** RLS
   protects *rows*. It does not protect the Anthropic bill. The one Critical
   finding is exactly this gap — and it was reachable in production.
2. **The product asserts capabilities it does not have.** Twelve of seventeen
   nav destinations returned 404. Two screens still render fixtures. The README
   described a state two releases stale — in both directions.
3. **Everything a browser needs and a compiler doesn't was absent.** No 404
   page despite `notFound()` being a deliberate security decision. No error
   boundary despite the data layer deliberately throwing. No security headers,
   no robots policy, no metadata base.

**18 fixed · 13 open · 3 accepted.**

> **Update — third pass.** `RL-01`, `API-01`, `API-02b` and `UI-06` are now
> closed too, leaving `SEC-03` (a nonce-based CSP) as the only P0 item. Detail
> in the third-pass section of [VERIFICATION.md](VERIFICATION.md).
>
> **Update — second pass.** `API-02` (rate limiting) and `ANL-01a` (error
> reporting) have since been closed; both are marked Fixed below with what
> was built and what it cost. Two new items came out of that work: `RL-01`, a
> residual configuration where the limiter cannot be enforced, and `PERF-06`,
> a bundle budget — because Sentry added 33 kB and nothing would have caught
> it. The suite is now 39 database checks and 34 audit checks.

| Phase | Critical | High | Medium | Low |
|---|---|---|---|---|
| 1 Repository & infrastructure | – | – | 2 | 2 |
| 2 Frontend | – | 2 | 3 | 1 |
| 3 Features | – | 2 | 2 | – |
| 4 Backend | – | 1 | 3 | – |
| 5 Security | **1** | 2 | 3 | 1 |
| 6 Performance | – | 1 | 2 | 1 |
| 7 Accessibility | – | – | 2 | 1 |
| 8 SEO | – | 2 | 1 | 1 |
| 9 Testing | – | 1 | 2 | – |
| 10 Analytics & growth | – | 1 | 1 | – |

---

# Phase 1 — Repository & infrastructure

**Structure: strong.** npm workspaces, four packages with clean boundaries and
a defensible dependency direction. `packages/ai` deliberately does not import
`packages/db` — so it cannot become a second path to the database, and
therefore cannot become a second path around RLS. That is an architectural
decision, documented at the point it is made, and it is correct.

No duplicate code of consequence. No unused dependencies. Naming is consistent.
Comment quality is unusually high: comments explain *why*, and several record
the alternative that was rejected and the reason.

### REPO-01 · Documentation described a state two releases stale — **Fixed**
`README.md`

The README's Status section said "**No page reads the database yet** — every
screen renders fixtures, and there is no auth."

Both halves were false. Authentication is fully implemented (magic link +
Google OAuth, `middleware.ts` route guard, `auth/callback`, POST-only
sign-out). Several paths read the database — `resolveMembership` in the org
layout, `getActiveIcp`, the `ai_runs` recorder.

This is worse than an ordinary stale doc. The README is the file that tells a
reviewer what to trust, and it was understating the product in a way that would
send someone to rebuild auth that already exists.

Rewritten to state precisely what works end-to-end, what still renders
fixtures, and that twelve nav destinations are unbuilt.

### REPO-02 · Node version floor contradicted itself — **Fixed**
`README.md:66` vs `package.json`

README said "Requires Node 20+"; `engines` said `>=22.6`; CI runs 22. The floor
is genuinely 22.6, because `packages/ai` and `packages/db` run their suites
under `node --experimental-strip-types`. On Node 20 the test command fails with
an unhelpful error. Corrected, with the reason stated.

Now enforced by `audit.mjs` `REPO-01`, which parses both and compares.

### REPO-03 · `.env.example` named a key the code does not primarily read — **Fixed**
`README.md:121`

README instructed setting `SUPABASE_SERVICE_ROLE_KEY`. `packages/db/src/env.ts`
reads `SUPABASE_SECRET_KEY` first and treats the other as a legacy fallback.
Someone following the README on a new Supabase project sets the alias, not the
name the codebase documents everywhere else.

Corrected. Both legacy aliases are now listed in `.env.example` as explicitly
legacy, which also clears the `REPO-02` automated warning honestly rather than
by suppression.

### REPO-04 · `NEXT_PUBLIC_SITE_URL` was neither defined nor documented — **Fixed**

No canonical origin existed anywhere, which is why `metadataBase` was absent
(see `SEO-01`). Added `apps/web/lib/site-url.ts` with a documented resolution
order, and the variable to `.env.example` and the Vercel section of the README.

Note the choice of `VERCEL_PROJECT_PRODUCTION_URL` over `VERCEL_URL` as the
fallback: `VERCEL_URL` is the *per-deployment* host, so using it would publish
a throwaway preview domain in canonical tags.

### REPO-05 · No containerization — **Accepted**

No Dockerfile or compose file. This is correct for the current target: Vercel
for the app, hosted Supabase for the database, and PGlite (in-process) for the
test suite — so there is no service to containerize and no "works on my
machine" gap that Docker would close. Revisit only if self-hosting becomes a
requirement.

### REPO-06 · CI has no dependency-vulnerability gate — **Open** (Low)
`.github/workflows/ci.yml`

CI runs typecheck, lint, test, and build (and now `audit:site`), but never
`npm audit`. See `SEC-07` — there are three high-severity advisories in the
tree today and nothing would have surfaced them.

### REPO-07 · Branch strategy is undocumented — **Open** (Low)

Work commits directly to `main`. CI runs on `push` to main and on pull
requests, so the machinery for a PR-based flow exists but nothing states the
intent, and no branch protection is configured. Fine for one developer;
worth writing down before there are two.

---

# Phase 2 — Frontend

**Design system: genuinely good.** 18 components, ~2,500 lines, driven by a
single canonical token file. Tokens are semantic rather than literal
(`--color-fg-muted`, not `--gray-500`). Spacing, radius, duration, and
elevation are all scaled, and elevation is deliberately constrained to exactly
one shadow.

The colour system carries real meaning: green = source-verified fact, violet =
model inference, gray = unknown. Priority always ships with a word *and* a dot
alongside the hue, so nothing is communicated by colour alone. There is a
`/kitchen-sink` gallery, which is why the system stayed consistent.

Contrast has been measured rather than assumed — `tokens.css` documents that
the previously-specified muted grey was recorded as 4.6:1 but *measured* at
3.57:1, and was corrected to `#949494` with the ratio against all five surfaces
listed. That is the right way to do it.

### UI-01 · No route-level error boundary — **Fixed**
Added `apps/web/app/error.tsx`, `global-error.tsx`

There was no `error.tsx` anywhere in the app. This mattered more here than in a
typical app, because the data layer **deliberately throws**:
`lib/data/source.ts` refuses to downgrade to fixtures on a database error, on
the correct reasoning that a configured deployment silently showing invented
pipeline numbers is worse than an error. That is the right behaviour — but the
throw had nowhere to land except Next's default screen, which in production
reads only "Application error".

The boundary renders `error.digest`, not `error.message`: Next replaces
server-side messages with a digest in production precisely so a database error
string cannot reach the browser, and printing the message would surface
whatever survived that.

`global-error.tsx` was added too, for the case where the root layout itself
throws. It renders its own `<html>`/`<body>` with inline styles and no
dependency on `@huntloop/ui` or Tailwind — a boundary whose job is to work when
nothing else did cannot import the thing that might be broken.

### UI-02 · No 404 page, despite `notFound()` being a security decision — **Fixed**
Added `apps/web/app/not-found.tsx`

`app/(app)/[org]/layout.tsx` calls `notFound()` — rather than returning 403 —
when the caller is not a member of the org in the URL. The reasoning is
documented and correct: a 403 would confirm that an org exists, letting anyone
who can guess a slug enumerate Huntloop's customer list.

That decision made the 404 page load-bearing, and there wasn't one. Next's
default was doing the work of a deliberate security choice.

The new page holds the line the layout took: the copy reads identically for
"no such org" and "not your org". Anything more helpful — "you may not have
access", "ask an admin" — would hand back exactly the distinction the 404 was
chosen to withhold.

### UI-03 · Dark mode is the only mode — **Accepted**

`tokens.css` defines one palette and sets `color-scheme: dark`, so native
form controls and scrollbars render correctly. This is a deliberate product
decision (the chrome derives from Supabase), not an oversight, and the
`color-scheme` declaration is the part people usually forget. No light theme
is planned; the token indirection means adding one later is a second `:root`
block rather than a refactor.

### UI-04 · Declared fonts are never loaded — **Open** (Medium)
`packages/ui/src/tokens.css:127`

```css
--hl-font-sans: "Inter var", "Inter", system-ui, …
--hl-font-mono: "JetBrains Mono", "Source Code Pro", ui-monospace, …
```

Neither Inter nor JetBrains Mono is loaded anywhere — no `next/font`, no
`@font-face`, no `public/` directory (it does not exist). Every user falls
through to `system-ui` and `ui-monospace`.

This is not merely cosmetic: the design system's type scale, letter-spacing,
and the `hl-tabular` numeric alignment were tuned against Inter. It renders in
whatever the OS supplies, so the design differs per platform and nobody has
seen the intended one.

Fix with `next/font/local` or `next/font/google`, which self-hosts and
generates `font-display: swap` — *or* delete the named families from the token
and commit to the system stack. Either is defensible; the current state is the
one that isn't, because it silently promises a font it does not deliver.

### UI-05 · Loading states exist as components but are largely unused — **Open** (Medium)

`States.tsx` exports `LoadingSkeleton`, `EmptyState`, `ErrorState`,
`PermissionDenied`, and `RateLimited` — a more complete set than most projects
ship. But there is no `loading.tsx` at any route segment, so navigation to a
server-rendered page shows nothing until it resolves.

This is most visible on `/[org]/analyze`, where the action fetches several
pages and reasons over them — **tens of seconds**, awaited inline (documented
as a known interim state in `analyze/actions.ts`). The `Analyzer` component
does handle its own pending state; the gap is route-level.

### UI-06 · Responsive design is handled carefully — **No finding**

Recorded because it is unusual. The sidebar collapses to an icon rail on
desktop and becomes an off-canvas drawer below `lg`, with a scrim, Escape-key
dismissal, and `motion-reduce` honoured. `OrgShell.tsx` documents why
`max-lg:-translate-x-full` is scoped rather than bare (an unprefixed utility
would outrank `lg:translate-x-0` and translate the sidebar off-screen on
desktop too). The opportunity detail header deliberately omits `shrink-0` with
a comment explaining that refusing to shrink pushes buttons off a phone screen.

Someone has actually opened this on a phone.

---

# Phase 3 — Features

### FEAT-01 · Twelve of seventeen nav destinations returned 404 — **Fixed**
`apps/web/app/(app)/[org]/OrgShell.tsx`, `packages/ui/src/components/Sidebar.tsx`

The sidebar advertised 17 destinations. Five existed:

| Exists | Did not exist |
|---|---|
| `/dashboard` `/opportunities` `/opportunities/[id]` `/analyze` `/sources` | `/settings` `/settings/product` `/settings/icp` `/companies` `/imports` `/outreach` `/inbox` `/pipeline` `/team` `/team/assignments` `/analytics` `/intelligence` `/memory` |

The intent was legitimate — a §45 surface map making the product's shape
visible while it is built, and the code said so. But they rendered as ordinary
links, so **71% of the primary navigation led to a 404**. Worse, `Inbox`
carried a hardcoded unread count of `12` — a notification badge for a screen
that does not exist.

Added an `unbuilt` flag to `NavItem`. Marked entries render as a non-interactive
label with a "Soon" marker, kept out of the tab order (a keyboard user landing
on one would have nowhere to go). The surface map survives; the false promise
does not.

This is the §7 rule — never present the unverified as established — applied to
the product's claims about itself. The codebase applies that rule rigorously to
prospect data and had not turned it on its own navigation.

Now gated by `audit.mjs` `NAV-01`, which parses the nav and the route tree and
fails CI on any linked-but-missing destination.

### FEAT-02 · Two screens still render fixtures — **Open** (High)
`lib/data/opportunities.ts`

`listOpportunities()` and `getOpportunity()` have their live branches written
against real table and column names, but both throw rather than return:

> `getOpportunity: live mapping is not implemented yet. Connect Supabase and
> finish this against real rows rather than trusting an unrun query.`

**This is the right call and should not be "fixed" by silencing it.** The
comment explains that assembling the full §47 page needs evidence, triggers,
and buyers joined in, and writing that blind would produce a query that reads
as finished and has never returned a row. Recorded as the largest remaining
functional gap, not as a defect in judgement.

Consequence today: with Supabase connected and migrated, the Command Center and
both opportunity screens throw. Before this pass that throw hit Next's default
error page; it now lands in `error.tsx` (`UI-01`).

### FEAT-03 · Authentication is complete and well-reasoned — **No finding**

Magic-link + Google OAuth, no password field at all — which removes password
hashing, reset flows, and the bug class that comes with both. Specifics worth
recording:

- The `next` redirect parameter is validated in **two** places (`middleware.ts`
  and `auth/callback/route.ts`), and both reject `//` as well as absolute URLs,
  because browsers read `//evil.example` as protocol-relative.
- Sign-out is POST-only, with a comment explaining that a GET sign-out is
  triggerable by any `<img src>` on any site.
- The error copy never distinguishes "no such account" from "wrong details",
  closing an account-enumeration oracle. The "check your email" screen says "If
  an account can be created or found for…" — the enumeration-safe phrasing.
- `middleware.ts` uses `getUser()`, not `getSession()`, with a comment stating
  that `getSession` reads the cookie without verifying it against the auth
  server so a forged cookie would satisfy it. This is the single most commonly
  botched detail in Supabase SSR apps.

### FEAT-04 · No role-based UI enforcement — **Open** (Medium)

The database has a four-level role enum (`owner`/`admin`/`member`/`viewer`),
`has_org_role()` enforces it in RLS, and the test suite proves a viewer cannot
write. But `resolveMembership()` returns the role and **no screen reads it**.
A viewer sees "Draft outreach", "Assign", and "New hunt" buttons that will fail
at the database.

The boundary holds — this is a UX finding, not a security one. `PermissionDenied`
already exists in the design system, unused.

### FEAT-05 · Onboarding draft lives only in `sessionStorage` — **Accepted**
`lib/onboarding/draft.ts`

The onboarding pipeline (site → product → ICP → sources) carries state through
`sessionStorage`, because until migrations are applied there is nowhere durable
to put it. The alternative considered and rejected in the comments — recommend
sources from a fixed ICP while the screen claims "based on your ICP" — would
have been the dishonesty the rest of the codebase avoids.

`sessionStorage` rather than `localStorage` is deliberate: a draft that
outlives the tab returns on a shared machine as someone else's half-finished
company profile. The module is explicitly designed as a seam that becomes
reads/writes against `products` and `icps` with no caller changes.

### FEAT-06 · `AgentPanel` is UI with no model behind it — **Accepted**

The panel says so in the product rather than pretending. Its purpose is to fix
the shape of the conversation before the model arrives. Consistent with the
codebase's standard and correctly labelled.

---

# Phase 4 — Backend

### DB-01 · Schema quality is high — **No finding**

40 tables across 4 ordered migrations, 1,092 lines. Every tenant table carries
`org_id`, RLS enabled, and at least one policy — and there is a **structural
test** asserting exactly that, so a new table cannot be added without RLS and
pass CI. That test is worth more than the policies themselves.

`user_org_ids()` is `SECURITY DEFINER` with a **pinned `search_path`**, and the
migration comments why: a `SECURITY DEFINER` function with a mutable
`search_path` is a privilege-escalation primitive, because a caller who can
create a schema earlier in the path can shadow the tables it names. It is also
`STABLE`, so policies evaluate it once per statement instead of once per row.

Constraints encode product rules rather than just types: a fact cannot exist
without a source; an unmeasured score dimension stays NULL and cannot become 0;
a scoped memory cannot be subject-less; an outbound message cannot claim
`sent_at` without a provider id. 21 indexes, including one on
`memberships (user_id, org_id)` — on the hot path of literally every tenant
query, since every policy resolves through it.

### API-01 · Server Action inputs are typed but not validated — **Fixed** (was High)
`analyze/actions.ts`, `welcome/*/actions.ts`

Server Actions are public POST endpoints. TypeScript types are erased at
runtime, so `analyzeUrlAction(org, url)` will accept anything the caller sends.

The codebase has thought about this and the reasoning is largely sound —
`sources/actions.ts` explains that a tampered ICP produces recommendations
traceable to that ICP and nothing more, so there is nothing to escalate with.
`analyze/actions.ts` explains why the ICP is loaded server-side while evidence
crosses from the client.

But "there is nothing to escalate with" was an argument about *today's* task
shapes, re-derived by hand at each call site — and it was an argument about
trust that said nothing about **size**. Without bounds, a caller could hand
`whyNowAction` 500 claims of 50 kB each and we would pay Opus to read all of
it.

`zod` now parses every action argument at the boundary. Shape and bounds only:
whether a URL is a real company stays `normalizeUrl`'s job and then the
model's; whether the caller may act on this org stays `resolveRecorder`'s.

One bug found while writing it: `createOrganisation` did
`String(formData.get("name"))`, and a `FormData` entry is `string | File` —
`String(file)` yields `"[object File]"`, which is non-empty, slugifies to
`objectfile`, and creates an organisation. Now parsed rather than coerced.

`SEC-VAL` was strengthened from "is zod installed" to "does every `use server`
module actually parse", and verified by falsification.

### API-02 · No rate limiting anywhere — **Fixed** (was High)
`packages/db/migrations/0005_rate_limits.sql`, `apps/web/lib/rate-limit.ts`

No rate limiting on Server Actions, the auth callback, or magic-link requests.
Combined with `SEC-01` this was the amplifier: unbounded requests to an
unauthenticated endpoint that each cost a real Opus call with `web_fetch`.
`SEC-01` closed the authentication half; this closes the volume half, for the
authenticated case that remained.

**Postgres, not Redis.** The obvious answer is Upstash or Vercel KV, and for a
hot path it would be right. This is not a hot path — the limited actions fetch
several pages and reason over them, so they take tens of seconds. A 5ms round
trip to a database we already have, already authenticate against, and already
back up is not the cost worth optimizing, and a second stateful service is a
second thing to provision, secure, pay for, and document.

Fixed-window counters, per-user *and* per-org: a per-user limit stops one
person looping a form; an org-wide limit stops ten seats doing it at once,
which is the same bill. Budgets are set against what each task costs — 20/hour
per user for the two that fetch pages and run Opus at `high`, 60/hour for
`explain_why_now`, which reasons over evidence it is handed.

Two details that are load-bearing rather than incidental:

- `consume_rate_limit()` is `SECURITY DEFINER`, because the caller must be able
  to increment a counter that constrains them — a row a tenant can `UPDATE` is
  not a rate limit. That makes the **membership check inside the function** the
  only thing standing between a stranger and another org's quota, so it is
  tested directly.
- The application-side check **fails closed**. If the limiter errors, the call
  is refused. Proceeding when the limiter is broken is the same reasoning that
  produced `SEC-01`: "the limiter is unreachable" is indistinguishable from
  "someone is hammering the limiter", and the blast radius of failing open is
  an unbounded bill.

Seven database-level tests, in the existing PGlite suite (39/39 total). One
caught a real bug during implementation: the first version used a single
`INSERT … ON CONFLICT` naming the `user_id IS NOT NULL` partial index while
sometimes inserting a NULL user. For those rows the arbiter never matched, so
every call inserted afresh instead of incrementing — the limit silently would
not have limited. Now two explicit branches.

Gated by `audit.mjs` `SEC-RATELIMIT` and `SEC-RATELIMIT-RLS`.

**Residual, recorded as RL-01:** a deployment with an `ANTHROPIC_API_KEY` and
no database has no auth, no metering, and now no limit either — nothing can be
counted in a table that does not exist. `consumeRateLimit` reports this as
`unenforced` rather than hiding it. It is a misconfiguration, not a code
defect, but it is the one arrangement where `SEC-01` effectively still exists.

### API-03 · No API versioning strategy — **Open** (Medium)

Server Actions only; no REST or tRPC surface. Fine today. Worth a decision
before any external integration, since Server Actions are not a public API
contract and cannot be versioned like one.

### DB-02 · No backup or point-in-time-recovery policy documented — **Open** (Medium)

Supabase provides backups by plan tier, but nothing in the repo states which
tier, what the retention is, or what the recovery procedure would be. Untested
backups are not backups.

### DB-03 · Row types are hand-written and can drift — **Open** (Medium)
`packages/db/src/types.ts`

Documented and reasoned: generation needs a live project, this package must
typecheck offline, and the header says the SQL wins on conflict. Correct as a
trade — but nothing *detects* the drift. Once a Supabase project is stably
available, add `supabase gen types` in CI and diff.

---

# Phase 5 — Security

## SEC-01 · **CRITICAL** · Unauthenticated, unmetered AI spend — **Fixed**
`apps/web/lib/ai/recorder.ts` and all four wrappers

**The finding.** `resolveRecorder()` resolved the caller's org, and on failure
fell back to a null recorder while **letting the model call proceed**:

```ts
const unmetered = { recorder: nullRecorder, orgId: orgSlug, recorded: false };
const { db } = await resolveDataSource();
if (!db) return unmetered;                    // no database — legitimate
const { data: org } = await db.from("organizations")
  .select("id").eq("slug", orgSlug).maybeSingle();
if (!org) return unmetered;                   // ← not the same thing at all
```

`organizations` is behind RLS resolving through `user_org_ids()`. Verified in
`migrations/0001_identity.sql`. So `!org` does **not** mean "no such org" — it
means *this caller is not a member of it*. Both branches returned the same
"proceed unmetered" result.

**Impact.** Server Actions are public POST endpoints. Any caller naming an org
slug they don't belong to got a real `claude-opus-5` call at `high` effort with
`web_fetch` enabled — billed to us, recorded against nothing, at no cost to
them. `research_company` is the worst case: it fetches up to 8 pages per call.

RLS cannot defend this. **The tenant boundary protects rows, and the Anthropic
bill is not a row.** Middleware would bounce an anonymous caller — but
`middleware.ts` documents itself as "a convenience, not the security boundary",
and for AI spend it was the *only* boundary. It also passes everything through
when Supabase is unconfigured or unmigrated.

Even fully authenticated, any member could run unlimited **unbilled** research
by passing an org slug they don't belong to — a cost-accounting bypass, in a
system whose `runs.ts` opens by explaining why the accounting row must be
written *before* the call.

**The fix.** `resolveRecorder` now returns a discriminated union separating the
three states it was conflating:

| State | Behaviour |
|---|---|
| No database | Unmetered, proceed — legitimate during setup |
| Org resolved | Metered, proceed |
| **Org not resolvable** | **Refused** |

All four wrappers (`research`, `sources`, `qualify`, `why-now`) now refuse
before the call. The refusal message is identical for "missing" and "not
yours", consistent with `resolveMembership`.

Gated by `audit.mjs` `SEC-SPEND`, which fails CI if any wrapper reaching
`runTask` lacks the guard.

### SEC-02 · No security response headers — **Fixed**
`apps/web/next.config.ts`

`next.config.ts` had no `headers()` at all. Added HSTS,
`X-Content-Type-Options`, `X-Frame-Options: DENY`, `frame-ancestors 'none'`,
`Referrer-Policy: strict-origin-when-cross-origin`, and a `Permissions-Policy`
denying camera/microphone/geolocation. Set `poweredByHeader: false`.

Two of these are specifically motivated here rather than generic hardening:

- **Referrer-Policy.** Org slugs and opportunity IDs are in the URL path. The
  opportunity page links out to *prospect websites* — third parties. Under the
  browser default, every such click leaked the full internal URL.
- **Clickjacking.** The app has approve-and-send actions behind single clicks,
  which is the exact shape framing attacks target.

Verified against the running server:

```
Strict-Transport-Security: max-age=63072000; includeSubDomains
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Content-Security-Policy: frame-ancestors 'none'
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()
```

### SEC-03 · No script-src Content-Security-Policy — **Open** (High)

Deliberately not attempted in this pass. A useful CSP needs a per-request nonce
(Next injects inline bootstrap scripts, and `unsafe-inline` in a `script-src`
certifies nothing), which means generating it in middleware and threading it
through the document. That is a real change with a real chance of breaking
production silently, and it deserves its own task rather than being half-done
inside an audit. `frame-ancestors` is in place meanwhile.

### SEC-04 · Prompt-injection handling is strong — **No finding**

`packages/ai/src/untrusted.ts` is the best-reasoned file in the repository. It
names the correct mitigation hierarchy and is honest that delimiting is
insufficient:

> Never let fetched content reach a tool that does anything. […] An injection
> that succeeds completely can make the model wrong about a company, which the
> evidence trail then exposes. That blast radius is the actual defence, and it
> is an architectural choice, not a prompt.

The untrusted fence is **randomised per call**, so a page cannot close it by
guessing. `web_fetch` carries an `allowed_domains` allow-list derived from the
normalized URL, with a comment explaining the specific attack it stops: the
tool will only fetch URLs already in the conversation, but "already present"
includes URLs the model read on a page it just fetched — so an untrusted page
could otherwise walk the model to an arbitrary host.

### SEC-05 · Tenant-boundary enforcement is exemplary — **No finding**

The service-role client is blocked by two independent mechanisms: an ESLint
`no-restricted-imports` rule (in-editor squiggle at the moment it's typed) and
`check-admin-imports.ts` (zero dependencies, still runs if ESLint is skipped or
misconfigured). The eslint config explains why both are kept. `admin.ts` also
throws at runtime if called in a browser context. 50+ files scanned clean.

### SEC-06 · Secrets hygiene is correct — **No finding**

No secrets committed. `.gitignore` covers `.env`, `.env.local`, `.env.*.local`.
All env access is funnelled through one module per package so a grep finds
every use. The `NEXT_PUBLIC_` boundary is respected. The Supabase project *ref*
in `.env.example` is not a secret — it is the public subdomain.

### SEC-07 · Three high-severity dependency advisories — **Open** (Medium)

```
next     high  (direct)    ← via postcss, sharp
postcss  high  (transitive)  path traversal via sourceMappingURL
sharp    high  (transitive)  libvips CVE-2026-33327/33328/35590/35591
```

All three resolve by upgrading Next 15.5.23 → 16.3.0, a **semver-major**. Not
done in this pass: a major framework upgrade is not an audit-time change, and
practical exposure is limited (the postcss issues are build-time with
attacker-controlled CSS, and `sharp` is unused — no `next/image`, no `public/`).
Real, and should be scheduled deliberately.

### SEC-08 · No input sanitization library — **Open** (Low)

No `dangerouslySetInnerHTML` anywhere, so React's escaping covers XSS today.
All database access is via the Supabase client (parameterized), so SQL
injection is not reachable. Recorded as a standing constraint: the moment
rendered model output is treated as markup, this becomes urgent.

---

# Phase 6 — Performance

Production build, measured:

```
First Load JS shared by all              103 kB
/login, /signup                          180 kB   ← outlier
/[org]/analyze, /opportunities, /sources 115 kB
/[org]/dashboard                         108 kB
Middleware                              92.5 kB
```

### PERF-01 · Zero use of `next/link` — **Open** (High)
21 raw `<a href>` across the app; 7 point at internal routes

There are **no `next/link` imports in the repository**. Every internal
navigation — sidebar, breadcrumbs, opportunity rows, auth page cross-links — is
a raw anchor, so each one triggers a **full document reload**: the App Router
is discarded, all 103 kB of shared JS is re-parsed, React re-hydrates, and the
server re-renders from scratch.

`Sidebar.tsx` documents plain `<a>` as intentional so `packages/ui` stays
framework-agnostic, and notes "the app wraps hrefs with next/link routing where
it matters" — **but the app never does.** The design-system decision is
defensible; what is missing is the app-side counterpart, e.g. a `linkComponent`
prop or a thin wrapper in `apps/web`.

This is the single largest user-perceived performance issue in the app.

### PERF-02 · Auth pages carry 77 kB of avoidable JS — **Open** (Medium)

`/login` and `/signup` are 180 kB First Load versus a 103 kB baseline. The
delta is `@supabase/supabase-js`, pulled into the client bundle because
`AuthForm.tsx` is a Client Component calling `createClientSideClient()`
directly.

These are the first pages an unauthenticated visitor loads — the worst place in
the app to ship the largest bundle. Moving magic-link submission to a Server
Action would remove the client SDK from the critical path; the OAuth redirect
can be a server-issued redirect.

### PERF-03 · Prompt caching is correctly designed — **No finding**

`client.ts` places `cache_control: { type: "ephemeral" }` on the system block
and enforces by contract that nothing per-call reaches `system`. Since the
system prompt is byte-identical across every company researched under one ICP,
this should bill at 0.1× from the second call onward. `estimateCostCents`
models cache reads at 0.1× and writes at 1.25× — so if caching breaks, the cost
number is how you find out.

`models.ts` uses standard Sonnet pricing rather than the promotional rate
expiring 2026-08-31, with a comment explaining that a dashboard assuming a
promo price understates the bill the day it ends with no code change.

### PERF-04 · No database query performance work yet — **Open** (Medium)

Not measurable — the main list queries do not execute yet (`FEAT-02`). The
index groundwork is done and the ordering is deliberately aligned:
`listOpportunities` sorts priority-then-recency to match
`opportunities_priority_idx`, so the UI default and the query plan agree rather
than quietly fighting. Re-audit with `EXPLAIN ANALYZE` once live.

### PERF-05 · Module-level caches are per-worker — **Open** (Low)

`schemaReady` (`lib/data/source.ts`) and `schemaApplied` (`middleware.ts`) are
module-level booleans, documented as caching a one-time transition. Correct
reasoning, but in serverless each instance re-probes, so the cost is one extra
round trip per cold start rather than once per process. Minor; noted for
accuracy.

---

# Phase 7 — Accessibility

Better than typical, and clearly deliberate.

**Working:** semantic HTML throughout (`<nav aria-label="Primary">`, `<main>`,
`<table>` with `scope="col"` and `aria-sort`); a global `.hl-focusable`
focus-ring convention applied consistently; `prefers-reduced-motion` honoured
at the token level (durations → 0ms); Escape closes the mobile nav drawer, with
a comment noting that a pointer-only dismissal is a keyboard trap; the scrim is
a real `<button>` with an `aria-label`; `role="alert"` on form errors;
`aria-current="page"` on the active nav item; measured colour contrast.

Notably, `HoverPanel` — which drives the score breakdown — is **keyboard
accessible**: `tabIndex={0}`, `role="button"`, opens on `onFocus` as well as
`onMouseEnter`, and the panel carries `role="tooltip"`. Hover-only disclosure
is the usual failure here and it was avoided.

### A11Y-01 · `DataTable` clickable rows are pointer-only — **Open** (Medium)
`packages/ui/src/components/DataTable.tsx:177`

`<tr onClick={onRowClick}>` with no `tabIndex`, no `onKeyDown`, and no role. A
keyboard user cannot activate a row.

**Latent, not live:** the only current consumer, `OpportunityTable`, does not
use `onRowClick` — it renders a real `<a>` in the company cell, which is the
correct pattern. So no user is affected today. It is a trap for the next
consumer of a shared component.

### A11Y-02 · No skip link — **Open** (Medium)

Every authenticated page renders ~17 sidebar items before `<main>`. A keyboard
or screen-reader user tabs through the entire nav on every page load. A
standard "Skip to content" link targeting `<main>` fixes it.

### A11Y-03 · No automated accessibility testing — **Open** (Low)

No `axe`, no `eslint-plugin-jsx-a11y`. The current quality came from care, and
care does not survive contributor turnover. `jsx-a11y` in the existing flat
config is the cheapest durable guard.

---

# Phase 8 — SEO

See the scope note in [README.md](README.md): this is an authenticated product,
not a content site. Technical SEO applies; content SEO mostly does not yet.

### SEO-01 · No metadata baseline at all — **Fixed**
`apps/web/app/layout.tsx`

Before this pass: no `metadataBase`, no `openGraph`, no `twitter`, no
canonical strategy. Root metadata was a bare title and description.

Without `metadataBase`, Next warns at build time and resolves relative
metadata URLs against `localhost` — which is how a production deployment
publishes `http://localhost:3100` as its canonical Open Graph URL.

Added `metadataBase` (via `lib/site-url.ts`), Open Graph, and Twitter card
metadata, plus a `title.template` of `%s · Huntloop`. The eleven pages that
were hand-writing the `· Huntloop` suffix were updated to just the page name,
so it cannot drift on the next page added.

No `images` on either card — none exists, and a card pointing at a 404 renders
worse than one with no image, because some clients cache the failure.

### SEO-02 · No robots.txt or sitemap.xml — **Fixed**
Added `apps/web/app/robots.ts`, `apps/web/app/sitemap.ts`

The robots policy is written for what this app actually is. It disallows
`/kitchen-sink` (the design-system gallery — public on purpose, and emphatically
not the page anyone should reach from a search for "Huntloop"), `/auth/`,
`/welcome`, and tenant routes via a wildcard-segment rule that fails closed for
routes added later.

The sitemap has three URLs, and that is the honest number.

### SEO-03 · Crawler routes were behind the auth guard — **Fixed**
`apps/web/middleware.ts`

**Found by verification, not by reading.** After adding the two files above,
`curl http://localhost:3100/robots.txt` returned:

```
/login?next=%2Frobots.txt
```

The middleware matcher excludes `_next/static`, `_next/image`, `favicon.ico`,
and image extensions — but `robots.txt` and `sitemap.xml` are *routes* here
(`app/robots.ts`, `app/sitemap.ts`), not files. They fell through to the guard,
and every crawler got a 307 to `/login`: a robots policy nothing can read.

Added both to the matcher exclusion. Re-verified — both now serve correctly.
Gated by `audit.mjs` `SEO-MW`.

*This is the argument for the verification step of the loop. Both files were
correct; the system around them was not.*

### SEO-04 · The root route redirects to the design-system gallery — **Open** (High)
`apps/web/app/page.tsx`

```ts
export default function Home() {
  redirect("/kitchen-sink");
}
```

`https://huntloop.example/` serves the internal component gallery. It is the
canonical URL in the sitemap, the Open Graph `url`, and the first thing any
crawler, link preview, or visitor sees.

Not fixed here because the fix is a product decision, not a code change: it
needs either a marketing landing page or a redirect to `/login`. Recorded as
the top SEO item.

### SEO-05 · No favicon or app icon — **Open** (Low)

No `icon.svg`, `icon.png`, `favicon.ico`, or `public/`. Every browser requests
`/favicon.ico` and receives the app's 404 handler. A single `app/icon.svg`
resolves it.

---

# Phase 9 — Testing

### TEST-01 · The tests that exist are excellent — **No finding**

`npm test` → **31/31 passing.** It runs the real migrations against real
Postgres (PGlite, in-process — no Docker, no hosted project) and asserts the
rules the schema is supposed to enforce, not that functions return what they
return.

The tenant-isolation suite runs as a **non-superuser role**, so RLS genuinely
applies. The README's reasoning for PGlite is right and worth preserving: "an
isolation test that only runs when someone remembers to point it at staging is
an isolation test that stops running."

The structural test — *every* table with an `org_id` has RLS enabled and at
least one policy — is worth more than the individual policy tests, because it
covers tables that do not exist yet.

### TEST-02 · No frontend tests of any kind — **Open** (High)

`apps/web` and `packages/ui` have no `test` script. Zero component tests, zero
integration tests, zero end-to-end tests. Nothing exercises:

- sign-in, the OAuth callback, or the `next` redirect validation (a **security
  control** with no test)
- the org membership guard and its 404-not-403 behaviour
- the onboarding pipeline across its four steps
- the analyze screen's qualify → why-now sequence
- responsive/drawer behaviour

The `packages/ai` suite proves the §7 rules with a scripted client and no
network — that pattern extends naturally to the wrappers in `apps/web/lib/ai`,
which is where `SEC-01` lived and where a test would have caught it.

Highest-value first test: Playwright covering sign-in → onboarding → analyze.

### TEST-03 · No CI dependency or accessibility gate — **Open** (Medium)

See `REPO-06` and `A11Y-03`.

---

# Phase 10 — Analytics & growth

### ANL-01a · No error reporting — **Fixed** (was High)
`instrumentation.ts`, `sentry.*.config.ts`, `instrumentation-client.ts`

`SENTRY_DSN` was reserved in `.env.example` and nothing was installed. The new
`error.tsx` `console.error`d, which in production is nobody, and a crash in a
Server Component was invisible entirely.

`@sentry/nextjs` across all three runtimes. The half that matters most is
`onRequestError` in `instrumentation.ts`: `app/error.tsx` is a Client
Component that only ever receives a `digest` — Next replaces the message and
stack before they cross the boundary, deliberately — so without the server
hook, the server side of every failure stays invisible. The digest joins the
two events.

Three decisions worth recording:

- **`tracesSampleRate: 0`.** The one thing worth tracing is the analyze path,
  and `ai_runs.latency_ms` already records it per call with the model and
  prompt version attached. Turn tracing up when there is a question it answers.
- **Session Replay off, and not merely unconfigured.** A replay of the
  opportunity page is a recording of a named prospect's research; a replay of
  the analyze screen records what a customer is prospecting. Enabling it needs
  a masking policy and a customer conversation, not a config flag.
- **`ModelRefusalError` is dropped in `beforeSend`.** A model declining a
  request is an answer surfaced to the user by design, not an outage.
  Reporting it would train everyone to ignore the alert channel.

**Cost, measured rather than assumed:** shared First Load JS went 103 kB →
**185 kB** on the first build. Tree-shaking tracing and Replay via
`DefinePlugin` recovered 49 kB, landing at **136 kB** — a real +33 kB. Setting
the sample rates to 0 disables the behaviour but not the code; the flags are
what remove it.

That is a genuine regression against `PERF-01`/`PERF-02` and is stated as one.
It is judged worth it — a Server Component crash currently has no other way to
be seen — but the fact that nobody would have noticed without measuring is
itself the finding, and `PERF-06` adds a bundle budget to CI.

### ANL-01b · No product analytics — **Open** (High)

`NEXT_PUBLIC_POSTHOG_KEY` is reserved and nothing is installed. No event
tracking, no funnel instrumentation.

Onboarding is a four-step pipeline where each step feeds the next, and there is
no measurement of where people drop out — the one funnel whose shape most
determines whether the product works.

### ANL-02 · Cost accounting is designed but not surfaced — **Open** (Medium)

`ai_runs` captures task, model, prompt version, input hash, tokens, cost, and
latency, with the row written *before* the call — the invariant that separates
a cost dashboard from a cost guess, since the expensive calls are precisely the
ones that fail halfway. `estimateCostCents` models cache pricing correctly.

But nothing reads the table. `/[org]/analytics` is an unbuilt nav entry. All
the hard work is done and there is no screen.

### ANL-03 · No feedback collection — **Open** (Low)

`TopBar` has `feedbackHref="#"`. Nothing behind it.

---

# What was verified, and how

Every claim above traces to a command or a file. Reproduce with:

```bash
npm run typecheck && npm run lint && npm test && npm run audit:site && npm run build
```

| Check | Result |
|---|---|
| `npm run typecheck` | Clean, 4 workspaces |
| `npm run lint` | Clean |
| `npm test` | 39/39 · 61 files scanned, no admin imports |
| `npm run audit:site` | 34 checks · 0 failing · 8 warning |
| `npm run build` | 18 routes, succeeds |
| `npm audit` | 3 high (all → Next 16 major) |
| Headers | `curl -sI` against the dev server |
| `robots.txt` / `sitemap.xml` | `curl` — caught `SEO-03` |
| Console / server logs | No errors |

Not verified, and stated plainly: the nav "Soon" rendering and the 404 page
were confirmed by typecheck and production build, **not visually**. Both sit
behind the auth guard on this machine and signing in would have required
handling the developer's credentials.
