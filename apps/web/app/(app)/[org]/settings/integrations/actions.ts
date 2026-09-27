"use server";

import { revalidatePath } from "next/cache";
import { verifyHubspotToken } from "@huntloop/crm";
import { EncryptionUnavailable, encryptSecret } from "@huntloop/db";
import { fail, mutate, ok, type ActionResult } from "../../../../../lib/data/org";
import { currentUserId } from "../../../../../lib/data/org";
import { hubspotTokenSchema, parseForm } from "../../../../../lib/validation";

/**
 * HubSpot connect/disconnect.
 *
 * `minRole: "admin"` is not decorative — `0028`'s RLS policy on
 * `hubspot_connections` is admin-only in both directions, so a member-role
 * caller would fail at the database with a policy violation. Asking here
 * first turns that into the sentence `mutate` already writes for exactly
 * this case, rather than a raw Postgres error reaching the form.
 *
 * ── Why the token is verified before it is stored ─────────────────────────
 *
 * The same argument `PRV-01` makes for Apollo: a stored, unverified token
 * that turns out to be wrong fails silently on the first real sync, days
 * later, as "HubSpot returned 401" on a background job nobody is watching.
 * Verifying here, synchronously, in front of the person who just pasted it,
 * is the cheap moment to catch it.
 */

export async function connectHubspotAction(org: string, token: string): Promise<ActionResult<undefined>> {
  const parsed = parseForm(hubspotTokenSchema, { token });
  if (!parsed.ok) return fail(parsed.error, parsed.fieldErrors);
  const trimmed = parsed.value.token;

  const check = await verifyHubspotToken(trimmed);
  if (!check.ok) {
    return fail(
      `HubSpot rejected that token: ${check.detail}. Check it was copied in full and that the private app has CRM read/write scopes.`,
      { token: "Rejected by HubSpot." },
    );
  }

  /* Encrypted before it reaches the database, and before `mutate` opens a
     write — a deployment with no encryption key must fail here with a
     sentence naming the variable, not store a bare token and look like it
     worked. Same module, same key and the same reasoning as the mailbox
     tokens in `0004`: these are the customer's credentials, not ours. */
  let sealed: string;
  try {
    sealed = encryptSecret(trimmed);
  } catch (e) {
    if (e instanceof EncryptionUnavailable) {
      return fail(`HubSpot cannot be connected on this deployment yet: ${e.message}`);
    }
    throw e;
  }

  return mutate(
    org,
    "connectHubspot",
    async ({ db, orgId }) => {
      const userId = await currentUserId(db);
      const { error } = await db.from("hubspot_connections").upsert(
        {
          org_id: orgId,
          access_token: sealed,
          connected_by: userId,
          connected_at: new Date().toISOString(),
          is_enabled: true,
          last_sync_error: null,
        },
        { onConflict: "org_id" },
      );
      if (error) return fail(`The connection could not be saved: ${error.message}`);

      revalidatePath(`/${org}/settings/integrations`);
      return ok(undefined, "HubSpot connected.");
    },
    { minRole: "admin" },
  );
}

export async function disconnectHubspotAction(org: string): Promise<ActionResult<undefined>> {
  return mutate(
    org,
    "disconnectHubspot",
    async ({ db, orgId }) => {
      /* A real delete, not `is_enabled = false`. The row holds a live
         credential; "disconnect" should mean the token leaves this database,
         not that it stays and is merely ignored. */
      const { error } = await db.from("hubspot_connections").delete().eq("org_id", orgId);
      if (error) return fail(`HubSpot could not be disconnected: ${error.message}`);

      revalidatePath(`/${org}/settings/integrations`);
      return ok(undefined, "HubSpot disconnected.");
    },
    { minRole: "admin" },
  );
}
