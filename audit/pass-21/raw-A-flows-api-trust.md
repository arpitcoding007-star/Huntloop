# Pass 21 · Raw A · Flows + API + Trust

Branch `feat/pass-21-loop` @ `dab37db`. Read-only static trace. No network, no DB, no provider calls.

## Scope and method

What I traced:
- `apps/web/proxy.ts` and `lib/protected-routes.ts`
- every `apps/web/app/**/actions.ts` export, checking whether it goes through `mutate()` or does its own membership check
- every `app/api/**` route, plus `auth/callback`, `auth/signout`, `dev/onboarded` and `performance/export`
- the Exchange actions against the RLS and triggers in 0060, 0062 and 0065–0069
- the outcome counting in `lib/performance/compute.ts`

Checked and found sound, so they are not reported:
- Open redirects: `lib/safe-next.ts:35-45` is used by sign-in, OAuth, the callback and sign-out. The mailbox `back` path is `encodeURIComponent`'d. The unsubscribe GET stays same-origin.
- Org scoping and roles: every in-org action resolves membership through `mutate()` or `currentViewer()`. Team, settings, integrations and privacy actions are gated to admin or owner. `inviteSchema` cannot grant owner. `setMemberRole` blocks a non-owner from touching the owner role.
- Mailbox OAuth: state nonce in a cookie, `timingSafeEqual`, the membership check is repeated on callback, and tokens are encrypted or the flow fails closed.
- Public endpoints:
  - `/api/jobs/tick` checks the bearer token and answers 404 without it.
  - The unsubscribe RPC is SECURITY DEFINER and takes a token only.
  - Digest and Exchange unsubscribe tokens are HMAC-verified, and the GET only shows a confirmation; the change needs a POST.
  - The `discover` action is bounded per IP.
- Exchange intake sessions are scoped to the user by RLS (`0060:431-433`). Evidence follows its offering's org through a trigger (`0062:47-67`). `verified_at` cannot be written by a session (`0060:181-202`).
- Loaders: `lib/data/exchange.ts` and the others throw on query errors rather than returning empty lists. `load()` does not swallow errors.
- Double-submit: the reply, approve and intake-submit buttons are disabled while their transition is pending. `approveMessageAction` is guarded by `.is("scheduled_at", null)`.
- ClaimBadge: the hard-coded `kind="fact"` uses are legends only (Analyzer:424, dashboard:609, AgentPanel:195). Data-driven badges take `kind` from the row.

---

## Findings

### [P1] FLOW-001: A reversed pipeline move leaves its outcome counted for good: "won" then "lost" counts as both
- **Confidence:** CONFIRMED (traced)
- **Where:**
  - `apps/web/app/(app)/[org]/pipeline/actions.ts:51-101`
  - `apps/web/lib/performance/compute.ts:359-372` and `:196-200`
  - `packages/db/migrations/0042_demand_intelligence.sql:161-162`
- **Evidence:**
  ```
  pipeline/actions.ts:83  const { data: already } = await db.from("outcomes")...eq("kind", parsed.data)
  pipeline/actions.ts:90  if (!already?.length) await db.from("outcomes").insert({ kind: parsed.data, ... })
  compute.ts:361          const count = (kind) => outcomes.filter((o) => o.kind === kind).length;
  compute.ts:370          won: count("won"),   // no join to the opportunity's current status
  ```
  No code path deletes or supersedes an `outcomes` row when the stage moves away. The only `outcomes` update in the app is the reason backfill.
- **Impact:**
  - A misclick on Won, or a deal reopened from Won to Proposal or Lost, keeps the win in the Performance funnel, in pipeline "won" value, in `schedule-learning` population counts and in demand intelligence.
  - The `outcomes_demand` trigger fires on insert. The same opportunity can be counted as both won and lost.
  - The headline sales numbers are wrong, and nothing on screen shows it.
