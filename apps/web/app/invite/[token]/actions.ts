"use server";

import { redirect } from "next/navigation";
import { getDb } from "../../../lib/data/source";
import { fail, ok, type ActionResult } from "../../../lib/data/org";
import { uuidSchema } from "../../../lib/validation";

/**
 * Redeeming an invitation.
 *
 * This is the one write in the app that a *non-member* performs, so it does
 * not go through `mutate()` — that helper resolves a membership first and
 * would refuse every legitimate caller here. The authorization lives in
 * `accept_invitation()` in `0007` instead, which is SECURITY DEFINER precisely
 * because no RLS policy can be written for "somebody who is not yet in the
 * org".
 *
 * ── Why it is a form and not a link ──────────────────────────────────────
 *
 * A GET that joins you to an organisation is a GET that a mail client's link
 * scanner can fire on your behalf. The token alone is not enough — redemption
 * needs the invitee's own session, and a scanner has none — so the risk is
 * small, but "small" is doing a lot of work in a sentence about somebody
 * silently joining a company's account. A button costs one click.
 */
export async function acceptInvitationAction(
  token: string,
): Promise<ActionResult<undefined>> {
  const parsed = uuidSchema.safeParse(token);
  if (!parsed.success) return fail("That invitation link isn't valid.");

  const db = await getDb();
  if (!db) {
    return fail(
      "This deployment has no database connected, so there are no organisations to join.",
    );
  }

  const { data: user } = await db.auth.getUser();
  if (!user.user) {
    return fail("Sign in first, then open the invitation link again.");
  }

  const { data, error } = await db.rpc("accept_invitation", { p_token: parsed.data });

  if (error) {
    /* The function raises with a sentence — "that invitation is no longer
       valid", "that invitation was issued to a different email address" — and
       those sentences are the whole explanation. Replacing them with a
       generic failure would leave the user unable to tell an expired link
       from the wrong account, which are opposite problems with opposite
       fixes. */
    return fail(error.message.replace(/^.*?:\s*/, ""));
  }

  const row = Array.isArray(data) ? data[0] : data;
  const slug = row?.joined_org_slug;
  if (!slug) {
    return fail("That invitation was accepted, but the organisation could not be resolved.");
  }

  /* `redirect` throws, so nothing after it runs and the `ok` below is only
     reachable if Next changes that. Kept for the type. */
  redirect(`/${slug}/dashboard`);
  return ok(undefined);
}
