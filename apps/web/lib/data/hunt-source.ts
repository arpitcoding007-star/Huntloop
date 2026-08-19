import "server-only";
import { requireOrgId } from "./org";
import { load, type Loaded } from "./source";

/**
 * The sources a hunt reads — master context §10, §58.
 *
 * ── Why this is not called `source.ts` ───────────────────────────────────
 *
 * Because `lib/data/source.ts` already is, and it means something completely
 * different: *where this screen's data came from*, live or demo. Two files a
 * character apart meaning "the deployment's data origin" and "a publication
 * Huntloop watches" is a name collision waiting to be imported wrongly, so
 * this one says which kind of source it is.
 *
 * ── Recommended vs monitored ─────────────────────────────────────────────
 *
 * §10 is explicit that Huntloop *recommends* and the user accepts, removes or
 * adds. The schema carries both halves of that already and no new column is
 * needed:
 *
 *   is_enabled = true    monitored. A hunt reads it.
 *   is_enabled = false   suggested, not accepted. Nothing reads it.
 *   recommended_by       who put it there — 'system' or 'user'.
 *
 * Reading a pending recommendation as `is_enabled = false` is what makes
 * "nothing is scanned until you accept it" true in the database rather than
 * only in the copy on the screen. Accepting is one column flip.
 */

export type SourceStatus = "ok" | "degraded" | "unavailable";

export interface HuntSource {
  id: string;
  name: string;
  kind: string;
  url: string | null;
  isEnabled: boolean;
  recommendedBy: "system" | "user";
  status: SourceStatus;
  failureCount: number;
  lastScannedAt: string | null;
  lastError: string | null;
  /**
   * Evidence rows attributed to this source.
   *
   * The number this screen used to show was "22 opportunities produced",
   * invented. This is the real quantity behind that idea — `evidence.source_id`
   * — and today it is 0 for every source, because nothing scans yet. Showing
   * the true zero is the point: a fabricated 22 makes a source list that has
   * never run look like one that is working.
   */
  evidenceCount: number;
}

export interface HuntSources {
  monitored: HuntSource[];
  /** Suggested and not yet accepted. Nothing reads these. */
  recommended: HuntSource[];
}

export async function listHuntSources(orgSlug: string): Promise<Loaded<HuntSources>> {
  return load(
    async (db) => {
      const orgId = await requireOrgId(orgSlug, "listHuntSources");

      const { data, error } = await db
        .from("sources")
        .select(
          `id, name, kind, url, is_enabled, recommended_by, status,
           failure_count, last_scanned_at, last_error`,
        )
        .eq("org_id", orgId)
        .is("deleted_at", null)
        .order("name", { ascending: true });

      if (error) throw new Error(`listHuntSources: ${error.message}`);

      const rows = data ?? [];
      const counts = await evidenceCounts(
        db,
        orgId,
        rows.map((r) => String(r.id)),
      );

      const all = rows.map((r) => mapSource(r, counts));
      return {
        monitored: all.filter((s) => s.isEnabled),
        recommended: all.filter((s) => !s.isEnabled),
      };
    },
    () => DEMO,
  );
}

/**
 * Evidence per source, in one round trip.
 *
 * Batched over the whole page rather than issued per source, which is the N+1
 * this list would otherwise grow — the same shape as `evidenceKindsFor` in
 * `opportunities.ts`, and for the same reason.
 */
async function evidenceCounts(
  db: import("@huntloop/db").TenantClient,
  orgId: string,
  sourceIds: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (sourceIds.length === 0) return counts;

  const { data, error } = await db
    .from("evidence")
    .select("source_id")
    .eq("org_id", orgId)
    .in("source_id", sourceIds)
    .is("deleted_at", null)
    .is("superseded_by", null);

  if (error) throw new Error(`listHuntSources evidence: ${error.message}`);

  for (const row of data ?? []) {
    const id = String(row.source_id);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

/* eslint-disable @typescript-eslint/no-explicit-any --
   Supabase row types are generated from a live project's schema; see the same
   note in icp.ts. Confined to the mapper so the rest of the file is checked. */
function mapSource(row: any, counts: Map<string, number>): HuntSource {
  const id = String(row.id);
  return {
    id,
    name: String(row.name ?? ""),
    kind: String(row.kind ?? "custom"),
    url: row.url ?? null,
    isEnabled: Boolean(row.is_enabled),
    recommendedBy: row.recommended_by === "user" ? "user" : "system",
    status: (["ok", "degraded", "unavailable"] as const).includes(row.status)
      ? (row.status as SourceStatus)
      : "ok",
    failureCount: Number(row.failure_count ?? 0),
    lastScannedAt: row.last_scanned_at ?? null,
    lastError: row.last_error ?? null,
    evidenceCount: counts.get(id) ?? 0,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Demo sources.
 *
 * §58 is the reason one of these is degraded and one unavailable: a source
 * list that only ever shows green is lying by omission on the day it matters,
 * and the demo of this screen should show the state the screen exists to
 * surface. The counts are 0 here for the same reason they are 0 live —
 * nothing has scanned.
 */
const DEMO: HuntSources = {
  monitored: [
    {
      id: "demo-source-1",
      name: "The Block",
      kind: "news",
      url: "https://www.theblock.co",
      isEnabled: true,
      recommendedBy: "system",
      status: "ok",
      failureCount: 0,
      lastScannedAt: null,
      lastError: null,
      evidenceCount: 0,
    },
    {
      id: "demo-source-2",
      name: "Job boards",
      kind: "jobs",
      url: null,
      isEnabled: true,
      recommendedBy: "system",
      status: "degraded",
      failureCount: 2,
      lastScannedAt: null,
      lastError: "Rate limited — backing off, partial results this cycle.",
      evidenceCount: 0,
    },
    {
      id: "demo-source-3",
      name: "Crunchbase",
      kind: "funding",
      url: "https://www.crunchbase.com",
      isEnabled: true,
      recommendedBy: "user",
      status: "unavailable",
      failureCount: 9,
      lastScannedAt: null,
      lastError: "HTTP 403 since 06:10. Retrying with backoff.",
      evidenceCount: 0,
    },
  ],
  recommended: [
    {
      id: "demo-source-4",
      name: "Hacker News",
      kind: "community",
      url: "https://news.ycombinator.com",
      isEnabled: false,
      recommendedBy: "system",
      status: "ok",
      failureCount: 0,
      lastScannedAt: null,
      lastError: null,
      evidenceCount: 0,
    },
  ],
};
