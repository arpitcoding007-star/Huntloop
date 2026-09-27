# API & backend audit

## Surface

HuntLoop deliberately has **no public REST API**. The backend surface is:

| Route | Purpose | Auth | Verdict |
|---|---|---|---|
| `/api/jobs/tick` | cron heartbeat | `CRON_SECRET` bearer, 404 on mismatch | ✅ |
| `/api/inngest` | alternative driver | Inngest signing key | ✅ |
| `/api/mailboxes/[provider]/start` | OAuth start | session | ✅ |
| `/api/mailboxes/[provider]/callback` | OAuth callback | state + session | ✅ |
| `/api/unsubscribe/[token]` | one-click unsubscribe | token | ✅ |
| `/api/csp-report` | CSP violations | none (by design, documented) | ✅ |
| `/auth/callback`, `/auth/signout` | Supabase auth | — | ✅ |

Everything else is **Server Actions**, co-located with the screens that use them (`app/(app)/[org]/*/actions.ts`).

No dead endpoints. No duplicate endpoints. No versioning needed, because nothing external consumes them.

## Server Action discipline (strong)

- **One result shape** for every mutation: `ActionResult<T>` with `ok`/`error`/`fieldErrors`, so forms share pending/error/success rendering.
- **One authorization helper**: `mutate(org, caller, run, { minRole })` resolves database, org and role, and distinguishes four refusals — demo mode, not a member, viewer role, not an admin — each with a sentence rather than a Postgres error.
- **Validation is mandatory and enforced by the build**: `SEC-VAL` in `scripts/audit.mjs` fails CI if any `"use server"` module skips zod parsing. Bounds as well as shape.
- **Postgres errors surface rather than being swallowed**, because in this schema a constraint violation is usually a product rule ("a fact needs a source") and hiding it discards the only explanation there is.
- Business logic lives in `lib/data/*` and `packages/*`, not in route handlers.

## Data-access layer

`apps/web/lib/data/` (36 modules) is the read side. Every loader goes through `load(liveFn, demoFn)` which returns `{ data, source }`, so a screen always knows whether it is showing real rows — the mechanism behind the honest-UI invariant. `requireOrgId` centralises membership resolution.

The pattern of a **second query beside the main one** (evidence, contact fit) rather than deeper embeds is a deliberate resilience choice: a mistake in a nested embed throws and takes out the page; a separate read that returns empty costs only that feature.

## Findings

| # | Severity | Finding |
|---|---|---|
| AP-1 | Medium | `/api/inngest` exists as an alternative driver but is undocumented in the README's deployment section (only `.env.example` mentions it) |
| AP-2 | Medium | No idempotency keys on mutating Server Actions — a double-submitted "add to campaign" is guarded only by database constraints, which is usually but not always enough |
| AP-3 | Medium | No structured request logging: Sentry captures errors, PostHog captures funnel events, but there is no per-request trace tying a user action to the jobs it spawned |
| AP-4 | Low | No public API — correct for now, but every integration request will ask for one; `26` Phase 5 is the right time |
| AP-5 | Low | `/api/csp-report` is unauthenticated by design and unrated-limited; documented, low risk, worth a volume cap |

## Backend architecture note

The split is clean and worth preserving:

```
Server Action  →  lib/data (read)  →  Supabase (RLS, user session)
Server Action  →  enqueue()        →  job_executions
Job handler    →  OrgScope         →  Supabase (service role, org-filtered)
Job handler    →  packages/providers → vendor
```

The two database paths are genuinely separated: the request path uses the user's session and RLS; the engine path uses the service role and `OrgScope`'s mechanical org filter. `check-admin-imports.ts` prevents the first from becoming the second.
