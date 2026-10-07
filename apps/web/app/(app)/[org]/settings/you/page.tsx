import { notFound } from "next/navigation";
import { currentViewer } from "../../../../../lib/data/membership";
import { getMyLearning } from "../../../../../lib/data/personal-learning";
import { DemoFigures } from "../../DemoFigures";
import { YouManager } from "./YouManager";

/**
 * Settings → You — what Huntloop knows about how you work, and your control
 * over it (K2, COMMAND.md §10.8).
 *
 * Kept apart from Memory on purpose. Memory is the workspace's knowledge —
 * documents, account notes, house style — and everyone in it shares that.
 * This page is one person's: what they told Huntloop, what it concluded from
 * what they did (with the observations behind each conclusion), what it is
 * waiting for them to confirm, and the switch that stops it learning.
 */
export default async function YouPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const viewer = await currentViewer(org);
  if (!viewer) notFound();

  const { data, source } = await getMyLearning(org);

  return (
    <div className="space-y-6">
      {source !== "live" && (
        <DemoFigures what="These are example preferences. With a database connected this page shows what Huntloop knows about how you work." />
      )}
      <YouManager org={org} learning={data} live={source === "live"} />
    </div>
  );
}

export const metadata = { title: "You" };
