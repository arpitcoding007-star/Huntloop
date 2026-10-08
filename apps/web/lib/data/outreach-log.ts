import "server-only";
import { DEFAULT_QUIET_AFTER_BUSINESS_DAYS, parseOrgProfile } from "@huntloop/db/org-profile";
import { outcomeOf, type ReachOutcome } from "../outreach-log/outcome";
import { currentUserId, requireOrgId } from "./org";
import { load, type Loaded } from "./source";
import { loadProfiles } from "./team";

/**
 * The outreach log — every reach-out, on every channel, in one list. §8.1b.
 *
 * A view over the activity ledger (0037), not a new store: an email the
 * engine sent, a LinkedIn message somebody logged and a call logged from
 * Needs you are all rows in `activities`, and they appear here because they
 * are there. What this adds is the outcome of each touch (`outreach-log/
 * outcome.ts`) and the filters a team asks for — channel, person, outcome.
 *
 * Bounded: the newest `LIMIT` outbound touches in the window, and the screen
 * says so when the bound is reached.
 */

export const LOG_DAYS = [7, 30, 90] as const;
export type LogDays = (typeof LOG_DAYS)[number];
export const LOG_CHANNELS = ["email", "linkedin", "phone", "chat", "other"] as const;
export type LogChannel = (typeof LOG_CHANNELS)[number];

export interface LogFilters {
  days: LogDays;
  channel: LogChannel | "all";
  /** "me", "all", or a member's user id. */
  person: string;
  outcome: ReachOutcome | "all";
}

export interface LogRow {
  id: string;
  opportunityId: string;
  company: string;
  /** The person reached, when the touch names one. */
  contact: string | null;
  channel: string;
  occurredAt: string;
  summary: string;
  /** A person's name, "You", or "Huntloop" for what a sequence sent. */
  by: string;
  outcome: ReachOutcome;
  /** The inbox thread, for emails. */
  href: string | null;
}

export interface OutreachLog {
  rows: LogRow[];
  /** Before the outcome filter, so the summary describes the whole window. */
  counts: Record<ReachOutcome, number>;
  total: number;
  capped: boolean;
  quietAfterBusinessDays: number;
  /** Members, for the person filter. */
  people: { id: string; name: string }[];
}

export const LIMIT = 500;
/** Ids per inbound lookup, so the request URL stays well inside gateway limits. */
const BATCH = 150;
const OUTBOUND_KINDS = ["email_sent", "message", "call", "connection_request"];
const INBOUND_KINDS = ["email_received", "message", "call", "meeting"];

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped PostgREST rows (DB-03). */

