"use server";

import { getDb } from "../../../lib/data/org";
import { uuidSchema } from "../../../lib/validation";

/**
 * The confirmation button on the unsubscribe page.
 *
 * Deliberately not `mutate()`. Every other write in this app goes through it
 * because every other write belongs to a member of an organisation, and
 * `mutate` resolves membership before doing anything. The person here is a
 * prospect: they have no account, no org, and no reason to get one in order to
 * stop being emailed. `record_unsubscribe` in `0008` is `SECURITY DEFINER` for
 * exactly this case and accepts nothing but the token.
 *
 * The result shape is deliberately narrow. This runs unauthenticated, so a
 * message that distinguished "no such token" from "database error" would let
 * anyone probing tokens learn which ones exist.
 */
export type UnsubscribeResult =
  | { ok: true }
  | { ok: false; error: string };

export async function unsubscribeAction(token: string): Promise<UnsubscribeResult> {
  const parsed = uuidSchema.safeParse(token);
  if (!parsed.success) return { ok: false, error: "That unsubscribe link is not valid." };

  const db = await getDb();
  if (!db) {
    /* Said plainly rather than reported as success. Telling somebody they will
       not be emailed again, and then emailing them, is the §7 failure aimed at
       the person with the least reason to forgive it. */
    return {
      ok: false,
      error:
        "This deployment has no database connected, so nothing could be recorded. " +
        "Reply to the message and ask to be removed.",
    };
  }

  const { error } = await db.rpc("record_unsubscribe", {
    p_token: parsed.data,
    p_reason: "Unsubscribed from the link in an email",
  });

  if (error) return { ok: false, error: "That unsubscribe link is not valid." };

  return { ok: true };
}
