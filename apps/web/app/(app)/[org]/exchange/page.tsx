import Link from "next/link";
import { notFound } from "next/navigation";
import { exchangeMetadata, isExchangeEnabled } from "../../../../lib/exchange/flag";
import { Badge, Button, Card, EmptyState, Note } from "@huntloop/ui";
import { ClipboardList, MessageSquarePlus } from "lucide-react";
import { getExchangeQuotas, listMyNeeds } from "../../../../lib/data/exchange";
import { canWrite, currentViewer } from "../../../../lib/data/membership";
import { formatMoney, placeLabel, STATUS_LABEL, timelineLabel, visibilityLabel } from "../../../../lib/exchange/format";

/**
 * My requests — what this workspace has asked the Exchange for, and how many
 * suppliers each has been matched with. Build plan Phase 2.
 */
export default async function ExchangeRequestsPage({ params }: { params: Promise<{ org: string }> }) {
  if (!isExchangeEnabled()) notFound();
  const { org } = await params;
  const viewer = await currentViewer(org);
  if (!viewer) notFound();
  const [{ data: needs, source }, { data: quotas }] = await Promise.all([listMyNeeds(org), getExchangeQuotas(org)]);
  const writable = canWrite(viewer);

  return (
    <div className="mx-auto w-full max-w-[1100px] px-6 py-8 lg:px-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="hl-heading text-fg">My requests</h1>
          <p className="mt-1 text-[13px] text-fg-muted">
            What you have asked the Exchange for, and the suppliers matched to each
          </p>
        </div>
        {writable && (
          <Button variant="primary" icon={MessageSquarePlus} href={`/${org}/exchange/new`} linkComponent={Link}>
            New request
          </Button>
        )}
      </header>

      {source !== "live" && (
        <div className="mt-6">
          <Note tone="info">There is no database on this deployment, so there are no requests to show.</Note>
        </div>
      )}

      {quotas.filter((q) => q.metric === "needs_open").map((q) => (
        <p key={q.metric} className="mt-4 text-[13px] text-fg-muted">
          {q.used} of {q.quota} open requests in use.
        </p>
      ))}

      <div className="mt-6 space-y-3">
        {needs.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title="No requests yet"
            description="Describe what you need in a sentence. A few questions follow, and matching suppliers appear here."
          />
        ) : (
          needs.map((n) => {
            const facts = [
              n.quantity !== null ? `${n.quantity.toLocaleString("en")}${n.unit ? ` ${n.unit}` : ""}` : null,
              formatMoney(n.budgetMax, n.currency) && `up to ${formatMoney(n.budgetMax, n.currency)}`,
              placeLabel(n.country),
              timelineLabel(n.timeline),
            ].filter(Boolean);
            return (
              <Card key={n.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link href={`/${org}/exchange/requests/${n.id}`} className="hl-focusable text-[15px] font-semibold text-fg hover:underline">
                      {n.summary}
                    </Link>
                    <p className="mt-1 text-[12px] text-fg-muted">
                      {n.categoryPath ?? "Uncategorised"}
                      {facts.length ? ` · ${facts.join(" · ")}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={n.status === "open" ? "success" : "neutral"}>{STATUS_LABEL[n.status] ?? n.status}</Badge>
                    <Badge variant="info">{visibilityLabel(n.visibility)}</Badge>
                    {n.matchingEnabled ? (
                      <Badge variant="brand">
                        {n.matches} {n.matches === 1 ? "match" : "matches"}
                        {n.shortlisted ? ` · ${n.shortlisted} shortlisted` : ""}
                      </Badge>
                    ) : (
                      <Badge variant="warning">Matching not open yet</Badge>
                    )}
                  </div>
                </div>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}

export const generateMetadata = exchangeMetadata("My requests");
