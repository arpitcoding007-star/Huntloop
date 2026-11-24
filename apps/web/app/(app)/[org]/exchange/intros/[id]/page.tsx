import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardHeader, Note } from "@huntloop/ui";
import { exchangeMetadata, isExchangeEnabled } from "../../../../../../lib/exchange/flag";
import { getIntroDetail } from "../../../../../../lib/data/exchange";
import { canWrite, currentViewer } from "../../../../../../lib/data/membership";
import { formatMoney, placeLabel, timelineLabel } from "../../../../../../lib/exchange/format";
import { uuidSchema } from "../../../../../../lib/validation";
import { IntroDecision, IntroStateBadge, OutcomeForm, ShareContact, Thread, WithdrawIntro } from "../IntroControls";

const OUTCOME_LABEL: Record<string, string> = {
  won: "Did business",
  lost: "Went elsewhere",
  not_a_fit: "Not a fit",
  no_decision: "No decision",
};

/**
 * One introduction (DN-68). What each side sees is decided by
 * `exchange_intro_detail`: before the buyer accepts, the supplier sees only
 * the card's bands; after, the buyer's name and the request in full, and the
 * buyer's email only if they chose to share it.
 */
export default async function IntroPage({ params }: { params: Promise<{ org: string; id: string }> }) {
  if (!isExchangeEnabled()) notFound();
  const { org, id } = await params;
  const viewer = await currentViewer(org);
  if (!viewer) notFound();
  if (!uuidSchema.safeParse(id).success) notFound();
  const { data: intro } = await getIntroDetail(org, id);
  if (!intro) notFound();
  const writable = canWrite(viewer);
  const buyer = intro.side === "buyer";
  const open = intro.state === "accepted";
  const revealed = buyer || ["accepted", "closed", "stale"].includes(intro.state);
  const mine = intro.outcomes.find((o) => o.side === intro.side) ?? null;
  const counterpart = buyer ? (intro.providerName ?? "The supplier") : (intro.buyerName ?? "An anonymous buyer");

  const n = intro.need;
  const facts: [string, string | null][] = revealed
    ? [
        ["Category", n.categoryPath],
        ["Quantity", n.quantity !== null ? `${n.quantity.toLocaleString("en")}${n.unit ? ` ${n.unit}` : ""}` : null],
        ["Budget, at most", formatMoney(n.budgetMax, n.currency)],
        ["Country", placeLabel(n.country)],
        ["Deliver to", n.deliverTo],
        ["Timeline", timelineLabel(n.timeline)],
        ...n.attributes
          .filter((a) => !["quantity", "unit", "budget", "deliver_to", "timeline"].includes(a.key))
          .map((a) => [a.label, n.requirement?.[a.key]?.value ?? null] as [string, string | null]),
      ]
    : [
        ["Category", n.categoryPath],
        ["Quantity", n.quantityBand],
        ["Budget", n.budgetBand],
        ["Timeline", timelineLabel(n.timeline)],
      ];

  return (
    <div className="mx-auto w-full max-w-[1100px] px-6 py-8 lg:px-8">
      <p className="text-[12px] text-fg-muted">
        <Link href={`/${org}/exchange/intros`} className="hl-focusable hover:underline">
          Introductions
        </Link>
      </p>
      <header className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="hl-heading text-fg">{counterpart}</h1>
          <p className="mt-1 text-[13px] text-fg-muted">
            {buyer ? "Supplying you" : "Buying from you"} · {intro.offering.title}
          </p>
        </div>
        <IntroStateBadge state={intro.state} side={intro.side} />
      </header>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-4">
          {intro.message && (
            <Note tone="info">
              {intro.direction === intro.side ? "Your note: " : `${buyer ? "Their" : "The buyer's"} note: `}“{intro.message}”
            </Note>
          )}
          {intro.state === "requested" && buyer && intro.direction === "provider" && writable && (
            <Card>
              <CardHeader
                title={`${counterpart} would like to talk about your request`}
                description="If you accept, they see your workspace name and the request in full, and you can message each other. Your email stays private unless you share it."
              />
              <div className="mt-3">
                <IntroDecision org={org} introId={intro.id} />
              </div>
            </Card>
          )}
          {intro.state === "requested" && intro.direction === intro.side && writable && (
            <Card>
              <p className="text-[13px] text-fg">Waiting for the buyer to decide. Unanswered requests lapse after 14 days.</p>
              <div className="mt-3">
                <WithdrawIntro org={org} introId={intro.id} />
              </div>
            </Card>
          )}
          <Card>
            <CardHeader title="Messages" />
            <div className="mt-3">
              <Thread org={org} introId={intro.id} side={intro.side} messages={intro.messages} open={open && writable} />
            </div>
          </Card>
        </div>

        <aside className="space-y-4">
          <Card>
            <h2 className="text-[13px] font-semibold text-fg">{buyer ? "Your request" : revealed ? "Their request" : "The request, as the buyer shows it"}</h2>
            {revealed && n.summary && <p className="mt-2 text-[13px] text-fg">“{n.summary}”</p>}
            <dl className="mt-3 space-y-2 text-[13px]">
              {facts.map(([label, value]) => (
                <div key={label} className="flex justify-between gap-3">
                  <dt className="text-fg-muted">{label}</dt>
                  <dd className={value ? "text-right text-fg" : "text-right text-fg-muted italic"}>{value ?? "Unknown"}</dd>
                </div>
              ))}
            </dl>
          </Card>

          {revealed && (
            <Card>
              <h2 className="text-[13px] font-semibold text-fg">Contact</h2>
              {intro.contact ? (
                <p className="mt-2 text-[13px] text-fg">
                  {intro.contact.name ?? "The buyer"}
                  {intro.contact.email && (
                    <>
                      {" · "}
                      <a href={`mailto:${intro.contact.email}`} className="hl-focusable text-brand underline">
                        {intro.contact.email}
                      </a>
                    </>
                  )}
                </p>
              ) : (
                <p className="mt-2 text-[13px] text-fg-muted">
                  {buyer ? "Not shared. The supplier reaches you here until you choose to share it." : "The buyer has not shared their contact details. Reply here."}
                </p>
              )}
              {buyer && open && !intro.contact && writable && (
                <div className="mt-3">
                  <ShareContact org={org} introId={intro.id} />
                </div>
              )}
              {!buyer && intro.opportunityId && (
                <p className="mt-3 text-[12px]">
                  <Link href={`/${org}/opportunities/${intro.opportunityId}`} className="hl-focusable text-brand underline">
                    Open the opportunity
                  </Link>
                  <span className="text-fg-muted"> — a stated need, kept out of every campaign.</span>
                </p>
              )}
            </Card>
          )}

          {["accepted", "closed", "stale"].includes(intro.state) && (
            <Card>
              <h2 className="text-[13px] font-semibold text-fg">Outcome</h2>
              {intro.outcomes.length > 0 && (
                <ul className="mt-2 space-y-1 text-[13px]">
                  {intro.outcomes.map((o) => (
                    <li key={o.side}>
                      <span className="text-fg-muted">{o.side === intro.side ? "You" : buyer ? "Supplier" : "Buyer"}:</span>{" "}
                      <span className="text-fg">{OUTCOME_LABEL[o.outcome] ?? o.outcome}</span>
                      {o.reason ? <span className="text-fg-muted"> — {o.reason}</span> : null}
                    </li>
                  ))}
                </ul>
              )}
              {writable && (
                <div className="mt-3">
                  <OutcomeForm org={org} introId={intro.id} current={mine?.outcome ?? null} />
                </div>
              )}
              <p className="mt-2 text-[11px] text-fg-muted">Reporting an outcome closes the conversation. Both sides report; a disagreement is kept, not resolved.</p>
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}

export const generateMetadata = exchangeMetadata("Introduction");
