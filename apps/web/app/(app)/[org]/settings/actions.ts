"use server";

import { revalidatePath } from "next/cache";
import { parseOrgProfile, serializeOrgProfile } from "@huntloop/db/org-profile";
import { fail, mutate, ok, type ActionResult } from "../../../../lib/data/org";
import { orgProfileSchema, orgSettingsSchema, parseForm } from "../../../../lib/validation";

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

/**
 * The organisation's voice, and the one engine setting a customer should own.
 *
 * ── Why these live in `settings` rather than in columns ──────────────────
 *
 * `organizations.settings` has been a jsonb column since `0001` that nothing
 * read a key out of, and `lib/data/organization.ts` says why: inventing a
 * contract for a column no screen consumes is how you get a shape the first
 * real requirement contradicts. Three requirements arrived at once — tone,
 * competitors, and the backlog cap `0010` added — and three new columns on the
 * tenant root for values read once per message and never queried would be the
 * worse trade. The shape is defined once in `@huntloop/db/org-profile` and
 * parsed by both this action and the SQL in `0010`.
 *
 * ── Why the whole profile is rewritten rather than merged ────────────────
 *
 * `serializeOrgProfile` omits empty values, so an admin clearing the competitor
 * list removes the key rather than storing `[]`. A merge would make "cleared"
 * unrepresentable — and for `backlogCap` specifically the distinction is
 * load-bearing: an absent key means the default of 250, an explicit 0 means
 * unlimited, and `->>` returns SQL NULL for both a missing key and a JSON null.
 *
 * The consequence is that anything else stored under `settings` by a future
 * feature would be dropped by this write. That is fine while this is the only
 * writer and would not be otherwise, so the profile parser is the single
 * definition of what the column holds — a second writer must extend it rather
 * than write alongside it.
 */
export async function saveOrgProfileAction(
  org: string,
  input: {
    tone: string | null;
    competitors: string[];
    targetRegions: string[];
    backlogCap: number | null;
  },
): Promise<ActionResult<undefined>> {
  const parsed = parseForm(orgProfileSchema, input);
  if (!parsed.ok) return fail(parsed.error, parsed.fieldErrors);
  const value = parsed.value;

  return mutate(
    org,
    "saveOrgProfile",
    async ({ db, orgId }) => {
      const { data: current, error: readError } = await db
        .from("organizations")
        .select("settings")
        .eq("id", orgId)
        .is("deleted_at", null)
        .maybeSingle();

      if (readError) return fail(`Those settings could not be read: ${readError.message}`);

      /* Parsed and re-serialized rather than spread, so a malformed key that
         somehow got into the column is normalised out on the next save instead
         of being carried forward forever. */
      const profile = parseOrgProfile(current?.settings);
      profile.voice.tone = value.tone;
      profile.voice.competitors = value.competitors;
      profile.voice.targetRegions = value.targetRegions;
      profile.engine.backlogCap = value.backlogCap;

      const { error } = await db
        .from("organizations")
        .update({ settings: serializeOrgProfile(profile) })
        .eq("id", orgId)
        .is("deleted_at", null);

      if (error) return fail(`Those settings could not be saved: ${error.message}`);

      revalidatePath(`/${org}/settings`);
      return ok(
        undefined,
        "Saved. Outreach written from now on uses this; messages already drafted are unchanged.",
      );
    },
    { minRole: "admin" },
  );
}
