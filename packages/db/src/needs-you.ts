/**
 * "Needs you" — what a person should do next, ranked and explained.
 *
 * COMMAND.md §16.3-B. The rail used to be four counts that linked to list
 * pages; this turns it into individual items, each of which says what it is,
 * why it is here, and what to do about it.
 *
 * ── Why this file is pure ────────────────────────────────────────────────
 *
 * The ranking is the product's claim about what matters today. A claim like
 * that has to be checkable, so it is a function of its inputs and nothing else
 * — no clock it reads for itself, no database, no model. `lib/data/needs-you.ts`
 * gathers the candidates; this decides their order and writes their reasons.
 * Every rule below has a test in `rank.test.ts`.
 *
 * ── Why no model ranks anything ──────────────────────────────────────────
 *
 * Because every input is a fact the user can see — a reply arrived, a date
 * passed, a priority was set — and a deterministic rule over facts can explain
 * itself in a sentence. A model ranking the same facts would cost money on the
 * most-visited screen and could not say why one item outranks another.
 */

import { DEFAULT_QUIET_AFTER_BUSINESS_DAYS, parseOrgProfile } from "./org-profile.ts";

export type AttentionKind =
  | "reply"
  | "approval"
  | "next-step"
  | "quiet"
  | "hot-untouched"
  | "late-stage"
  | "learning"
  | "discovery-paused"
  | "failing-sources"
  | "stale-scores"
  /* 0042: a theme a deal asked for has shipped — worth going back to them. */
  | "demand-shipped";

export type AttentionGroup = "conversations" | "follow-ups" | "opportunities" | "workspace";

export type Priority = "hot" | "warm" | "watch" | "ignore";

/** One thing that might need a person, as the loader found it. */
export interface AttentionCandidate {
  kind: AttentionKind;
  /** Stable id for this item, `<kind>:<id>`. Used for snoozing. */
  key: string;
  /** The company, or the workspace-level subject. */
  title: string;
  href: string;
  opportunityId?: string | null;
  ownerId?: string | null;
  priority?: Priority | null;
  score?: number | null;
  stage?: string | null;
  /**
   * The instant this item is about: when the reply arrived, when the next step
   * was due, when the last touch happened, when the trigger fired.
   */
  at?: string | null;
  /** Workspace items carry a count rather than a subject. */
  count?: number;
  /** Reply classification from `classify_reply`, when there is one. */
  classification?: string | null;
  /** The channel a manual reply or touch happened on. */
  channel?: string | null;
  /** What the person wrote as their next step. */
  nextStep?: string | null;
  /** A short fact the reason can quote — e.g. the trigger type. */
  detail?: string | null;
}

export interface RankedItem extends AttentionCandidate {
  group: AttentionGroup;
  /** Higher first. Exposed for tests and for "why is this first?" debugging. */
  score_: number;
  /** One sentence naming the inputs that put this item here. */
  why: string;
  /** What the primary control says. */
  actionLabel: string;
  /** The rail's badge, e.g. "Reply" or "Follow up". */
  label: string;
  tone: "info" | "ai" | "warning" | "neutral" | "danger" | "success";
}

export type OwnershipFilter = "mine" | "unassigned" | "everyone";

export interface RankOptions {
  now: Date;
  /** Item keys snoozed by this person, until now has passed them. */
  snoozed: ReadonlySet<string>;
  filter: OwnershipFilter;
  /** The viewer, for the "mine" filter. Null in demo mode. */
  userId: string | null;
  /** Workspace setting: business days of silence before an outbound touch has "gone quiet". */
  quietAfterBusinessDays: number;
}

/** The default for `quietAfterBusinessDays` lives with the setting it defaults. */
export { DEFAULT_QUIET_AFTER_BUSINESS_DAYS } from "@huntloop/db/org-profile";

const GROUP: Record<AttentionKind, AttentionGroup> = {
  reply: "conversations",
  approval: "conversations",
  "next-step": "follow-ups",
  quiet: "follow-ups",
  "late-stage": "follow-ups",
  "hot-untouched": "opportunities",
  "demand-shipped": "opportunities",
  learning: "workspace",
  "discovery-paused": "workspace",
  "failing-sources": "workspace",
  "stale-scores": "workspace",
};

/** Items that are about the workspace, not about one person's accounts. */
const WORKSPACE_KINDS: ReadonlySet<AttentionKind> = new Set([
  "learning",
  "discovery-paused",
  "failing-sources",
  "stale-scores",
]);

