"use server";

import { revalidatePath } from "next/cache";
import { bandsToRange, parseIcp } from "@huntloop/db/icp";
import { mergeStoredJson } from "../../../../../lib/data/icp";
import {
  fail,
  mutate,
  ok,
  resolveDataSource,
  type ActionResult,
} from "../../../../../lib/data/org";
import { limitRefusal } from "../../../../../lib/rate-limit";
import { followActiveIcp } from "../../../../../lib/data/engine";
import {
  previewLookAlikes,
  type LookAlikePreview,
} from "../../../../../lib/data/look-alike-preview";
import {
  icpFormSchema,
  icpProposalApplySchema,
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
  exampleCompanies: string[];
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
    /*
     * ── ICP-03: what this form owns, and what it must not touch ──────────
     *
     * `criteria` has fifteen keys (`0013`) and this form renders five of
     * them. Writing the object wholesale — which is what it did — meant a user
     * who finished onboarding with industries, technologies, an employee
     * range, pain points and use cases, then came back here to fix a typo in
     * the profile's name, silently lost all of it. Nothing failed: the reader
     * degrades a missing key to an empty list, correctly, for a profile
     * written by an older version. The scores simply got quieter, measured
     * against a profile that no longer asserted most of what the user said.
     *
     * So an update merges. The keys below are the ones this screen is
     * authoritative for; every other key is carried through from the stored
     * row untouched. A create has nothing to carry, so it writes the object
     * as-is and the unrendered keys are genuinely absent rather than erased.
     */
    const owned = {
      criteria: {
        segments: value.segments,
        sizes: value.sizes,
        /* The numeric range a provider filter reads. Derived from the bands so
           a size changed here changes the search; leaving the range written
           at onboarding meant the bands said one thing and the search another. */
        employeeRange: value.sizes.length ? bandsToRange(value.sizes) : null,
        regions: value.regions,
        triggers: value.triggers,
        exampleCompanies: value.exampleCompanies,
      },
      negative_criteria: { exclusions: value.exclusions },
    };

    const base = {
      org_id: orgId,
      name: value.name,
      // An empty select means "not tied to a product", which is a real state:
      // an ICP can be sketched before the product row exists. An empty string
      // would fail the uuid column rather than meaning that.
      product_id: value.productId || null,
    };

    if (value.id) {
      /* Read-then-write rather than a jsonb merge in SQL. PostgREST cannot
         express `criteria || '{…}'` through the query builder, and the
         alternative — a SECURITY DEFINER function to perform one object merge
         — would add a function that bypasses RLS in order to save a round
         trip. The race it leaves is two people saving the same profile at
         once, which loses the same edit either way. */
      const { data: existing, error: readError } = await db
        .from("icps")
        .select("criteria, negative_criteria, is_active")
        .eq("id", value.id)
        .eq("org_id", orgId)
        .is("deleted_at", null)
        .maybeSingle();
      if (readError) {
        return fail(`That ICP could not be saved: ${readError.message}`);
      }
      if (!existing) return fail("That ICP no longer exists.");

      const row = {
        ...base,
        criteria: mergeStoredJson(existing.criteria, owned.criteria),
        negative_criteria: mergeStoredJson(
          existing.negative_criteria,
          owned.negative_criteria,
        ),
      };

      const { error } = await db
        .from("icps")
        .update(row)
        .eq("id", value.id)
        .eq("org_id", orgId)
        .is("deleted_at", null);
      if (error) return fail(`That ICP could not be saved: ${error.message}`);

      // FLOW-008: the search and the scores follow the profile that changed.
      if (existing.is_active) await followActiveIcp(db, orgId, { runNow: false });

      revalidatePath(`/${org}`, "layout");
      return ok({ id: value.id }, "ICP saved.");
    }

    const row = { ...base, ...owned };

    /* A brand-new org's first ICP should be the active one, or the whole app
       goes on reporting "no ICP defined" after the user just defined one. Any
       later ICP is created inactive and made active deliberately — see
       `activateIcpAction`, which is the only place that flag is turned on. */
    const { count } = await db
      .from("icps")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .is("deleted_at", null);

    const active = (count ?? 0) === 0;
    const { data, error } = await db
      .from("icps")
      .insert({ ...row, is_active: active })
      .select("id")
      .single();
    if (error) return fail(`That ICP could not be created: ${error.message}`);

    /* An active profile gets its search built now, exactly as saving or
       activating one does — otherwise nothing hunted until the next edit or
       "Hunt now" (M-14). */
    if (active) await followActiveIcp(db, orgId, { runNow: false });

    revalidatePath(`/${org}`, "layout");
    return ok({ id: String(data.id) }, "ICP created.");
  });
}

/**
 * Applies the suggestions a person picked from the tighter-profile proposal
 * (M-12). Each value is appended to its list on the stored profile — never
 * replacing what is there — and the search and scores follow, as any other
 * profile edit does.
 */
