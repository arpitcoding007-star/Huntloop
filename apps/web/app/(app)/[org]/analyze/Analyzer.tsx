"use client";

import { useState, useTransition } from "react";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ClaimBadge,
  ErrorState,
  EvidenceList,
  LoadingSkeleton,
  PriorityBadge,
  ScorePill,
  SectionLabel,
  type EvidenceItem,
  type ScoreDimension,
} from "@huntloop/ui";
import { CalendarClock, Globe, Search } from "lucide-react";
import type { Qualification, Urgency } from "@huntloop/ai";
import {
  analyzeUrlAction,
  whyNowAction,
  type AnalyzeState,
  type WhyNowState,
} from "./actions";

/**
 * §17 — paste a company URL, get a verdict.
 *
 * The screen's job is to render the verdict the model reached, including when
 * that verdict is **no**. §17 says Huntloop must be willing to answer no and
 * must not qualify a company merely because the user typed it in, so the
 * refusal gets the same layout and the same visual weight as the happy path —
 * a "don't contact" rendered quietly reads as the tool failing rather than as
 * the tool answering.
 *
 * Nothing here re-derives or adjusts what came back. The score is not
 * recomputed from the dimensions (§51 leaves the weighting undefined, so any
 * arithmetic here would be invented), and a verdict is never softened for
 * presentation.
 */

/**
 * `Qualification` → the component props.
 *
 * Explicit rather than a spread, so a drift between the model's output shape
 * and the UI's contract is a type error here instead of a mislabelled row on
 * screen. The `null` → `undefined` conversions are the whole reason this
 * exists: the AI layer says "not established" with null, React props say it
 * with absence.
 */
function toDimensions(q: Qualification): ScoreDimension[] {
  return q.dimensions.map((d) => ({
    label: d.label,
    value: d.value,
    note: d.note ?? undefined,
  }));
}

function toEvidence(q: Qualification): EvidenceItem[] {
  return q.evidence.map((e) => ({
    claim: e.claim,
    kind: e.kind,
    confidence: e.confidence ?? undefined,
    sourceUrl: e.sourceUrl ?? undefined,
    // Every fact in this task is read from the company's own site — that is
    // the only thing the run was allowed to fetch — so naming the domain is
    // accurate rather than decorative.
    source: e.sourceUrl ? q.canonicalDomain : undefined,
    excerpt: e.excerpt ?? undefined,
    // No dates. The task does not establish when a page's claim was made, and
    // a freshness badge derived from the time we happened to read it would be
    // a measurement of us, not of the company.
  }));
}

/** §16 forbids fake precision, so the horizon is a phrase, not a date. */
const URGENCY_LABELS: Record<Urgency, string> = {
  this_week: "This week",
  this_month: "This month",
  this_quarter: "This quarter",
};

