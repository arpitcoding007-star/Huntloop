/**
 * "Since your last visit": the window the Command Center's changes card
 * counts over (debt #13). Pure, so the clamping rules are testable.
 *
 * The last visit is a per-browser cookie, `hl_seen_<org>`, written by the
 * dashboard after it renders. Not a database column, on purpose: a column
 * would be another migration to apply before this could work, and a member
 * cannot update their own membership row without a new definer function.
 * The cost is that a second device starts from its own last visit.
 */

export const SEEN_COOKIE_PREFIX = "hl_seen_";
/** No cookie, or one we cannot read: a week, the dashboard's other window. */
export const DEFAULT_WINDOW_DAYS = 7;
/** Away a long time: thirty days, not "everything since March". */
export const MAX_WINDOW_DAYS = 30;

const DAY_MS = 24 * 3600_000;

export function seenCookieName(orgSlug: string): string {
  return `${SEEN_COOKIE_PREFIX}${orgSlug.replace(/[^a-z0-9-]/gi, "")}`;
}

export interface ChangesWindow {
  since: string;
  /** How the card names the window. */
  label: "since your last visit" | "in the last 7 days" | "in the last 30 days";
}

export function resolveWindow(cookie: string | null | undefined, now: Date): ChangesWindow {
  const fallback: ChangesWindow = {
    since: new Date(now.getTime() - DEFAULT_WINDOW_DAYS * DAY_MS).toISOString(),
    label: "in the last 7 days",
  };
  if (!cookie) return fallback;
  const at = Date.parse(cookie);
  if (!Number.isFinite(at) || at > now.getTime()) return fallback;
  const floor = now.getTime() - MAX_WINDOW_DAYS * DAY_MS;
  if (at < floor) return { since: new Date(floor).toISOString(), label: "in the last 30 days" };
  return { since: new Date(at).toISOString(), label: "since your last visit" };
}
