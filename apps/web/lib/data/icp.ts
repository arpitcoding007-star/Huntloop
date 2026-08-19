import type { IcpSummary } from "@huntloop/ai";
import { requireOrgId } from "./org";
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

/* ── The editable record ─────────────────────────────────────────────────── */

/**
 * `IcpSummary` above is what the *model* is given: the profile flattened to
 * the five lists a prompt reasons over, with the product's description folded
 * in as `sells`. It deliberately has no id, because a prompt has nothing to do
 * with one.
 *
 * An editor needs the row instead — its id, which product it belongs to,
 * whether it is the active one, and its personas. So this is a second shape
 * over the same table rather than a widening of the first: making `IcpSummary`
 * carry ids would put database identity into every prompt payload, and the
 * two shapes drift for good reasons rather than by accident.
 */

export interface Persona {
  id: string;
  name: string;
  titlePatterns: string[];
  seniority: string[];
  painPoints: string[];
}

export interface IcpRecord {
  id: string;
  name: string;
  productId: string | null;
  segments: string[];
  sizes: string[];
  regions: string[];
  triggers: string[];
  exclusions: string[];
  isActive: boolean;
  version: number;
  updatedAt: string | null;
  personas: Persona[];
}

/**
 * Every ICP for the org, active first.
 *
 * Personas are embedded rather than fetched per ICP: `personas.icp_id` is a
 * real foreign key, so unlike `evidence` — whose subject is polymorphic and
 * has to be a second query — PostgREST can follow this one. Soft-deleted
 * personas are filtered on the embedded rows, because the top-level
 * `deleted_at is null` does not reach inside an embed.
 */
export async function listIcps(orgSlug: string): Promise<Loaded<IcpRecord[]>> {
  return load(
    async (db) => {
      const orgId = await requireOrgId(orgSlug, "listIcps");

      const { data, error } = await db
        .from("icps")
        .select(
          `id, name, product_id, criteria, negative_criteria, is_active, version, updated_at,
           personas(id, name, title_patterns, seniority, pain_points, deleted_at)`,
        )
        .eq("org_id", orgId)
        .is("deleted_at", null)
        .order("is_active", { ascending: false })
        .order("version", { ascending: false });

      if (error) throw new Error(`listIcps: ${error.message}`);
      return (data ?? []).map(mapRecord);
    },
    () => [DEMO_RECORD],
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any --
   Same reasoning as `mapIcp` above: the row type for a nested select is
   generated from a live project's schema. Confined to the mappers. */
function mapRecord(row: any): IcpRecord {
  const criteria = (row.criteria ?? {}) as Record<string, unknown>;
  const negative = (row.negative_criteria ?? {}) as Record<string, unknown>;

  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    productId: row.product_id ?? null,
    segments: strings(criteria.segments),
    sizes: strings(criteria.sizes),
    regions: strings(criteria.regions),
    triggers: strings(criteria.triggers),
    exclusions: strings(negative.exclusions),
    isActive: Boolean(row.is_active),
    version: Number(row.version ?? 1),
    updatedAt: row.updated_at ?? null,
    personas: (Array.isArray(row.personas) ? row.personas : [])
      .filter((p: any) => !p.deleted_at)
      .map(mapPersona),
  };
}

function mapPersona(row: any): Persona {
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    titlePatterns: strings(row.title_patterns),
    seniority: strings(row.seniority),
    painPoints: strings(row.pain_points),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * The demo ICP as a record.
 *
 * Built from `FIXTURE` rather than restating it, so the editor in demo mode
 * shows the same profile the analyze screen judges against. Two hand-written
 * copies of the same demo ICP is the drift this whole file argues against.
 */
const DEMO_RECORD: IcpRecord = {
  id: "demo-icp",
  name: "Agent infrastructure teams",
  productId: null,
  segments: FIXTURE.segments,
  sizes: FIXTURE.sizes,
  regions: FIXTURE.regions,
  triggers: FIXTURE.triggers,
  exclusions: FIXTURE.exclusions,
  isActive: true,
  version: 1,
  updatedAt: null,
  personas: [
    {
      id: "demo-persona",
      name: "Platform engineering lead",
      titlePatterns: ["Head of Platform", "Staff Engineer, Infrastructure"],
      seniority: ["Director", "Staff"],
      painPoints: ["Agents move funds with no policy layer in front of them"],
    },
  ],
};