export function Analyzer({ org }: { org: string }) {
  const [url, setUrl] = useState("");
  const [phase, setPhase] = useState<"idle" | "running" | "done">("idle");
  const [state, setState] = useState<AnalyzeState>({});
  const [timing, setTiming] = useState<WhyNowState | "running" | null>(null);
  const [, startTransition] = useTransition();

  function analyze(e: React.FormEvent) {
    e.preventDefault();
    setPhase("running");
    setState({});
    setTiming(null);
    startTransition(async () => {
      const next = await analyzeUrlAction(org, url);
      setState(next);
      // A failed run returns to the input state rather than to a demo verdict.
      // Substituting the worked example here would put an invented assessment
      // in front of someone about to decide how to spend their week.
      setPhase(next.result ? "done" : "idle");
    });
  }

  /**
   * A second, explicit call rather than part of qualification.
   *
   * §46 sequences them that way, and it also means a user who has just been
   * told a company is a poor fit is not billed for an answer about when to
   * contact them.
   */
  function askWhyNow(q: Qualification) {
    setTiming("running");
    startTransition(async () => {
      setTiming(
        await whyNowAction(org, {
          companyName: q.companyName,
          canonicalDomain: q.canonicalDomain,
          priority: q.priority,
          evidence: q.evidence,
        }),
      );
    });
  }

  const result = state.result;
  const q = result?.qualification;

  return (
    <div className="mx-auto w-full max-w-[900px] px-6 py-8 lg:px-8">
      <header>
        <h1 className="text-[30px] leading-9 font-semibold text-fg">Analyze a URL</h1>
        <p className="mt-1 max-w-xl text-[13px] leading-[1.5] text-fg-muted">
          Paste any company&rsquo;s website. Huntloop researches it against{" "}
          {org}&rsquo;s ICP and tells you whether it is worth contacting —{" "}
          <span className="text-fg-secondary">including when it isn&rsquo;t.</span>
        </p>
      </header>

      {state.error && (
        <ErrorState
          className="mt-6"
          title="That didn't work"
          description={state.error}
        />
      )}

      <form onSubmit={analyze} className="mt-6 flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Globe
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-muted"
            strokeWidth={1.75}
          />
          <input
            type="text"
            required
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            aria-label="Company website"
            placeholder="https://company.com"
            className="hl-focusable h-10 w-full rounded-md border border-line bg-surface pr-3 pl-9 text-[14px] text-fg placeholder:text-fg-muted"
          />
        </div>
        <Button
          type="submit"
          variant="primary"
          size="lg"
          icon={Search}
          disabled={phase === "running"}
        >
          {phase === "running" ? "Researching…" : "Analyze"}
        </Button>
      </form>

      {phase === "running" && (
        <div className="mt-8">
          <SectionLabel>Researching</SectionLabel>
          <p className="mt-2 text-[13px] text-fg-muted">
            Reading their site and judging it against your ICP. This reads
            several pages, so it takes a moment.
          </p>
          <LoadingSkeleton className="mt-3" rows={4} rowHeight={64} />
        </div>
      )}

      {phase === "done" && q && (
        <div className="mt-8 space-y-6">
          {/* The screen never lets a worked example pass for a real verdict. */}
          {result?.source === "unconfigured" && (
            <p
              role="status"
              className="rounded-md border border-warning-border bg-warning-surface px-3 py-2 text-[13px] leading-[1.5] text-fg-secondary"
            >
              <span className="font-medium text-warning">No model is connected.</span>{" "}
              This is a worked example, not an assessment — nothing fetched{" "}
              <span className="font-mono text-[12px] text-fg">{q.canonicalDomain}</span>.
              Add{" "}
              <span className="font-mono text-[12px] text-fg">ANTHROPIC_API_KEY</span> to{" "}
              <span className="font-mono text-[12px] text-fg">apps/web/.env.local</span>{" "}
              to make this real.
            </p>
          )}

          <Card flush>
            <CardHeader
              title={
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[14px]">{q.canonicalDomain}</span>
                  <PriorityBadge priority={q.priority} reason={q.priorityReason} />
                </span>
              }
              actions={
                <ScorePill
                  score={q.score}
                  explanation={q.explanation}
                  confidence={q.scoreConfidence}
                  dimensions={toDimensions(q)}
                />
              }
            />
            <CardBody className="space-y-4">
              <p className="text-[14px] leading-[1.6] text-fg-secondary">{q.summary}</p>

              {/* The recommendation gets the same visual weight whether it is
                  "contact this week" or "don't". A refusal rendered quietly
                  reads as a failure of the tool rather than an answer. */}
              <div
                className={[
                  "rounded-md border px-4 py-3",
                  q.priority === "ignore"
                    ? "border-line bg-surface-active"
                    : "border-brand-border bg-brand-surface",
                ].join(" ")}
              >
                <SectionLabel>Recommendation</SectionLabel>
                <p
                  className={[
                    "mt-1.5 text-[14px] leading-[1.6]",
                    q.priority === "ignore" ? "text-fg-secondary" : "text-brand-text",
                  ].join(" ")}
                >
                  {q.recommendation}
                </p>
              </div>
            </CardBody>
          </Card>

          {/* §77 Principle 3 — a strong opportunity should have a reason it
              matters now. Behind a button because it is a second model call,
              and hidden entirely for IGNORE: "when should you contact a company
              you should not contact" is not a question worth paying for. */}
          {q.priority !== "ignore" && (
            <Card flush>
              <CardHeader
                title="Why now"
                description="Whether there's a reason to contact them today — or not."
                actions={
                  timing === null && (
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={CalendarClock}
                      onClick={() => askWhyNow(q)}
                    >
                      Check timing
                    </Button>
                  )
                }
              />
              <CardBody>
                {timing === null && (
                  <p className="text-[13px] leading-[1.6] text-fg-muted">
                    Not checked yet. This reasons over the evidence above — it
                    fetches nothing new, so it can only tell you what the
                    evidence already supports.
                  </p>
                )}

                {timing === "running" && (
                  <LoadingSkeleton rows={2} rowHeight={40} />
                )}

                {timing && timing !== "running" && timing.error && (
                  <p className="text-[13px] leading-[1.6] text-danger">
                    {timing.error}
                  </p>
                )}

                {timing && timing !== "running" && timing.result && (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      {timing.result.whyNow.hasReason ? (
                        <>
                          <Badge variant="brand">
                            {URGENCY_LABELS[timing.result.whyNow.urgency!]}
                          </Badge>
                          <span className="text-[11px] tracking-[0.06em] text-fg-muted uppercase">
                            {timing.result.whyNow.confidence} confidence
                          </span>
                        </>
                      ) : (
                        /* Given the same weight as a reason. This is the answer
                           the product exists to be able to give, and rendering
                           it as a greyed-out non-result would teach everyone
                           that it is a failure to be avoided. */
                        <Badge variant="neutral">No reason today</Badge>
                      )}
                    </div>

                    <p className="text-[14px] leading-[1.6] text-fg-secondary">
                      {timing.result.whyNow.reason}
                    </p>

                    {timing.result.whyNow.basedOn.length > 0 && (
                      <div>
                        <SectionLabel>Rests on</SectionLabel>
                        {/* The traceability payoff: the timing claim names the
                            established claims underneath it, and the task
                            refused any that were not among them. */}
                        <ul className="mt-1.5 space-y-1">
                          {timing.result.whyNow.basedOn.map((claim) => (
                            <li
                              key={claim}
                              className="border-l-2 border-line pl-2.5 text-[13px] leading-[1.5] text-fg-muted"
                            >
                              {claim}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </CardBody>
            </Card>
          )}

          <Card flush>
            <CardHeader
              title="Evidence"
              description="What this verdict rests on — and what it doesn't."
            />
            <CardBody>
              <EvidenceList items={toEvidence(q)} />
            </CardBody>
          </Card>

          {/* §78: incomplete research is disclosed rather than left to be
              inferred from an absence. This is the limit a reader would never
              guess — the verdict is drawn from one website, because the scan
              pipeline that reads everything else does not run yet. */}
          <p className="rounded-md border border-line-subtle bg-surface px-4 py-3 text-[12px] leading-[1.6] text-fg-muted">
            <span className="text-fg-secondary">What this verdict could see:</span>{" "}
            <span className="font-mono text-[11px] text-fg-secondary">
              {result?.readDomains.join(", ")}
            </span>
            . No news, funding, hiring or social sources were consulted — those
            arrive with scheduled scanning. A trigger that was never published on
            their own site is one this verdict does not know about, which is why{" "}
            <em>trigger freshness</em> is often unknown here.
          </p>

          <p className="flex flex-wrap items-center gap-1.5 text-[12px] text-fg-muted">
            <ClaimBadge kind="fact" /> observed at a source ·
            <ClaimBadge kind="inference" /> concluded by a model ·
            <ClaimBadge kind="unknown" /> not established.
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setPhase("idle");
                setUrl("");
                setState({});
              }}
            >
              Analyze another
            </Button>
            {q.priority !== "ignore" && (
              <>
                <Button variant="primary" disabled>
                  Save as an opportunity
                </Button>
                {/* Disabled with the reason next to it. A button that looks
                    live and does nothing is worse than one that says why. */}
                <span className="text-[12px] text-fg-muted">
                  Saving needs the database — not connected yet.
                </span>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
