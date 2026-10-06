import { notFound } from "next/navigation";
import { getDemand } from "../../../../lib/data/demand";
import { canWrite, currentViewer } from "../../../../lib/data/membership";
import { DemoFigures } from "../DemoFigures";
import { DemandBoard } from "./DemandBoard";

/**
 * What prospects ask for — COMMAND.md §16.3-I (P6).
 *
 * Statements from replies, loss reasons and notes, grouped into themes a
 * person curates into a roadmap. Shipping a theme brings the deals that asked
 * for it back into Needs you.
 */
export default async function DemandPage({
  params,
}: {
  params: Promise<{ org: string }>;
}) {
  const { org } = await params;
  const viewer = await currentViewer(org);
  if (!viewer) notFound();

  const { data: demand, source } = await getDemand(org);

  return (
    <div className="mx-auto w-full max-w-[1100px] px-6 py-8 lg:px-8">
      <header>
        <h1 className="hl-heading text-fg">What prospects ask for</h1>
        <p className="mt-1 text-[13px] text-fg-muted">
          Needs, objections and blockers from replies, lost deals and notes — grouped, so the roadmap follows the pipeline
        </p>
      </header>

      {source !== "live" && (
        <div className="mt-6">
          <DemoFigures what="There is nothing captured on this deployment yet." />
        </div>
      )}

      <div className="mt-6">
        <DemandBoard org={org} demand={demand} canWrite={canWrite(viewer)} />
      </div>
    </div>
  );
}

export const metadata = { title: "What prospects ask for" };
