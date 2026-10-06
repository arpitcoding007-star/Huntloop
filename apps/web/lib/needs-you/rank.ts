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
  | "stale-scores";

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
