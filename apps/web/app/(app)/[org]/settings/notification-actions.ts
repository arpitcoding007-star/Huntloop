"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { currentUserId, fail, mutate, ok, type ActionResult } from "../../../../lib/data/org";
import { supportedTimeZones } from "../../../../lib/data/notifications";
import { parseForm } from "../../../../lib/validation";

/**
 * Your own notification preferences for this workspace. Personal, so any
 * member — viewers included — may set theirs; RLS (0040) makes the row theirs
 * alone.
 */

const schema = z.object({
  dailyDigest: z.boolean(),
  digestHour: z.number().int().min(0).max(23),
  timezone: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .refine((tz) => supportedTimeZones().includes(tz), "Choose a time zone from the list."),
});

export async function saveNotificationPreferencesAction(
  org: string,
  input: unknown,
): Promise<ActionResult<undefined>> {
  const parsed = parseForm(schema, input);
  if (!parsed.ok) return fail(parsed.error, parsed.fieldErrors);

  return mutate(
    org,
    "saveNotificationPreferences",
    async ({ db, orgId }) => {
      const userId = await currentUserId(db);
      if (!userId) return fail("You are no longer signed in.");
      const { error } = await db.from("notification_preferences").upsert(
        {
          org_id: orgId,
          user_id: userId,
          daily_digest: parsed.value.dailyDigest,
          digest_hour: parsed.value.digestHour,
          timezone: parsed.value.timezone,
        },
        { onConflict: "org_id,user_id" },
      );
      if (error) return fail(`Your preferences could not be saved: ${error.message}`);
      revalidatePath(`/${org}/settings`);
      return ok(
        undefined,
        parsed.value.dailyDigest
          ? `Saved. The daily summary arrives after ${String(parsed.value.digestHour).padStart(2, "0")}:00 ${parsed.value.timezone}, on days something needs you.`
          : "Saved. You won't get the daily summary.",
      );
    },
    { minRole: "viewer" },
  );
}
