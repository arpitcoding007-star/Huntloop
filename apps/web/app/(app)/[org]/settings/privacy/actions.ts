"use server";

import { revalidatePath } from "next/cache";
import { fail, mutate, ok, type ActionResult } from "../../../../../lib/data/org";
import { contactEmailSchema, parseForm } from "../../../../../lib/validation";

/**
 * The data-rights actions — the request boundary `0017` built for and never got.
 *
 * ── Why these are Server Actions and not jobs ────────────────────────────
 *
 * `purge-contact-data.ts` argues that erasure should be a job, because
 * "a closed tab halfway through leaves a contact whose points are gone and
 * whose messages still carry their name". That reasoning is about a
 * *multi-statement* erasure. `erase_contact` is one `plpgsql` function and
 * therefore one transaction: it either commits whole or rolls back whole, and
 * a closed tab cannot land it in between. The job wrapper exists for erasures
 * the system initiates — a retention sweep, a request arriving off-channel —
 * where there is no session to authorise against.
 *
 * Here there is one, which is the entire point. `0017`'s own comment says
 * `erase_contact_for_org` is the admin-gated wrapper "specifically so a
 * Server Action could call it", and this is the file that finally does.
 *
 * ── Why the app is allowed to call these at all ──────────────────────────
 *
 * Every function here is `security definer` and checks `has_org_role` on its
 * own first argument before doing anything. That is what makes them safe to
 * grant to `authenticated` — unlike the `0017` primitives they wrap, which
 * trust their `p_org` parameter and stay service-role-only. See `0029`.
 */

/**
 * Erase everything held about one person.
 *
 * Irreversible, and the UI says so and requires the address to be typed —
 * this is the one action in the product where the existing undo pattern is
 * wrong, because the thing being undone is the deletion somebody has a legal
 * right to have happen.
 */
export async function eraseContactAction(
  org: string,
  email: string,
): Promise<ActionResult<{ contactPoints: number; messagesRedacted: number; people: number }>> {
  const parsed = parseForm(contactEmailSchema, { email });
  if (!parsed.ok) return fail(parsed.error, parsed.fieldErrors);

  return mutate(
    org,
    "eraseContact",
    async ({ db, orgId }) => {
      const { data, error } = await db.rpc("erase_contact_for_org", {
        p_org: orgId,
        p_email: parsed.value.email,
      });

      if (error) return fail(`That erasure did not run: ${error.message}`);

      const removed = (data ?? {}) as Record<string, unknown>;
      const counts = {
        contactPoints: Number(removed.contact_points ?? 0),
        messagesRedacted: Number(removed.messages_redacted ?? 0),
        people: Number(removed.people ?? 0),
      };

      revalidatePath(`/${org}/settings/privacy`);

      /* Zero is reported rather than treated as a failure. "We held nothing
         about this person" is a valid and common answer to an erasure
         request, and it is the answer the requester is owed — see the same
         reasoning in `purge-contact-data.ts`. */
      return ok(
        counts,
        counts.contactPoints + counts.people === 0
          ? "Nothing was held about that address. The suppression record stays, so they will not be contacted."
          : `Erased. ${counts.contactPoints} contact point(s) removed, ${counts.messagesRedacted} message(s) redacted. They stay suppressed.`,
      );
    },
    { minRole: "admin" },
  );
}

/** Everything held about one person, as JSON. The access half of the same right. */
export async function exportContactAction(
  org: string,
  email: string,
): Promise<ActionResult<{ json: string; filename: string }>> {
  const parsed = parseForm(contactEmailSchema, { email });
  if (!parsed.ok) return fail(parsed.error, parsed.fieldErrors);

  return mutate(
    org,
    "exportContact",
    async ({ db, orgId }) => {
      const { data, error } = await db.rpc("export_contact_for_org", {
        p_org: orgId,
        p_email: parsed.value.email,
      });

      if (error) return fail(`That export did not run: ${error.message}`);

      return ok(
        {
          json: JSON.stringify(data ?? {}, null, 2),
          filename: `huntloop-export-${slugForFile(parsed.value.email)}.json`,
        },
        "Export ready.",
      );
    },
    { minRole: "admin" },
  );
}

/**
 * The workspace's own data, for the customer rather than for their prospects.
 *
 * Returned as a string the browser saves rather than streamed from a route
 * handler: it is a one-off action taken by an admin looking at a screen, not
 * a URL anybody should be able to hold onto and re-fetch later.
 */
export async function exportOrganizationAction(
  org: string,
): Promise<ActionResult<{ json: string; filename: string }>> {
  return mutate(
    org,
    "exportOrganization",
    async ({ db, orgId }) => {
      const { data, error } = await db.rpc("export_organization", { p_org: orgId });
      if (error) return fail(`That export did not run: ${error.message}`);

      return ok(
        {
          json: JSON.stringify(data ?? {}, null, 2),
          filename: `huntloop-workspace-${slugForFile(org)}.json`,
        },
        "Export ready.",
      );
    },
    { minRole: "admin" },
  );
}

/**
 * Delete the workspace.
 *
 * `minRole: "owner"` here as well as inside `delete_organization`. The
 * database check is the one that matters — it is the one an attacker would
 * have to get past — and this one exists so an admin sees the sentence
 * `mutate` writes for a role failure rather than a raw Postgres exception.
 */
export async function deleteOrganizationAction(
  org: string,
  confirmation: string,
): Promise<ActionResult<undefined>> {
  /* Typed confirmation, checked before the role. Matching the slug is the
     one thing that cannot be done by mis-clicking, which is the whole
     purpose — this is the only action in the product that ends a workspace
     for everyone in it. */
  if (confirmation.trim() !== org) {
    return fail(`Type ${org} exactly to confirm.`, {
      confirmation: "That does not match the workspace address.",
    });
  }

  return mutate(
    org,
    "deleteOrganization",
    async ({ db, orgId }) => {
      const { error } = await db.rpc("delete_organization", { p_org: orgId });
      if (error) return fail(`That workspace could not be deleted: ${error.message}`);

      revalidatePath("/orgs");
      return ok(
        undefined,
        "Workspace deleted. Outreach is stopped and every screen is now closed to it.",
      );
    },
    { minRole: "owner" },
  );
}

/**
 * Delete the signed-in user's own account.
 *
 * Not wrapped in `mutate`: that helper resolves an org and checks a role, and
 * this action is not about an org — it is the user leaving entirely. The
 * function takes no arguments and can only ever reach `auth.uid()`, so there
 * is nothing here to authorise beyond having a session.
 */
export async function deleteOwnAccountAction(
  confirmation: string,
): Promise<ActionResult<undefined>> {
  if (confirmation.trim().toLowerCase() !== "delete my account") {
    return fail("Type “delete my account” exactly to confirm.", {
      confirmation: "That does not match.",
    });
  }

  const { resolveDataSource } = await import("../../../../../lib/data/source");
  const { db } = await resolveDataSource();
  if (!db) {
    return fail(
      "There is no database connected on this deployment, so there is no account to delete.",
    );
  }

  const { error } = await db.rpc("delete_own_account");
  if (error) {
    /* The sole-owner refusal is the expected failure, not an error, and the
       function raises it with the workspace names in the message so the user
       is told which ones are blocking rather than being sent to go and look. */
    const message = error.message.replace(/^.*delete_own_account:\s*/i, "");
    return fail(
      /sole owner/i.test(message)
        ? `You are the ${message}`
        : `That account could not be deleted: ${message}`,
    );
  }

  return ok(undefined, "Account deleted.");
}

/** A filename-safe fragment. Not security — the browser saves this locally. */
function slugForFile(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}
