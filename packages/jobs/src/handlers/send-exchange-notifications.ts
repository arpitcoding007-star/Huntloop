/**
 * `send_exchange_notifications` — Exchange alerts and updates (build plan
 * DN-52, DN-53, DN-77, DN-81). Every tick:
 *
 *   1. `exchange_queue_notifications()` turns new matches, introduction
 *      requests and decisions, messages and due re-confirms into feed rows
 *      (0064). The wording is written there, from card bands, so nothing here
 *      can say more about a buyer than the database allowed.
 *   2. Instant rows are emailed now — unless it is the person's quiet hours
 *      (they wait), or they already had `MAX_INSTANT_ALERTS_PER_DAY` match
 *      alerts today (the rest move to the digest). Conversation emails —
 *      introductions and messages — are not capped.
 *   3. Digest rows are gathered into one email a day per person, at their
 *      digest hour, claimed the same way `send_digests` claims its day.
 *
 * With no email provider or no site URL the rows are still queued, so the
 * in-app feed works; nothing is emailed. Rows older than three days (instant)
 * or seven (digest) are not emailed late — a stale alert is noise.
 */
import { isEmailConfigured, sendEmail } from "../email/resend.ts";
import { exchangeDigestEmail, exchangeNoticeEmail } from "../email/templates.ts";
import { exchangeUnsubscribeToken } from "../email/exchange-token.ts";
import { localTime } from "./send-digests.ts";
import { OrgScope } from "../scope.ts";
import type { JobContext, JobOutcome } from "../registry.ts";

export const MAX_INSTANT_ALERTS_PER_DAY = 5;
const MAX_INSTANT_PER_TICK = 100;
const MAX_DIGESTS_PER_TICK = 50;
const DIGEST_ITEMS = 10;

interface Pref {
  exchange_alerts: string;
  exchange_emails: boolean;
  digest_hour: number;
  timezone: string;
  quiet_start_hour: number | null;
  quiet_end_hour: number | null;
  last_exchange_digest_on: string | null;
}

const DEFAULT_PREF: Pref = {
  exchange_alerts: "digest",
  exchange_emails: true,
  digest_hour: 8,
  timezone: "UTC",
  quiet_start_hour: null,
  quiet_end_hour: null,
  last_exchange_digest_on: null,
};

