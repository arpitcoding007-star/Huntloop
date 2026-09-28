import { notFound } from "next/navigation";
import { canAdmin, currentViewer } from "../../../../lib/data/membership";
import { getOrganization } from "../../../../lib/data/organization";
import { parseOrgProfile } from "@huntloop/db/org-profile";
import { DemoFigures } from "../DemoFigures";
import { OrgSettingsForm } from "./OrgSettingsForm";
import { OrgVoiceForm } from "./OrgVoiceForm";

/**
 * Settings root — the organisation itself.
 *
 * The Settings rail entry and the first row of its panel both point here.
 * Until this page existed both 404'd, which `NAV-01` missed while the
 * settings tabs were a separate component it never read. They are sidebar
 * items in OrgShell now, which it does read.
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
      {/* Parsed here rather than in the loader, because `organizations.settings`
          is deliberately carried through as an opaque object — see the note in
          `lib/data/organization.ts`. This screen is the one that knows what the
          keys mean, and `parseOrgProfile` is the shared definition of that. */}
      <OrgVoiceForm
        org={org}
        profile={parseOrgProfile(organization?.settings)}
        canAdmin={canAdmin(viewer)}
      />
    </div>
  );
}

export const metadata = { title: "Settings" };
