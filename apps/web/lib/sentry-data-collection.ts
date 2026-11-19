/**
 * What Sentry may collect, for every runtime (browser, Node, edge).
 *
 * ── Why this file exists ─────────────────────────────────────────────────
 *
 * Sentry v11 replaced `sendDefaultPii: false` with `dataCollection`, and the
 * new defaults collect far more: user info, cookies, request and response
 * headers and bodies, URL query parameters, database query data, AI inputs and
 * outputs, and the values of local variables in stack frames. In this app any
 * of those can hold a prospect's email address, a reply's text, a session
 * cookie or an API token.
 *
 * So every field is set explicitly to the v10 behaviour this app had (nothing
 * personal leaves), and the three `Sentry.init` calls share one object, so the
 * browser, server and edge cannot drift apart. Sentry still receives the error
 * type, message, stack trace and source lines around each frame, which is what
 * the error reports are for.
 *
 * Changing any of these to `true` sends personal data to a third party: it
 * needs a privacy review and an update to the sub-processor list in /privacy.
 */
export const SENTRY_DATA_COLLECTION = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [],
  urlQueryParams: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  mcp: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
};
/* Not `as const`: Sentry's `DataCollection` takes a mutable `httpBodies`
   array, and the type is not re-exported from `@sentry/nextjs`, so this is
   checked structurally where it is passed to `Sentry.init`. */
