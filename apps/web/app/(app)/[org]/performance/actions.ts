"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { PerformanceFact, PerformanceNarrative } from "@huntloop/ai";
import { parseOrgProfile, serializeOrgProfile } from "@huntloop/db/org-profile";
import { explain } from "../../../../lib/ai/performance-narrative";
import { getPerformance } from "../../../../lib/data/performance";
import { fail, mutate, ok, type ActionResult } from "../../../../lib/data/org";
import { performanceFacts } from "../../../../lib/performance/facts";
import { PERIODS, PERIOD_LABEL } from "../../../../lib/performance/compute";
import { goalsSchema, parseForm } from "../../../../lib/validation";

const periodSchema = z.enum(PERIODS);

/**
 * A short narrative over this period's figures (`explain_performance`).
 *
 * The figures are recomputed here from the database rather than accepted from
 * the page, for the same reason the opportunity agent loads its own evidence:
 * a client-supplied fact list would let a caller ask the model to "summarise"
 * numbers nobody measured. Not persisted — it is regenerated on demand, and a
 * summary of last Tuesday's figures saved beside today's would be stale the
 * moment the page reloads.
 */
export async function explainPerformanceAction(
  org: string,
  period: string,
): Promise<
  | { ok: true; source: "live" | "unconfigured"; narrative: PerformanceNarrative; facts: PerformanceFact[] }
  | { ok: false; error: string; retryAt?: string | null }
> {
  const parsed = periodSchema.safeParse(period);
  if (!parsed.success) return { ok: false, error: "That isn't a period this screen has." };

  const { data } = await getPerformance(org, parsed.data);
  const facts = performanceFacts(data.performance);
  const outcome = await explain(org, PERIOD_LABEL[parsed.data], facts);
  if (!outcome.ok) return { ok: false, error: outcome.error, retryAt: outcome.retryAt ?? null };
  return { ok: true, source: outcome.result.source, narrative: outcome.result.narrative, facts };
}

/**
 * Workspace goals — `organizations.settings.goals`.
 *
 * Admin-only, like the rest of the settings blob: a goal is a statement about
 * how the whole team should work, and it is read back to every member as pace.
 * Parsed and re-serialised through the one profile definition, so saving goals
 * can never drop the voice, engine or follow-up settings beside them.
 */
export async function saveGoalsAction(
  org: string,
  input: { touchesPerWeek: number | null; meetingsPerMonth: number | null },
): Promise<ActionResult<undefined>> {
  const parsed = parseForm(goalsSchema, input);
  if (!parsed.ok) return fail(parsed.error, parsed.fieldErrors);

  return mutate(
    org,
    "saveGoals",
    async ({ db, orgId }) => {
      const { data: current, error: readError } = await db
        .from("organizations")
        .select("settings")
        .eq("id", orgId)
        .is("deleted_at", null)
        .maybeSingle();
      if (readError) return fail(`The goals could not be read: ${readError.message}`);

      const profile = parseOrgProfile(current?.settings);
      profile.goals = parsed.value;

      const { error } = await db
        .from("organizations")
        .update({ settings: serializeOrgProfile(profile) })
        .eq("id", orgId)
        .is("deleted_at", null);
      if (error) return fail(`The goals could not be saved: ${error.message}`);

      revalidatePath(`/${org}/performance`);
      return ok(undefined, "Goals saved.");
    },
    { minRole: "admin" },
  );
}
