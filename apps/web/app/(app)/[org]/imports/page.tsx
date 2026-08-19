import { notFound } from "next/navigation";
import { canWrite, currentViewer } from "../../../../lib/data/membership";
import { listCompanies } from "../../../../lib/data/company";
import { DemoFigures } from "../DemoFigures";
import { ImportForm } from "./ImportForm";

/**
 * Imports — master context §59, §60.
 *
 * The company count is loaded rather than left off, because "you have 3
 * companies" is the number an importer's result has to be read against: 300
 * added to 3 and 300 added to 3,000 are different events, and the screen that
 * reports the first should say which one it was.
 *
 * That load is also what satisfies FEAT-DEMO honestly — the screen reads
 * `lib/data`, and renders `DemoFigures` in the configuration where that read
 * fell back.
 */
export default async function ImportsPage({
  params,
}: {
  params: Promise<{ org: string }>;
}) {
  const { org } = await params;

  const viewer = await currentViewer(org);
  if (!viewer) notFound();

  const { data: companies, source } = await listCompanies(org);

  return (
    <div className="mx-auto w-full max-w-[880px] px-6 py-8 lg:px-8">
      <header>
        <h1 className="text-[30px] leading-9 font-semibold text-fg">Imports</h1>
        <p className="mt-1 text-[13px] text-fg-muted">
          {org} · {companies.length}{" "}
          {companies.length === 1 ? "company" : "companies"} on your list · bring
          your own in from a spreadsheet
        </p>
      </header>

      {source !== "live" && (
        <div className="mt-6">
          <DemoFigures what="This deployment has no database, so an import has nowhere to go and will say so." />
        </div>
      )}

      <div className="mt-6">
        <ImportForm org={org} canWrite={canWrite(viewer)} />
      </div>
    </div>
  );
}

export const metadata = { title: "Imports" };
