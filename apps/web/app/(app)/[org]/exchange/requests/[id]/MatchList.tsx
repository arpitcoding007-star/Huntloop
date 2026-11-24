"use client";

import { useState, useTransition } from "react";
import { Badge, Button, Card, FormMessage } from "@huntloop/ui";
import { Star, Undo2, X } from "lucide-react";
import type { DimensionKey, MatchView } from "../../../../../../lib/data/exchange";
import { AVAILABILITY_LABEL, formatPriceRange, placeLabel } from "../../../../../../lib/exchange/format";
import { setMatchStateAction } from "../../actions";
import { AskIntro, IntroLink } from "../../intros/IntroControls";
import type { NeedIntro } from "../../../../../../lib/data/exchange";

const DIMENSIONS: { key: DimensionKey; label: string }[] = [
  { key: "geography", label: "Location" },
  { key: "budget", label: "Budget" },
  { key: "quantity", label: "Minimum order" },
  { key: "availability", label: "Availability" },
  { key: "trust", label: "Supplier trust" },
  { key: "requirement", label: "Must-haves backed" },
];

type Result = { ok: true; message?: string } | { ok: false; error: string } | null;

/**
 * Matches, best first, each with its named dimensions — a dimension nothing
 * measured reads "unknown", never a low number. Dismissed matches fold away
 * but are kept, so a dismissal can be undone.
 */
export function MatchList({
  org,
  matches,
  canWrite,
  intros,
  open,
}: {
  org: string;
  matches: MatchView[];
  canWrite: boolean;
  intros: NeedIntro[];
  /** The request is open, so introductions may be asked for. */
  open: boolean;
}) {
  const introFor = (m: MatchView) =>
    m.offering ? (intros.find((i) => i.offeringId === m.offering!.id && (i.state === "requested" || i.state === "accepted")) ?? intros.find((i) => i.offeringId === m.offering!.id) ?? null) : null;
  const [result, setResult] = useState<Result>(null);
  const [showDismissed, setShowDismissed] = useState(false);
  const live = matches.filter((m) => m.state !== "dismissed");
  const dismissed = matches.filter((m) => m.state === "dismissed");

  return (
    <div className="space-y-3">
      <FormMessage result={result} />
      {live.map((m) => (
        <MatchCard key={m.id} org={org} match={m} canWrite={canWrite} onResult={setResult} intro={introFor(m)} open={open} />
      ))}
      {dismissed.length > 0 && (
        <Button variant="ghost" size="sm" onClick={() => setShowDismissed((v) => !v)}>
          {showDismissed ? "Hide" : "Show"} {dismissed.length} dismissed
        </Button>
      )}
      {showDismissed && dismissed.map((m) => <MatchCard key={m.id} org={org} match={m} canWrite={canWrite} onResult={setResult} intro={introFor(m)} open={open} />)}
    </div>
  );
}

