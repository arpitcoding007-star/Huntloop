import { notFound } from "next/navigation";
import { isEngineRunning, lastTickAt } from "../../../../lib/data/engine";
import { getDb } from "../../../../lib/data/org";
import { opsSnapshot } from "../../../../lib/data/ops";
import { canAdmin, currentViewer } from "../../../../lib/data/membership";
import { OpsBoard } from "./OpsBoard";

/**
 * The engine, as an operator sees it — `JOB-01`.
 *
 * ── What was missing ─────────────────────────────────────────────────────
 *
 * A job that exhausted its attempts set `status = 'failed'` and was never read
 * by anything. The only symptom of the work not happening was an absence: a
 * company that never got researched, a message that never went. That is the
 * hardest kind of failure to notice, and the easiest to misread as the product
 * simply being bad at its job.
 *
 * ── Why this page is not behind an admin-only route guard ────────────────
 *
 * Any member may look. Understanding why nothing has happened for two days is
 * not a privileged question, and hiding the answer from the person who noticed
 * is how a support ticket becomes a churn risk. Only the *buttons* are
 * admin-gated — `retry_job` and `cancel_job` check `has_org_role(..., 'admin')`
 * in the database, so the gate holds regardless of what this page renders.
 */
export default async function OpsPage({
  params,
}: {
  params: Promise<{ org: string }>;
}) {
  const { org } = await params;

  const viewer = await currentViewer(org);
  if (!viewer) notFound();

  /* Demo mode has no `job_executions` to read. Rather than fabricating a
     healthy-looking queue — which on this screen of all screens would be a lie
     with consequences — the board renders its empty state and says why. */
  const orgId = viewer.kind === "member" ? viewer.orgId : null;
  const db = orgId ? await getDb() : null;

  const snapshot =
    db && orgId ? await opsSnapshot(db, orgId) : { health: [], dead: [], pressure: null };
  const lastTick = db && orgId ? await lastTickAt(db, orgId) : null;

  return (
    <OpsBoard
      org={org}
      snapshot={snapshot}
      canAdmin={canAdmin(viewer)}
      engineRunning={isEngineRunning()}
      lastTickAt={lastTick}
      live={Boolean(db && orgId)}
      /* One instant for every relative age on the page, so two rows an hour
         apart cannot be rendered against two different "now"s. */
      now={new Date().toISOString()}
    />
  );
}
