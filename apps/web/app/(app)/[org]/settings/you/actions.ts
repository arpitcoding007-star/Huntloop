"use server";

import { revalidatePath } from "next/cache";
import { currentUserId, fail, mutate, ok, type ActionResult } from "../../../../../lib/data/org";
import { parseForm, personalPreferenceSchema, uuidSchema } from "../../../../../lib/validation";
import { HIGH_RISK_CATEGORIES, type PreferenceCategoryValue } from "../../../../../lib/learning/vocabulary";
import { recordSignal } from "../../../../../lib/data/signals";

/**
 * Settings → You — a person's control over what Huntloop knows about how they
 * work (K2, `0044`).
 *
 * Every write here is about the caller and nobody else, so every one admits a
 * read-only member (`minRole: "viewer"`): a viewer has preferences too, and
 * changing their own touches nothing a colleague sees. The single exception is
 * **promote**, which writes workspace policy and needs an admin.
 *
 * RLS is the boundary (`memories_write_own`): a user-scoped row whose subject
 * is not the caller cannot be written however these actions are called. The
 * `scope_id = me` filters below are there so a stale id fails as "not found"
 * rather than as a policy error.
 */

const PERSONAL = { minRole: "viewer" as const };

function revalidate(org: string) {
  revalidatePath(`/${org}/settings/you`);
}

/** State a preference, or correct one — a corrected learned item becomes stated. */
export async function savePreferenceAction(
  org: string,
  input: { id?: string; content: string; category: string; appliesTo: string[] },
): Promise<ActionResult<{ id: string }>> {
  const parsed = parseForm(personalPreferenceSchema, input);
  if (!parsed.ok) return fail(parsed.error, parsed.fieldErrors);
  const value = parsed.value;

  return mutate(
    org,
    "savePreference",
    async ({ db, orgId }) => {
      const me = await currentUserId(db);
      if (!me) return fail("Your session expired. Sign in again.");

      const fields = {
        content: value.content,
        category: value.category,
        applies_to: value.appliesTo,
        risk: HIGH_RISK_CATEGORIES.includes(value.category as PreferenceCategoryValue) ? "high" : "low",
        /* You said it, so it is yours as stated: a correction is the strongest
           signal there is, and it is no longer something we concluded. */
        origin: "stated",
        source: "user",
        status: "active",
      };

      if (value.id) {
        const { data, error } = await db
          .from("memories")
          .update(fields)
          .eq("id", value.id)
          .eq("org_id", orgId)
          .eq("scope", "user")
          .eq("scope_id", me)
          .is("deleted_at", null)
          .select("id")
          .maybeSingle();
        if (error) return fail(`That could not be saved: ${error.message}`);
        if (!data) return fail("That preference no longer exists.");
        revalidate(org);
        return ok({ id: value.id }, "Saved. Huntloop uses your wording from now on.");
      }

      const { data, error } = await db
        .from("memories")
        .insert({ ...fields, org_id: orgId, scope: "user", scope_id: me, kind: "durable" })
        .select("id")
        .single();
      if (error) return fail(`That could not be saved: ${error.message}`);
      revalidate(org);
      return ok({ id: String(data.id) }, "Saved. Huntloop will work this way for you.");
    },
    PERSONAL,
  );
}

/**
 * Pause, resume, accept or decline.
 *
 * Resuming and accepting count as a reinforcement — the person just said yes —
 * so a learned item that had faded applies again. Declining keeps the row as
 * `rejected` (hidden), which is what stops the learner proposing it again.
 */
export async function setPreferenceStatusAction(
  org: string,
  id: string,
  status: "active" | "paused" | "rejected",
): Promise<ActionResult<undefined>> {
  if (!uuidSchema.safeParse(id).success) return fail("That reference isn't valid.");
  if (!["active", "paused", "rejected"].includes(status)) return fail("That isn't a status.");

  return mutate(
    org,
    "setPreferenceStatus",
    async ({ db, orgId }) => {
      const me = await currentUserId(db);
      const { data, error } = await db
        .from("memories")
        .update(
          status === "active"
            ? { status, last_reinforced_at: new Date().toISOString() }
            : { status },
        )
        .eq("id", id)
        .eq("org_id", orgId)
        .eq("scope", "user")
        .eq("scope_id", me)
        .is("deleted_at", null)
        .select("id")
        .maybeSingle();
      if (error) return fail(`That could not be changed: ${error.message}`);
      if (!data) return fail("That preference no longer exists.");
      revalidate(org);
      return ok(
        undefined,
        status === "active"
          ? "On. Huntloop applies it again."
          : status === "paused"
            ? "Paused. Huntloop stops applying it until you turn it back on."
            : "Declined. Huntloop won't propose it again.",
      );
    },
    PERSONAL,
  );
}

