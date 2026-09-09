/**
 * `recompute_scores` — SCO-03. Rescore an org's opportunities after the thing
 * they were scored against has changed.
 *
 * ── The problem it solves ────────────────────────────────────────────────
 *
 * A score is a verdict about a company *relative to a profile and a rule set*.
 * Edit the ICP or a scoring rule and every existing score is describing a
 * question nobody is asking any more — but the scores stay on the screen,
 * ranked, looking current, because nothing recomputes them. The scores are
 * only re-derived when a company happens to get fresh evidence, so the list a
 * salesperson works from is a mixture of verdicts from before and after the
 * change, in no visible order.
 *
 * ── Why it fans out instead of scoring inline ────────────────────────────
 *
 * Each rescore is a model call. Doing four hundred of them inside one job
 * means one row in `job_executions` that runs for an hour, holds a claim the
 * whole time, and loses everything if it fails at row 390. Fanning out into
 * one `score_opportunity` per company gives per-company retries, per-company
 * cost attribution, and a queue depth somebody can watch — and the existing
 * per-org AI budget then throttles the whole recomputation for free, because
 * every child asks `withinBudget` on its own.
 *
 * ── Why the batch is capped, and why that is not a limitation ────────────
 *
 * `MAX_PER_RUN` companies per run, then the job re-enqueues itself with a
 * cursor. An org with four thousand opportunities recomputes over several
 * ticks rather than emptying its monthly model quota in one, and a person
 * watching sees progress rather than a job that has been "running" for
 * twenty minutes.
 *
 * ── What it deliberately does not do ─────────────────────────────────────
 *
 * Decide that a recomputation is worth doing. `§11` keeps a human in front of
 * anything that moves opportunities between bands, and the preview — how many
 * would change band — belongs on the screen that asks. This job runs a
 * decision somebody already made.
 */
import { enqueue } from "../queue.ts";
import type { JobContext, JobOutcome } from "../registry.ts";

export interface RecomputeScoresPayload {
  /**
   * The `score_recompute_requests` row this pass belongs to.
   *
   * Optional, because the job is also useful on its own — an operator draining
   * a rule change by hand does not need a request row. When present, progress
   * is reported against it and a cancellation is obeyed.
   */
  requestId?: string;
  /**
   * Why. Recorded on every score this produces, so a history can distinguish
   * a rule change from a market change. Anything outside `0016`'s enum is
   * normalised by `score_opportunity` itself.
   */
  reason?: string;
  /** Restrict to one profile. Omitted means the org's active one. */
  icpId?: string;
  /**
   * Resume point: only companies whose id sorts after this are considered.
   * Set by the job when it re-enqueues itself, never by a person.
   */
  after?: string;
}

/**
 * Companies per run.
 *
 * Two hundred is a compromise between two failure modes. Too small and a large
 * org takes an implausible number of ticks; too large and one org's
 * recomputation is the whole queue for an hour, starving the scans and sends
 * that are somebody's actual work today.
 */
const MAX_PER_RUN = 200;

export async function recomputeScores(ctx: JobContext): Promise<JobOutcome> {
  const { scope, payload } = ctx;
  const reason = String(payload.reason ?? "rule_change");
  const after = payload.after ? String(payload.after) : null;

  /* Ordered by id rather than by score or date, because the cursor has to be
     stable while the batch runs. Ordering by `last_scored_at` — the intuitive
     choice — would reorder rows *as this job rescored them*, and a cursor over
     a column the job is changing skips and repeats rows unpredictably. */
  let query = scope
    .select("opportunities", "id, company_id")
    .is("deleted_at", null)
    .order("company_id", { ascending: true })
    .limit(MAX_PER_RUN);

  if (payload.icpId) query = query.eq("icp_id", String(payload.icpId));
  if (after) query = query.gt("company_id", after);

  const requestId = payload.requestId ? String(payload.requestId) : null;

  const { data, error } = await query;
  if (error) {
    if (requestId) {
      await scope.rpc("fail_recompute", { p_request: requestId, p_error: error.message });
    }
    return { ok: false, error: `recompute_scores: ${error.message}` };
  }

  const rows = (Array.isArray(data) ? data : []) as { id: string; company_id: string }[];
  if (!rows.length) {
    if (requestId) {
      await scope.rpc("advance_recompute", {
        p_request: requestId,
        p_cursor: after,
        p_seen: 0,
        p_enqueued: 0,
        p_done: true,
      });
    }
    return { ok: true, result: { enqueued: 0, done: true } };
  }

  let enqueued = 0;
  for (const row of rows) {
    const companyId = String(row.company_id);
    const { created } = await enqueue({
      orgId: scope.orgId,
      name: "score_opportunity",
      payload: {
        companyId,
        reason,
        ...(payload.icpId ? { icpId: String(payload.icpId) } : {}),
      },
      /* Deliberately the same key `scan_source` uses. A company that is being
         rescored because a rule changed does not also need rescoring because
         an article mentioned it — the answer would be identical, and the
         second call would be paid for twice. Collapsing them means a
         recomputation running during a scan costs one score per company, not
         two. */
      idempotencyKey: `score:${companyId}`,
    });
    if (created) enqueued++;
  }

  const last = String(rows[rows.length - 1]!.company_id);
  const more = rows.length === MAX_PER_RUN;

  /* Progress, and the cancellation check in the same call.
     A job already in flight cannot be interrupted, so "stop" has to reach it
     as an answer to something it was going to ask anyway. `advance_recompute`
     returns the status after the update, and a request somebody cancelled
     comes back `cancelled` — at which point this pass stops enqueueing the
     next one and the recomputation ends after at most one more batch. */
  let cancelled = false;
  if (requestId) {
    const { data: status } = await scope.rpc("advance_recompute", {
      p_request: requestId,
      p_cursor: last,
      p_seen: rows.length,
      p_enqueued: enqueued,
      p_done: !more,
    });
    cancelled = String(status ?? "") === "cancelled";
  }

  /* More to do. Re-enqueued rather than looped, so each run is a bounded unit
     of work with its own claim, its own retry, and its own row somebody can
     see — and so a recomputation can be stopped between batches rather than by
     killing a process. */
  if (more && !cancelled) {
    await enqueue({
      orgId: scope.orgId,
      name: "recompute_scores",
      payload: {
        reason,
        after: last,
        ...(requestId ? { requestId } : {}),
        ...(payload.icpId ? { icpId: String(payload.icpId) } : {}),
      },
      /* Keyed on the cursor. Two triggers firing at once — a rule edit and an
         ICP edit in the same minute — collapse into one recomputation rather
         than two interleaved passes over the same companies. */
      idempotencyKey: `recompute:${payload.icpId ?? "active"}:${last}`,
    });
  }

  return {
    ok: true,
    result: {
      considered: rows.length,
      enqueued,
      /* The difference between the two is not noise: it is how many companies
         were already queued for scoring, which is the number that says whether
         a recomputation was redundant. */
      alreadyQueued: rows.length - enqueued,
      done: !more || cancelled,
      ...(cancelled ? { cancelled: true } : {}),
      ...(more && !cancelled ? { nextCursor: last } : {}),
    },
  };
}
