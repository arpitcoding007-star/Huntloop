import "server-only";
import { cache } from "react";
import { DEFAULT_QUIET_AFTER_BUSINESS_DAYS } from "@huntloop/db/org-profile";
import { OPPORTUNITIES, NOW as FIXTURE_NOW } from "../fixtures/opportunities";
import {
  gatherAttention,
  rank,
  type AttentionCandidate,
  type OwnershipFilter,
  type RankedItem,
} from "../needs-you/rank";
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

export interface NeedsYou {
  items: RankedItem[];
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
        items,
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
    items,
    total: candidates.length,
    filter,
    quietAfterBusinessDays: DEFAULT_QUIET_AFTER_BUSINESS_DAYS,
    snoozedCount: 0,
  };
}
