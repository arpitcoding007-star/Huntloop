import { notFound } from "next/navigation";
import { canAdmin, currentViewer } from "../../../../lib/data/membership";
import { listMembers } from "../../../../lib/data/team";
import { DemoFigures } from "../DemoFigures";
import { MemberList } from "./MemberList";
import { TeamNav } from "./TeamNav";

/**
 * Members — master context §38.
 *
 * `canAdmin` rather than `canWrite`: `0001` guards `memberships` with
 * `has_org_role(org_id, 'admin')`, so a member offered a role dropdown here
 * would be refused by Postgres and by nothing before it. See the note in
 * `lib/data/org.ts` on why `mutate` grew a `minRole`.
 */
export default async function TeamPage({
  params,
}: {
  params: Promise<{ org: string }>;
}) {
  const { org } = await params;

  const viewer = await currentViewer(org);
  if (!viewer) notFound();

  const { data: members, source } = await listMembers(org);

  return (
    <div className="mx-auto w-full max-w-[880px] px-6 py-8 lg:px-8">
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
          <DemoFigures what="These are example members, not the ones on your account." />
        </div>
      )}

      <div className="mt-6">
        <MemberList
          org={org}
          members={members}
          canAdmin={canAdmin(viewer)}
          now={new Date().toISOString()}
        />
      </div>
    </div>
  );
}

export const metadata = { title: "Members" };
