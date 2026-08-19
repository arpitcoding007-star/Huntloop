"use client";

import { useState, useTransition } from "react";
import { Badge, Button, Card, CardBody, CardHeader, ClaimBadge, FormMessage } from "@huntloop/ui";
import { Send, Sparkles } from "lucide-react";
import type { ConversationTurn } from "../../../../../lib/data/conversation";
import { askAgentAction } from "./actions";

/**
 * The per-opportunity AI sales agent (master context §19).
 *
 * ── What the shell was for, and what replaced it ─────────────────────────
 *
 * This shipped as UI with nothing behind it, and said so — the panel's own
 * comment argued that fixing the shape of the conversation was worth doing
 * while it was still cheap. The suggested prompts below are §19's question
 * list and they are unchanged; what has arrived is the model, the persistence,
 * and the grounding contract the footer already promised.
 *
 * ── The contract, now enforced rather than advertised ────────────────────
 *
 * An answer names the claims it rests on, and those are constrained by the
 * task's schema to claims Huntloop actually gathered. What it could not
 * establish comes back as its own list rather than being smoothed into the
 * prose — because a chat window is the most natural place in this product for
 * a confident sentence about something nobody looked up, and §62 rule 8 is the
 * rule that keeps it from being where that happens.
 *
 * Both are rendered. An answer whose citations were computed and then not
 * shown would be the same claim as before — trust us — with extra steps.
 */

const SUGGESTED = [
  "What should I write?",
  "What should I not claim?",
  "What do we actually know?",
  "Prepare me for a meeting",
  "Give me a different angle",
  "Is this still a good opportunity?",
];

type Result = { ok: true; message?: string } | { ok: false; error: string } | null;

export function AgentPanel({
  org,
  opportunityId,
  company,
  history,
  canAsk,
}: {
  org: string;
  opportunityId: string;
  company: string;
  history: ConversationTurn[];
  /**
   * Whether this viewer may spend the AI budget. Resolved on the server — a
   * model call is the one action in this product with a per-use cost, and
   * `canSpend` is the role check for it.
   */
  canAsk: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [pending, start] = useTransition();
  const [result, setResult] = useState<Result>(null);
  /* Turns added in this session, appended to what the server loaded. The page
     revalidates, but the answer should appear the moment it arrives rather
     than after a round trip that re-renders the whole screen. */
  const [added, setAdded] = useState<ConversationTurn[]>([]);
  /* What the latest answer could not establish. Replaced per answer rather
     than accumulated: it describes the answer above it, not the conversation. */
  const [unresolved, setUnresolved] = useState<string[]>([]);

  const turns = [...history, ...added];

  const send = (question: string) => {
    if (!question.trim() || pending) return;
    start(async () => {
      const outcome = await askAgentAction(org, opportunityId, question);
      if (outcome.ok) {
        setAdded((prior) => [
          ...prior,
          {
            id: `local-user-${prior.length}`,
            role: "user",
            content: question,
            citedClaims: [],
            createdAt: null,
          },
          {
            id: `local-agent-${prior.length}`,
            role: "assistant",
            content: outcome.data.answer,
            citedClaims: outcome.data.citedClaims,
            createdAt: null,
          },
        ]);
        setDraft("");
        setResult(null);
        setUnresolved(outcome.data.unresolved);
      } else {
        /* The question stays in the box. Nothing was stored, so retrying is
           the whole recovery — see the note in `actions.ts`. */
        setResult({ ok: false, error: outcome.error });
      }
    });
  };

  return (
    <Card flush>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Sparkles className="size-4 text-ai" strokeWidth={1.75} />
            Ask about {company}
          </span>
        }
        description="This conversation keeps its own context for this opportunity, and is yours rather than the team's."
      />
      <CardBody className="space-y-3">
        {turns.length > 0 && (
          <ol className="space-y-2.5">
            {turns.map((turn) => (
              <li key={turn.id}>
                <Turn turn={turn} />
              </li>
            ))}
          </ol>
        )}

        {/* Rendered under the latest answer rather than inside it. §62 rule 8:
            what the evidence did not establish is its own statement, not a
            hedge buried in a paragraph the reader may skim past. */}
        {unresolved.length > 0 && (
          <div className="rounded-md border border-warning-border bg-warning-surface px-3 py-2.5">
            <p className="text-[11px] font-medium tracking-[0.06em] text-warning uppercase">
              Not established
            </p>
            <ul className="mt-1.5 space-y-1">
              {unresolved.map((item) => (
                <li key={item} className="text-[12px] leading-[1.5] text-fg-secondary">
                  {item}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-wrap gap-1.5">
          {SUGGESTED.map((s) => (
            <button
              key={s}
              type="button"
              disabled={pending}
              onClick={() => setDraft(s)}
              className="hl-focusable rounded-md border border-line bg-surface px-2 py-1 text-[12px] text-fg-secondary transition-colors duration-[120ms] hover:border-line-strong hover:text-fg disabled:opacity-60"
            >
              {s}
            </button>
          ))}
        </div>

        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={pending}
            rows={3}
            aria-label={`Ask about ${company}`}
            placeholder="Ask anything about this opportunity…"
            className="hl-focusable min-h-[64px] w-full resize-y rounded-md border border-line bg-surface px-2.5 py-2 text-[13px] text-fg placeholder:text-fg-muted disabled:opacity-60"
          />
          <Button
            variant="primary"
            icon={Send}
            aria-label={pending ? "Thinking" : "Send"}
            disabled={pending}
            onClick={() => send(draft)}
            pending={
              canAsk
                ? undefined
                : "Your role is read-only, so you cannot run a model on this account."
            }
          />
        </div>

        <FormMessage result={result} />

        <p className="flex flex-wrap items-center gap-1.5 text-[11px] leading-[1.5] text-fg-muted">
          Answers cite <ClaimBadge kind="fact" /> with a source, mark
          <ClaimBadge kind="inference" /> as reasoning, and say
          <ClaimBadge kind="unknown" /> rather than guess.
        </p>
      </CardBody>
    </Card>
  );
}

function Turn({ turn }: { turn: ConversationTurn }) {
  const mine = turn.role === "user";

  return (
    <div
      className={[
        "rounded-md border px-3 py-2.5",
        mine ? "border-line bg-surface" : "border-ai-border bg-ai-surface",
      ].join(" ")}
    >
      <div className="flex items-center gap-2">
        <Badge variant={mine ? "neutral" : "ai"}>{mine ? "You" : "Huntloop"}</Badge>
      </div>
      <p className="mt-1.5 text-[13px] leading-[1.55] whitespace-pre-wrap text-fg-secondary">
        {turn.content}
      </p>

      {/* §62 rule 4, rendered. An answer that says what it rests on and then
          does not show it is asking to be taken on trust, which is the thing
          this product exists not to do. */}
      {turn.citedClaims.length > 0 && (
        <details className="group mt-2">
          <summary className="hl-focusable inline-flex cursor-pointer list-none items-center gap-1.5 rounded-sm text-[11px] tracking-[0.06em] text-fg-muted uppercase">
            Based on ({turn.citedClaims.length})
            <span aria-hidden className="group-open:hidden">
              ▸
            </span>
            <span aria-hidden className="hidden group-open:inline">
              ▾
            </span>
          </summary>
          <ul className="mt-1.5 space-y-1">
            {turn.citedClaims.map((claim) => (
              <li key={claim} className="text-[12px] leading-[1.5] text-fg-muted">
                {claim}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