- **Root cause:** `outcomes` is modelled as append-only. Funnel counts read it without checking that the opportunity still holds that stage.
- **Fix (smallest):** in `setOpportunityStatusAction`, after a successful stage change, retract the outcomes the opportunity no longer supports:
  ```
  update outcomes set retracted_at = now()
   where opportunity_id = $1
     and kind in ('meeting','proposal','won','lost')
     and kind <> $new
  ```
  - That needs a nullable `retracted_at` column, which means a migration.
  - Or hard-delete those rows, if the learning loop does not need the history.
  - Then filter `retracted_at is null` in `performance.ts:127`, `icp-proposal.ts:67`, `competitor-intel.ts` and `schedule-learning.ts:93`.
- **Acceptance:** after Won → Lost, the funnel shows won 0 and lost 1. After Won → Proposal → Won, it shows won 1.
- **Test to add:**
  - a unit test in `lib/performance/compute.test.ts` showing retracted outcomes are excluded
  - an action-level test in the live e2e suite (`e2e-live/live.spec.ts`) that moves a card Won → Lost and reads `/performance`
- **Effort:** M

### [P2] FLOW-002: Mutations report success when they changed 0 rows (systemic)
- **Confidence:** CONFIRMED (traced)
- **Where:** each of these updates or deletes without `.select()` and without a row check, then returns `ok(...)`:
  - `pipeline/actions.ts:51-56` → "Moved to …". It also goes on to insert an `outcomes` row (`:90`) for a deleted or stale opportunity. That insert's error is ignored.
  - `outreach/actions.ts:181-191` "Campaign archived", `:265-274` "Step saved.", `:310-319` "Step removed."
  - `inbox/actions.ts:367-386` "Approved." This also fires when a concurrent approve already won.
  - `exchange/actions.ts:437-442` "Supplier profile saved.":
    - `profileId` comes from the form and is only blank-checked, not validated as a UUID
    - the audit row at `:452` is written with that unvalidated id
  - `exchange/actions.ts:541`, offering update: "Offering saved"
  - `exchange/actions.ts:371-378` "Request removed.", `:558-566` "Offering removed.", `:650-654` "Evidence removed."
  - `lib/data/directory.ts:236-245` "declined". The audit row is written even when nothing was pending.
- **Evidence:**
  ```
  const { error } = await db.from("sequence_steps").update(row).eq("id", value.id).eq("org_id", orgId).is("deleted_at", null);
  if (error) return fail(...);
  return ok({ id: value.id }, "Step saved.");
  ```
  RLS turns a forbidden or stale write into 0 rows, not an error.
- **Impact:**
  - When a stale tab, a race or a cross-org id updates nothing, the user is still told it worked.
  - On the pipeline path this also writes outcome or signal side effects.
  - Audit rows record actions that did not happen.
- **Root cause:** `mutate()` (`lib/data/org.ts:83-146`) gives no single-row write primitive, so each call site has to remember `.select("id").maybeSingle()`. About 15 places in the app layer don't. Others do, for example `updateNeedAction:349-358` and `setEnrollmentStatusAction:432-448`.
- **Fix (smallest):** add `updateOne(db, table, patch, match)` to `lib/data/org.ts`. It appends `.select("id").maybeSingle()` and returns `fail("That … no longer exists.")` on null. Switch the call sites above to it, and validate `profileId` and `offeringId` with `uuidSchema`. In `setOpportunityStatusAction`, return before the outcome and signal writes when no row moved.
- **Acceptance:** each listed action returns `ok:false` for a random UUID and for another org's id. No audit, outcome or signal row is written in that case.
- **Test to add:**
  - a `lib/data/org.test.ts` test for `updateOne` with a stub client returning `data: null`
  - an e2e-live case: approve the same draft twice, and the second call says "already approved"
- **Effort:** M

