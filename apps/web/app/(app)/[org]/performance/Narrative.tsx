"use client";

import { useState, useTransition } from "react";
import { Button, ClaimBadge, FormMessage } from "@huntloop/ui";
import { Sparkles } from "lucide-react";
import type { PerformanceFact, PerformanceNarrative } from "@huntloop/ai";
import { explainPerformanceAction } from "./actions";

/**
 * "Summarise this period" — a few sentences a model writes over the figures
 * above, on request.
 *
 * Labelled as inference, with every sentence's sources one click away. The
 * task that writes it cannot introduce a number the figures do not contain;
 * this component's job is to make that visible rather than to ask for trust.
 */
export function Narrative({ org, period, canAsk }: { org: string; period: string; canAsk: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    source: "live" | "unconfigured";
    narrative: PerformanceNarrative;
    facts: PerformanceFact[];
  } | null>(null);

  if (!canAsk) return null;

  const factText = (id: string) => result?.facts.find((f) => f.id === id)?.text ?? id;

  return (
    <div className="mt-4 rounded-lg border border-ai-border bg-ai-surface px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-ai" strokeWidth={1.75} />
          <span className="text-[13px] font-medium text-fg">Summary</span>
          {result && <ClaimBadge kind="inference" />}
        </div>
        <Button
          size="sm"
          variant="secondary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setError(null);
              const res = await explainPerformanceAction(org, period);
              if (res.ok) setResult({ source: res.source, narrative: res.narrative, facts: res.facts });
              else setError(res.error);
            })
          }
        >
          {pending ? "Writing…" : result ? "Write it again" : "Summarise this period"}
        </Button>
      </div>

      {!result && !error && (
        <p className="mt-1.5 text-[12px] text-fg-muted">
          A model reads the figures on this page and writes the paragraph you would send in a weekly
          update. It may connect figures; it cannot add any.
        </p>
      )}
      {error && <FormMessage result={{ ok: false, error }} className="mt-2" />}

      {result && (
        <div className="mt-2 space-y-3">
          {result.source === "unconfigured" && (
            <p className="text-[12px] text-fg-muted">
              No model is connected, so this is a worked example: the two most important figures,
              quoted as they are.
            </p>
          )}
          <div className="space-y-1.5">
            {result.narrative.summary.map((line, i) => (
              <Sentence key={i} text={line.text} sources={line.factIds.map(factText)} />
            ))}
          </div>
          {result.narrative.suggestions.length > 0 && (
            <div>
              <p className="text-[11px] font-medium tracking-label text-fg-muted uppercase">Suggestions</p>
              <ul className="mt-1 space-y-1.5">
                {result.narrative.suggestions.map((line, i) => (
                  <li key={i}>
                    <Sentence text={line.text} sources={line.factIds.map(factText)} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Sentence({ text, sources }: { text: string; sources: string[] }) {
  return (
    <details className="group">
      <summary className="hl-focusable cursor-pointer list-none rounded-sm text-[14px] leading-[1.55] text-fg marker:hidden">
        {text}{" "}
        <span className="text-[11px] text-fg-muted underline decoration-dotted underline-offset-2 group-open:hidden">
          based on {sources.length}
        </span>
      </summary>
      <ul className="mt-1 space-y-0.5 border-l border-line-subtle pl-3">
        {sources.map((s) => (
          <li key={s} className="text-[12px] text-fg-muted">
            {s}
          </li>
        ))}
      </ul>
    </details>
  );
}
