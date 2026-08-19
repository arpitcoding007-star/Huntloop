import type { Priority } from "@huntloop/ui";
import { listOpportunities } from "../../../../lib/data/opportunities";
import { canWrite, currentViewer } from "../../../../lib/data/membership";
import { OpportunityTable } from "./OpportunityTable";

/**
 * The opportunity list.
 *
 * Server component, so the query stays off the client; the table itself is
 * interactive and lives in ./OpportunityTable. The demo-data banner is
 * rendered by the org layout.
 */

const PRIORITIES = ["hot", "warm", "watch", "ignore"] as const;

/**
 * `?priority=hot` seeds the filter.
 *
 * It exists because the Command Center's four priority cards had nowhere to
 * link: the filter was client state only, so any link to this page landed on
 * "All" regardless of which card was clicked. Rather than leave four cards
 * pointing at `href="#"` — the §7 failure the nav had — the filter became
 * addressable.
 *
 * Parsed here rather than with `useSearchParams` in the table so that no
 * Suspense boundary is needed and an unrecognised value cannot reach client
 * state. Anything not one of the four buckets is ignored, which is also what
 * makes this safe to accept from a URL: the parameter can only ever select
 * among values the component already renders.
 */
function parsePriority(raw: string | string[] | undefined): Priority | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return PRIORITIES.find((p) => p === value);
}

/**
 * `?company=Acme` seeds the search box.
 *
 * Capped at 160 characters — the same bound `name` carries in `validation.ts`
 * — because an unbounded query parameter rendered back into an input is a
 * cheap way to put a megabyte of someone else's text on the page.
 */
function parseCompany(raw: string | string[] | undefined): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value ? value.slice(0, 160) : undefined;
}

export default async function OpportunitiesPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ org }, query] = await Promise.all([params, searchParams]);

  const { data } = await listOpportunities(org);

  return (
    <OpportunityTable
      org={org}
      rows={data}
      /* The server's clock, resolved once per request and passed down, so
         every relative age on the page is measured from the same instant.
         Reading `new Date()` inside the client component instead would make
         the ages drift against the data they describe. */
      now={new Date().toISOString()}
      initialPriority={parsePriority(query.priority)}
      /* `?company=` seeds the search box, which already defaults to the
         company scope. Bounded and coerced to a single string here for the
         same reason `parsePriority` is strict: it arrives from a URL, and the
         only thing it may do downstream is filter rows already rendered. */
      initialQuery={parseCompany(query.company)}
      // Resolved on the server and passed down, rather than read in the client
      // component: the role is not something the browser should be asked to
      // determine, even for a rendering decision. See lib/data/membership.ts.
      canWrite={canWrite(await currentViewer(org))}
    />
  );
}

export const metadata = {
  title: "Opportunities",
};
