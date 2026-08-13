import * as Sentry from "@sentry/nextjs";

/**
 * Browser-side error reporting.
 *
 * `NEXT_PUBLIC_SENTRY_DSN`, not `SENTRY_DSN`: this one is compiled into the
 * client bundle, so it must be a variable that is meant to be public. They are
 * usually the same DSN value, but keeping the names distinct means an
 * accidental swap is visible rather than silently shipping a server-only
 * variable to the browser.
 */
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0,
  sendDefaultPii: false,
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,

  /*
   * Session Replay is off.
   *
   * It is the most useful debugging feature Sentry has and the least
   * appropriate one here: a replay of the opportunity page is a recording of a
   * named prospect's research, and a replay of the analyze screen records what
   * a customer is prospecting. Enabling it would need a masking policy and a
   * conversation with customers, not a config flag.
   */
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,
});

/** Reports slow or failed client-side navigations. */
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
