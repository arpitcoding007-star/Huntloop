"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@huntloop/ui";
import { BrainCircuit, X } from "lucide-react";
import type { Nudge } from "../../../../lib/data/nudges";

/**
 * The one question Huntloop wants to ask this workspace.
 *
 * ── Why it is dismissible per kind rather than per showing ───────────────
 *
 * The key is the nudge's *kind*, not its text or a timestamp. Somebody who has
 * decided they do not want to revisit their ICP should not be asked again next
 * week because the approval count went from ten to eleven — that is the same
 * question with a bigger number, and re-asking it is how a helpful prompt
 * becomes something people learn to click past without reading.
 *
 * A *different* kind still gets through. A rejection streak is a different
 * question from an approval milestone, and dismissing one says nothing about
 * the other.
 *
 * ── Why the dismissal is local ───────────────────────────────────────────
 *
 * Per-viewer, in `localStorage`, for the same reason the ICP quality card's
 * is: one member finding a prompt noisy says nothing about their colleague,
 * and it is not worth a table. Losing it — a cleared browser, another device —
 * shows the prompt once more, which is the right direction for that failure.
 */
export function LearningNudge({ org, nudge }: { org: string; nudge: Nudge }) {
  const key = `huntloop.nudge.${org}.${nudge.kind}`;

  /* Hidden until mount: `localStorage` is unreadable during a server render,
     so rendering immediately would flash the card at somebody who dismissed
     it — worse than one that arrives a frame late. */
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(key) !== "dismissed") setShow(true);
    } catch {
      setShow(true);
    }
  }, [key]);

  if (!show) return null;

  return (
    <section
      aria-labelledby="nudge-heading"
      className="mt-10 rounded-md border border-ai-border bg-ai-surface/40 p-4"
    >
      <div className="flex flex-wrap items-start gap-3">
        <BrainCircuit
          aria-hidden
          className="mt-0.5 size-4 shrink-0 text-ai"
          strokeWidth={1.75}
        />

        <div className="min-w-0 flex-1">
          <h2 id="nudge-heading" className="text-[13px] font-semibold text-fg">
            {nudge.title}
          </h2>
          <p className="mt-1 text-[12px] leading-[1.6] text-fg-muted">{nudge.body}</p>
          <div className="mt-3">
            <Button
              size="sm"
              variant="secondary"
              href={nudge.action.href}
              linkComponent={Link}
            >
              {nudge.action.label}
            </Button>
          </div>
        </div>

        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => {
            setShow(false);
            try {
              window.localStorage.setItem(key, "dismissed");
            } catch {
              /* Storage unavailable. Gone for this page view, which is what the
                 click asked for; it returns on the next load. */
            }
          }}
          className="hl-focusable shrink-0 rounded-sm p-0.5 text-fg-muted hover:text-fg-secondary"
        >
          <X className="size-3.5" strokeWidth={1.75} />
        </button>
      </div>
    </section>
  );
}
