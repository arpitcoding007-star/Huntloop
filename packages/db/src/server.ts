import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { supabasePublishableKey, supabaseUrl } from "./env";

/**
 * The client every request path should use.
 *
 * It carries the caller's session, so every query runs as that user and RLS
 * applies. It is the *only* client that should appear in a route handler,
 * server component, or job handler — the admin client in `./admin` bypasses
 * the tenant boundary and exists for a short list of exceptions.
 *
 * Cookie plumbing is injected rather than imported from `next/headers`, so
 * this package stays framework-agnostic and remains testable without a
 * request context.
 */
export interface CookieStore {
  getAll(): { name: string; value: string }[];
  setAll(
    cookies: { name: string; value: string; options?: CookieOptions }[],
  ): void;
}

export function createTenantClient(cookies: CookieStore) {
  return createServerClient(supabaseUrl(), supabasePublishableKey(), {
    cookies: {
      getAll: () => cookies.getAll(),
      setAll: (all: { name: string; value: string; options?: CookieOptions }[]) => {
        try {
          cookies.setAll(all);
        } catch {
          // Server Components cannot set cookies. Next's middleware refreshes
          // the session instead, so swallowing here is correct rather than
          // lazy — throwing would break every read-only page render.
        }
      },
    },
  });
}

export type TenantClient = ReturnType<typeof createTenantClient>;

/**
 * Resolves the caller's membership of one org.
 *
 * Returns null when the user is not a member — which is indistinguishable, by
 * design, from the org not existing. Telling an outsider "that org exists but
 * you can't see it" leaks the customer list.
 */
export async function resolveMembership(
  db: TenantClient,
  orgSlug: string,
): Promise<{ orgId: string; role: string } | null> {
  const { data: user } = await db.auth.getUser();
  if (!user?.user) return null;

  const { data, error } = await db
    .from("organizations")
    .select("id, memberships!inner(role, user_id)")
    .eq("slug", orgSlug)
    .eq("memberships.user_id", user.user.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (error || !data) return null;

  const membership = (data.memberships as { role: string }[] | null)?.[0];
  if (!membership) return null;

  return { orgId: data.id as string, role: membership.role };
}
