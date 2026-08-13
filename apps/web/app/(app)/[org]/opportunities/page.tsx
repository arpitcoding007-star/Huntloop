import { OPPORTUNITIES } from "../../../../lib/fixtures/opportunities";
import { load } from "../../../../lib/data/source";
import { OpportunityTable } from "./OpportunityTable";

/**
 * The opportunity list.
 *
 * Server component, so the query stays off the client; the table itself is
 * interactive and lives in ./OpportunityTable. The demo-data banner is
 * rendered by the org layout.
 */
export default async function OpportunitiesPage({
  params,
}: {
  params: Promise<{ org: string }>;
}) {
  const { org } = await params;

  const { data } = await load(
    async () => {
      throw new Error(
        "Opportunity list: live query not implemented. Connect Supabase and " +
          "finish listOpportunities() against real rows — see lib/data/opportunities.ts.",
      );
    },
    () => OPPORTUNITIES,
  );

  return <OpportunityTable org={org} rows={data} />;
}

export const metadata = {
  title: "Opportunities",
};
