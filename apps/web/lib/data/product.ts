import "server-only";
import { requireOrgId } from "./org";
import { load, type Loaded } from "./source";

/**
 * The product Huntloop is hunting for — master context §8.
 *
 * §8 is upstream of everything: the ICP is defined against a product, sources
 * are recommended from the ICP, and every qualification judgement asks "would
 * this company buy *this*". So an org with no product row is a real and
 * expected state, not an error, and the screen says what is missing rather
 * than rendering an empty form with no explanation.
 *
 * `value_props` and `proof_points` are jsonb arrays of strings. As with
 * `icp.ts`, the shape is a contract this file defines and reads defensively:
 * a row written by an older onboarding step degrades to an empty list rather
 * than throwing on a page render.
 */

export interface Product {
  id: string;
  name: string;
  website: string | null;
  description: string | null;
  valueProps: string[];
  proofPoints: string[];
  updatedAt: string | null;
}

/** Every product for the org, newest first. Most orgs have exactly one. */
export async function listProducts(orgSlug: string): Promise<Loaded<Product[]>> {
  return load(
    async (db) => {
      const orgId = await requireOrgId(orgSlug, "listProducts");

      const { data, error } = await db
        .from("products")
        .select("id, name, website, description, value_props, proof_points, updated_at")
        .eq("org_id", orgId)
        .is("deleted_at", null)
        .order("created_at", { ascending: true });

      if (error) throw new Error(`listProducts: ${error.message}`);
      return (data ?? []).map(mapProduct);
    },
    () => [DEMO],
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any --
   Supabase row types are generated from a live project's schema; see the same
   note in icp.ts. Confined to the mapper so the rest of the file is checked. */
function mapProduct(row: any): Product {
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    website: row.website ?? null,
    description: row.description ?? null,
    valueProps: strings(row.value_props),
    proofPoints: strings(row.proof_points),
    updatedAt: row.updated_at ?? null,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];
}

/**
 * The demo product.
 *
 * Matches what onboarding pre-fills, so a deployment with no database shows
 * the same product the ICP screen judges against rather than a second,
 * differently-worded one. The org layout's banner already says this is demo
 * data; the screen renders `DemoFigures` too when it is not reading live rows.
 */
const DEMO: Product = {
  id: "demo-product",
  name: "Huntloop",
  website: "https://huntloop.example",
  description:
    "Finds companies with a problem you solve, proves it with evidence, and says why now.",
  valueProps: ["Evidence before pitch", "Why-now on every opportunity"],
  proofPoints: [],
  updatedAt: null,
};
