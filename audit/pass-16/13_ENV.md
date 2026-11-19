# Pass 16 — environment inventory (names only)

Source: reviewer E, `_raw/reviewer-E.md` §6. No values were read or printed. Commit `7e09759`.

Production (health GET 2026-11-14): `cronSecret:false`, `credentialEncryption:false`, every integration false. Locally `apps/web/.env.local` sets `CRON_SECRET` (why the local tick returns 404 to an unauthenticated GET).


Sources: `.env.example` (40 names), every `process.env.*` in `apps/` and `packages/` (non-test), `packages/{db,ai}/src/env.ts`, `apps/web/vercel.json` (no env, no crons), and the workflows. "Loud" means it refuses or reports. "Silent" means it degrades without telling anyone.

| Name | Req? | Read in | What dies without it | Loud/silent |
|---|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Required | `db/src/env.ts`, `lib/schema.ts`, `lib/csp.ts`, `lib/data/source.ts`, `AuthForm.tsx` | Whole app (demo off-prod, 503 in prod) | Loud |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (alias `…_ANON_KEY`) | Required | same | same | Loud |
| `SUPABASE_SECRET_KEY` (alias `SUPABASE_SERVICE_ROLE_KEY`) | Required | `db/src/env.ts`, `lib/ai/seal.ts`, `digest-token.ts`, `public-research.ts` | Jobs, seals, digest unsubscribe; the IP salt falls back to a public constant only with no DB | Loud (health 503) |
| `DATABASE_URL` | Required for migrate | `packages/db/scripts/*`, `migrate.yml` | Migrations | Loud (`migrate.yml` exit 1) |
| `MIGRATIONS_BASELINE` | First run only | `migrate.ts:110`, `migrate.yml` | The first ledger run on a hand-migrated DB refuses | Loud |
| `NEXT_PUBLIC_SITE_URL` | Required | `lib/site-url.ts`, `health`, `send-message.ts:819`, `send-digests.ts:83`, `send-notifications.ts:28`, `sync-hubspot.ts:125` | Absolute links. Outreach refuses to send (loud). Digests and notifications skip (`ok:true, skipped`). **HubSpot pushes `https://app.huntloop.example`** (silent, DEBT-201). Site URL falls back to `VERCEL_PROJECT_PRODUCTION_URL`, then localhost | Mixed |
| `CRON_SECRET` | Required | `jobs/src/index.ts:108`, `lib/data/engine.ts`, `tick.yml` | Whole engine (tick 503) | Loud |
| `MAILBOX_ENCRYPTION_KEY` | Required to connect | `db/src/crypto.ts:81` | Mailbox and CRM connect refused | Loud |
| `ANTHROPIC_API_KEY` | Optional | `ai/src/env.ts` | AI screens show a labelled worked example | Loud (stated) |
| `HUNTLOOP_AI_TIMEOUT_MS` | Optional (default 55 s) | `ai/src/env.ts` | — | — |
| `APOLLO_API_KEY` | Optional | `providers/src/registry.ts` | Discovery and reach | Stated in UI |
| `ENRICHMENT_API_KEY` | Optional | `providers/src/registry.ts` | Person enrichment; vendor picked by key shape | Stated |
| `EMAIL_VERIFICATION_API_KEY` | Optional | `providers/src/registry.ts` | Verification | Stated |
| `GOOGLE_CLIENT_ID` / `_SECRET` | Optional | `jobs/src/mailbox/provider.ts`, `gmail.ts:368` | Gmail connect | Loud |
| `MICROSOFT_CLIENT_ID` / `_SECRET` | Optional | `provider.ts`, `outlook.ts:242` | Outlook connect | Loud |
| `RESEND_API_KEY`, `EMAIL_FROM` | Optional (both) | `jobs/src/email/resend.ts` | Invites, join requests, digest emails | `isEmailConfigured()`. Invites return the link instead |
| `EMAIL_REPLY_TO` | Optional | `resend.ts` | — | — |
| `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` | Optional (alternative driver) | `jobs/src/index.ts`, `api/inngest`, `lib/data/engine.ts` | Inngest route returns 404 | Loud |
| `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` | Optional | sentry configs, `lib/csp.ts` | All error tracking, CSP reports | **Silent** (OBS-201) |
| `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` | Optional, build | `next.config.ts` | Source-map upload | Silent by design |
| `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST` | Optional | `lib/analytics.ts` | Analytics | Silent by design |
| `CSP_ENFORCE` | Optional | `lib/csp.ts:43` | CSP stays report-only | Silent (SEC-201) |
| `NEXT_PUBLIC_AUTH_GOOGLE` | Optional flag | `AuthForm.tsx` | Google sign-in button | — |
| `NEXT_PUBLIC_FEEDBACK_URL`, `NEXT_PUBLIC_HELP_URL` | Optional | `OrgShell.tsx`, `AccountMenu.tsx` | Menu links | — |
| `PUBLIC_RESEARCH_ENABLED`, `_DAILY_LIMIT` (200), `_SALT` | Optional | `public-research.ts` | Anonymous `/discover` research | Loud |
| `NEXT_PUBLIC_HUNTLOOP_DEV_BYPASS` | Dev only | `IcpStep.tsx:39` | — | — |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | **No reader in code** | `.env.example` only | nothing | Dead names (DEBT-203) |
| `VERCEL_ENV`, `VERCEL_GIT_COMMIT_SHA`, `VERCEL_PROJECT_PRODUCTION_URL`, `VERCEL_REGION`, `NEXT_PUBLIC_VERCEL_ENV` | Platform | `lib/schema.ts:76`, health, `site-url.ts`, tick route, `instrumentation-client.ts` | `VERCEL_ENV` alone decides the prod-only protections | — |
| `NODE_ENV`, `NEXT_RUNTIME`, `CI`, `PORT`, `DEMO_PORT`, `DEMO_PROD_PORT` | Platform/dev | various | — | — |
| GitHub: secret `CRON_SECRET`, var `HUNTLOOP_URL` | Required for heartbeat | `tick.yml` | Engine never ticks | Loud (red run) |
| GitHub: secret `DATABASE_URL`, var `MIGRATIONS_BASELINE` | Required for migrate | `migrate.yml` | Migrations | Loud |
| `VERCEL_OIDC_TOKEN` | Present in `apps/web/.env.local` (name only) | no reader | — | From `vercel env pull`; harmless |

Local `.env.local` files hold names that `.env.example` also lists. One parity note: `NEXT_PUBLIC_HUNTLOOP_DEV_BYPASS`, `PUBLIC_RESEARCH_*`, `EMAIL_*`, `RESEND_API_KEY` and `APOLLO_API_KEY` are absent from both local files, so `/discover` research and product email are off locally.

