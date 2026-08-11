import { cookies } from "next/headers";
import { createTenantClient, type TenantClient } from "@huntloop/db";

/**
 * Where a screen's data came from.
 *
 * There are three real states, not two, and conflating the last two is what
 * makes a half-configured deployment confusing:
 *
 *   live          Supabase is connected and the schema is applied.
 *   unconfigured  No Supabase credentials. Running on fixtures.
 *   no-schema     Credentials work, but the migrations have not been applied.
 *
 * `no-schema` is a normal step in setup, not a crash — you get keys before you
 * get tables. It used to surface as a 404 on every page, which reads as "the
 * app is broken" rather than "you have one command left to run".
 *
 * Every loader returns its source, and the layout renders a banner for
 * anything that isn't `live`. The app never shows demo data as if it were
 * real: §7 forbids presenting the unverified as established, and a dashboard
 * of invented pipeline numbers is that failure aimed at ourselves.
 */
export type DataSource = "live" | "unconfigured" | "no-schema";

export interface Loaded<T> {
  data: T;
  source: DataSource;
}

/**
 * True when both public Supabase settings are present. Checks the
 * *publishable* pair only: the secret key is server-only, and its absence must
 * not silently downgrade a configured deployment to demo data.
 */
export function isDatabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  );
}

/**
 * A tenant-scoped client for the current request, or null when Supabase is not
 * configured. Never returns an admin client — see packages/db/src/admin.ts.
 */
export async function getDb(): Promise<TenantClient | null> {
  if (!isDatabaseConfigured()) return null;
  const store = await cookies();
  return createTenantClient({
    getAll: () => store.getAll().map((c) => ({ name: c.name, value: c.value })),
    setAll: (all) => {
      for (const c of all) {
        try {
          store.set(c.name, c.value, c.options);
        } catch {
          // Server Components cannot set cookies; middleware refreshes the
          // session instead.
        }
      }
    },
  });
}

/**
 * Cached result of "have the migrations been applied?".
 *
 * Cached for the life of the process because the answer changes exactly once,
 * when someone runs the migrations — and probing on every page load would add
 * a round trip to every render forever to detect a one-time transition. A
 * restart picks up the change, which is what a migration involves anyway.
 */
let schemaReady: boolean | null = null;

export async function isSchemaApplied(db: TenantClient): Promise<boolean> {
  if (schemaReady !== null) return schemaReady;

  const { error } = await db.from("organizations").select("id").limit(1);

  // PGRST205 = table missing from PostgREST's schema cache; 42P01 = undefined
  // table. Anything else — a network blip, a permissions problem — is NOT
  // treated as "no schema", because silently showing demo data to hide a real
  // outage is worse than an error: the user would make decisions on it.
  if (error) {
    const missing =
      error.code === "PGRST205" ||
      error.code === "42P01" ||
      /schema cache|does not exist/i.test(error.message);
    if (missing) {
      schemaReady = false;
      return false;
    }
    throw new Error(`Database unreachable: ${error.message}`);
  }

  schemaReady = true;
  return true;
}

/** Resolves which of the three states this request is in. */
export async function resolveDataSource(): Promise<{
  db: TenantClient | null;
  source: DataSource;
}> {
  const db = await getDb();
  if (!db) return { db: null, source: "unconfigured" };
  if (!(await isSchemaApplied(db))) return { db: null, source: "no-schema" };
  return { db, source: "live" };
}

/**
 * Runs `live` when the database is connected AND migrated, otherwise returns
 * `fallback`.
 *
 * A failing query inside `live` is not caught here. A configured deployment
 * that quietly downgraded to fixtures on error would hide the outage behind
 * plausible-looking numbers.
 */
export async function load<T>(
  live: (db: TenantClient) => Promise<T>,
  fallback: () => T,
): Promise<Loaded<T>> {
  const { db, source } = await resolveDataSource();
  if (!db) return { data: fallback(), source };
  return { data: await live(db), source };
}
