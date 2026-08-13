import * as Sentry from "@sentry/nextjs";

/**
 * Server-side error reporting.
 *
 * Initialising with an empty DSN is a no-op rather than an error, which is the
 * behaviour we want: no DSN is a normal state (local development, and any
 * deployment before observability is provisioned), and the same rule the rest
 * of this codebase applies to missing credentials applies here — say nothing
 * rather than fail, and never pretend.
 *
 * `SENTRY_DSN` is deliberately not `NEXT_PUBLIC_`. A server DSN in the client
 * bundle is not a secret leak in the usual sense — DSNs are write-only and
 * public by design — but it does let anyone forge events into your project,
 * and the client has its own DSN and its own sampling.
 */
Sentry.init({
  dsn: process.env.SENTRY_DSN,

  /*
   * Traces are off by default.
   *
   * The one thing worth tracing here is the analyze path, which takes tens of
   * seconds and is the product's most expensive operation — but it is also
   * user-initiated and low-volume, so a sampled trace tells you little that
   * `ai_runs.latency_ms` does not already record per call, with the model and
   * prompt version attached. Turn this up deliberately when there is a
   * question it answers, rather than paying for spans nobody reads.
   */
  tracesSampleRate: 0,

  /*
   * Do not send PII.
   *
   * This is a B2B tool whose error payloads would otherwise carry prospect
   * email addresses, company research, and the contents of outreach drafts —
   * i.e. our customers' commercial data and third parties' personal data, in
   * a system neither of them agreed to. `sendDefaultPii: false` is the SDK
   * default; it is set explicitly because it is a decision, not an oversight.
   */
  sendDefaultPii: false,

  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,

  /**
   * Last chance to drop something before it leaves the process.
   *
   * ModelRefusalError is the case worth filtering: the model declining a
   * request is an *answer*, surfaced to the user by design (see client.ts),
   * not an outage. Reporting it would train everyone to ignore the alert
   * channel, which is the failure mode that makes error reporting useless.
   */
  beforeSend(event, hint) {
    const error = hint.originalException;
    if (error instanceof Error && error.name === "ModelRefusalError") return null;
    return event;
  },
});
