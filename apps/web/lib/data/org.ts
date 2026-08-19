import "server-only";
import { canAdmin, currentViewer, type Viewer } from "./membership";
import { getDb, resolveDataSource, type DataSource } from "./source";
import type { TenantClient } from "@huntloop/db";

/**
 * The org's UUID, for a caller already known to be a member.
 *
 * Lifted out of `opportunities.ts`, where it was private, because every module
 * added after it needs exactly the same three lines and copying them fifteen
 * times is how one of the copies ends up missing the membership check.
 *
 * This is NOT the authorization boundary — RLS is, and a caller who skipped
 * this would still get zero rows. It is how a loader learns the id, plus a
 * loud failure for the one case that should be impossible: a live request that
 * reached a loader without passing the layout's membership 404.
 */
export async function requireOrgId(orgSlug: string, caller: string): Promise<string> {
  const viewer = await currentViewer(orgSlug);
  if (!viewer || viewer.kind !== "member") {
    throw new Error(
      `${caller}: no membership resolved for "${orgSlug}" on a live database. ` +
        `The org layout should have returned 404 before this ran.`,
    );
  }
  return viewer.orgId;
}

/**
 * What a mutation returns to the client.
 *
 * One shape for every server action in the app, so the forms can share their
 * pending / error / success rendering instead of each inventing a convention.
 * `fieldErrors` exists because a form that says only "invalid" makes the user
 * hunt for which of nine fields it meant.
 */
export type ActionResult<T = undefined> =
  | { ok: true; data: T; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

export const ok = <T>(data: T, message?: string): ActionResult<T> => ({
  ok: true,
  data,
  message,
});

export const fail = (
  error: string,
  fieldErrors?: Record<string, string>,
): ActionResult<never> => ({ ok: false, error, fieldErrors });

/**
 * The write-side counterpart to `load()`.
 *
 * Resolves the database, the org id, and the caller's role in one place, then
 * hands the mutation a client that is already scoped. Refuses three ways, and
 * the three refusals are deliberately distinguishable to the user:
 *
 *   · no database   — demo mode. A write has nowhere to go, and pretending it
 *                     succeeded is the §7 failure this codebase is built to
 *                     avoid. Says so instead.
 *   · not a member  — the layout should have 404'd; loud rather than silent.
 *   · viewer role   — the read-only role. RLS would refuse the write anyway;
 *                     this turns a Postgres error into a sentence.
 *   · not an admin  — only when `minRole: "admin"` is asked for. See below.
 *
 * Note the ordering: demo mode is checked first, because in demo mode there is
 * no membership to resolve and a role check would report the wrong reason.
 *
 * ── Why `minRole` exists ─────────────────────────────────────────────────
 *
 * The schema has two write tiers, not one. `0001` guards `organizations` and
 * `memberships` with `has_org_role(..., 'admin')`; everything in `0002`–`0004`
 * is guarded with `'member'`. A member renaming the org is therefore refused
 * by Postgres and by nothing above it, and the user reads a policy violation
 * instead of a sentence. Defaulting to `"member"` keeps every existing call
 * site correct; the two modules that touch org-level rows ask for `"admin"`.
 */
export async function mutate<T>(
  orgSlug: string,
  caller: string,
  run: (ctx: { db: TenantClient; orgId: string; viewer: Viewer }) => Promise<ActionResult<T>>,
  options: { minRole?: "member" | "admin" } = {},
): Promise<ActionResult<T>> {
  const { db, source } = await resolveDataSource();

  if (!db) {
    return fail(
      source === "unconfigured"
        ? "This deployment has no database connected, so there is nothing to save to. The figures you see are illustrative."
        : "The database is connected but its migrations have not been applied yet, so there are no tables to write to.",
    );
  }

  const viewer = await currentViewer(orgSlug);
  if (!viewer || viewer.kind !== "member") {
    return fail("You are not a member of this organisation.");
  }
  if (viewer.role === "viewer") {
    return fail("Your role is read-only, so this change was not saved. An admin can change your role under Members.");
  }
  if (options.minRole === "admin" && !canAdmin(viewer)) {
    return fail(
      "Only an owner or an admin can change this. Your role is " +
        `${viewer.role}, which can work with opportunities but not with the ` +
        "organisation itself.",
    );
  }

  try {
    return await run({ db, orgId: viewer.orgId, viewer });
  } catch (e) {
    /* The message from Postgres is shown rather than swallowed. A constraint
       in this schema is usually a product rule — "an opportunity is unique per
       company per ICP", "a fact needs a source" — and hiding it behind
       "Something went wrong" throws away the only explanation there is. */
    return fail(e instanceof Error ? e.message : "The change could not be saved.");
  }
}

/** Re-exported so a module needing a raw client does not import two files. */
export { getDb, resolveDataSource };
export type { DataSource, TenantClient };

/**
 * The signed-in user's id, or null.
 *
 * Lifted here for the same reason `requireOrgId` was: it had been written
 * privately in two modules, a third needed it, and three copies of an auth
 * call is how one of them ends up reading the cheaper `getSession()` — which
 * trusts the cookie without verifying it.
 *
 * Not an authorization check. `mutate` has already established membership by
 * the time a caller has a `db` to pass; this answers "which person", for the
 * rows that record one.
 */
export async function currentUserId(db: TenantClient): Promise<string | null> {
  const { data } = await db.auth.getUser();
  return data.user?.id ?? null;
}
