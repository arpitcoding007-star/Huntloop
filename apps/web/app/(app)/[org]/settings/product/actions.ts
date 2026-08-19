"use server";

import { revalidatePath } from "next/cache";
import { fail, mutate, ok, type ActionResult } from "../../../../../lib/data/org";
import { parseForm, productSchema } from "../../../../../lib/validation";

/**
 * Product writes — master context §8.
 *
 * One action for create and update, because the form is the same form and the
 * only difference is whether an id came with it. Splitting them would
 * duplicate the parse, the org resolution and the revalidate for no gain.
 *
 * `revalidatePath` rather than a client-side refetch: the ICP screen reads the
 * product's description, the analyze screen judges against it, and a stale
 * cached render of either would show the user a judgement made against the
 * product they just replaced.
 */

export interface ProductInput {
  id?: string;
  name: string;
  website: string;
  description: string;
  valueProps: string[];
  proofPoints: string[];
}

export async function saveProductAction(
  org: string,
  input: ProductInput,
): Promise<ActionResult<{ id: string }>> {
  const parsed = parseForm(productSchema, input);
  if (!parsed.ok) return fail(parsed.error, parsed.fieldErrors);
  const value = parsed.value;

  return mutate(org, "saveProduct", async ({ db, orgId }) => {
    const row = {
      org_id: orgId,
      name: value.name,
      // Empty string and "not set" are different things in a nullable column,
      // and a `''` website would render as a link to nowhere.
      website: value.website || null,
      description: value.description || null,
      value_props: value.valueProps,
      proof_points: value.proofPoints,
    };

    if (value.id) {
      const { error } = await db
        .from("products")
        .update(row)
        .eq("id", value.id)
        .eq("org_id", orgId)
        .is("deleted_at", null);
      if (error) return fail(`That product could not be saved: ${error.message}`);

      revalidatePath(`/${org}`, "layout");
      return ok({ id: value.id }, "Product saved.");
    }

    const { data, error } = await db
      .from("products")
      .insert(row)
      .select("id")
      .single();
    if (error) return fail(`That product could not be created: ${error.message}`);

    revalidatePath(`/${org}`, "layout");
    return ok({ id: String(data.id) }, "Product created.");
  });
}

/**
 * Soft delete.
 *
 * `deleted_at`, not `delete from`: `icps.product_id` references this row, and
 * an ICP whose product vanished should still be readable — it was built
 * against something, and erasing what that was makes its criteria unreadable.
 */
export async function deleteProductAction(
  org: string,
  id: string,
): Promise<ActionResult<undefined>> {
  return mutate(org, "deleteProduct", async ({ db, orgId }) => {
    const { error } = await db
      .from("products")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id)
      .eq("org_id", orgId);
    if (error) return fail(`That product could not be removed: ${error.message}`);

    revalidatePath(`/${org}`, "layout");
    return ok(undefined, "Product removed.");
  });
}
