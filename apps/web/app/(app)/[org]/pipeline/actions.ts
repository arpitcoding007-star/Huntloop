"use server";

import { revalidatePath } from "next/cache";
import { currentUserId, fail, mutate, ok, type ActionResult } from "../../../../lib/data/org";
import { recordSignal } from "../../../../lib/data/signals";
import { enrollmentsOf, withdrawQueuedMail } from "../../../../lib/data/withdraw-mail";
import {
  opportunityStatusSchema,
  outcomeReasonSchema,
  parseForm,
  uuidSchema,
} from "../../../../lib/validation";

/**
 * Pipeline writes — the `opportunity_status` enum from `0003`.
 *
 * One action, one column. The board is a view of `opportunities.status`, and
 * moving a card is the only thing it changes — deliberately, because the other
 * things a pipeline board is often asked to do (edit the priority, rewrite the
 * reason) are judgements with evidence behind them, and a drag gesture is not
 * a place to overturn one.
 */
/** Pipeline stages that are also `outcomes.kind` values (0004). */
const OUTCOME_STAGES = new Set<string>(["meeting", "proposal", "won", "lost"]);
/** Stages at which `send_message` refuses an enrollment's mail (its `CLOSED_STAGES`). */
const CLOSED_STAGES = new Set<string>(["replied", "meeting", "proposal", "won", "lost", "archived"]);

export async function setOpportunityStatusAction(
  org: string,
  opportunityId: string,
  status: string,
  /**
   * Why it ended, for `lost` (0037). Optional on purpose: a reason is the most
   * useful thing a loss can carry, and refusing the move without one would
   * teach people to pick "other" to get past the form.
   */
  why?: { category: string | null; competitorId?: string | null; reason?: string } | null,
): Promise<ActionResult<undefined>> {
  /* Parsed against the enum rather than passed through. The column is a
     Postgres enum, so an unrecognised value is error 22P02 — a 500 where a
     sentence belongs — and this endpoint is a public POST like every other. */
  const parsed = opportunityStatusSchema.safeParse(status);
  if (!parsed.success) return fail("That isn't a stage this pipeline has.");
  const reason = why ? parseForm(outcomeReasonSchema, why) : null;
  if (reason && !reason.ok) return fail(reason.error, reason.fieldErrors);

  return mutate(org, "setOpportunityStatus", async ({ db, orgId }) => {
    const id = uuidSchema.safeParse(opportunityId);
    if (!id.success) return fail("That opportunity reference isn't valid.");

    const { data: moved, error } = await db
      .from("opportunities")
      .update({ status: parsed.data })
      .eq("id", id.data)
      .eq("org_id", orgId)
      .is("deleted_at", null)
      .select("id")
      .maybeSingle();

    if (error) return fail(`That opportunity could not be moved: ${error.message}`);
    /* FLOW-002: nothing moved (removed, or another workspace's id), so no
       outcome, signal or withdrawal follows. */
    if (!moved) return fail("That opportunity no longer exists.");

    /* FLOW-001: a win or a loss is true only while the card stands there.
       Moving Won → Lost, or back off Won after a misclick, retracts the old
       verdict, or Performance, learning and demand count it for good.
       Meetings and proposals happened whatever came after, so they stay. */
    const retract = ["won", "lost"].filter((kind) => kind !== parsed.data);
    const { data: retracted, error: retractError } = await db
      .from("outcomes")
      .delete()
      .eq("org_id", orgId)
      .eq("opportunity_id", id.data)
      .in("kind", retract)
      .select("id");
    if (retractError) return fail(`The earlier outcome could not be withdrawn: ${retractError.message}`);
    const retractedIds = ((retracted ?? []) as { id: string }[]).map((r) => r.id);
    if (retractedIds.length) {
      const { error: demandError } = await db
        .from("demand_signals")
        .delete()
        .eq("org_id", orgId)
        .eq("source_type", "outcome")
        .in("source_id", retractedIds);
      if (demandError) console.error("[pipeline] demand from a withdrawn outcome kept", demandError.message);
    }

    /* OUT-201: a closed deal's queued sequence mail does not go. `send_message`
       refuses it regardless; this makes the inbox say so at once. */
    if (CLOSED_STAGES.has(parsed.data)) {
      await withdrawQueuedMail(db, orgId, await enrollmentsOf(db, orgId, id.data), `the opportunity is ${parsed.data}.`);
      revalidatePath(`/${org}/inbox`);
    }

    /* FLOW-006. Meetings, proposals, wins and losses are the outcomes the
       learning loop exists to explain, and the only outcome writer was reply
       sync — so a pipeline full of wins taught it nothing and the dashboard's
       won count stayed at zero. One row per opportunity and kind: moving a
       card back and forth is not a second win. A failure here does not undo
       the move the user asked for. */
    if (OUTCOME_STAGES.has(parsed.data)) {
      const why = reason?.ok
        ? {
            reason_category: reason.value.category,
            competitor_id: reason.value.competitorId ?? null,
            reason: reason.value.reason?.trim() || null,
            recorded_by: await currentUserId(db),
          }
        : {};
      const { data: already } = await db
        .from("outcomes")
        .select("id")
        .eq("org_id", orgId)
        .eq("opportunity_id", id.data)
        .eq("kind", parsed.data)
        .limit(1);
      if (!already?.length) {
        const { error: outcomeError } = await db.from("outcomes").insert({
          org_id: orgId,
          opportunity_id: id.data,
          kind: parsed.data,
          ...why,
        });
        /* The move stands either way (see above), but a lost outcome is a
           wrong figure on Performance: worth a line in the log. */
        if (outcomeError) console.error("[pipeline] outcome not recorded", outcomeError.message);
      } else if (reason?.ok) {
        /* Moved back and forward again with a reason this time: keep one
           outcome, and let it carry the reason that was finally given. */
        await db.from("outcomes").update(why).eq("id", already[0]!.id).eq("org_id", orgId);
      }
    }

    /* K3: why a company was ruled out, in the person's words — raw material
       for a proposed targeting preference, never applied without a yes. */
    if ((parsed.data === "lost" || parsed.data === "archived") && reason?.ok && reason.value.reason?.trim()) {
      await recordSignal(db, orgId, {
        kind: "disqualified",
        subjectType: "opportunity",
        subjectId: id.data,
        note: [reason.value.category, reason.value.reason.trim()].filter(Boolean).join(": "),
      });
    }

    revalidatePath(`/${org}/pipeline`);
    revalidatePath(`/${org}/opportunities`);
    revalidatePath(`/${org}/team/assignments`);
    revalidatePath(`/${org}/opportunities/${id.data}`);
    revalidatePath(`/${org}/needs-you`);

    return ok(undefined, `Moved to ${parsed.data}.`);
  });
}
