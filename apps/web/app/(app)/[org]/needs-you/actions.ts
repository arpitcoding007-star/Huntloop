"use server";

import { revalidatePath } from "next/cache";
import { currentViewer } from "../../../../lib/data/membership";
import { currentUserId, fail, ok, resolveDataSource, type ActionResult } from "../../../../lib/data/org";
import { attentionKeySchema, snoozeSchema } from "../../../../lib/validation";

/**
 * "Needs you" writes — `attention_snoozes` from 0037.
 *
 * ── Why this does not go through `mutate()` ──────────────────────────────
 *
 * `mutate` refuses the viewer role, which is right for every write that
 * changes the workspace. A snooze changes nothing anybody else sees: it is a
 * person saying "not now" about their own queue. A read-only seat should still
 * be able to tidy what it reads, so this checks membership itself and lets the
 * row-level policy (`snoozes_own`) be the authority on whose row it is.
 */

/** A snooze can be at most this far out. Longer is a dismissal wearing a date. */
const MAX_SNOOZE_MS = 30 * 24 * 3600_000;

export async function snoozeAttentionAction(
  org: string,
  key: string,
  until: string,
): Promise<ActionResult<undefined>> {
  const parsed = snoozeSchema.safeParse({ key, until });
  if (!parsed.success) return fail("That snooze could not be read.");

  const untilMs = Date.parse(parsed.data.until);
  if (untilMs <= Date.now()) return fail("Pick a time in the future.");
  if (untilMs > Date.now() + MAX_SNOOZE_MS) return fail("Snoozes last at most 30 days.");

  const { db, source } = await resolveDataSource();
  if (!db) {
    return fail(
      source === "unconfigured"
        ? "This deployment has no database connected, so there is nowhere to keep a snooze."
        : "The database migrations have not been applied yet.",
    );
  }
  const viewer = await currentViewer(org);
  if (!viewer || viewer.kind !== "member") return fail("You are not a member of this organisation.");
  const userId = await currentUserId(db);
  if (!userId) return fail("Your session expired. Sign in again.");

  const { error } = await db.from("attention_snoozes").upsert(
    {
      org_id: viewer.orgId,
      user_id: userId,
      item_key: parsed.data.key,
      snoozed_until: new Date(untilMs).toISOString(),
    },
    { onConflict: "org_id,user_id,item_key" },
  );
  if (error) return fail(`That could not be snoozed: ${error.message}`);

  revalidatePath(`/${org}/dashboard`);
  revalidatePath(`/${org}/needs-you`);
  return ok(undefined, "Snoozed. It comes back on its own.");
}

/** Bring every snoozed item back, now. */
export async function clearSnoozesAction(org: string): Promise<ActionResult<undefined>> {
  const { db } = await resolveDataSource();
  if (!db) return fail("This deployment has no database connected.");
  const viewer = await currentViewer(org);
  if (!viewer || viewer.kind !== "member") return fail("You are not a member of this organisation.");
  const userId = await currentUserId(db);
  if (!userId) return fail("Your session expired. Sign in again.");

  const { error } = await db
    .from("attention_snoozes")
    .delete()
    .eq("org_id", viewer.orgId)
    .eq("user_id", userId);
  if (error) return fail(`Snoozes could not be cleared: ${error.message}`);

  revalidatePath(`/${org}/dashboard`);
  revalidatePath(`/${org}/needs-you`);
  return ok(undefined, "Everything you snoozed is back.");
}

/** Bring one item back. */
export async function unsnoozeAttentionAction(org: string, key: string): Promise<ActionResult<undefined>> {
  const parsed = attentionKeySchema.safeParse(key);
  if (!parsed.success) return fail("That item reference isn't valid.");
  const { db } = await resolveDataSource();
  if (!db) return fail("This deployment has no database connected.");
  const viewer = await currentViewer(org);
  if (!viewer || viewer.kind !== "member") return fail("You are not a member of this organisation.");
  const userId = await currentUserId(db);
  if (!userId) return fail("Your session expired. Sign in again.");

  await db
    .from("attention_snoozes")
    .delete()
    .eq("org_id", viewer.orgId)
    .eq("user_id", userId)
    .eq("item_key", parsed.data);

  revalidatePath(`/${org}/dashboard`);
  revalidatePath(`/${org}/needs-you`);
  return ok(undefined);
}
