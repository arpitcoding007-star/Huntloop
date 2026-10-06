"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { engineReadiness } from "../../../../lib/data/engine";
import { currentUserId, fail, mutate, ok, type ActionResult } from "../../../../lib/data/org";
import { parseForm, parseInput, uuidSchema } from "../../../../lib/validation";

/**
 * Demand writes (0042). A person owns every decision here: which proposed
 * themes are real, what they are called, which statements belong where, and
 * the roadmap status. Marking a theme shipped is what brings the deals that
 * asked for it back into Needs you.
 */

const STATUSES = ["open", "planned", "shipped", "wont", "rejected"] as const;

function revalidate(org: string) {
  revalidatePath(`/${org}/demand`);
}

export async function setThemeStatusAction(
  org: string,
  themeId: string,
  status: string,
): Promise<ActionResult<undefined>> {
  const id = parseInput(uuidSchema, themeId, "theme");
  if (!id.ok) return fail(id.error);
  const next = STATUSES.find((s) => s === status);
  if (!next) return fail("That isn't a status a theme can have.");

  return mutate(org, "setThemeStatus", async ({ db, orgId }) => {
    const userId = await currentUserId(db);
    const now = new Date().toISOString();
    const { data, error } = await db
      .from("demand_themes")
      .update({
        status: next,
        decided_by: userId,
        decided_at: now,
        shipped_at: next === "shipped" ? now : null,
      })
      .eq("id", id.value)
      .eq("org_id", orgId)
      .select("title")
      .maybeSingle();
    if (error) return fail(`That could not be changed: ${error.message}`);
    if (!data) return fail("That theme no longer exists.");

    /* A rejected proposal releases its statements, still marked as considered,
       so they are not proposed in the same grouping again. */
    if (next === "rejected") {
      await db.from("demand_signals").update({ theme_id: null }).eq("org_id", orgId).eq("theme_id", id.value);
    }

    revalidate(org);
    revalidatePath(`/${org}/needs-you`);
    revalidatePath(`/${org}/dashboard`);
    const label: Record<(typeof STATUSES)[number], string> = {
      open: `“${data.title}” is on the list.`,
      planned: `“${data.title}” is planned.`,
      shipped: `“${data.title}” is shipped. The deals that asked for it are now in Needs you.`,
      wont: `“${data.title}” is marked won't do.`,
      rejected: `Proposal dismissed. Its statements are back in the ungrouped list.`,
    };
    return ok(undefined, label[next]);
  });
}

const renameSchema = z.object({
  id: uuidSchema,
  title: z.string().trim().min(1, "A theme needs a name.").max(160),
  description: z.string().trim().max(1000).optional().or(z.literal("")),
});

export async function renameThemeAction(org: string, input: unknown): Promise<ActionResult<undefined>> {
  const parsed = parseForm(renameSchema, input);
  if (!parsed.ok) return fail(parsed.error, parsed.fieldErrors);
  return mutate(org, "renameTheme", async ({ db, orgId }) => {
    const { error } = await db
      .from("demand_themes")
      .update({ title: parsed.value.title, description: parsed.value.description || null })
      .eq("id", parsed.value.id)
      .eq("org_id", orgId);
    if (error) return fail(`That could not be saved: ${error.message}`);
    revalidate(org);
    return ok(undefined, "Saved.");
  });
}

/** Fold one theme into another: its statements move, and it is marked merged. */
export async function mergeThemeAction(
  org: string,
  themeId: string,
  intoId: string,
): Promise<ActionResult<undefined>> {
  const from = parseInput(uuidSchema, themeId, "theme");
  const into = parseInput(uuidSchema, intoId, "theme");
  if (!from.ok) return fail(from.error);
  if (!into.ok) return fail(into.error);
  if (from.value === into.value) return fail("Choose a different theme to merge into.");

  return mutate(org, "mergeTheme", async ({ db, orgId }) => {
    const { data: target } = await db
      .from("demand_themes")
      .select("id, title")
      .eq("id", into.value)
      .eq("org_id", orgId)
      .not("status", "in", "(rejected,merged)")
      .maybeSingle();
    if (!target) return fail("That theme is not one you can merge into.");

    const { error: moveError } = await db
      .from("demand_signals")
      .update({ theme_id: into.value })
      .eq("org_id", orgId)
      .eq("theme_id", from.value);
    if (moveError) return fail(`The statements could not be moved: ${moveError.message}`);

    await db
      .from("demand_themes")
      .update({ status: "merged", merged_into: into.value, decided_at: new Date().toISOString() })
      .eq("id", from.value)
      .eq("org_id", orgId);
    revalidate(org);
    return ok(undefined, `Merged into “${target.title}”.`);
  });
}

const createSchema = z.object({
  title: z.string().trim().min(1, "A theme needs a name.").max(160),
  kind: z.enum(["request", "objection", "blocker"]),
  signalIds: z.array(uuidSchema).max(50).default([]),
});

/** A theme a person names themselves, optionally with statements in it. */
export async function createThemeAction(org: string, input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = parseForm(createSchema, input);
  if (!parsed.ok) return fail(parsed.error, parsed.fieldErrors);
  return mutate(org, "createTheme", async ({ db, orgId }) => {
    const userId = await currentUserId(db);
    const { data, error } = await db
      .from("demand_themes")
      .insert({
        org_id: orgId,
        title: parsed.value.title,
        kind: parsed.value.kind,
        status: "open",
        origin: "user",
        decided_by: userId,
        decided_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error) return fail(`That theme could not be created: ${error.message}`);
    if (parsed.value.signalIds.length) {
      await db
        .from("demand_signals")
        .update({ theme_id: String(data.id) })
        .eq("org_id", orgId)
        .in("id", parsed.value.signalIds);
    }
    revalidate(org);
    return ok({ id: String(data.id) }, "Theme created.");
  });
}

/** Put one statement in a theme, or take it out (themeId null). */
export async function assignStatementAction(
  org: string,
  signalId: string,
  themeId: string | null,
): Promise<ActionResult<undefined>> {
  const id = parseInput(uuidSchema, signalId, "statement");
  if (!id.ok) return fail(id.error);
  if (themeId !== null && !uuidSchema.safeParse(themeId).success) return fail("That theme reference isn't valid.");
  return mutate(org, "assignStatement", async ({ db, orgId }) => {
    const { error } = await db
      .from("demand_signals")
      .update({ theme_id: themeId })
      .eq("id", id.value)
      .eq("org_id", orgId);
    if (error) return fail(`That could not be changed: ${error.message}`);
    revalidate(org);
    return ok(undefined, themeId ? "Moved." : "Taken out of the theme.");
  });
}

/** "Group now" — asks the engine to group the ungrouped statements on its next run. */
export async function requestGroupingAction(org: string): Promise<ActionResult<undefined>> {
  return mutate(org, "requestGrouping", async ({ db, orgId }) => {
    if (!(await engineReadiness(db, orgId)).driven) {
      return fail("Nothing is running the engine for this workspace yet, so grouping would never start.");
    }
    const { error } = await db
      .from("demand_state")
      .upsert({ org_id: orgId, requested_at: new Date().toISOString() }, { onConflict: "org_id" });
    if (error) return fail(`Grouping could not be requested: ${error.message}`);
    revalidate(org);
    return ok(undefined, "Requested. Statements are grouped within the hour; new proposals appear here for you to accept.");
  });
}