/**
 * Forget. Something you told us is removed; something we learned is kept as
 * declined, so the same behaviour does not quietly teach it back.
 */
export async function forgetPreferenceAction(org: string, id: string): Promise<ActionResult<undefined>> {
  if (!uuidSchema.safeParse(id).success) return fail("That reference isn't valid.");

  return mutate(
    org,
    "forgetPreference",
    async ({ db, orgId }) => {
      const me = await currentUserId(db);
      const { data: row } = await db
        .from("memories")
        .select("id, origin")
        .eq("id", id)
        .eq("org_id", orgId)
        .eq("scope", "user")
        .eq("scope_id", me)
        .is("deleted_at", null)
        .maybeSingle();
      if (!row) return fail("That preference no longer exists.");

      const learned = (row as { origin?: string }).origin === "learned";
      const { error } = await db
        .from("memories")
        .update(learned ? { status: "rejected" } : { deleted_at: new Date().toISOString() })
        .eq("id", id)
        .eq("scope_id", me);
      if (error) return fail(`That could not be forgotten: ${error.message}`);

      await db.from("memory_evidence").delete().eq("memory_id", id);
      revalidate(org);
      return ok(
        undefined,
        learned ? "Forgotten. Huntloop won't learn it again." : "Forgotten. Huntloop stops using it.",
      );
    },
    PERSONAL,
  );
}

/**
 * "Not here" on a "Written with" list: this output should not have used it.
 *
 * One contradiction, recorded with what it was about. The preference keeps
 * applying until contradictions catch up with the support it was learned
 * from (`confidenceOf`) — one bad fit is not a reversal — and if it was
 * something the person *stated*, it counts as a note to ask, not a vote.
 */
export async function dismissAppliedAction(
  org: string,
  memoryId: string,
  subject: { type: "message" | "conversation_message"; id: string },
): Promise<ActionResult<undefined>> {
  if (!uuidSchema.safeParse(memoryId).success || !uuidSchema.safeParse(subject.id).success) {
    return fail("That reference isn't valid.");
  }

  return mutate(
    org,
    "dismissApplied",
    async ({ db, orgId }) => {
      const me = await currentUserId(db);
      const { data: row } = await db
        .from("memories")
        .select("id, contradicts")
        .eq("id", memoryId)
        .eq("org_id", orgId)
        .eq("scope", "user")
        .eq("scope_id", me)
        .is("deleted_at", null)
        .maybeSingle();
      if (!row) return fail("Only your own preferences can be switched off from here.");

      await db
        .from("memories")
        .update({ contradicts: Number((row as { contradicts?: number }).contradicts ?? 0) + 1 })
        .eq("id", memoryId)
        .eq("scope_id", me);
      await recordSignal(db, orgId, {
        kind: "applied_dismissed",
        subjectType: subject.type,
        subjectId: subject.id,
        features: { memoryId },
      });
      revalidate(org);
      return ok(undefined, "Noted. If it keeps not fitting, Huntloop stops applying it.");
    },
    PERSONAL,
  );
}

/** Offer a preference to the workspace — an admin decides whether to adopt it. */
export async function sharePreferenceAction(
  org: string,
  id: string,
  share: boolean,
): Promise<ActionResult<undefined>> {
  if (!uuidSchema.safeParse(id).success) return fail("That reference isn't valid.");

  return mutate(
    org,
    "sharePreference",
    async ({ db, orgId }) => {
      const me = await currentUserId(db);
      const { data, error } = await db
        .from("memories")
        .update({ shared_at: share ? new Date().toISOString() : null })
        .eq("id", id)
        .eq("org_id", orgId)
        .eq("scope", "user")
        .eq("scope_id", me)
        .is("deleted_at", null)
        .select("id")
        .maybeSingle();
      if (error) return fail(`That could not be changed: ${error.message}`);
      if (!data) return fail("That preference no longer exists.");
      revalidate(org);
      return ok(
        undefined,
        share
          ? "Shared. Admins can now see it and adopt it for the whole workspace."
          : "No longer shared. Admins can't see it.",
      );
    },
    PERSONAL,
  );
}

