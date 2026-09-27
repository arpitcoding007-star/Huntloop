import { notFound } from "next/navigation";
import { canAdmin, currentViewer } from "../../../../../lib/data/membership";
import { getHubspotConnection } from "../../../../../lib/data/integrations";
import { DemoFigures } from "../../DemoFigures";
import { IntegrationsForm } from "./IntegrationsForm";

/**
 * Integrations — HubSpot sync, per the roadmap's first-and-only CRM
 * destination (`packages/crm`).
 *
 * Reads through `lib/data/integrations`, same as every other settings screen
 * reads through its own `lib/data` module — connection status is real data,
 * not a "coming soon" placeholder, so it earns the same FEAT-DEMO treatment
 * the rest of settings gets rather than a static description of the feature.
 */
export default async function IntegrationsPage({
  params,
}: {
  params: Promise<{ org: string }>;
}) {
  const { org } = await params;

  const viewer = await currentViewer(org);
  if (!viewer) notFound();

  const { data: connection, source } = await getHubspotConnection(org);

  return (
    <div className="space-y-6">
      {source !== "live" && (
        <DemoFigures what="This is an illustrative connection state, not your account's." />
      )}
      <IntegrationsForm org={org} connection={connection} canAdmin={canAdmin(viewer)} />
    </div>
  );
}

export const metadata = { title: "Integrations" };