export async function applyIcpProposalAction(
  org: string,
  input: unknown,
): Promise<ActionResult<{ applied: number }>> {
  const parsed = parseForm(icpProposalApplySchema, input);
  if (!parsed.ok) return fail(parsed.error, parsed.fieldErrors);
  const { icpId, picks } = parsed.value;

  return mutate(org, "applyIcpProposal", async ({ db, orgId }) => {
    const { data: existing, error } = await db
      .from("icps")
      .select("criteria, negative_criteria, is_active")
      .eq("id", icpId)
      .eq("org_id", orgId)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) return fail(`That profile could not be read: ${error.message}`);
    if (!existing) return fail("That profile no longer exists.");

    const criteria = mergeStoredJson(existing.criteria, {});
    const negative = mergeStoredJson(existing.negative_criteria, {});
    const append = (target: Record<string, unknown>, key: string, value: string) => {
      const list = Array.isArray(target[key]) ? (target[key] as unknown[]).map(String) : [];
      if (list.some((v) => v.toLowerCase() === value.toLowerCase())) return false;
      target[key] = [...list, value];
      return true;
    };

    let applied = 0;
    for (const pick of picks) {
      const added =
        pick.field === "exclusions"
          ? append(negative, "exclusions", pick.value)
          : append(criteria, pick.field, pick.value);
      if (added) applied += 1;
    }
    // The search reads the range, not the bands; keep them in step.
    if (picks.some((p) => p.field === "sizes") && Array.isArray(criteria.sizes)) {
      criteria.employeeRange = bandsToRange(criteria.sizes as string[]);
    }
    if (applied === 0) return ok({ applied }, "Those are already on the profile.");

    const { error: writeError } = await db
      .from("icps")
      .update({ criteria, negative_criteria: negative })
      .eq("id", icpId)
      .eq("org_id", orgId)
      .is("deleted_at", null);
    if (writeError) return fail(`The profile could not be updated: ${writeError.message}`);

    if (existing.is_active) await followActiveIcp(db, orgId, { runNow: false });

    revalidatePath(`/${org}`, "layout");
    return ok(
      { applied },
      `Added ${applied} to the profile. The search and scores follow it from the next run.`,
    );
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
  return mutate(org, "activateIcp", async ({ db, orgId }) => {
    const parsed = uuidSchema.safeParse(id);
    if (!parsed.success) return fail("That ICP reference isn't valid.");

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

    // FLOW-008: switching profile switches what the engine searches and scores.
    await followActiveIcp(db, orgId, { runNow: true });

    revalidatePath(`/${org}`, "layout");
    return ok(undefined, "This is now the active ICP. Discovery and scoring now follow it.");
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
  return mutate(org, "deleteIcp", async ({ db, orgId }) => {
    const parsed = uuidSchema.safeParse(id);
    if (!parsed.success) return fail("That ICP reference isn't valid.");

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
  return mutate(org, "deletePersona", async ({ db, orgId }) => {
    const parsed = uuidSchema.safeParse(id);
    if (!parsed.success) return fail("That persona reference isn't valid.");

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

/**
 * What the example companies would add, run on demand.
 *
 * ── Why this exists on the settings screen (`ONB-22`) ────────────────────
 *
 * `SearchPreview` below the editor answers the same question by diffing the
 * saved provider query against the profile. That answer is only available to
 * a workspace that already has a saved search, which is precisely not the
 * person who has just typed their first example domain: for them the field
 * appears to do nothing until a discovery run happens, and by then the search
 * has already been widened.
 *
 * ── Why it takes the form's values rather than the stored ones ───────────
 *
 * Because the question is about what you are typing. Reading the saved row
 * would answer it for the profile as it was before this edit, which is the
 * one answer nobody on this screen wants.
 *
 * It writes nothing. The expansion is applied at discovery time, from the
 * saved profile — this only shows what that will do.
 */
export async function previewLookAlikesAction(
  org: string,
  input: unknown,
): Promise<ActionResult<LookAlikePreview>> {
  const parsed = parseForm(icpFormSchema, input);
  if (!parsed.ok) return fail(parsed.error, parsed.fieldErrors);
  const value = parsed.value;

  if (value.exampleCompanies.length === 0) {
    return fail(
      "Add a company or two first — as domains, like stripe.com — and we'll " +
        "read them and show you what they'd change.",
    );
  }

  /* `mutate` would refuse this anyway, with "there is nothing to save to" —
     which is the wrong sentence for an action that saves nothing. A reader
     walking the demo deserves the actual reason, and the actual reason is
     that a provider call has to be metered against a workspace that exists. */
  const { db } = await resolveDataSource();
  if (!db) {
    return fail(
      "This deployment has no database connected, so the example companies " +
        "can't be read: looking one up is a metered provider call, and there " +
        "is nowhere to meter it.",
    );
  }

  /* `mutate` rather than a bare read, for the reason `estimateReachAction`
     gives: this spends a provider credit, and the org id it resolves comes
     from a verified membership. `previewLookAlikes` runs under the
     service-role client and would otherwise be a way to bill another tenant. */
  return mutate(org, "previewLookAlikes", async ({ orgId }) => {
    const refused = await limitRefusal(orgId, "lookup_example_companies");
    if (refused) return fail(refused);

    /* Built through `parseIcp` rather than as a literal, for two reasons.
       `IcpCriteria` distinguishes "not stated" (null) from "stated as none"
       ([]), so spelling out fifteen nulls here is how this drifts from the
       type the next time a key is added — and `parseCriteria` is also where
       `sizes` becomes an `employeeRange` via `bandsToRange`. Skipping it
       would give the preview a narrower baseline than the search it is
       previewing, and report a size widening that will not happen. */
    const icp = parseIcp(
      {
        segments: value.segments,
        sizes: value.sizes,
        regions: value.regions,
        triggers: value.triggers,
        exampleCompanies: value.exampleCompanies,
      },
      { exclusions: value.exclusions },
    );

    return ok(await previewLookAlikes(orgId, icp));
  });
}
