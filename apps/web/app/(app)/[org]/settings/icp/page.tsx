import { notFound } from "next/navigation";
import { listIcps } from "../../../../../lib/data/icp";
import { canWrite, currentViewer } from "../../../../../lib/data/membership";
import { listProducts } from "../../../../../lib/data/product";
import { DemoFigures } from "../../DemoFigures";
import { IcpEditor } from "./IcpEditor";

/**
 * ICP — master context §9.
 *
 * Loads products alongside the ICPs because the form links one to the other,
 * and a select with no options would make "which product does this profile
 * buy?" unanswerable on a screen that asks it. Both loaders report their own
 * source; they cannot disagree in practice — `resolveDataSource` is one
 * decision per request — so the ICP's is the one that decides the banner.
 */
export default async function IcpPage({
  params,
}: {
  params: Promise<{ org: string }>;
}) {
  const { org } = await params;

  const viewer = await currentViewer(org);
  if (!viewer) notFound();

  const [{ data: icps, source }, { data: products }] = await Promise.all([
    listIcps(org),
    listProducts(org),
  ]);

  return (
    <div className="space-y-6">
      {source !== "live" && (
        <DemoFigures what="This is an example profile, not the one on your account." />
      )}
      <IcpEditor
        org={org}
        icps={icps}
        products={products}
        canWrite={canWrite(viewer)}
      />
    </div>
  );
}

export const metadata = { title: "ICP" };
