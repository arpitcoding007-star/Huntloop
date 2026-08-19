import "server-only";
import type { TenantClient } from "@huntloop/db";

/**
 * The audit trail — `audit_logs` from `0001`, written through `0007`.
 *
 * ── Why this is one function and not a call at each site ─────────────────
 *
 * Because the failure mode of audit logging is silence. A trail that records
 * nine of the ten privileged actions is worse than none: it reads as complete,
 * and the missing tenth is the one somebody will look for. Routing every write
 * through here means the list of what is audited is a single grep, and adding
 * an action without auditing it is visible in review as an omission rather
 * than as an absence.
 *
 * ── Why it never throws ──────────────────────────────────────────────────
 *
 * The alternative — failing the user's action because its audit record could
 * not be written — trades a recorded change for no change at all. For this
 * product that is the wrong trade: nothing here is a regulated financial
 * event, and refusing to remove a member because Postgres hiccuped on the log
 * insert would be an outage caused by observability.
 *
 * It is *reported* rather than swallowed, though. A trail that has quietly
 * stopped is exactly the state that must not look healthy, so a failure goes
 * to Sentry with the action attached.
 */

/**
 * Every privileged action this product records.
 *
 * A closed union rather than a free string, so a typo becomes a type error
 * instead of an entry nobody will ever find again by searching for the name
 * they expected. Dotted `subject.verb`, past tense, because these are records
 * of things that happened.
 */
export type AuditAction =
  | "member.role_changed"
  | "member.removed"
  | "member.invited"
  | "member.invite_revoked"
  | "member.invite_accepted"
  | "opportunity.assigned"
  | "opportunity.created"
  | "opportunity.deleted"
  | "opportunity.status_changed"
  | "opportunity.enrolled"
  | "organization.updated"
  | "organization.plan_changed"
  | "mailbox.connected"
  | "mailbox.disconnected"
  | "campaign.started"
  | "campaign.paused"
  | "suppression.added"
  | "suppression.removed"
  | "source.scanned"
  | "ai.decision_overridden"
  | "data.exported";

export interface AuditEntry {
  action: AuditAction;
  targetType?: string;
  targetId?: string | null;
  meta?: Record<string, unknown>;
}

export async function recordAudit(
  db: TenantClient,
  orgId: string,
  entry: AuditEntry,
): Promise<void> {
  const { error } = await db.rpc("write_audit_log", {
    p_org: orgId,
    p_action: entry.action,
    p_target_type: entry.targetType ?? null,
    p_target_id: entry.targetId ?? null,
    p_meta: entry.meta ?? {},
  });

  if (error) {
    /* Imported lazily so the audit path costs nothing at module load, and so
       this file has no hard dependency on Sentry being configured — an
       unconfigured DSN makes these no-ops rather than errors. */
    const { captureException } = await import("@sentry/nextjs");
    captureException(new Error(`audit log write failed: ${error.message}`), {
      tags: { action: entry.action },
      extra: { orgId, targetType: entry.targetType, targetId: entry.targetId },
    });
  }
}

/**
 * What the trail says, newest first.
 *
 * Readable by admins only — that is `0001`'s `audit_read` policy, not a rule
 * this function applies, so a member calling it gets an empty list rather
 * than a refusal. The caller renders that as "you cannot see this", which is
 * the truthful reading of zero rows here.
 */
export interface AuditRecord {
  id: string;
  action: string;
  actorId: string | null;
  actorName: string | null;
  targetType: string | null;
  targetId: string | null;
  meta: Record<string, unknown>;
  createdAt: string;
}

export async function listAudit(
  db: TenantClient,
  orgId: string,
  limit = 100,
): Promise<AuditRecord[]> {
  const { data, error } = await db
    .from("audit_logs")
    .select("id, action, actor_id, target_type, target_id, meta, created_at")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`listAudit: ${error.message}`);

  const rows = data ?? [];
  /* One lookup for every actor on the page rather than a join: `audit_logs`
     has no foreign key to `profiles` — both point at `auth.users` — so
     PostgREST cannot embed one through the other. */
  const actorIds = [...new Set(rows.map((r) => r.actor_id).filter(Boolean))] as string[];
  const names = await resolveNames(db, actorIds);

  return rows.map((row) => ({
    id: String(row.id),
    action: String(row.action),
    actorId: row.actor_id ?? null,
    actorName: row.actor_id ? (names.get(String(row.actor_id)) ?? null) : null,
    targetType: row.target_type ?? null,
    targetId: row.target_id ?? null,
    meta: (row.meta ?? {}) as Record<string, unknown>,
    createdAt: String(row.created_at),
  }));
}

/**
 * uuid → a name a person recognises, for the ids on this page.
 *
 * Lives here rather than in `team.ts` because four screens need it and none
 * of them should each write their own `profiles` query. Returns a map rather
 * than an array so a caller with a missing id gets `undefined` — which is a
 * real answer, and different from an empty string.
 */
export async function resolveNames(
  db: TenantClient,
  userIds: string[],
): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (ids.length === 0) return new Map();

  const { data, error } = await db
    .from("profiles")
    .select("id, full_name, email")
    .in("id", ids);

  // Not fatal. A page that cannot resolve a name still has the uuid, and the
  // components fall back to it — losing the whole screen over a display
  // detail is the wrong trade.
  if (error) return new Map();

  return new Map(
    (data ?? []).map((p) => [
      String(p.id),
      String(p.full_name || p.email || "").trim() || String(p.id),
    ]),
  );
}
