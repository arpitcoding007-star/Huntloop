"use server";

import { revalidatePath } from "next/cache";
import { fail, mutate, ok, type ActionResult } from "../../../../lib/data/org";
import { orgSettingsSchema, parseForm } from "../../../../lib/validation";

/**
 * Organisation writes — the tenant root of §38.
 *
 * `minRole: "admin"` because `0001` guards `organizations` with
 * `has_org_role(id, 'admin')` while every other table this app writes is
 * guarded at `'member'`. Without it a member gets a Postgres policy error
 * rendered as a form message, which is accurate and unreadable.
 *
 * ── Why the slug is not editable ─────────────────────────────────────────
 *
 * The slug is the first path segment of every URL in the app, and it is what
 * `resolveMembership` looks the caller up by. Renaming it would break every
 * bookmark, every link shared into Slack, and — for the duration of the
 * request that changed it — the caller's own membership lookup. That is a
 * redirect-and-alias feature, not a text field, so the form says the slug is
 * fixed rather than offering an input that quietly does the wrong thing.
 */

export async function saveOrgSettingsAction(
  org: string,
  input: { name: string },
): Promise<ActionResult<{ name: string }>> {
  const parsed = parseForm(orgSettingsSchema, input);
  if (!parsed.ok) return fail(parsed.error, parsed.fieldErrors);
  const value = parsed.value;

  return mutate(
    org,
    "saveOrgSettings",
    async ({ db, orgId }) => {
      const { error } = await db
        .from("organizations")
        .update({ name: value.name })
        .eq("id", orgId)
        .is("deleted_at", null);

      if (error) return fail(`That name could not be saved: ${error.message}`);

      /* "layout" rather than the settings page alone: the org name is in the
         topbar breadcrumb on every screen, so a page-scoped revalidate would
         leave the old name above the form that just changed it. */
      revalidatePath(`/${org}`, "layout");
      return ok({ name: value.name }, "Organisation name saved.");
    },
    { minRole: "admin" },
  );
}
