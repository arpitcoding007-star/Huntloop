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

  /*
   * An invitee still needs step one, and only step one.
   *
   * The workspace they have just joined already has a product, an ICP and
   * sources — somebody else built it. Walking them through company research
   * would let them create a second, contradictory profile for a company that
   * already has one, which is `ICP-01` re-committed through the front door.
   *
   * What they do need is their own name and role, because those live on
   * `profiles` and lay out *their* dashboard. An SDR joining on Tuesday must
   * not inherit the founder's layout. `/welcome` asks exactly those two
   * questions and then forwards them into the workspace, because
   * `listMemberships` now returns one.
   *
   * Somebody who already has a role — a second invitation, or a returning
   * user — skips it entirely.
   */
  const { data: profile } = await db
    .from("profiles")
    .select("role")
    .eq("id", user.user.id)
    .maybeSingle();

  /* `redirect` throws, so nothing after it runs and the `ok` below is only
     reachable if Next changes that. Kept for the type. */
  redirect(profile?.role ? `/${slug}/dashboard` : "/welcome");
  return ok(undefined);
}