/** How much each kind matters before age and value are considered. */
const BASE: Record<AttentionKind, number> = {
  reply: 100,
  approval: 85,
  "next-step": 80,
  quiet: 60,
  "hot-untouched": 55,
  "late-stage": 50,
  "demand-shipped": 45,
  "discovery-paused": 40,
  learning: 30,
  "failing-sources": 20,
  "stale-scores": 10,
};

const PRIORITY_WEIGHT: Record<Priority, number> = { hot: 1.3, warm: 1.1, watch: 0.9, ignore: 0.6 };

/** Late stages are worth more attention per item: the deal is closer to closing. */
const STAGE_WEIGHT: Record<string, number> = { meeting: 1.25, proposal: 1.3 };

/** `classify_reply` labels that mean a person should answer soon. */
const URGENT_CLASSIFICATIONS: ReadonlySet<string> = new Set(["positive"]);

/**
 * Labels that are not a person waiting on us. The loader leaves these out
 * already; the ranker refuses them as well, so a loader bug cannot put an
 * out-of-office at the top of somebody's morning.
 */
export const NOT_A_REPLY: ReadonlySet<string> = new Set(["out_of_office", "bounce", "unsubscribe"]);

const DAY_MS = 24 * 3600_000;

/**
 * Whole business days from `from` to `to` — Monday to Friday, in UTC.
 *
 * UTC rather than the viewer's zone because the server has no reliable zone
 * for them, and a reminder that fires a few hours early or late on a weekend
 * boundary is a far smaller error than one that silently counts Saturdays.
 */
export function businessDaysBetween(from: Date, to: Date): number {
  if (to <= from) return 0;
  let days = 0;
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
  while (cursor < end) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) days++;
  }
  return days;
}

/** "3 days", "1 day", "today". */
export function agoLabel(days: number): string {
  if (days <= 0) return "today";
  return days === 1 ? "1 day" : `${days} days`;
}

function wholeDays(from: string | null | undefined, now: Date): number {
  if (!from) return 0;
  const t = Date.parse(from);
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((now.getTime() - t) / DAY_MS));
}

const CHANNEL_LABEL: Record<string, string> = {
  email: "email",
  linkedin: "LinkedIn",
  phone: "a call",
  meeting: "a meeting",
  chat: "chat",
  other: "another channel",
};