function MatchCard({
  org,
  match: m,
  canWrite,
  onResult,
  intro,
  open,
}: {
  org: string;
  match: MatchView;
  canWrite: boolean;
  onResult: (r: Result) => void;
  intro: NeedIntro | null;
  open: boolean;
}) {
  const [pending, start] = useTransition();
  const act = (state: "new" | "shortlisted" | "dismissed") =>
    start(async () => {
      const res = await setMatchStateAction(org, m.id, state);
      onResult(res.ok ? { ok: true, message: res.message } : { ok: false, error: res.error });
    });

  const price = m.offering ? formatPriceRange(m.offering.priceFrom, m.offering.priceTo, m.offering.currency) : null;
  const serves = m.offering
    ? m.offering.servesGlobal
      ? "Worldwide"
      : m.offering.servesCountries.map((c) => placeLabel(c)).join(", ") || null
    : null;

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[15px] font-semibold text-fg">{m.offering?.title ?? "An offering that is no longer listed"}</p>
          <p className="mt-0.5 text-[12px] text-fg-muted">
            {m.provider?.name ?? "Unknown supplier"}
            {m.provider?.country ? ` · ${placeLabel(m.provider.country)}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {m.provider?.verified ? (
            <Badge variant="success">Verified</Badge>
          ) : m.provider?.claimed ? (
            <Badge variant="info">Claimed profile</Badge>
          ) : (
            <Badge variant="neutral">Unclaimed listing</Badge>
          )}
          {m.state === "shortlisted" && <Badge variant="brand">Shortlisted</Badge>}
          <span
            className="rounded-md border border-line px-2 py-0.5 text-[13px] font-semibold text-fg tabular-nums"
            title={m.score === null ? "Too little is known to score this match" : "The mean of the measured dimensions"}
          >
            {m.score === null ? "Not scored" : `${m.score} / 100`}
          </span>
        </div>
      </div>

      {m.offering?.description && <p className="mt-3 text-[13px] text-fg">{m.offering.description}</p>}

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[12px] sm:grid-cols-4">
        {[
          ["Price", price],
          ["Minimum order", m.offering?.moq !== null && m.offering?.moq !== undefined ? m.offering.moq.toLocaleString("en") : null],
          ["Availability", m.offering?.availability ? (AVAILABILITY_LABEL[m.offering.availability] ?? m.offering.availability) : null],
          ["Serves", serves],
        ].map(([k, v]) => (
          <div key={k as string}>
            <dt className="text-fg-muted">{k}</dt>
            <dd className={v ? "text-fg" : "text-fg-muted italic"}>{v ?? "Unknown"}</dd>
          </div>
        ))}
      </dl>

      <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="How this match was scored">
        {DIMENSIONS.map((d) => {
          const v = m.dimensions[d.key];
          return (
            <li key={d.key}>
              <Badge variant={v === null || v === undefined ? "neutral" : v >= 70 ? "success" : "warning"}>
                {d.label}: {v === null || v === undefined ? "unknown" : v}
              </Badge>
            </li>
          );
        })}
      </ul>
      {m.explanation && <p className="mt-2 text-[12px] text-fg-muted">{m.explanation}</p>}
      {m.cited.length > 0 && (
        <ul className="mt-2 space-y-1 text-[12px]" aria-label="Evidence this match cites">
          {m.cited.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-2">
              <Badge variant={e.kind === "fact" ? "success" : "neutral"}>{e.kind === "fact" ? "Published" : "Supplier says"}</Badge>
              <span className="text-fg">{e.claim}</span>
              {e.sourceUrl && (
                <a href={e.sourceUrl} target="_blank" rel="noopener noreferrer nofollow" className="hl-focusable text-brand underline">
                  {e.sourceTitle ?? "source"}
                </a>
              )}
            </li>
          ))}
        </ul>
      )}

      {canWrite && (
        <div className="mt-3 flex flex-wrap gap-2">
          {m.state !== "shortlisted" && (
            <Button size="sm" variant="secondary" icon={Star} disabled={pending} onClick={() => act("shortlisted")}>
              Shortlist
            </Button>
          )}
          {m.state !== "new" && (
            <Button size="sm" variant="ghost" icon={Undo2} disabled={pending} onClick={() => act("new")}>
              {m.state === "dismissed" ? "Restore" : "Remove from shortlist"}
            </Button>
          )}
          {m.state !== "dismissed" && (
            <Button size="sm" variant="ghost" icon={X} disabled={pending} onClick={() => act("dismissed")}>
              Dismiss
            </Button>
          )}
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {intro ? (
          <IntroLink org={org} introId={intro.id} state={intro.state} side="buyer" />
        ) : canWrite && open && m.offering && m.state !== "dismissed" ? (
          <AskIntro org={org} matchId={m.id} side="buyer" supplierName={m.provider?.name ?? null} />
        ) : null}
      </div>
    </Card>
  );
}
