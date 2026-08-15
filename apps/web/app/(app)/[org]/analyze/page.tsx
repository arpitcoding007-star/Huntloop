import { PermissionDenied } from "@huntloop/ui";
import { canSpend, currentViewer } from "../../../../lib/data/membership";
import { Analyzer } from "./Analyzer";

/**
 * Master context §17 — paste any company URL, get an honest assessment.
 *
 * This is a top-level job rather than a filter on a list, because the question
 * it answers is its own: "is this actually a good lead?" And §17 is explicit
 * that Huntloop must be willing to answer **no** — it must not qualify a
 * company just because the user took the trouble to type it in.
 *
 * A viewer gets `PermissionDenied` instead of the form, and this is the one
 * screen where that matters most: every run here fetches several pages and
 * spends real money at Opus. Letting a viewer submit and then refusing at the
 * database would be a worse experience *and* would leave them unable to tell a
 * permission from an outage. `PermissionDenied` names the role they would
 * need, which is the one thing that makes it actionable.
 */
export default async function AnalyzePage({
  params,
}: {
  params: Promise<{ org: string }>;
}) {
  const { org } = await params;
  const viewer = await currentViewer(org);

  if (!canSpend(viewer)) {
    return (
      <div className="mx-auto w-full max-w-[900px] px-6 py-8 lg:px-8">
        <h1 className="text-[30px] leading-9 font-semibold text-fg">Analyze a URL</h1>
        <PermissionDenied
          className="mt-6"
          resource="company analysis"
          requiredRole="member"
        />
      </div>
    );
  }

  return <Analyzer org={org} />;
}

export const metadata = { title: "Analyze a URL" };
