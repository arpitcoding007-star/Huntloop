"use server";

import { revalidatePath } from "next/cache";
import { fail, mutate, ok, type ActionResult } from "../../../../lib/data/org";
import { uuidSchema } from "../../../../lib/validation";

/**
 * Enrolling opportunities into a campaign — the entry point to the engine.
 *
 * Everything downstream of this is already built: `advance_enrollments` sweeps
 * `enrollments.next_action_at`, drafts the step's message, and — at autonomy 2
 * and above — queues `send_message`. Nothing reaches any of it without a row
 * here, which makes this the one action in the product that starts email going
 * to a real person.
 *
 * ── Why enrolling does not send, at any autonomy level ───────────────────
 *
 * The enrollment is created with `next_action_at` set to now, so the next tick
 * picks it up — but what that tick does is bounded by the campaign's autonomy
 * level, which lives on the campaign and is not a parameter here. There is
 * deliberately no way to enrol *and* raise the autonomy in one call: those are
 * two decisions, and a screen that bundled them would let "add these forty to
 * the campaign" mean "start emailing forty people" without the second one ever
 * having been made.
 *
 * ── Duplicates are a no-op, not an error ─────────────────────────────────
 *
 * `enrollments` is unique on `(org_id, campaign_id, opportunity_id)` — §46's
 * "no double-enrollment", and the constraint that stops one person getting the
 * same sequence twice. A selection that overlaps an existing enrollment is a
 * normal thing to do (you enrolled ten yesterday, you select fifteen today),
 * so the overlap is reported rather than refused, and the untouched rows keep
 * whatever step they had already reached.
 *
 * ── Why the campaign is read first ───────────────────────────────────────
 *
 * To refuse two states that would otherwise fail silently: a campaign that no
 * longer exists, and one with no email step for an enrollment to advance into.
 * The second is the quiet one — the insert succeeds, the sweeper finds no step
 * to send at position 0, and the enrollment finishes without a message ever
 * being written. The user sees a count go up and nothing happen, which is
 * exactly the §7 failure of reporting work that did not occur.
 */

/** A ceiling on one call. See the note in the body. */
const MAX_PER_CALL = 200;

