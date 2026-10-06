import "server-only";
import { cache } from "react";
import type { TenantClient } from "@huntloop/db";
import { parseOrgProfile, DEFAULT_QUIET_AFTER_BUSINESS_DAYS } from "@huntloop/db/org-profile";
import { OPPORTUNITIES, NOW as FIXTURE_NOW } from "../fixtures/opportunities";
import {
  isQuiet,
  rank,
  type AttentionCandidate,
  type OwnershipFilter,
  type Priority,
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

/** Stages where the conversation is live. */
const ACTIVE_STAGES = ["assigned", "contacted", "replied", "meeting", "proposal"];
/** Stages nobody has worked yet. */
const UNTOUCHED_STAGES = ["discovered", "researching", "qualified", "assigned"];
/** The kinds that count as a touch, on any channel. */
const TOUCH_KINDS = ["email_sent", "email_received", "message", "call", "meeting", "connection_request"];

const BOUND = {
  threads: 200,
  drafts: 50,
  opportunities: 500,
  touches: 2000,
  enrollments: 1000,
} as const;

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
      const { candidates, quietAfter } = await gather(db, orgId, orgSlug, now);

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

/* eslint-disable @typescript-eslint/no-explicit-any --
   Nested PostgREST selects have no generated row types in this repo (DB-03).
   Confined to the gathering below, which maps everything to typed candidates. */

async function gather(
  db: TenantClient,
  orgId: string,
  orgSlug: string,
  now: Date,
): Promise<{ candidates: AttentionCandidate[]; quietAfter: number }> {
  const since = new Date(now.getTime() - 120 * 24 * 3600_000).toISOString();
  const staleBefore = new Date(now.getTime() - 90 * 24 * 3600_000).toISOString();

  const [org, threads, drafts, opps, touches, enrollments, findings, failing, stale, backlog] =
    await Promise.all([
      db.from("organizations").select("settings").eq("id", orgId).maybeSingle(),
      db
        .from("threads")
        .select(
          `id, subject, classification, opportunity_id, last_message_at,
           messages(direction, created_at, deleted_at),
           opportunities(id, priority, status, owner_id, companies(name))`,
        )
        .eq("org_id", orgId)
        .eq("status", "open")
        .is("deleted_at", null)
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(BOUND.threads),
      db
        .from("messages")
        .select(
          `id, created_at, to_email, opportunity_id,
           opportunities(id, priority, status, owner_id, companies(name)),
           enrollments(opportunity_id, opportunities(id, priority, status, owner_id, companies(name)))`,
        )
        .eq("org_id", orgId)
        .eq("direction", "outbound")
        .is("sent_at", null)
        .is("scheduled_at", null)
        .is("deleted_at", null)
        .order("created_at", { ascending: true })
        .limit(BOUND.drafts),
      db
        .from("opportunities")
        .select(
          `id, priority, status, owner_id, first_seen_at, next_step, next_step_due_at,
           companies!inner(name, company_triggers(trigger_type, event_date, deleted_at))`,
        )
        .eq("org_id", orgId)
        .is("deleted_at", null)
        .not("status", "in", "(won,lost,archived)")
        .order("updated_at", { ascending: false })
        .limit(BOUND.opportunities),
      db
        .from("activities")
        .select("opportunity_id, kind, channel, direction, occurred_at")
        .eq("org_id", orgId)
        .in("kind", TOUCH_KINDS)
        .gte("occurred_at", since)
        .is("deleted_at", null)
        .not("opportunity_id", "is", null)
        .order("occurred_at", { ascending: false })
        .limit(BOUND.touches),
      db
        .from("enrollments")
        .select("opportunity_id")
        .eq("org_id", orgId)
        .eq("status", "active")
        .is("deleted_at", null)
        .limit(BOUND.enrollments),
      db
        .from("learning_findings")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId)
        .eq("status", "pending"),
      db
        .from("sources")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId)
        .not("last_error", "is", null)
        .eq("is_enabled", true)
        .is("deleted_at", null),
      db
        .from("opportunities")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId)
        .lt("last_scored_at", staleBefore)
        .is("deleted_at", null),
      db.rpc("backlog_state_for_org", { p_org: orgId }),
    ]);

  const quietAfter =
    parseOrgProfile((org.data as any)?.settings).followup.quietAfterBusinessDays ??
    DEFAULT_QUIET_AFTER_BUSINESS_DAYS;

  const candidates: AttentionCandidate[] = [];
  const opportunityHref = (id: string) => `/${orgSlug}/opportunities/${id}`;

  /* ── Conversations waiting on us (email) ──────────────────────────────── */
  for (const t of (threads.data ?? []) as any[]) {
    const messages = (Array.isArray(t.messages) ? t.messages : [])
      .filter((m: any) => !m.deleted_at)
      .sort((a: any, b: any) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")));
    const last = messages[messages.length - 1];
    if (last?.direction !== "inbound") continue;
    const opp = one(t.opportunities);
    candidates.push({
      kind: "reply",
      key: `reply:${t.id}`,
      title: opp?.companies?.name ?? t.subject ?? "A conversation",
      /* To the thread, not the opportunity: answering happens in the inbox, and
         the thread links back to the account for the context. */
      href: `/${orgSlug}/inbox#thread-${t.id}`,
      opportunityId: opp ? String(opp.id) : null,
      ownerId: opp?.owner_id ?? null,
      priority: priorityOf(opp?.priority),
      stage: opp?.status ?? null,
      at: last.created_at ?? t.last_message_at ?? null,
      classification: t.classification ?? null,
      channel: "email",
    });
  }

  /* ── Drafts waiting for a person ──────────────────────────────────────── */
  for (const m of (drafts.data ?? []) as any[]) {
    const enrollment = one(m.enrollments);
    const opp = one(m.opportunities) ?? one(enrollment?.opportunities);
    candidates.push({
      kind: "approval",
      key: `approval:${m.id}`,
      title: opp?.companies?.name ?? m.to_email ?? "A draft",
      href: `/${orgSlug}/inbox#draft-${m.id}`,
      opportunityId: opp ? String(opp.id) : null,
      ownerId: opp?.owner_id ?? null,
      priority: priorityOf(opp?.priority),
      stage: opp?.status ?? null,
      at: m.created_at ?? null,
    });
  }

  /* ── Touches: latest per opportunity ──────────────────────────────────── */
  const latestTouch = new Map<string, { direction: string; channel: string; at: string; kind: string }>();
  for (const a of (touches.data ?? []) as any[]) {
    const id = String(a.opportunity_id);
    if (!latestTouch.has(id)) {
      latestTouch.set(id, {
        direction: String(a.direction),
        channel: String(a.channel),
        at: String(a.occurred_at),
        kind: String(a.kind),
      });
    }
  }
  const sequenced = new Set(((enrollments.data ?? []) as any[]).map((e) => String(e.opportunity_id)));

  /* ── Per-opportunity follow-ups ───────────────────────────────────────── */
  const endOfToday = new Date(now);
  endOfToday.setUTCHours(23, 59, 59, 999);

  for (const o of (opps.data ?? []) as any[]) {
    const id = String(o.id);
    const base = {
      title: String(o.companies?.name ?? "An opportunity"),
      href: opportunityHref(id),
      opportunityId: id,
      ownerId: o.owner_id ?? null,
      priority: priorityOf(o.priority),
      stage: String(o.status ?? ""),
    };
    const touch = latestTouch.get(id);
    const dueAt = o.next_step_due_at ? String(o.next_step_due_at) : null;
    const futureStep = Boolean(o.next_step) && (!dueAt || Date.parse(dueAt) > endOfToday.getTime());

    if (o.next_step && dueAt && Date.parse(dueAt) <= endOfToday.getTime()) {
      candidates.push({ ...base, kind: "next-step", key: `next-step:${id}`, at: dueAt, nextStep: String(o.next_step) });
    }

    // A reply on a channel Huntloop cannot read: the person logged it, and it
    // is waiting on them. Email replies are covered by the thread rule above.
    if (touch && touch.direction === "inbound" && touch.channel !== "email" && !futureStep) {
      candidates.push({ ...base, kind: "reply", key: `reply-manual:${id}`, at: touch.at, channel: touch.channel });
    }

    if (
      touch &&
      touch.direction === "outbound" &&
      ACTIVE_STAGES.includes(base.stage) &&
      !sequenced.has(id) &&
      !futureStep &&
      isQuiet(touch.at, now, quietAfter)
    ) {
      candidates.push({ ...base, kind: "quiet", key: `quiet:${id}`, at: touch.at, channel: touch.channel });
    }

    if ((base.stage === "meeting" || base.stage === "proposal") && !o.next_step) {
      candidates.push({ ...base, kind: "late-stage", key: `late-stage:${id}` });
    }

    if (base.priority === "hot" && UNTOUCHED_STAGES.includes(base.stage) && !touch && !sequenced.has(id)) {
      const trigger = (Array.isArray(o.companies?.company_triggers) ? o.companies.company_triggers : [])
        .filter((t: any) => !t.deleted_at)
        .sort((a: any, b: any) => String(b.event_date ?? "").localeCompare(String(a.event_date ?? "")))[0];
      const firstSeen = Date.parse(String(o.first_seen_at ?? ""));
      const fresh =
        (trigger && Date.parse(String(trigger.event_date)) > now.getTime() - 30 * 24 * 3600_000) ||
        (Number.isFinite(firstSeen) && firstSeen > now.getTime() - 14 * 24 * 3600_000);
      if (fresh) {
        candidates.push({
          ...base,
          kind: "hot-untouched",
          key: `hot-untouched:${id}`,
          at: trigger?.event_date ?? o.first_seen_at ?? null,
          detail: trigger?.trigger_type ? String(trigger.trigger_type).replace(/_/g, " ") : null,
        });
      }
    }
  }

  /* ── Workspace ────────────────────────────────────────────────────────── */
  const learning = Number(findings.count ?? 0);
  if (learning > 0) {
    candidates.push({ kind: "learning", key: "learning:pending", title: "What we've learned", href: `/${orgSlug}/learn`, count: learning });
  }
  const state = Array.isArray(backlog.data) ? backlog.data[0] : backlog.data;
  if (state?.saturated) {
    candidates.push({
      kind: "discovery-paused",
      key: "discovery-paused:backlog",
      title: "Discovery is paused",
      href: `/${orgSlug}/opportunities`,
      count: Number(state.open_count ?? 0),
    });
  }
  const failingCount = Number(failing.count ?? 0);
  if (failingCount > 0) {
    candidates.push({ kind: "failing-sources", key: "failing-sources:all", title: "Sources", href: `/${orgSlug}/sources`, count: failingCount });
  }
  const staleCount = Number(stale.count ?? 0);
  if (staleCount > 0) {
    candidates.push({ kind: "stale-scores", key: "stale-scores:all", title: "Old scores", href: `/${orgSlug}/opportunities`, count: staleCount });
  }

  return { candidates, quietAfter };
}

function one(value: any): any {
  return Array.isArray(value) ? value[0] : value;
}

function priorityOf(value: unknown): Priority | null {
  return value === "hot" || value === "warm" || value === "watch" || value === "ignore" ? value : null;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

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
