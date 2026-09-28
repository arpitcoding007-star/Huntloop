/**
 * "Is the database this deployment points at actually ready?"
 *
 * Three answers rather than two, because the dangerous state is the middle
 * one. A project with `0001` applied and nothing after it has an
 * `organizations` table — which is all the old check looked for — so it was
 * reported as migrated, the guard switched on, and then onboarding, discovery,
 * providers and CRM failed one screen at a time against tables that did not
 * exist. `partial` names that state so it can be refused instead.
 *
 *   none      `organizations` (0001) is missing — nothing is applied.
 *   partial   0001 is there, the newest migration's table is not.
 *   complete  both are there.
 *
 * Probed through PostgREST with the publishable key, the same way the browser
 * talks to Supabase: no service key is needed to ask whether a table exists.
 * 404 means the table is not in the schema cache. 200 (RLS returns no rows to
 * an anonymous caller) and 401/403 both mean it exists and RLS is working.
 *
 * Shared by `proxy.ts` and `/api/health` so the two cannot disagree.
 */

export type SchemaState = "none" | "partial" | "complete";

/** Created by 0001. Its absence means no migration has run. */
export const BASE_TABLE = "organizations";

/**
 * The newest table any migration creates — currently `0028`'s. `0029` adds
 * only functions, and calling a function to see whether it exists would run
 * it, so a table is the probe.
 *
 * Bump this when a migration adds a table the app cannot run without. It is
 * the same probe `packages/db/scripts/doctor.ts` uses for that file.
 */
export const LATEST_TABLE = "hubspot_connections";

async function tableExists(url: string, key: string, table: string): Promise<boolean> {
  const res = await fetch(`${url}/rest/v1/${table}?select=*&limit=1`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    cache: "no-store",
  });
  if (res.status === 404) return false;
  if (res.ok || res.status === 401 || res.status === 403) return true;
  throw new Error(`Schema probe for ${table} answered HTTP ${res.status}`);
}

/** Throws on network trouble — callers decide which way to fail. */
export async function probeSchema(url: string, key: string): Promise<SchemaState> {
  const [base, latest] = await Promise.all([
    tableExists(url, key, BASE_TABLE),
    tableExists(url, key, LATEST_TABLE),
  ]);
  if (!base) return "none";
  return latest ? "complete" : "partial";
}

export function supabaseEnv(): { url: string; key: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && key ? { url, key } : null;
}

/**
 * The production deployment, and only that one.
 *
 * `VERCEL_ENV` rather than `NODE_ENV`: every `next build` is NODE_ENV
 * production, including preview deployments and local `next start`, and those
 * are exactly the places the demo workspace is supposed to keep working.
 */
export function isProductionDeployment(): boolean {
  return process.env.VERCEL_ENV === "production";
}