function describe(c: AttentionCandidate, now: Date, quietAfter: number) {
  const age = wholeDays(c.at, now);
  switch (c.kind) {
    case "reply": {
      const via = c.channel && c.channel !== "email" ? ` on ${CHANNEL_LABEL[c.channel] ?? c.channel}` : "";
      const when = age === 0 ? "today" : `${agoLabel(age)} ago`;
      if (c.classification === "wrong_person") {
        return {
          why: `They replied ${when} saying they are not the right person. Find who is before following up.`,
          actionLabel: "Find the right person",
          label: "Wrong person",
          tone: "warning" as const,
        };
      }
      const tone = c.classification ? ` Read as ${c.classification.replace(/_/g, " ")}.` : "";
      return {
        why: `They replied${via} ${when} and nobody has answered.${tone}`,
        actionLabel: c.channel && c.channel !== "email" ? "Log your reply" : "Reply",
        label: c.classification === "positive" ? "Positive reply" : "Reply",
        tone: c.classification === "positive" ? ("success" as const) : ("info" as const),
      };
    }
    case "approval":
      return {
        why: `Huntloop drafted an email ${age === 0 ? "today" : `${agoLabel(age)} ago`}. Nothing sends until a person approves it.`,
        actionLabel: "Review draft",
        label: "Approve",
        tone: "ai" as const,
      };
    case "next-step": {
      const due = c.at ? Date.parse(c.at) : NaN;
      const overdue = Number.isFinite(due) && due < now.getTime() - DAY_MS;
      const days = wholeDays(c.at, now);
      return {
        why: `Your next step${c.nextStep ? ` — "${c.nextStep}"` : ""} ${
          overdue ? `was due ${agoLabel(days)} ago` : "is due today"
        }.`,
        actionLabel: "Open",
        label: overdue ? "Overdue" : "Due today",
        tone: overdue ? ("warning" as const) : ("info" as const),
      };
    }
    case "quiet": {
      const via = c.channel ? ` by ${CHANNEL_LABEL[c.channel] ?? c.channel}` : "";
      const business = c.at ? businessDaysBetween(new Date(c.at), now) : quietAfter;
      return {
        why: `Last touch was${via} ${business} business days ago and they have not answered. No sequence is following up.`,
        actionLabel: "Follow up",
        label: "Gone quiet",
        tone: "warning" as const,
      };
    }
    case "hot-untouched":
      return {
        why: `HOT${c.detail ? `, with a ${c.detail} trigger` : ""}${
          c.at ? ` ${age === 0 ? "today" : `${agoLabel(age)} ago`}` : ""
        }, and nobody has reached out yet.`,
        actionLabel: "Open",
        label: "Hot",
        tone: "danger" as const,
      };
    case "demand-shipped":
      return {
        why: `They asked for ${c.detail ? `“${c.detail}”` : "something"}, which is now marked shipped${
          c.stage === "lost" || c.stage === "archived" ? " — and the deal was closed without it" : ""
        }. Worth telling them.`,
        actionLabel: "Reopen the conversation",
        label: "Now shipped",
        tone: "success" as const,
      };
    case "late-stage":
      return {
        why: `In ${c.stage ?? "a late stage"} with no next step set. Deals this close stall when nobody owns what happens next.`,
        actionLabel: "Set next step",
        label: "No next step",
        tone: "warning" as const,
      };
    case "learning":
      return {
        why: `${c.count ?? 0} ${c.count === 1 ? "proposal" : "proposals"} from the last analysis ${c.count === 1 ? "is" : "are"} waiting for a decision. Nothing changes until someone accepts.`,
        actionLabel: "Review",
        label: "Learning",
        tone: "ai" as const,
      };
    case "discovery-paused":
      return {
        why: `${c.count ?? 0} opportunities are waiting for review, which is at your backlog cap. New searches are paused so they do not pile up unread.`,
        actionLabel: "Triage",
        label: "Discovery paused",
        tone: "warning" as const,
      };
    case "failing-sources":
      return {
        why: `${c.count ?? 0} ${c.count === 1 ? "source is" : "sources are"} failing. They are still enabled and still retrying.`,
        actionLabel: "Open sources",
        label: "Sources",
        tone: "warning" as const,
      };
    case "stale-scores":
      return {
        why: `${c.count ?? 0} ${c.count === 1 ? "opportunity was" : "opportunities were"} last scored over 90 days ago. An old score is not a current one.`,
        actionLabel: "Open",
        label: "Freshness",
        tone: "neutral" as const,
      };
  }
}

/** How strongly this item should pull, given its kind, age and value. */
function scoreOf(c: AttentionCandidate, now: Date, quietAfter: number): number {
  let s = BASE[c.kind];
  const age = wholeDays(c.at, now);

  switch (c.kind) {
    case "reply":
      if (c.classification && URGENT_CLASSIFICATIONS.has(c.classification)) s += 20;
      if (c.classification === "negative") s -= 30;
      s += Math.min(age, 7) * 2; // an unanswered reply gets worse every day
      break;
    case "approval":
      s += Math.min(age, 5) * 2;
      break;
    case "next-step":
      s += Math.min(age, 14) * 2;
      break;
    case "quiet": {
      const business = c.at ? businessDaysBetween(new Date(c.at), now) : quietAfter;
      s += Math.min(Math.max(business - quietAfter, 0), 10) * 1.5;
      break;
    }
    case "hot-untouched":
      // Fresher triggers first: a trigger loses most of its value in two weeks.
      s += Math.max(0, 14 - Math.min(age, 14));
      break;
    default:
      break;
  }

  if (c.priority) s *= PRIORITY_WEIGHT[c.priority];
  if (c.stage && STAGE_WEIGHT[c.stage]) s *= STAGE_WEIGHT[c.stage]!;
  if (typeof c.score === "number") s += c.score / 25; // a tie-breaker, never a driver
  return Math.round(s * 10) / 10;
}

function visible(c: AttentionCandidate, options: RankOptions): boolean {
  if (options.snoozed.has(c.key)) return false;
  if (c.kind === "reply" && c.classification && NOT_A_REPLY.has(c.classification)) return false;
  if (WORKSPACE_KINDS.has(c.kind)) return true;
  if (options.filter === "everyone") return true;
  if (options.filter === "unassigned") return !c.ownerId;
  // "mine": what I own. With no known viewer (demo), show everything.
  if (!options.userId) return true;
  return c.ownerId === options.userId;
}

