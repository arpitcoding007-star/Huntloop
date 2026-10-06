/**
 * `send_notifications` — the product's own email about join requests.
 * A cross-tenant sweeper, every tick, and cheap: two indexed queries that
 * almost always return nothing.
 *
 *   · A pending request admins have not heard about → each admin and owner of
 *     that workspace gets one email.
 *   · An approved request the requester has not heard about → they get one.
 *
 * Markers are set after the send is attempted, whether or not every address
 * accepted it: a request is announced once, never once per tick. A deployment
 * without email (no `RESEND_API_KEY`) sends nothing and sets nothing, so the
 * week's requests are announced once it is configured.
 *
 * Why a job and not the request path: the admins' addresses are not readable
 * by the person asking to join, and the app may not use the service-role
 * client (`check-admin-imports`). The engine may.
 */
import { isEmailConfigured, sendEmail } from "../email/resend.ts";
import { joinApprovedEmail, joinRequestEmail } from "../email/templates.ts";
import { OrgScope } from "../scope.ts";
import type { JobContext, JobOutcome } from "../registry.ts";

const WINDOW_MS = 7 * 24 * 3600_000;
const MAX_PER_TICK = 25;

function siteUrl(path: string): string | null {
  const base = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  return base ? new URL(path, base).toString() : null;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped admin rows. */

export async function sendNotifications(ctx: JobContext): Promise<JobOutcome> {
  if (!isEmailConfigured()) return { ok: true, result: { skipped: "email is not configured" } };
  if (!siteUrl("/")) return { ok: true, result: { skipped: "NEXT_PUBLIC_SITE_URL is not set, so links cannot be built" } };

  const db = OrgScope.global();
  const since = new Date(ctx.now.getTime() - WINDOW_MS).toISOString();

  // ── Requests admins have not heard about ────────────────────────────────
  const { data: pending, error } = await db
    .from("join_requests")
    .select("id, org_id, email, organizations!inner(name, slug, deleted_at)")
    .eq("status", "pending")
    .is("admins_notified_at", null)
    .gte("created_at", since)
    .order("created_at", { ascending: true })
    .limit(MAX_PER_TICK);
  if (error) return { ok: false, error: `send_notifications: ${error.message}` };

  let requests = 0;
  for (const row of (pending ?? []) as any[]) {
    const org = Array.isArray(row.organizations) ? row.organizations[0] : row.organizations;
    if (org && !org.deleted_at) {
      // Admins of *this* org only — the explicit org filter is the tenant boundary here.
      const { data: admins } = await db
        .from("memberships")
        .select("user_id")
        .eq("org_id", row.org_id)
        .in("role", ["owner", "admin"])
        .is("deleted_at", null)
        .limit(20);
      const ids = ((admins ?? []) as any[]).map((a) => String(a.user_id));
      const { data: profiles } = ids.length
        ? await db.from("profiles").select("id, email").in("id", ids)
        : { data: [] };
      const email = joinRequestEmail({
        orgName: String(org.name),
        requesterEmail: String(row.email),
        url: siteUrl(`/${org.slug}/team`)!,
      });
      for (const p of (profiles ?? []) as any[]) {
        if (!p.email) continue;
        await sendEmail({
          to: String(p.email),
          ...email,
          idempotencyKey: `join-request:${row.id}:${p.id}`,
          tags: { kind: "join_request" },
        });
      }
    }
    await db.from("join_requests").update({ admins_notified_at: ctx.now.toISOString() }).eq("id", row.id);
    requests++;
  }

  // ── Approvals the requester has not heard about ─────────────────────────
  const { data: approved, error: approvedError } = await db
    .from("join_requests")
    .select("id, org_id, email, organizations!inner(name, slug, deleted_at)")
    .eq("status", "approved")
    .is("requester_notified_at", null)
    .gte("decided_at", since)
    .order("decided_at", { ascending: true })
    .limit(MAX_PER_TICK);
  if (approvedError) return { ok: false, error: `send_notifications: ${approvedError.message}` };

  let approvals = 0;
  for (const row of (approved ?? []) as any[]) {
    const org = Array.isArray(row.organizations) ? row.organizations[0] : row.organizations;
    if (org && !org.deleted_at) {
      await sendEmail({
        to: String(row.email),
        ...joinApprovedEmail({ orgName: String(org.name), url: siteUrl(`/${org.slug}/dashboard`)! }),
        idempotencyKey: `join-approved:${row.id}`,
        tags: { kind: "join_approved" },
      });
    }
    await db.from("join_requests").update({ requester_notified_at: ctx.now.toISOString() }).eq("id", row.id);
    approvals++;
  }

  return { ok: true, result: { requests, approvals } };
}

/* eslint-enable @typescript-eslint/no-explicit-any */
