import { notFound } from "next/navigation";
import { listCompetitors } from "../../../../lib/data/competitor-intel";
import { canWrite, currentViewer } from "../../../../lib/data/membership";
import { DemoFigures } from "../DemoFigures";
import { CompetitorList } from "./CompetitorList";

/**
 * Competitors — COMMAND.md §16.3-D.
 *
 * The list a person keeps: who they compete with, how directly, and what the
 * evidence says about each one's footprint among their prospects. Proposed
 * competitors (found in what sources said about prospects) wait here for a
 * person to accept or dismiss them; only accepted ones count anywhere else.
 */
export default async function CompetitorsPage({
  params,
}: {
  params: Promise<{ org: string }>;
}) {
  const { org } = await params;
  const viewer = await currentViewer(org);
  if (!viewer) notFound();

  const { data: competitors, source } = await listCompetitors(org);

  return (
    <div className="mx-auto w-full max-w-[1100px] px-6 py-8 lg:px-8">
      <header>
        <h1 className="hl-heading text-fg">Competitors</h1>
        <p className="mt-1 text-[13px] text-fg-muted">
          Who you compete with, where they show up among your prospects, and the deals they won
        </p>
      </header>

      {source !== "live" && (
        <div className="mt-6">
          <DemoFigures what="These are example competitors, not the ones on your account." />
        </div>
      )}

      <div className="mt-6">
        <CompetitorList org={org} competitors={competitors} canWrite={canWrite(viewer)} />
      </div>
    </div>
  );
}

export const metadata = { title: "Competitors" };
