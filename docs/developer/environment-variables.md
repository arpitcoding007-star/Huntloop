---
description: Every variable the code reads, what breaks without it, and which are declared but dead.
---

# Environment variables

> **Layer:** Developer / Internal · **Audience:** engineering, operations

Copy `.env.example` to `apps/web/.env.local` and fill it in. Never commit the
filled version.

{% hint style="info" %}
`REPO-02` in `scripts/audit.mjs` fails the build if the code reads a variable
that is not documented in `.env.example`. The reverse is not checked — which is
how the dead `STRIPE_*` entries survived.
{% endhint %}

## Required for a live deployment

| Variable | Purpose | Without it |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project | Demo mode |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Browser + request-path client | Demo mode |
| `SUPABASE_SECRET_KEY` | **Server only.** Bypasses RLS; used exclusively by `packages/db/src/admin.ts` | The engine cannot run |
| `NEXT_PUBLIC_SITE_URL` | Canonical URLs, Open Graph, robots, sitemap, CRM back-links | Falls back to the per-deployment Vercel host, or `localhost:3100` — and gets published that way |
| `CRON_SECRET` | The heartbeat's bearer token | `/api/jobs/tick` returns **503**; nothing runs on a timer |

{% hint style="danger" %}
`SUPABASE_SECRET_KEY` must **never** carry the `NEXT_PUBLIC_` prefix. Anything
with that prefix is compiled into the browser bundle.
{% endhint %}

### Legacy key names

Read as a fallback by `packages/db/src/env.ts` for projects created before
Supabase renamed them. Set the current names.

| Legacy | Current |
|---|---|
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` |
| `SUPABASE_SERVICE_ROLE_KEY` | `SUPABASE_SECRET_KEY` |

### `DATABASE_URL`

Separate from the two keys above and the **only** one that can `CREATE TABLE`.
The keys talk to Supabase's web API, which reads and writes rows and cannot
change the schema. Without it, migrations must be pasted into the SQL editor by
hand. It is also what `EXPLAIN ANALYZE` needs — PostgREST will not return a
query plan.

Use the **Transaction pooler** connection string for serverless.

## AI

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | All 12 tasks. Without it each screen shows a worked example **labelled as one** — not a refusal, and nothing is charged |

## Data providers

| Variable | Vendor | Capabilities |
|---|---|---|
| `APOLLO_API_KEY` | Apollo | `company.search`, `company.enrich`, `person.search`, `person.match`, `company.signals` |
| `ENRICHMENT_API_KEY` | Hunter | `person.match` — wins over Apollo when both are set |
| `EMAIL_VERIFICATION_API_KEY` | ZeroBounce | `email.verify` |

{% hint style="warning" %}
`.env.example`'s comment on `ENRICHMENT_API_KEY` still describes the **old**
key-sniffing design ("the vendor is chosen from the shape of the key"). The
registry now routes it to Hunter unconditionally. See
[Data providers](../architecture/providers.md#a-reversed-decision-worth-knowing-about).
{% endhint %}

## Stored credentials

| Variable | Purpose |
|---|---|
| `MAILBOX_ENCRYPTION_KEY` | 32 bytes hex. Encrypts `mailboxes.oauth_token_enc`, `mailboxes.refresh_token_enc` and `hubspot_connections.access_token` at the application layer. Connecting a mailbox or CRM is **refused** when unset |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Gmail OAuth. Redirect: `<SITE_URL>/api/mailboxes/gmail/callback`. Scopes: `gmail.send`, `gmail.readonly`, `userinfo.email` |
| `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` | Outlook OAuth. Redirect: `<SITE_URL>/api/mailboxes/outlook/callback`. Scopes: `Mail.Send`, `Mail.Read`, `User.Read`, `offline_access` |

```bash
openssl rand -hex 32
```

**Rotating `MAILBOX_ENCRYPTION_KEY` makes every connected mailbox and CRM need
reconnecting.**

HubSpot has **no env var** — each org pastes its own private-app token, which is
stored encrypted.

## Jobs

| Variable | Purpose |
|---|---|
| `CRON_SECRET` | Bearer token for `/api/jobs/tick`. A missing value **fails the request** rather than skipping the check |
| `INNGEST_EVENT_KEY` + `INNGEST_SIGNING_KEY` | Optional. When **both** are set, `/api/inngest` serves the same tick. One without the other is treated as not configured |

## Security

| Variable | Purpose |
|---|---|
| `CSP_ENFORCE` | Anything other than `"true"` ships the policy as `Content-Security-Policy-Report-Only`. Violations go to `/api/csp-report` and on to Sentry, and nothing is blocked |

{% hint style="info" %}
Leave CSP report-only until that report stream has been quiet for a week. A
wrong CSP does not fail loudly — it blocks one script on one route and the page
half-works, which is why this has a switch at all.
{% endhint %}

## Anonymous research

{% hint style="danger" %}
This puts an **Opus call with web fetching behind an unauthenticated
endpoint** — the single most expensive misconfiguration available in this
codebase.
{% endhint %}

| Variable | Purpose |
|---|---|
| `PUBLIC_RESEARCH_ENABLED` | Off unless **exactly** `"true"`. Leaving it off is a supported state, not a degraded one — `/discover` says "create a free account and we'll read yours right away" and the funnel continues |
| `PUBLIC_RESEARCH_DAILY_LIMIT` | The whole endpoint's ceiling for a rolling 24 hours. Default 200. **This is the control that actually bounds the bill** — a per-IP window is also enforced (5/hour) and a distributed script defeats that trivially. `0` switches the endpoint off entirely |
| `PUBLIC_RESEARCH_SALT` | Salt for the per-source rate-limit hash. Visitor addresses are hashed rather than stored; an `inet` column would be personal data about people who never became customers. Optional — unset weakens the anonymity, never the rate limiting |

## Observability

| Variable | Purpose |
|---|---|
| `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` | Usually the same value; separate because only the `NEXT_PUBLIC_` one is compiled into the browser bundle, and distinct names make an accidental swap visible |
| `SENTRY_ORG` / `SENTRY_PROJECT` / `SENTRY_AUTH_TOKEN` | Source-map upload. **All three** or upload is skipped |
| `NEXT_PUBLIC_POSTHOG_KEY` | Product analytics. Events are sent from the **server** (`posthog-node`); the key keeps its prefix because it is a public write-only project key |
| `NEXT_PUBLIC_POSTHOG_HOST` | Defaults to `https://eu.i.posthog.com` |

All optional; each is a no-op when unset, which is the normal state locally and
in CI.

## UI

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_FEEDBACK_URL` | Topbar Feedback link. Deliberately empty — the control is only rendered when it has somewhere to go |
| `NEXT_PUBLIC_HELP_URL` | Topbar Help button, same rule |

## Declared and dead

{% hint style="warning" %}
**Read by zero lines of code.**

* `STRIPE_SECRET_KEY`
* `STRIPE_WEBHOOK_SECRET`
* `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`

There is no billing. Either implement it or remove these — leaving them implies
a payment path that does not exist. [Open decision #1](../decisions/README.md#open-decisions).
{% endhint %}

## Set by the platform

Read but never set by hand: `CI`, `NODE_ENV`, `NEXT_RUNTIME`, `VERCEL_ENV`,
`NEXT_PUBLIC_VERCEL_ENV`, `VERCEL_REGION`,
`VERCEL_PROJECT_PRODUCTION_URL`, `DEMO_PORT`, `DEMO_PROD_PORT`.

## Related

* [Deployment](../operations/deployment.md)
* [Security model](../security/model.md)
