import Link from "next/link";
import { notFound } from "next/navigation";
import { exchangeMetadata, isExchangeEnabled } from "../../../../../../lib/exchange/flag";
import { Badge, Card, Note } from "@huntloop/ui";
import { getNeed } from "../../../../../../lib/data/exchange";
import { canWrite, currentViewer } from "../../../../../../lib/data/membership";
import { formatMoney, placeLabel, STATUS_LABEL, timelineLabel } from "../../../../../../lib/exchange/format";
import { uuidSchema } from "../../../../../../lib/validation";
import { INTENT_LABEL } from "../../../../../../lib/exchange/intent";
import { MatchList } from "./MatchList";
import { NeedControls } from "./NeedControls";

/**
 * One request: what was asked, as confirmed (fact, or unknown), and the
 * suppliers matched to it with the named dimensions behind each score.
 */
export default async function RequestPage({ params }: { params: Promise<{ org: string; id: string }> }) {
  if (!isExchangeEnabled()) notFound();
  const { org, id } = await params;
  const viewer = await currentViewer(org);
  if (!viewer) notFound();
  if (!uuidSchema.safeParse(id).success) notFound();
  const { data: need } = await getNeed(org, id);
  if (!need) notFound();
  const writable = canWrite(viewer);

  const facts: [string, string | null][] = [
    ["Category", need.categoryPath],
    ["Quantity", need.quantity !== null ? `${need.quantity.toLocaleString("en")}${need.unit ? ` ${need.unit}` : ""}` : null],
    ["Budget, at most", formatMoney(need.budgetMax, need.currency)],
    ["Country", placeLabel(need.country)],
    ["Deliver to", need.deliverTo],
    ["Timeline", timelineLabel(need.timeline)],
  ];
  const answered = need.attributes.map((a) => [a.label, need.requirement[a.key]?.value ?? null] as const);

  return (
    <div className="mx-auto w-full max-w-[1100px] px-6 py-8 lg:px-8">
      <p className="text-[12px] text-fg-muted">
        <Link href={`/${org}/exchange`} className="hl-focusable hover:underline">
          My requests
        </Link>
      </p>
      <header className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="hl-heading text-fg">{need.summary}</h1>
          <p className="mt-1 text-[13px] text-fg-muted">
            {need.kind === "partner" ? "Looking for a partner" : "Looking to buy"} · filed{" "}
            {new Date(need.createdAt).toLocaleDateString("en", { dateStyle: "medium" })} · last confirmed{" "}
            {new Date(need.lastConfirmedAt).toLocaleDateString("en", { dateStyle: "medium" })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {need.intentBand && (
            <Badge variant={need.intentBand === "hot" ? "brand" : "neutral"}>{INTENT_LABEL[need.intentBand]}</Badge>
          )}
          <Badge variant={need.status === "open" ? "success" : "neutral"}>{STATUS_LABEL[need.status] ?? need.status}</Badge>
        </div>
      </header>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-6">
          <section aria-labelledby="matches">
            <h2 id="matches" className="text-[15px] font-semibold text-fg">
              Matched suppliers
            </h2>
            <div className="mt-3">
              {!need.matchingEnabled ? (
                <Note tone="info">
                  Matching is not open for this category yet. Your request is saved and counted as demand; suppliers are matched as soon as the category opens.
                </Note>
              ) : need.status !== "open" ? (
                <Note tone="info">This request is not open, so it is not being matched.</Note>
              ) : need.matchList.length === 0 ? (
                <Note tone="info">
                  No supplier matches yet. Open requests are matched every hour, and again whenever new suppliers list in this category.
                </Note>
              ) : (
                <MatchList org={org} matches={need.matchList} canWrite={writable} />
              )}
            </div>
          </section>
        </div>

        <aside className="space-y-4">
          <Card>
            <h2 className="text-[13px] font-semibold text-fg">What you asked for</h2>
            <dl className="mt-3 space-y-2 text-[13px]">
              {[...facts, ...answered.filter(([label]) => !facts.some(([l]) => l === label))].map(([label, value]) => (
                <div key={label} className="flex justify-between gap-3">
                  <dt className="text-fg-muted">{label}</dt>
                  <dd className={value ? "text-right text-fg" : "text-right text-fg-muted italic"}>{value ?? "Unknown"}</dd>
                </div>
              ))}
            </dl>
          </Card>
          {writable && <NeedControls org={org} needId={need.id} status={need.status} visibility={need.visibility} />}
        </aside>
      </div>
    </div>
  );
}

export const generateMetadata = exchangeMetadata("Request");
