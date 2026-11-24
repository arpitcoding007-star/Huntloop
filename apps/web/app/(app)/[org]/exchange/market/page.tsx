import Link from "next/link";
import { notFound } from "next/navigation";
import { Button, Card, EmptyState, Note } from "@huntloop/ui";
import { BarChart3, Store } from "lucide-react";
import { exchangeMetadata, isExchangeEnabled } from "../../../../../lib/exchange/flag";
import { getMarketDemand, type DemandRow } from "../../../../../lib/data/exchange";
import { currentViewer } from "../../../../../lib/data/membership";

/**
 * Market demand (build plan DN-55, DN-67): what buyers are asking for, by
 * category and region, for suppliers. Named apart from "Prospect demand"
 * (the themes in prospects' replies), which is a different thing.
 *
 * Every number here is at least ten. The database withholds any smaller
 * group, folding thin regions into a category's Worldwide row where that
 * reaches ten — so a count can never point at one buyer.
 */
export default async function MarketDemandPage({ params }: { params: Promise<{ org: string }> }) {
  if (!isExchangeEnabled()) notFound();
  const { org } = await params;
  const viewer = await currentViewer(org);
  if (!viewer) notFound();
  const { data, source } = await getMarketDemand(org);

  const byCategory = new Map<string, DemandRow[]>();
  for (const r of data.rows) byCategory.set(r.categoryPath, [...(byCategory.get(r.categoryPath) ?? []), r]);
  const groups = [...byCategory.entries()].sort(
    (a, b) => b[1].reduce((n, r) => n + r.openRequests, 0) - a[1].reduce((n, r) => n + r.openRequests, 0),
  );

  return (
    <div className="mx-auto w-full max-w-[1000px] px-6 py-8 lg:px-8">
      <header>
        <h1 className="hl-heading text-fg">Market demand</h1>
        <p className="mt-1 text-[13px] text-fg-muted">
          Open buyer requests on the Exchange, by category and region. Groups of fewer than ten are never shown.
        </p>
      </header>
      {source !== "live" && (
        <div className="mt-6">
          <Note tone="info">There is no database on this deployment, so there is no demand to show.</Note>
        </div>
      )}
      <div className="mt-6 space-y-4">
        {!data.hasProfile && source === "live" ? (
          <EmptyState
            icon={Store}
            title="For suppliers"
            description="Market demand is shown to workspaces that list on the Exchange. Create a supplier profile to see it."
            action={
              <Button variant="primary" href={`/${org}/exchange/supplier`} linkComponent={Link}>
                Create a supplier profile
              </Button>
            }
          />
        ) : groups.length === 0 ? (
          <EmptyState
            icon={BarChart3}
            title="Not enough requests yet"
            description="A category appears here once at least ten open requests share it. Buyers who keep their requests private are not counted."
          />
        ) : (
          groups.map(([path, rows]) => (
            <Card key={path}>
              <h2 className="text-[15px] font-semibold text-fg">{path}</h2>
              <table className="mt-3 w-full text-left text-[13px]">
                <thead>
                  <tr className="text-[11px] tracking-label text-fg-muted uppercase">
                    <th className="py-1 pr-3 font-semibold">Region</th>
                    <th className="py-1 pr-3 text-right font-semibold">Open requests</th>
                    <th className="py-1 pr-3 text-right font-semibold">New in 30 days</th>
                    <th className="py-1 text-right font-semibold">Ready to buy</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-subtle">
                  {rows.map((r) => (
                    <tr key={r.region}>
                      <td className="py-2 pr-3 text-fg">{r.region}</td>
                      <td className="py-2 pr-3 text-right text-fg tabular-nums">{r.openRequests.toLocaleString("en")}</td>
                      <td className="py-2 pr-3 text-right text-fg tabular-nums">{r.new30d.toLocaleString("en")}</td>
                      <td className="py-2 text-right text-fg tabular-nums">{r.hot.toLocaleString("en")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          ))
        )}
        <p className="text-[11px] text-fg-muted">
          Counts include requests a buyer chose to have counted, from confirmed accounts, and leave out your own workspace&apos;s. “Ready to buy” is read from what buyers stated about budget and timing.
        </p>
      </div>
    </div>
  );
}

export const generateMetadata = exchangeMetadata("Market demand");
