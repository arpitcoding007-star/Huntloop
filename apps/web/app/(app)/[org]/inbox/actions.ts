"use server";

import { revalidatePath } from "next/cache";
import { fail, mutate, ok, type ActionResult } from "../../../../lib/data/org";
import { threadStatusSchema, uuidSchema } from "../../../../lib/validation";

/**
 * Inbox writes — `threads` from `0004`.
 *
 * ── Why triage is the only thing you can do here ─────────────────────────
 *
 * A thread's status and its assignee are the two things a person changes while
 * reading their inbox. Replying is not on that list, and its absence is
 * deliberate rather than unfinished: sending needs a connected mailbox, and
 * there is no OAuth flow and nowhere to encrypt a token. A reply box that
 * composed a message with nowhere to send it would be the §7 failure aimed at
 * the one screen where the user would most reasonably assume it worked.
 *
 * `messages_sent_has_provider_id` in `0004` says the same thing at the
 * database level: an outbound message cannot claim a send time without the
 * provider id that proves it left. The schema will not let us fake it either.
 */

export async function setThreadStatusAction(
  org: string,
  threadId: string,
  status: string,
): Promise<ActionResult<undefined>> {
  const id = uuidSchema.safeParse(threadId);
  if (!id.success) return fail("That conversation reference isn't valid.");

  const parsed = threadStatusSchema.safeParse(status);
  if (!parsed.success) return fail("That isn't a state a conversation can be in.");

  return mutate(org, "setThreadStatus", async ({ db, orgId }) => {
    const { error } = await db
      .from("threads")
      .update({ status: parsed.data })
      .eq("id", id.data)
      .eq("org_id", orgId)
      .is("deleted_at", null);

    if (error) return fail(`That conversation could not be updated: ${error.message}`);

    revalidatePath(`/${org}/inbox`);
    return ok(undefined, `Moved to ${parsed.data}.`);
  });
}

/**
 * Take a conversation, or hand it back.
 *
 * `threads.assignee_id` references `auth.users`, so the same membership check
 * as `assignOpportunityAction` applies — the foreign key would accept any real
 * user id in the system, including one from another tenant.
 */
export async function assignThreadAction(
  org: string,
  threadId: string,
  assigneeId: string | null,
): Promise<ActionResult<undefined>> {
  const id = uuidSchema.safeParse(threadId);
  if (!id.success) return fail("That conversation reference isn't valid.");

  if (assigneeId !== null && !uuidSchema.safeParse(assigneeId).success) {
    return fail("That member reference isn't valid.");
  }

  return mutate(org, "assignThread", async ({ db, orgId }) => {
    if (assigneeId !== null) {
      const { count } = await db
        .from("memberships")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId)
        .eq("user_id", assigneeId)
        .is("deleted_at", null);

      if ((count ?? 0) === 0) {
        return fail("That person is not a member of this organisation.");
      }
    }

    const { error } = await db
      .from("threads")
      .update({ assignee_id: assigneeId })
      .eq("id", id.data)
      .eq("org_id", orgId)
      .is("deleted_at", null);

    if (error) return fail(`That conversation could not be assigned: ${error.message}`);

    revalidatePath(`/${org}/inbox`);
    return ok(undefined, assigneeId ? "Assigned." : "Unassigned.");
  });
}
