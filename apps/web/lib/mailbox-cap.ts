/**
 * A mailbox's real allowance today (DB-103).
 *
 * `mailbox_daily_cap` (0048) in TypeScript, for the screens: the configured
 * limit, lowered during warm-up to 10 + 5 a day and by any warm-up target.
 * Showing `daily_limit` alone told a new mailbox's owner "0 / 50" while sends
 * stopped at 10.
 */
export function mailboxDailyCap(
  row: { daily_limit?: unknown; warmup_started_at?: unknown; warmup_target?: unknown },
  now: Date = new Date(),
): number {
  const limit = Number(row.daily_limit ?? 0);
  const target = row.warmup_target == null ? limit : Number(row.warmup_target);
  const started = row.warmup_started_at ? new Date(String(row.warmup_started_at)).getTime() : null;
  const ramp = started === null ? limit : 10 + 5 * Math.max(0, Math.floor((now.getTime() - started) / 86_400_000));
  return Math.min(limit, target, ramp);
}
