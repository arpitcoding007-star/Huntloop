"use server";

import { revalidatePath } from "next/cache";
import { getActiveIcp } from "../../../../lib/data/icp";
import { canSpend, currentViewer } from "../../../../lib/data/membership";
import { fail, mutate, ok, type ActionResult } from "../../../../lib/data/org";
import { recommend } from "../../../../lib/ai/sources";
import { parseForm, sourceSchema, uuidSchema } from "../../../../lib/validation";

/**
 * Source writes — master context §10, §58.
 *
 * §10 puts the user in control of what a hunt reads: Huntloop recommends, the
 * user accepts, removes or adds. Each of those is an action here, and each
 * maps to one column rather than to a new concept — see the note in
 * `lib/data/hunt-source.ts` on why a pending recommendation is
 * `is_enabled = false`.
 */

export interface SourceInput {
  id?: string;
  name: string;
  kind:
    | "news"
    | "blog"
    | "jobs"
    | "social"
    | "github"
    | "funding"
    | "regulatory"
    | "community"
    | "podcast"
    | "custom";
  url: string;
  icpId: string;
}

export async function saveSourceAction(
  org: string,
  input: SourceInput,
): Promise<ActionResult<{ id: string }>> {
  const parsed = parseForm(sourceSchema, input);
  if (!parsed.ok) return fail(parsed.error, parsed.fieldErrors);
  const value = parsed.value;

  return mutate(org, "saveSource", async ({ db, orgId }) => {
    const row = {
      org_id: orgId,
      name: value.name,
      kind: value.kind,
      url: value.url || null,
      icp_id: value.icpId || null,
    };

    if (value.id) {
      const { error } = await db
        .from("sources")
        .update(row)
        .eq("id", value.id)
        .eq("org_id", orgId)
        .is("deleted_at", null);
      if (error) return fail(`That source could not be saved: ${error.message}`);

      revalidatePath(`/${org}/sources`);
      return ok({ id: value.id }, "Source saved.");
    }

    /* A source the user added themselves is enabled immediately — they asked
       for it, so there is nothing to accept. `recommended_by` records which
       it was, which is what lets the learning loop later ask whether system
       picks or user picks produced better opportunities (§10). */
    const { data, error } = await db
      .from("sources")
      .insert({ ...row, is_enabled: true, recommended_by: "user" })
      .select("id")
      .single();
    if (error) return fail(`That source could not be added: ${error.message}`);

    revalidatePath(`/${org}/sources`);
    return ok({ id: String(data.id) }, "Source added. It will be read on the next hunt.");
  });
}

/**
 * Accept a recommendation, or pause a monitored source.
 *
 * One action for both directions because it is one column, and because the
 * pair reads better as a toggle than as `acceptSource` / `pauseSource` — two
 * names for one flip is how the two ends drift apart.
 */
export async function setSourceEnabledAction(
  org: string,
  id: string,
  enabled: boolean,
): Promise<ActionResult<undefined>> {
  const parsed = uuidSchema.safeParse(id);
  if (!parsed.success) return fail("That source reference isn't valid.");

  return mutate(org, "setSourceEnabled", async ({ db, orgId }) => {
    const { error } = await db
      .from("sources")
      .update({ is_enabled: enabled })
      .eq("id", parsed.data)
      .eq("org_id", orgId)
      .is("deleted_at", null);
    if (error) return fail(`That source could not be changed: ${error.message}`);

    revalidatePath(`/${org}/sources`);
    return ok(
      undefined,
      enabled
        ? "Accepted. It will be read on the next hunt."
        : "Paused. Nothing will be read from it until you turn it back on.",
    );
  });
}

/**
 * Soft delete.
 *
 * `evidence.source_id` references this row with `on delete set null`, so a
 * hard delete would strip the provenance from every claim the source
 * produced — turning a fact with a source into a fact with none, which §52's
 * whole check constraint exists to prevent.
 */
