"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fail, mutate, ok, type ActionResult } from "../../../../../lib/data/org";
import { siteUrl } from "../../../../../lib/site-url";
import { cleanAvatarDataUrl } from "../../../../../lib/avatar";
import { parseForm, youStepSchema } from "../../../../../lib/validation";

/**
 * Your own name, kind of work and email address. The row is the caller's, so
 * every member may change their own, viewers included (`profile_self_write`).
 */
const OWN = { minRole: "viewer" as const };

export async function saveProfileAction(org: string, input: unknown): Promise<ActionResult<undefined>> {
  const parsed = parseForm(youStepSchema, input);
  if (!parsed.ok) return fail(parsed.error, parsed.fieldErrors);
  return mutate(
    org,
    "saveProfile",
    async ({ db }) => {
      const { data: auth } = await db.auth.getUser();
      if (!auth.user) return fail("Your session expired. Sign in again.");
      const { data, error } = await db
        .from("profiles")
        .update({ full_name: parsed.value.fullName, role: parsed.value.role })
        .eq("id", auth.user.id)
        .select("id")
        .maybeSingle();
      if (error) return fail(`Your profile could not be saved: ${error.message}`);
      if (!data) return fail("Your profile could not be found.");
      revalidatePath(`/${org}`, "layout");
      return ok(undefined, "Profile saved.");
    },
    OWN,
  );
}

/**
 * Your picture (V-18). The page resizes and re-encodes it to a 256px JPEG;
 * this checks it, strips any metadata the page did not, and stores it. `null`
 * removes it. See `lib/avatar.ts` for why it is a data URL, and migration
 * 0072 for the same bounds in the database.
 */
export async function savePictureAction(org: string, input: unknown): Promise<ActionResult<undefined>> {
  let picture: string | null = null;
  if (input !== null) {
    const cleaned = cleanAvatarDataUrl(input);
    if (!cleaned.ok) return fail(cleaned.error);
    picture = cleaned.dataUrl;
  }
  return mutate(
    org,
    "savePicture",
    async ({ db }) => {
      const { data: auth } = await db.auth.getUser();
      if (!auth.user) return fail("Your session expired. Sign in again.");
      const { data, error } = await db
        .from("profiles")
        .update({ avatar_url: picture })
        .eq("id", auth.user.id)
        .select("id")
        .maybeSingle();
      if (error) return fail(`Your picture could not be saved: ${error.message}`);
      if (!data) return fail("Your profile could not be found.");
      revalidatePath(`/${org}`, "layout");
      return ok(undefined, picture ? "Picture saved." : "Picture removed.");
    },
    OWN,
  );
}

const emailSchema = z.object({ email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(254) });

/** Auth sends the confirmation; nothing changes until it is followed. */
export async function changeEmailAction(org: string, input: unknown): Promise<ActionResult<undefined>> {
  const parsed = parseForm(emailSchema, input);
  if (!parsed.ok) return fail(parsed.error, parsed.fieldErrors);
  return mutate(
    org,
    "changeEmail",
    async ({ db }) => {
      const { data: auth } = await db.auth.getUser();
      if (!auth.user) return fail("Your session expired. Sign in again.");
      if (auth.user.email?.toLowerCase() === parsed.value.email) return fail("That is already your address.");
      const { error } = await db.auth.updateUser(
        { email: parsed.value.email },
        { emailRedirectTo: new URL("/auth/callback", siteUrl()).toString() },
      );
      if (error) return fail(`The change could not be started: ${error.message}`);
      return ok(undefined, `Check your email. Your address changes to ${parsed.value.email} once you confirm it.`);
    },
    OWN,
  );
}