### [P2] TRUST-001: A supplier-profile domain can be squatted by any workspace admin, blocking the real owner (SEC-302 not applied to the Exchange)
- **Confidence:** CONFIRMED (traced)
- **Where:**
  - `packages/db/migrations/0060_exchange_core.sql:150` (free-text domain) and `:163-164` (unique index on domain)
  - `apps/web/app/(app)/[org]/exchange/actions.ts:403-457`
  - `packages/jobs/src/exchange-match.ts:137-138`
- **Evidence:**
  ```
  create unique index exchange_provider_profiles_domain_key on ... (domain) where domain is not null and deleted_at is null;
  profileSchema.domain: .transform(strip scheme/www) .pipe(regex)  -- no ownership check
  trust = verified_at ? 100 : claimed_at ? 60 : 30
  ```
  `0052` (SEC-302) fixed exactly this for `organizations.primary_domain`: a workspace counts at a domain only when an owner or admin has a confirmed address there. No equivalent exists for `exchange_provider_profiles`. I grepped 0060–0069 and found no trigger and no check.
- **Impact:**
  - Any workspace admin can file a supplier profile at a competitor's domain, labelled "Claimed profile" with trust 60, which beats an honest unclaimed listing.
  - The real company is then refused with a raw Postgres unique-violation message from `:449`. There is no claim or dispute flow.
  - This applies only while `HUNTLOOP_EXCHANGE=on`.
- **Root cause:** the profile's domain is accepted as typed. Domain ownership is never tied to the caller's verified email domains.
- **Fix (smallest):** a BEFORE INSERT/UPDATE trigger on `exchange_provider_profiles`. When `new.domain` is not null and has changed, require that an owner or admin of `new.org_id` has a confirmed `auth.users.email` at that domain or a subdomain. Reuse the predicate from `discoverable_workspaces()` in 0052. Otherwise raise `'You can only list a domain your team has an address at.'` Also map 23505 to a sentence that says the domain is already listed and how to report it, using `reportAction` with subject `provider`.
- **Acceptance:** an admin whose confirmed email is at `a.com` cannot save the domain `b.com`. Saving `a.com` works.
- **Test to add:** a case in `packages/db/scripts/verify-exchange-security.ts` that inserts a profile with a foreign domain as a session, and expects `insufficient_privilege`.
- **Effort:** S–M

### [P2] TRUST-002: "Verified" outlives the identity it verified
- **Confidence:** CONFIRMED (traced). The risk is latent: no code path sets `verified_at` today, so it can only be set by hand with the service role.
- **Where:**
  - `packages/db/migrations/0060_exchange_core.sql:155-156` (comment: "domain verification")
  - the guard at `:181-202`
  - `exchange/actions.ts:437-441`
  - the badges at `exchange/requests/[id]/MatchList.tsx:106-107` and `supplier/page.tsx:41`
- **Evidence:** the guard only blocks a session from changing `verified_at` itself:
  ```
  if tg_op = 'UPDATE' and new.verified_at is distinct from old.verified_at then raise
  ```
  `update(parsed.data)` freely rewrites `name`, `domain` and `kind` on a verified row.
- **Impact:** once a profile is verified, its admin can rename it or re-point its domain, and it keeps the green "Verified" badge and trust 100 in matching.
- **Root cause:** verification is stored as a bare timestamp with no binding to the attributes it vouched for.
- **Fix (smallest):** in the same trigger, when `auth.uid() is not null` and (`new.domain`, `new.name`) differs from `old`, set `new.verified_at := null`.
- **Acceptance:** changing the domain of a verified profile through a session clears `verified_at`, and the badge disappears.
- **Test to add:** a case in `verify-exchange-security.ts`.
- **Effort:** S

### [P2] TRUST-003: Saving an offering re-dates its stated availability, so stale stock reads as fresh
- **Confidence:** CONFIRMED (traced)
- **Where:**
  - `apps/web/app/(app)/[org]/exchange/actions.ts:524-528`
  - the comment at `:526`: matching ignores availability after 30 days