/** Quiet hours, in the person's own time: [start, end), wrapping past midnight. */
export function inQuietHours(hour: number, start: number | null, end: number | null): boolean {
  if (start === null || end === null || start === end) return false;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

/** Preferences can change after a row was queued: the current ones decide. */
export function allowedNow(kind: string, pref: Pick<Pref, "exchange_alerts" | "exchange_emails">): boolean {
  return kind === "match_alert" ? pref.exchange_alerts !== "off" : pref.exchange_emails;
}

function site(path: string): string | null {
  const base = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  return base ? new URL(path, base).toString() : null;
}

function exchangeFrom(): string | undefined {
  return process.env.EXCHANGE_EMAIL_FROM?.trim() || undefined;
}

type Row = {
  id: string;
  org_id: string;
  user_id: string;
  kind: string;
  title: string;
  body: string | null;
  href: string;
  hot: boolean;
  created_at: string;
};

export async function sendExchangeNotifications(ctx: JobContext): Promise<JobOutcome> {
  const db = OrgScope.global();
  const { data: queued, error: queueError } = await db.rpc("exchange_queue_notifications", {});
  if (queueError) return { ok: false, error: `send_exchange_notifications: ${queueError.message}` };

  if (!isEmailConfigured()) return { ok: true, result: { queued, emailed: "email is not configured" } };
  if (!site("/")) return { ok: true, result: { queued, emailed: "NEXT_PUBLIC_SITE_URL is not set" } };

  const instantSince = new Date(ctx.now.getTime() - 3 * 86_400_000).toISOString();
  const digestSince = new Date(ctx.now.getTime() - 7 * 86_400_000).toISOString();
  const [instantRes, digestRes] = await Promise.all([
    db
      .from("exchange_notifications")
      .select("id, org_id, user_id, kind, title, body, href, hot, created_at")
      .eq("channel", "instant")
      .is("email_sent_at", null)
      .gte("created_at", instantSince)
      .order("created_at", { ascending: true })
      .limit(MAX_INSTANT_PER_TICK),
    db
      .from("exchange_notifications")
      .select("id, org_id, user_id, kind, title, body, href, hot, created_at")
      .eq("channel", "digest")
      .is("email_sent_at", null)
      .gte("created_at", digestSince)
      .order("created_at", { ascending: false })
      .limit(1000),
  ]);
  if (instantRes.error) return { ok: false, error: `send_exchange_notifications: ${instantRes.error.message}` };
  const instant = (instantRes.data ?? []) as Row[];
  const digest = (digestRes.data ?? []) as Row[];

  const userIds = [...new Set([...instant, ...digest].map((r) => r.user_id))];
  if (!userIds.length) return { ok: true, result: { queued, instant: 0, digests: 0 } };
  const orgIds = [...new Set([...instant, ...digest].map((r) => r.org_id))];
  const dayStart = `${ctx.now.toISOString().slice(0, 10)}T00:00:00Z`;
  const [profilesRes, prefsRes, orgsRes, sentTodayRes] = await Promise.all([
    db.from("profiles").select("id, email").in("id", userIds),
    db
      .from("notification_preferences")
      .select("org_id, user_id, exchange_alerts, exchange_emails, digest_hour, timezone, quiet_start_hour, quiet_end_hour, last_exchange_digest_on")
      .in("user_id", userIds),
    db.from("organizations").select("id, name, slug").in("id", orgIds),
    db
      .from("exchange_notifications")
      .select("user_id")
      .eq("kind", "match_alert")
      .eq("channel", "instant")
      .gte("email_sent_at", dayStart)
      .in("user_id", userIds),
  ]);
  const emails = new Map(((profilesRes.data ?? []) as { id: string; email: string | null }[]).map((p) => [p.id, p.email]));
  const prefs = new Map(((prefsRes.data ?? []) as (Pref & { org_id: string; user_id: string })[]).map((p) => [`${p.org_id}:${p.user_id}`, p]));
  const orgs = new Map(((orgsRes.data ?? []) as { id: string; name: string; slug: string }[]).map((o) => [o.id, o]));
  const sentToday = new Map<string, number>();
  for (const r of (sentTodayRes.data ?? []) as { user_id: string }[]) sentToday.set(r.user_id, (sentToday.get(r.user_id) ?? 0) + 1);

  const links = (orgId: string, userId: string) => {
    const slug = orgs.get(orgId)?.slug ?? "";
    const token = exchangeUnsubscribeToken(orgId, userId);
    const unsubscribe = token
      ? site(`/api/notifications/exchange-unsubscribe?token=${encodeURIComponent(token)}`)!
      : site(`/${slug}/exchange/notifications`)!;
    return {
      preferences: site(`/${slug}/exchange/notifications`)!,
      unsubscribe,
      headers: token
        ? { "List-Unsubscribe": `<${unsubscribe}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" }
        : undefined,
    };
  };

  let sent = 0;
  let deferred = 0;
  let movedToDigest = 0;
  for (const row of instant) {
    const email = emails.get(row.user_id);
    if (!email) continue;
    const pref = prefs.get(`${row.org_id}:${row.user_id}`) ?? DEFAULT_PREF;
    if (!allowedNow(row.kind, pref)) {
      await db.from("exchange_notifications").update({ channel: "none" }).eq("id", row.id);
      continue;
    }
    const local = localTime(ctx.now, pref.timezone);
    if (inQuietHours(local.hour, pref.quiet_start_hour, pref.quiet_end_hour)) {
      deferred++;
      continue;
    }
    if (row.kind === "match_alert" && (sentToday.get(row.user_id) ?? 0) >= MAX_INSTANT_ALERTS_PER_DAY) {
      await db.from("exchange_notifications").update({ channel: "digest" }).eq("id", row.id);
      movedToDigest++;
      continue;
    }
    // Claim before sending, so two ticks never send the same row.
    const { data: claimed } = await db
      .from("exchange_notifications")
      .update({ email_sent_at: ctx.now.toISOString() })
      .eq("id", row.id)
      .is("email_sent_at", null)
      .select("id");
    if (!claimed?.length) continue;
    const l = links(row.org_id, row.user_id);
    const rendered = exchangeNoticeEmail({
      item: { title: row.title, body: row.body, href: site(row.href)! },
      kind: row.kind,
      preferencesUrl: l.preferences,
      unsubscribeUrl: l.unsubscribe,
    });
    const result = await sendEmail({
      from: exchangeFrom(),
      to: email,
      ...rendered,
      idempotencyKey: `exchange:${row.id}`,
      headers: l.headers,
      tags: { kind: `exchange_${row.kind}` },
    });
    if (result.ok) {
      sent++;
      if (row.kind === "match_alert") sentToday.set(row.user_id, (sentToday.get(row.user_id) ?? 0) + 1);
    } else {
      await db.from("exchange_notifications").update({ email_sent_at: null }).eq("id", row.id);
    }
  }

  // Digests: one per person per workspace per local day.
  const groups = new Map<string, Row[]>();
  for (const r of digest) {
    const k = `${r.org_id}:${r.user_id}`;
    if (!allowedNow(r.kind, prefs.get(k) ?? DEFAULT_PREF)) continue;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  let digests = 0;
  for (const [k, rows] of groups) {
    if (digests >= MAX_DIGESTS_PER_TICK) break;
    const [orgId, userId] = k.split(":") as [string, string];
    const email = emails.get(userId);
    if (!email) continue;
    const existing = prefs.get(k);
    const pref = existing ?? DEFAULT_PREF;
    const local = localTime(ctx.now, pref.timezone);
    if (local.hour < pref.digest_hour || pref.last_exchange_digest_on === local.date) continue;
    if (inQuietHours(local.hour, pref.quiet_start_hour, pref.quiet_end_hour)) continue;

    const claimed = existing
      ? await db
          .from("notification_preferences")
          .update({ last_exchange_digest_on: local.date })
          .eq("org_id", orgId)
          .eq("user_id", userId)
          .or(`last_exchange_digest_on.is.null,last_exchange_digest_on.neq.${local.date}`)
          .select("user_id")
      : await db
          .from("notification_preferences")
          .upsert({ org_id: orgId, user_id: userId, last_exchange_digest_on: local.date }, { onConflict: "org_id,user_id", ignoreDuplicates: true })
          .select("user_id");
    if (!claimed.data?.length) continue;

    const ordered = [...rows].sort((a, b) => Number(b.hot) - Number(a.hot) || b.created_at.localeCompare(a.created_at));
    const org = orgs.get(orgId);
    const l = links(orgId, userId);
    const rendered = exchangeDigestEmail({
      orgName: org?.name ?? "your workspace",
      items: ordered.slice(0, DIGEST_ITEMS).map((r) => ({ title: r.title, body: r.body, href: site(r.href)! })),
      total: ordered.length,
      openUrl: site(`/${org?.slug ?? ""}/exchange/updates`)!,
      preferencesUrl: l.preferences,
      unsubscribeUrl: l.unsubscribe,
    });
    const result = await sendEmail({
      from: exchangeFrom(),
      to: email,
      ...rendered,
      idempotencyKey: `exchange-digest:${orgId}:${userId}:${local.date}`,
      headers: l.headers,
      tags: { kind: "exchange_digest" },
    });
    if (result.ok) {
      digests++;
      await db
        .from("exchange_notifications")
        .update({ email_sent_at: ctx.now.toISOString() })
        .in(
          "id",
          rows.map((r) => r.id),
        );
    }
  }

  return { ok: true, result: { queued, instant: sent, deferred, movedToDigest, digests } };
}

/** One-click unsubscribe (DN-81): all Exchange email off for this person in this workspace. */
export async function disableExchangeEmails(orgId: string, userId: string): Promise<boolean> {
  const db = OrgScope.global();
  const { error } = await db
    .from("notification_preferences")
    .upsert({ org_id: orgId, user_id: userId, exchange_alerts: "off", exchange_emails: false }, { onConflict: "org_id,user_id" });
  return !error;
}
