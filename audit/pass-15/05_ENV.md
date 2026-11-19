# Pass 15 — env inventory (names only)

| Name | Read by | In `.env.example` | Set in prod (per `/api/health`) |
|---|---|---|---|
| NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY | web, db | yes | yes |
| NEXT_PUBLIC_SUPABASE_ANON_KEY (legacy alias) | `lib/schema.ts` | **no** | — |
| SUPABASE_SECRET_KEY | db admin, health | yes | yes |
| SUPABASE_SERVICE_ROLE_KEY (legacy alias) | db admin, health | **no** | — |
| DATABASE_URL, MIGRATIONS_BASELINE | `migrate.ts`, doctor | yes | n/a (GitHub secret/var) |
| CRON_SECRET | tick route, health | yes | **no** |
| INNGEST_SIGNING_KEY, INNGEST_EVENT_KEY | inngest route | yes | no |
| MAILBOX_ENCRYPTION_KEY | `db/src/crypto.ts` | yes | **no** |
| NEXT_PUBLIC_SITE_URL | `site-url.ts`, `send-message.ts` | yes | yes (`https://huntloop.pro` — fails TLS) |
| ANTHROPIC_API_KEY, HUNTLOOP_AI_TIMEOUT_MS | ai | yes | no |
| APOLLO_API_KEY, ENRICHMENT_API_KEY, EMAIL_VERIFICATION_API_KEY | providers, jobs | yes | no |
| GOOGLE_CLIENT_ID/SECRET, MICROSOFT_CLIENT_ID/SECRET, NEXT_PUBLIC_AUTH_GOOGLE | mailbox, auth | yes | no |
| RESEND_API_KEY, EMAIL_FROM, EMAIL_REPLY_TO | product email | yes | no |
| SENTRY_DSN, NEXT_PUBLIC_SENTRY_DSN, SENTRY_ORG/PROJECT/AUTH_TOKEN | observability | yes | no |
| NEXT_PUBLIC_POSTHOG_KEY/HOST | analytics | yes | no |
| PUBLIC_RESEARCH_SALT/ENABLED/DAILY_LIMIT | `/discover` | yes | unknown |
| CSP_ENFORCE | `lib/csp.ts` | yes | unknown |
| NEXT_PUBLIC_HELP_URL, NEXT_PUBLIC_FEEDBACK_URL, NEXT_PUBLIC_HUNTLOOP_DEV_BYPASS | web | yes | unknown |
| HUNTLOOP_URL (GitHub variable) | `tick.yml` | n/a | unverified |
