"use server";

import { revalidatePath } from "next/cache";
import { fail, mutate, ok, type ActionResult } from "../../../../../lib/data/org";
import {
  icpFormSchema,
  parseForm,
  personaSchema,
  uuidSchema,
} from "../../../../../lib/validation";

/**
 * ICP writes — master context §9.
 *
 * ── The jsonb shape is the whole risk here ────────────────────────────────
 *
 * `criteria` and `negative_criteria` are jsonb, so Postgres accepts anything
 * and the key names are a contract enforced by nothing. That contract has
 * already been broken once: the seed wrote `industries` / `employee_count` /
 * `signals` while the only reader looked for `segments` / `sizes` / `regions`
 * / `triggers`, and because the reader degrades a missing key to an empty list
 * — which is right, for an ICP written by an older version — nothing failed.
 * It just judged every company against an ICP that asserted nothing.
 *
 * So the keys written below are named to match `lib/data/icp.ts` exactly, and
 * that file is the one place they are documented. Adding a sixth list means
 * changing both, and the failure mode of changing only one is silence.
 */

export interface IcpInput {
  id?: string;
  name: string;
  productId: string;
  segments: string[];
  sizes: string[];
  regions: string[];
  triggers: string[];
  exclusions: string[];
}

export async function saveIcpAction(
  org: string,
  input: IcpInput,
): Promise<ActionResult<{ id: string }>> {
  const parsed = parseForm(icpFormSchema, input);
  if (!parsed.ok) return fail(parsed.error, parsed.fieldErrors);
  const value = parsed.value;

  return mutate(org, "saveIcp", async ({ db, orgId }) => {
    const row = {
      org_id: orgId,
      name: value.name,
      // An empty select means "not tied to a product", which is a real state:
      // an ICP can be sketched before the product row exists. An empty string
      // would fail the uuid column rather than meaning that.
      product_id: value.productId || null,
      criteria: {
        segments: value.segments,
        sizes: value.sizes,
        regions: value.regions,
        triggers: value.triggers,
      },
      negative_criteria: { exclusions: value.exclusions },
    };

    if (value.id) {
      const { error } = await db
        .from("icps")
        .update(row)
        .eq("id", value.id)
        .eq("org_id", orgId)
        .is("deleted_at", null);
      if (error) return fail(`That ICP could not be saved: ${error.message}`);

      revalidatePath(`/${org}`, "layout");
      return ok({ id: value.id }, "ICP saved.");
    }

    /* A brand-new org's first ICP should be the active one, or the whole app
       goes on reporting "no ICP defined" after the user just defined one. Any
       later ICP is created inactive and made active deliberately — see
       `activateIcpAction`, which is the only place that flag is turned on. */
    const { count } = await db
      .from("icps")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .is("deleted_at", null);

    const { data, error } = await db
      .from("icps")
      .insert({ ...row, is_active: (count ?? 0) === 0 })
      .select("id")
      .single();
    if (error) return fail(`That ICP could not be created: ${error.message}`);

    revalidatePath(`/${org}`, "layout");
    return ok({ id: String(data.id) }, "ICP created.");
  });
}

/**
 * Makes one ICP the active one.
 *
 * Two statements rather than one, because `icps_org_active_idx` is a partial
 * index and not a unique constraint — nothing in the schema stops two active
 * ICPs existing, and `getActiveIcp` takes the highest version of whatever it
 * finds. Deactivating everything first is what keeps "the active ICP"
 * singular; doing it in the other order would leave a moment with none, and
 * `getActiveIcp` returning null reads to the app as "no ICP defined yet".
 */
