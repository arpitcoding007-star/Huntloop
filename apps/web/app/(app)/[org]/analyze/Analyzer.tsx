"use client";

import { useState } from "react";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  ClaimBadge,
  EvidenceList,
  LoadingSkeleton,
  PriorityBadge,
  ScorePill,
  SectionLabel,
  type EvidenceItem,
  type Priority,
  type ScoreDimension,
} from "@huntloop/ui";
import { Globe, Search } from "lucide-react";

/**
 * §17 — paste a company URL, get a verdict.
 *
 * The demo below is hard-wired to two outcomes, and the second one is the
 * point: a company that looks fine and is **not** a fit gets IGNORE, in the
 * same layout, with the reasons spelled out. §17 says Huntloop "should be
 * willing to answer: No", and a screen that only ever renders a happy path
 * trains everyone — designers, engineers, the model's eventual prompt — to
 * treat the refusal as an edge case rather than a core output.
 *
 * No model is connected. The button runs a fixed script; the panel says so.
 */

interface Verdict {
  domain: string;
  priority: Priority;
  priorityReason: string;
  score: number;
  explanation: string;
  confidence: "high" | "medium" | "low";
  dimensions: ScoreDimension[];
  summary: string;
  recommendation: string;
  evidence: EvidenceItem[];
}

const NOW = new Date("2026-08-11T09:00:00Z");

const GOOD: Verdict = {
  domain: "alphio.ai",
  priority: "hot",
  priorityReason:
    "Strong ICP fit, a problem the founder stated publicly, and a funding trigger three days old.",
  score: 91,
  explanation:
    "Series A closed this week and the launch post names custody permissions as an open problem.",
  confidence: "medium",
  dimensions: [
    { label: "ICP fit", value: 94 },
    { label: "Problem severity", value: 88 },
    { label: "Evidence strength", value: 82 },
    { label: "Trigger strength", value: 90 },
    { label: "Trigger freshness", value: 96 },
    { label: "Buying likelihood", value: "unknown" },
    { label: "Product relevance", value: 92 },
    { label: "Decision-maker accessibility", value: 71 },
  ],
  summary:
    "Autonomous trading agents for crypto desks. They have just raised institutional money and have publicly named the blocker your product removes.",
  recommendation: "Worth contacting this week. Lead with the blocker, not the round.",
  evidence: [
    {
      claim: "Alphio AI closed a $12M Series A led by Northgate Ventures.",
      kind: "fact",
      confidence: "high",
      source: "TechCrunch",
      sourceUrl: "https://techcrunch.com/",
      eventDate: "2026-08-08",
      observedAt: "2026-08-09",
      excerpt:
        "Alphio AI has raised $12 million to scale its autonomous trading agents to institutional desks.",
    },
    {
      claim: "They will need controlled financial permissions to onboard desks.",
      kind: "inference",
      confidence: "medium",
      source: "Derived from the launch post",
      eventDate: "2026-08-08",
      observedAt: "2026-08-09",
    },
    { claim: "Whether budget is allocated this quarter.", kind: "unknown" },
  ],
};

const BAD: Verdict = {
  domain: "harbourfront.fund",
  priority: "ignore",
  priorityReason:
    "Outside every active ICP. Matched on region only, which is not a reason to contact anyone.",
  score: 21,
  explanation:
    "A regional investment fund. No product, no engineering org, and nothing your product applies to. The only overlap is geography.",
  confidence: "high",
  dimensions: [
    { label: "ICP fit", value: 12 },
    { label: "Problem severity", value: "unknown" },
    { label: "Evidence strength", value: 44 },
    { label: "Trigger strength", value: 0 },
    { label: "Trigger freshness", value: 0 },
    { label: "Buying likelihood", value: "unknown" },
    { label: "Product relevance", value: 9 },
    { label: "Decision-maker accessibility", value: "unknown" },
  ],
  summary:
    "A boutique investment fund. They do not build software, do not run infrastructure, and have no public engineering presence.",
  recommendation:
    "Don't contact. There is no version of this where the product is relevant, and a good opener cannot be written for a company that does not have the problem.",
  evidence: [
    {
      claim: "Harbourfront Capital is an investment fund with no software product.",
      kind: "fact",
      confidence: "high",
      source: "Company website",
      sourceUrl: "https://example.com/",
      eventDate: "2026-08-11",
      observedAt: "2026-08-11",
      excerpt: "We invest in mid-market European industrials.",
    },
    { claim: "Any problem your product solves.", kind: "unknown" },
  ],
};

