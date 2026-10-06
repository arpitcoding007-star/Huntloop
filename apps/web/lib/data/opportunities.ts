import type { TenantClient } from "@huntloop/db";
import type { EvidenceItem } from "@huntloop/ui";
import { DEFAULT_QUIET_AFTER_BUSINESS_DAYS, parseOrgProfile } from "@huntloop/db/org-profile";
import { NOW as FIXTURE_NOW, OPPORTUNITIES, findOpportunity } from "../fixtures/opportunities";
import { nextAction } from "../needs-you/next-action";
import { currentViewer } from "./membership";
import { currentUserId } from "./org";
import { load, type Loaded } from "./source";
import {
  byPriorityThenScore,
  isUuid,
  mapDetail,
  mapEvidence,
  mapListRow,
  type ContactFit,
  type DetailContext,
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

/**
 * PERF-002. The list read every opportunity with every trigger and score, and
 * past PostgREST's row cap it was cut off silently. Bounded, in priority
 * order so what is cut is the least worth reading, and the page says so when
 * the bound is reached.
 */
export const LIST_LIMIT = 500;

/** Ids per evidence query, so the request URL stays well inside gateway limits. */
const EVIDENCE_BATCH = 150;

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
        .order("first_seen_at", { ascending: false })
        .limit(LIST_LIMIT);

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

  const data: unknown[] = [];
  for (let i = 0; i < opportunityIds.length; i += EVIDENCE_BATCH) {
    const { data: page, error } = await db
      .from("evidence")
      .select("subject_id, kind")
      .eq("org_id", orgId)
      .eq("subject_type", "opportunity")
      .in("subject_id", opportunityIds.slice(i, i + EVIDENCE_BATCH))
      .is("deleted_at", null)
      .is("superseded_by", null);

    if (error) throw new Error(`listOpportunities evidence: ${error.message}`);
    data.push(...(page ?? []));
  }

  for (const row of data as unknown as {
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
          `id, company_id, priority, priority_reason, status, confidence, first_seen_at,
           owner_id, why_this_company, identified_problem, potential_gap,
           why_now, current_approach, potential_use_case, outreach_angle,
           next_step, next_step_due_at,
           companies!inner(name, canonical_domain, industry, region,
             employee_count, description,
             company_triggers(trigger_type, event_date, strength, deleted_at),
             people(id, first_name, last_name, title, is_decision_maker,
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

      const row = data as unknown as DetailQueryRow;
      const personIds = (row.companies?.people ?? [])
        .filter((p) => p.deleted_at === null)
        .map((p) => p.id);

      const [evidence, viewerId, fit, context] = await Promise.all([
        evidenceFor(db, orgId, id, (data as { company_id: string }).company_id),
        currentUserId(db),
        contactFitFor(db, orgId, personIds),
        detailContext(db, orgId, id),
      ]);

      return mapDetail(row, evidence, viewerId, fit, context);
    },
    () => {
      const fixture = findOpportunity(id);
      if (!fixture) return undefined;
      /* `ownerId` is null on every fixture, and stays a real null rather than
         an invented uuid: the demo owner label reads "You", which is a
         rendering choice, not a claim that a particular account owns it.
         The next action is computed by the same rule as live data, at the
         fixtures' own instant, so the demo shows what the rule really says. */
      const stage = fixture.status.toLowerCase();
      const action = nextAction({
        priority: fixture.priority,
        status: stage,
        hasBuyer: fixture.buyers.length > 0,
        hasTrigger: fixture.triggerDate !== null,
        nextStep: null,
        lastTouch: null,
        replyClassification: null,
        sequenceActive: false,
        now: FIXTURE_NOW,
        quietAfterBusinessDays: DEFAULT_QUIET_AFTER_BUSINESS_DAYS,
      });
      return {
        ...fixture,
        ownerId: null,
        stage,
        nextStep: null,
        nextAction: action,
        recommendedAction: action.text,
        buyers: fixture.buyers.map((b, i) => ({ ...b, id: `${fixture.id}-buyer-${i}` })),
      };
    },
  );
}

/**
 * What the next-action rule needs beyond the opportunity row (0037).
 *
 * Four small reads, each bounded to one row or one count, and each allowed to
 * come back empty: a missing piece of context makes the recommendation fall
 * back to the verdict-only rule, which is still true — it never makes the page
 * fail.
 */
async function detailContext(db: TenantClient, orgId: string, opportunityId: string): Promise<DetailContext> {
  const [touch, thread, enrolled, org] = await Promise.all([
    db
      .from("activities")
      .select("direction, channel, occurred_at")
      .eq("org_id", orgId)
      .eq("opportunity_id", opportunityId)
      .in("kind", ["email_sent", "email_received", "message", "call", "meeting", "connection_request"])
      .neq("direction", "internal")
      .is("deleted_at", null)
      .order("occurred_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from("threads")
      .select("classification")
      .eq("org_id", orgId)
      .eq("opportunity_id", opportunityId)
      .not("classification", "is", null)
      .is("deleted_at", null)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle(),
    db
      .from("enrollments")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("opportunity_id", opportunityId)
      .eq("status", "active")
      .is("deleted_at", null),
    db.from("organizations").select("settings").eq("id", orgId).maybeSingle(),
  ]);

  const t = touch.data as { direction: string; channel: string; occurred_at: string } | null;
  return {
    lastTouch:
      t && (t.direction === "inbound" || t.direction === "outbound")
        ? { direction: t.direction, channel: t.channel, at: t.occurred_at }
        : null,
    replyClassification: (thread.data as { classification: string | null } | null)?.classification ?? null,
    sequenceActive: Number(enrolled.count ?? 0) > 0,
    quietAfterBusinessDays:
      parseOrgProfile((org.data as { settings?: unknown } | null)?.settings).followup
        .quietAfterBusinessDays ?? DEFAULT_QUIET_AFTER_BUSINESS_DAYS,
    now: new Date(),
  };
}

/**
 * The latest contact-fit score per person, for ordering the buyer list.
 *
 * ── Why a second query rather than an embed ──────────────────────────────
 *
 * `contact_fit_scores` could be nested under `people(...)` in the query
 * above. It is not, for one reason: that query is the opportunity detail
 * page, and a mistake in a nested embed does not degrade it — it throws,
 * and the whole page becomes an error boundary. A separate read that comes
 * back empty costs the ordering and nothing else, which is the failure this
 * feature deserves. `evidenceFor` is beside it for the same reason.
 *
 * Append-only, so "latest" is a sort rather than a flag — the same shape
 * `latestScore` applies to `opportunity_scores`.
 */
async function contactFitFor(
  db: TenantClient,
  orgId: string,
  personIds: string[],
): Promise<ContactFit> {
  const fit: ContactFit = new Map();
  if (personIds.length === 0) return fit;

  const { data, error } = await db
    .from("contact_fit_scores")
    .select("person_id, score, explanation, computed_at")
    .eq("org_id", orgId)
    .in("person_id", personIds)
    .order("computed_at", { ascending: false });

  /* Not thrown. An org whose ranker has never run, and a deployment whose
     `0016` has not been applied, both land here — and neither is a reason to
     refuse to show an opportunity. */
  if (error || !data) return fit;

  for (const row of data as { person_id: string; score: number; explanation: string | null }[]) {
    // First wins: the order above is newest-first.
    if (!fit.has(row.person_id)) {
      fit.set(row.person_id, { score: row.score, explanation: row.explanation });
    }
  }
  return fit;
}

/**
 * Full evidence for one opportunity, newest event first.
 *
 * TRUST-002. Both subjects: the opportunity's own claims (the qualifier's)
 * and the company's — enrichment, hiring signals, research findings, scanned
 * news with its excerpt. The scorer reasons over the company's; showing only
 * the opportunity's made "every claim above traces to one of these" untrue
 * of the evidence the verdict was actually built from.
 */
async function evidenceFor(
  db: TenantClient,
  orgId: string,
  opportunityId: string,
  companyId: string,
): Promise<EvidenceItem[]> {
  const { data, error } = await db
    .from("evidence")
    .select("claim, kind, confidence, source_url, excerpt, event_date, observed_at, reliability")
    .eq("org_id", orgId)
    .or(
      `and(subject_type.eq.opportunity,subject_id.eq.${opportunityId}),` +
        `and(subject_type.eq.company,subject_id.eq.${companyId})`,
    )
    .is("deleted_at", null)
    // A superseded claim is history, not evidence. Showing both would present
    // a corrected fact and its correction as two independent findings.
    .is("superseded_by", null)
    .order("event_date", { ascending: false, nullsFirst: false });

  if (error) throw new Error(`getOpportunity evidence: ${error.message}`);
  return mapEvidence((data ?? []) as unknown as EvidenceQueryRow[]);
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