/**
 * Adopt a personal preference as workspace policy. An organisation-scope copy
 * with `promoted_from` set — the owner's row is theirs and stays untouched.
 */
export async function promotePreferenceAction(org: string, id: string): Promise<ActionResult<undefined>> {
  if (!uuidSchema.safeParse(id).success) return fail("That reference isn't valid.");

  return mutate(
    org,
    "promotePreference",
    async ({ db, orgId }) => {
      const me = await currentUserId(db);
      /* Readable only when it is the admin's own or its owner shared it —
         `memories_read` decides, so there is nothing else to check here. */
      const { data: source } = await db
        .from("memories")
        .select("id, scope_id, key, content, category, applies_to, shared_at")
        .eq("id", id)
        .eq("org_id", orgId)
        .eq("scope", "user")
        .is("deleted_at", null)
        .maybeSingle();
      if (!source) return fail("That preference isn't shared with you, or no longer exists.");
      const row = source as { scope_id: string; shared_at: string | null; key: string | null; content: string; category: string | null; applies_to: string[] };
      if (row.scope_id !== me && !row.shared_at) return fail("Its owner hasn't shared it.");

      const { data: existing } = await db
        .from("memories")
        .select("id")
        .eq("org_id", orgId)
        .eq("scope", "organization")
        .eq("promoted_from", id)
        .is("deleted_at", null)
        .maybeSingle();
      if (existing) return ok(undefined, "It's already workspace policy.");

      const { error } = await db.from("memories").insert({
        org_id: orgId,
        scope: "organization",
        scope_id: null,
        kind: "durable",
        key: row.key,
        content: row.content,
        category: row.category,
        applies_to: row.applies_to ?? [],
        origin: "promoted",
        source: "user",
        status: "active",
        promoted_from: id,
        created_by: me,
      });
      if (error) return fail(`That could not be adopted: ${error.message}`);
      revalidate(org);
      revalidatePath(`/${org}/memory`);
      return ok(undefined, "Adopted. It now applies to everyone in this workspace.");
    },
    { minRole: "admin" },
  );
}

/** Stop (or restart) learning from what this person does. */
export async function setLearningPausedAction(org: string, paused: boolean): Promise<ActionResult<undefined>> {
  return mutate(
    org,
    "setLearningPaused",
    async ({ db }) => {
      const me = await currentUserId(db);
      if (!me) return fail("Your session expired. Sign in again.");
      const { error } = await db.from("profiles").update({ learning_paused: paused }).eq("id", me);
      if (error) return fail(`That could not be changed: ${error.message}`);
      revalidate(org);
      return ok(
        undefined,
        paused
          ? "Learning paused. Nothing you do is recorded until you turn it back on; what's already here still applies."
          : "Learning is on again.",
      );
    },
    PERSONAL,
  );
}

/** Remove everything learned, and the observations it was learned from. */
export async function resetLearnedAction(org: string): Promise<ActionResult<undefined>> {
  return mutate(
    org,
    "resetLearned",
    async ({ db, orgId }) => {
      const me = await currentUserId(db);
      if (!me) return fail("Your session expired. Sign in again.");
      const { error } = await db
        .from("memories")
        .update({ deleted_at: new Date().toISOString() })
        .eq("org_id", orgId)
        .eq("scope", "user")
        .eq("scope_id", me)
        .eq("origin", "learned")
        .is("deleted_at", null);
      if (error) return fail(`That could not be reset: ${error.message}`);
      const { error: signalError } = await db
        .from("preference_signals")
        .delete()
        .eq("org_id", orgId)
        .eq("user_id", me);
      if (signalError) return fail(`The observations could not be removed: ${signalError.message}`);
      revalidate(org);
      return ok(undefined, "Reset. Everything Huntloop learned about you here is gone; what you told it stays.");
    },
    PERSONAL,
  );
}

export async function exportMyLearningAction(
  org: string,
): Promise<ActionResult<{ json: string; filename: string }>> {
  return mutate(
    org,
    "exportMyLearning",
    async ({ db, orgId }) => {
      const { data, error } = await db.rpc("export_my_learning", { p_org: orgId });
      if (error) return fail(`That export did not run: ${error.message}`);
      return ok(
        {
          json: JSON.stringify(data ?? {}, null, 2),
          filename: `huntloop-what-it-knows-about-you-${org.replace(/[^a-z0-9-]/g, "")}.json`,
        },
        "Export ready.",
      );
    },
    PERSONAL,
  );
}
