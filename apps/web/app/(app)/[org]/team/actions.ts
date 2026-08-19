"use server";

import { revalidatePath } from "next/cache";
import { recordAudit } from "../../../../lib/data/audit";
import { fail, mutate, ok, type ActionResult } from "../../../../lib/data/org";
import { checkQuota, quotaMessage } from "../../../../lib/data/usage";
import { siteUrl } from "../../../../lib/site-url";
import { inviteSchema, memberRoleSchema, parseForm, uuidSchema } from "../../../../lib/validation";

/**
 * Membership writes — master context §38, and the role enum from `0001`.
 *
 * Every action here asks for `minRole: "admin"`, because `0001` guards
 * `memberships` with `has_org_role(org_id, 'admin')` and nothing above the
 * database was enforcing it. A member changing a colleague's role was refused
 * by Postgres and by nothing else, which reaches the user as a policy error
 * rather than a sentence.
 *
 * ── How inviting avoids the service-role key ─────────────────────────────
 *
 * The backlog deferred invitations on the grounds that inviting a user means
 * *creating* one, which is `auth.admin` and needs the service-role key
 * `apps/web` may not import. That reasoning was half right, and the wrong
 * half is load-bearing.
 *
 * Creating a user is indeed privileged. Inviting one is not: an invitation is
 * a row in `invitations`, and acceptance is the invitee signing in through
 * the ordinary magic-link flow — which creates their account — and then
 * redeeming the token. The privileged step is the one Supabase Auth already
 * performs on its own.
 *
 * So the only thing this app holds is an unguessable token and the address it
 * was issued to, and `accept_invitation()` in `0007` refuses to redeem one
 * against a different address. Every action here asks for `minRole: "admin"`,
 * matching `0001`'s policy on `memberships`.
 *
 * ── Why the link is not emailed from here ────────────────────────────────
 *
 * There is no transactional sender configured, and a screen that says "invite
 * sent" when nothing was sent is the failure this codebase exists to avoid.
 * The action returns the link and the screen shows it to be copied. When a
 * mailbox is connected, sending it becomes an addition rather than a fix.
 */

export async function setMemberRoleAction(
  org: string,
  membershipId: string,
  role: string,
): Promise<ActionResult<undefined>> {
  const parsedRole = memberRoleSchema.safeParse(role);
  if (!parsedRole.success) return fail("That isn't a role this organisation has.");

  return mutate(
    org,
    "setMemberRole",
    async ({ db, orgId }) => {
      const id = uuidSchema.safeParse(membershipId);
      if (!id.success) return fail("That member reference isn't valid.");

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

      await recordAudit(db, orgId, {
        action: "member.role_changed",
        targetType: "membership",
        targetId: id.data,
        /* The previous role is the half that matters. "X is now an admin" is
           recoverable from the current row; "X was a viewer an hour ago" is
           not, and is the question an incident actually asks. */
        meta: { user_id: target.user_id, from: target.role, to: parsedRole.data },
      });

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
  return mutate(
    org,
    "removeMember",
    async ({ db, orgId }) => {
      const id = uuidSchema.safeParse(membershipId);
      if (!id.success) return fail("That member reference isn't valid.");

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

      await recordAudit(db, orgId, {
        action: "member.removed",
        targetType: "membership",
        targetId: id.data,
        meta: { role: target.role },
      });

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
  return mutate(org, "assignOpportunity", async ({ db, orgId }) => {
    const id = uuidSchema.safeParse(opportunityId);
    if (!id.success) return fail("That opportunity reference isn't valid.");

    if (ownerId !== null) {
      const owner = uuidSchema.safeParse(ownerId);
      if (!owner.success) return fail("That member reference isn't valid.");

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

    await recordAudit(db, orgId, {
      action: "opportunity.assigned",
      targetType: "opportunity",
      targetId: id.data,
      meta: { owner_id: ownerId },
    });

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

/* ── Invitations (0007) ──────────────────────────────────────────────────── */

export interface InviteResult {
  /** The URL to hand to the invitee. Shown, not emailed — see the note above. */
  url: string;
  email: string;
}

export async function inviteMemberAction(
  org: string,
  input: { email: string; role: string },
): Promise<ActionResult<InviteResult>> {
  const parsed = parseForm(inviteSchema, input);
  if (!parsed.ok) return fail(parsed.error, parsed.fieldErrors);
  const { email, role } = parsed.value;

  return mutate(
    org,
    "inviteMember",
    async ({ db, orgId }) => {
      /* Seats are a plan limit, not a rate limit, so this is checked against
         `plans.limits` rather than against the hourly window — and the message
         has to say which, because "try again later" is false here: waiting
         changes nothing. */
      const seats = await checkQuota(db, orgId, "seats");
      if (!seats.allowed) {
        return fail(quotaMessage("seats", seats));
      }

      /* Already here is not a failure worth a red message — it is the most
         likely reason for pressing the button twice. */
      const { data: existingProfile } = await db
        .from("profiles")
        .select("id")
        .eq("email", email)
        .maybeSingle();

      if (existingProfile) {
        const { count } = await db
          .from("memberships")
          .select("id", { count: "exact", head: true })
          .eq("org_id", orgId)
          .eq("user_id", existingProfile.id)
          .is("deleted_at", null);
        if ((count ?? 0) > 0) {
          return fail(`${email} is already a member of this organisation.`);
        }
      }

      /* Re-inviting replaces rather than collides. `invitations_pending_idx`
         treats "not accepted and not revoked" as pending regardless of expiry
         — a partial index predicate cannot call now() — so an invitation that
         lapsed would otherwise block the address forever. Revoking first is
         also the right behaviour for a live one: the old link stops working,
         which is what an admin re-sending an invite expects. */
      await db
        .from("invitations")
        .update({ revoked_at: new Date().toISOString() })
        .eq("org_id", orgId)
        .eq("email", email)
        .is("accepted_at", null)
        .is("revoked_at", null);

      const { data: viewer } = await db.auth.getUser();

      const { data, error } = await db
        .from("invitations")
        .insert({
          org_id: orgId,
          email,
          role,
          invited_by: viewer.user?.id ?? null,
        })
        .select("id, token")
        .single();

      if (error) return fail(`That invitation could not be created: ${error.message}`);

      await recordAudit(db, orgId, {
        action: "member.invited",
        targetType: "invitation",
        targetId: String(data.id),
        /* The address, not the token. An audit record is readable by every
           admin in the org and the token is a credential — one that joins the
           holder to this organisation if their address matches. */
        meta: { email, role },
      });

      revalidatePath(`/${org}/team`);
      return ok(
        { url: new URL(`/invite/${data.token}`, siteUrl()).toString(), email },
        `Invitation created for ${email}. Send them the link below — nothing is emailed automatically.`,
      );
    },
    { minRole: "admin" },
  );
}

export async function revokeInvitationAction(
  org: string,
  invitationId: string,
): Promise<ActionResult<undefined>> {
  return mutate(
    org,
    "revokeInvitation",
    async ({ db, orgId }) => {
      const id = uuidSchema.safeParse(invitationId);
      if (!id.success) return fail("That invitation reference isn't valid.");

      const { error } = await db
        .from("invitations")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", id.data)
        .eq("org_id", orgId)
        .is("accepted_at", null);

      if (error) return fail(`That invitation could not be revoked: ${error.message}`);

      await recordAudit(db, orgId, {
        action: "member.invite_revoked",
        targetType: "invitation",
        targetId: id.data,
      });

      revalidatePath(`/${org}/team`);
      return ok(undefined, "Invitation revoked. That link no longer works.");
    },
    { minRole: "admin" },
  );
}
