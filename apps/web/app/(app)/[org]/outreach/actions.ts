"use server";

import { revalidatePath } from "next/cache";
import { fail, mutate, ok, type ActionResult } from "../../../../lib/data/org";
import {
  campaignSchema,
  parseForm,
  sequenceStepSchema,
  uuidSchema,
} from "../../../../lib/validation";

/**
 * Outreach writes — master context §46, and `0004`.
 *
 * ── The autonomy level is the only field here that can hurt somebody ─────
 *
 * Everything else on a campaign is a label. `autonomy_level` decides whether
 * messages leave without a human reading them, so it is bounded twice — by
 * `campaignSchema` here and by the check constraint in `0004` — and the form
 * states what each level means rather than rendering a 0–5 slider whose
 * meaning lives in a spec nobody editing a campaign has open.
 *
 * A campaign is created at 0 and at `draft`. Not because the schema defaults
 * that way (it does), but because a create action that accepted an autonomy
 * level from its first request would let a campaign be created already
 * sending — and "we never enabled that" is not a thing anyone should have to
 * work out afterwards from `ai_runs`.
 */

export interface CampaignInput {
  id?: string;
  name: string;
  icpId: string;
  productId: string;
  autonomyLevel: number;
  status: "draft" | "active" | "paused" | "archived";
}

export async function saveCampaignAction(
  org: string,
  input: CampaignInput,
): Promise<ActionResult<{ id: string }>> {
  const parsed = parseForm(campaignSchema, input);
  if (!parsed.ok) return fail(parsed.error, parsed.fieldErrors);
  const value = parsed.value;

  return mutate(org, "saveCampaign", async ({ db, orgId }) => {
    const row = {
      org_id: orgId,
      name: value.name,
      icp_id: value.icpId || null,
      product_id: value.productId || null,
    };

    if (value.id) {
      /* Read first, so `started_at` can be stamped exactly once.
         It records the first time a campaign went active. Re-stamping it on
         every unpause would make "running since" mean "most recently
         resumed" — the wrong number for the one question it answers, which is
         how long this thing has been emailing people. */
      const { data: existing, error: readError } = await db
        .from("campaigns")
        .select("started_at")
        .eq("id", value.id)
        .eq("org_id", orgId)
        .is("deleted_at", null)
        .maybeSingle();

      if (readError) return fail(`That campaign could not be saved: ${readError.message}`);
      if (!existing) return fail("That campaign no longer exists.");

      const firstStart = value.status === "active" && !existing.started_at;

      const { error } = await db
        .from("campaigns")
        .update({
          ...row,
          autonomy_level: value.autonomyLevel,
          status: value.status,
          ...(firstStart ? { started_at: new Date().toISOString() } : {}),
        })
        .eq("id", value.id)
        .eq("org_id", orgId)
        .is("deleted_at", null);

      if (error) return fail(`That campaign could not be saved: ${error.message}`);

      revalidatePath(`/${org}/outreach`);
      return ok({ id: value.id }, "Campaign saved.");
    }

    const { data, error } = await db
      .from("campaigns")
      .insert({ ...row, autonomy_level: 0, status: "draft" })
      .select("id")
      .single();

    if (error) return fail(`That campaign could not be created: ${error.message}`);

    revalidatePath(`/${org}/outreach`);
    return ok(
      { id: String(data.id) },
      "Campaign created as a draft at autonomy 0 — nothing sends until you say so.",
    );
  });
}

export async function deleteCampaignAction(
  org: string,
  id: string,
): Promise<ActionResult<undefined>> {
  return mutate(org, "deleteCampaign", async ({ db, orgId }) => {
    const parsed = uuidSchema.safeParse(id);
    if (!parsed.success) return fail("That campaign reference isn't valid.");

    /* Soft delete, and paused in the same statement. `enrollments` and
       `messages` reference this campaign, and a campaign that is only marked
       deleted while still `active` is a campaign a scheduler would go on
       sending from — the row being invisible to the UI is not the same as it
       being stopped. */
    const { error } = await db
      .from("campaigns")
      .update({ deleted_at: new Date().toISOString(), status: "archived" })
      .eq("id", parsed.data)
      .eq("org_id", orgId);

    if (error) return fail(`That campaign could not be removed: ${error.message}`);

    revalidatePath(`/${org}/outreach`);
    return ok(undefined, "Campaign archived and removed from the list.");
  });
}

