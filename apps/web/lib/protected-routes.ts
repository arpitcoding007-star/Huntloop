/**
 * Which paths are real, signed-in-only pages — for the proxy's guard.
 *
 * ── Why the guard needs to know ──────────────────────────────────────────
 *
 * The guard used to redirect every anonymous request that was not public to
 * `/login`. That included URLs that do not exist: `/pricing-page`, a typo, a
 * dead link from elsewhere. The visitor signed in and was then shown a 404 —
 * or, more often, gave up at the sign-in form for a page that was never there.
 *
 * Now a path that matches one of these shapes still goes to sign-in, and
 * anything else is answered with the not-found page.
 *
 * ── Why this list fails closed ───────────────────────────────────────────
 *
 * A route added without updating this list is answered 404 to *anonymous*
 * visitors — never rendered for them. Signed-in users do not pass through this
 * check at all. So forgetting an entry costs a sign-in redirect, not exposure,
 * and `protected-routes.test.ts` compares the list with the folders on disk so
 * it does not stay forgotten.
 */

/** Top-level folders under `app/(app)/[org]` — the workspace screens. */
export const WORKSPACE_SECTIONS = [
  "analytics",
  "analyze",
  "companies",
  "dashboard",
  "imports",
  "inbox",
  "intelligence",
  "learn",
  "memory",
  "opportunities",
  "ops",
  "outreach",
  "pipeline",
  "settings",
  "sources",
  "team",
] as const;

/** Signed-in-only prefixes that are not inside a workspace. */
const ACCOUNT_PREFIXES = ["/orgs", "/welcome", "/invite", "/api"];

const SECTIONS = new Set<string>(WORKSPACE_SECTIONS);

export function isProtectedRoute(path: string): boolean {
  if (ACCOUNT_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) return true;

  // `/<org>/<section>[/…]`. The org slug cannot be checked here — that needs
  // the database and a session — so any slug with a known section counts.
  const [, org, section] = path.split("/");
  return Boolean(org) && Boolean(section) && SECTIONS.has(section!);
}
