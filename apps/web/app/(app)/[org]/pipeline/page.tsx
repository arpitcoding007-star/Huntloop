import { notFound } from "next/navigation";
import { canWrite, currentViewer } from "../../../../lib/data/membership";
import { listAssignments } from "../../../../lib/data/team";
import { listCompetitorOptions } from "../../../../lib/data/competitors";
import { getPipelineExtras } from "../../../../lib/data/pipeline";
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

  const [{ data: opportunities, source }, { data: competitors }, { data: extras }] = await Promise.all([
    listAssignments(org),
    listCompetitorOptions(org),
    getPipelineExtras(org),
  ]);

  /* Open pipeline value (0040): only values people typed, and how many had one. */
  const open = opportunities.filter((o) => !["won", "lost", "archived"].includes(o.status));
  const valued = open.filter((o) => (extras[o.id]?.valueCents ?? 0) > 0);
  const openCents = valued.reduce((s, o) => s + (extras[o.id]?.valueCents ?? 0), 0);

  return (
    <div className="mx-auto w-full max-w-[1600px] px-6 py-8 lg:px-8">
      <header>
        <h1 className="hl-heading text-fg">Pipeline</h1>
        <p className="mt-1 text-[13px] text-fg-muted">
          {opportunities.length}{" "}
          {opportunities.length === 1 ? "opportunity" : "opportunities"} · where
          each one has got to
          {valued.length > 0 && (
            <>
              {" · "}
              <span className="hl-tabular text-fg-secondary">{money(openCents)}</span> open pipeline
              from {valued.length} of {open.length} open deals with a value
            </>
          )}
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
          extras={extras}
          now={new Date().toISOString()}
        />
      </div>
    </div>
  );
}

function money(cents: number): string {
  return `${Math.round(cents / 100).toLocaleString("en-US")}`;
}

export const metadata = { title: "Pipeline" };
