import { notFound } from "next/navigation";
import { listCompanies } from "../../../../lib/data/company";
import { canWrite, currentViewer } from "../../../../lib/data/membership";
import { DemoFigures } from "../DemoFigures";
import { CompanyManager } from "./CompanyManager";

/**
 * Companies — master context §12.
 *
 * Server component, so the query stays off the client; the table and the form
 * are interactive and live in ./CompanyManager.
 */
export default async function CompaniesPage({
  params,
}: {
  params: Promise<{ org: string }>;
}) {
  const { org } = await params;

  const viewer = await currentViewer(org);
  if (!viewer) notFound();

  const { data: companies, source } = await listCompanies(org);

  return (
    <>
      {source !== "live" && (
        <div className="px-6 pt-6 lg:px-8">
          <DemoFigures what="These are example companies, not the ones on your account." />
        </div>
      )}
      <CompanyManager org={org} companies={companies} canWrite={canWrite(viewer)} />
    </>
  );
}

export const metadata = { title: "Companies" };
