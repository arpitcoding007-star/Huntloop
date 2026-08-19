/**
 * Public surface of @huntloop/jobs.
 *
 * ── Where the tick comes from ────────────────────────────────────────────
 *
 * The queue is `job_executions` in Postgres, always. What varies is who calls
 * `tick()`, and there are two supported answers:
 *
 *   Vercel Cron    `vercel.json` schedules `/api/jobs/tick`, which
 *                  authenticates with `CRON_SECRET` and calls `tick()`. This
 *                  is the default and needs no third-party account.
 *   Inngest        When `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` are set,
 *                  `/api/inngest` serves the same handlers on Inngest's
 *                  schedule and retry semantics instead.
 *
 * Both drive the same `tick()`. That is the point of the split: the durability
 * of the work does not depend on which scheduler is configured, so moving
 * between them is an operations decision rather than a migration. See
 * `isInngestConfigured()`.
 *
 * ── What this package does not export ────────────────────────────────────
 *
 * The admin client. `OrgScope` is the only way a handler reaches the database,
 * and it is bound to one org id — see `scope.ts` for why that is mechanical
 * rather than a convention. `adminClient()` is exported for the runner and for
 * the tests that inject a fake, and for nothing else.
 */

export { OrgScope, adminClient, setAdminClientForTests } from "./scope.ts";

export {
  claim,
  enqueue,
  markFailed,
  requeueStalled,
  succeed,
  type EnqueueOptions,
  type Enqueued,
  type JobName,
  type JobRow,
} from "./queue.ts";

export { HANDLERS, type JobContext, type JobHandler, type JobOutcome } from "./registry.ts";
export { sweep, tick, type TickOptions, type TickReport } from "./runner.ts";

export {
  FetchRefused,
  assertFetchable,
  fetchPage,
  type FetchedPage,
} from "./fetch.ts";

export {
  UnreadableContent,
  canonicalize,
  extract,
  hash,
  urlHash,
  type ExtractedDocument,
  type Extraction,
} from "./extract.ts";

export {
  enrichmentProvider,
  findContacts,
  verificationProvider,
  verifyEmail,
  type ContactCandidate,
  type ContactKind,
  type Verification,
  type VerificationStatus,
} from "./providers.ts";

export { AiUnavailable, runForOrg } from "./ai.ts";

/**
 * Whether Inngest is configured to drive the tick.
 *
 * Both keys, not either. The event key publishes and the signing key
 * authenticates the callbacks Inngest makes back to us; one without the other
 * is a half-wired integration that fails at the first invocation, and it fails
 * in the direction where jobs silently stop rather than loudly break.
 */
export function isInngestConfigured(): boolean {
  return Boolean(
    process.env.INNGEST_EVENT_KEY?.trim() && process.env.INNGEST_SIGNING_KEY?.trim(),
  );
}

/**
 * The secret a cron invocation must present.
 *
 * Returns null when unset, and the route refuses every request in that state.
 * Failing closed matters here more than it looks: `/api/jobs/tick` runs work
 * for every tenant, and an unauthenticated version of it is a way for anyone
 * to make this deployment fetch arbitrary URLs and spend its model budget.
 */
export function cronSecret(): string | null {
  return process.env.CRON_SECRET?.trim() || null;
}

export {
  MailboxUnavailable,
  authorize,
  configuredProviders,
  isProviderConfigured,
  pickMailbox,
  providerFor,
  type AuthorizedMailbox,
  type OAuthTokens,
  type ProviderId,
} from "./mailbox/index.ts";
