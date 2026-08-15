"use client";

import { useState } from "react";
import { Button, Card, CardBody, CardHeader, ClaimBadge } from "@huntloop/ui";
import { Send, Sparkles } from "lucide-react";

/**
 * The per-opportunity AI sales agent (master context §19).
 *
 * This is UI only — there is no model behind it yet, and the panel says so
 * rather than pretending. That honesty is not a placeholder convention; §62
 * rule 8 ("avoid confidently claiming unknown information") applies to the
 * product's claims about itself as much as to its claims about a prospect.
 *
 * What this shipped shell is actually for: fixing the shape of the
 * conversation before the model arrives. The suggested prompts below are the
 * §19 question list, and the footer states the safety contract the agent will
 * be held to — both are decisions worth making while they are still cheap.
 */

const SUGGESTED = [
  "What should I write?",
  "What should I not claim?",
  "What do we actually know?",
  "Prepare me for a meeting",
  "Give me a different angle",
  "Is this still a good opportunity?",
];

export function AgentPanel({ company }: { company: string }) {
  const [draft, setDraft] = useState("");

  return (
    <Card flush>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Sparkles className="size-4 text-ai" strokeWidth={1.75} />
            Ask about {company}
          </span>
        }
        description="This conversation keeps its own context for this opportunity."
      />
      <CardBody className="space-y-3">
        <div className="rounded-md border border-ai-border bg-ai-surface px-3 py-2.5">
          <p className="text-[12px] leading-[1.5] text-ai-text">
            Not connected yet. The agent ships in Phase 2 — see
            IMPLEMENTATION_PLAN.md §8. Nothing here will answer you.
          </p>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {SUGGESTED.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setDraft(s)}
              className="hl-focusable rounded-md border border-line bg-surface px-2 py-1 text-[12px] text-fg-secondary transition-colors duration-[120ms] hover:border-line-strong hover:text-fg"
            >
              {s}
            </button>
          ))}
        </div>

        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            aria-label={`Ask about ${company}`}
            placeholder="Ask anything about this opportunity…"
            className="hl-focusable min-h-[64px] w-full resize-y rounded-md border border-line bg-surface px-2.5 py-2 text-[13px] text-fg placeholder:text-fg-muted"
          />
          {/* `disabled` alone until NAV-03, which is the one case in the app
              where the panel already explained itself in the notice above.
              The reason still belongs on the control: a keyboard user reaching
              this button need not have read, or been able to reach, the
              paragraph three elements earlier. */}
          <Button
            variant="primary"
            icon={Send}
            aria-label="Send"
            pending="The agent isn't connected yet — nothing will answer you."
          />
        </div>

        <p className="flex flex-wrap items-center gap-1.5 text-[11px] leading-[1.5] text-fg-muted">
          Answers will cite <ClaimBadge kind="fact" /> with a source, mark
          <ClaimBadge kind="inference" /> as reasoning, and say
          <ClaimBadge kind="unknown" /> rather than guess.
        </p>
      </CardBody>
    </Card>
  );
}
