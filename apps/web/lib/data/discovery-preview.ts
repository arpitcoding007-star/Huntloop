import "server-only";
import {
  describeFilters,
  translateIcp,
  type DiscoveryFilters,
  type UnmappedCriterion,
} from "@huntloop/db/discovery";
import { parseIcp } from "@huntloop/db/icp";
import { resolveDataSource } from "./source";
import { currentViewer } from "./membership";

/**
 * The search this workspace's profile actually produces.
 *
 * ── Why a customer needs to see this ─────────────────────────────────────
 *
 * Two things happen between an ICP and a provider query, and both are
 * invisible from the profile screen:
 *
 *   1. **Criteria are dropped.** `translateIcp` maps what a provider can
 *      express and reports the rest as unmapped. A customer whose "uses
 *      Kubernetes" line silently vanished would reasonably believe the results
 *      honour it — `DSC-02`'s honesty requirement, which `0014` records in a
 *      column and which nothing has ever rendered.
 *   2. **Criteria are added.** `expandWithLookAlikes` folds the attributes of
 *      the example companies into the filters. That is a genuinely useful
 *      expansion and it widens a search somebody is paying for using
 *      attributes they never typed, which they are entitled to see.
 *
 * ── Why this reads the saved query rather than recomputing ───────────────
 *
 * Because the saved query is what actually runs. Recomputing from the ICP
 * would show what *would* be searched if a run happened now, which differs
 * from what is scheduled the moment the profile is edited — and the whole
 * value of the panel is telling somebody what their workspace is doing, not
 * what it would do.
 *
 * The recomputation happens too, but only as the *baseline*: the difference
 * between the profile's own translation and the stored filters is exactly what
 * the example companies contributed.
 */

export interface DiscoveryPreview {
  /** The search in one sentence, from `describeFilters`. */
  sentence: string;
  /** Criteria no configured provider can express, with what handles them. */
  unmapped: UnmappedCriterion[];
  /** Filter values present in the saved search but not in the profile itself. */
  addedByExamples: { field: string; values: string[] }[];
  /** Whether the saved search runs on a schedule, and how often. */
  schedule: { enabled: boolean; intervalMinutes: number | null };
}

export async function getDiscoveryPreview(
  orgSlug: string,
): Promise<DiscoveryPreview | null> {
  const { db } = await resolveDataSource();
  if (!db) return null;

  const viewer = await currentViewer(orgSlug);
  if (!viewer || viewer.kind !== "member") return null;

  const [{ data: query }, { data: icpRow }] = await Promise.all([
    db
      .from("discovery_queries")
      .select("filters, unmappable, is_enabled, interval_minutes")
      .eq("org_id", viewer.orgId)
      .eq("is_saved", true)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from("icps")
      .select("criteria, negative_criteria")
      .eq("org_id", viewer.orgId)
      .eq("is_active", true)
      .is("deleted_at", null)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  /* No saved search is a real state and not an error: a workspace whose
     profile has nothing a provider can act on never gets one, and one that
     finished setup before discovery existed has not been given one yet. The
     screen says so rather than rendering an empty frame. */
  if (!query) return null;

  const row = query as {
    filters: unknown;
    unmappable: unknown;
    is_enabled: boolean;
    interval_minutes: number | null;
  };

  const filters = parseFilters(row.filters);
  if (!filters) return null;

  /* The baseline. Failure here is not fatal — the sentence and the unmapped
     list are still worth showing — so a profile that no longer parses simply
     produces no diff rather than losing the whole panel. */
  let addedByExamples: { field: string; values: string[] }[] = [];
  if (icpRow) {
    try {
      const icp = parseIcp(
        (icpRow as { criteria: unknown }).criteria,
        (icpRow as { negative_criteria: unknown }).negative_criteria,
      );
      addedByExamples = diff(translateIcp(icp).filters, filters);
    } catch {
      addedByExamples = [];
    }
  }

  return {
    sentence: describeFilters(filters),
    unmapped: Array.isArray(row.unmappable) ? (row.unmappable as UnmappedCriterion[]) : [],
    addedByExamples,
    schedule: {
      enabled: Boolean(row.is_enabled),
      intervalMinutes: row.interval_minutes,
    },
  };
}

/**
 * What the saved search has that the profile alone does not.
 *
 * Only the three fields `expandWithLookAlikes` can add to. Diffing every field
 * would also surface differences caused by an ICP edited *after* the query was
 * saved — which is a real thing worth knowing and a different message ("your
 * search is out of date"), not this one.
 */
function diff(
  fromProfile: DiscoveryFilters,
  saved: DiscoveryFilters,
): { field: string; values: string[] }[] {
  const out: { field: string; values: string[] }[] = [];

  const extra = (a: string[], b: string[]) =>
    b.filter((v) => !a.some((existing) => existing.trim().toLowerCase() === v.trim().toLowerCase()));

  const industries = extra(fromProfile.industries, saved.industries);
  const technologies = extra(fromProfile.technologies, saved.technologies);
  const keywords = extra(fromProfile.keywords, saved.keywords);

  if (industries.length) out.push({ field: "Industries", values: industries });
  if (technologies.length) out.push({ field: "Technologies", values: technologies });
  if (keywords.length) out.push({ field: "Keywords", values: keywords });

  return out;
}

/**
 * `filters` is jsonb, so its shape is a contract enforced by nothing.
 *
 * Read defensively for the same reason `lib/data/icp.ts` reads `criteria`
 * defensively: a row written by an older version of the translator should
 * degrade to a partial preview, not throw on a settings page render.
 */
function parseFilters(value: unknown): DiscoveryFilters | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;

  const strings = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;

  return {
    keywords: strings(raw.keywords),
    industries: strings(raw.industries),
    locations: strings(raw.locations),
    employeeMin: num(raw.employeeMin),
    employeeMax: num(raw.employeeMax),
    revenueBands: strings(raw.revenueBands),
    technologies: strings(raw.technologies),
    excludeDomains: strings(raw.excludeDomains),
  };
}
