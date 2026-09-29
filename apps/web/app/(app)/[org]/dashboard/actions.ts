"use server";

import { revalidatePath } from "next/cache";
import { followActiveIcp } from "../../../../lib/data/engine";
import { fail, mutate, ok, type ActionResult } from "../../../../lib/data/org";
import { limitRefusal } from "../../../../lib/rate-limit";

/**
 * "Hunt now" — run discovery against the active customer profile on the next
 * engine tick.
 *
 * FLOW-008 / H-1. Discovery ran once, during onboarding, and then only on its
 * daily schedule — there was no way to ask for it. This rebuilds the search
 * from the profile as it is now and marks it due; the engine's
 * `schedule_discovery` picks it up. Rate-limited like the other provider
 * actions, and inside `mutate()` so only a member who may spend can ask.
 */
export async function huntNowAction(org: string): Promise<ActionResult<undefined>> {
  return mutate(org, "huntNow", async ({ db, orgId }) => {
    const refused = await limitRefusal(orgId, "first_run_stage");
    if (refused) return fail(refused);

    const result = await followActiveIcp(db, orgId, { runNow: true });
    if (!result.searching) {
      return fail(result.reason ?? "There is no search to run yet. Define a customer profile first.");
    }

    revalidatePath(`/${org}/dashboard`);
    return ok(
      undefined,
      "Hunting. New companies arrive on the engine's next run, usually within a few minutes.",
    );
  });
}
