import "server-only";
import { requireOrgId } from "./org";
import { load, type Loaded } from "./source";

/**
 * Competitors — `competitors` from 0015.
 *
 * Options for a picker: the active list, by name. Used wherever a person says
 * which competitor a deal was lost to, so the loss can be counted against a
 * row rather than a spelling.
 */
export interface CompetitorOption {
  id: string;
  name: string;
}

export async function listCompetitorOptions(orgSlug: string): Promise<Loaded<CompetitorOption[]>> {
  return load(
    async (db) => {
      const orgId = await requireOrgId(orgSlug, "listCompetitorOptions");
      const { data, error } = await db
        .from("competitors")
        .select("id, name")
        .eq("org_id", orgId)
        .eq("status", "active")
        .is("deleted_at", null)
        .order("name", { ascending: true })
        .limit(200);
      if (error) throw new Error(`listCompetitorOptions: ${error.message}`);
      return (data ?? []).map((c) => ({ id: String(c.id), name: String(c.name) }));
    },
    () => [],
  );
}
