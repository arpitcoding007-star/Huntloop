"use client";

import type { LookAlikePreview } from "../../lib/data/look-alike-preview";

/**
 * What the example companies would contribute, reported honestly.
 *
 * ── Why this lives in `_components` ──────────────────────────────────────
 *
 * Two route groups render it: the onboarding ICP step, where somebody types
 * their first example domain, and the ICP settings screen, where they revise
 * it a month later. Those are the same question asked twice, and two copies
 * of this component would be two places for the wording of a partial failure
 * to drift. `_components` is a private folder — Next.js does not route it —
 * which is the standard place for a component shared across route groups
 * without inventing a route for it. It is not in `@huntloop/ui` because it
 * knows what a look-alike expansion is, and `ui` deliberately knows nothing
 * about this product's domain.
 *
 * ── Why every branch exists ──────────────────────────────────────────────
 *
 * The expansion can half-work. A panel showing only the additions would let a
 * user believe all five domains were read when two were typed as company
 * names and one timed out — and the additions are attributes being folded
 * into a search they are paying for. What the answer is based on matters as
 * much as the answer.
 */
export function LookAlikeResult({ preview }: { preview: LookAlikePreview }) {
  return (
    <div className="mt-3 border-t border-line-subtle pt-3">
      {preview.added.length > 0 ? (
        <>
          <p className="text-[12px] leading-[1.5] text-fg-secondary">
            Reading {preview.resolved.join(", ")} would widen the search:
          </p>
          <ul className="mt-1.5 space-y-1">
            {preview.added.map((line) => (
              <li key={line} className="text-[12px] leading-[1.5] text-fg-muted">
                · {line}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="text-[12px] leading-[1.5] text-fg-muted">
          {preview.skipped ??
            "These match what you have already described, so the search is unchanged."}
        </p>
      )}

      {preview.notDomains.length > 0 && (
        <p className="mt-2 text-[12px] leading-[1.5] text-warning">
          {preview.notDomains.length === 1
            ? "This is not a domain, so it was not looked up"
            : "These are not domains, so they were not looked up"}
          : {preview.notDomains.join(", ")}. Enter them as addresses —
          stripe.com rather than Stripe.
        </p>
      )}

      {preview.unreadable.length > 0 && (
        <p className="mt-2 text-[12px] leading-[1.5] text-fg-muted">
          Couldn&rsquo;t read {preview.unreadable.join(", ")} just now. The rest
          still counts.
        </p>
      )}

      {preview.beyondCap.length > 0 && (
        <p className="mt-2 text-[12px] leading-[1.5] text-fg-muted">
          Only the first five are read, so {preview.beyondCap.join(", ")} were
          not used. Past five the attributes converge, and each extra company
          costs a credit to confirm what the previous ones said.
        </p>
      )}
    </div>
  );
}
