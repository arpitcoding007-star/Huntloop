import * as Sentry from "@sentry/nextjs";

/**
 * Edge runtime — middleware, and any route opting into it.
 *
 * Separate from the Node config because the edge runtime is a different
 * environment with a different SDK build, not because the settings differ.
 * Keep the two in step.
 *
 * This one covers `middleware.ts`, which is the session refresh and route
 * guard. An error there fails every request on the matcher, so it is the file
 * whose failures most need to be visible.
 */
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0,
  sendDefaultPii: false,
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
});