export async function deleteSourceAction(
  org: string,
  id: string,
): Promise<ActionResult<undefined>> {
  const parsed = uuidSchema.safeParse(id);
  if (!parsed.success) return fail("That source reference isn't valid.");

  return mutate(org, "deleteSource", async ({ db, orgId }) => {
    const { error } = await db
      .from("sources")
      .update({ deleted_at: new Date().toISOString(), is_enabled: false })
      .eq("id", parsed.data)
      .eq("org_id", orgId);
    if (error) return fail(`That source could not be removed: ${error.message}`);

    revalidatePath(`/${org}/sources`);
    return ok(undefined, "Source removed.");
  });
}

/**
 * Ask the model for sources, and store them as pending.
 *
 * ── Why this is a button and not a page load ─────────────────────────────
 *
 * It costs money. `recommend()` is a real Opus call, metered into `ai_runs`
 * and bounded by the rate limiter, and running it on every render of this
 * screen would bill an org for looking at its own settings. §77 Principle 7
 * also wants the user to have asked.
 *
 * The rows are written with `is_enabled = false`, so a recommendation the
 * user never looks at still reads nothing. That is the difference between
 * recommending and enabling, and it has to be true in the database.
 */
export async function suggestSourcesAction(
  org: string,
): Promise<ActionResult<{ added: number; metered: boolean; aiConfigured: boolean }>> {
  // Checked before the model call rather than after: a viewer must not be able
  // to spend the org's budget, and `mutate` below would only refuse the write.
  const viewer = await currentViewer(org);
  if (!canSpend(viewer)) {
    return fail("Your role is read-only, so you cannot start a model run.");
  }

  return mutate(org, "suggestSources", async ({ db, orgId }) => {
    const { data: icp } = await getActiveIcp(orgId);
    if (!icp) {
      return fail(
        "There is no active ICP to recommend from yet. Define one under Settings → ICP first.",
      );
    }

    const outcome = await recommend(org, icp);
    if (!outcome.ok) return fail(outcome.error);

    const { recommendations, source, metered } = outcome.result;
    if (recommendations.length === 0) {
      return fail("The model returned no sources it could justify from your ICP.");
    }

    /* Only what is not already on the list, matched on name. `sources` has no
       unique constraint — two feeds can legitimately share a URL — so this is
       the check that stops pressing the button twice doubling the list. */
    const { data: existing, error: existingError } = await db
      .from("sources")
      .select("name")
      .eq("org_id", orgId)
      .is("deleted_at", null);
    if (existingError) return fail(`The suggestions could not be saved: ${existingError.message}`);

    const known = new Set((existing ?? []).map((s) => String(s.name).toLowerCase()));
    const fresh = recommendations.filter((r) => !known.has(r.name.toLowerCase()));

    if (fresh.length === 0) {
      return ok(
        { added: 0, metered, aiConfigured: source === "live" },
        "Nothing new — every source it suggested is already on your list.",
      );
    }

    const { error } = await db.from("sources").insert(
      fresh.map((r) => ({
        org_id: orgId,
        name: r.name,
        kind: KINDS.includes(r.kind as Kind) ? r.kind : "custom",
        url: r.url ?? null,
        is_enabled: false,
        recommended_by: "system",
      })),
    );
    if (error) return fail(`The suggestions could not be saved: ${error.message}`);

    revalidatePath(`/${org}/sources`);
    return ok(
      { added: fresh.length, metered, aiConfigured: source === "live" },
      `${fresh.length} suggested. Nothing is read from them until you accept.`,
    );
  });
}

/**
 * The `source_kind` enum from 0002.
 *
 * Checked rather than trusted: `kind` arrives from a model, and a value
 * outside the enum fails the insert for the whole batch — so one unfamiliar
 * word would lose every other suggestion in the same call. `custom` is what
 * the enum has for exactly this.
 */
const KINDS = [
  "news",
  "blog",
  "jobs",
  "social",
  "github",
  "funding",
  "regulatory",
  "community",
  "podcast",
  "custom",
] as const;
type Kind = (typeof KINDS)[number];
