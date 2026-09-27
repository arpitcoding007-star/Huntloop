---
description: >-
  Every significant architectural and product decision, what was rejected, and
  whether it still holds.
---

# Decision log

> **Layer:** Internal · **Audience:** engineering, product, leadership

Most of this codebase's reasoning lives in file headers, which is where it is
most likely to be read. This page indexes the decisions that shaped the system,
names the alternative that was rejected, and says where the full argument lives.

**Status key:** ✅ Accepted · 🔄 Reversed · ❓ Open

***

## Architecture

### ✅ The queue is a Postgres table, not a hosted queue

**Rejected:** SQS, Inngest step functions, any external queue.

Every job here fetches a page or calls a model, so the unit of work is seconds
to tens of seconds and the queue round-trip is noise. A table is transactional
with the rows the job is about, is backed up with them, and is visible in the
same SQL editor.

`packages/jobs/src/queue.ts`

### ✅ At-least-once, never exactly-once

**Rejected:** pretending exactly-once is available.

`claim_job_executions` uses `for update skip locked`; `requeue_stalled_jobs`
recovers from a dead worker. Every handler tolerates running twice. *Pretending
otherwise is how duplicate emails get sent.*

### ✅ No Inngest SDK dependency

**Rejected:** adding `inngest` and defining durable step functions.

The durable steps in this system **are** rows in `job_executions`. Re-expressing
them would create a second definition of "what work is outstanding", and the two
would disagree the first time one of them was down. The integration is an
eleven-line HMAC check.

`apps/web/app/api/inngest/route.ts`

### ✅ `sweep()` is separate from `tick()`

**Rejected:** sweeping inside the tick.

`tick()` is also how a test or an operator **drains** the queue, and a drain
that keeps adding work never finishes. The cost is that every driver must
remember to sweep — which is why the requirement is stated loudly in
`runner.ts`.

### ✅ No general REST API

**Rejected:** shipping a versioned public API now.

There is no external consumer. Versioning, documenting and deprecating a
surface nobody uses would make every internal refactor a breaking change. The
versioning strategy for *when* that changes is recorded in
`docs/OPERATIONS.md` (API-03).

### ✅ RLS is the boundary; everything above it is convenience

**Rejected:** enforcing tenancy in application middleware.

Middleware can be bypassed by a bug, a matcher mistake, or a direct API call.
RLS cannot. `SEC-ADMIN` and `check-admin-imports.ts` keep it true.

### ✅ 404, not 403, for a non-member

"That organization exists, but you may not see it" tells anyone who can guess a
slug which companies are customers. Applied consistently — `/api/jobs/tick` and
`/api/inngest` do the same.

### ✅ The AI package never reaches a database client

It imports exactly one pure subpath (`@huntloop/db/rules`). Anything more would
make it a second path around RLS.

***

## Product

### ✅ The unit is an opportunity, not a lead

**Rejected:** a `leads` table.

An opportunity is `(company × icp)`, scored and evidenced. "Lead" would
duplicate it with weaker semantics. Enforced in the vocabulary — the nav says
Opportunities, and there is no `leads` table.

### ✅ Eight named dimensions, no weights column

**Rejected:** a single composite score with weights.

The combination rule is deliberately **not defined**. Inventing one and
presenting it as "the model's arithmetic" would break the product's own central
rule against presenting the unverified as established.

The reference system this is a second draft of shipped exactly that failure in
the other direction: six rule types, signed weights, a whole taxonomy — and the
weight was never once used in arithmetic.

`packages/db/src/rules.ts`

### ✅ A rule may adjust, veto or floor — never touch a dimension

Three effects, all visible, all recorded in `rule_trace` beside the untouched
`model_score`.

### ✅ Unknown is a first-class answer

**Rejected:** defaulting an unmeasured dimension to `0`.

Zero is a measurement; unknown is not. Enforced by a `NOT NULL` that is
deliberately absent, and asserted by the migration suite.

### ✅ A guessed email address is never produced

**Rejected:** `first.last@company.com` when no provider is configured.

A guessed address is a plausible string with no evidence behind it, and the
bounce lands on the customer's sending domain.

### ✅ The autonomy ladder, and draft-and-stop at 0–1

**Rejected:** a single on/off automation switch.

`campaigns.autonomy_level` is the only field on a campaign that can hurt
somebody. There is no way to enrol and raise autonomy in one call, and the
create action does not accept a level at all.

### ✅ HubSpot's deal stage becomes evidence, not a status write

**Rejected:** two-way sync.

