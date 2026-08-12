import type { IcpSummary } from "@huntloop/ai";
import { load, type Loaded } from "./source";

/**
 * The org's active ICP — what every judgement is made against.
 *
 * `criteria` and `negative_criteria` are jsonb, so their shape is a contract
 * rather than a schema. This file *is* that contract:
 *
 *   criteria           { segments, sizes, regions, triggers }  — all string[]
 *   negative_criteria  { exclusions }                          — string[]
 *
 * It matches `IcpSummary` field for field on purpose. The alternative — a
 * looser blob mapped differently by each reader — is how two screens end up
 * disagreeing about what the user's ICP says, and neither of them is wrong.
 *
 * Reads are defensive about it anyway: a row written by an older version of
 * onboarding should degrade to an empty list, not throw on a page render.
 */

/** No ICP is a real state, not an error — a new org has not defined one yet. */
export async function getActiveIcp(orgId: string): Promise<Loaded<IcpSummary | null>> {
  return load(
    async (db) => {
      const { data, error } = await db
        .from("icps")
        .select("criteria, negative_criteria, products(description)")
        .eq("org_id", orgId)
        .eq("is_active", true)
        .is("deleted_at", null)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw new Error(`getActiveIcp: ${error.message}`);
      return data ? mapIcp(data) : null;
    },
    () => FIXTURE,
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any --
   The Supabase response type for a nested select is generated from the
   project's schema, which requires a live project. Isolated to this one
   function so the rest of the file stays checked. */
function mapIcp(row: any): IcpSummary {
  const criteria = (row.criteria ?? {}) as Record<string, unknown>;
  const negative = (row.negative_criteria ?? {}) as Record<string, unknown>;
  const product = Array.isArray(row.products) ? row.products[0] : row.products;

  return {
    sells: typeof product?.description === "string" ? product.description : "",
    segments: strings(criteria.segments),
    sizes: strings(criteria.sizes),
    regions: strings(criteria.regions),
    triggers: strings(criteria.triggers),
    exclusions: strings(negative.exclusions),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/**
 * The demo ICP.
 *
 * Identical to what the onboarding screens pre-fill, so the analyze screen
 * judges against the same profile a new user would have just built rather than
 * a second, differently-worded one. The banner in the org layout already says
 * this is demo data.
 */
const FIXTURE: IcpSummary = {
  sells:
    "Policy and permissioning infrastructure for autonomous agents that hold or move funds.",
  segments: ["Crypto trading desks", "AI infrastructure"],
  sizes: ["11–50", "51–200"],
  regions: ["North America", "Europe"],
  triggers: [
    "Raised funding in the last 90 days",
    "Shipped an autonomous agent that moves funds",
    "Hiring for on-chain or custody engineering",
  ],
  exclusions: ["Consumer-facing products", "Companies with no engineering team"],
};
