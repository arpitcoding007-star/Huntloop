/**
 * `enforce_retention` — CMPL-02. Delete what an org said it does not want to
 * keep, and only that.
 *
 * ── Why the default is "keep everything" ─────────────────────────────────
 *
 * `organizations.contact_retention_days` is null unless somebody sets it, and
 * `prune_stale_contacts` returns 0 immediately when it is. That is the honest
 * default: silently deleting a customer's prospect database because this
 * product picked 365 would be far worse than not having the feature. A
 * retention period is a policy the customer owns, and this job enforces the
 * one they chose rather than one we assumed.
 *
 * ── Why it sweeps rather than being scheduled per org ────────────────────
 *
 * There is no `next_prune_at` column, deliberately. A schedule column is a
 * second source of truth about when something last ran, and it drifts out of
 * agreement with what actually happened the first time a job fails between
 * doing the work and updating the column. Retention is idempotent — pruning
 * twice in a day removes nothing the second time — so the cheapest correct
 * design is to ask every configured org, daily, and let the SQL decide there
 * is nothing to do.
 *
 * ── What is deliberately out of reach ────────────────────────────────────
 *
 * `prune_stale_contacts` removes contact *points* and enrichment for people
 * with no outreach history. It does not touch companies, opportunities, or
 * anything a person authored, and it skips anybody who has ever been messaged
 * or who is a primary contact on a live opportunity. An automatic delete that
 * removed a customer's pipeline would be a catastrophe caused by a feature
 * they turned on in order to be careful.
 */
import { OrgScope } from "../scope.ts";
import type { JobContext, JobOutcome } from "../registry.ts";

/**
 * How many orgs one tick prunes.
 *
 * Generous compared to `schedule_learning`'s five, because this spends no
 * money and makes no model calls — it is one DELETE per org against indexed
 * columns. The cap exists so that a tick has a bounded duration, not so that a
 * bill has a bounded size.
 */
const MAX_PER_TICK = 50;

export async function enforceRetention(_ctx: JobContext): Promise<JobOutcome> {
  /* Cross-tenant by nature — "which orgs have a retention policy" — and every
     write below is scoped back to one org through the function's own `p_org`.
     The same legitimate use `schedule_scans` documents. */
  const db = OrgScope.global();

  const { data: orgs, error } = await db
    .from("organizations")
    .select("id, contact_retention_days")
    .not("contact_retention_days", "is", null)
    .is("deleted_at", null)
    .limit(MAX_PER_TICK);

  if (error) return { ok: false, error: `enforce_retention: ${error.message}` };

  const configured = (orgs ?? []) as { id: string; contact_retention_days: number }[];
  if (!configured.length) {
    /* The common case on most deployments, and not worth an audit row or a
       failure. Nobody has asked for anything to be deleted. */
    return { ok: true, result: { orgs: 0, removed: 0 } };
  }

  let removed = 0;
  const failures: string[] = [];

  for (const org of configured) {
    const scope = new OrgScope(String(org.id), db);

    const { data, error: pruneError } = await scope.rpc("prune_stale_contacts", {
      p_org: String(org.id),
    });

    if (pruneError) {
      /* One org's failure does not stop the sweep. A tenant whose prune fails
         is a tenant whose data is still there — the safe direction — and
         aborting would mean one broken org suspends retention for every
         other. */
      failures.push(`${org.id}: ${pruneError.message}`);
      continue;
    }

    const count = Number(data ?? 0);
    removed += count;

    /* Recorded only when something was actually deleted. CMPL-02 requires the
       deletion to be recorded; it does not require a daily row saying nothing
       happened, and an audit log that is mostly "nothing happened" is one
       nobody reads on the day it matters. */
    if (count > 0) {
      await scope.rpc("write_audit_log_internal", {
        p_org: String(org.id),
        p_action: "contact_data.retention_pruned",
        p_target_type: "organization",
        p_target_id: String(org.id),
        p_meta: { removed: count, retentionDays: org.contact_retention_days },
      });
    }
  }

  return {
    ok: true,
    result: {
      orgs: configured.length,
      removed,
      ...(failures.length ? { failures } : {}),
    },
  };
}
