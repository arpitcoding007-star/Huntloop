import "server-only";
import type { TenantClient } from "@huntloop/db";
import type { ActivityChannel, ActivityDirection, ActivityKind } from "@huntloop/db/activity";
import { NOW as FIXTURE_NOW, findOpportunity } from "../fixtures/opportunities";
import { currentUserId, requireOrgId } from "./org";
import { load, type Loaded } from "./source";
import { loadProfiles } from "./team";

/**
 * An opportunity's history — `activities` from 0037.
 *
 * ── What this adds to the ledger ─────────────────────────────────────────
 *
 * Names and pointers, nothing else. The ledger deliberately stores no email
 * subject (0037 explains why: a second copy of somebody's correspondence is a
 * second place erasure has to reach), so the subject is read from `messages`
 * here, at render time, where an erased message already reads "[erased]".
 * Actors are resolved through `profiles`, the same way the members screen
 * does it.
 *
 * ── Why the ledger's start is reported ───────────────────────────────────
 *
 * Stage history before 0037 cannot be reconstructed. A timeline that began
 * silently at the migration would read as "nothing happened before October",
 * which is a false statement about the account. `ledgerStartedAt` lets the
 * screen say where history begins.
 */

export interface TimelineItem {
  id: string;
  kind: ActivityKind;
  channel: ActivityChannel;
  direction: ActivityDirection;
  actorType: "user" | "system" | "contact";
  /** A person's name, "You", or null for the engine and for contacts. */
  actor: string | null;
  occurredAt: string;
  summary: string;
  /** What a person wrote, on manual rows only. */
  body: string | null;
  /** A secondary line: an email's subject, a loss reason, a band change. */
  detail: string | null;
  /** Where the row's source lives — a thread in the inbox, for emails. */
  href: string | null;
  origin: "trigger" | "manual" | "backfill";
  /** True when the viewer wrote this row and may change it. */
  mine: boolean;
}

export interface Timeline {
  items: TimelineItem[];
  /** True when more rows exist beyond `items`. */
  hasMore: boolean;
  /** When the ledger began recording stage history for this workspace. */
  ledgerStartedAt: string | null;
}

const PAGE = 50;

const REASON_LABEL: Record<string, string> = {
  no_need: "No need",
  no_budget: "No budget",
  timing: "Timing",
  chose_competitor: "Chose a competitor",
  missing_capability: "Missing capability",
  no_response: "No response",
  not_a_fit: "Not a fit",
  wrong_contact: "Wrong contact",
  other: "Other",
};

export function reasonLabel(category: string | null | undefined): string | null {
  return category ? (REASON_LABEL[category] ?? category) : null;
}

export async function getTimeline(
  orgSlug: string,
  opportunityId: string,
  options: { before?: string | null } = {},
): Promise<Loaded<Timeline>> {
  return load(
    async (db) => {
      const orgId = await requireOrgId(orgSlug, "getTimeline");
      const viewerId = await currentUserId(db);

      let query = db
        .from("activities")
        .select(
          "id, kind, channel, direction, actor_type, actor_id, occurred_at, summary, body, ref_type, ref_id, payload, origin",
        )
        .eq("org_id", orgId)
        .eq("opportunity_id", opportunityId)
        .is("deleted_at", null)
        .order("occurred_at", { ascending: false })
        .limit(PAGE + 1);
      if (options.before) query = query.lt("occurred_at", options.before);

      const [{ data, error }, started] = await Promise.all([
        query,
        db
          .from("activities")
          .select("created_at")
          .eq("org_id", orgId)
          .eq("origin", "trigger")
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle(),
      ]);
      if (error) throw new Error(`getTimeline: ${error.message}`);

      const rows = (data ?? []) as Record<string, unknown>[];
      const page = rows.slice(0, PAGE);

      const messageIds = page
        .filter((r) => r.ref_type === "message" && r.ref_id)
        .map((r) => String(r.ref_id));
      const [messages, profiles, competitors] = await Promise.all([
        messageIds.length
          ? db
              .from("messages")
              .select("id, subject, thread_id")
              .eq("org_id", orgId)
              .in("id", messageIds)
              .then((r) => new Map((r.data ?? []).map((m) => [String(m.id), m])))
          : Promise.resolve(new Map<string, Record<string, unknown>>()),
        loadProfiles(
          db,
          page.map((r) => (r.actor_id ? String(r.actor_id) : "")).filter(Boolean),
        ),
        competitorNames(db, orgId, page),
      ]);

      const items = page.map((r): TimelineItem => {
        const payload = (r.payload ?? {}) as Record<string, unknown>;
        const actorId = r.actor_id ? String(r.actor_id) : null;
        const profile = actorId ? profiles.get(actorId) : undefined;
        const message = r.ref_type === "message" ? messages.get(String(r.ref_id)) : undefined;

        return {
          id: String(r.id),
          kind: r.kind as ActivityKind,
          channel: r.channel as ActivityChannel,
          direction: r.direction as ActivityDirection,
          actorType: r.actor_type as TimelineItem["actorType"],
          actor: actorId
            ? actorId === viewerId
              ? "You"
              : (profile?.name ?? profile?.email ?? "A teammate")
            : null,
          occurredAt: String(r.occurred_at),
          summary: String(r.summary ?? ""),
          body: (r.body as string | null) ?? null,
          detail: detailFor(String(r.kind), payload, message, competitors),
          href: message?.thread_id ? `/${orgSlug}/inbox#thread-${message.thread_id}` : null,
          origin: r.origin as TimelineItem["origin"],
          mine: r.origin === "manual" && actorId !== null && actorId === viewerId,
        };
      });

      return {
        items,
        hasMore: rows.length > PAGE,
        ledgerStartedAt: started.data?.created_at ? String(started.data.created_at) : null,
      };
    },
    () => ({ items: demoTimeline(opportunityId), hasMore: false, ledgerStartedAt: null }),
  );
}