/**
 * Rank the candidates: drop what is snoozed or not this person's, explain the
 * rest, and order them.
 *
 * The same opportunity can surface twice (a reply waiting *and* an overdue next
 * step). Only its strongest item is kept: two rows for one account read as
 * two pieces of work when it is one conversation.
 *
 * Drafts are the exception. An approval is a concrete message waiting on a
 * decision — often the very answer to the reply above it — and folding it into
 * another item would hide the one thing that cannot proceed without a person.
 */
export function rank(candidates: readonly AttentionCandidate[], options: RankOptions): RankedItem[] {
  const ranked = candidates
    .filter((c) => visible(c, options))
    .map((c) => {
      const d = describe(c, options.now, options.quietAfterBusinessDays);
      return {
        ...c,
        ...d,
        group: GROUP[c.kind],
        score_: scoreOf(c, options.now, options.quietAfterBusinessDays),
      };
    })
    .sort((a, b) => b.score_ - a.score_ || a.title.localeCompare(b.title));

  const seen = new Set<string>();
  return ranked.filter((item) => {
    if (!item.opportunityId || item.kind === "approval") return true;
    if (seen.has(item.opportunityId)) return false;
    seen.add(item.opportunityId);
    return true;
  });
}

/**
 * Whether an outbound touch has gone quiet.
 *
 * Exported for the loader, so the same rule decides both which opportunities
 * become candidates and how their reasons read.
 */
export function isQuiet(lastOutboundAt: string, now: Date, quietAfterBusinessDays: number): boolean {
  const t = Date.parse(lastOutboundAt);
  if (!Number.isFinite(t)) return false;
  return businessDaysBetween(new Date(t), now) >= quietAfterBusinessDays;
}

/* ── Gathering the candidates ────────────────────────────────────────────── */

/*
 * Moved here from apps/web so the daily digest (a background job, which has
 * only the service-role client) and the in-app queue rank exactly the same
 * items by exactly the same rules. Every query filters on `org_id`
 * explicitly, which is what makes it safe to run under either client.
 */

/** The query surface both the tenant and the admin client provide. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AttentionClient = { from: (table: string) => any; rpc: (fn: string, args?: any) => any };

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


/* eslint-disable @typescript-eslint/no-explicit-any --
   Nested PostgREST selects have no generated row types in this repo (DB-03).
   Confined to the gathering below, which maps everything to typed candidates. */

export async function gatherAttention(
  db: AttentionClient,
  orgId: string,
  orgSlug: string,
  now: Date,
): Promise<{ candidates: AttentionCandidate[]; quietAfter: number }> {
  const since = new Date(now.getTime() - 120 * 24 * 3600_000).toISOString();
  const staleBefore = new Date(now.getTime() - 90 * 24 * 3600_000).toISOString();

  const shippedSince = new Date(now.getTime() - 30 * 24 * 3600_000).toISOString();
  const [org, threads, drafts, opps, touches, enrollments, findings, failing, stale, backlog, shipped] =
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
      /* 0042. Themes shipped in the last 30 days, with the deals that asked.
         A failure here (before the migration) is an empty list, not an error:
         the rest of the queue must not depend on it. */
      Promise.resolve(
        db
          .from("demand_signals")
          .select(
            "opportunity_id, demand_themes!inner(id, title, status, shipped_at), " +
              "opportunities!inner(id, status, priority, owner_id, deleted_at, companies(name))",
          )
          .eq("org_id", orgId)
          .not("opportunity_id", "is", null)
          .eq("demand_themes.status", "shipped")
          .gte("demand_themes.shipped_at", shippedSince)
          .limit(200),
      ).catch(() => ({ data: [] })),
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

  /* ── Shipped themes, back to the deals that asked (0042) ────────────── */
  const seenShipped = new Set<string>();
  for (const row of ((shipped as { data?: unknown[] | null }).data ?? []) as any[]) {
    const theme = one(row.demand_themes);
    const opp = one(row.opportunities);
    if (!theme || !opp || opp.deleted_at || opp.status === "won") continue;
    const key = `demand-shipped:${theme.id}:${opp.id}`;
    if (seenShipped.has(key)) continue;
    seenShipped.add(key);
    candidates.push({
      kind: "demand-shipped",
      key,
      title: String(opp.companies?.name ?? one(opp.companies)?.name ?? "An opportunity"),
      href: opportunityHref(String(opp.id)),
      opportunityId: String(opp.id),
      ownerId: opp.owner_id ?? null,
      priority: priorityOf(opp.priority),
      stage: String(opp.status ?? ""),
      at: theme.shipped_at ?? null,
      detail: String(theme.title),
    });
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
