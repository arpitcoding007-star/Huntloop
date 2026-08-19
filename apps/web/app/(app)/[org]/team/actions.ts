"use server";

import { revalidatePath } from "next/cache";
import { fail, mutate, ok, type ActionResult } from "../../../../lib/data/org";
import { memberRoleSchema, uuidSchema } from "../../../../lib/validation";

/**
 * Membership writes — master context §38, and the role enum from `0001`.
 *
 * Every action here asks for `minRole: "admin"`, because `0001` guards
 * `memberships` with `has_org_role(org_id, 'admin')` and nothing above the
 * database was enforcing it. A member changing a colleague's role was refused
 * by Postgres and by nothing else, which reaches the user as a policy error
 * rather than a sentence.
 *
 * ── Why there is no invite action ────────────────────────────────────────
 *
 * Inviting a new user means creating one, and that is `auth.admin`, which
 * needs the service-role key. `apps/web` may not import it — there is a CI
 * check, `packages/db/scripts/check-admin-imports.ts` — and routing an invite
 * through a server the app does not have would be a new deployment surface,
 * not a button. So the screen says invites are not built rather than
 * rendering a control that cannot work. It is `TEAM-02` in the backlog.
 */

export async function setMemberRoleAction(
  org: string,
  membershipId: string,
  role: string,
): Promise<ActionResult<undefined>> {
  const id = uuidSchema.safeParse(membershipId);
  if (!id.success) return fail("That member reference isn't valid.");

  const parsedRole = memberRoleSchema.safeParse(role);
  if (!parsedRole.success) return fail("That isn't a role this organisation has.");

  return mutate(
    org,
    "setMemberRole",
    async ({ db, orgId }) => {
      /* Read first, so the two rules below can be checked against the row
         rather than assumed. Both exist to stop an organisation locking
         itself out, which RLS cannot prevent — the policy asks "are you an
         admin", not "will an owner still exist afterwards". */
      const { data: target, error: readError } = await db
        .from("memberships")
        .select("id, user_id, role")
        .eq("id", id.data)
        .eq("org_id", orgId)
        .is("deleted_at", null)
        .maybeSingle();

      if (readError) return fail(`That role could not be changed: ${readError.message}`);
      if (!target) return fail("That member is no longer part of this organisation.");

      if (target.role === "owner" && parsedRole.data !== "owner") {
        const remaining = await countOwners(db, orgId);
        if (remaining <= 1) {
          return fail(
            "This is the last owner. Promote somebody else to owner first — an organisation with none cannot change its own settings or membership again.",
          );
        }
      }

      const { error } = await db
        .from("memberships")
        .update({ role: parsedRole.data })
        .eq("id", id.data)
        .eq("org_id", orgId)
        .is("deleted_at", null);

      if (error) return fail(`That role could not be changed: ${error.message}`);

      revalidatePath(`/${org}/team`);
      return ok(undefined, `Role changed to ${parsedRole.data}.`);
    },
    { minRole: "admin" },
  );
}

/**
 * Soft delete, not `delete from`.
 *
 * `user_org_ids()` and `has_org_role()` both filter on `deleted_at is null`,
 * so a soft-deleted membership stops granting access immediately — the
 * boundary is unchanged. What it keeps is the record that the person was
 * here, which `audit_logs.actor_id` and every `owner_id` on an opportunity
 * still refer to.
 */
export async function removeMemberAction(
  org: string,
  membershipId: string,
): Promise<ActionResult<undefined>> {
  const id = uuidSchema.safeParse(membershipId);
  if (!id.success) return fail("That member reference isn't valid.");

  return mutate(
    org,
    "removeMember",
    async ({ db, orgId }) => {
      const { data: target, error: readError } = await db
        .from("memberships")
        .select("id, role")
        .eq("id", id.data)
        .eq("org_id", orgId)
        .is("deleted_at", null)
        .maybeSingle();

      if (readError) return fail(`That member could not be removed: ${readError.message}`);
      if (!target) return fail("That member is no longer part of this organisation.");

      if (target.role === "owner" && (await countOwners(db, orgId)) <= 1) {
        return fail(
          "This is the last owner. Removing them would leave an organisation nobody can administer.",
        );
      }

      const { error } = await db
        .from("memberships")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", id.data)
        .eq("org_id", orgId);

      if (error) return fail(`That member could not be removed: ${error.message}`);

      revalidatePath(`/${org}/team`);
      return ok(undefined, "Member removed.");
    },
    { minRole: "admin" },
  );
}

/** How many owners this org still has. The last-owner guard's whole basis. */
async function countOwners(
  db: import("@huntloop/db").TenantClient,
  orgId: string,
): Promise<number> {
  const { count } = await db
    .from("memberships")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("role", "owner")
    .is("deleted_at", null);
  return count ?? 0;
}

/* ── Assignments (master context §14) ────────────────────────────────────── */

/**
 * Who owns an opportunity.
 *
 * `minRole` stays at the default `"member"`, unlike everything above:
 * `opportunities` is guarded at `'member'` in `0003`, and picking up a piece
 * of work is the ordinary daily action of the role rather than an
 * administrative one.
 */
export async function assignOpportunityAction(
  org: string,
  opportunityId: string,
  ownerId: string | null,
): Promise<ActionResult<undefined>> {
  const id = uuidSchema.safeParse(opportunityId);
  if (!id.success) return fail("That opportunity reference isn't valid.");

  if (ownerId !== null) {
    const owner = uuidSchema.safeParse(ownerId);
    if (!owner.success) return fail("That member reference isn't valid.");
  }

  return mutate(org, "assignOpportunity", async ({ db, orgId }) => {
    if (ownerId !== null) {
      /* The owner must be a member of *this* org. `owner_id` references
         `auth.users` directly, so the foreign key would happily accept any
         real user id in the system — including one from another tenant. This
         is the only thing standing between that column and a cross-tenant
         write, so it is checked here rather than assumed from the UI having
         offered a list. */
      const { count } = await db
        .from("memberships")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId)
        .eq("user_id", ownerId)
        .is("deleted_at", null);

      if ((count ?? 0) === 0) {
        return fail("That person is not a member of this organisation.");
      }
    }

    const { error } = await db
      .from("opportunities")
      .update({ owner_id: ownerId })
      .eq("id", id.data)
      .eq("org_id", orgId)
      .is("deleted_at", null);

    if (error) return fail(`That assignment could not be saved: ${error.message}`);

    /* `assigned` is a state in the `opportunity_status` enum, and an
       opportunity that has an owner while still reading `discovered` makes the
       pipeline lie about where the work is.

       A separate statement, with an `in` filter, because the move is only
       valid from the three states that precede assignment: reassigning a
       `contacted` or `meeting` opportunity must not drag it backwards down the
       board. Folding this into the update above would apply it unconditionally.
       A failure here is not reported — the assignment itself succeeded, and
       telling the user their assignment failed because a derived status did
       not follow would send them to redo work that is already done. */
    if (ownerId) {
      await db
        .from("opportunities")
        .update({ status: "assigned" })
        .eq("id", id.data)
        .eq("org_id", orgId)
        .in("status", ["discovered", "researching", "qualified"])
        .is("deleted_at", null);
    }

    revalidatePath(`/${org}/team/assignments`);
    revalidatePath(`/${org}/opportunities`);
    revalidatePath(`/${org}/pipeline`);

    return ok(undefined, ownerId ? "Assigned." : "Unassigned.");
  });
}
