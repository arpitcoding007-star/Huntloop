import { notFound } from "next/navigation";
import { canAdmin, canOwn, currentViewer } from "../../../../../lib/data/membership";
import { getOrganization } from "../../../../../lib/data/organization";
import { DemoFigures } from "../../DemoFigures";
import { PrivacyControls } from "./PrivacyControls";

/**
 * Data & privacy — where the rights the schema already implements become
 * things a person can actually do.
 *
 * ── Why this screen exists ───────────────────────────────────────────────
 *
 * `0017` shipped erasure and per-person export as tested SQL and granted
 * neither to any session. The landing page meanwhile promised "an erasure
 * path that actually deletes rather than flags". The machinery was finished
 * and unreachable, which is a worse state than unbuilt: unbuilt does not get
 * described in the present tense on a marketing page.
 *
 * ── Why the controls are grouped by whose data it is ─────────────────────
 *
 * Two audiences with two different rights get confused constantly, and the
 * confusion is expensive in both directions. A customer asking for "my data"
 * means the workspace. A prospect asking the customer for "my data" means one
 * person's dossier. Splitting them by heading means the admin servicing a
 * request does not have to work out which control applies.
 */
export default async function PrivacyPage({
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
        <DemoFigures what="These controls act on a real workspace; this deployment has no database connected, so nothing here would run." />
      )}
      <PrivacyControls
        org={org}
        canAdmin={canAdmin(viewer)}
        canOwn={canOwn(viewer)}
        retentionDays={organization?.contactRetentionDays ?? null}
        live={source === "live"}
      />
    </div>
  );
}

export const metadata = { title: "Data & privacy" };
