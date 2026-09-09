"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@huntloop/ui";
import { Sparkles, X } from "lucide-react";
import type { IcpQualityCard as Quality } from "../../../../lib/data/icp-quality";

/**
 * "Your profile would work harder with one more field."
 *
 * ── Why this is dismissible, and why the dismissal is local ──────────────
 *
 * Because it is advice, not a task. A user who has decided their ICP is good
 * enough is entitled to that decision, and a card they cannot close turns a
 * suggestion into a nag — which is how people learn to ignore the whole
 * region of the screen, including the parts that matter.
 *
 * The dismissal lives in `localStorage` rather than in a column, because it is
 * a per-viewer convenience: one member finding the card noisy says nothing
 * about their colleague, and it is not worth a migration, a write path, or a
 * row per person per suggestion. The cost of it being lost — a cleared browser,
 * a second device — is that the card comes back once, which is the correct
 * direction for that failure.
 *
 * The key includes the score, so a *changed* profile surfaces fresh advice
 * rather than staying silent forever because somebody closed it in March.
 */
export function IcpQualityCard({
  org,
  quality,
}: {
  org: string;
  quality: Quality;
}) {
  const key = `huntloop.icp-nudge.${org}.${quality.score}`;

  /* Starts hidden and appears after mount.
     `localStorage` is unreadable during a server render, so rendering the card
     immediately would flash it on screen for a user who dismissed it — worse
     than a card that arrives a frame late. */
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(key) !== "dismissed") setShow(true);
    } catch {
      /* Private mode, blocked site data, a browser that throws on access. The
         card is a convenience; failing to read the flag shows it, which is the
         same as a first visit and is harmless. */
      setShow(true);
    }
  }, [key]);

  if (!show) return null;

  return (
    <section
      aria-labelledby="icp-nudge-heading"
      className="mt-10 rounded-md border border-line-subtle bg-panel p-4"
    >
      <div className="flex flex-wrap items-start gap-3">
        <Sparkles aria-hidden className="mt-0.5 size-4 shrink-0 text-brand" strokeWidth={1.75} />

        <div className="min-w-0 flex-1">
          <h2 id="icp-nudge-heading" className="text-[13px] font-semibold text-fg">
            Your customer profile is {quality.score}% complete
          </h2>
          {/* The hints, not the number, are the point — each names a field and
              what filling it in would let Huntloop do. They are written beside
              the weights in `packages/db/src/icp.ts`, so the advice and the
              scoring cannot drift apart. */}
          <ul className="mt-2 space-y-1">
            {quality.suggestions.map((s) => (
              <li key={s} className="text-[12px] leading-[1.5] text-fg-muted">
                {s}
              </li>
            ))}
          </ul>
          <div className="mt-3">
            <Button
              size="sm"
              variant="secondary"
              href={`/${org}/settings/icp`}
              linkComponent={Link}
            >
              Sharpen my profile
            </Button>
          </div>
        </div>

        <button
          type="button"
          aria-label="Dismiss this suggestion"
          onClick={() => {
            setShow(false);
            try {
              window.localStorage.setItem(key, "dismissed");
            } catch {
              /* Storage unavailable. The card is gone for this page view, which
                 is what the click asked for; it returns on the next load. */
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