/**
 * A sequence, created empty so its steps have something to attach to.
 *
 * `version` is left at its default. Versioning a sequence properly means
 * copying it and leaving the old one addressable by the enrollments already
 * part-way through it, and that is a scheduler concern rather than an editor
 * one — nothing runs sequences yet.
 */
export async function createSequenceAction(
  org: string,
  campaignId: string,
  name: string,
): Promise<ActionResult<{ id: string }>> {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 160) {
    return fail("Give the sequence a name of 160 characters or fewer.");
  }

  return mutate(org, "createSequence", async ({ db, orgId }) => {
    const parsed = uuidSchema.safeParse(campaignId);
    if (!parsed.success) return fail("That campaign reference isn't valid.");

    const { data, error } = await db
      .from("sequences")
      .insert({ org_id: orgId, campaign_id: parsed.data, name: trimmed })
      .select("id")
      .single();

    if (error) return fail(`That sequence could not be created: ${error.message}`);

    revalidatePath(`/${org}/outreach`);
    return ok({ id: String(data.id) }, "Sequence added.");
  });
}

export interface StepInput {
  id?: string;
  sequenceId: string;
  position: number;
  kind: "email" | "wait" | "condition";
  delayHours: number;
  subject?: string;
  body?: string;
}

export async function saveStepAction(
  org: string,
  input: StepInput,
): Promise<ActionResult<{ id: string }>> {
  const parsed = parseForm(sequenceStepSchema, input);
  if (!parsed.ok) return fail(parsed.error, parsed.fieldErrors);
  const value = parsed.value;

  return mutate(org, "saveStep", async ({ db, orgId }) => {
    const row = {
      org_id: orgId,
      sequence_id: value.sequenceId,
      position: value.position,
      kind: value.kind,
      delay_hours: value.delayHours,
      /* Written under the keys `lib/data/outreach.ts` reads. Same contract
         arrangement as `icps.criteria`, and the same failure mode if the two
         ever disagree: nothing errors, the body is just never there. */
      template:
        value.kind === "email"
          ? { subject: value.subject ?? "", body: value.body ?? "" }
          : {},
    };

    if (value.id) {
      const { error } = await db
        .from("sequence_steps")
        .update(row)
        .eq("id", value.id)
        .eq("org_id", orgId)
        .is("deleted_at", null);
      if (error) return fail(stepError(error, "saved"));

      revalidatePath(`/${org}/outreach`);
      return ok({ id: value.id }, "Step saved.");
    }

    const { data, error } = await db
      .from("sequence_steps")
      .insert(row)
      .select("id")
      .single();
    if (error) return fail(stepError(error, "added"));

    revalidatePath(`/${org}/outreach`);
    return ok({ id: String(data.id) }, "Step added.");
  });
}

/**
 * `unique (org_id, sequence_id, position)` said plainly.
 *
 * Two steps at the same position is a real thing to do by accident, and the
 * constraint name tells the user nothing they can act on.
 */
function stepError(error: { code?: string; message: string }, verb: string): string {
  if (error.code === "23505") {
    return "There is already a step at that position in this sequence. Give it a different one.";
  }
  return `That step could not be ${verb}: ${error.message}`;
}

export async function deleteStepAction(
  org: string,
  id: string,
): Promise<ActionResult<undefined>> {
  return mutate(org, "deleteStep", async ({ db, orgId }) => {
    const parsed = uuidSchema.safeParse(id);
    if (!parsed.success) return fail("That step reference isn't valid.");

    const { error } = await db
      .from("sequence_steps")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", parsed.data)
      .eq("org_id", orgId);

    if (error) return fail(`That step could not be removed: ${error.message}`);

    revalidatePath(`/${org}/outreach`);
    return ok(undefined, "Step removed.");
  });
}