export async function getOutreachLog(orgSlug: string, filters: LogFilters): Promise<Loaded<OutreachLog>> {
  return load(
    async (db) => {
      const orgId = await requireOrgId(orgSlug, "getOutreachLog");
      const viewerId = await currentUserId(db);
      const now = new Date();
      const since = new Date(now.getTime() - filters.days * 24 * 3600_000).toISOString();

      let query = db
        .from("activities")
        .select(
          "id, opportunity_id, channel, actor_type, actor_id, occurred_at, summary, ref_type, ref_id, " +
            "companies(name), people(first_name, last_name)",
        )
        .eq("org_id", orgId)
        .eq("direction", "outbound")
        .in("kind", OUTBOUND_KINDS)
        .not("opportunity_id", "is", null)
        .gte("occurred_at", since)
        .is("deleted_at", null)
        .order("occurred_at", { ascending: false })
        .limit(LIMIT);
      if (filters.channel !== "all") query = query.eq("channel", filters.channel);
      if (filters.person === "me" && viewerId) query = query.eq("actor_id", viewerId);
      else if (filters.person !== "all" && filters.person !== "me") query = query.eq("actor_id", filters.person);

      const [{ data, error }, org, members] = await Promise.all([
        query,
        db.from("organizations").select("settings").eq("id", orgId).maybeSingle(),
        db.from("memberships").select("user_id").eq("org_id", orgId).is("deleted_at", null),
      ]);
      if (error) throw new Error(`getOutreachLog: ${error.message}`);
      const touches = (data ?? []) as any[];

      const quietAfter =
        parseOrgProfile((org.data as { settings?: unknown } | null)?.settings).followup.quietAfterBusinessDays ??
        DEFAULT_QUIET_AFTER_BUSINESS_DAYS;

      /* Answers on these accounts since the window opened. Any channel: an
         answer is an answer wherever it arrived. */
      const oppIds = [...new Set(touches.map((t) => String(t.opportunity_id)))];
      const inbound = new Map<string, string[]>();
      for (let i = 0; i < oppIds.length; i += BATCH) {
        const { data: page } = await db
          .from("activities")
          .select("opportunity_id, occurred_at")
          .eq("org_id", orgId)
          .eq("direction", "inbound")
          .in("kind", INBOUND_KINDS)
          .in("opportunity_id", oppIds.slice(i, i + BATCH))
          .gte("occurred_at", since)
          .is("deleted_at", null);
        for (const r of (page ?? []) as any[]) {
          const list = inbound.get(String(r.opportunity_id)) ?? [];
          list.push(String(r.occurred_at));
          inbound.set(String(r.opportunity_id), list);
        }
      }

      const messageIds = touches.filter((t) => t.ref_type === "message" && t.ref_id).map((t) => String(t.ref_id));
      const memberIds = ((members.data ?? []) as any[]).map((m) => String(m.user_id));
      const [threads, profiles] = await Promise.all([
        messageIds.length
          ? db
              .from("messages")
              .select("id, thread_id")
              .eq("org_id", orgId)
              .in("id", messageIds.slice(0, LIMIT))
              .then((r) => new Map(((r.data ?? []) as any[]).map((m) => [String(m.id), m.thread_id as string | null])))
          : Promise.resolve(new Map<string, string | null>()),
        loadProfiles(db, [...memberIds, ...touches.map((t) => (t.actor_id ? String(t.actor_id) : ""))]),
      ]);

      const nameOf = (id: string) => {
        const p = profiles.get(id);
        return p?.name ?? p?.email ?? "A teammate";
      };

      const all: LogRow[] = touches.map((t) => {
        const company = Array.isArray(t.companies) ? t.companies[0] : t.companies;
        const person = Array.isArray(t.people) ? t.people[0] : t.people;
        const contact = person ? [person.first_name, person.last_name].filter(Boolean).join(" ").trim() || null : null;
        const actorId = t.actor_id ? String(t.actor_id) : null;
        const thread = t.ref_type === "message" ? threads.get(String(t.ref_id)) : null;
        return {
          id: String(t.id),
          opportunityId: String(t.opportunity_id),
          company: company?.name ?? "An account",
          contact,
          channel: String(t.channel),
          occurredAt: String(t.occurred_at),
          summary: String(t.summary ?? ""),
          by: actorId ? (actorId === viewerId ? "You" : nameOf(actorId)) : "Huntloop",
          outcome: outcomeOf(
            { opportunityId: String(t.opportunity_id), occurredAt: String(t.occurred_at) },
            inbound,
            now,
            quietAfter,
          ),
          href: thread ? `/${orgSlug}/inbox#thread-${thread}` : null,
        };
      });

      const counts: Record<ReachOutcome, number> = { replied: 0, waiting: 0, "no-response": 0 };
      for (const r of all) counts[r.outcome]++;

      return {
        rows: filters.outcome === "all" ? all : all.filter((r) => r.outcome === filters.outcome),
        counts,
        total: all.length,
        capped: touches.length >= LIMIT,
        quietAfterBusinessDays: quietAfter,
        people: memberIds
          .map((id) => ({ id, name: id === viewerId ? "You" : nameOf(id) }))
          .sort((a, b) => (a.name === "You" ? -1 : b.name === "You" ? 1 : a.name.localeCompare(b.name))),
      };
    },
    /* The fixtures have no touches; an empty log is the honest demo. */
    () => ({
      rows: [],
      counts: { replied: 0, waiting: 0, "no-response": 0 },
      total: 0,
      capped: false,
      quietAfterBusinessDays: DEFAULT_QUIET_AFTER_BUSINESS_DAYS,
      people: [],
    }),
  );
}

/* eslint-enable @typescript-eslint/no-explicit-any */

/** URL → filters. Anything unrecognised falls back to the default, never through to a query. */
export function parseLogFilters(q: Record<string, string | string[] | undefined>): LogFilters {
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const days = Number(first(q.days));
  const channel = first(q.channel);
  const person = first(q.person);
  const outcome = first(q.outcome);
  return {
    days: (LOG_DAYS as readonly number[]).includes(days) ? (days as LogDays) : 30,
    channel: (LOG_CHANNELS as readonly string[]).includes(channel ?? "") ? (channel as LogChannel) : "all",
    person:
      person === "me" || person === "all"
        ? person
        : person && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(person)
          ? person
          : "all",
    outcome: outcome === "replied" || outcome === "waiting" || outcome === "no-response" ? outcome : "all",
  };
}