- **Evidence:**
  ```
  availability_as_of: parsed.data.availability ? new Date().toISOString() : null,
  ```
  This runs on every save, including a title or price edit with availability unchanged.
- **Impact:**
  - The 30-day freshness rule is meant to stop old "in stock" claims being matched.
  - Any unrelated edit silently renews the claim, so buyers are matched on stale availability presented as current.
  - This is a provenance-date defect.
- **Root cause:** the timestamp is derived from "a value is present", not from "the value was restated".
- **Fix (smallest):** on update, read the existing `availability` and `availability_as_of`, and only stamp `now()` when `availability` changed. Better still, add an explicit "Still accurate" control. A DB trigger would also work:
  ```
  if new.availability is not distinct from old.availability
  then new.availability_as_of := old.availability_as_of
  ```
- **Acceptance:** editing only the title leaves `availability_as_of` unchanged. Changing availability re-stamps it.
- **Test to add:** a `verify-exchange-security.ts` or pure test on the trigger or row builder.
- **Effort:** S

### [P2] API-001: The "schema not applied" result is cached per process for ever, so a warm instance keeps serving demo fixtures after migrations land
- **Confidence:** CONFIRMED (traced the code). The production effect is LIKELY.
- **Where:**
  - `apps/web/lib/data/source.ts:73-97`
  - compare `apps/web/proxy.ts`, `currentSchema` (30 s retry for anything that is not complete)
- **Evidence:**
  ```
  let schemaReady: boolean | null = null;
  if (schemaReady !== null) return schemaReady;      // false is cached too
  ...  if (missing) { schemaReady = false; return false; }
  ```
- **Impact:**
  - Suppose an instance probes during a deploy or migration window, sees the table missing, and caches `false`.
  - After the proxy's 30 s retry it lets traffic through. `resolveDataSource()` on that instance still returns `no-schema`.
  - Pages then render fixtures and every mutation says "migrations have not been applied" until the instance recycles.
  - That is the "fixtures at the real domain" state the proxy's production 503 exists to prevent.
- **Root cause:** a negative result is cached with no TTL, unlike the proxy's own cache.
- **Fix (smallest):** cache only `true`, or store `{ value, at }` and re-probe `false` after 30 s, as `proxy.ts` does.
- **Acceptance:** a unit test where the probe returns missing and then present shows `isSchemaApplied` becoming true after the TTL.
- **Test to add:** `lib/data/source.test.ts` with a stub client and fake timers.
- **Effort:** S

### [P3] API-002: Disconnecting a mailbox writes the audit event twice, and writes it even when nothing was disconnected
- **Confidence:** CONFIRMED
- **Where:** `apps/web/app/(app)/[org]/outreach/actions.ts:354-362`
- **Evidence:**
  ```
  354 await recordAudit(db, orgId, { action: "mailbox.disconnected", ..., targetId: id.data });
  355 if (!data) return fail("That mailbox is no longer connected.");
  357 await recordAudit(db, orgId, { action: "mailbox.disconnected", ..., meta: { email: data.email } });
  ```
