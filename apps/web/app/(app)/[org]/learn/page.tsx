import { notFound } from "next/navigation";
import { canWrite, currentViewer } from "../../../../lib/data/membership";
import { isEngineRunning } from "../../../../lib/data/engine";
import { listLearningRuns } from "../../../../lib/data/learning";
import { DemoFigures } from "../DemoFigures";
import { LearningReview } from "./LearningReview";

/**
 * Learn — the last stage of §4's loop, and the one that had no implementation.
 *
 * `outcomes` and `ai_decisions.human_override` have been written since `0004`
 * and read by nothing. This screen is where they are read back: an analysis
 * over what actually happened, turned into findings a person accepts or
 * declines one at a time.
 *
 * ── Why the engine state is loaded here ──────────────────────────────────
 *
 * Requesting an analysis writes a `learning_runs` row and waits for the
 * sweeper — so on a deployment where nothing drives the tick, the request is
 * queued into a queue nobody drains and the button reports success forever.
 * `isEngineRunning()` is what lets the screen say so instead, and it is the
 * same check the Sources screen makes about "Scan now" for the same reason.
 */
export default async function LearnPage({
  params,
}: {
  params: Promise<{ org: string }>;
}) {
  const { org } = await params;

  const viewer = await currentViewer(org);
  if (!viewer) notFound();

  const { data: runs, source } = await listLearningRuns(org);

  return (
    <div className="mx-auto w-full max-w-[880px] px-6 py-8 lg:px-8">
      <header>
        <h1 className="font-display text-[30px] leading-9 font-semibold text-fg">Learn</h1>
        <p className="mt-1 text-[13px] text-fg-muted">
          {org} · what happened, and what it suggests changing
        </p>
      </header>

      {source !== "live" && (
        <div className="mt-6">
          <DemoFigures what="This is an example analysis, not one run on your data." />
        </div>
      )}

      <div className="mt-6">
        <LearningReview
          org={org}
          runs={runs}
          canWrite={canWrite(viewer)}
          engineRunning={isEngineRunning()}
        />
      </div>
    </div>
  );
}

export const metadata = { title: "Learn" };
