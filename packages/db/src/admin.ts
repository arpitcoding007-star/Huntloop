import { createClient } from "@supabase/supabase-js";
import { supabaseSecretKey, supabaseUrl } from "./env";

/**
 * ⚠ SERVICE-ROLE CLIENT — BYPASSES ROW LEVEL SECURITY ENTIRELY ⚠
 *
 * Plan D2 names this the single largest risk in the architecture: RLS makes
 * cross-tenant leakage a database-level impossibility, and this client is the
 * one thing that turns it back into an application-level discipline. One of
 * these in a request path and the tenant boundary is gone.
 *
 * Rules, all enforced by `scripts/check-admin-imports.ts` in CI:
 *
 *   1. `apps/web` may never import this module. Not once, not "temporarily".
 *   2. Legitimate callers are: migrations/seeds, webhook handlers that run
 *      with no user session (Stripe, mailbox providers), and background jobs
 *      that have already resolved their tenant.
 *   3. Every query made through it carries an explicit `.eq("org_id", …)`
 *      plus a comment saying why the bypass is necessary. "It was easier"
 *      is not a reason; if RLS is blocking you, the policy is the bug.
 */
export function createAdminClient() {
  if (typeof window !== "undefined") {
    // Defence in depth behind the import check. If this module ever reaches a
    // browser bundle, the secret key is already in it — so fail loudly at the
    // first call rather than silently handing out a superuser client.
    throw new Error(
      "createAdminClient() was called in a browser context. The service-role " +
        "key must never reach the client. This is a build configuration bug.",
    );
  }

  return createClient(supabaseUrl(), supabaseSecretKey(), {
    auth: {
      // No session handling at all: this client is not a user, and persisting
      // or refreshing a "session" for it would be meaningless and racy.
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export type AdminClient = ReturnType<typeof createAdminClient>;