export async function enrollOpportunitiesAction(
  org: string,
  campaignId: string,
  opportunityIds: string[],
): Promise<ActionResult<{ enrolled: number; alreadyIn: number }>> {
  const ids = [...new Set(opportunityIds)];

  /* Checked out here because it is true of the request regardless of what this
     deployment is: an empty selection has nothing to enrol anywhere. */
  if (ids.length === 0) return fail("Nothing was selected, so nothing was enrolled.");

  /* Bounded because this is one statement against Postgres and one selection in
     a browser, and neither has a natural limit. Two hundred is well above any
     deliberate selection and well below a request that would time out. */
  if (ids.length > MAX_PER_CALL) {
    return fail(
      `That is ${ids.length} opportunities in one go. Add up to ${MAX_PER_CALL} at a time — ` +
        `the campaign will still be there for the rest.`,
    );
  }

  return mutate(org, "enrollOpportunities", async ({ db, orgId }) => {
    /* Inside `mutate`, not before it, and for the reason `mutate` itself gives
       for checking demo mode first: a shape check that runs earlier reports the
       wrong reason. In demo mode the ids on screen are fixtures — `demo-1`, not
       a uuid — and validating them out here would answer "that reference isn't
       valid" to a user whose actual problem is that this deployment has no
       database. The first is a bug report about their click; the second is the
       truth, and it is the one `mutate` already says. */
    const campaign = uuidSchema.safeParse(campaignId);
    if (!campaign.success) return fail("That campaign reference isn't valid.");
    if (ids.some((id) => !uuidSchema.safeParse(id).success)) {
      return fail("That selection contains a reference that isn't valid.");
    }

    const { data: target, error: readError } = await db
      .from("campaigns")
      .select("id, name, status, sequences(id, deleted_at, sequence_steps(id, kind, deleted_at))")
      .eq("id", campaign.data)
      .eq("org_id", orgId)
      .is("deleted_at", null)
      .maybeSingle();

    if (readError) return fail(`That campaign could not be read: ${readError.message}`);
    if (!target) return fail("That campaign no longer exists.");

    if (!hasEmailStep(target)) {
      return fail(
        `"${target.name}" has no email step yet, so an enrollment there would advance ` +
          `into nothing. Add a step to its sequence first.`,
      );
    }

    /* Which of these are already in. Asked before the insert rather than
       inferred from its result, because an insert that skipped duplicates
       returns only the rows it wrote — and "wrote 3 of 10" cannot distinguish
       seven duplicates from seven ids that are not in this org. Those two need
       different sentences. */
    const { data: existing, error: existingError } = await db
      .from("enrollments")
      .select("opportunity_id")
      .eq("org_id", orgId)
      .eq("campaign_id", campaign.data)
      .in("opportunity_id", ids);

    if (existingError) return fail(`That campaign could not be read: ${existingError.message}`);

    const alreadyIn = new Set((existing ?? []).map((row) => String(row.opportunity_id)));
    const fresh = ids.filter((id) => !alreadyIn.has(id));

    if (fresh.length === 0) {
      return ok(
        { enrolled: 0, alreadyIn: alreadyIn.size },
        `Every one of those is already in "${target.name}", so nothing changed.`,
      );
    }

    const now = new Date().toISOString();
    const { data: inserted, error } = await db
      .from("enrollments")
      .insert(
        fresh.map((opportunityId) => ({
          org_id: orgId,
          campaign_id: campaign.data,
          opportunity_id: opportunityId,
          status: "active",
          current_step: 0,
          /* Due immediately, so the next tick picks it up. What that tick does
             with it is still bounded by the campaign's autonomy level. */
          next_action_at: now,
        })),
      )
      .select("id");

    if (error) {
      /* 23503 is the foreign key: an opportunity id that is not in this org,
         which RLS makes invisible rather than forbidden. */
      if (error.code === "23503") {
        return fail("Part of that selection is not an opportunity in this workspace.");
      }
      return fail(`Those opportunities could not be enrolled: ${error.message}`);
    }

    const enrolled = (inserted ?? []).length;

    revalidatePath(`/${org}/opportunities`);
    revalidatePath(`/${org}/outreach`);

    return ok(
      { enrolled, alreadyIn: alreadyIn.size },
      describe(enrolled, alreadyIn.size, String(target.name), String(target.status)),
    );
  });
}

/* eslint-disable @typescript-eslint/no-explicit-any --
   A nested select has no generated row type without a live project schema.
   Confined to this predicate. */
function hasEmailStep(campaign: any): boolean {
  return (Array.isArray(campaign.sequences) ? campaign.sequences : [])
    .filter((s: any) => !s.deleted_at)
    .some((s: any) =>
      (Array.isArray(s.sequence_steps) ? s.sequence_steps : []).some(
        (step: any) => !step.deleted_at && step.kind === "email",
      ),
    );
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * What happened, and what happens next.
 *
 * The status clause is the part that matters. A draft or paused campaign will
 * not do anything with these enrollments until somebody starts it, and a
 * message that said only "12 added" would leave the user waiting for mail that
 * is not coming.
 */
function describe(enrolled: number, alreadyIn: number, name: string, status: string): string {
  const added = `${enrolled} ${enrolled === 1 ? "opportunity" : "opportunities"} added to "${name}"`;
  const overlap = alreadyIn > 0 ? `; ${alreadyIn} already there` : "";
  const next =
    status === "active"
      ? ". The first step is due on the next run."
      : `. Nothing sends while the campaign is ${status} — start it from Outreach.`;
  return `${added}${overlap}${next}`;
}