/** Names for competitors a loss was attributed to. Display only. */
async function competitorNames(
  db: TenantClient,
  orgId: string,
  rows: Record<string, unknown>[],
): Promise<Map<string, string>> {
  const ids = rows
    .map((r) => (r.payload as Record<string, unknown> | null)?.competitorId)
    .filter((v): v is string => typeof v === "string");
  if (ids.length === 0) return new Map();
  const { data } = await db.from("competitors").select("id, name").eq("org_id", orgId).in("id", ids);
  return new Map((data ?? []).map((c) => [String(c.id), String(c.name)]));
}

function detailFor(
  kind: string,
  payload: Record<string, unknown>,
  message: Record<string, unknown> | undefined,
  competitors: Map<string, string>,
): string | null {
  if (message?.subject) return String(message.subject);
  if (kind === "outcome_recorded") {
    const parts = [reasonLabel(payload.category as string | null)];
    if (typeof payload.competitorId === "string" && competitors.has(payload.competitorId)) {
      parts.push(`to ${competitors.get(payload.competitorId)}`);
    }
    if (typeof payload.reason === "string" && payload.reason.trim()) parts.push(`“${payload.reason.trim()}”`);
    const text = parts.filter(Boolean).join(" · ");
    return text || null;
  }
  if (kind === "override_recorded" || kind === "draft_rejected") {
    return typeof payload.reason === "string" && payload.reason.trim() ? `“${payload.reason.trim()}”` : null;
  }
  if (kind === "stage_changed" && payload.reconstructed) {
    return "Reconstructed from a recorded outcome";
  }
  if (kind === "discovered" && typeof payload.via === "string" && payload.via !== "manual") {
    return `Found via ${String(payload.via).replace(/_/g, " ")}`;
  }
  return null;
}

/**
 * A demo history, derived from the fixture it belongs to.
 *
 * Only what the fixture itself implies: it was found, and it reached the stage
 * the fixture says. No invented emails — a demo timeline showing a reply on an
 * opportunity whose recommendation says "reach out now" would be the demo
 * contradicting itself on the screen meant to explain it.
 */
function demoTimeline(opportunityId: string): TimelineItem[] {
  const fixture = findOpportunity(opportunityId);
  if (!fixture) return [];
  const found = fixture.triggerDate
    ? new Date(Date.parse(fixture.triggerDate) + 24 * 3600_000).toISOString()
    : new Date(FIXTURE_NOW.getTime() - 3 * 24 * 3600_000).toISOString();
  const items: TimelineItem[] = [
    {
      id: `demo-${fixture.id}-discovered`,
      kind: "discovered",
      channel: "system",
      direction: "internal",
      actorType: "system",
      actor: null,
      occurredAt: found,
      summary: "Opportunity found",
      body: null,
      detail: fixture.trigger ? `Trigger: ${fixture.trigger}` : null,
      href: null,
      origin: "trigger",
      mine: false,
    },
  ];
  if (fixture.status.toLowerCase() !== "discovered") {
    items.unshift({
      id: `demo-${fixture.id}-stage`,
      kind: "stage_changed",
      channel: "system",
      direction: "internal",
      actorType: "system",
      actor: null,
      occurredAt: new Date(Date.parse(found) + 2 * 3600_000).toISOString(),
      summary: `Moved to ${fixture.status.toLowerCase()}`,
      body: null,
      detail: null,
      href: null,
      origin: "trigger",
      mine: false,
    });
  }
  return items;
}