export async function activateIcpAction(
  org: string,
  id: string,
): Promise<ActionResult<undefined>> {
  const parsed = uuidSchema.safeParse(id);
  if (!parsed.success) return fail("That ICP reference isn't valid.");

  return mutate(org, "activateIcp", async ({ db, orgId }) => {
    const { error: clearError } = await db
      .from("icps")
      .update({ is_active: false })
      .eq("org_id", orgId)
      .is("deleted_at", null);
    if (clearError) {
      return fail(`That ICP could not be activated: ${clearError.message}`);
    }

    const { error } = await db
      .from("icps")
      .update({ is_active: true })
      .eq("id", parsed.data)
      .eq("org_id", orgId)
      .is("deleted_at", null);
    if (error) return fail(`That ICP could not be activated: ${error.message}`);

    revalidatePath(`/${org}`, "layout");
    return ok(undefined, "This is now the active ICP.");
  });
}

/**
 * Soft delete.
 *
 * `opportunities.icp_id` references this row, and opportunities are unique on
 * `(org_id, company_id, icp_id)` — so a hard delete would null that column and
 * collapse two opportunities that differ only by which ICP judged them into
 * one key. Not something a settings screen should be able to do.
 */
export async function deleteIcpAction(
  org: string,
  id: string,
): Promise<ActionResult<undefined>> {
  const parsed = uuidSchema.safeParse(id);
  if (!parsed.success) return fail("That ICP reference isn't valid.");

  return mutate(org, "deleteIcp", async ({ db, orgId }) => {
    const { error } = await db
      .from("icps")
      .update({ deleted_at: new Date().toISOString(), is_active: false })
      .eq("id", parsed.data)
      .eq("org_id", orgId);
    if (error) return fail(`That ICP could not be removed: ${error.message}`);

    revalidatePath(`/${org}`, "layout");
    return ok(undefined, "ICP removed.");
  });
}

/* ── Personas (master context §9) ────────────────────────────────────────── */

export interface PersonaInput {
  id?: string;
  icpId: string;
  name: string;
  titlePatterns: string[];
  seniority: string[];
  painPoints: string[];
}

export async function savePersonaAction(
  org: string,
  input: PersonaInput,
): Promise<ActionResult<{ id: string }>> {
  const parsed = parseForm(personaSchema, input);
  if (!parsed.ok) return fail(parsed.error, parsed.fieldErrors);
  const value = parsed.value;

  return mutate(org, "savePersona", async ({ db, orgId }) => {
    /* `title_patterns` and `seniority` are text[] while `pain_points` is
       jsonb — both are written as JS arrays and Postgres checks each against
       its own column type. The distinction is real and is in 0002; guessing
       wrong fails at the database rather than silently storing the wrong
       thing, which is the reason not to paper over it here. */
    const row = {
      org_id: orgId,
      icp_id: value.icpId,
      name: value.name,
      title_patterns: value.titlePatterns,
      seniority: value.seniority,
      pain_points: value.painPoints,
    };

    if (value.id) {
      const { error } = await db
        .from("personas")
        .update(row)
        .eq("id", value.id)
        .eq("org_id", orgId)
        .is("deleted_at", null);
      if (error) return fail(`That persona could not be saved: ${error.message}`);

      revalidatePath(`/${org}/settings/icp`);
      return ok({ id: value.id }, "Persona saved.");
    }

    const { data, error } = await db
      .from("personas")
      .insert(row)
      .select("id")
      .single();
    if (error) return fail(`That persona could not be created: ${error.message}`);

    revalidatePath(`/${org}/settings/icp`);
    return ok({ id: String(data.id) }, "Persona added.");
  });
}

export async function deletePersonaAction(
  org: string,
  id: string,
): Promise<ActionResult<undefined>> {
  const parsed = uuidSchema.safeParse(id);
  if (!parsed.success) return fail("That persona reference isn't valid.");

  return mutate(org, "deletePersona", async ({ db, orgId }) => {
    const { error } = await db
      .from("personas")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", parsed.data)
      .eq("org_id", orgId);
    if (error) return fail(`That persona could not be removed: ${error.message}`);

    revalidatePath(`/${org}/settings/icp`);
    return ok(undefined, "Persona removed.");
  });
}
