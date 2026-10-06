import { notFound } from "next/navigation";
import { canWrite, currentViewer } from "../../../../lib/data/membership";
import { listAssignments } from "../../../../lib/data/team";
import { listCompetitorOptions } from "../../../../lib/data/competitors";
import { DemoFigures } from "../DemoFigures";
import { PipelineBoard } from "./PipelineBoard";

/**
 * Pipeline — the `opportunity_status` enum from `0003`, as a board.
 *
 * Reads `listAssignments` rather than a loader of its own. It wants exactly
 * the same rows with the same fields — company, priority, status, owner — and
 * a second query returning the same shape is how two screens start disagreeing
 * about what the pipeline contains. The name is about assignment because that
 * is where it was first needed; the data is "opportunities, flat".
 */
export default async function PipelinePage({
  params,
}: {
  params: Promise<{ org: string }>;
}) {
  const { org } = await params;

  const viewer = await currentViewer(org);
  if (!viewer) notFound();

  const [{ data: opportunities, source }, { data: competitors }] = await Promise.all([
    listAssignments(org),
    listCompetitorOptions(org),
  ]);

  return (
    <div className="mx-auto w-full max-w-[1600px] px-6 py-8 lg:px-8">
      <header>
        <h1 className="hl-heading text-fg">Pipeline</h1>
        <p className="mt-1 text-[13px] text-fg-muted">
          {opportunities.length}{" "}
          {opportunities.length === 1 ? "opportunity" : "opportunities"} · where
          each one has got to
        </p>
      </header>

      {source !== "live" && (
        <div className="mt-6">
          <DemoFigures what="This is an example pipeline, not the opportunities on your account." />
        </div>
      )}

      <div className="mt-6">
        <PipelineBoard
          org={org}
          opportunities={opportunities}
          competitors={competitors}
          canWrite={canWrite(viewer)}
        />
      </div>
    </div>
  );
}

export const metadata = { title: "Pipeline" };
