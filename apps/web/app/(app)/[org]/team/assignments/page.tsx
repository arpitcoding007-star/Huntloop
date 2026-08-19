import { notFound } from "next/navigation";
import { canWrite, currentViewer } from "../../../../../lib/data/membership";
import { listAssignments, listMembers } from "../../../../../lib/data/team";
import { DemoFigures } from "../../DemoFigures";
import { TeamNav } from "../TeamNav";
import { AssignmentBoard } from "./AssignmentBoard";

/**
 * Assignments — master context §14.
 *
 * `canWrite`, not `canAdmin`: `opportunities` is guarded at `'member'` in
 * `0003`, and picking up a piece of work is the ordinary daily action of that
 * role rather than an administrative one. The Members tab next door is the
 * opposite case, and the two sitting side by side is why the distinction is
 * worth stating in both.
 */
export default async function AssignmentsPage({
  params,
}: {
  params: Promise<{ org: string }>;
}) {
  const { org } = await params;

  const viewer = await currentViewer(org);
  if (!viewer) notFound();

  const [{ data: assignments, source }, { data: members }] = await Promise.all([
    listAssignments(org),
    listMembers(org),
  ]);

  return (
    <div className="mx-auto w-full max-w-[1000px] px-6 py-8 lg:px-8">
      <header>
        <h1 className="text-[30px] leading-9 font-semibold text-fg">Team</h1>
        <p className="mt-1 text-[13px] text-fg-muted">
          Who is in {org}, and which opportunities they own.
        </p>
      </header>

      <div className="mt-6">
        <TeamNav org={org} />
      </div>

      {source !== "live" && (
        <div className="mt-6">
          <DemoFigures what="This is example work, not the opportunities on your account." />
        </div>
      )}

      <div className="mt-6">
        <AssignmentBoard
          org={org}
          assignments={assignments}
          members={members}
          canWrite={canWrite(viewer)}
        />
      </div>
    </div>
  );
}

export const metadata = { title: "Assignments" };
