import "server-only";
import { requireOrgId } from "./org";
import { load, type Loaded } from "./source";
import { mapCandidate, type MergeCandidate } from "./merge-candidates.shared";

export type { MergeCandidate } from "./merge-candidates.shared";

export async function listMergeCandidates(orgSlug: string): Promise<Loaded<MergeCandidate[]>> {
  return load(
    async (db) => {
      const orgId = await requireOrgId(orgSlug, "listMergeCandidates");
      const { data, error } = await db
        .from("merge_candidates")
        .select(
          `id, matched_on, confidence,
           a:companies!merge_candidates_company_a_id_fkey!inner(id, name, canonical_domain, country, deleted_at),
           b:companies!merge_candidates_company_b_id_fkey!inner(id, name, canonical_domain, country, deleted_at)`,
        )
        .eq("org_id", orgId)
        .eq("status", "pending")
        // UX-002: a pair with a removed side is not a decision; filtered in the query, not after the limit.
        .is("a.deleted_at", null)
        .is("b.deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw new Error(`listMergeCandidates: ${error.message}`);
      return (data ?? [])
        .map((row) => mapCandidate(row as Record<string, unknown>))
        .filter((c): c is MergeCandidate => c !== null);
    },
    () => [],
  );
}
