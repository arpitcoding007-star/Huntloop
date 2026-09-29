"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ArrowLeft, Check } from "lucide-react";
import { VISIBLE_STEPS } from "../../../lib/onboarding/steps";
import { DEV_BYPASS } from "../../../lib/dev-bypass";

/**
 * The five steps a person is asked to do, and where they are in them.
 *
 * ── Why five and not eight ───────────────────────────────────────────────
 *
 * `building`, `review` and `done` are real steps in `0024`'s column and are
 * deliberately absent here. Building is a progress screen, review is the
 * payoff, and neither is work the user has to get through — showing "step 6 of
 * 8" on the screen that hands somebody their first three qualified companies
 * would frame the reward as more homework.
 *
 * ── Why completed steps are links and later ones are not ─────────────────
 *
 * Going *back* has to be possible: §77 Principle 7 gives the user control over
 * the ICP and the sources, and a wizard you can only move forward through
 * quietly removes that. Going *forward* by clicking is not offered, because
 * each step consumes the previous one's output — a user who jumped to sources
 * would be recommended from a profile that does not exist yet.
 *
 * The org travels in the query string, so a back-link that dropped it would
 * bounce the user to the step that creates a workspace they already have.
 */
export function OnboardingProgress() {
  const pathname = usePathname();
  const params = useSearchParams();
  const org = params.get("org");

  const current = Math.max(
    0,
    VISIBLE_STEPS.findIndex((s) => s.href === pathname),
  );

  // A path outside the five — `/welcome/building` or `/welcome/review` — is
  // past the last of them, not before the first. Rendering it as "step one"
  // would walk the bar backwards at the moment of success.
  const beyond = !VISIBLE_STEPS.some((s) => s.href === pathname);

  /* Beyond the five, "back" is the last of them — sources — which is where
     the building screen's own "change the profile" buttons already point. */
  const previous = beyond
    ? VISIBLE_STEPS[VISIBLE_STEPS.length - 1]
    : current > 0
      ? VISIBLE_STEPS[current - 1]
      : null;

  return (
    <nav aria-label="Setup progress">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-2">
        {VISIBLE_STEPS.map((step, i) => {
          const done = beyond || i < current;
          const active = !beyond && i === current;

          const dot = (
            <span
              className={[
                "flex size-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold",
                done && "border-brand-border bg-brand-surface text-brand-text",
                active && "border-brand bg-brand text-brand-ink",
                !done && !active && "border-line bg-surface text-fg-muted",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {done ? <Check className="size-3" strokeWidth={2.5} /> : i + 1}
            </span>
          );

          const label = (
            <span
              className={[
                "text-[13px] whitespace-nowrap",
                active ? "font-medium text-fg" : "text-fg-muted",
              ].join(" ")}
            >
              {step.label}
            </span>
          );

          /* Every step carries the org, the first one included. Without it
             `/welcome` reads a returning user as somebody who has already
             answered and forwards them on — so "You" was a link that could
             never be reached. With it, the page treats the visit as going back
             to edit. */
          const href = hrefFor(step.href, org);

          return (
            <li key={step.step} className="flex items-center gap-2">
              {done ? (
                <Link
                  href={href}
                  className="hl-focusable flex items-center gap-2 rounded-sm hover:opacity-80"
                >
                  {dot}
                  {label}
                </Link>
              ) : (
                <span
                  className="flex items-center gap-2"
                  aria-current={active ? "step" : undefined}
                >
                  {dot}
                  {label}
                </span>
              )}
              {i < VISIBLE_STEPS.length - 1 && (
                <span aria-hidden className="h-px w-4 bg-line sm:w-8" />
              )}
            </li>
          );
        })}
      </ol>

      {(previous || (DEV_BYPASS && org)) && (
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px]">
          {/* Spelled out as well as available through the dots above: a
              check mark reads as "done", not as "click to go back". */}
          {previous && (
            <Link
              href={hrefFor(previous.href, org)}
              className="hl-focusable inline-flex items-center gap-1 rounded-sm text-fg-muted hover:text-fg"
            >
              <ArrowLeft className="size-3.5" strokeWidth={1.75} />
              Back to {previous.label.toLowerCase()}
            </Link>
          )}
          {/* Development only — see lib/dev-bypass.ts. The workspace layout
              does not require a finished onboarding (it shows a setup card
              instead), so this skips nothing the server enforces. */}
          {DEV_BYPASS && org && (
            <Link
              href={`/${org}/dashboard`}
              className="hl-focusable ml-auto rounded-sm text-warning-text underline underline-offset-2 hover:text-fg"
            >
              Skip to workspace (dev)
            </Link>
          )}
        </div>
      )}
    </nav>
  );
}

function hrefFor(path: string, org: string | null): string {
  return org ? `${path}?org=${encodeURIComponent(org)}` : path;
}
