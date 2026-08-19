import "server-only";
import { OPPORTUNITIES } from "../fixtures/opportunities";
import { requireOrgId } from "./org";
import { load, type Loaded } from "./source";

/**
 * Companies — master context §12.
 *
 * The account record behind an opportunity. An opportunity is a *judgement*
 * about a company at a moment; the company is the durable thing the judgement
 * is about, and §59 makes `canonical_domain` the key that keeps them one row
 * when the same company arrives from GitHub and from a news article.
 *
 * ── Why the counts are embedded rather than aggregated ───────────────────
 *
 * PostgREST can return `opportunities(count)`, and that would be less data
 * over the wire. It would also be wrong here: soft-deleted rows have to come
 * out of the total, and an aggregate cannot be filtered on `deleted_at` from
 * the parent's query — the same trap `opportunities.ts` records for embedded
 * triggers and people. So the ids come back and the filtering happens in the
 * mapper, where it is visible.
 */

export interface Company {
  id: string;
  name: string;
  canonicalDomain: string;
  website: string | null;
  industry: string | null;
  employeeCount: number | null;
  country: string | null;
  region: string | null;
  businessModel: string | null;
  description: string | null;
  lastResearchedAt: string | null;
  /** Live opportunities against this company, across every ICP. */
  opportunityCount: number;
  /** The strongest priority among them, for the list's badge. */
  topPriority: "hot" | "warm" | "watch" | "ignore" | null;
  peopleCount: number;
}

const SELECT = `id, name, canonical_domain, website, industry, employee_count,
   country, region, business_model, description, last_researched_at,
   opportunities(id, priority, deleted_at),
   people(id, deleted_at)`;

export async function listCompanies(orgSlug: string): Promise<Loaded<Company[]>> {
  return load(
    async (db) => {
      const orgId = await requireOrgId(orgSlug, "listCompanies");

      const { data, error } = await db
        .from("companies")
        .select(SELECT)
        .eq("org_id", orgId)
        .is("deleted_at", null)
        .order("name", { ascending: true });

      if (error) throw new Error(`listCompanies: ${error.message}`);
      return (data ?? []).map(mapCompany);
    },
    () => DEMO,
  );
}

/** One company. `undefined` rather than throwing, so the route can 404. */
export async function getCompany(
  orgSlug: string,
  id: string,
): Promise<Loaded<Company | undefined>> {
  return load(
    async (db) => {
      // Rejected before the query, not after: `id` comes from a URL and meets
      // a uuid column, so a stale link would otherwise raise Postgres 22P02 —
      // a 500 where a 404 belongs. Same reasoning as `getOpportunity`.
      if (!isUuid(id)) return undefined;

      const orgId = await requireOrgId(orgSlug, "getCompany");

      const { data, error } = await db
        .from("companies")
        .select(SELECT)
        .eq("org_id", orgId)
        .eq("id", id)
        .is("deleted_at", null)
        .maybeSingle();

      if (error) throw new Error(`getCompany: ${error.message}`);
      return data ? mapCompany(data) : undefined;
    },
    () => DEMO.find((c) => c.id === id),
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function isUuid(value: string): boolean {
  return UUID.test(value);
}

/**
 * The priority order of §78: the verdict ranks, the score is detail within it.
 * Used to pick which of a company's opportunities the list badges it with.
 */
const RANK = { hot: 0, warm: 1, watch: 2, ignore: 3 } as const;

/* eslint-disable @typescript-eslint/no-explicit-any --
   Supabase row types for a nested select are generated from a live project's
   schema. Confined to the mapper so the rest of the file is checked. */
function mapCompany(row: any): Company {
  const opportunities = (Array.isArray(row.opportunities) ? row.opportunities : []).filter(
    (o: any) => !o.deleted_at,
  );

  const priorities = opportunities
    .map((o: any) => o.priority as keyof typeof RANK)
    .filter((p: keyof typeof RANK) => p in RANK)
    .sort((a: keyof typeof RANK, b: keyof typeof RANK) => RANK[a] - RANK[b]);

  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    canonicalDomain: String(row.canonical_domain ?? ""),
    website: row.website ?? null,
    industry: row.industry ?? null,
    employeeCount: typeof row.employee_count === "number" ? row.employee_count : null,
    country: row.country ?? null,
    region: row.region ?? null,
    businessModel: row.business_model ?? null,
    description: row.description ?? null,
    lastResearchedAt: row.last_researched_at ?? null,
    opportunityCount: opportunities.length,
    topPriority: priorities[0] ?? null,
    peopleCount: (Array.isArray(row.people) ? row.people : []).filter(
      (p: any) => !p.deleted_at,
    ).length,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Demo companies.
 *
 * Derived from the opportunity fixtures rather than written a second time, so
 * an unconfigured deployment cannot show a company on this screen that its own
 * opportunity list disagrees about. The fields the fixtures do not carry are
 * `null` — which is the honest value for "not researched", and renders as
 * UNKNOWN rather than as a blank that looks like an empty answer.
 */
const DEMO: Company[] = OPPORTUNITIES.map((o, i) => ({
  id: `demo-company-${i + 1}`,
  name: o.company,
  canonicalDomain: o.domain,
  website: `https://${o.domain}`,
  industry: o.industry,
  employeeCount: null,
  country: null,
  region: o.location,
  businessModel: null,
  description: null,
  lastResearchedAt: null,
  opportunityCount: 1,
  topPriority: o.priority,
  peopleCount: 0,
})).sort((a, b) => a.name.localeCompare(b.name));
