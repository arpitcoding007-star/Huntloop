import type { TenantClient } from "@huntloop/db";
import type { EvidenceItem } from "@huntloop/ui";
import { OPPORTUNITIES, findOpportunity } from "../fixtures/opportunities";
import { currentViewer } from "./membership";
import { load, type Loaded } from "./source";
import {
  byPriorityThenScore,
  isUuid,
  mapDetail,
  mapEvidence,
  mapListRow,
  type DetailQueryRow,
  type EvidenceQueryRow,
  type ListQueryRow,
  type OpportunityDetail,
  type OpportunityRow,
} from "./opportunity-map";

export type { OpportunityDetail, OpportunityRow } from "./opportunity-map";

/**
 * Opportunity loaders — FEAT-02.
 *
 * These were the last fixture-backed screens, and they stayed that way on
 * purpose: the note this comment replaces said that writing the join blind
 * "produces a query that reads as finished and has never returned a row".
 * Both queries below have now been run against a migrated project with seeded
 * rows, as a real user with RLS on, and their shapes are what came back — not
 * what the schema suggested would.
 *
 * Three things that only running it settled:
 *
 *   1. **`evidence` cannot be embedded.** Its subject is polymorphic
 *      (`subject_type` + `subject_id`) so there is no foreign key for
 *      PostgREST to follow, and it must be a second query. A join written
 *      from the ERD would have nested it and failed at runtime, on the page
 *      the product is judged on.
 *   2. **A non-uuid id raises rather than returning nothing.** The detail
 *      route's `id` comes from a URL and meets a `uuid` column, so an old link
 *      to a fixture slug produced `22P02` — a 500 where a 404 belongs. It is
 *      rejected before the query, not after.
 *   3. **Soft deletes have to be filtered on the embedded rows too.** A
 *      deleted trigger or person lives under `companies`, where the top-level
 *      `deleted_at is null` does not reach it.
 *
 * Ordering: priority first, then recency — not score. §78 requires that a
 * strong trigger cannot lift a poor-fit company, so the verdict orders the
 * list and the score is detail within it. That is also the index the migration
 * creates (`opportunities_priority_idx`), so the UI default and the query plan
 * agree instead of quietly fighting.
 *
 * The row-to-screen mapping lives in `./opportunity-map`, which is pure and
 * has its own tests. This file is the part that needs a database.
 */

/**
 * The org's UUID, for a caller already known to be a member.
 *
 * The layout has 404'd a non-member before any page renders, and RLS would
 * return zero rows regardless — this is how the loader gets the id, not a
 * second authorization check. `currentViewer` is React-cached, so it costs
 * nothing beyond the lookup the layout already did.
 */
async function orgIdFor(orgSlug: string, caller: string): Promise<string> {
  const viewer = await currentViewer(orgSlug);
  if (!viewer || viewer.kind !== "member") {
    // Unreachable through the app: `load()` only calls in here when the
    // database is live, and a live request with no membership never gets past
    // the layout. Loud rather than a silent empty list, because an empty list
    // is indistinguishable from "you have no opportunities".
    throw new Error(
      `${caller}: no membership resolved for "${orgSlug}" on a live database. ` +
        `The org layout should have returned 404 before this ran.`,
    );
  }
  return viewer.orgId;
}

/* ── The list ────────────────────────────────────────────────────────────── */

export async function listOpportunities(
  orgSlug: string,
): Promise<Loaded<OpportunityRow[]>> {
  return load(
    async (db) => {
      const orgId = await orgIdFor(orgSlug, "listOpportunities");

      const { data, error } = await db
        .from("opportunities")
        .select(
          `id, priority, priority_reason, status, first_seen_at,
           companies!inner(name, canonical_domain, industry,
             company_triggers(trigger_type, event_date, deleted_at)),
           opportunity_scores(score, explanation, confidence, computed_at,
             icp_fit, problem_severity, evidence_strength, trigger_strength,
             trigger_freshness, buying_likelihood, product_relevance,
             decision_maker_accessibility)`,
        )
        .eq("org_id", orgId)
        .is("deleted_at", null)
        .order("priority", { ascending: true })
        .order("first_seen_at", { ascending: false });

      if (error) throw new Error(`listOpportunities: ${error.message}`);

      const rows = (data ?? []) as unknown as ListQueryRow[];
      const kinds = await evidenceKindsFor(
        db,
        orgId,
        rows.map((r) => r.id),
      );

      return rows
        .map((r) => mapListRow(r, kinds.get(r.id) ?? []))
        .sort(byPriorityThenScore);
    },
    () => [...OPPORTUNITIES].map(toRow).sort(byPriorityThenScore),
  );
}

