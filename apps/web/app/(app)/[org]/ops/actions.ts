"use server";

import { revalidatePath } from "next/cache";
import { fail, mutate, ok, type ActionResult } from "../../../../lib/data/org";
import { uuidSchema } from "../../../../lib/validation";

/**
 * The two things an operator does to a stuck job.
 *
 * ── Why both go through a database function ──────────────────────────────
 *
 * `job_executions` is written by the service-role client, and `apps/` may not
 * import it — the argument in `packages/db/src/admin.ts`. `0019` therefore put
 * retry and cancel in `security definer` functions that check
 * `has_org_role(..., 'admin')` themselves, so the authorisation lives beside
 * the write rather than in whichever caller remembered it.
 *
 * `minRole: "admin"` is asked for here as well. That is not redundant: the
 * function raises an exception, which `mutate` turns into a Postgres message,
 * and "not an admin of <uuid>" is not a sentence to show somebody. The check
 * above it produces the readable refusal; the one below it is the one that is
 * actually load-bearing.
 */

export async function retryJobAction(
  org: string,
  jobId: string,
): Promise<ActionResult<undefined>> {
  const id = uuidSchema.safeParse(jobId);
  if (!id.success) return fail("That job reference isn't valid.");

  return mutate(
    org,
    "retryJob",
    async ({ db, orgId }) => {
      const { data, error } = await db.rpc("retry_job", { p_org: orgId, p_job: id.data });
      if (error) return fail(`That job could not be retried: ${error.message}`);

      revalidatePath(`/${org}/ops`);

      /* False means the row was not in `failed` — somebody else retried it, or
         it is running now. Not an error, and worth saying precisely: "retried"
         when nothing was retried is the report this whole screen exists to
         stop the engine from making. */
      return data === true
        ? ok(undefined, "Queued for one more attempt. It runs on the next tick.")
        : ok(undefined, "That job is no longer failed, so nothing was retried.");
    },
    { minRole: "admin" },
  );
}

export async function cancelJobAction(
  org: string,
  jobId: string,
): Promise<ActionResult<undefined>> {
  const id = uuidSchema.safeParse(jobId);
  if (!id.success) return fail("That job reference isn't valid.");

  return mutate(
    org,
    "cancelJob",
    async ({ db, orgId }) => {
      const { data, error } = await db.rpc("cancel_job", { p_org: orgId, p_job: id.data });
      if (error) return fail(`That job could not be cancelled: ${error.message}`);

      revalidatePath(`/${org}/ops`);

      /* Only queued work can be cancelled. A running job holds a lock and may
         be mid-way through a paid provider call; marking it cancelled would
         not stop it and would make the record lie about what happened. */
      return data === true
        ? ok(undefined, "Cancelled. It will not run.")
        : ok(
            undefined,
            "That job is already running or finished, so it was not cancelled — " +
              "stopping it now would not stop the work it has already started.",
          );
    },
    { minRole: "admin" },
  );
}
