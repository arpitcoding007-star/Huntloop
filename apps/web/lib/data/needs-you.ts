import "server-only";
import { cache } from "react";
import type { TenantClient } from "@huntloop/db";
import { DEFAULT_QUIET_AFTER_BUSINESS_DAYS, parseOrgProfile } from "@huntloop/db/org-profile";
import { OPPORTUNITIES, NOW as FIXTURE_NOW } from "../fixtures/opportunities";
import {
  gatherAttention,
  rank,
  type AttentionCandidate,
  type OwnershipFilter,
  type RankedItem,
} from "../needs-you/rank";
import { dailyGoal, oneLine, pickBuyer, type ContextPerson, type ItemContext } from "../needs-you/context";
import { weekStart } from "../performance/compute";
import { getOnboardingState } from "./onboarding";
import { currentUserId, requireOrgId } from "./org";
import { personalize } from "./personalization";
import { load, type Loaded } from "./source";

/**
 * "Needs you" — the candidates, gathered. COMMAND.md §16.3-B.
 *
 * This file asks the database what *might* need a person; `needs-you/rank.ts`
 * decides what does, in what order, and says why. Every query is bounded, and
 * each bound is a promise about cost on the screen most people open first:
 * this loader runs on every dashboard render.
 *
 * ── What it deliberately does not do ─────────────────────────────────────
 *
 *   · Suggest contacting anybody suppressed. A "gone quiet" item is about an
 *     opportunity, and the follow-up it suggests still goes through the send
 *     path's suppression check; nothing here can bypass it.
 *   · Chase what a sequence is already chasing. An active enrollment owns its
 *     follow-ups; a second nudge from here would have a person writing the
 *     email the engine is about to send.
 *   · Invent urgency. A quiet workspace returns an empty list, and the rail
 *     says "Nothing needs you right now", which is a good and true state.
 */

/** A ranked item, plus the opportunity's why-now and buyer when it has one. */
export type NeedsYouItem = RankedItem & { context?: ItemContext };

export interface NeedsYou {
  items: NeedsYouItem[];
  /** How many items exist before the viewer's filter and snoozes. */
  total: number;
  filter: OwnershipFilter;
  quietAfterBusinessDays: number;
  snoozedCount: number;
}

/**
 * The ownership filter a role starts with. An SDR or AE works their own
 * accounts (personalisation `defaultFilter = "assigned"`); everyone else
 * starts from the whole workspace. §14.2 recorded `defaultFilter` as computed
 * and never applied — this is where it is applied.
 */
export function defaultOwnership(defaultFilter: string): OwnershipFilter {
  return defaultFilter === "assigned" ? "mine" : "everyone";
}

/**
 * The queue as this person sees it by default, once per request.
 *
 * Shared by the sidebar count and the dashboard rail through `cache`, so the
 * two numbers come from one computation and cannot disagree.
 */
export const getDefaultNeedsYou = cache(async (orgSlug: string): Promise<Loaded<NeedsYou>> => {
  const onboarding = await getOnboardingState(orgSlug);
  const layout = personalize(onboarding?.role ?? null, onboarding?.goals ?? [], orgSlug);
  return getNeedsYou(orgSlug, defaultOwnership(layout.defaultFilter));
});

export async function getNeedsYou(
  orgSlug: string,
  filter: OwnershipFilter = "everyone",
): Promise<Loaded<NeedsYou>> {
  return load(
    async (db) => {
      const orgId = await requireOrgId(orgSlug, "getNeedsYou");
      const userId = await currentUserId(db);
      const now = new Date();
      const { candidates, quietAfter } = await gatherAttention(db, orgId, orgSlug, now);

      const { data: snoozeRows } = userId
        ? await db
            .from("attention_snoozes")
            .select("item_key")
            .eq("org_id", orgId)
            .eq("user_id", userId)
            .gt("snoozed_until", now.toISOString())
        : { data: [] };
      const snoozed = new Set((snoozeRows ?? []).map((r) => String(r.item_key)));

      const items = rank(candidates, {
        now,
        snoozed,
        filter,
        userId,
        quietAfterBusinessDays: quietAfter,
      });

      return {
        items: await withContext(db, orgId, items),
        total: candidates.length,
        filter,
        quietAfterBusinessDays: quietAfter,
        snoozedCount: candidates.filter((c) => snoozed.has(c.key)).length,
      };
    },
    () => demo(orgSlug, filter),
  );
}

/**
 * Items about an account you could reach out to, as opposed to a conversation
 * already under way (the thread is the context there) or the workspace.
 */
function wantsContext(item: RankedItem): boolean {
  return Boolean(item.opportunityId) && (item.group === "follow-ups" || item.group === "opportunities");
}

/** Context is read for the first this-many items; the rest render without it. */
const CONTEXT_LIMIT = 150;

/**
 * The why-now and the person to reach, for the items that are about reaching
 * someone. One bounded read by opportunity id, after ranking, so only items
 * that will be shown are looked up. It is decoration: if the read fails the
 * queue renders as before, because a queue that errors over a missing name is
 * worse than one without names.
 */
