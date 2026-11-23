# Pass 20 — env inventory (names only)

Source: `process.env.*` across `apps/`, `packages/`, `scripts/`; `.env.example`; `.github/workflows/*.yml`. No values were read or printed.

| Group | Names | In `.env.example` |
|---|---|---|
| Supabase | NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, NEXT_PUBLIC_SUPABASE_ANON_KEY (legacy), SUPABASE_SECRET_KEY, SUPABASE_SERVICE_ROLE_KEY (legacy), SUPABASE_URL / SUPABASE_ANON_KEY (scripts), DATABASE_URL, MIGRATIONS_BASELINE | yes (except legacy/script names) |
| Site | NEXT_PUBLIC_SITE_URL, NEXT_PUBLIC_FEEDBACK_URL, NEXT_PUBLIC_HELP_URL, NEXT_PUBLIC_AUTH_GOOGLE, CSP_ENFORCE | yes |
| AI | ANTHROPIC_API_KEY, HUNTLOOP_AI_TIMEOUT_MS | yes |
| Providers | APOLLO_API_KEY, ENRICHMENT_API_KEY, EMAIL_VERIFICATION_API_KEY | yes |
| Mail | MAILBOX_ENCRYPTION_KEY, GOOGLE_CLIENT_ID/SECRET, MICROSOFT_CLIENT_ID/SECRET, RESEND_API_KEY, EMAIL_FROM, EMAIL_REPLY_TO | yes |
| Jobs | CRON_SECRET, INNGEST_EVENT_KEY, INNGEST_SIGNING_KEY, INNGEST_BASE_URL, INNGEST_API_BASE_URL, INNGEST_ENV | partly (the last three are not in `.env.example`) |
| Billing (held) | STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY | yes — but no code reads them |
| Observability | SENTRY_DSN, NEXT_PUBLIC_SENTRY_DSN, SENTRY_ORG, SENTRY_PROJECT, SENTRY_AUTH_TOKEN, NEXT_PUBLIC_POSTHOG_KEY, NEXT_PUBLIC_POSTHOG_HOST | yes |
| Public research | PUBLIC_RESEARCH_ENABLED, PUBLIC_RESEARCH_DAILY_LIMIT, PUBLIC_RESEARCH_SALT | yes |
| Platform | VERCEL_ENV, VERCEL_REGION, VERCEL_PROJECT_PRODUCTION_URL, VERCEL_GIT_COMMIT_SHA, NEXT_PUBLIC_VERCEL_ENV, NODE_ENV, NEXT_RUNTIME, CI, PORT | n/a |
| Dev only | NEXT_PUBLIC_HUNTLOOP_DEV_BYPASS (dead-code-eliminated outside `NODE_ENV=development`, `welcome/icp/IcpStep.tsx:37-39`; skips no server check), DEMO_PORT, DEMO_PROD_PORT, ORG_ID, ACCESS_TOKEN (scripts) | partly |
| GitHub Actions | secrets.CRON_SECRET, secrets.DATABASE_URL, vars.HUNTLOOP_URL, vars.MIGRATIONS_BASELINE | — |

Observations:
- Local `apps/web/.env.local` sets most of the above but leaves `NEXT_PUBLIC_SITE_URL` empty; production's value is UNVERIFIED.
- `INNGEST_BASE_URL`, `INNGEST_API_BASE_URL`, `INNGEST_ENV` are read but undocumented in `.env.example` (Low; mechanizable: `audit.mjs` diff of `process.env` names vs `.env.example`).