- **Impact:** the audit log shows a disconnect that never happened (stale id, another org's id) and duplicates every real one. The trust record is wrong.
- **Root cause:** a leftover line from an edit.
- **Fix:** delete line 354.
- **Acceptance:** one audit row per successful disconnect, and none when it fails.
- **Test to add:** an action test with a stub `recordAudit` spy.
- **Effort:** S

### [P3] FLOW-003: The login redirect drops the query string from `next`, so deep links lose their state
- **Confidence:** CONFIRMED
- **Where:** `apps/web/proxy.ts:372`
- **Evidence:** `login.searchParams.set("next", path);` where `path = request.nextUrl.pathname`. The `search` part is discarded.
- **Impact:**
  - A signed-out visitor following `/acme/analyze?url=x&run=1` comes back to an empty analyzer after the magic link.
  - The same happens to `/acme/opportunities?priority=hot` and to Exchange links that carry query parameters.
  - The routes are protected, so the visitor is always signed out at that moment.
- **Root cause:** only the pathname is forwarded.
- **Fix:** `login.searchParams.set("next", path + request.nextUrl.search)`. `safeNextPath` already accepts it.
- **Acceptance:** a signed-out GET to `/x/opportunities?priority=hot` returns a 307 with `next=%2Fx%2Fopportunities%3Fpriority%3Dhot`.
- **Test to add:** a case in `lib/protected-routes.test.ts` or `e2e/routing.spec.ts` against a configured backend.
- **Effort:** S

### [P3] FLOW-004: Re-submitting a completed Exchange questionnaire files a second request
- **Confidence:** LIKELY. The UI disables the button while pending; the risk is browser back plus resubmit.
- **Where:** `apps/web/app/(app)/[org]/exchange/actions.ts:277-298`
- **Evidence:** the insert into `exchange_needs` is unconditional. The session update afterwards does not filter `status <> 'completed'`, its error is ignored, and it overwrites `need_id`.
- **Impact:**
  - Duplicate open requests are created.
  - Each one is matched and fans out supplier notifications.
  - The first request is orphaned from its transcript.
- **Root cause:** there is no idempotency key on submit.
- **Fix:** when `sessionId` is given, first claim it with
  ```
  update ... set status='completed' where id=$1 and status<>'completed' returning id
  ```
  If no row comes back, return the existing `need_id`, or fail with "already filed".
- **Acceptance:** two submits with the same `sessionId` produce one need.
- **Test to add:** an e2e-live case.
- **Effort:** S

---

## Journeys

| Journey | Status | Covering test(s) |
|---|---|---|
| Sign-up / login (magic link) | Implemented-unverified (the redirect safety is verified) | `lib/safe-next.test.ts`, `lib/protected-routes.test.ts` |
| Google OAuth | Implemented-unverified | none |
| Password reset | Missing by design (passwordless) | n/a |
| Invite → accept | Implemented-unverified | `e2e/engage.spec.ts` (demo refusal only) |
| Join request → approve/decline | Partial (decline reports success on 0 rows) | none |
| Onboarding / ICP | Verified-by-test (buyer path); seller/hunt path Implemented-unverified | `e2e-live/live.spec.ts:143`, `lib/onboarding/icp-step.test.ts`, `lib/data/icp*.test.ts` |
| Discover (public) | Implemented-unverified | none |
| Company / person views | Implemented-unverified (demo render only) | `e2e/smoke.spec.ts`, `e2e-live/live.spec.ts:56` |
| Outreach draft → approve → send | Implemented-unverified (approve may report success on 0 rows) | `lib/inbox/draft-blocked.test.ts`, `lib/data/outreach-release.test.ts`, `packages/jobs` verify and simulation scripts |
| Reply (inbox) | Implemented-unverified | none |
| Unsubscribe (prospect) | Verified-by-test (routing, refusal); RPC unverified here | `e2e/routing.spec.ts:144-200` |
| Sequences / steps | Partial (step save and remove report success on 0 rows) | none |
| Mailbox connect / disconnect | Partial (double audit) | none |
| HubSpot connect | Implemented-unverified | `packages/crm` verify-crm script |
| Pipeline stage → outcome | Broken for reversals (FLOW-001) | `e2e/daily-loop.spec.ts:121` (demo UI only) |
| Performance numbers | Partial (inherits FLOW-001) | `lib/performance/compute.test.ts` |
| Exchange needs / requests | Verified-by-test | `e2e-live/live.spec.ts:98,159,180`, `e2e/exchange.spec.ts`, `packages/db` verify-exchange-security |
| Exchange supplier profile / offerings | Partial (TRUST-001/002/003) | `e2e/exchange.spec.ts` (render only) |
| Exchange intros / messages / outcome | Verified-by-test | `e2e-live/live.spec.ts:98` |
| Matched needs (supplier side) | Implemented-unverified | none |
