import { notFound } from "next/navigation";
import { canWrite, currentViewer } from "../../../../../lib/data/membership";
import { listRules } from "../../../../../lib/data/scoring";
import { DemoFigures } from "../../DemoFigures";
import { ScoringRules } from "./ScoringRules";

/**
 * Scoring — the customer's own policy, on top of the qualifier's judgement.
 *
 * `scoring_rules` has existed since `0003` and had no reader anywhere in the
 * product until `0010` gave rules an effect and `@huntloop/db/rules` gave them
 * an evaluator. This is the screen that authors them, and the one place a
 * person can see what the org's policy actually is.
 */
export default async function ScoringPage({
  params,
}: {
  params: Promise<{ org: string }>;
}) {
  const { org } = await params;

  const viewer = await currentViewer(org);
  if (!viewer) notFound();

  const { data: rules, source } = await listRules(org);

  return (
    <div className="space-y-6">
      {source !== "live" && (
        <DemoFigures what="These are example rules, not ones running on your account." />
      )}
      <ScoringRules org={org} rules={rules} canWrite={canWrite(viewer)} />
    </div>
  );
}

export const metadata = { title: "Scoring" };
