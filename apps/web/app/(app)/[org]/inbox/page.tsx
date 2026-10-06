import { notFound } from "next/navigation";
import { listDrafts, listThreads } from "../../../../lib/data/inbox";
import { listMembers } from "../../../../lib/data/team";
import { canWrite, currentViewer } from "../../../../lib/data/membership";
import { DemoFigures } from "../DemoFigures";
import { InboxView } from "./InboxView";

/**
 * Inbox — `threads` and `messages` from `0004`.
 *
 * The sidebar entry used to carry an unread badge reading "12". That was a
 * fixture, and it went with the `unbuilt` flag rather than being ported here:
 * a real count belongs on the nav only once something can make it move, and
 * nothing sends yet.
 */
export default async function InboxPage({
  params,
}: {
  params: Promise<{ org: string }>;
}) {
  const { org } = await params;

  const viewer = await currentViewer(org);
  if (!viewer) notFound();

  const [{ data: threads, source }, { data: drafts }, { data: members }] = await Promise.all([
    listThreads(org),
    listDrafts(org),
    listMembers(org),
  ]);

  return (
    <div className="mx-auto w-full max-w-[1000px] px-6 py-8 lg:px-8">
      <header>
        <h1 className="hl-heading text-fg">Inbox</h1>
        <p className="mt-1 text-[13px] text-fg-muted">
          Drafts waiting for your approval, replies, and what happened to what you sent
        </p>
      </header>

      {source !== "live" && (
        <div className="mt-6">
          <DemoFigures what="These are example conversations, not messages on your account." />
        </div>
      )}

      <div className="mt-6">
        <InboxView
          org={org}
          threads={threads}
          drafts={drafts}
          members={members.map((m) => ({ userId: m.userId, label: m.isYou ? "You" : (m.name ?? m.email ?? "A teammate") }))}
          canWrite={canWrite(viewer)}
          now={new Date().toISOString()}
        />
      </div>
    </div>
  );
}

export const metadata = { title: "Inbox" };
