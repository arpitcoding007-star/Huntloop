/**
 * `send_digests` — the daily "Needs you" email. A cross-tenant sweeper,
 * asked hourly.
 *
 * For each member of each workspace: if their digest is on, and in their own
 * time zone it is now at or past their chosen hour and they have not had one
 * today, claim today (a conditional write, so two overlapping runs cannot both
 * send) and email the top of their queue — ranked by `@huntloop/db/needs-you`,
 * the same rules and the same ownership default as the in-app rail. An empty
 * queue sends nothing: the digest exists to say something needs you.
 *
 * Every digest carries a signed one-click link that turns it off.
 */
import {
  gatherAttention,
  rank,
  type OwnershipFilter,
  type RankedItem,
} from "@huntloop/db/needs-you";
import { isEmailConfigured, sendEmail } from "../email/resend.ts";
import { digestEmail } from "../email/templates.ts";
import { digestUnsubscribeToken } from "../email/digest-token.ts";
import { OrgScope } from "../scope.ts";
import type { JobContext, JobOutcome } from "../registry.ts";

/** Bounds on one run. Overflow is picked up next hour (due = at or past the hour). */
const MAX_MEMBERS = 2000;
const MAX_SENDS = 150;
const ITEMS_IN_EMAIL = 5;

export interface LocalTime {
  date: string;
  hour: number;
}

/** The date and hour in a time zone; falls back to UTC for an unknown zone. */
export function localTime(now: Date, timeZone: string): LocalTime {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) };
  } catch {
    return { date: now.toISOString().slice(0, 10), hour: now.getUTCHours() };
  }
}

export interface DigestPreference {
  dailyDigest: boolean;
  digestHour: number;
  timezone: string;
  lastDigestOn: string | null;
}

export const DEFAULT_PREFERENCE: DigestPreference = {
  dailyDigest: true,
  digestHour: 8,
  timezone: "UTC",
  lastDigestOn: null,
};

/** Whether a person's digest is due now. Pure, so the rule is testable. */
export function digestDue(pref: DigestPreference, now: Date): { due: boolean; date: string } {
  const local = localTime(now, pref.timezone);
  return {
    due: pref.dailyDigest && local.hour >= pref.digestHour && pref.lastDigestOn !== local.date,
    date: local.date,
  };
}

/** The ownership a role starts with — mirrors `defaultOwnership` in the app. */
export function digestFilter(role: string | null): OwnershipFilter {
  return role === "sales" ? "mine" : "everyone";
}

