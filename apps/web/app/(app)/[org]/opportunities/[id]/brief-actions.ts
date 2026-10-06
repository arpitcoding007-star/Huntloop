"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { engineReadiness } from "../../../../../lib/data/engine";
import { canSpend, currentViewer } from "../../../../../lib/data/membership";
import { fail, mutate, ok, type ActionResult } from "../../../../../lib/data/org";
import { parseInput, uuidSchema } from "../../../../../lib/validation";

/**
 * The decision brief's two writes (COMMAND.md §16.3-C): ask for fresh research
 * on the company, and record what the deal is worth.
 */

/**
 * "Research this". Writes the request column (0040); `schedule_followups`
 * turns it into a forced `research_company` job, which rescores when it lands.
 */
export async function askResearchAction(
  org: string,
  opportunityId: string,
): Promise<ActionResult<undefined>> {
  const id = parseInput(uuidSchema, opportunityId, "opportunity");
  if (!id.ok) return fail(id.error);

  const viewer = await currentViewer(org);
  if (!canSpend(viewer)) return fail("Your role is read-only, so you cannot start research.");

  return mutate(org, "askResearch", async ({ db, orgId }) => {
    const { data: opp } = await db
      .from("opportunities")
      .select("company_id")
      .eq("id", id.value)
      .eq("org_id", orgId)
      .is("deleted_at", null)
      .maybeSingle();
    if (!opp) return fail("That opportunity no longer exists.");

    if (!(await engineReadiness(db, orgId)).driven) {
      return fail("Nothing is running the engine for this workspace yet, so research would never start.");
    }

    const { error } = await db
      .from("companies")
      .update({ research_asked_at: new Date().toISOString() })
      .eq("id", String(opp.company_id))
      .eq("org_id", orgId);
    if (error) return fail(`Research could not be requested: ${error.message}`);

    revalidatePath(`/${org}/opportunities/${id.value}`);
    return ok(
      undefined,
      "Research requested. Huntloop re-reads their site and sources on the engine's next run, then rescores.",
    );
  });
}

/** A whole-currency amount as typed — "25000", "25,000", "$25k" — or empty to clear. */
const amountSchema = z
  .string()
  .trim()
  .max(24)
  .transform((raw, ctx) => {
    if (!raw) return null;
    const m = raw.replace(/[$€£,\s]/g, "").match(/^(\d+(?:\.\d{1,2})?)([kKmM]?)$/);
    if (!m) {
      ctx.addIssue({ code: "custom", message: "Use a number, like 25000 or 25k." });
      return z.NEVER;
    }
    const multiplier = m[2]?.toLowerCase() === "k" ? 1_000 : m[2]?.toLowerCase() === "m" ? 1_000_000 : 1;
    const cents = Math.round(Number(m[1]) * multiplier * 100);
    if (cents > 100_000_000_000) {
      ctx.addIssue({ code: "custom", message: "That is larger than any deal this can record." });
      return z.NEVER;
    }
    return cents;
  });

export async function setDealValueAction(
  org: string,
  opportunityId: string,
  amount: string,
): Promise<ActionResult<{ cents: number | null }>> {
  const id = parseInput(uuidSchema, opportunityId, "opportunity");
  if (!id.ok) return fail(id.error);
  const parsed = amountSchema.safeParse(amount);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "That amount isn't valid.");

  return mutate(org, "setDealValue", async ({ db, orgId }) => {
    const { error } = await db
      .from("opportunities")
      .update({ estimated_value_cents: parsed.data })
      .eq("id", id.value)
      .eq("org_id", orgId)
      .is("deleted_at", null);
    if (error) return fail(`The value could not be saved: ${error.message}`);
    revalidatePath(`/${org}/opportunities/${id.value}`);
    revalidatePath(`/${org}/performance`);
    return ok({ cents: parsed.data }, parsed.data === null ? "Value cleared." : "Value saved.");
  });
}
