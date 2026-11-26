import * as Sentry from "@sentry/nextjs";

/**
 * The engine-stopped alert (V-15, pass 22 plan item 10).
 *
 * Every alarm the engine raised about itself lived inside the tick: the tick
 * workflow turned red, and `/api/health` reported a stall when something
 * polled it. A tick that never arrives raises neither, and nobody polls
 * `/api/health` until an uptime monitor is set up. So a stopped engine was
 * discovered by a person.
 *
 * A Sentry cron monitor inverts that. Each tick checks in; Sentry raises an
 * issue (and its alert rules notify) when a check-in is *missing*. The alarm
 * lives outside the thing that stopped. The monitor is created on the first
 * check-in from the config below, so there is nothing to set up in Sentry
 * beyond the DSN.
 *
 * Both drivers report under one slug: GitHub Actions and Inngest call the
 * same engine, and the question is "is the engine running", not "which clock
 * called it".
 */

export const ENGINE_MONITOR_SLUG = "engine-tick";

export const ENGINE_MONITOR_CONFIG = {
  schedule: { type: "crontab", value: "*/5 * * * *" },
  /* Ten minutes past the expected time, so three missed five-minute ticks:
     the same fifteen minutes as `STALLED_AFTER_SECONDS` in `queue-health.ts`. */
  checkinMargin: 10,
  /* The route's `maxDuration` is 60 s; anything still running at 2 min was
     killed by the platform without reporting. */
  maxRuntime: 2,
  timezone: "UTC",
  /* One missed tick is noise (a slow deploy); two in a row is an engine
     that has stopped. One good tick resolves it. */
  failureIssueThreshold: 2,
  recoveryThreshold: 1,
} satisfies Parameters<typeof Sentry.withMonitor>[2];

/**
 * Run one engine tick inside the monitor.
 *
 * A throw is reported as a failed check-in and re-thrown, so each route keeps
 * its own error handling. Without a DSN this is just `run()`: no DSN is a
 * normal state, and nothing here pretends otherwise.
 *
 * The flush matters on serverless: the function can be frozen the moment the
 * response is sent, and an unsent check-in is a false alarm twenty minutes
 * later.
 */
export async function monitorEngineTick<T>(run: () => Promise<T>): Promise<T> {
  if (!process.env.SENTRY_DSN?.trim()) return run();
  try {
    return await Sentry.withMonitor(ENGINE_MONITOR_SLUG, run, ENGINE_MONITOR_CONFIG);
  } finally {
    await Sentry.flush(2000).catch(() => false);
  }
}
