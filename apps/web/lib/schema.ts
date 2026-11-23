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
 *   partial   0001 is there, the newest migration's marker is not.
 *   complete  both are there.
 *
 * Probed through PostgREST with the publishable key, the same way the browser
 * talks to Supabase: no service key is needed to ask whether an object exists.
 * 404 means it is not in the schema cache. 200, 401 and 403 all mean it
 * exists.
 *
 * Shared by `proxy.ts` and `/api/health` so the two cannot disagree.
 */

export type SchemaState = "none" | "partial" | "complete";

/** Created by 0001. Its absence means no migration has run. */
export const BASE_TABLE = "organizations";

/**
 * The newest migration this code needs, and the marker function it creates.
 *
 * PROD-201: this used to be the newest *table*, bumped by hand, and it lagged.
 * It still named 0047's table after 0048–0050 had added columns and functions
 * the send path cannot run without, so health reported "complete" on a
 * database missing all three, and every send deferred itself forever.
 *
 * Every migration since 0031 ends with `migration_NNNN_applied()`, an
 * immutable function that returns true. Calling it is harmless, and it exists
 * only once the whole file has run. `scripts/audit.mjs` (SCHEMA-01) fails the
 * build when this does not name the newest migration in the repo.
 */
export const LATEST_MIGRATION = "0058";
export const LATEST_MARKER = `migration_${LATEST_MIGRATION}_applied`;


function present(status: number, what: string): boolean {
  if (status === 404) return false;
  if ((status >= 200 && status < 300) || status === 401 || status === 403) return true;
  throw new Error(`Schema probe for ${what} answered HTTP ${status}`);
}

async function tableExists(url: string, key: string, table: string): Promise<boolean> {
  const res = await fetch(`${url}/rest/v1/${table}?select=*&limit=1`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    cache: "no-store",
  });
  return present(res.status, table);
}

async function markerExists(url: string, key: string, fn: string): Promise<boolean> {
  const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: "{}",
    cache: "no-store",
  });
  return present(res.status, fn);
}

/** Throws on network trouble — callers decide which way to fail. */
export async function probeSchema(url: string, key: string): Promise<SchemaState> {
  const [base, latest] = await Promise.all([
    tableExists(url, key, BASE_TABLE),
    markerExists(url, key, LATEST_MARKER),
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
