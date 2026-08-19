import { notFound } from "next/navigation";
import { canWrite, currentViewer } from "../../../../lib/data/membership";
import { getOutreach } from "../../../../lib/data/outreach";
import { DemoFigures } from "../DemoFigures";
import { OutreachManager } from "./OutreachManager";

/**
 * Outreach — master context §46.
 *
 * Campaigns, their sequences and the mailboxes they would send from, on one
 * screen because they are one question: what would go out, to whom, and does
 * anybody read it first.
 */
export default async function OutreachPage({
  params,
}: {
  params: Promise<{ org: string }>;
}) {
  const { org } = await params;

  const viewer = await currentViewer(org);
  if (!viewer) notFound();

  const { data: outreach, source } = await getOutreach(org);

  return (
    <div className="mx-auto w-full max-w-[1000px] px-6 py-8 lg:px-8">
      <header>
        <h1 className="text-[30px] leading-9 font-semibold text-fg">Outreach</h1>
        <p className="mt-1 text-[13px] text-fg-muted">
          {org} · what would go out, and who approves it first
        </p>
      </header>

      {source !== "live" && (
        <div className="mt-6">
          <DemoFigures what="This is an example campaign, not one on your account." />
        </div>
      )}

      <div className="mt-6">
        <OutreachManager org={org} outreach={outreach} canWrite={canWrite(viewer)} />
      </div>
    </div>
  );
}

export const metadata = { title: "Outreach" };
