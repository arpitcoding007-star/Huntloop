"use server";

import { revalidatePath } from "next/cache";
import { fail, mutate, ok, type ActionResult } from "../../../../lib/data/org";
import { opportunityStatusSchema, uuidSchema } from "../../../../lib/validation";

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

export async function setOpportunityStatusAction(
  org: string,
  opportunityId: string,
  status: string,
): Promise<ActionResult<undefined>> {
  /* Parsed against the enum rather than passed through. The column is a
     Postgres enum, so an unrecognised value is error 22P02 — a 500 where a
     sentence belongs — and this endpoint is a public POST like every other. */
  const parsed = opportunityStatusSchema.safeParse(status);
  if (!parsed.success) return fail("That isn't a stage this pipeline has.");

  return mutate(org, "setOpportunityStatus", async ({ db, orgId }) => {
    const id = uuidSchema.safeParse(opportunityId);
    if (!id.success) return fail("That opportunity reference isn't valid.");

    const { error } = await db
      .from("opportunities")
      .update({ status: parsed.data })
      .eq("id", id.data)
      .eq("org_id", orgId)
      .is("deleted_at", null);

    if (error) return fail(`That opportunity could not be moved: ${error.message}`);

    /* FLOW-006. Meetings, proposals, wins and losses are the outcomes the
       learning loop exists to explain, and the only outcome writer was reply
       sync — so a pipeline full of wins taught it nothing and the dashboard's
       won count stayed at zero. One row per opportunity and kind: moving a
       card back and forth is not a second win. A failure here does not undo
       the move the user asked for. */
    if (OUTCOME_STAGES.has(parsed.data)) {
      const { data: already } = await db
        .from("outcomes")
        .select("id")
        .eq("org_id", orgId)
        .eq("opportunity_id", id.data)
        .eq("kind", parsed.data)
        .limit(1);
      if (!already?.length) {
        await db.from("outcomes").insert({
          org_id: orgId,
          opportunity_id: id.data,
          kind: parsed.data,
        });
      }
    }

    revalidatePath(`/${org}/pipeline`);
    revalidatePath(`/${org}/opportunities`);
    revalidatePath(`/${org}/team/assignments`);

    return ok(undefined, `Moved to ${parsed.data}.`);
  });
}
