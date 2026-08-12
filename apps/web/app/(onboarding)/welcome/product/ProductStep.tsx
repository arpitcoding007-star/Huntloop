"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  ClaimBadge,
  ErrorState,
  LoadingSkeleton,
} from "@huntloop/ui";
import { Globe, Pencil } from "lucide-react";
import { researchCompanyAction, type ResearchState } from "./actions";
import { mergeDraft } from "../../../../lib/onboarding/draft";

/**
 * §8 — the first real input is a company website, and Huntloop researches it.
 *
 * Everything the research produces is shown as an editable field, not as a
 * finished profile. Two reasons, and the second is the one that matters:
 *
 *   · §77 Principle 7 gives the user control over what the engine believes.
 *   · This output feeds the ICP, which feeds source selection, which feeds
 *     every opportunity after it. An error here is not a cosmetic error on one
 *     screen — it propagates through the whole loop, and it gets harder to
 *     spot at every step.
 *
 * Fields carry a claim kind for the same reason they do everywhere else: what
 * a website states outright and what a model concluded from it are different
 * things, and the difference stops being visible the moment they're rendered
 * as the same grey text.
 */

type Kind = "fact" | "inference" | "unknown";

interface Finding {
  field: string;
  label: string;
  kind: Kind;
  value: string;
  sourceUrl: string | null;
  confidence: "high" | "medium" | "low" | null;
}

