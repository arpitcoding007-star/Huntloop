import "server-only";
import { currentUserId, requireOrgId } from "./org";
import { load, type Loaded } from "./source";

/**
 * The signed-in person's notification preferences for one workspace
 * (`notification_preferences`, 0040). Personal: RLS returns only their own
 * row. A missing row means the defaults the digest job applies too.
 */

export interface NotificationPreferences {
  dailyDigest: boolean;
  /** Null before 0071: the column does not exist, so it cannot be saved. */
  assignmentEmails: boolean | null;
  digestHour: number;
  timezone: string;
  lastDigestOn: string | null;
}

export const DEFAULT_NOTIFICATIONS: NotificationPreferences = {
  dailyDigest: true,
  assignmentEmails: true,
  digestHour: 8,
  timezone: "UTC",
  lastDigestOn: null,
};

export async function getNotificationPreferences(
  orgSlug: string,
): Promise<Loaded<NotificationPreferences>> {
  return load(
    async (db) => {
      const orgId = await requireOrgId(orgSlug, "getNotificationPreferences");
      const userId = await currentUserId(db);
      if (!userId) return DEFAULT_NOTIFICATIONS;
      const read = await db
        .from("notification_preferences")
        .select("daily_digest, digest_hour, timezone, last_digest_on, assignment_emails")
        .eq("org_id", orgId)
        .eq("user_id", userId)
        .maybeSingle();
      const before0071 = read.error?.code === "42703";
      const { data, error } = before0071
        ? await db
            .from("notification_preferences")
            .select("daily_digest, digest_hour, timezone, last_digest_on")
            .eq("org_id", orgId)
            .eq("user_id", userId)
            .maybeSingle()
        : read;
      if (error || !data) return { ...DEFAULT_NOTIFICATIONS, assignmentEmails: before0071 ? null : true };
      return {
        dailyDigest: Boolean(data.daily_digest),
        assignmentEmails: before0071 ? null : (data as { assignment_emails?: boolean }).assignment_emails !== false,
        digestHour: Number(data.digest_hour ?? 8),
        timezone: String(data.timezone ?? "UTC"),
        lastDigestOn: data.last_digest_on ? String(data.last_digest_on) : null,
      };
    },
    () => DEFAULT_NOTIFICATIONS,
  );
}

/** Every IANA zone this runtime knows, for the picker and for validation. */
export function supportedTimeZones(): string[] {
  try {
    const zones = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone");
    if (zones?.length) return zones.includes("UTC") ? zones : ["UTC", ...zones];
  } catch {
    /* fall through */
  }
  return ["UTC"];
}
