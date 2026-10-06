import "server-only";

import { parseOrgProfile, type OrgGoals } from "@huntloop/db/org-profile";
import { OPPORTUNITIES, NOW as FIXTURE_NOW } from "../fixtures/opportunities";
import {
  computePerformance,
  goalProgress,
  windowsFor,
  type GoalProgress,
  type Performance,
  type Period,
  type PerfOpportunity,
  type PerfOutcome,
  type PerfTouch,
  type Priority,
} from "../performance/compute";
import { currentUserId, requireOrgId } from "./org";
import { load, type Loaded } from "./source";
import { loadProfiles } from "./team";

/**
 * The rows behind the Performance screen. `performance/compute.ts` decides
 * what they mean.
 *
 * ── Bounds, and saying so ────────────────────────────────────────────────
 *
 * Each read is paginated up to a ceiling. A workspace past a ceiling gets a
 * correct answer about the rows that were read and a sentence saying the
 * figures are partial — never a silently truncated number presented as the
 * whole. The ceilings are far above what one team generates in a quarter.
 *
 * ── Why touches reach back further than the window ───────────────────────
 *
 * "First contacted in this period" needs to know a company was not contacted
 * before it. Touches are read from 180 days before the previous window, and a
 * first touch older than that is treated as before the window — a deliberate
 * approximation, stated here rather than discovered later.
 */

export interface PerformanceData {
  performance: Performance;
  period: Period;
  goals: OrgGoals;
  progress: GoalProgress;
  /** Set when any read hit its ceiling. */
  partial: string | null;
}

const PAGE = 1000;
const CEILING = { opportunities: 10_000, touches: 20_000, outcomes: 10_000, spend: 20_000 } as const;
const LOOKBACK_MS = 180 * 24 * 3600_000;
const TOUCH_KINDS = ["email_sent", "email_received", "message", "call", "meeting", "connection_request"];

