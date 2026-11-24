import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, EmptyState, Note } from "@huntloop/ui";
import { Handshake } from "lucide-react";
import { exchangeMetadata, isExchangeEnabled } from "../../../../../lib/exchange/flag";
import { getIntroList, type IntroListItem } from "../../../../../lib/data/exchange";
import { currentViewer } from "../../../../../lib/data/membership";
import { IntroStateBadge } from "./IntroControls";

/**
 * Introductions (build plan DN-68): every conversation this workspace is in,
 * as a buyer or as a supplier. Requests waiting for this workspace's decision
 * come first.
 */
export default async function IntrosPage({ params }: { params: Promise<{ org: string }> }) {
  if (!isExchangeEnabled()) notFound();
  const { org } = await params;
  const viewer = await currentViewer(org);
  if (!viewer) notFound();
  const { data: intros, source } = await getIntroList(org);

  const waiting = intros.filter((i) => i.state === "requested" && i.side === "buyer" && i.direction === "provider");
  const live = intros.filter((i) => !waiting.includes(i) && (i.state === "accepted" || i.state === "requested"));
  const done = intros.filter((i) => !waiting.includes(i) && !live.includes(i));

  return (
    <div className="mx-auto w-full max-w-[1000px] px-6 py-8 lg:px-8">
      <header>
        <h1 className="hl-heading text-fg">Introductions</h1>
        <p className="mt-1 text-[13px] text-fg-muted">Conversations between buyers and suppliers. Only the buyer accepts, and only then are they named.</p>
      </header>
      {source !== "live" && (
        <div className="mt-6">
          <Note tone="info">There is no database on this deployment, so there are no introductions to show.</Note>
        </div>
      )}
      <div className="mt-6 space-y-8">
        {intros.length === 0 ? (
          <EmptyState
            icon={Handshake}
            title="No introductions yet"
            description="Ask for one from a match on your request, or from a matched request on your supplier profile."
          />
        ) : (
          <>
            <Section org={org} title="Waiting for your decision" items={waiting} />
            <Section org={org} title="Open" items={live} />
            <Section org={org} title="Earlier" items={done} />
          </>
        )}
      </div>
    </div>
  );
}

function Section({ org, title, items }: { org: string; title: string; items: IntroListItem[] }) {
  if (!items.length) return null;
  return (
    <section>
      <h2 className="text-[13px] font-semibold tracking-label text-fg-muted uppercase">{title}</h2>
      <div className="mt-3 space-y-2">
        {items.map((i) => {
          const counterpart = i.side === "buyer" ? (i.providerName ?? "A supplier") : (i.buyerName ?? "An anonymous buyer");
          return (
            <Card key={i.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link href={`/${org}/exchange/intros/${i.id}`} className="hl-focusable text-[15px] font-semibold text-fg hover:underline">
                    {counterpart}
                  </Link>
                  <p className="mt-0.5 text-[12px] text-fg-muted">
                    {i.side === "buyer" ? "You are buying" : "You are supplying"} · {i.offeringTitle}
                    {i.needSummary ? ` · “${i.needSummary}”` : i.categoryPath ? ` · ${i.categoryPath}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {i.unread && <Badge variant="brand">New</Badge>}
                  <IntroStateBadge state={i.state} side={i.side} />
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </section>
  );
}

export const generateMetadata = exchangeMetadata("Introductions");
