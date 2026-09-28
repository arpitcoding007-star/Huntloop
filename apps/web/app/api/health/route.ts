import { NextResponse } from "next/server";
import { LATEST_TABLE, isProductionDeployment, probeSchema, supabaseEnv } from "../../../lib/schema";

/**
 * What this deployment is connected to, as booleans.
 *
 * Exists so "is seefluence.com the real production?" is one request rather
 * than a dashboard tour: which commit is serving, whether the database is
 * configured and fully migrated, and which integrations have a key. The
 * go/no-go checklist in SETUP.md reads it.
 *
 * Never a value. Every field is `true`/`false` or a state name, except the
 * commit SHA and the Supabase host, both of which are already public (the
 * repository is public and the Supabase URL is compiled into the browser
 * bundle). A key's *presence* tells an attacker nothing they could not learn
 * by using the feature.
 *
 * 200 when the core chain works (database migrated, jobs can authenticate,
 * site URL set), 503 otherwise — so an uptime monitor pointed here alerts on
 * a broken deployment rather than only on a dead one.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const has = (name: string) => Boolean(process.env[name]?.trim());

export async function GET() {
  const env = supabaseEnv();

  let database: "unconfigured" | "unreachable" | "none" | "partial" | "complete" =
    "unconfigured";
  if (env) {
    try {
      database = await probeSchema(env.url, env.key);
    } catch {
      database = "unreachable";
    }
  }

  const report = {
    environment: process.env.VERCEL_ENV ?? "local",
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL?.trim() || null,
    database: {
      host: env ? new URL(env.url).host : null,
      schema: database,
      latestTableProbed: LATEST_TABLE,
      serviceKey: has("SUPABASE_SECRET_KEY") || has("SUPABASE_SERVICE_ROLE_KEY"),
    },
    jobs: {
      cronSecret: has("CRON_SECRET"),
      inngest: has("INNGEST_SIGNING_KEY") && has("INNGEST_EVENT_KEY"),
    },
    credentialEncryption: has("MAILBOX_ENCRYPTION_KEY"),
    integrations: {
      anthropic: has("ANTHROPIC_API_KEY"),
      apollo: has("APOLLO_API_KEY"),
      enrichment: has("ENRICHMENT_API_KEY"),
      emailVerification: has("EMAIL_VERIFICATION_API_KEY"),
      gmail: has("GOOGLE_CLIENT_ID") && has("GOOGLE_CLIENT_SECRET"),
      outlook: has("MICROSOFT_CLIENT_ID") && has("MICROSOFT_CLIENT_SECRET"),
      sentry: has("SENTRY_DSN") && has("NEXT_PUBLIC_SENTRY_DSN"),
      posthog: has("NEXT_PUBLIC_POSTHOG_KEY"),
    },
  };

  const ok =
    database === "complete" &&
    report.database.serviceKey &&
    report.jobs.cronSecret &&
    report.credentialEncryption &&
    Boolean(report.siteUrl);

  return NextResponse.json(
    { ok, production: isProductionDeployment(), ...report },
    { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