/* eslint-disable @typescript-eslint/no-explicit-any -- paged rows, no generated types (DB-03) */
async function paged(
  query: (from: number, to: number) => PromiseLike<{ data: any[] | null; error: { message: string } | null }>,
  ceiling: number,
  what: string,
): Promise<{ rows: any[]; capped: boolean }> {
  const rows: any[] = [];
  for (let from = 0; from < ceiling; from += PAGE) {
    const { data, error } = await query(from, Math.min(from + PAGE, ceiling) - 1);
    if (error) throw new Error(`getPerformance ${what}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return { rows, capped: false };
  }
  return { rows, capped: true };
}

export async function getPerformance(orgSlug: string, period: Period): Promise<Loaded<PerformanceData>> {
  return load(
    async (db) => {
      const orgId = await requireOrgId(orgSlug, "getPerformance");
      const now = new Date();
      const { window, previous } = windowsFor(period, now);
      const since = new Date(previous.from.getTime() - LOOKBACK_MS).toISOString();
      const spendSince = previous.from.toISOString();

      const [opps, touches, outcomes, runs, calls, org, competitors, userId] = await Promise.all([
        paged(
          (a, b) =>
            db
              .from("opportunities")
              .select(
                "id, first_seen_at, priority, status, owner_id, discovered_via, companies(name, company_triggers(trigger_type, event_date, deleted_at))",
              )
              .eq("org_id", orgId)
              .is("deleted_at", null)
              .order("first_seen_at", { ascending: false })
              .range(a, b),
          CEILING.opportunities,
          "opportunities",
        ),
        paged(
          (a, b) =>
            db
              .from("activities")
              .select("opportunity_id, kind, channel, direction, occurred_at, actor_id")
              .eq("org_id", orgId)
              .in("kind", TOUCH_KINDS)
              .neq("direction", "internal")
              .gte("occurred_at", since)
              .is("deleted_at", null)
              .not("opportunity_id", "is", null)
              .order("occurred_at", { ascending: false })
              .range(a, b),
          CEILING.touches,
          "touches",
        ),
        paged(
          (a, b) =>
            db
              .from("outcomes")
              .select("opportunity_id, kind, occurred_at, reason_category, competitor_id")
              .eq("org_id", orgId)
              .gte("occurred_at", since)
              .order("occurred_at", { ascending: false })
              .range(a, b),
          CEILING.outcomes,
          "outcomes",
        ),
        paged(
          (a, b) =>
            db
              .from("ai_runs")
              .select("cost_cents, created_at")
              .eq("org_id", orgId)
              .gte("created_at", spendSince)
              .range(a, b),
          CEILING.spend,
          "ai spend",
        ),
        paged(
          (a, b) =>
            db
              .from("provider_calls")
              .select("credits, created_at")
              .eq("org_id", orgId)
              .gte("created_at", spendSince)
              .range(a, b),
          CEILING.spend,
          "provider spend",
        ),
        db.from("organizations").select("settings").eq("id", orgId).maybeSingle(),
        db.from("competitors").select("id, name").eq("org_id", orgId).limit(500),
        currentUserId(db),
      ]);

      const opportunities: PerfOpportunity[] = opps.rows.map((r) => {
        const companies = Array.isArray(r.companies) ? r.companies[0] : r.companies;
        const trigger = (Array.isArray(companies?.company_triggers) ? companies.company_triggers : [])
          .filter((t: any) => !t.deleted_at)
          .sort((a: any, b: any) => String(b.event_date ?? "").localeCompare(String(a.event_date ?? "")))[0];
        return {
          id: String(r.id),
          company: String(companies?.name ?? "A company"),
          firstSeenAt: String(r.first_seen_at),
          priority: r.priority as Priority,
          status: String(r.status),
          ownerId: r.owner_id ?? null,
          via: r.discovered_via ?? null,
          triggerType: trigger?.trigger_type ?? null,
        };
      });
      const touchRows: PerfTouch[] = touches.rows.map((r) => ({
        opportunityId: String(r.opportunity_id),
        kind: String(r.kind),
        channel: String(r.channel),
        direction: r.direction === "inbound" ? "inbound" : "outbound",
        occurredAt: String(r.occurred_at),
        actorId: r.actor_id ?? null,
      }));
      const outcomeRows: PerfOutcome[] = outcomes.rows.map((r) => ({
        opportunityId: r.opportunity_id ?? null,
        kind: String(r.kind),
        occurredAt: String(r.occurred_at),
        reasonCategory: r.reason_category ?? null,
        competitorId: r.competitor_id ?? null,
      }));

      const inWindow = (iso: string, w: { from: Date; to: Date }) => {
        const t = Date.parse(iso);
        return t >= w.from.getTime() && t < w.to.getTime();
      };
      const sumCents = (w: { from: Date; to: Date }) =>
        runs.rows.filter((r) => inWindow(String(r.created_at), w)).reduce((s, r) => s + Number(r.cost_cents ?? 0), 0);
      const sumCredits = (w: { from: Date; to: Date }) =>
        calls.rows.filter((r) => inWindow(String(r.created_at), w)).reduce((s, r) => s + Number(r.credits ?? 0), 0);

      const ownerIds = [...new Set(opportunities.map((o) => o.ownerId).filter((v): v is string => Boolean(v)))];
      const profiles = await loadProfiles(db, ownerIds);
      const ownerNames = new Map(
        ownerIds.map((id) => [id, id === userId ? "You" : (profiles.get(id)?.name ?? profiles.get(id)?.email ?? "A teammate")]),
      );
      const competitorNames = new Map(((competitors.data ?? []) as any[]).map((c) => [String(c.id), String(c.name)]));

      const performance = computePerformance({
        opportunities,
        touches: touchRows,
        outcomes: outcomeRows,
        window,
        previous,
        spend: {
          current: { aiCents: sumCents(window), providerCredits: sumCredits(window) },
          previous: { aiCents: sumCents(previous), providerCredits: sumCredits(previous) },
        },
        ownerNames,
        competitorNames,
        now,
      });

      const capped = [
        opps.capped && "opportunities",
        touches.capped && "activities",
        outcomes.capped && "outcomes",
        (runs.capped || calls.capped) && "spend records",
      ].filter(Boolean);

      return {
        performance,
        period,
        goals: parseOrgProfile((org.data as any)?.settings).goals,
        progress: goalProgress({ touches: touchRows, outcomes: outcomeRows, opportunities }, userId, now),
        partial: capped.length
          ? `Figures are based on the most recent ${capped.join(", ")} only — this workspace has more than one screen reads at once.`
          : null,
      };
    },
    () => demo(period),
  );
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Demo: the fixtures have no touches or outcomes, so the honest demo is a
 * mostly empty screen that explains what it will show — computed by the same
 * function, so the "not enough data" state is the real one.
 */
function demo(period: Period): PerformanceData {
  const { window, previous } = windowsFor(period, FIXTURE_NOW);
  const opportunities: PerfOpportunity[] = OPPORTUNITIES.map((o) => ({
    id: o.id,
    company: o.company,
    firstSeenAt: o.triggerDate ? new Date(Date.parse(o.triggerDate) + 24 * 3600_000).toISOString() : FIXTURE_NOW.toISOString(),
    priority: o.priority,
    status: o.status.toLowerCase(),
    ownerId: null,
    via: "scan",
    triggerType: null,
  }));
  return {
    performance: computePerformance({
      opportunities,
      touches: [],
      outcomes: [],
      window,
      previous,
      spend: { current: { aiCents: 0, providerCredits: 0 }, previous: { aiCents: 0, providerCredits: 0 } },
      ownerNames: new Map(),
      competitorNames: new Map(),
      now: FIXTURE_NOW,
    }),
    period,
    goals: { touchesPerWeek: null, meetingsPerMonth: null },
    progress: { touchesThisWeek: 0, meetingsThisMonth: 0, weekElapsed: 0.5, monthElapsed: 0.5 },
    partial: null,
  };
}