export function ProductStep({ org }: { org: string }) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [phase, setPhase] = useState<"input" | "researching" | "review">("input");
  const [state, setState] = useState<ResearchState>({});
  const [findings, setFindings] = useState<Finding[]>([]);
  const [editing, setEditing] = useState<number | null>(null);
  const [, startTransition] = useTransition();

  function research(e: React.FormEvent) {
    e.preventDefault();
    setPhase("researching");
    setState({});
    startTransition(async () => {
      const next = await researchCompanyAction(org, url);
      setState(next);
      if (next.result) {
        setFindings(next.result.understanding.findings as Finding[]);
        setPhase("review");
      } else {
        // A failed run returns to the input step rather than to a demo profile.
        // Substituting the worked example here would show invented findings to
        // someone who has every reason to believe a model produced them.
        setPhase("input");
      }
    });
  }

  if (phase === "input") {
    return (
      <>
        <h1 className="text-[26px] leading-8 font-semibold text-fg">
          What does your company sell?
        </h1>
        <p className="mt-1.5 max-w-lg text-[14px] leading-[1.6] text-fg-muted">
          Give us your website and Huntloop will read it — what you sell, who
          buys it, and what problem it solves. You&rsquo;ll check the result
          before anything else happens.
        </p>

        {state.error && (
          <ErrorState
            className="mt-6 max-w-lg"
            title="That didn't work"
            description={state.error}
          />
        )}

        <form onSubmit={research} className="mt-6 flex max-w-lg flex-wrap gap-2">
          <div className="relative min-w-0 flex-1">
            <Globe
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-muted"
              strokeWidth={1.75}
            />
            <input
              type="text"
              required
              autoFocus
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              aria-label="Your company website"
              placeholder="https://yourcompany.com"
              className="hl-focusable h-10 w-full rounded-md border border-line bg-surface pr-3 pl-9 text-[14px] text-fg placeholder:text-fg-muted"
            />
          </div>
          <Button type="submit" variant="primary" size="lg">
            Research my company
          </Button>
        </form>
      </>
    );
  }

  if (phase === "researching") {
    return (
      <>
        <h1 className="text-[26px] leading-8 font-semibold text-fg">
          Reading {url || "your website"}…
        </h1>
        <p className="mt-1.5 text-[14px] text-fg-muted">
          Working out what you sell, who buys it, and why. This reads several
          pages, so it takes a moment.
        </p>
        <LoadingSkeleton className="mt-6 max-w-2xl" rows={5} rowHeight={72} />
      </>
    );
  }

  const result = state.result;

  return (
    <>
      <h1 className="text-[26px] leading-8 font-semibold text-fg">
        Here&rsquo;s what we understood
      </h1>
      <p className="mt-1.5 max-w-lg text-[14px] leading-[1.6] text-fg-muted">
        Fix anything that&rsquo;s wrong. Everything after this — your ideal
        customer, your sources, every opportunity — is built on it.
      </p>

      {/* The screen never lets a worked example pass for a real reading. */}
      {result?.source === "unconfigured" && (
        <p
          role="status"
          className="mt-4 max-w-2xl rounded-md border border-warning-border bg-warning-surface px-3 py-2 text-[13px] leading-[1.5] text-fg-secondary"
        >
          <span className="font-medium text-warning">No model is connected.</span>{" "}
          These are worked examples, not a reading of your site — nothing fetched{" "}
          {url || "your website"}. Add{" "}
          <span className="font-mono text-[12px] text-fg">ANTHROPIC_API_KEY</span> to{" "}
          <span className="font-mono text-[12px] text-fg">apps/web/.env.local</span> to
          make this real.
        </p>
      )}

      <Card flush className="mt-6 max-w-2xl">
        <CardHeader
          title={result?.understanding.companyName ?? "Your company"}
          description={result?.understanding.canonicalDomain ?? url}
          actions={
            <Button size="sm" variant="ghost" onClick={() => setPhase("input")}>
              Start over
            </Button>
          }
        />
        <CardBody className="space-y-5">
          {findings.map((f, i) => (
            <div key={f.field}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-medium tracking-[0.06em] text-fg-muted uppercase">
                  {f.label}
                </span>
                <ClaimBadge kind={f.kind} confidence={f.confidence ?? undefined} />
                {editing !== i && (
                  <button
                    type="button"
                    onClick={() => setEditing(i)}
                    className="hl-focusable ml-auto inline-flex items-center gap-1 rounded-sm text-[12px] text-fg-muted transition-colors duration-[120ms] hover:text-fg-secondary"
                  >
                    <Pencil className="size-3" strokeWidth={1.75} />
                    Edit
                  </button>
                )}
              </div>

              {editing === i ? (
                <textarea
                  autoFocus
                  rows={3}
                  aria-label={f.label}
                  value={f.value}
                  onChange={(e) =>
                    setFindings((prev) =>
                      prev.map((p, j) => (j === i ? edited(p, e.target.value, result) : p)),
                    )
                  }
                  onBlur={() => setEditing(null)}
                  className="hl-focusable mt-2 w-full resize-y rounded-md border border-line bg-surface px-2.5 py-2 text-[14px] leading-[1.6] text-fg"
                />
              ) : (
                <p className="mt-1.5 text-[14px] leading-[1.6] text-fg-secondary">
                  {f.value}
                </p>
              )}

              {/* A fact names where it was read. Showing the link is what makes
                  the fact/inference split checkable rather than decorative. */}
              {f.kind === "fact" && f.sourceUrl && editing !== i && (
                <a
                  href={f.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hl-focusable mt-1 inline-block truncate rounded-sm font-mono text-[12px] text-fg-muted underline decoration-dotted underline-offset-2 transition-colors duration-[120ms] hover:text-fg-secondary"
                >
                  {f.sourceUrl}
                </a>
              )}
            </div>
          ))}
        </CardBody>
      </Card>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          size="lg"
          onClick={() => {
            // Carried forward as the user left it, edits included — the ICP
            // step and source recommendation are both built on this sentence,
            // and a correction made here that did not survive the click would
            // be worse than never offering the edit.
            mergeDraft({
              companyName: result?.understanding.companyName,
              website: result?.understanding.url,
              sells: findings.find((f) => f.field === "sells")?.value,
            });
            router.push(`/welcome/icp?org=${org}`);
          }}
        >
          Looks right — build my ideal customer
        </Button>
      </div>
    </>
  );
}

/**
 * A human edit turns a finding into a first-party statement.
 *
 * It stops being a model's conclusion the moment the person who runs the
 * company corrects it, and mislabelling that as an inference would understate
 * what we actually know. The citation is the company's own site because that is
 * precisely what a first-party claim about a company cites — and §7 needs a
 * fact to name a source, so an edit that produced a sourceless fact would be a
 * claim this codebase's own validator rejects.
 */
function edited(
  finding: Finding,
  value: string,
  result: ResearchState["result"],
): Finding {
  return {
    ...finding,
    value,
    kind: "fact",
    sourceUrl: finding.sourceUrl ?? result?.understanding.url ?? null,
    confidence: "high",
  };
}
