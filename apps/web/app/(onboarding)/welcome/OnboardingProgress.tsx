"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Check } from "lucide-react";
import { VISIBLE_STEPS } from "../../../lib/onboarding/steps";

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
                active && "border-brand bg-brand text-fg-inverse",
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

          /* The first step creates nothing and needs no org; every other one
             would dead-end without it. A link that dropped the parameter would
             send a user with a half-built workspace back to the screen that
             builds a new one. */
          const href = org && i > 0 ? `${step.href}?org=${org}` : step.href;

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
    </nav>
  );
}
