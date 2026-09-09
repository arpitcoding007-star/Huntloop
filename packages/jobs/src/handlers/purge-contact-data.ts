/**
 * `purge_contact_data` — CMPL-01's erasure half, run as a job.
 *
 * ── Why erasure is a job and not a button ────────────────────────────────
 *
 * `erase_contact` touches five tables, redacts message bodies, and writes an
 * audit row. Doing that inside a Server Action means a person watching a
 * spinner decides whether it finishes: a closed tab halfway through leaves a
 * contact whose points are gone and whose messages still carry their name,
 * which is the one state an erasure must never end in. A job retries, and the
 * function is written to be safe to run twice.
 *
 * ── The property that makes this safe, and is easy to get backwards ──────
 *
 * **Suppression survives erasure.** `0017` keeps a hash of the address on the
 * suppression list after deleting the address itself, and `can_contact` checks
 * that hash. Without it, erasing somebody would make them contactable again —
 * the request to be forgotten would delete the only record of their having
 * asked not to be written to. The SQL holds that property; this handler exists
 * to make sure the SQL is what actually runs.
 *
 * ── What it deliberately does not do ─────────────────────────────────────
 *
 * Decide who may ask. Authorisation belongs at the request boundary, where
 * there is a session to check — `erase_contact_for_org` is the admin-gated
 * wrapper for that. By the time a job is running, the row that enqueued it is
 * the authorisation, and re-deriving consent from a payload would be inventing
 * a check rather than making one.
 */
import type { JobContext, JobOutcome } from "../registry.ts";

export interface PurgeContactDataPayload {
  /** The address to erase. Normalised by the function, not by the caller. */
  email: string;
  /**
   * Who asked. Null for a purge the system initiated — a retention sweep, or
   * a request that arrived through a channel with no user attached.
   *
   * `write_audit_log_internal`'s reasoning applies: substituting an owner's id
   * for "nobody clicked anything" puts a person's name against a machine's
   * decision, which is worse than an empty column in exactly the situation an
   * audit trail exists for.
   */
  requestedBy?: string | null;
}

export async function purgeContactData(ctx: JobContext): Promise<JobOutcome> {
  const { scope, payload } = ctx;
  const email = String(payload.email ?? "").trim();

  if (!email) {
    return { ok: false, permanent: true, error: "purge_contact_data: no email in payload." };
  }

  const { data, error } = await scope.rpc("erase_contact", {
    p_org: scope.orgId,
    p_email: email,
    p_actor: payload.requestedBy ? String(payload.requestedBy) : null,
  });

  if (error) return { ok: false, error: `purge_contact_data: ${error.message}` };

  /* The counts come back from the function so the audit row and the job result
     say the same thing. An erasure that reports "done" without saying what it
     removed cannot be verified afterwards, and CMPL-01's whole requirement is
     a *verifiable* deletion. */
  const removed = (data ?? {}) as Record<string, unknown>;

  return {
    ok: true,
    result: {
      email,
      /* Zeroes are a real answer and are kept: "we held nothing about this
         person" is the correct response to some erasure requests, and it is
         not the same as the job having failed to look. */
      contactPoints: Number(removed.contact_points ?? 0),
      messagesRedacted: Number(removed.messages_redacted ?? 0),
      enrichmentRecords: Number(removed.enrichment_records ?? 0),
      people: Number(removed.people ?? 0),
    },
  };
}
