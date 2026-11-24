import { Badge, Card, CardHeader, Note } from "@huntloop/ui";
import type { IntroListItem, MatchedCard } from "../../../../../lib/data/exchange";
import { AskIntro, IntroLink } from "../intros/IntroControls";
import { ReportButton } from "../ReportButton";
import { countryName } from "../../../../../lib/exchange/requirement";
import { timelineLabel } from "../../../../../lib/exchange/format";

/**
 * The requests this workspace's offerings were matched to, as the buyers
 * chose to show them (spec §5): bands, never exact amounts; place widened
 * until ten requests share it; the buyer's own words only at level 3. Reading
 * this list is logged for each buyer — the copy says so, because it is true.
 */
export function MatchedRequests({
  org,
  cards,
  intros,
  canWrite,
}: {
  org: string;
  cards: MatchedCard[];
  intros: IntroListItem[];
  canWrite: boolean;
}) {
  return (
    <Card>
      <CardHeader
        title="Matched requests"
        description="Buyers whose requests fit your listed offerings, as anonymous cards. Each buyer can see that your workspace viewed their card."
      />
      <div className="mt-4 space-y-3">
        {cards.length === 0 ? (
          <Note tone="info">
            No visible requests match your offerings yet. Buyers choose whether suppliers may see their request; many keep it counted only.
          </Note>
        ) : (
          cards.map((c) => {
            const place = c.place && /^[A-Z]{2}$/.test(c.place) ? countryName(c.place) : c.place;
            return (
              <div key={c.matchId} className="rounded-md border border-line p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[14px] font-semibold text-fg">{c.categoryPath ?? "Uncategorised request"}</p>
                    <p className="mt-0.5 text-[12px] text-fg-muted">Matched to your offering “{c.offeringTitle}”</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={c.level >= 3 ? "brand" : "neutral"}>{c.level >= 3 ? "Open to introductions" : "Anonymous"}</Badge>
                    <span className="rounded-md border border-line px-2 py-0.5 text-[13px] font-semibold text-fg tabular-nums">
                      {c.score === null ? "Not scored" : `${c.score} / 100`}
                    </span>
                  </div>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[12px] sm:grid-cols-4">
                  {[
                    ["Quantity", c.quantityBand ? `${c.quantityBand}${c.unit ? ` ${c.unit}` : ""}` : null],
                    ["Budget", c.budgetBand],
                    ["Where", place],
                    ["Timeline", timelineLabel(c.timeline)],
                  ].map(([k, v]) => (
                    <div key={k as string}>
                      <dt className="text-fg-muted">{k}</dt>
                      <dd className={v ? "text-fg" : "text-fg-muted italic"}>{v ?? "Unknown"}</dd>
                    </div>
                  ))}
                </dl>
                {c.summary && <p className="mt-3 text-[13px] text-fg">“{c.summary}”</p>}
                {c.mustHaves && <p className="mt-1 text-[12px] text-fg-muted">Must-haves: {c.mustHaves}</p>}
                <div className="mt-3 flex flex-wrap items-start gap-2">
                  {(() => {
                    const intro = intros.find((i) => i.side === "provider" && i.matchId === c.matchId);
                    if (intro) return <IntroLink org={org} introId={intro.id} state={intro.state} side="provider" />;
                    return canWrite ? <AskIntro org={org} matchId={c.matchId} side="provider" /> : null;
                  })()}
                  {canWrite && <ReportButton org={org} subject="need" subjectId={c.needId} label="Report this request" />}
                </div>
              </div>
            );
          })
        )}
      </div>
    </Card>
  );
}
