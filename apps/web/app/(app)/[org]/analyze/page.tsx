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
  searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<{ url?: string; run?: string }>;
}) {
  const { org } = await params;
  const { url, run } = await searchParams;
  const viewer = await currentViewer(org);

  if (!canSpend(viewer)) {
    return (
      <div className="mx-auto w-full max-w-[900px] px-6 py-8 lg:px-8">
        <h1 className="hl-heading text-fg">Analyze a URL</h1>
        <PermissionDenied
          className="mt-6"
          resource="company analysis"
          requiredRole="member"
        />
      </div>
    );
  }

  const initialUrl = (url ?? "").trim().slice(0, 2048);
  return <Analyzer org={org} initialUrl={initialUrl} autoRun={run === "1" && Boolean(initialUrl)} />;
}

export const metadata = { title: "Analyze a URL" };
