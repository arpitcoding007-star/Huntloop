import { notFound } from "next/navigation";
import { Card, CardBody, Note } from "@huntloop/ui";
import { describeAuditAction } from "../../../../../lib/audit-labels";
import { listAudit, type AuditRecord } from "../../../../../lib/data/audit";
import { canAdmin, currentViewer } from "../../../../../lib/data/membership";
import { requireOrgId } from "../../../../../lib/data/org";
import { load } from "../../../../../lib/data/source";
import { DemoFigures } from "../../DemoFigures";

/**
 * Activity log — the reader `audit_logs` never had.
 *
 * Every privileged action has gone through `recordAudit` since `0007`, and
 * `0001` gave admins a read policy, but no screen read the table. A trail
 * nobody can open is forensic at best, and an admin asked "who removed Sam?"
 * had to ask an engineer to run SQL. This is the read surface.
 *
 * ── Why admins only, and why the check is here as well as in RLS ─────────
 *
 * `audit_read` already returns zero rows to anyone below admin. Rendering
 * that as an empty log would tell a member "nothing has happened here",
 * which is false; saying who can see it is the truthful answer.
 *
 * ── Why the newest 200 and no pagination ─────────────────────────────────
 *
 * The question this page answers is "what changed recently, and who did
 * it". Older history stays in the table.
 */
const LIMIT = 200;

export default async function ActivityLogPage({
  params,
}: {
  params: Promise<{ org: string }>;
}) {
  const { org } = await params;

  const viewer = await currentViewer(org);
  if (!viewer) notFound();

  if (!canAdmin(viewer)) {
    return (
      <Note>
        Only owners and admins can see the activity log. Ask one of them if you need to know who
        changed something.
      </Note>
    );
  }

  const { data: entries, source } = await load<AuditRecord[]>(
    async (db) => listAudit(db, await requireOrgId(org, "ActivityLogPage"), LIMIT),
    () => [],
  );

  return (
    <div className="space-y-6">
      {source !== "live" && (
        <DemoFigures what="The activity log reads a real workspace's history; this deployment has no database connected, so there is nothing to show." />
      )}

      {source === "live" && entries.length === 0 && (
        <Note>Nothing recorded yet. Changes to members, campaigns, mailboxes and settings appear here.</Note>
      )}

      {entries.length > 0 && (
        <Card>
          <CardBody className="p-0">
            <ol aria-label="Activity, newest first" className="divide-y divide-line-subtle">
              {entries.map((entry) => (
                <li key={entry.id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-baseline sm:gap-4">
                  <time
                    dateTime={entry.createdAt}
                    className="shrink-0 text-[12px] tabular-nums text-fg-muted sm:w-44"
                  >
                    {formatWhen(entry.createdAt)}
                  </time>
                  <div className="min-w-0 text-[13px] text-fg">
                    <span className="font-medium">{entry.actorName ?? (entry.actorId ? "A former member" : "Huntloop")}</span>{" "}
                    <span>{lowerFirst(describeAuditAction(entry.action))}</span>
                    {entry.targetType && (
                      <span className="text-fg-muted"> · {entry.targetType}</span>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </CardBody>
        </Card>
      )}

      {entries.length === LIMIT && (
        <p className="text-[12px] text-fg-muted">
          Showing the newest {LIMIT}. Older entries are kept.
        </p>
      )}
    </div>
  );
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  });
}

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

export const metadata = { title: "Activity log" };