A rep's stage change is a real, citable fact — recorded with its source, not
silently promoted into overwriting a status Huntloop's own scoring engine owns.
Revisiting this is [open decision #2](#open-decisions).

### ✅ Bring your own mailbox; no deliverability tooling

**Rejected:** shared sending infrastructure, warm-up, rotation.

The deliverability consequences land on the sender who chose to send.

### ✅ Single-vendor CRM, no abstraction

**Rejected:** a `packages/providers`-shaped CRM registry.

One real implementation, written to, with a per-org credential. A five-vendor
abstraction over one implementation would be the premature-abstraction failure
this codebase otherwise avoids.

***

## Engineering practice

### ✅ Mechanical checks over documented conventions

**Rejected:** a style guide.

`scripts/audit.mjs` holds 40 checks. Anything that must never regress becomes a
check that fails a build, not a paragraph nobody re-reads.

### ✅ PGlite for the isolation suite

**Rejected:** a hosted test project.

An isolation test that only runs when someone remembers to point it at staging
is an isolation test that stops running.

### ✅ Comments explain *why*, and record the rejected alternative

The "what" is in the code already. This is why file headers in this repository
are long, and it is deliberate.

### ✅ Server-side analytics only

**Rejected:** `posthog-js` (~50 kB) and Sentry Session Replay (~49 kB).

Every onboarding step transition already passes through the server. Replay would
record a named prospect's research, which needs a masking policy and a
conversation with customers first.

### ✅ CSP ships report-only

**Rejected:** enforcing immediately.

A wrong CSP does not fail loudly — it blocks one script on one route and the
page half-works. `CSP_ENFORCE=true` after a quiet week.

### ✅ Cache before budget in the provider pipeline

Looks wrong, is not: a cached answer costs nothing, so refusing it for lack of
budget would deny a customer data already held and already paid for.

### ✅ Suppressions survive erasure

**Rejected:** deleting everything on an erasure request.

The naive implementation deletes the suppression too, **which makes the person
contactable again**.

***

## Reversed

### 🔄 Provider vendor selection: key-sniffing → explicit variables

**Was:** sniff the vendor from the shape of the key, to avoid a second variable
that has to agree with the first.

**Now:** explicit `APOLLO_API_KEY` / `ENRICHMENT_API_KEY` /
`EMAIL_VERIFICATION_API_KEY`, with `verifyCredentials()` called at configuration
time.

**Why:** sniffing was right for one optional capability with two vendors. It
does not survive six capabilities across three — there is no shape of a single
key that expresses "Apollo for search, Hunter for email finding, ZeroBounce for
verification". And `verifyCredentials()` is a *stronger* guarantee: it catches
an expired key, a revoked key, and a key for the right vendor on the wrong
account, none of which sniffing could see.

`.env.example` still carries the old argument — see
[Documentation vs. code](../status/doc-vs-code.md).

### 🔄 The cron: committed → removed → committed again

1. `*/5 * * * *` in `apps/web/vercel.json` — **failed to deploy** on a Hobby
   account.
2. Removed rather than slowed to daily, because a daily tick is not a slow
   engine but a stalled one, and a committed daily cron reads as a working
   engine to anyone reviewing the repository.
3. Re-added 2026-09-15 as `* * * * *`, with the plan requirement documented.

`docs/OPERATIONS.md` still contains the middle state's reasoning. See
[The heartbeat](../operations/heartbeat.md).

### 🔄 `middleware.ts` → `proxy.ts`

Next 16 deprecated the old convention. Renamed **by hand rather than by
codemod**, because the codemod also rewrites the comments and this file's
comments are the reason it is readable.

### 🔄 Sentry tree-shaking: `webpack()` → `bundleSizeOptimizations`

Next 16 builds with Turbopack, which never calls `webpack()` — so the old block
became dead code that still read as live. The replacement was **measured and
found to change nothing today**, and kept anyway, because the condition it
guards is one line in another file.

***

## Open decisions

These need a person, not an engineer.

| # | Decision | Why it cannot wait |
|---|---|---|
| 1 | **Billing: implement Stripe, or remove it.** Plans are priced and displayed; three of five limits are unenforced; no payment path exists | You cannot take money today, and the pricing page implies you can |
| 2 | **Two-way CRM sync:** may HubSpot's stage overwrite Huntloop's opportunity status? | Currently recorded as evidence only. Needs a real rep's opinion |
| 3 | **A source-of-truth table** between Huntloop and HubSpot | Write it *before* inbound sync exists, not after |
| 4 | **GDPR lawful basis** for enrichment and outreach in target geographies | Needs counsel. Affects whether EU prospecting is viable at all |
| 5 | **Default retention periods** per org | The SQL exists; the numbers are a policy choice |
| 6 | **Hobby vs. Pro Vercel** | Determines whether the engine can beat once a minute or once a day |
| 7 | **The five orphaned tables** — wire them or drop them | A schema carrying tables nobody reads teaches that tables are decorative |

***

## Recording a new decision

Add a section here **and** put the full reasoning in the file header where the
decision lives. Name what you rejected and why. If the decision must hold
forever, add a check to `scripts/audit.mjs`.

When a decision is reversed, **move it to Reversed and keep both halves.** The
old reasoning is how the next person understands why the new answer is
different, rather than assuming the first one was careless.

## Related

* [Vision and principles](../product/vision-and-principles.md)
* [Technical debt](../status/technical-debt.md) — the "not debt, deliberate" list
* [Documentation vs. code](../status/doc-vs-code.md)
