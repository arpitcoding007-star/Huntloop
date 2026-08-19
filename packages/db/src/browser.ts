import { createBrowserClient } from "@supabase/ssr";
import { supabasePublishableKey, supabaseUrl } from "./env.ts";

/**
 * Browser client, for the handful of things that genuinely belong on the
 * client: auth callbacks, realtime subscriptions, and optimistic updates.
 *
 * Data loading should stay on the server — a page that fetches its own rows
 * from the browser has moved the tenant check to a place where it is harder
 * to see, even though RLS still enforces it.
 */
export function createClientSideClient() {
  return createBrowserClient(supabaseUrl(), supabasePublishableKey());
}

export type ClientSideClient = ReturnType<typeof createClientSideClient>;
