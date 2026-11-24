#!/bin/bash
# Starts the isolated backend, the vendor simulator and the production build (built for 127.0.0.1:3199).
cd "$(dirname "$0")/../../.."
node --experimental-strip-types packages/db/testing/serve.ts > /tmp/st-db.log 2>&1 &
node audit/pass-22/harness/vendors.mjs > /tmp/st-v.log 2>&1 &
export NODE_OPTIONS="--import file:///W:/work-backup/Huntloop/audit/pass-22/harness/rewrite.mjs"
export NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:3199 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=test-anon NEXT_PUBLIC_SUPABASE_ANON_KEY=test-anon SUPABASE_SECRET_KEY=test-service-role DATABASE_URL= NEXT_PUBLIC_SITE_URL=http://127.0.0.1:3103 ANTHROPIC_API_KEY=synthetic ANTHROPIC_BASE_URL=http://127.0.0.1:3196/anthropic RESEND_API_KEY=re_x EMAIL_FROM="Huntloop <mail@huntloop.example>" CRON_SECRET=audit-cron INNGEST_EVENT_KEY= INNGEST_SIGNING_KEY= SENTRY_DSN= NEXT_PUBLIC_SENTRY_DSN= POSTHOG_KEY= NEXT_PUBLIC_POSTHOG_KEY= HUNTLOOP_EXCHANGE=on HUNTLOOP_BUYER_HOST=localhost:3103 MAILBOX_ENCRYPTION_KEY=BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc= APOLLO_API_KEY=a ENRICHMENT_API_KEY=h EMAIL_VERIFICATION_API_KEY=z GOOGLE_CLIENT_ID=g GOOGLE_CLIENT_SECRET=g MICROSOFT_CLIENT_ID=m MICROSOFT_CLIENT_SECRET=m PUBLIC_RESEARCH_ENABLED=true VERCEL_OIDC_TOKEN=
node node_modules/next/dist/bin/next start apps/web -p 3103 > /tmp/st-web.log 2>&1 &
wait
