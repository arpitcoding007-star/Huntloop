import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState } from "@huntloop/ui";
import { Columns3 } from "lucide-react";
import { exchangeMetadata, isExchangeEnabled } from "../../../../../../../lib/exchange/flag";
import { getNeed, type DimensionKey, type MatchView } from "../../../../../../../lib/data/exchange";
import { currentViewer } from "../../../../../../../lib/data/membership";
import { AVAILABILITY_LABEL, formatPriceRange, placeLabel } from "../../../../../../../lib/exchange/format";
import { uuidSchema } from "../../../../../../../lib/validation";

const DIMENSIONS: { key: DimensionKey; label: string }[] = [
  { key: "geography", label: "Location" },
  { key: "budget", label: "Budget" },
  { key: "quantity", label: "Minimum order" },
  { key: "availability", label: "Availability" },
  { key: "trust", label: "Supplier trust" },
  { key: "requirement", label: "Must-haves backed" },
];

/**
 * Compare (build plan DN-64): the shortlisted suppliers for one request side
 * by side, on the same named dimensions as the match cards. A dimension
 * nothing measured reads "Unknown", never a low number, so an empty column is
 * a gap in what is known rather than a bad supplier.
 */
export default async function ComparePage({ params }: { params: Promise<{ org: string; id: string }> }) {
  if (!isExchangeEnabled()) notFound();
  const { org, id } = await params;
  const viewer = await currentViewer(org);
  if (!viewer) notFound();
  if (!uuidSchema.safeParse(id).success) notFound();
  const { data: need } = await getNeed(org, id);
  if (!need) notFound();

  const picked = need.matchList.filter((m) => m.state === "shortlisted");
  const rows: [string, (m: MatchView) => string | null][] = [
    ["Supplier", (m) => m.provider?.name ?? null],
    ["Trust", (m) => (m.provider?.verified ? "Verified" : m.provider?.claimed ? "Claimed profile" : "Unclaimed listing")],
    ["Score", (m) => (m.score === null ? null : `${m.score} / 100`)],
    ["Price", (m) => (m.offering ? formatPriceRange(m.offering.priceFrom, m.offering.priceTo, m.offering.currency) : null)],
    ["Minimum order", (m) => (m.offering?.moq !== null && m.offering?.moq !== undefined ? m.offering.moq.toLocaleString("en") : null)],
    ["Availability", (m) => (m.offering?.availability ? (AVAILABILITY_LABEL[m.offering.availability] ?? m.offering.availability) : null)],
    [
      "Serves",
      (m) => (m.offering ? (m.offering.servesGlobal ? "Worldwide" : m.offering.servesCountries.map((c) => placeLabel(c)).join(", ") || null) : null),
    ],
    ...DIMENSIONS.map(
      (d) =>
        [
          d.label,
          (m: MatchView) => {
            const v = m.dimensions[d.key];
            return v === null || v === undefined ? null : `${v}`;
          },
        ] as [string, (m: MatchView) => string | null],
    ),
    ["Evidence cited", (m) => (m.cited.length ? m.cited.map((e) => e.claim).join("; ") : null)],
  ];

  return (
    <div className="mx-auto w-full max-w-[1200px] px-6 py-8 lg:px-8">
      <p className="text-[12px] text-fg-muted">
        <Link href={`/${org}/exchange/requests/${need.id}`} className="hl-focusable hover:underline">
          {need.summary}
        </Link>
      </p>
      <h1 className="mt-2 hl-heading text-fg">Compare shortlisted suppliers</h1>
      <div className="mt-6">
        {picked.length < 2 ? (
          <EmptyState
            icon={Columns3}
            title="Shortlist at least two suppliers"
            description="Shortlist matches on your request, and they appear here side by side."
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-line-subtle">
            <table className="w-full min-w-[640px] text-left text-[13px]">
              <thead>
                <tr className="border-b border-line-subtle">
                  <th className="sticky left-0 bg-surface p-3 text-[11px] font-semibold tracking-label text-fg-muted uppercase" scope="col">
                    Offering
                  </th>
                  {picked.map((m) => (
                    <th key={m.id} className="p-3 font-semibold text-fg" scope="col">
                      {m.offering?.title ?? "No longer listed"}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line-subtle">
                {rows.map(([label, value]) => (
                  <tr key={label}>
                    <th scope="row" className="sticky left-0 bg-surface p-3 font-normal text-fg-muted">
                      {label}
                    </th>
                    {picked.map((m) => {
                      const v = value(m);
                      return (
                        <td key={m.id} className={v ? "p-3 align-top text-fg" : "p-3 align-top text-fg-muted italic"}>
                          {v ?? "Unknown"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export const generateMetadata = exchangeMetadata("Compare");