/**
 * Evidence kinds per opportunity, in one round trip.
 *
 * A second query rather than an embed, because `evidence.subject_id` is
 * polymorphic and carries no foreign key. Batched over the whole page rather
 * than issued per row, which is the N+1 this list would otherwise grow.
 */
async function evidenceKindsFor(
  db: TenantClient,
  orgId: string,
  opportunityIds: string[],
): Promise<Map<string, { kind: "fact" | "inference" | "unknown" }[]>> {
  const out = new Map<string, { kind: "fact" | "inference" | "unknown" }[]>();
  if (opportunityIds.length === 0) return out;

  const { data, error } = await db
    .from("evidence")
    .select("subject_id, kind")
    .eq("org_id", orgId)
    .eq("subject_type", "opportunity")
    .in("subject_id", opportunityIds)
    .is("deleted_at", null)
    .is("superseded_by", null);

  if (error) throw new Error(`listOpportunities evidence: ${error.message}`);

  for (const row of (data ?? []) as unknown as {
    subject_id: string;
    kind: "fact" | "inference" | "unknown";
  }[]) {
    const list = out.get(row.subject_id) ?? [];
    list.push({ kind: row.kind });
    out.set(row.subject_id, list);
  }
  return out;
}

/* ── The detail page ─────────────────────────────────────────────────────── */

export async function getOpportunity(
  orgSlug: string,
  id: string,
): Promise<Loaded<OpportunityDetail | undefined>> {
  return load(
    async (db) => {
      // Before the query, not after — see note 2 at the top of this file.
      if (!isUuid(id)) return undefined;

      const orgId = await orgIdFor(orgSlug, "getOpportunity");

      const { data, error } = await db
        .from("opportunities")
        .select(
          `id, priority, priority_reason, status, confidence, first_seen_at,
           owner_id, why_this_company, identified_problem, potential_gap,
           why_now, current_approach, potential_use_case, outreach_angle,
           companies!inner(name, canonical_domain, industry, region,
             employee_count, description,
             company_triggers(trigger_type, event_date, strength, deleted_at),
             people(first_name, last_name, title, is_decision_maker,
               linkedin_url, deleted_at,
               contact_points(kind, value, confidence, verification_status,
                 deleted_at))),
           opportunity_scores(score, explanation, confidence, computed_at,
             icp_fit, problem_severity, evidence_strength, trigger_strength,
             trigger_freshness, buying_likelihood, product_relevance,
             decision_maker_accessibility)`,
        )
        .eq("org_id", orgId)
        .eq("id", id)
        .is("deleted_at", null)
        .maybeSingle();

      if (error) throw new Error(`getOpportunity: ${error.message}`);
      if (!data) return undefined;

      const [evidence, viewerId] = await Promise.all([
        evidenceFor(db, orgId, id),
        currentUserId(db),
      ]);

      return mapDetail(data as unknown as DetailQueryRow, evidence, viewerId);
    },
    () => {
      const fixture = findOpportunity(id);
      return fixture && { ...fixture };
    },
  );
}

/** Full evidence for one opportunity, newest event first. */
async function evidenceFor(
  db: TenantClient,
  orgId: string,
  opportunityId: string,
): Promise<EvidenceItem[]> {
  const { data, error } = await db
    .from("evidence")
    .select("claim, kind, confidence, source_url, excerpt, event_date, observed_at")
    .eq("org_id", orgId)
    .eq("subject_type", "opportunity")
    .eq("subject_id", opportunityId)
    .is("deleted_at", null)
    // A superseded claim is history, not evidence. Showing both would present
    // a corrected fact and its correction as two independent findings.
    .is("superseded_by", null)
    .order("event_date", { ascending: false, nullsFirst: false });

  if (error) throw new Error(`getOpportunity evidence: ${error.message}`);
  return mapEvidence((data ?? []) as unknown as EvidenceQueryRow[]);
}

/**
 * The signed-in user's id, used only to label an owner as "You". See the note
 * beside `owner` in `opportunity-map.ts` for why nothing else is looked up.
 */
async function currentUserId(db: TenantClient): Promise<string | null> {
  const { data } = await db.auth.getUser();
  return data.user?.id ?? null;
}

/* ── Fixture → screen shape ──────────────────────────────────────────────── */

/** Kept explicit so a drift in either shape is a type error. */
function toRow(o: (typeof OPPORTUNITIES)[number]): OpportunityRow {
  return {
    id: o.id,
    company: o.company,
    domain: o.domain,
    priority: o.priority,
    priorityReason: o.priorityReason,
    score: o.score,
    scoreExplanation: o.scoreExplanation,
    confidence: o.confidence,
    dimensions: o.dimensions,
    status: o.status,
    trigger: o.trigger,
    triggerDate: o.triggerDate,
    evidence: o.evidence.map((e) => ({ kind: e.kind })),
    industry: o.industry,
  };
}
