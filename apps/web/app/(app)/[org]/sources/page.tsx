import { notFound } from "next/navigation";
import { isEngineRunning } from "../../../../lib/data/engine";
import { listHuntSources } from "../../../../lib/data/hunt-source";
import { canWrite, currentViewer } from "../../../../lib/data/membership";
import { DemoFigures } from "../DemoFigures";
import { SourceManager } from "./SourceManager";

/**
 * Source management (§10).
 *
 * This screen was the last fixture-backed one. It now reads `sources` through
 * `lib/data/hunt-source`, so the unconditional demo notice it used to carry is
 * conditional again — the banner appears exactly when the loader fell back,
 * which is the distinction FEAT-DEMO exists to preserve.
 */
export default async function SourcesPage({
  params,
}: {
  params: Promise<{ org: string }>;
}) {
  const { org } = await params;

  const viewer = await currentViewer(org);
  if (!viewer) notFound();

  const { data: sources, source } = await listHuntSources(org);

  return (
    <>
      {source !== "live" && (
        <div className="px-6 pt-6 lg:px-8">
          <DemoFigures what="These are example sources, not the ones on your account." />
        </div>
      )}
      <SourceManager
        org={org}
        sources={sources}
        canWrite={canWrite(viewer)}
        engineRunning={isEngineRunning()}
        /* Resolved once per request and passed down, so every relative age on
           the page is measured from the same instant. */
        now={new Date().toISOString()}
      />
    </>
  );
}

export const metadata = {
  title: "Sources",
};