async function withContext(db: TenantClient, orgId: string, items: RankedItem[]): Promise<NeedsYouItem[]> {
  const ids = [...new Set(items.filter(wantsContext).map((i) => String(i.opportunityId)))].slice(0, CONTEXT_LIMIT);
  if (ids.length === 0) return items;

  const { data, error } = await db
    .from("opportunities")
    .select("id, why_now, companies(people(first_name, last_name, title, is_decision_maker, deleted_at))")
    .eq("org_id", orgId)
    .in("id", ids);
  if (error || !data) return items;

  const byId = new Map<string, ItemContext>();
  for (const row of data as unknown as {
    id: string;
    why_now: string | null;
    companies: { people: ContextPerson[] | null } | { people: ContextPerson[] | null }[] | null;
  }[]) {
    const company = Array.isArray(row.companies) ? row.companies[0] : row.companies;
    byId.set(String(row.id), { whyNow: oneLine(row.why_now), buyer: pickBuyer(company?.people ?? []) });
  }
  return items.map((i) => {
    const context = wantsContext(i) ? byId.get(String(i.opportunityId)) : undefined;
    return context ? { ...i, context } : i;
  });
}

/* ── Today's reach-outs ──────────────────────────────────────────────────── */

export interface ReachOutProgress {
  /** Outbound touches this person made today and this week (UTC days, Monday-first weeks). */
  today: number;
  week: number;
  /** The workspace's weekly goal per person (Performance → Your pace), and its daily share. */
  weeklyGoal: number | null;
  dailyGoal: number | null;
}

/** The same touch kinds Performance counts, so the two numbers agree. */
const TOUCH_KINDS = ["email_sent", "email_received", "message", "call", "meeting", "connection_request"];

/**
 * How many people this person has reached today, against the workspace goal.
 *
 * Counted exactly as Performance's "Your pace" counts it — outbound touches
 * whose actor is this person, from the activity ledger — so the daily figure
 * and the weekly one can never disagree. Days and weeks are UTC, which is also
 * Performance's boundary; a workspace-local day would make the two drift.
 */
export async function getReachOutProgress(orgSlug: string): Promise<Loaded<ReachOutProgress>> {
  return load(
    async (db) => {
      const orgId = await requireOrgId(orgSlug, "getReachOutProgress");
      const userId = await currentUserId(db);
      const now = new Date();
      const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      const week = weekStart(now);

      const count = (from: Date) =>
        userId
          ? db
              .from("activities")
              .select("id", { count: "exact", head: true })
              .eq("org_id", orgId)
              .eq("actor_id", userId)
              .eq("direction", "outbound")
              .in("kind", TOUCH_KINDS)
              .gte("occurred_at", from.toISOString())
              .is("deleted_at", null)
          : Promise.resolve({ count: 0 });

      const [today, thisWeek, org] = await Promise.all([
        count(day),
        count(week),
        db.from("organizations").select("settings").eq("id", orgId).maybeSingle(),
      ]);
      const weeklyGoal = parseOrgProfile((org.data as { settings?: unknown } | null)?.settings).goals.touchesPerWeek;
      return {
        today: Number(today.count ?? 0),
        week: Number(thisWeek.count ?? 0),
        weeklyGoal,
        dailyGoal: dailyGoal(weeklyGoal),
      };
    },
    /* The fixtures have no touches, so the honest demo is zero against no goal. */
    () => ({ today: 0, week: 0, weeklyGoal: null, dailyGoal: null }),
  );
}



/**
 * Demo: built from the same fixtures as the inbox and the opportunity list,
 * ranked by the same function, at the fixtures' own "now" — so the rail, the
 * inbox and the opportunity pages tell one story. The reply and its draft are
 * the inbox's demo thread; the HOT item is the fixture whose recommendation
 * reads "reach out now".
 */
function demo(orgSlug: string, filter: OwnershipFilter): NeedsYou {
  const thread = "The policy layer your agents are missing";
  const candidates: AttentionCandidate[] = [
    {
      kind: "reply",
      key: "reply:demo-thread-1",
      title: thread,
      href: `/${orgSlug}/inbox#thread-demo-thread-1`,
      at: "2026-08-10T14:05:00Z",
      classification: "positive",
      channel: "email",
    },
    {
      kind: "approval",
      key: "approval:demo-message-3",
      title: thread,
      href: `/${orgSlug}/inbox#thread-demo-thread-1`,
      at: "2026-08-10T15:40:00Z",
    },
  ];
  for (const o of OPPORTUNITIES) {
    if (o.priority !== "hot" || !o.triggerDate) continue;
    candidates.push({
      kind: "hot-untouched",
      key: `hot-untouched:${o.id}`,
      title: o.company,
      href: `/${orgSlug}/opportunities/${o.id}`,
      opportunityId: o.id,
      priority: o.priority,
      score: o.score,
      stage: o.status.toLowerCase(),
      at: o.triggerDate,
      detail: o.trigger.toLowerCase(),
    });
  }
  const items = rank(candidates, {
    now: FIXTURE_NOW,
    snoozed: new Set(),
    filter,
    userId: null,
    quietAfterBusinessDays: DEFAULT_QUIET_AFTER_BUSINESS_DAYS,
  });
  return {
    items: items.map((i) => {
      const o = wantsContext(i) ? OPPORTUNITIES.find((f) => f.id === i.opportunityId) : undefined;
      if (!o) return i;
      const buyer = o.buyers.find((b) => b.isDecisionMaker) ?? o.buyers[0];
      return {
        ...i,
        context: { whyNow: oneLine(o.whyNow), buyer: buyer ? { name: buyer.name, title: buyer.title || null } : null },
      };
    }),
    total: candidates.length,
    filter,
    quietAfterBusinessDays: DEFAULT_QUIET_AFTER_BUSINESS_DAYS,
    snoozedCount: 0,
  };
}