function site(path: string): string | null {
  const base = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  return base ? new URL(path, base).toString() : null;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped admin rows. */

export async function sendDigests(ctx: JobContext): Promise<JobOutcome> {
  if (!isEmailConfigured()) return { ok: true, result: { skipped: "email is not configured" } };
  if (!site("/")) return { ok: true, result: { skipped: "NEXT_PUBLIC_SITE_URL is not set" } };

  const db = OrgScope.global();
  const { data: members, error } = await db
    .from("memberships")
    .select("org_id, user_id, organizations!inner(id, name, slug, deleted_at)")
    .is("deleted_at", null)
    .limit(MAX_MEMBERS);
  if (error) return { ok: false, error: `send_digests: ${error.message}` };

  const rows = ((members ?? []) as any[]).filter((m) => {
    const org = Array.isArray(m.organizations) ? m.organizations[0] : m.organizations;
    return org && !org.deleted_at;
  });
  if (!rows.length) return { ok: true, result: { sent: 0 } };

  const userIds = [...new Set(rows.map((m) => String(m.user_id)))];
  const [prefsRes, profilesRes] = await Promise.all([
    db
      .from("notification_preferences")
      .select("org_id, user_id, daily_digest, digest_hour, timezone, last_digest_on")
      .in("user_id", userIds),
    db.from("profiles").select("id, email, full_name, role").in("id", userIds),
  ]);
  const prefs = new Map(
    ((prefsRes.data ?? []) as any[]).map((p) => [
      `${p.org_id}:${p.user_id}`,
      {
        dailyDigest: Boolean(p.daily_digest),
        digestHour: Number(p.digest_hour ?? 8),
        timezone: String(p.timezone ?? "UTC"),
        lastDigestOn: p.last_digest_on ? String(p.last_digest_on) : null,
      } satisfies DigestPreference,
    ]),
  );
  const profiles = new Map(((profilesRes.data ?? []) as any[]).map((p) => [String(p.id), p]));

  let sent = 0;
  let empty = 0;
  const gathered = new Map<string, Awaited<ReturnType<typeof gatherAttention>>>();

  for (const m of rows) {
    if (sent >= MAX_SENDS) break;
    const orgId = String(m.org_id);
    const userId = String(m.user_id);
    const org = Array.isArray(m.organizations) ? m.organizations[0] : m.organizations;
    const profile = profiles.get(userId);
    if (!profile?.email) continue;

    const existing = prefs.get(`${orgId}:${userId}`);
    const pref = existing ?? DEFAULT_PREFERENCE;
    const { due, date } = digestDue(pref, ctx.now);
    if (!due) continue;

    // Claim today before doing any work, so a second run skips this person.
    const claimed = existing
      ? await db
          .from("notification_preferences")
          .update({ last_digest_on: date })
          .eq("org_id", orgId)
          .eq("user_id", userId)
          .or(`last_digest_on.is.null,last_digest_on.neq.${date}`)
          .select("user_id")
      : await db
          .from("notification_preferences")
          .upsert(
            { org_id: orgId, user_id: userId, last_digest_on: date },
            { onConflict: "org_id,user_id", ignoreDuplicates: true },
          )
          .select("user_id");
    if (!claimed.data?.length) continue;

    // One gather per workspace per run; ranking is per person.
    let attention = gathered.get(orgId);
    if (!attention) {
      attention = await gatherAttention(db, orgId, String(org.slug), ctx.now);
      gathered.set(orgId, attention);
    }
    const { data: snoozes } = await db
      .from("attention_snoozes")
      .select("item_key")
      .eq("org_id", orgId)
      .eq("user_id", userId)
      .gt("snoozed_until", ctx.now.toISOString());

    const items: RankedItem[] = rank(attention.candidates, {
      now: ctx.now,
      snoozed: new Set(((snoozes ?? []) as any[]).map((s) => String(s.item_key))),
      filter: digestFilter(profile.role ?? null),
      userId,
      quietAfterBusinessDays: attention.quietAfter,
    });
    if (items.length === 0) {
      empty++;
      continue;
    }

    const token = digestUnsubscribeToken(orgId, userId);
    const firstName = typeof profile.full_name === "string" ? profile.full_name.split(" ")[0] || null : null;
    const result = await sendEmail({
      to: String(profile.email),
      ...digestEmail({
        orgName: String(org.name),
        firstName,
        items: items.slice(0, ITEMS_IN_EMAIL).map((i) => ({
          title: `${i.label}: ${i.title}`,
          why: i.why,
          href: site(i.href) ?? i.href,
        })),
        total: items.length,
        needsYouUrl: site(`/${org.slug}/needs-you`)!,
        preferencesUrl: site(`/${org.slug}/settings#notifications`)!,
        unsubscribeUrl: token
          ? site(`/api/notifications/unsubscribe?token=${encodeURIComponent(token)}`)!
          : site(`/${org.slug}/settings#notifications`)!,
      }),
      idempotencyKey: `digest:${orgId}:${userId}:${date}`,
      headers: token
        ? {
            "List-Unsubscribe": `<${site(`/api/notifications/unsubscribe?token=${encodeURIComponent(token)}`)}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          }
        : undefined,
      tags: { kind: "digest" },
    });
    if (result.ok) sent++;
  }

  return { ok: true, result: { sent, empty, considered: rows.length } };
}

/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Turns one person's digest off — the target of the signed link. Exported for
 * the unsubscribe route, which has no session and may not use the
 * service-role client itself.
 */
export async function disableDigest(orgId: string, userId: string): Promise<boolean> {
  const db = OrgScope.global();
  const { error } = await db
    .from("notification_preferences")
    .upsert({ org_id: orgId, user_id: userId, daily_digest: false }, { onConflict: "org_id,user_id" });
  return !error;
}
