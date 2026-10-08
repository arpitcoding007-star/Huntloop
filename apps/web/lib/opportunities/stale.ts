/**
 * Which opportunities are stale — the Opportunities list's "Stale" view and
 * bulk archive (§7.1.1). Pure, with tests beside the row mapper.
 */

/** Days without a person acting on it before an untouched opportunity is stale. */
export const STALE_AFTER_DAYS = 60;
/** A trigger older than this no longer makes it timely. */
const STALE_TRIGGER_DAYS = 90;
const BEFORE_CONTACT = new Set(["discovered", "researching", "qualified", "assigned"]);
const DAY = 86_400_000;

/**
 * Stale: found at least 60 days ago, never taken past "assigned", and with no
 * trigger in the last 90 days. These are what fill the backlog cap (0038) and
 * pause discovery while nobody reads them; archiving them resumes it. Anything
 * contacted is never stale by this rule — a conversation is not clutter.
 */
export function isStale(
  row: { stage: string; firstSeenAt: string | null; triggerDate: string | null },
  now: Date,
): boolean {
  if (!BEFORE_CONTACT.has(row.stage) || !row.firstSeenAt) return false;
  const found = Date.parse(row.firstSeenAt);
  if (!Number.isFinite(found) || now.getTime() - found < STALE_AFTER_DAYS * DAY) return false;
  const trigger = row.triggerDate ? Date.parse(row.triggerDate) : NaN;
  return !(Number.isFinite(trigger) && now.getTime() - trigger < STALE_TRIGGER_DAYS * DAY);
}
