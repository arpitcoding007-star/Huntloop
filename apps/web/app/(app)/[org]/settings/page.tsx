import { notFound } from "next/navigation";
import { canAdmin, currentViewer } from "../../../../lib/data/membership";
import { getOrganization } from "../../../../lib/data/organization";
import { DemoFigures } from "../DemoFigures";
import { OrgSettingsForm } from "./OrgSettingsForm";

/**
 * Settings root — the organisation itself.
 *
 * The sidebar's Settings entry and the first tab of `SettingsNav` both point
 * here, and until this page existed both of them 404'd. `NAV-01` did not
 * catch it: it only inspects the sidebar, where the entry was still marked
 * `unbuilt`, and the tab bar is a separate component it never reads.
 */
export default async function SettingsPage({
  params,
}: {
  params: Promise<{ org: string }>;
}) {
  const { org } = await params;

  const viewer = await currentViewer(org);
  if (!viewer) notFound();

  const { data: organization, source } = await getOrganization(org);

  return (
    <div className="space-y-6">
      {source !== "live" && (
        <DemoFigures what="This is an example organisation, not the one on your account." />
      )}
      <OrgSettingsForm
        org={org}
        organization={organization}
        canAdmin={canAdmin(viewer)}
      />
    </div>
  );
}

export const metadata = { title: "Settings" };
