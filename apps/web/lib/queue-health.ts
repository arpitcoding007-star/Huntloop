/**
 * Is the job queue moving? The answer `/api/health` gives (debt #19).
 *
 * The tick already turns its own GitHub run red when the oldest due job has
 * waited too long (`tick.yml`, P0-6). That alarm has a blind spot: it lives
 * inside the tick, so a tick that never arrives (a deleted secret, GitHub
 * pausing schedules on a quiet repository, a disabled workflow) raises
 * nothing. A dead cron was discovered by a person.
 *
 * `/api/health` is what an uptime monitor polls from outside, so the same
 * measurement there alerts on the missing heartbeat as well as the slow one.
 */

/** The tick workflow's threshold. Fifteen minutes is three missed 5-minute ticks. */
export const STALLED_AFTER_SECONDS = 900;

export type QueueState =
  /** Nothing due has waited longer than the threshold. */
  | "ok"
  /** A due job has waited longer than the threshold: ticks are missing or not keeping up. */
  | "stalled"
  /** The probe ran and could not read the queue. Never reported as healthy. */
  | "unknown"
  /** Not probed, because the database or the service key is not there to probe with. */
  | "unchecked";

/** `lag` is `oldestDueSeconds()`: seconds, 0 when nothing is due, null when unreadable. */
export function queueState(lag: number | null): Exclude<QueueState, "unchecked"> {
  if (lag === null || !Number.isFinite(lag)) return "unknown";
  return lag > STALLED_AFTER_SECONDS ? "stalled" : "ok";
}

/** Only these fail the health check; "unchecked" is covered by the database and key checks. */
export function queueBlocksHealth(state: QueueState): boolean {
  return state === "stalled" || state === "unknown";
}

export type HeartbeatState =
  /** A sweep ran within the threshold: something is calling the tick. */
  | "ok"
  /** The last sweep is older than the threshold: the tick has stopped arriving. */
  | "late"
  /** No sweep has ever run on this database. Nothing has ever driven the engine. */
  | "never"
  /** The probe ran and could not read the queue. Never reported as healthy. */
  | "unknown"
  /** Not probed, because the database or the service key is not there to probe with. */
  | "unchecked";

/**
 * V-15: is anything calling the tick at all?
 *
 * `queueState` has a blind spot on a quiet queue. The sweepers are enqueued
 * by the tick, so when ticks stop nothing due accumulates and the lag reads 0.
 * The age of the last sweep is the missing heartbeat. Same threshold: three
 * missed five-minute ticks.
 *
 * `since` is `lastSweepSeconds()`: seconds, "never", or null when unreadable.
 */
export function heartbeatState(
  since: number | "never" | null,
): Exclude<HeartbeatState, "unchecked"> {
  if (since === "never") return "never";
  if (since === null || !Number.isFinite(since)) return "unknown";
  return since > STALLED_AFTER_SECONDS ? "late" : "ok";
}

/** Everything except "ok" and "unchecked" fails the check. */
export function heartbeatBlocksHealth(state: HeartbeatState): boolean {
  return state !== "ok" && state !== "unchecked";
}
