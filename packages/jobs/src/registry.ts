/**
 * Job name → the function that does it.
 *
 * Typed as a total map over `JobName`, so adding a name to that union without
 * writing a handler is a compile error rather than a job that queues, claims,
 * throws "no handler", retries three times and fails. That failure is
 * particularly nasty because it looks like a bug in the *work* rather than in
 * the wiring.
 */
import type { OrgScope } from "./scope.ts";
import type { JobName, JobRow } from "./queue.ts";

export interface JobContext {
  scope: OrgScope;
  payload: Record<string, unknown>;
  job: JobRow;
  /**
   * Adds work discovered while doing this job.
   *
   * A handler enqueues through `queue.ts` directly today; this is here as the
   * seam for a future runner that batches enqueues into the same transaction
   * as the completion. Not used yet, and deliberately not pretended to be.
   */
  now: Date;
}

export type JobOutcome =
  | { ok: true; result: Record<string, unknown> }
  /**
   * `permanent` skips the remaining attempts.
   *
   * The distinction is worth the field. "The feed timed out" and "the URL has
   * no scheme" both fail; retrying the first is right and retrying the second
   * is three times the noise for the same answer, and buries the first in it.
   */
  | { ok: false; error: string; permanent?: boolean };

export type JobHandler = (ctx: JobContext) => Promise<JobOutcome>;

import { scanSource } from "./handlers/scan-source.ts";
import { scheduleScans } from "./handlers/schedule-scans.ts";
import { researchCompanyJob } from "./handlers/research-company.ts";
import { scoreOpportunity } from "./handlers/score-opportunity.ts";
import { enrichPerson } from "./handlers/enrich-person.ts";
import { scheduleSyncs } from "./handlers/schedule-syncs.ts";
import { scheduleSends } from "./handlers/schedule-sends.ts";
import { syncMailbox } from "./handlers/sync-mailbox.ts";
import { advanceEnrollments } from "./handlers/advance-enrollments.ts";
import { sendMessage } from "./handlers/send-message.ts";

export const HANDLERS: Record<JobName, JobHandler> = {
  schedule_scans: scheduleScans,
  scan_source: scanSource,
  research_company: researchCompanyJob,
  score_opportunity: scoreOpportunity,
  enrich_person: enrichPerson,
  schedule_syncs: scheduleSyncs,
  schedule_sends: scheduleSends,
  sync_mailbox: syncMailbox,
  advance_enrollments: advanceEnrollments,
  send_message: sendMessage,
};
