import { cache } from "react";
import { resolveMembership } from "@huntloop/db";
import { resolveDataSource } from "./source";

/**
 * Who the caller is in this org, and what they may do.
 *
 * FEAT-04. The database has had a four-level role enum since the first
 * migration, `has_org_role()` enforces it in RLS, and the test suite proves a
 * viewer cannot write — but `resolveMembership()` returned the role and **no
 * screen read it**. A viewer saw "Draft outreach", "Assign" and "New hunt",
 * clicked them, and got a failure from Postgres.
 *
 * That was never a security hole: the boundary held, every time. It is a
 * product one, and a corrosive kind — an affordance that fails teaches people
 * not to trust the interface, and they cannot tell "I am not allowed" from
 * "this is broken" because the app never says which.
 *
 * ── What this is not ─────────────────────────────────────────────────────
 *
 * Not an authorization check. RLS is the authorization check. Everything here
 * decides what to *render*, and a caller who bypasses it entirely gets exactly
 * as far as one who does not: the database refuses the write. Hiding a button
 * is a courtesy, not a control, and the moment it is treated as a control
 * someone will move a policy out of Postgres to match.
 */

export type Role = "owner" | "admin" | "member" | "viewer";

const ROLES: readonly Role[] = ["owner", "admin", "member", "viewer"];

/**
 * `"demo"` is a third state, and collapsing it into either of the others is
 * the bug worth avoiding.
 *
 * Before the migrations are applied there is no `memberships` table to read, so
 * there is no role. Treating that as "viewer" would make the whole app appear
 * read-only during setup, which reads as broken; treating it as "owner" would
 * be inventing a fact. Naming it lets each call site decide — and every one of
 * them here chooses "show the controls", because there is no real data behind
 * them and the banner already says so.
 */
export type Viewer =
  | { kind: "member"; orgId: string; role: Role }
  | { kind: "demo" };

/**
 * Cached per request, so the org layout and the page inside it share one
 * lookup rather than each paying for `auth.getUser()` plus a join.
 */
export const currentViewer = cache(
  async (orgSlug: string): Promise<Viewer | null> => {
    const { db } = await resolveDataSource();
    if (!db) return { kind: "demo" };

    const membership = await resolveMembership(db, orgSlug);
    if (!membership) return null;

    return {
      kind: "member",
      orgId: membership.orgId,
      // The column is a Postgres enum, so a value outside this set means the
      // enum changed and this file did not. Falling back to the least
      // privileged reading is the safe direction for that mistake.
      role: ROLES.includes(membership.role as Role)
        ? (membership.role as Role)
        : "viewer",
    };
  },
);

/**
 * May this viewer change things?
 *
 * `viewer` is the only role that cannot, which matches `has_org_role()` in the
 * migrations. Written as an explicit list rather than `role !== "viewer"` so
 * that adding a fifth role has to make a decision here instead of silently
 * inheriting write access.
 */
export function canWrite(viewer: Viewer | null): boolean {
  if (!viewer) return false;
  if (viewer.kind === "demo") return true;
  return viewer.role === "owner" || viewer.role === "admin" || viewer.role === "member";
}

/**
 * May this viewer spend money — run a model, start a hunt?
 *
 * The same set as `canWrite` today, and separate on purpose. Model calls are
 * the one action in this product with a per-use cost attached, and "who can
 * write a note" and "who can spend the AI budget" are questions an
 * organisation will eventually want to answer differently. Splitting them now
 * costs one function; splitting them later means finding every call site.
 */
export function canSpend(viewer: Viewer | null): boolean {
  return canWrite(viewer);
}
