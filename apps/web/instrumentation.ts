import * as Sentry from "@sentry/nextjs";

/**
 * Next's instrumentation hook. Runs once per runtime, before anything else.
 *
 * The two configs are imported dynamically and conditionally because the Node
 * and edge SDK builds are not interchangeable — importing the Node one into an
 * edge bundle pulls in `node:` built-ins that do not exist there and fails the
 * build.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

/**
 * Server-side errors, including ones thrown inside Server Components and
 * Server Actions.
 *
 * This is the half that `app/error.tsx` cannot see. That boundary is a Client
 * Component: it receives a `digest` and renders a message, but the actual
 * error — stack, cause, which action threw — never crosses to the browser, by
 * design. Without this hook the server side of every failure is invisible,
 * which was the state the audit recorded as ANL-01.
 */
export const onRequestError = Sentry.captureRequestError;