export function Analyzer({ org }: { org: string }) {
  const [url, setUrl] = useState("");
  const [state, setState] = useState<"idle" | "running" | "done">("idle");
  const [verdict, setVerdict] = useState<Verdict | null>(null);

  function analyze(e: React.FormEvent) {
    e.preventDefault();
    setState("running");
    // A fixed delay standing in for the research pipeline, so the loading
    // state is actually exercised rather than theoretical.
    setTimeout(() => {
      const looksLikeAFund = /fund|capital|partners|ventures/i.test(url);
      setVerdict(looksLikeAFund ? BAD : GOOD);
      setState("done");
    }, 900);
  }

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
        <Button type="submit" variant="primary" size="lg" icon={Search} disabled={state === "running"}>
          {state === "running" ? "Researching…" : "Analyze"}
        </Button>
      </form>

      <p className="mt-2 text-[12px] text-fg-muted">
        Demo: no model is connected. Try a URL containing &ldquo;capital&rdquo; or
        &ldquo;ventures&rdquo; to see a refusal.
      </p>

      {state === "running" && (
        <div className="mt-8">
          <SectionLabel>Researching</SectionLabel>
          <LoadingSkeleton className="mt-3" rows={4} rowHeight={64} />
        </div>
      )}

      {state === "done" && verdict && (
        <div className="mt-8 space-y-6">
          <Card flush>
            <CardHeader
              title={
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[14px]">{verdict.domain}</span>
                  <PriorityBadge
                    priority={verdict.priority}
                    reason={verdict.priorityReason}
                  />
                </span>
              }
              actions={
                <ScorePill
                  score={verdict.score}
                  explanation={verdict.explanation}
                  confidence={verdict.confidence}
                  dimensions={verdict.dimensions}
                />
              }
            />
            <CardBody className="space-y-4">
              <p className="text-[14px] leading-[1.6] text-fg-secondary">
                {verdict.summary}
              </p>

              {/* The recommendation gets the same visual weight whether it is
                  "contact this week" or "don't". A refusal rendered quietly
                  reads as a failure of the tool rather than an answer. */}
              <div
                className={[
                  "rounded-md border px-4 py-3",
                  verdict.priority === "ignore"
                    ? "border-line bg-surface-active"
                    : "border-brand-border bg-brand-surface",
                ].join(" ")}
              >
                <SectionLabel>Recommendation</SectionLabel>
                <p
                  className={[
                    "mt-1.5 text-[14px] leading-[1.6]",
                    verdict.priority === "ignore" ? "text-fg-secondary" : "text-brand-text",
                  ].join(" ")}
                >
                  {verdict.recommendation}
                </p>
              </div>
            </CardBody>
          </Card>

          <Card flush>
            <CardHeader
              title="Evidence"
              description="What this verdict rests on — and what it doesn't."
            />
            <CardBody>
              <EvidenceList items={verdict.evidence} now={NOW} />
            </CardBody>
          </Card>

          <p className="flex flex-wrap items-center gap-1.5 text-[12px] text-fg-muted">
            <ClaimBadge kind="fact" /> observed at a source ·
            <ClaimBadge kind="inference" /> concluded by a model ·
            <ClaimBadge kind="unknown" /> not established.
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={() => { setState("idle"); setUrl(""); }}>
              Analyze another
            </Button>
            {verdict.priority !== "ignore" && (
              <Button variant="primary">Save as an opportunity</Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
