import "server-only";
import { requireOrgId } from "./org";
import { load, type Loaded } from "./source";

export interface MergeRecord {
  id: string;
  winnerId: string;
  winner: string;
  loser: string | null;
  method: "auto" | "manual";
  reason: string;
  mergedAt: string;
  reverted: boolean;
}

/** The last 20 merges, automatic ones included (PANEL-213). */
export async function listRecentMerges(orgSlug: string): Promise<Loaded<MergeRecord[]>> {
  return load(
    async (db) => {
      const orgId = await requireOrgId(orgSlug, "listRecentMerges");
      const { data, error } = await db
        .from("company_merges")
        .select("id, winner_id, loser_id, method, reason, merged_at, reverted_at")
        .eq("org_id", orgId)
        .order("merged_at", { ascending: false })
        .limit(20);
      if (error) throw new Error(`listRecentMerges: ${error.message}`);
      const rows = (data ?? []) as Record<string, string | null>[];
      const ids = [...new Set(rows.flatMap((r) => [r.winner_id, r.loser_id]).filter((v): v is string => Boolean(v)))];
      if (!ids.length) return [];
      const named = await db.from("companies").select("id, name").eq("org_id", orgId).in("id", ids).limit(40);
      if (named.error) throw new Error(`listRecentMerges: ${named.error.message}`);
      const name = new Map(((named.data ?? []) as { id: string; name: string }[]).map((c) => [String(c.id), String(c.name)]));
      return rows.flatMap((r) => {
        const winner = name.get(String(r.winner_id));
        if (!winner) return [];
        return [
          {
            id: String(r.id),
            winnerId: String(r.winner_id),
            winner,
            loser: r.loser_id ? (name.get(r.loser_id) ?? null) : null,
            method: r.method === "auto" ? ("auto" as const) : ("manual" as const),
            reason: String(r.reason ?? ""),
            mergedAt: String(r.merged_at),
            reverted: Boolean(r.reverted_at),
          },
        ];
      });
    },
    () => [],
  );
}
