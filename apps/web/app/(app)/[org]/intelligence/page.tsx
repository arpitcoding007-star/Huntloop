import { notFound } from "next/navigation";
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  ClaimBadge,
  EmptyState,
  EvidenceList,
  Freshness,
  SectionLabel,
  type EvidenceItem,
} from "@huntloop/ui";
import { Lightbulb } from "lucide-react";
import { getIntelligence } from "../../../../lib/data/intelligence";
import { currentViewer } from "../../../../lib/data/membership";
import { DemoFigures } from "../DemoFigures";

/**
 * Intelligence — what Huntloop has actually observed.
 *
 * ── Why this page has no client component ────────────────────────────────
 *
 * Nothing on it is editable, and that is the design rather than a shortcut.
 * Evidence is a record of what was observed, with the provenance that lets the
 * agent answer "why do you think this?" — a screen that let a user edit a
 * claim would turn the evidence table into notes, and `evidence_fact_needs_
 * source` would be enforcing a rule about something people type.
 *
 * ── The ratio is the headline ────────────────────────────────────────────
 *
 * §7 makes fact-versus-inference the product's central claim, so it is the
 * first thing on the page. An account with 200 inferences and 3 facts is in a
 * very different state from the reverse, and no other number on this screen
 * distinguishes them.
 */
export default async function IntelligencePage({
  params,
}: {
  params: Promise<{ org: string }>;
}) {
  const { org } = await params;

  const viewer = await currentViewer(org);
  if (!viewer) notFound();

  const { data, source } = await getIntelligence(org);
  const now = new Date();
  const total = data.counts.fact + data.counts.inference + data.counts.unknown;

  return (
    <div className="mx-auto w-full max-w-[1000px] px-6 py-8 lg:px-8">
      <header>
        <h1 className="text-[30px] leading-9 font-semibold text-fg">Intelligence</h1>
        <p className="mt-1 text-[13px] text-fg-muted">
          {org} · what has been observed, and how much of it is established
        </p>
      </header>

      {source !== "live" && (
        <div className="mt-6">
          <DemoFigures what="This is example evidence, not findings about your accounts." />
        </div>
      )}

      <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2">
        <Figure label="Facts" value={data.counts.fact} />
        <Figure label="Inferences" value={data.counts.inference} />
        <Figure label="Open questions" value={data.counts.unknown} />
        <Figure label="Triggers" value={data.triggers.length} />
      </div>

      {total > 0 && data.counts.fact === 0 && (
        /* Worth saying out loud rather than leaving to be inferred from a
           zero. Every claim being an inference is a real state — it is what an
           account looks like before anything has been verified at a source —
           and it changes how much weight the rest of the product's output
           deserves. */
        <p className="mt-4 rounded-md border border-warning-border bg-warning-surface px-4 py-3 text-[13px] text-warning">
          Nothing here is established at a source yet. Every claim below is an
          inference, so treat the priorities built on them as provisional.
        </p>
      )}

      <section className="mt-8">
        <SectionLabel>Evidence</SectionLabel>
        <Card className="mt-3">
          <CardHeader
            title="What has been observed"
            description="A fact names the source it was observed at. An inference does not, and says so."
          />
          <CardBody>
            {data.evidence.length === 0 ? (
              <EmptyState
                icon={Lightbulb}
                title="No evidence yet"
                description="Evidence arrives from a hunt or from Analyze a URL. Each claim carries its kind, its confidence and where it came from."
              />
            ) : (
              <EvidenceList items={data.evidence.map(toEvidenceItem)} now={now} />
            )}
          </CardBody>
        </Card>
      </section>

      <section className="mt-8">
        <SectionLabel>Triggers</SectionLabel>
        <Card flush className="mt-3">
          {data.triggers.length === 0 ? (
            <CardBody>
              <p className="text-[13px] text-fg-muted">
                No triggers recorded. A trigger is the event that makes now the
                moment — funding, a hire, a launch.
              </p>
            </CardBody>
          ) : (
            <ul className="divide-y divide-line-subtle">
              {data.triggers.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <span className="truncate text-[13px] font-medium text-fg">
                      {t.company}
                    </span>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3">
                      <Badge variant="neutral">{t.triggerType}</Badge>
                      <Freshness date={t.eventDate} now={now} label="Happened" />
                    </div>
                  </div>
                  {/* §78: a null strength is UNKNOWN, and rendering it as 0
                      would assert "we measured this and it is weak". */}
                  <span className="font-mono text-[12px] text-fg-muted">
                    {t.strength === null ? "strength unknown" : `strength ${t.strength}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      <section className="mt-8">
        <SectionLabel>Decisions and overrides</SectionLabel>
        <Card flush className="mt-3">
          {data.decisions.length === 0 ? (
            <CardBody>
              <p className="text-[13px] text-fg-muted">
                No model decisions recorded yet. When one is overruled, the
                original is kept beside the correction — that pair is the only
                labelled data the learning loop gets.
              </p>
            </CardBody>
          ) : (
            <ul className="divide-y divide-line-subtle">
              {data.decisions.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <span className="text-[13px] text-fg">{d.decisionType}</span>
                    {d.createdAt && (
                      <div className="mt-0.5">
                        <Freshness date={d.createdAt} now={now} label="Decided" />
                      </div>
                    )}
                  </div>
                  {d.confidence && <ClaimBadge kind="inference" confidence={d.confidence} />}
                  {d.overridden && <Badge variant="warning">Overruled by a human</Badge>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>
    </div>
  );
}

function Figure({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-[11px] font-medium tracking-[0.06em] text-fg-muted uppercase">
        {label}
      </p>
      <p className="mt-0.5 font-mono text-[18px] text-fg">{value}</p>
    </div>
  );
}

/** The shared `EvidenceList` shape, so this screen renders claims identically
 *  to the opportunity detail rather than inventing a second presentation. */
function toEvidenceItem(row: {
  claim: string;
  kind: "fact" | "inference" | "unknown";
  confidence: "low" | "medium" | "high" | null;
  sourceUrl: string | null;
  excerpt: string | null;
  eventDate: string | null;
  observedAt: string | null;
}): EvidenceItem {
  /* `EvidenceItem`'s fields are optional, not nullable, while the columns
     behind them are nullable — so each null becomes `undefined` rather than
     being passed through. They mean the same thing here ("not present"), and
     `??` keeps that conversion in one place instead of leaving `null` to
     render as the string "null" somewhere downstream. */
  return {
    claim: row.claim,
    kind: row.kind,
    confidence: row.confidence ?? undefined,
    sourceUrl: row.sourceUrl ?? undefined,
    excerpt: row.excerpt ?? undefined,
    eventDate: row.eventDate ?? undefined,
    observedAt: row.observedAt ?? undefined,
  };
}

export const metadata = { title: "Intelligence" };
